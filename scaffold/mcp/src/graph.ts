import fs from "node:fs";
import path from "node:path";
import ryugraph, { type Connection, type Database, type QueryResult } from "ryugraph";
import { readJsonl, asString, asNumber, asBoolean } from "./jsonl.js";
import { DB_PATH, DEFAULT_RANKING, PATHS } from "./paths.js";
import type {
  AdrRecord,
  ChunkRecord,
  ContextData,
  DocumentRecord,
  JsonObject,
  ModuleRecord,
  ProjectRecord,
  RankingWeights,
  RelationRecord,
  RelationType,
  RuleRecord,
  UnknownRow
} from "./types.js";

export type ReloadContextResult = {
  forced: boolean;
  reloaded: boolean;
  context_source: "ryu" | "cache";
  previous_graph_signature: string | null;
  current_graph_signature: string | null;
  warning?: string;
};

let ryuDb: Database | null = null;
let ryuConnection: Connection | null = null;
let ryuInitError: string | null = null;
let ryuLastInitAttemptAt = 0;
let ryuGraphSignature: string | null = null;

const RYU_INIT_RETRY_INTERVAL_MS = 2000;
const REQUIRED_GRAPH_MANIFEST_COUNT_KEYS = [
  "files",
  "rules",
  "adrs",
  "chunks",
  "constrains",
  "implements",
  "supersedes",
  "defines",
  "calls",
  "imports",
  "calls_sql",
  "uses_config_key",
  "uses_resource_key",
  "uses_setting_key",
  "modules",
  "projects",
  "contains",
  "contains_module",
  "exports",
  "includes_file",
  "references_project",
  "uses_resource",
  "uses_setting",
  "uses_config",
  "transforms_config"
] as const;

function readFileIfExists(filePath: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, "utf8");
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

function parseChunkEntities(raw: JsonObject[]): ChunkRecord[] {
  return raw
    .map((item) => {
      const id = asString(item.id);
      if (!id) {
        return null;
      }

      return {
        id,
        file_id: asString(item.file_id),
        name: asString(item.name),
        kind: asString(item.kind, "chunk"),
        signature: asString(item.signature),
        body: asString(item.body),
        description: asString(item.description),
        start_line: asNumber(item.start_line),
        end_line: asNumber(item.end_line),
        language: asString(item.language),
        exported: asBoolean(item.exported, false),
        updated_at: asString(item.updated_at),
        source_of_truth: asBoolean(item.source_of_truth, false),
        trust_level: asNumber(item.trust_level, 60),
        status: asString(item.status, "active")
      };
    })
    .filter((item): item is ChunkRecord => item !== null);
}

function parseModuleEntities(raw: JsonObject[]): ModuleRecord[] {
  return raw
    .map((item) => {
      const id = asString(item.id);
      if (!id) {
        return null;
      }

      return {
        id,
        path: asString(item.path),
        name: asString(item.name),
        summary: asString(item.summary),
        file_count: asNumber(item.file_count, 0),
        exported_symbols: asString(item.exported_symbols),
        updated_at: asString(item.updated_at),
        source_of_truth: asBoolean(item.source_of_truth, false),
        trust_level: asNumber(item.trust_level, 75),
        status: asString(item.status, "active")
      };
    })
    .filter((item): item is ModuleRecord => item !== null);
}

function parseProjectEntities(raw: JsonObject[]): ProjectRecord[] {
  return raw
    .map((item) => {
      const id = asString(item.id);
      if (!id) {
        return null;
      }

      return {
        id,
        path: asString(item.path),
        name: asString(item.name),
        kind: asString(item.kind, "project"),
        language: asString(item.language, "dotnet"),
        target_framework: asString(item.target_framework),
        summary: asString(item.summary),
        file_count: asNumber(item.file_count, 0),
        updated_at: asString(item.updated_at),
        source_of_truth: asBoolean(item.source_of_truth, false),
        trust_level: asNumber(item.trust_level, 80),
        status: asString(item.status, "active")
      };
    })
    .filter((item): item is ProjectRecord => item !== null);
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

function parseRelations(
  raw: JsonObject[],
  relation: RelationType,
  noteFields: string[] = ["note", "reason"]
): RelationRecord[] {
  return raw
    .map((item) => {
      const from = asString(item.from);
      const to = asString(item.to);
      if (!from || !to) {
        return null;
      }

      let note = "";
      for (const fieldName of noteFields) {
        const candidate = asString(item[fieldName]);
        if (candidate) {
          note = candidate;
          break;
        }
      }

      return {
        from,
        to,
        relation,
        note
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
    return `RyuGraph directory missing at ${dbDir}. Run ${bootstrapCommand}.`;
  }

  return `RyuGraph DB not found at ${DB_PATH}. Run ${loadCommand} (or ${bootstrapCommand} on cold start).`;
}

function buildIncompatibleGraphMessage(missingKeys: string[]): string {
  const loadCommand = "./scripts/context.sh graph-load";
  const missing = missingKeys.join(", ");
  return `RyuGraph manifest is missing schema keys (${missing}). Run ${loadCommand} to rebuild the graph DB.`;
}

function readGraphManifestMissingKeys(): string[] {
  if (!fs.existsSync(PATHS.graphManifest)) {
    return [...REQUIRED_GRAPH_MANIFEST_COUNT_KEYS];
  }

  try {
    const raw = JSON.parse(fs.readFileSync(PATHS.graphManifest, "utf8")) as {
      counts?: Record<string, unknown>;
    };
    const counts = raw.counts ?? {};
    return REQUIRED_GRAPH_MANIFEST_COUNT_KEYS.filter((key) => !(key in counts));
  } catch {
    return [...REQUIRED_GRAPH_MANIFEST_COUNT_KEYS];
  }
}

async function closeRyuGraphResources(): Promise<void> {
  const currentConnection = ryuConnection;
  const currentDb = ryuDb;

  ryuConnection = null;
  ryuDb = null;
  ryuGraphSignature = null;

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

async function resetRyuGraphState(errorMessage: string): Promise<void> {
  ryuInitError = errorMessage;
  await closeRyuGraphResources();
}

async function getRyuGraphConnection(forceReload = false): Promise<Connection | null> {
  const diskSignature = readGraphSignature();

  if (ryuConnection) {
    if (forceReload) {
      await closeRyuGraphResources();
      ryuLastInitAttemptAt = 0;
    } else if (diskSignature && ryuGraphSignature && diskSignature === ryuGraphSignature) {
      return ryuConnection;
    } else {
      await resetRyuGraphState("RyuGraph graph changed on disk; reconnecting.");
      ryuLastInitAttemptAt = 0;
    }
  }

  const now = Date.now();
  if (!forceReload && now - ryuLastInitAttemptAt < RYU_INIT_RETRY_INTERVAL_MS) {
    return null;
  }
  ryuLastInitAttemptAt = now;

  if (!diskSignature) {
    await resetRyuGraphState(buildMissingDbMessage());
    return null;
  }

  const missingManifestKeys = readGraphManifestMissingKeys();
  if (missingManifestKeys.length > 0) {
    await resetRyuGraphState(buildIncompatibleGraphMessage(missingManifestKeys));
    return null;
  }

  try {
    const nextDb = new ryugraph.Database(DB_PATH, undefined, undefined, true);
    const nextConnection = new ryugraph.Connection(nextDb);
    await nextDb.init();
    await nextConnection.init();
    ryuDb = nextDb;
    ryuConnection = nextConnection;
    ryuGraphSignature = readGraphSignature() ?? diskSignature;
    ryuInitError = null;
    return nextConnection;
  } catch (error) {
    await resetRyuGraphState(error instanceof Error ? error.message : "Failed to initialize RyuGraph");
    return null;
  }
}

function parseRyuGraphDocuments(rows: UnknownRow[], contentById: Map<string, string>): DocumentRecord[] {
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

function parseRyuGraphRules(rows: UnknownRow[]): RuleRecord[] {
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

function parseRyuGraphAdrs(rows: UnknownRow[]): AdrRecord[] {
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

function parseRyuGraphChunks(rows: UnknownRow[]): ChunkRecord[] {
  return rows
    .map((row) => {
      const id = asStringUnknown(row.id);
      if (!id) {
        return null;
      }

      return {
        id,
        file_id: asStringUnknown(row.file_id),
        name: asStringUnknown(row.name),
        kind: asStringUnknown(row.kind, "chunk"),
        signature: asStringUnknown(row.signature),
        body: asStringUnknown(row.body),
        description: asStringUnknown(row.description),
        start_line: asNumberUnknown(row.start_line),
        end_line: asNumberUnknown(row.end_line),
        language: asStringUnknown(row.language),
        exported: asBooleanUnknown(row.exported, false),
        updated_at: asStringUnknown(row.updated_at),
        source_of_truth: asBooleanUnknown(row.source_of_truth, false),
        trust_level: asNumberUnknown(row.trust_level, 60),
        status: asStringUnknown(row.status, "active")
      };
    })
    .filter((value): value is ChunkRecord => value !== null);
}

function parseRyuGraphModules(rows: UnknownRow[]): ModuleRecord[] {
  return rows
    .map((row) => {
      const id = asStringUnknown(row.id);
      if (!id) {
        return null;
      }

      return {
        id,
        path: asStringUnknown(row.path),
        name: asStringUnknown(row.name),
        summary: asStringUnknown(row.summary),
        file_count: asNumberUnknown(row.file_count, 0),
        exported_symbols: asStringUnknown(row.exported_symbols),
        updated_at: asStringUnknown(row.updated_at),
        source_of_truth: asBooleanUnknown(row.source_of_truth, false),
        trust_level: asNumberUnknown(row.trust_level, 75),
        status: asStringUnknown(row.status, "active")
      };
    })
    .filter((value): value is ModuleRecord => value !== null);
}

function parseRyuGraphProjects(rows: UnknownRow[]): ProjectRecord[] {
  return rows
    .map((row) => {
      const id = asStringUnknown(row.id);
      if (!id) {
        return null;
      }

      return {
        id,
        path: asStringUnknown(row.path),
        name: asStringUnknown(row.name),
        kind: asStringUnknown(row.kind, "project"),
        language: asStringUnknown(row.language, "dotnet"),
        target_framework: asStringUnknown(row.target_framework),
        summary: asStringUnknown(row.summary),
        file_count: asNumberUnknown(row.file_count, 0),
        updated_at: asStringUnknown(row.updated_at),
        source_of_truth: asBooleanUnknown(row.source_of_truth, false),
        trust_level: asNumberUnknown(row.trust_level, 80),
        status: asStringUnknown(row.status, "active")
      };
    })
    .filter((value): value is ProjectRecord => value !== null);
}

function parseRyuGraphRelations(
  rows: UnknownRow[],
  relation: RelationType,
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
  const cachedChunks = parseChunkEntities(readJsonl(PATHS.chunkEntities));
  const cachedModules = parseModuleEntities(readJsonl(PATHS.moduleEntities));
  const cachedProjects = parseProjectEntities(readJsonl(PATHS.projectEntities));
  const cachedChunkRelations = [
    ...parseRelations(readJsonl(PATHS.definesRelations), "DEFINES"),
    ...parseRelations(readJsonl(PATHS.callsRelations), "CALLS", ["call_type"]),
    ...parseRelations(readJsonl(PATHS.importsRelations), "IMPORTS", ["import_name"]),
    ...parseRelations(readJsonl(PATHS.callsSqlRelations), "CALLS_SQL"),
    ...parseRelations(readJsonl(PATHS.usesConfigKeyRelations), "USES_CONFIG_KEY"),
    ...parseRelations(readJsonl(PATHS.usesResourceKeyRelations), "USES_RESOURCE_KEY"),
    ...parseRelations(readJsonl(PATHS.usesSettingKeyRelations), "USES_SETTING_KEY")
  ];
  const cachedModuleRelations = [
    ...parseRelations(readJsonl(PATHS.containsRelations), "CONTAINS"),
    ...parseRelations(readJsonl(PATHS.containsModuleRelations), "CONTAINS_MODULE"),
    ...parseRelations(readJsonl(PATHS.exportsRelations), "EXPORTS")
  ];
  const cachedProjectRelations = [
    ...parseRelations(readJsonl(PATHS.includesFileRelations), "INCLUDES_FILE"),
    ...parseRelations(readJsonl(PATHS.referencesProjectRelations), "REFERENCES_PROJECT"),
    ...parseRelations(readJsonl(PATHS.usesResourceRelations), "USES_RESOURCE"),
    ...parseRelations(readJsonl(PATHS.usesSettingRelations), "USES_SETTING"),
    ...parseRelations(readJsonl(PATHS.usesConfigRelations), "USES_CONFIG"),
    ...parseRelations(readJsonl(PATHS.transformsConfigRelations), "TRANSFORMS_CONFIG")
  ];
  const cachedRelations = [
    ...parseRelations(readJsonl(PATHS.constrainsRelations), "CONSTRAINS"),
    ...parseRelations(readJsonl(PATHS.implementsRelations), "IMPLEMENTS"),
    ...parseRelations(readJsonl(PATHS.supersedesRelations), "SUPERSEDES"),
    ...cachedChunkRelations,
    ...cachedModuleRelations,
    ...cachedProjectRelations
  ];

  const yamlRules = parseRulesYaml(readFileIfExists(PATHS.rulesYaml));
  const entityRules = parseRuleEntities(readJsonl(PATHS.ruleEntities));
  const cachedRules = yamlRules.length > 0 ? yamlRules : entityRules;

  const connection = await getRyuGraphConnection();
  if (!connection) {
    return {
      documents: cachedDocuments,
      adrs: cachedAdrs,
      rules: cachedRules,
      chunks: cachedChunks,
      modules: cachedModules,
      projects: cachedProjects,
      relations: cachedRelations,
      ranking,
      source: "cache",
      warning: ryuInitError ?? "RyuGraph DB is not loaded yet."
    };
  }

  try {
    const ryuQueries = await Promise.all([
      queryRows(connection, `MATCH (f:File) RETURN f.id AS id, f.path AS path, f.kind AS kind, f.excerpt AS excerpt, f.updated_at AS updated_at, f.source_of_truth AS source_of_truth, f.trust_level AS trust_level, f.status AS status;`),
      queryRows(connection, `MATCH (r:Rule) RETURN r.id AS id, r.title AS title, r.body AS body, r.scope AS scope, r.priority AS priority, r.updated_at AS updated_at, r.source_of_truth AS source_of_truth, r.trust_level AS trust_level, r.status AS status;`),
      queryRows(connection, `MATCH (a:ADR) RETURN a.id AS id, a.path AS path, a.title AS title, a.body AS body, a.decision_date AS decision_date, a.supersedes_id AS supersedes_id, a.source_of_truth AS source_of_truth, a.trust_level AS trust_level, a.status AS status;`),
      queryRows(connection, `MATCH (c:Chunk) RETURN c.id AS id, c.file_id AS file_id, c.name AS name, c.kind AS kind, c.signature AS signature, c.body AS body, c.description AS description, c.start_line AS start_line, c.end_line AS end_line, c.language AS language, c.exported AS exported, c.updated_at AS updated_at, c.source_of_truth AS source_of_truth, c.trust_level AS trust_level, c.status AS status;`),
      queryRows(connection, `MATCH (m:Module) RETURN m.id AS id, m.path AS path, m.name AS name, m.summary AS summary, m.file_count AS file_count, m.exported_symbols AS exported_symbols, m.updated_at AS updated_at, m.source_of_truth AS source_of_truth, m.trust_level AS trust_level, m.status AS status;`),
      queryRows(connection, `MATCH (p:Project) RETURN p.id AS id, p.path AS path, p.name AS name, p.kind AS kind, p.language AS language, p.target_framework AS target_framework, p.summary AS summary, p.file_count AS file_count, p.updated_at AS updated_at, p.source_of_truth AS source_of_truth, p.trust_level AS trust_level, p.status AS status;`),
      queryRows(connection, `MATCH (r:Rule)-[c:CONSTRAINS]->(f:File) RETURN r.id AS from, f.id AS to, c.note AS note;`),
      queryRows(connection, `MATCH (f:File)-[i:IMPLEMENTS]->(r:Rule) RETURN f.id AS from, r.id AS to, i.note AS note;`),
      queryRows(connection, `MATCH (a1:ADR)-[s:SUPERSEDES]->(a2:ADR) RETURN a1.id AS from, a2.id AS to, s.reason AS note;`),
      queryRows(connection, `MATCH (f:File)-[:DEFINES]->(c:Chunk) RETURN f.id AS from, c.id AS to;`),
      queryRows(connection, `MATCH (c1:Chunk)-[ca:CALLS]->(c2:Chunk) RETURN c1.id AS from, c2.id AS to, ca.call_type AS call_type;`),
      queryRows(connection, `MATCH (c:Chunk)-[im:IMPORTS]->(f:File) RETURN c.id AS from, f.id AS to, im.import_name AS import_name;`),
      queryRows(connection, `MATCH (f:File)-[cs:CALLS_SQL]->(c:Chunk) RETURN f.id AS from, c.id AS to, cs.note AS note;`),
      queryRows(connection, `MATCH (f:File)-[uck:USES_CONFIG_KEY]->(c:Chunk) RETURN f.id AS from, c.id AS to, uck.note AS note;`),
      queryRows(connection, `MATCH (f:File)-[urk:USES_RESOURCE_KEY]->(c:Chunk) RETURN f.id AS from, c.id AS to, urk.note AS note;`),
      queryRows(connection, `MATCH (f:File)-[usk:USES_SETTING_KEY]->(c:Chunk) RETURN f.id AS from, c.id AS to, usk.note AS note;`),
      queryRows(connection, `MATCH (m:Module)-[:CONTAINS]->(f:File) RETURN m.id AS from, f.id AS to;`),
      queryRows(connection, `MATCH (m1:Module)-[:CONTAINS_MODULE]->(m2:Module) RETURN m1.id AS from, m2.id AS to;`),
      queryRows(connection, `MATCH (m:Module)-[:EXPORTS]->(c:Chunk) RETURN m.id AS from, c.id AS to;`),
      queryRows(connection, `MATCH (p:Project)-[:INCLUDES_FILE]->(f:File) RETURN p.id AS from, f.id AS to;`),
      queryRows(connection, `MATCH (p1:Project)-[rp:REFERENCES_PROJECT]->(p2:Project) RETURN p1.id AS from, p2.id AS to, rp.note AS note;`),
      queryRows(connection, `MATCH (f1:File)-[ur:USES_RESOURCE]->(f2:File) RETURN f1.id AS from, f2.id AS to, ur.note AS note;`),
      queryRows(connection, `MATCH (f1:File)-[us:USES_SETTING]->(f2:File) RETURN f1.id AS from, f2.id AS to, us.note AS note;`),
      queryRows(connection, `MATCH (f1:File)-[uc:USES_CONFIG]->(f2:File) RETURN f1.id AS from, f2.id AS to, uc.note AS note;`),
      queryRows(connection, `MATCH (f1:File)-[tc:TRANSFORMS_CONFIG]->(f2:File) RETURN f1.id AS from, f2.id AS to, tc.note AS note;`)
    ]);

    // Named destructuring to avoid positional misalignment with 14 parallel queries
    const [
      fileRows, ruleRows, adrRows, chunkRows, moduleRows, projectRows, // entities
      constrainsRows, implementsRows, supersedesRows,               // core relations
      definesRows, callsRows, importsRows, callsSqlRows, usesConfigKeyRows, usesResourceKeyRows, usesSettingKeyRows, // chunk relations
      containsRows, containsModuleRows, exportsRows,                // module relations
      includesFileRows, referencesProjectRows, usesResourceRows, usesSettingRows, usesConfigRows, transformsConfigRows // project/file relations
    ] = ryuQueries;

    const contentById = new Map(cachedDocuments.map((doc) => [doc.id, doc.content]));

    const ryuDocuments = parseRyuGraphDocuments(fileRows, contentById);
    const ryuRules = parseRyuGraphRules(ruleRows);
    const ryuAdrs = parseRyuGraphAdrs(adrRows);
    const ryuChunks = parseRyuGraphChunks(chunkRows);
    const ryuModules = parseRyuGraphModules(moduleRows);
    const ryuProjects = parseRyuGraphProjects(projectRows);
    const ryuRelations = [
      ...parseRyuGraphRelations(constrainsRows, "CONSTRAINS", "note"),
      ...parseRyuGraphRelations(implementsRows, "IMPLEMENTS", "note"),
      ...parseRyuGraphRelations(supersedesRows, "SUPERSEDES", "note"),
      ...parseRyuGraphRelations(definesRows, "DEFINES", "note"),
      ...parseRyuGraphRelations(callsRows, "CALLS", "call_type"),
      ...parseRyuGraphRelations(importsRows, "IMPORTS", "import_name"),
      ...parseRyuGraphRelations(callsSqlRows, "CALLS_SQL", "note"),
      ...parseRyuGraphRelations(usesConfigKeyRows, "USES_CONFIG_KEY", "note"),
      ...parseRyuGraphRelations(usesResourceKeyRows, "USES_RESOURCE_KEY", "note"),
      ...parseRyuGraphRelations(usesSettingKeyRows, "USES_SETTING_KEY", "note"),
      ...parseRyuGraphRelations(containsRows, "CONTAINS", "note"),
      ...parseRyuGraphRelations(containsModuleRows, "CONTAINS_MODULE", "note"),
      ...parseRyuGraphRelations(exportsRows, "EXPORTS", "note"),
      ...parseRyuGraphRelations(includesFileRows, "INCLUDES_FILE", "note"),
      ...parseRyuGraphRelations(referencesProjectRows, "REFERENCES_PROJECT", "note"),
      ...parseRyuGraphRelations(usesResourceRows, "USES_RESOURCE", "note"),
      ...parseRyuGraphRelations(usesSettingRows, "USES_SETTING", "note"),
      ...parseRyuGraphRelations(usesConfigRows, "USES_CONFIG", "note"),
      ...parseRyuGraphRelations(transformsConfigRows, "TRANSFORMS_CONFIG", "note")
    ];

    return {
      documents: ryuDocuments.length > 0 ? ryuDocuments : cachedDocuments,
      adrs: ryuAdrs.length > 0 ? ryuAdrs : cachedAdrs,
      rules: ryuRules.length > 0 ? ryuRules : cachedRules,
      chunks: ryuChunks.length > 0 ? ryuChunks : cachedChunks,
      modules: ryuModules.length > 0 ? ryuModules : cachedModules,
      projects: ryuProjects.length > 0 ? ryuProjects : cachedProjects,
      // Ryu now queries all relation types (core + chunk + module), so no need
      // to merge cached chunk/module relations separately.
      relations: ryuRelations.length > 0 ? ryuRelations : cachedRelations,
      ranking,
      source: "ryu"
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? `RyuGraph query failed, using cache fallback: ${error.message}`
        : "RyuGraph query failed, using cache fallback.";
    await resetRyuGraphState(message);
    return {
      documents: cachedDocuments,
      adrs: cachedAdrs,
      rules: cachedRules,
      chunks: cachedChunks,
      modules: cachedModules,
      projects: cachedProjects,
      relations: cachedRelations,
      ranking,
      source: "cache",
      warning: message
    };
  }
}

export async function reloadContextGraph(force = true): Promise<ReloadContextResult> {
  const previousSignature = ryuGraphSignature;

  if (force || ryuConnection) {
    await closeRyuGraphResources();
  }

  ryuInitError = null;
  ryuLastInitAttemptAt = 0;

  const nextConnection = await getRyuGraphConnection(true);
  const currentSignature = readGraphSignature();

  return {
    forced: force,
    reloaded: nextConnection !== null,
    context_source: nextConnection ? "ryu" : "cache",
    previous_graph_signature: previousSignature,
    current_graph_signature: currentSignature,
    warning: nextConnection ? undefined : ryuInitError ?? buildMissingDbMessage()
  };
}
