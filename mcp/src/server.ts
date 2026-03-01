import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import kuzu, { type Connection, type Database, type QueryResult } from "kuzu";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const CONTEXT_DIR = path.join(REPO_ROOT, ".context");
const CACHE_DIR = path.join(CONTEXT_DIR, "cache");
const DB_PATH = path.join(CONTEXT_DIR, "db", "graph.kuzu");

const PATHS = {
  config: path.join(CONTEXT_DIR, "config.yaml"),
  rulesYaml: path.join(CONTEXT_DIR, "rules.yaml"),
  graphManifest: path.join(CACHE_DIR, "graph-manifest.json"),
  documents: path.join(CACHE_DIR, "documents.jsonl"),
  adrEntities: path.join(CACHE_DIR, "entities.adr.jsonl"),
  ruleEntities: path.join(CACHE_DIR, "entities.rule.jsonl"),
  constrainsRelations: path.join(CACHE_DIR, "relations.constrains.jsonl"),
  implementsRelations: path.join(CACHE_DIR, "relations.implements.jsonl"),
  supersedesRelations: path.join(CACHE_DIR, "relations.supersedes.jsonl")
};

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };
type UnknownRow = Record<string, unknown>;

type DocumentRecord = {
  id: string;
  path: string;
  kind: "DOC" | "CODE" | "ADR";
  updated_at: string;
  source_of_truth: boolean;
  trust_level: number;
  status: string;
  excerpt: string;
  content: string;
};

type RuleRecord = {
  id: string;
  title: string;
  body: string;
  scope: string;
  updated_at: string;
  source_of_truth: boolean;
  trust_level: number;
  status: string;
  priority: number;
};

type AdrRecord = {
  id: string;
  path: string;
  title: string;
  body: string;
  decision_date: string;
  supersedes_id: string;
  source_of_truth: boolean;
  trust_level: number;
  status: string;
};

type RelationRecord = {
  from: string;
  to: string;
  relation: "CONSTRAINS" | "IMPLEMENTS" | "SUPERSEDES";
  note: string;
};

type RankingWeights = {
  semantic: number;
  graph: number;
  trust: number;
  recency: number;
};

type ContextData = {
  documents: DocumentRecord[];
  adrs: AdrRecord[];
  rules: RuleRecord[];
  relations: RelationRecord[];
  ranking: RankingWeights;
  source: "cache" | "kuzu";
  warning?: string;
};

const DEFAULT_RANKING: RankingWeights = {
  semantic: 0.4,
  graph: 0.25,
  trust: 0.2,
  recency: 0.15
};

const SearchInput = z.object({
  query: z.string().min(1),
  top_k: z.number().int().positive().max(20).default(5),
  include_deprecated: z.boolean().default(false),
  include_content: z.boolean().default(false)
});

const RelatedInput = z.object({
  entity_id: z.string().min(1),
  depth: z.number().int().positive().max(3).default(1),
  include_edges: z.boolean().default(true)
});

const RulesInput = z.object({
  scope: z.string().optional(),
  include_inactive: z.boolean().default(false)
});

const ReloadInput = z.object({
  force: z.boolean().default(true)
});

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
    await resetKuzuState(`Kuzu DB not found at ${DB_PATH}`);
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

async function loadContextData(): Promise<ContextData> {
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

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function daysSince(isoDate: string): number {
  const timestamp = Date.parse(isoDate);
  if (Number.isNaN(timestamp)) {
    return 3650;
  }

  const now = Date.now();
  return Math.max(0, (now - timestamp) / (1000 * 60 * 60 * 24));
}

function recencyScore(isoDate: string): number {
  const days = daysSince(isoDate);
  return 1 / (1 + days / 30);
}

function semanticScore(query: string, text: string): number {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return 0;
  }

  const haystack = text.toLowerCase();
  let matched = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) {
      matched += 1;
    }
  }

  const overlap = matched / queryTokens.length;
  const phraseBonus = haystack.includes(query.toLowerCase()) ? 0.25 : 0;
  return Math.min(1, overlap * 0.85 + phraseBonus);
}

function groupRuleLinks(relations: RelationRecord[]): Map<string, string[]> {
  const links = new Map<string, string[]>();
  for (const relation of relations) {
    if (relation.relation !== "CONSTRAINS" && relation.relation !== "IMPLEMENTS") {
      continue;
    }

    if (relation.relation === "CONSTRAINS") {
      const list = links.get(relation.to) ?? [];
      list.push(relation.from);
      links.set(relation.to, list);
    } else {
      const list = links.get(relation.from) ?? [];
      list.push(relation.to);
      links.set(relation.from, list);
    }
  }
  return links;
}

function entityCatalog(data: ContextData): Map<string, JsonObject> {
  const catalog = new Map<string, JsonObject>();

  for (const file of data.documents) {
    catalog.set(file.id, {
      id: file.id,
      type: "File",
      label: file.path,
      status: file.status,
      source_of_truth: file.source_of_truth
    });
  }

  for (const rule of data.rules) {
    catalog.set(rule.id, {
      id: rule.id,
      type: "Rule",
      label: rule.title,
      status: rule.status,
      source_of_truth: rule.source_of_truth
    });
  }

  for (const adr of data.adrs) {
    catalog.set(adr.id, {
      id: adr.id,
      type: "ADR",
      label: adr.title || adr.id,
      status: adr.status,
      source_of_truth: adr.source_of_truth
    });
  }

  return catalog;
}

type ToolPayload = Record<string, unknown>;

function buildToolResult(data: ToolPayload) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2)
      }
    ],
    structuredContent: data
  };
}

async function runContextSearch(input: unknown): Promise<ToolPayload> {
  const parsed = SearchInput.parse(input ?? {});
  const data = await loadContextData();
  const ruleLinks = groupRuleLinks(data.relations);

  const results = data.documents
    .filter((doc) => parsed.include_deprecated || doc.status.toLowerCase() !== "deprecated")
    .map((doc) => {
      const text = `${doc.path}\n${doc.excerpt}\n${doc.content}`;
      const semScore = semanticScore(parsed.query, text);
      const graphScore = Math.min(1, (ruleLinks.get(doc.id)?.length ?? 0) / 3);
      const trustScore = Math.max(0, Math.min(1, doc.trust_level / 100));
      const dateScore = recencyScore(doc.updated_at);

      let score = 0;
      score += data.ranking.semantic * semScore;
      score += data.ranking.graph * graphScore;
      score += data.ranking.trust * trustScore;
      score += data.ranking.recency * dateScore;

      if (doc.source_of_truth) {
        score += 0.1;
      }

      return {
        id: doc.id,
        path: doc.path,
        kind: doc.kind,
        score: Number(score.toFixed(4)),
        source_of_truth: doc.source_of_truth,
        status: doc.status,
        updated_at: doc.updated_at,
        matched_rules: ruleLinks.get(doc.id) ?? [],
        excerpt: doc.excerpt,
        content: parsed.include_content ? doc.content : undefined
      };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, parsed.top_k);

  return {
    query: parsed.query,
    top_k: parsed.top_k,
    ranking: data.ranking,
    total_candidates: data.documents.length,
    context_source: data.source,
    warning: data.warning,
    results
  };
}

async function runContextRelated(input: unknown): Promise<ToolPayload> {
  const parsed = RelatedInput.parse(input ?? {});
  const data = await loadContextData();
  const catalog = entityCatalog(data);

  if (!catalog.has(parsed.entity_id)) {
    return {
      entity_id: parsed.entity_id,
      depth: parsed.depth,
      related: [],
      edges: [],
      context_source: data.source,
      warning: "Entity not found in indexed context."
    };
  }

  const outgoing = new Map<string, RelationRecord[]>();
  const incoming = new Map<string, RelationRecord[]>();

  for (const relation of data.relations) {
    const outList = outgoing.get(relation.from) ?? [];
    outList.push(relation);
    outgoing.set(relation.from, outList);

    const inList = incoming.get(relation.to) ?? [];
    inList.push(relation);
    incoming.set(relation.to, inList);
  }

  const seen = new Set<string>([parsed.entity_id]);
  const queue: Array<{ id: string; hop: number }> = [{ id: parsed.entity_id, hop: 0 }];
  const related: JsonObject[] = [];
  const traversedEdges: JsonObject[] = [];
  const traversedEdgeKeys = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift() as { id: string; hop: number };
    if (current.hop >= parsed.depth) {
      continue;
    }

    const neighbors = [
      ...(outgoing.get(current.id) ?? []).map((edge) => ({
        edge,
        next: edge.to,
        direction: "outgoing"
      })),
      ...(incoming.get(current.id) ?? []).map((edge) => ({
        edge,
        next: edge.from,
        direction: "incoming"
      }))
    ];

    for (const neighbor of neighbors) {
      const target = neighbor.next;
      if (!seen.has(target)) {
        seen.add(target);
        queue.push({ id: target, hop: current.hop + 1 });

        const entity = catalog.get(target) ?? {
          id: target,
          type: "Unknown",
          label: target,
          status: "unknown",
          source_of_truth: false
        };

        related.push({
          ...entity,
          hops: current.hop + 1,
          via_relation: neighbor.edge.relation,
          direction: neighbor.direction
        });
      }

      const edgeKey = `${neighbor.edge.from}|${neighbor.edge.relation}|${neighbor.edge.to}|${neighbor.edge.note}`;
      if (!traversedEdgeKeys.has(edgeKey)) {
        traversedEdgeKeys.add(edgeKey);
        traversedEdges.push({
          from: neighbor.edge.from,
          to: neighbor.edge.to,
          relation: neighbor.edge.relation,
          note: neighbor.edge.note
        });
      }
    }
  }

  return {
    entity_id: parsed.entity_id,
    depth: parsed.depth,
    context_source: data.source,
    warning: data.warning,
    related,
    edges: parsed.include_edges ? traversedEdges : []
  };
}

async function runContextRules(input: unknown): Promise<ToolPayload> {
  const parsed = RulesInput.parse(input ?? {});
  const data = await loadContextData();

  const rules = data.rules
    .filter((rule) => parsed.include_inactive || rule.status === "active")
    .filter((rule) => !parsed.scope || rule.scope === parsed.scope || rule.scope === "global")
    .sort((a, b) => b.priority - a.priority)
    .map((rule) => ({
      id: rule.id,
      title: rule.title,
      description: rule.body,
      priority: rule.priority,
      scope: rule.scope,
      status: rule.status
    }));

  return {
    scope: parsed.scope ?? "global",
    count: rules.length,
    context_source: data.source,
    warning: data.warning,
    rules
  };
}

async function runContextReload(input: unknown): Promise<ToolPayload> {
  const parsed = ReloadInput.parse(input ?? {});
  const previousSignature = kuzuGraphSignature;

  if (parsed.force || kuzuConnection) {
    await closeKuzuResources();
  }

  kuzuInitError = null;
  kuzuLastInitAttemptAt = 0;

  const nextConnection = await getKuzuConnection(true);
  const currentSignature = readGraphSignature();

  return {
    forced: parsed.force,
    reloaded: nextConnection !== null,
    context_source: nextConnection ? "kuzu" : "cache",
    previous_graph_signature: previousSignature,
    current_graph_signature: currentSignature,
    warning: nextConnection ? undefined : kuzuInitError ?? "Kuzu DB is not loaded yet."
  };
}

function registerTools(server: McpServer): void {
  server.registerTool(
    "context.search",
    {
      description: "Search ranked context documents and code using semantic, graph and trust weighting.",
      inputSchema: SearchInput
    },
    async (input) => buildToolResult(await runContextSearch(input))
  );

  server.registerTool(
    "context.get_related",
    {
      description: "Return related entities and graph edges for a context entity id.",
      inputSchema: RelatedInput
    },
    async (input) => buildToolResult(await runContextRelated(input))
  );

  server.registerTool(
    "context.get_rules",
    {
      description: "List indexed rules filtered by scope and active status.",
      inputSchema: RulesInput.optional()
    },
    async (input) => buildToolResult(await runContextRules(input))
  );

  server.registerTool(
    "context.reload",
    {
      description: "Reload Kuzu graph connection after graph updates or maintenance.",
      inputSchema: ReloadInput.optional()
    },
    async (input) => buildToolResult(await runContextReload(input))
  );
}

async function main(): Promise<void> {
  const server = new McpServer({
    name: "cortex-context",
    version: "0.1.0"
  });

  registerTools(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Fatal error"}\n`);
  process.exit(1);
});
