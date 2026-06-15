import fs from "node:fs";
import path from "node:path";
import ryugraph, { type Connection, type PreparedStatement, type QueryResult, type RyuValue } from "ryugraph";
import { readJsonl, asString, asNumber, asBoolean } from "./jsonl.js";
import { CACHE_DIR, CONTEXT_DIR, DB_PATH } from "./paths.js";
import { CSV_COPY_OPTIONS, writeCsv, toCopyPathLiteral, type CsvValue } from "./graphCsv.js";
import type { JsonObject } from "./types.js";

const ONTOLOGY_PATH = path.join(CONTEXT_DIR, "ontology.cypher");
const GRAPH_IMPORT_DIR = path.join(CACHE_DIR, "graph-import");
const BATCH_SIZE = 50;

async function executeBatch(
  conn: Connection,
  statement: PreparedStatement,
  items: Record<string, RyuValue>[],
  batchSize = BATCH_SIZE
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map((item) => conn.execute(statement, item)));
  }
}

type FileEntity = {
  id: string;
  path: string;
  kind: string;
  excerpt: string;
  checksum: string;
  updated_at: string;
  source_of_truth: boolean;
  trust_level: number;
  status: string;
};

type RuleEntity = {
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

type AdrEntity = {
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

type ChunkEntity = {
  id: string;
  file_id: string;
  name: string;
  kind: string;
  signature: string;
  body: string;
  description: string;
  start_line: number;
  end_line: number;
  language: string;
  exported: boolean;
  checksum: string;
  updated_at: string;
  source_of_truth: boolean;
  trust_level: number;
  status: string;
};

type ModuleEntity = {
  id: string;
  path: string;
  name: string;
  summary: string;
  file_count: number;
  exported_symbols: string;
  updated_at: string;
  source_of_truth: boolean;
  trust_level: number;
  status: string;
};

type ProjectEntity = {
  id: string;
  path: string;
  name: string;
  kind: string;
  language: string;
  target_framework: string;
  summary: string;
  file_count: number;
  updated_at: string;
  source_of_truth: boolean;
  trust_level: number;
  status: string;
};

type Relation = {
  from: string;
  to: string;
  note: string;
};

type CallRelation = {
  from: string;
  to: string;
  call_type: string;
};

type ImportRelation = {
  from: string;
  to: string;
  import_name: string;
};

function readEntityFile(fileName: string): JsonObject[] {
  return readJsonl(path.join(CACHE_DIR, fileName));
}

function parseFiles(raw: JsonObject[]): FileEntity[] {
  return raw
    .map((item) => {
      const id = asString(item.id);
      const filePath = asString(item.path);
      if (!id || !filePath) {
        return null;
      }

      return {
        id,
        path: filePath,
        kind: asString(item.kind, "DOC"),
        excerpt: asString(item.excerpt),
        checksum: asString(item.checksum),
        updated_at: asString(item.updated_at),
        source_of_truth: asBoolean(item.source_of_truth, false),
        trust_level: asNumber(item.trust_level, 50),
        status: asString(item.status, "active")
      };
    })
    .filter((value): value is FileEntity => value !== null);
}

function parseRules(raw: JsonObject[]): RuleEntity[] {
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
        updated_at: asString(item.updated_at),
        source_of_truth: asBoolean(item.source_of_truth, true),
        trust_level: asNumber(item.trust_level, 95),
        status: asString(item.status, "active"),
        priority: asNumber(item.priority, 0)
      };
    })
    .filter((value): value is RuleEntity => value !== null);
}

function parseAdrs(raw: JsonObject[]): AdrEntity[] {
  return raw
    .map((item) => {
      const id = asString(item.id);
      if (!id) {
        return null;
      }

      return {
        id,
        path: asString(item.path),
        title: asString(item.title, id),
        body: asString(item.body),
        decision_date: asString(item.decision_date),
        supersedes_id: asString(item.supersedes_id),
        source_of_truth: asBoolean(item.source_of_truth, true),
        trust_level: asNumber(item.trust_level, 95),
        status: asString(item.status, "active")
      };
    })
    .filter((value): value is AdrEntity => value !== null);
}

function parseChunks(raw: JsonObject[]): ChunkEntity[] {
  return raw
    .map((item) => {
      const id = asString(item.id);
      const file_id = asString(item.file_id);
      const name = asString(item.name);
      if (!id || !file_id || !name) {
        return null;
      }

      return {
        id,
        file_id,
        name,
        kind: asString(item.kind, "function"),
        signature: asString(item.signature),
        body: asString(item.body),
        description: asString(item.description),
        start_line: asNumber(item.start_line, 0),
        end_line: asNumber(item.end_line, 0),
        language: asString(item.language, "javascript"),
        exported: asBoolean(item.exported, false),
        checksum: asString(item.checksum),
        updated_at: asString(item.updated_at),
        source_of_truth: asBoolean(item.source_of_truth, true),
        trust_level: asNumber(item.trust_level, 80),
        status: asString(item.status, "active")
      };
    })
    .filter((value): value is ChunkEntity => value !== null);
}

function parseModules(raw: JsonObject[]): ModuleEntity[] {
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
    .filter((value): value is ModuleEntity => value !== null);
}

function parseProjects(raw: JsonObject[]): ProjectEntity[] {
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
    .filter((value): value is ProjectEntity => value !== null);
}

function parseRelations(fileName: string, noteField: string): Relation[] {
  const raw = readEntityFile(fileName);
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
        note: asString(item[noteField as keyof JsonObject])
      };
    })
    .filter((value): value is Relation => value !== null);
}

function parseCallRelations(fileName: string): CallRelation[] {
  const raw = readEntityFile(fileName);
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
        call_type: asString(item.call_type, "direct")
      };
    })
    .filter((value): value is CallRelation => value !== null);
}

function parseImportRelations(fileName: string): ImportRelation[] {
  const raw = readEntityFile(fileName);
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
        import_name: asString(item.import_name, "")
      };
    })
    .filter((value): value is ImportRelation => value !== null);
}

function parseSimpleRelations(fileName: string): Relation[] {
  const raw = readEntityFile(fileName);
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
        note: ""
      };
    })
    .filter((value): value is Relation => value !== null);
}

async function rows(result: QueryResult | QueryResult[]): Promise<Record<string, unknown>[]> {
  const resolved = Array.isArray(result) ? result[result.length - 1] : result;
  return resolved.getAll();
}

function parseOntologyStatements(ontologyText: string): string[] {
  const withoutComments = ontologyText
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  return withoutComments
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => `${statement};`);
}

async function executeStatements(conn: Connection, statements: string[]): Promise<void> {
  for (const statement of statements) {
    await conn.query(statement);
  }
}

async function ensureRequiredFiles(): Promise<void> {
  const required = [
    path.join(CACHE_DIR, "entities.file.jsonl"),
    path.join(CACHE_DIR, "entities.rule.jsonl"),
    path.join(CACHE_DIR, "entities.adr.jsonl"),
    path.join(CACHE_DIR, "relations.constrains.jsonl"),
    path.join(CACHE_DIR, "relations.implements.jsonl"),
    path.join(CACHE_DIR, "relations.supersedes.jsonl"),
    ONTOLOGY_PATH
  ];

  for (const filePath of required) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing required file: ${filePath}`);
    }
  }
}

function warnIfOptionalFilesMissing(): void {
  const optionalFiles = [
    "entities.chunk.jsonl",
    "relations.defines.jsonl",
    "relations.calls.jsonl",
    "relations.calls_sql.jsonl",
    "relations.uses_config_key.jsonl",
    "relations.uses_resource_key.jsonl",
    "relations.uses_setting_key.jsonl",
    "relations.imports.jsonl",
    "entities.module.jsonl",
    "entities.project.jsonl",
    "relations.contains.jsonl",
    "relations.contains_module.jsonl",
    "relations.exports.jsonl",
    "relations.includes_file.jsonl",
    "relations.references_project.jsonl",
    "relations.uses_resource.jsonl",
    "relations.uses_setting.jsonl",
    "relations.uses_config.jsonl",
    "relations.transforms_config.jsonl"
  ];

  const missing = optionalFiles.filter((fileName) => !fs.existsSync(path.join(CACHE_DIR, fileName)));
  if (missing.length === 0) {
    return;
  }

  console.warn(
    `[graph-load] warning: missing optional files (${missing.join(", ")}); continuing without those nodes/relations`
  );
}

type GraphData = {
  fileEntities: FileEntity[];
  ruleEntities: RuleEntity[];
  adrEntities: AdrEntity[];
  chunkEntities: ChunkEntity[];
  moduleEntities: ModuleEntity[];
  projectEntities: ProjectEntity[];
  constrains: Relation[];
  implementsEdges: Relation[];
  supersedes: Relation[];
  defines: Relation[];
  calls: CallRelation[];
  callsSql: Relation[];
  usesConfigKey: Relation[];
  usesResourceKey: Relation[];
  usesSettingKey: Relation[];
  imports: ImportRelation[];
  contains: Relation[];
  containsModule: Relation[];
  exports: Relation[];
  includesFile: Relation[];
  referencesProject: Relation[];
  usesResource: Relation[];
  usesSetting: Relation[];
  usesConfig: Relation[];
  transformsConfig: Relation[];
};

function parseGraphData(): GraphData {
  return {
    fileEntities: parseFiles(readEntityFile("entities.file.jsonl")),
    ruleEntities: parseRules(readEntityFile("entities.rule.jsonl")),
    adrEntities: parseAdrs(readEntityFile("entities.adr.jsonl")),
    chunkEntities: parseChunks(readEntityFile("entities.chunk.jsonl")),
    moduleEntities: parseModules(readEntityFile("entities.module.jsonl")),
    projectEntities: parseProjects(readEntityFile("entities.project.jsonl")),
    constrains: parseRelations("relations.constrains.jsonl", "note"),
    implementsEdges: parseRelations("relations.implements.jsonl", "note"),
    supersedes: parseRelations("relations.supersedes.jsonl", "reason"),
    defines: parseSimpleRelations("relations.defines.jsonl"),
    calls: parseCallRelations("relations.calls.jsonl"),
    callsSql: parseRelations("relations.calls_sql.jsonl", "note"),
    usesConfigKey: parseRelations("relations.uses_config_key.jsonl", "note"),
    usesResourceKey: parseRelations("relations.uses_resource_key.jsonl", "note"),
    usesSettingKey: parseRelations("relations.uses_setting_key.jsonl", "note"),
    imports: parseImportRelations("relations.imports.jsonl"),
    contains: parseSimpleRelations("relations.contains.jsonl"),
    containsModule: parseSimpleRelations("relations.contains_module.jsonl"),
    exports: parseSimpleRelations("relations.exports.jsonl"),
    includesFile: parseSimpleRelations("relations.includes_file.jsonl"),
    referencesProject: parseRelations("relations.references_project.jsonl", "note"),
    usesResource: parseRelations("relations.uses_resource.jsonl", "note"),
    usesSetting: parseRelations("relations.uses_setting.jsonl", "note"),
    usesConfig: parseRelations("relations.uses_config.jsonl", "note"),
    transformsConfig: parseRelations("relations.transforms_config.jsonl", "note")
  };
}

// Mirror the MATCH (...)-CREATE skip semantics of the prepared-statement
// loader: an edge whose endpoint node was never created is silently dropped.
// COPY into a rel table instead errors on an unknown primary key, so edges
// must be pre-filtered against the node-id sets to stay byte-identical.
function filterEdges<T extends { from: string; to: string }>(
  edges: T[],
  fromSet: Set<string>,
  toSet: Set<string>
): T[] {
  return edges.filter((edge) => fromSet.has(edge.from) && toSet.has(edge.to));
}

async function copyTable(
  conn: Connection,
  table: string,
  header: string[],
  rows: CsvValue[][]
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  const csvPath = path.join(GRAPH_IMPORT_DIR, `${table}.csv`);
  writeCsv(csvPath, header, rows);
  // ryugraph parses COPY's path as a double-quoted literal; toCopyPathLiteral
  // normalizes separators and escapes any embedded quote so a repo/cache path
  // containing a double quote still bulk-loads instead of falling back.
  const csvForCopy = toCopyPathLiteral(csvPath);
  await conn.query(`COPY ${table} FROM "${csvForCopy}" ${CSV_COPY_OPTIONS};`);
}

// Bulk path: one COPY per table instead of a prepared statement per row.
// Only used on the reset path, where the freshly created tables are empty.
// Produces a byte-identical graph to rowByRowLoad (same parsed arrays, same
// node-then-edge order, same dangling-edge filtering).
async function bulkLoad(conn: Connection, data: GraphData): Promise<void> {
  fs.rmSync(GRAPH_IMPORT_DIR, { recursive: true, force: true });
  fs.mkdirSync(GRAPH_IMPORT_DIR, { recursive: true });

  const fileIds = new Set(data.fileEntities.map((e) => e.id));
  const ruleIds = new Set(data.ruleEntities.map((e) => e.id));
  const adrIds = new Set(data.adrEntities.map((e) => e.id));
  const chunkIds = new Set(data.chunkEntities.map((e) => e.id));
  const moduleIds = new Set(data.moduleEntities.map((e) => e.id));
  const projectIds = new Set(data.projectEntities.map((e) => e.id));

  // Nodes first — edges reference them by primary key.
  await copyTable(
    conn,
    "File",
    ["id", "path", "kind", "excerpt", "checksum", "updated_at", "source_of_truth", "trust_level", "status"],
    data.fileEntities.map((e) => [
      e.id, e.path, e.kind, e.excerpt, e.checksum, e.updated_at, e.source_of_truth, e.trust_level, e.status
    ])
  );
  await copyTable(
    conn,
    "Rule",
    ["id", "title", "body", "scope", "priority", "updated_at", "source_of_truth", "trust_level", "status"],
    data.ruleEntities.map((e) => [
      e.id, e.title, e.body, e.scope, e.priority, e.updated_at, e.source_of_truth, e.trust_level, e.status
    ])
  );
  await copyTable(
    conn,
    "ADR",
    ["id", "path", "title", "body", "decision_date", "supersedes_id", "source_of_truth", "trust_level", "status"],
    data.adrEntities.map((e) => [
      e.id, e.path, e.title, e.body, e.decision_date, e.supersedes_id, e.source_of_truth, e.trust_level, e.status
    ])
  );
  await copyTable(
    conn,
    "Chunk",
    [
      "id", "file_id", "name", "kind", "signature", "body", "description", "start_line", "end_line",
      "language", "exported", "checksum", "updated_at", "source_of_truth", "trust_level", "status"
    ],
    data.chunkEntities.map((e) => [
      e.id, e.file_id, e.name, e.kind, e.signature, e.body, e.description, e.start_line, e.end_line,
      e.language, e.exported, e.checksum, e.updated_at, e.source_of_truth, e.trust_level, e.status
    ])
  );
  await copyTable(
    conn,
    "Module",
    ["id", "path", "name", "summary", "file_count", "exported_symbols", "updated_at", "source_of_truth", "trust_level", "status"],
    data.moduleEntities.map((e) => [
      e.id, e.path, e.name, e.summary, e.file_count, e.exported_symbols, e.updated_at, e.source_of_truth, e.trust_level, e.status
    ])
  );
  await copyTable(
    conn,
    "Project",
    [
      "id", "path", "name", "kind", "language", "target_framework", "summary", "file_count",
      "updated_at", "source_of_truth", "trust_level", "status"
    ],
    data.projectEntities.map((e) => [
      e.id, e.path, e.name, e.kind, e.language, e.target_framework, e.summary, e.file_count,
      e.updated_at, e.source_of_truth, e.trust_level, e.status
    ])
  );

  // Edges, filtered to existing endpoints. Header names are positional only
  // (COPY into a rel table reads src key, dst key, then properties in schema
  // order), but emitting real names keeps the CSVs self-describing.
  await copyTable(conn, "CONSTRAINS", ["from", "to", "note"],
    filterEdges(data.constrains, ruleIds, fileIds).map((e) => [e.from, e.to, e.note]));
  await copyTable(conn, "IMPLEMENTS", ["from", "to", "note"],
    filterEdges(data.implementsEdges, fileIds, ruleIds).map((e) => [e.from, e.to, e.note]));
  await copyTable(conn, "SUPERSEDES", ["from", "to", "reason"],
    filterEdges(data.supersedes, adrIds, adrIds).map((e) => [e.from, e.to, e.note]));
  await copyTable(conn, "DEFINES", ["from", "to"],
    filterEdges(data.defines, fileIds, chunkIds).map((e) => [e.from, e.to]));
  await copyTable(conn, "CALLS", ["from", "to", "call_type"],
    filterEdges(data.calls, chunkIds, chunkIds).map((e) => [e.from, e.to, e.call_type]));
  await copyTable(conn, "IMPORTS", ["from", "to", "import_name"],
    filterEdges(data.imports, chunkIds, fileIds).map((e) => [e.from, e.to, e.import_name]));
  await copyTable(conn, "CALLS_SQL", ["from", "to", "note"],
    filterEdges(data.callsSql, fileIds, chunkIds).map((e) => [e.from, e.to, e.note]));
  await copyTable(conn, "USES_CONFIG_KEY", ["from", "to", "note"],
    filterEdges(data.usesConfigKey, fileIds, chunkIds).map((e) => [e.from, e.to, e.note]));
  await copyTable(conn, "USES_RESOURCE_KEY", ["from", "to", "note"],
    filterEdges(data.usesResourceKey, fileIds, chunkIds).map((e) => [e.from, e.to, e.note]));
  await copyTable(conn, "USES_SETTING_KEY", ["from", "to", "note"],
    filterEdges(data.usesSettingKey, fileIds, chunkIds).map((e) => [e.from, e.to, e.note]));
  await copyTable(conn, "CONTAINS", ["from", "to"],
    filterEdges(data.contains, moduleIds, fileIds).map((e) => [e.from, e.to]));
  await copyTable(conn, "CONTAINS_MODULE", ["from", "to"],
    filterEdges(data.containsModule, moduleIds, moduleIds).map((e) => [e.from, e.to]));
  await copyTable(conn, "EXPORTS", ["from", "to"],
    filterEdges(data.exports, moduleIds, chunkIds).map((e) => [e.from, e.to]));
  await copyTable(conn, "INCLUDES_FILE", ["from", "to"],
    filterEdges(data.includesFile, projectIds, fileIds).map((e) => [e.from, e.to]));
  await copyTable(conn, "REFERENCES_PROJECT", ["from", "to", "note"],
    filterEdges(data.referencesProject, projectIds, projectIds).map((e) => [e.from, e.to, e.note]));
  await copyTable(conn, "USES_RESOURCE", ["from", "to", "note"],
    filterEdges(data.usesResource, fileIds, fileIds).map((e) => [e.from, e.to, e.note]));
  await copyTable(conn, "USES_SETTING", ["from", "to", "note"],
    filterEdges(data.usesSetting, fileIds, fileIds).map((e) => [e.from, e.to, e.note]));
  await copyTable(conn, "USES_CONFIG", ["from", "to", "note"],
    filterEdges(data.usesConfig, fileIds, fileIds).map((e) => [e.from, e.to, e.note]));
  await copyTable(conn, "TRANSFORMS_CONFIG", ["from", "to", "note"],
    filterEdges(data.transformsConfig, fileIds, fileIds).map((e) => [e.from, e.to, e.note]));

  fs.rmSync(GRAPH_IMPORT_DIR, { recursive: true, force: true });
}

// Original loader: clears every table, then inserts each node/edge through a
// prepared statement in batches. Used for --no-reset and as the fallback when
// bulk COPY fails. MATCH-based edge inserts skip dangling endpoints silently.
async function rowByRowLoad(conn: Connection, data: GraphData): Promise<void> {
  const {
    fileEntities, ruleEntities, adrEntities, chunkEntities, moduleEntities, projectEntities,
    constrains, implementsEdges, supersedes, defines, calls, callsSql,
    usesConfigKey, usesResourceKey, usesSettingKey, imports,
    contains, containsModule, exports, includesFile, referencesProject,
    usesResource, usesSetting, usesConfig, transformsConfig
  } = data;

  // Delete all relations first, then all nodes, to avoid orphaned edges
  await conn.query("MATCH (a:ADR)-[r:SUPERSEDES]->(b:ADR) DELETE r;");
  await conn.query("MATCH (f:File)-[i:IMPLEMENTS]->(r:Rule) DELETE i;");
  await conn.query("MATCH (r:Rule)-[c:CONSTRAINS]->(f:File) DELETE c;");
  await conn.query("MATCH (f:File)-[d:DEFINES]->(c:Chunk) DELETE d;");
  await conn.query("MATCH (c1:Chunk)-[ca:CALLS]->(c2:Chunk) DELETE ca;");
  await conn.query("MATCH (c:Chunk)-[im:IMPORTS]->(f:File) DELETE im;");
  await conn.query("MATCH (f:File)-[cs:CALLS_SQL]->(c:Chunk) DELETE cs;");
  await conn.query("MATCH (f:File)-[uck:USES_CONFIG_KEY]->(c:Chunk) DELETE uck;");
  await conn.query("MATCH (f:File)-[urk:USES_RESOURCE_KEY]->(c:Chunk) DELETE urk;");
  await conn.query("MATCH (f:File)-[usk:USES_SETTING_KEY]->(c:Chunk) DELETE usk;");
  await conn.query("MATCH (m:Module)-[co:CONTAINS]->(f:File) DELETE co;");
  await conn.query("MATCH (m1:Module)-[cm:CONTAINS_MODULE]->(m2:Module) DELETE cm;");
  await conn.query("MATCH (m:Module)-[ex:EXPORTS]->(c:Chunk) DELETE ex;");
  await conn.query("MATCH (p:Project)-[inc:INCLUDES_FILE]->(f:File) DELETE inc;");
  await conn.query("MATCH (p1:Project)-[rp:REFERENCES_PROJECT]->(p2:Project) DELETE rp;");
  await conn.query("MATCH (f1:File)-[ur:USES_RESOURCE]->(f2:File) DELETE ur;");
  await conn.query("MATCH (f1:File)-[us:USES_SETTING]->(f2:File) DELETE us;");
  await conn.query("MATCH (f1:File)-[uc:USES_CONFIG]->(f2:File) DELETE uc;");
  await conn.query("MATCH (f1:File)-[tc:TRANSFORMS_CONFIG]->(f2:File) DELETE tc;");

  // Now delete all nodes
  await conn.query("MATCH (n:ADR) DELETE n;");
  await conn.query("MATCH (n:Rule) DELETE n;");
  await conn.query("MATCH (n:Chunk) DELETE n;");
  await conn.query("MATCH (n:Module) DELETE n;");
  await conn.query("MATCH (n:Project) DELETE n;");
  await conn.query("MATCH (n:File) DELETE n;");

  const insertFile = await conn.prepare(`
    CREATE (f:File {
      id: $id,
      path: $path,
      kind: $kind,
      excerpt: $excerpt,
      checksum: $checksum,
      updated_at: $updated_at,
      source_of_truth: $source_of_truth,
      trust_level: $trust_level,
      status: $status
    });
  `);

  const insertRule = await conn.prepare(`
    CREATE (r:Rule {
      id: $id,
      title: $title,
      body: $body,
      scope: $scope,
      priority: $priority,
      updated_at: $updated_at,
      source_of_truth: $source_of_truth,
      trust_level: $trust_level,
      status: $status
    });
  `);

  const insertAdr = await conn.prepare(`
    CREATE (a:ADR {
      id: $id,
      path: $path,
      title: $title,
      body: $body,
      decision_date: $decision_date,
      supersedes_id: $supersedes_id,
      source_of_truth: $source_of_truth,
      trust_level: $trust_level,
      status: $status
    });
  `);

  const insertChunk = await conn.prepare(`
    CREATE (c:Chunk {
      id: $id,
      file_id: $file_id,
      name: $name,
      kind: $kind,
      signature: $signature,
      body: $body,
      description: $description,
      start_line: $start_line,
      end_line: $end_line,
      language: $language,
      exported: $exported,
      checksum: $checksum,
      updated_at: $updated_at,
      source_of_truth: $source_of_truth,
      trust_level: $trust_level,
      status: $status
    });
  `);

  const insertConstrains = await conn.prepare(`
    MATCH (r:Rule {id: $from}), (f:File {id: $to})
    CREATE (r)-[:CONSTRAINS {note: $note}]->(f);
  `);

  const insertImplements = await conn.prepare(`
    MATCH (f:File {id: $from}), (r:Rule {id: $to})
    CREATE (f)-[:IMPLEMENTS {note: $note}]->(r);
  `);

  const insertSupersedes = await conn.prepare(`
    MATCH (a1:ADR {id: $from}), (a2:ADR {id: $to})
    CREATE (a1)-[:SUPERSEDES {reason: $note}]->(a2);
  `);

  const insertDefines = await conn.prepare(`
    MATCH (f:File {id: $from}), (c:Chunk {id: $to})
    CREATE (f)-[:DEFINES]->(c);
  `);

  const insertCalls = await conn.prepare(`
    MATCH (c1:Chunk {id: $from}), (c2:Chunk {id: $to})
    CREATE (c1)-[:CALLS {call_type: $call_type}]->(c2);
  `);

  const insertImports = await conn.prepare(`
    MATCH (c:Chunk {id: $from}), (f:File {id: $to})
    CREATE (c)-[:IMPORTS {import_name: $import_name}]->(f);
  `);

  const insertCallsSql = await conn.prepare(`
    MATCH (f:File {id: $from}), (c:Chunk {id: $to})
    CREATE (f)-[:CALLS_SQL {note: $note}]->(c);
  `);

  const insertUsesConfigKey = await conn.prepare(`
    MATCH (f:File {id: $from}), (c:Chunk {id: $to})
    CREATE (f)-[:USES_CONFIG_KEY {note: $note}]->(c);
  `);

  const insertUsesResourceKey = await conn.prepare(`
    MATCH (f:File {id: $from}), (c:Chunk {id: $to})
    CREATE (f)-[:USES_RESOURCE_KEY {note: $note}]->(c);
  `);

  const insertUsesSettingKey = await conn.prepare(`
    MATCH (f:File {id: $from}), (c:Chunk {id: $to})
    CREATE (f)-[:USES_SETTING_KEY {note: $note}]->(c);
  `);

  const insertModule = await conn.prepare(`
    CREATE (m:Module {
      id: $id,
      path: $path,
      name: $name,
      summary: $summary,
      file_count: $file_count,
      exported_symbols: $exported_symbols,
      updated_at: $updated_at,
      source_of_truth: $source_of_truth,
      trust_level: $trust_level,
      status: $status
    });
  `);

  const insertProject = await conn.prepare(`
    CREATE (p:Project {
      id: $id,
      path: $path,
      name: $name,
      kind: $kind,
      language: $language,
      target_framework: $target_framework,
      summary: $summary,
      file_count: $file_count,
      updated_at: $updated_at,
      source_of_truth: $source_of_truth,
      trust_level: $trust_level,
      status: $status
    });
  `);

  const insertContains = await conn.prepare(`
    MATCH (m:Module {id: $from}), (f:File {id: $to})
    CREATE (m)-[:CONTAINS]->(f);
  `);

  const insertContainsModule = await conn.prepare(`
    MATCH (m1:Module {id: $from}), (m2:Module {id: $to})
    CREATE (m1)-[:CONTAINS_MODULE]->(m2);
  `);

  const insertExports = await conn.prepare(`
    MATCH (m:Module {id: $from}), (c:Chunk {id: $to})
    CREATE (m)-[:EXPORTS]->(c);
  `);

  const insertIncludesFile = await conn.prepare(`
    MATCH (p:Project {id: $from}), (f:File {id: $to})
    CREATE (p)-[:INCLUDES_FILE]->(f);
  `);

  const insertReferencesProject = await conn.prepare(`
    MATCH (p1:Project {id: $from}), (p2:Project {id: $to})
    CREATE (p1)-[:REFERENCES_PROJECT {note: $note}]->(p2);
  `);

  const insertUsesResource = await conn.prepare(`
    MATCH (f1:File {id: $from}), (f2:File {id: $to})
    CREATE (f1)-[:USES_RESOURCE {note: $note}]->(f2);
  `);

  const insertUsesSetting = await conn.prepare(`
    MATCH (f1:File {id: $from}), (f2:File {id: $to})
    CREATE (f1)-[:USES_SETTING {note: $note}]->(f2);
  `);

  const insertUsesConfig = await conn.prepare(`
    MATCH (f1:File {id: $from}), (f2:File {id: $to})
    CREATE (f1)-[:USES_CONFIG {note: $note}]->(f2);
  `);

  const insertTransformsConfig = await conn.prepare(`
    MATCH (f1:File {id: $from}), (f2:File {id: $to})
    CREATE (f1)-[:TRANSFORMS_CONFIG {note: $note}]->(f2);
  `);

  // Insert all nodes first (batched for performance)
  await executeBatch(conn, insertFile, fileEntities);
  await executeBatch(conn, insertRule, ruleEntities.map((e) => ({
    id: e.id, title: e.title, body: e.body, scope: e.scope,
    priority: e.priority, updated_at: e.updated_at,
    source_of_truth: e.source_of_truth, trust_level: e.trust_level, status: e.status
  })));
  await executeBatch(conn, insertAdr, adrEntities);
  await executeBatch(conn, insertChunk, chunkEntities);
  await executeBatch(conn, insertModule, moduleEntities);
  await executeBatch(conn, insertProject, projectEntities);

  // Insert all edges (nodes must exist first)
  await executeBatch(conn, insertDefines, defines);
  await executeBatch(conn, insertCalls, calls);
  await executeBatch(conn, insertImports, imports);
  await executeBatch(conn, insertCallsSql, callsSql);
  await executeBatch(conn, insertUsesConfigKey, usesConfigKey);
  await executeBatch(conn, insertUsesResourceKey, usesResourceKey);
  await executeBatch(conn, insertUsesSettingKey, usesSettingKey);
  await executeBatch(conn, insertConstrains, constrains);
  await executeBatch(conn, insertImplements, implementsEdges);
  await executeBatch(conn, insertSupersedes, supersedes);
  await executeBatch(conn, insertContains, contains);
  await executeBatch(conn, insertContainsModule, containsModule);
  await executeBatch(conn, insertExports, exports);
  await executeBatch(conn, insertIncludesFile, includesFile);
  await executeBatch(conn, insertReferencesProject, referencesProject);
  await executeBatch(conn, insertUsesResource, usesResource);
  await executeBatch(conn, insertUsesSetting, usesSetting);
  await executeBatch(conn, insertUsesConfig, usesConfig);
  await executeBatch(conn, insertTransformsConfig, transformsConfig);
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const reset = !args.has("--no-reset");

  await ensureRequiredFiles();
  warnIfOptionalFilesMissing();

  if (reset) {
    fs.rmSync(DB_PATH, { recursive: true, force: true });
    fs.rmSync(`${DB_PATH}.wal`, { force: true });
    fs.rmSync(`${DB_PATH}.shm`, { force: true });
  }
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const db = new ryugraph.Database(DB_PATH);
  const conn = new ryugraph.Connection(db);

  const ontologyStatements = parseOntologyStatements(fs.readFileSync(ONTOLOGY_PATH, "utf8"));
  await executeStatements(conn, ontologyStatements);

  const data = parseGraphData();

  const bulkEnabled = reset && process.env.CORTEX_GRAPH_BULK_LOAD !== "never";
  let usedBulk = false;
  if (bulkEnabled) {
    try {
      await bulkLoad(conn, data);
      usedBulk = true;
      console.log("[graph-load] loaded via COPY bulk import");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[graph-load] bulk COPY load failed (${message}); falling back to row-by-row inserts`
      );
    }
  }
  if (!usedBulk) {
    await rowByRowLoad(conn, data);
  }

  const fileCount = await rows(await conn.query("MATCH (f:File) RETURN count(*) AS count;"));
  const ruleCount = await rows(await conn.query("MATCH (r:Rule) RETURN count(*) AS count;"));
  const adrCount = await rows(await conn.query("MATCH (a:ADR) RETURN count(*) AS count;"));
  const chunkCount = await rows(await conn.query("MATCH (c:Chunk) RETURN count(*) AS count;"));
  const constrainsCount = await rows(
    await conn.query("MATCH (:Rule)-[c:CONSTRAINS]->(:File) RETURN count(c) AS count;")
  );
  const implementsCount = await rows(
    await conn.query("MATCH (:File)-[i:IMPLEMENTS]->(:Rule) RETURN count(i) AS count;")
  );
  const supersedesCount = await rows(
    await conn.query("MATCH (:ADR)-[s:SUPERSEDES]->(:ADR) RETURN count(s) AS count;")
  );
  const definesCount = await rows(
    await conn.query("MATCH (:File)-[d:DEFINES]->(:Chunk) RETURN count(d) AS count;")
  );
  const callsCount = await rows(
    await conn.query("MATCH (:Chunk)-[ca:CALLS]->(:Chunk) RETURN count(ca) AS count;")
  );
  const importsCount = await rows(
    await conn.query("MATCH (:Chunk)-[im:IMPORTS]->(:File) RETURN count(im) AS count;")
  );
  const callsSqlCount = await rows(
    await conn.query("MATCH (:File)-[cs:CALLS_SQL]->(:Chunk) RETURN count(cs) AS count;")
  );
  const usesConfigKeyCount = await rows(
    await conn.query("MATCH (:File)-[uck:USES_CONFIG_KEY]->(:Chunk) RETURN count(uck) AS count;")
  );
  const usesResourceKeyCount = await rows(
    await conn.query("MATCH (:File)-[urk:USES_RESOURCE_KEY]->(:Chunk) RETURN count(urk) AS count;")
  );
  const usesSettingKeyCount = await rows(
    await conn.query("MATCH (:File)-[usk:USES_SETTING_KEY]->(:Chunk) RETURN count(usk) AS count;")
  );
  const moduleCount = await rows(await conn.query("MATCH (m:Module) RETURN count(*) AS count;"));
  const projectCount = await rows(await conn.query("MATCH (p:Project) RETURN count(*) AS count;"));
  const containsCount = await rows(
    await conn.query("MATCH (:Module)-[co:CONTAINS]->(:File) RETURN count(co) AS count;")
  );
  const containsModuleCount = await rows(
    await conn.query("MATCH (:Module)-[cm:CONTAINS_MODULE]->(:Module) RETURN count(cm) AS count;")
  );
  const exportsCount = await rows(
    await conn.query("MATCH (:Module)-[ex:EXPORTS]->(:Chunk) RETURN count(ex) AS count;")
  );
  const includesFileCount = await rows(
    await conn.query("MATCH (:Project)-[inc:INCLUDES_FILE]->(:File) RETURN count(inc) AS count;")
  );
  const referencesProjectCount = await rows(
    await conn.query(
      "MATCH (:Project)-[rp:REFERENCES_PROJECT]->(:Project) RETURN count(rp) AS count;"
    )
  );
  const usesResourceCount = await rows(
    await conn.query("MATCH (:File)-[ur:USES_RESOURCE]->(:File) RETURN count(ur) AS count;")
  );
  const usesSettingCount = await rows(
    await conn.query("MATCH (:File)-[us:USES_SETTING]->(:File) RETURN count(us) AS count;")
  );
  const usesConfigCount = await rows(
    await conn.query("MATCH (:File)-[uc:USES_CONFIG]->(:File) RETURN count(uc) AS count;")
  );
  const transformsConfigCount = await rows(
    await conn.query("MATCH (:File)-[tc:TRANSFORMS_CONFIG]->(:File) RETURN count(tc) AS count;")
  );

  const summary = {
    generated_at: new Date().toISOString(),
    db_path: DB_PATH,
    counts: {
      files: Number(fileCount[0]?.count ?? 0),
      rules: Number(ruleCount[0]?.count ?? 0),
      adrs: Number(adrCount[0]?.count ?? 0),
      chunks: Number(chunkCount[0]?.count ?? 0),
      constrains: Number(constrainsCount[0]?.count ?? 0),
      implements: Number(implementsCount[0]?.count ?? 0),
      supersedes: Number(supersedesCount[0]?.count ?? 0),
      defines: Number(definesCount[0]?.count ?? 0),
      calls: Number(callsCount[0]?.count ?? 0),
      imports: Number(importsCount[0]?.count ?? 0),
      calls_sql: Number(callsSqlCount[0]?.count ?? 0),
      uses_config_key: Number(usesConfigKeyCount[0]?.count ?? 0),
      uses_resource_key: Number(usesResourceKeyCount[0]?.count ?? 0),
      uses_setting_key: Number(usesSettingKeyCount[0]?.count ?? 0),
      modules: Number(moduleCount[0]?.count ?? 0),
      projects: Number(projectCount[0]?.count ?? 0),
      contains: Number(containsCount[0]?.count ?? 0),
      contains_module: Number(containsModuleCount[0]?.count ?? 0),
      exports: Number(exportsCount[0]?.count ?? 0),
      includes_file: Number(includesFileCount[0]?.count ?? 0),
      references_project: Number(referencesProjectCount[0]?.count ?? 0),
      uses_resource: Number(usesResourceCount[0]?.count ?? 0),
      uses_setting: Number(usesSettingCount[0]?.count ?? 0),
      uses_config: Number(usesConfigCount[0]?.count ?? 0),
      transforms_config: Number(transformsConfigCount[0]?.count ?? 0)
    }
  };

  const summaryPath = path.join(CACHE_DIR, "graph-manifest.json");
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log(`[graph-load] db_path=${DB_PATH}`);
  console.log(
    `[graph-load] files=${summary.counts.files} rules=${summary.counts.rules} adrs=${summary.counts.adrs} chunks=${summary.counts.chunks} modules=${summary.counts.modules} projects=${summary.counts.projects}`
  );
  console.log(
    `[graph-load] rels constrains=${summary.counts.constrains} implements=${summary.counts.implements} supersedes=${summary.counts.supersedes}`
  );
  console.log(
    `[graph-load] rels defines=${summary.counts.defines} calls=${summary.counts.calls} imports=${summary.counts.imports} calls_sql=${summary.counts.calls_sql} uses_config_key=${summary.counts.uses_config_key} uses_resource_key=${summary.counts.uses_resource_key} uses_setting_key=${summary.counts.uses_setting_key}`
  );
  console.log(
    `[graph-load] rels contains=${summary.counts.contains} contains_module=${summary.counts.contains_module} exports=${summary.counts.exports} includes_file=${summary.counts.includes_file} references_project=${summary.counts.references_project} uses_resource=${summary.counts.uses_resource} uses_setting=${summary.counts.uses_setting} uses_config=${summary.counts.uses_config} transforms_config=${summary.counts.transforms_config}`
  );
  console.log(`[graph-load] manifest=${summaryPath}`);

  // RyuGraph Node addon can crash on explicit close in some environments.
  // Let process teardown handle resource cleanup.
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown error"}\n`);
  process.exit(1);
});
