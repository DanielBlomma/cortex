import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ryugraph, { type Connection, type QueryResult } from "ryugraph";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const CONTEXT_DIR = path.join(REPO_ROOT, ".context");
const CACHE_DIR = path.join(CONTEXT_DIR, "cache");
const DB_PATH = path.join(CONTEXT_DIR, "db", "graph.ryu");
const ONTOLOGY_PATH = path.join(CONTEXT_DIR, "ontology.cypher");

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

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
  start_line: number;
  end_line: number;
  language: string;
  checksum: string;
  updated_at: string;
  trust_level: number;
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

function asString(value: JsonValue | undefined, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: JsonValue | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: JsonValue | undefined, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readJsonl(filePath: string): JsonObject[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return fs
    .readFileSync(filePath, "utf8")
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
        start_line: asNumber(item.start_line, 0),
        end_line: asNumber(item.end_line, 0),
        language: asString(item.language, "javascript"),
        checksum: asString(item.checksum),
        updated_at: asString(item.updated_at),
        trust_level: asNumber(item.trust_level, 80)
      };
    })
    .filter((value): value is ChunkEntity => value !== null);
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

function warnIfOptionalChunkFilesMissing(): void {
  const optionalChunkFiles = [
    "entities.chunk.jsonl",
    "relations.defines.jsonl",
    "relations.calls.jsonl",
    "relations.imports.jsonl"
  ];

  const missing = optionalChunkFiles.filter((fileName) => !fs.existsSync(path.join(CACHE_DIR, fileName)));
  if (missing.length === 0) {
    return;
  }

  console.warn(
    `[graph-load] warning: missing optional chunk files (${missing.join(", ")}); continuing without chunk nodes/relations`
  );
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const reset = !args.has("--no-reset");

  await ensureRequiredFiles();
  warnIfOptionalChunkFilesMissing();

  if (reset) {
    fs.rmSync(DB_PATH, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const db = new ryugraph.Database(DB_PATH);
  const conn = new ryugraph.Connection(db);

  const ontologyStatements = parseOntologyStatements(fs.readFileSync(ONTOLOGY_PATH, "utf8"));
  await executeStatements(conn, ontologyStatements);

  await conn.query("MATCH (a:ADR)-[r:SUPERSEDES]->(b:ADR) DELETE r;");
  await conn.query("MATCH (f:File)-[i:IMPLEMENTS]->(r:Rule) DELETE i;");
  await conn.query("MATCH (r:Rule)-[c:CONSTRAINS]->(f:File) DELETE c;");
  await conn.query("MATCH (f:File)-[d:DEFINES]->(c:Chunk) DELETE d;");
  await conn.query("MATCH (c1:Chunk)-[ca:CALLS]->(c2:Chunk) DELETE ca;");
  await conn.query("MATCH (c:Chunk)-[im:IMPORTS]->(f:File) DELETE im;");
  await conn.query("MATCH (n:ADR) DELETE n;");
  await conn.query("MATCH (n:Rule) DELETE n;");
  await conn.query("MATCH (n:Chunk) DELETE n;");
  await conn.query("MATCH (n:File) DELETE n;");

  const fileEntities = parseFiles(readEntityFile("entities.file.jsonl"));
  const ruleEntities = parseRules(readEntityFile("entities.rule.jsonl"));
  const adrEntities = parseAdrs(readEntityFile("entities.adr.jsonl"));
  const chunkEntities = parseChunks(readEntityFile("entities.chunk.jsonl"));
  const constrains = parseRelations("relations.constrains.jsonl", "note");
  const implementsEdges = parseRelations("relations.implements.jsonl", "note");
  const supersedes = parseRelations("relations.supersedes.jsonl", "reason");
  const defines = parseSimpleRelations("relations.defines.jsonl");
  const calls = parseCallRelations("relations.calls.jsonl");
  const imports = parseImportRelations("relations.imports.jsonl");

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
      start_line: $start_line,
      end_line: $end_line,
      language: $language,
      checksum: $checksum,
      updated_at: $updated_at,
      trust_level: $trust_level
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

  for (const entity of fileEntities) {
    await conn.execute(insertFile, entity);
  }

  for (const entity of ruleEntities) {
    await conn.execute(insertRule, {
      id: entity.id,
      title: entity.title,
      body: entity.body,
      scope: entity.scope,
      priority: entity.priority,
      updated_at: entity.updated_at,
      source_of_truth: entity.source_of_truth,
      trust_level: entity.trust_level,
      status: entity.status
    });
  }

  for (const entity of adrEntities) {
    await conn.execute(insertAdr, entity);
  }

  for (const entity of chunkEntities) {
    await conn.execute(insertChunk, entity);
  }

  for (const edge of defines) {
    await conn.execute(insertDefines, edge);
  }

  for (const edge of calls) {
    await conn.execute(insertCalls, edge);
  }

  for (const edge of imports) {
    await conn.execute(insertImports, edge);
  }

  for (const edge of constrains) {
    await conn.execute(insertConstrains, edge);
  }

  for (const edge of implementsEdges) {
    await conn.execute(insertImplements, edge);
  }

  for (const edge of supersedes) {
    await conn.execute(insertSupersedes, edge);
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
      imports: Number(importsCount[0]?.count ?? 0)
    }
  };

  const summaryPath = path.join(CACHE_DIR, "graph-manifest.json");
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log(`[graph-load] db_path=${DB_PATH}`);
  console.log(
    `[graph-load] files=${summary.counts.files} rules=${summary.counts.rules} adrs=${summary.counts.adrs} chunks=${summary.counts.chunks}`
  );
  console.log(
    `[graph-load] rels constrains=${summary.counts.constrains} implements=${summary.counts.implements} supersedes=${summary.counts.supersedes}`
  );
  console.log(
    `[graph-load] rels defines=${summary.counts.defines} calls=${summary.counts.calls} imports=${summary.counts.imports}`
  );
  console.log(`[graph-load] manifest=${summaryPath}`);

  // RyuGraph Node addon can crash on explicit close in some environments.
  // Let process teardown handle resource cleanup.
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown error"}\n`);
  process.exit(1);
});
