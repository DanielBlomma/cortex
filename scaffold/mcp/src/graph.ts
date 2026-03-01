import fs from "node:fs";
import path from "node:path";
import kuzu, { type Connection, type Database, type QueryResult } from "kuzu";
import { DB_PATH, DEFAULT_RANKING, PATHS } from "./paths.js";
import type {
  AdrRecord,
  ContextData,
  DocumentRecord,
  JsonObject,
  JsonValue,
  RankingWeights,
  RelationRecord,
  RuleRecord,
  UnknownRow
} from "./types.js";

export type ReloadContextResult = {
  forced: boolean;
  reloaded: boolean;
  context_source: "kuzu" | "cache";
  previous_graph_signature: string | null;
  current_graph_signature: string | null;
  warning?: string;
};

let kuzuDb: Database | null = null;
let kuzuConnection: Connection | null = null;
let kuzuInitError: string | null = null;
let kuzuLastInitAttemptAt = 0;
let kuzuGraphSignature: string | null = null;

const KUZU_INIT_RETRY_INTERVAL_MS = 2000;

function readFileIfExists(filePath: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, "utf8");
}

function readJsonl(filePath: string): JsonObject[] {
  const raw = readFileIfExists(filePath);
  if (!raw) {
    return [];
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as JsonObject;
      } catch {
        return null;
      }
    })
    .filter((value): value is JsonObject => value !== null);
}

function asString(value: JsonValue | undefined, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: JsonValue | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: JsonValue | undefined, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringUnknown(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function asNumberUnknown(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asBooleanUnknown(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return fallback;
}

function parseDocuments(raw: JsonObject[]): DocumentRecord[] {
  return raw
    .map((item) => {
      const id = asString(item.id);
      const filePath = asString(item.path);
      if (!id || !filePath) {
        return null;
      }

      const kindRaw = asString(item.kind, "DOC").toUpperCase();
      const kind: DocumentRecord["kind"] =
        kindRaw === "CODE" ? "CODE" : kindRaw === "ADR" ? "ADR" : "DOC";

      return {
        id,
        path: filePath,
        kind,
        updated_at: asString(item.updated_at),
        source_of_truth: asBoolean(item.source_of_truth),
        trust_level: asNumber(item.trust_level, 50),
        status: asString(item.status, "active"),
        excerpt: asString(item.excerpt),
        content: asString(item.content)
      };
    })
    .filter((item): item is DocumentRecord => item !== null);
}

function parseAdrs(raw: JsonObject[]): AdrRecord[] {
  return raw
    .map((item) => {
      const id = asString(item.id);
      if (!id) {
        return null;
      }

      return {
        id,
        path: asString(item.path),
        title: asString(item.title),
        body: asString(item.body),
        decision_date: asString(item.decision_date),
        supersedes_id: asString(item.supersedes_id),
        source_of_truth: asBoolean(item.source_of_truth, true),
        trust_level: asNumber(item.trust_level, 95),
        status: asString(item.status, "active")
      };
    })
    .filter((item): item is AdrRecord => item !== null);
}

function parseRuleEntities(raw: JsonObject[]): RuleRecord[] {
  return raw
    .map((item) => {
      const id = asString(item.id);
      if (!id) {
        return null;
      }

      return {
        id,
        title: asString(item.title, id),
        body: asString(item.body),
        scope: asString(item.scope, "global"),
        updated_at: asString(item.updated_at, new Date(0).toISOString()),
        source_of_truth: asBoolean(item.source_of_truth, true),
        trust_level: asNumber(item.trust_level, 95),
        status: asString(item.status, "active"),
        priority: asNumber(item.priority, 0)
      };
    })
    .filter((item): item is RuleRecord => item !== null);
}

function parseRulesYaml(yamlText: string | null): RuleRecord[] {
  if (!yamlText) {
    return [];
  }

  const lines = yamlText.split(/\r?\n/);
  const rules: RuleRecord[] = [];
  let current: {
    id?: string;
    description?: string;
    priority?: number;
    enforce?: boolean;
    scope?: string;
  } | null = null;

  const pushCurrent = (): void => {
    if (!current?.id) {
      return;
    }
    rules.push({
      id: current.id,
      title: current.id,
      body: current.description ?? "",
      scope: current.scope ?? "global",
      updated_at: new Date().toISOString(),
      source_of_truth: true,
      trust_level: 95,
      status: current.enforce === false ? "draft" : "active",
      priority: Number.isFinite(current.priority) ? (current.priority as number) : 0
    });
  };

  for (const line of lines) {
    const idMatch = line.match(/^\s*-\s*id:\s*(.+?)\s*$/);
    if (idMatch) {
      pushCurrent();
      current = { id: idMatch[1].replace(/^['"]|['"]$/g, "") };
      continue;
    }

    if (!current) {
      continue;
    }

    const descriptionMatch = line.match(/^\s*description:\s*(.+?)\s*$/);
    if (descriptionMatch) {
      current.description = descriptionMatch[1].replace(/^['"]|['"]$/g, "");
      continue;
    }

    const priorityMatch = line.match(/^\s*priority:\s*(\d+)\s*$/);
    if (priorityMatch) {
      current.priority = Number(priorityMatch[1]);
      continue;
    }

    const enforceMatch = line.match(/^\s*enforce:\s*(true|false)\s*$/i);
    if (enforceMatch) {
      current.enforce = enforceMatch[1].toLowerCase() === "true";
      continue;
    }

    const scopeMatch = line.match(/^\s*scope:\s*(.+?)\s*$/);
    if (scopeMatch) {
      current.scope = scopeMatch[1].replace(/^['"]|['"]$/g, "");
    }
  }

  pushCurrent();
  return rules;
}

function parseRelations(raw: JsonObject[], relation: RelationRecord["relation"]): RelationRecord[] {
  return raw
    .map((item) => {
      const from = asString(item.from);
      const to = asString(item.to);
      if (!from || !to) {
        return null;
      }

      return {
        from,
        to,
        relation,
        note: asString(item.note) || asString(item.reason)
      };
    })
    .filter((item): item is RelationRecord => item !== null);
}

function parseRankingFromConfig(configText: string | null): RankingWeights {
  if (!configText) {
    return DEFAULT_RANKING;
  }

  const ranking: RankingWeights = { ...DEFAULT_RANKING };
  const lines = configText.split(/\r?\n/);
  let inRanking = false;

  for (const line of lines) {
    if (!inRanking && /^\s*ranking:\s*$/.test(line)) {
      inRanking = true;
      continue;
    }

    if (!inRanking) {
      continue;
    }

    const entry = line.match(/^\s*(semantic|graph|trust|recency):\s*([0-9]*\.?[0-9]+)\s*$/);
    if (entry) {
      const key = entry[1] as keyof RankingWeights;
      ranking[key] = Number(entry[2]);
      continue;
    }

    if (line.trim() !== "" && !/^\s/.test(line)) {
      break;
    }
  }

  return ranking;
}

async function queryRows(
  connection: Connection,
  statement: string
): Promise<Record<string, unknown>[]> {
  const result = await connection.query(statement);
  const resolved = Array.isArray(result) ? result[result.length - 1] : result;
  return (resolved as QueryResult).getAll();
}

function readGraphSignature(): string | null {
  if (!fs.existsSync(DB_PATH)) {
    return null;
  }

  try {
    const dbStats = fs.statSync(DB_PATH);
    const dbPart = `${Math.round(dbStats.mtimeMs)}:${dbStats.size}`;

    let manifestPart = "none";
    if (fs.existsSync(PATHS.graphManifest)) {
      const manifestStats = fs.statSync(PATHS.graphManifest);
      manifestPart = `${Math.round(manifestStats.mtimeMs)}:${manifestStats.size}`;
    }

    return `${dbPart}:${manifestPart}`;
  } catch {
    return null;
  }
}

function buildMissingDbMessage(): string {
  const dbDir = path.dirname(DB_PATH);
  const loadCommand = "./scripts/context.sh graph-load";
  const bootstrapCommand = "./scripts/context.sh bootstrap";

  if (!fs.existsSync(dbDir)) {
    return `Kuzu directory missing at ${dbDir}. Run ${bootstrapCommand}.`;
  }

  return `Kuzu DB not found at ${DB_PATH}. Run ${loadCommand} (or ${bootstrapCommand} on cold start).`;
}

async function closeKuzuResources(): Promise<void> {
  const currentConnection = kuzuConnection;
  const currentDb = kuzuDb;

  kuzuConnection = null;
  kuzuDb = null;
  kuzuGraphSignature = null;

  if (currentConnection) {
    try {
      await currentConnection.close();
    } catch {
      // Ignore close errors during refresh/reset.
    }
  }

  if (currentDb) {
    try {
      await currentDb.close();
    } catch {
      // Ignore close errors during refresh/reset.
    }
  }
}

async function resetKuzuState(errorMessage: string): Promise<void> {
  kuzuInitError = errorMessage;
  await closeKuzuResources();
}

async function getKuzuConnection(forceReload = false): Promise<Connection | null> {
  const diskSignature = readGraphSignature();

  if (kuzuConnection) {
    if (forceReload) {
      await closeKuzuResources();
      kuzuLastInitAttemptAt = 0;
    } else if (diskSignature && kuzuGraphSignature && diskSignature === kuzuGraphSignature) {
      return kuzuConnection;
    } else {
      await resetKuzuState("Kuzu graph changed on disk; reconnecting.");
      kuzuLastInitAttemptAt = 0;
    }
  }

  const now = Date.now();
  if (!forceReload && now - kuzuLastInitAttemptAt < KUZU_INIT_RETRY_INTERVAL_MS) {
    return null;
  }
  kuzuLastInitAttemptAt = now;

  if (!diskSignature) {
    await resetKuzuState(buildMissingDbMessage());
    return null;
  }

  try {
    const nextDb = new kuzu.Database(DB_PATH, undefined, undefined, true);
    const nextConnection = new kuzu.Connection(nextDb);
    await nextDb.init();
    await nextConnection.init();
    kuzuDb = nextDb;
    kuzuConnection = nextConnection;
    kuzuGraphSignature = readGraphSignature() ?? diskSignature;
    kuzuInitError = null;
    return nextConnection;
  } catch (error) {
    await resetKuzuState(error instanceof Error ? error.message : "Failed to initialize Kuzu");
    return null;
  }
}

function parseKuzuDocuments(rows: UnknownRow[], contentById: Map<string, string>): DocumentRecord[] {
  return rows
    .map((row) => {
      const id = asStringUnknown(row.id);
      const filePath = asStringUnknown(row.path);
      if (!id || !filePath) {
        return null;
      }

      const kindRaw = asStringUnknown(row.kind, "DOC").toUpperCase();
      const kind: DocumentRecord["kind"] =
        kindRaw === "CODE" ? "CODE" : kindRaw === "ADR" ? "ADR" : "DOC";

      return {
        id,
        path: filePath,
        kind,
        updated_at: asStringUnknown(row.updated_at),
        source_of_truth: asBooleanUnknown(row.source_of_truth, false),
        trust_level: asNumberUnknown(row.trust_level, 50),
        status: asStringUnknown(row.status, "active"),
        excerpt: asStringUnknown(row.excerpt),
        content: contentById.get(id) ?? ""
      };
    })
    .filter((value): value is DocumentRecord => value !== null);
}

function parseKuzuRules(rows: UnknownRow[]): RuleRecord[] {
  return rows
    .map((row) => {
      const id = asStringUnknown(row.id);
      if (!id) {
        return null;
      }

      return {
        id,
        title: asStringUnknown(row.title, id),
        body: asStringUnknown(row.body),
        scope: asStringUnknown(row.scope, "global"),
        updated_at: asStringUnknown(row.updated_at),
        source_of_truth: asBooleanUnknown(row.source_of_truth, true),
        trust_level: asNumberUnknown(row.trust_level, 95),
        status: asStringUnknown(row.status, "active"),
        priority: asNumberUnknown(row.priority, 0)
      };
    })
    .filter((value): value is RuleRecord => value !== null);
}

function parseKuzuAdrs(rows: UnknownRow[]): AdrRecord[] {
  return rows
    .map((row) => {
      const id = asStringUnknown(row.id);
      if (!id) {
        return null;
      }
      return {
        id,
        path: asStringUnknown(row.path),
        title: asStringUnknown(row.title, id),
        body: asStringUnknown(row.body),
        decision_date: asStringUnknown(row.decision_date),
        supersedes_id: asStringUnknown(row.supersedes_id),
        source_of_truth: asBooleanUnknown(row.source_of_truth, true),
        trust_level: asNumberUnknown(row.trust_level, 95),
        status: asStringUnknown(row.status, "active")
      };
    })
    .filter((value): value is AdrRecord => value !== null);
}

function parseKuzuRelations(
  rows: UnknownRow[],
  relation: RelationRecord["relation"],
  noteField: string
): RelationRecord[] {
  return rows
    .map((row) => {
      const from = asStringUnknown(row.from);
      const to = asStringUnknown(row.to);
      if (!from || !to) {
        return null;
      }
      return {
        from,
        to,
        relation,
        note: asStringUnknown(row[noteField])
      };
    })
    .filter((value): value is RelationRecord => value !== null);
}

export async function loadContextData(): Promise<ContextData> {
  const ranking = parseRankingFromConfig(readFileIfExists(PATHS.config));
  const cachedDocuments = parseDocuments(readJsonl(PATHS.documents));
  const cachedAdrs = parseAdrs(readJsonl(PATHS.adrEntities));
  const cachedRelations = [
    ...parseRelations(readJsonl(PATHS.constrainsRelations), "CONSTRAINS"),
    ...parseRelations(readJsonl(PATHS.implementsRelations), "IMPLEMENTS"),
    ...parseRelations(readJsonl(PATHS.supersedesRelations), "SUPERSEDES")
  ];

  const yamlRules = parseRulesYaml(readFileIfExists(PATHS.rulesYaml));
  const entityRules = parseRuleEntities(readJsonl(PATHS.ruleEntities));
  const cachedRules = yamlRules.length > 0 ? yamlRules : entityRules;

  const connection = await getKuzuConnection();
  if (!connection) {
    return {
      documents: cachedDocuments,
      adrs: cachedAdrs,
      rules: cachedRules,
      relations: cachedRelations,
      ranking,
      source: "cache",
      warning: kuzuInitError ?? "Kuzu DB is not loaded yet."
    };
  }

  try {
    const [fileRows, ruleRows, adrRows, constrainsRows, implementsRows, supersedesRows] =
      await Promise.all([
        queryRows(
          connection,
          `
          MATCH (f:File)
          RETURN
            f.id AS id,
            f.path AS path,
            f.kind AS kind,
            f.excerpt AS excerpt,
            f.updated_at AS updated_at,
            f.source_of_truth AS source_of_truth,
            f.trust_level AS trust_level,
            f.status AS status;
        `
        ),
        queryRows(
          connection,
          `
          MATCH (r:Rule)
          RETURN
            r.id AS id,
            r.title AS title,
            r.body AS body,
            r.scope AS scope,
            r.priority AS priority,
            r.updated_at AS updated_at,
            r.source_of_truth AS source_of_truth,
            r.trust_level AS trust_level,
            r.status AS status;
        `
        ),
        queryRows(
          connection,
          `
          MATCH (a:ADR)
          RETURN
            a.id AS id,
            a.path AS path,
            a.title AS title,
            a.body AS body,
            a.decision_date AS decision_date,
            a.supersedes_id AS supersedes_id,
            a.source_of_truth AS source_of_truth,
            a.trust_level AS trust_level,
            a.status AS status;
        `
        ),
        queryRows(
          connection,
          `
          MATCH (r:Rule)-[c:CONSTRAINS]->(f:File)
          RETURN r.id AS from, f.id AS to, c.note AS note;
        `
        ),
        queryRows(
          connection,
          `
          MATCH (f:File)-[i:IMPLEMENTS]->(r:Rule)
          RETURN f.id AS from, r.id AS to, i.note AS note;
        `
        ),
        queryRows(
          connection,
          `
          MATCH (a1:ADR)-[s:SUPERSEDES]->(a2:ADR)
          RETURN a1.id AS from, a2.id AS to, s.reason AS note;
        `
        )
      ]);

    const contentById = new Map(cachedDocuments.map((doc) => [doc.id, doc.content]));

    const kuzuDocuments = parseKuzuDocuments(fileRows, contentById);
    const kuzuRules = parseKuzuRules(ruleRows);
    const kuzuAdrs = parseKuzuAdrs(adrRows);
    const kuzuRelations = [
      ...parseKuzuRelations(constrainsRows, "CONSTRAINS", "note"),
      ...parseKuzuRelations(implementsRows, "IMPLEMENTS", "note"),
      ...parseKuzuRelations(supersedesRows, "SUPERSEDES", "note")
    ];

    return {
      documents: kuzuDocuments.length > 0 ? kuzuDocuments : cachedDocuments,
      adrs: kuzuAdrs.length > 0 ? kuzuAdrs : cachedAdrs,
      rules: kuzuRules.length > 0 ? kuzuRules : cachedRules,
      relations: kuzuRelations.length > 0 ? kuzuRelations : cachedRelations,
      ranking,
      source: "kuzu"
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? `Kuzu query failed, using cache fallback: ${error.message}`
        : "Kuzu query failed, using cache fallback.";
    await resetKuzuState(message);
    return {
      documents: cachedDocuments,
      adrs: cachedAdrs,
      rules: cachedRules,
      relations: cachedRelations,
      ranking,
      source: "cache",
      warning: message
    };
  }
}

export async function reloadContextGraph(force = true): Promise<ReloadContextResult> {
  const previousSignature = kuzuGraphSignature;

  if (force || kuzuConnection) {
    await closeKuzuResources();
  }

  kuzuInitError = null;
  kuzuLastInitAttemptAt = 0;

  const nextConnection = await getKuzuConnection(true);
  const currentSignature = readGraphSignature();

  return {
    forced: force,
    reloaded: nextConnection !== null,
    context_source: nextConnection ? "kuzu" : "cache",
    previous_graph_signature: previousSignature,
    current_graph_signature: currentSignature,
    warning: nextConnection ? undefined : kuzuInitError ?? buildMissingDbMessage()
  };
}
