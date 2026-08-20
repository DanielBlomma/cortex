import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import ryugraph from "ryugraph";

const MCP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(MCP_DIR, "../..");
const ONTOLOGY_SRC = path.join(REPO_ROOT, ".context", "ontology.cypher");
const LOADER = path.join(MCP_DIR, "dist", "loadGraph.js");

// Adversarial bodies: quotes, newlines, CRLF, commas, tabs, unicode,
// backslashes, and empty strings — the cases CSV escaping must survive
// while staying byte-identical to the prepared-statement loader.
const NASTY = 'she said "hi",\nthen \tleft\r\nC:\\tmp åäö 日本語 🚀';

function jsonl(records) {
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

function writeFixture(root) {
  const cache = path.join(root, ".context", "cache");
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(root, ".context", "config.yaml"), "source_paths:\n  - .\n", "utf8");
  fs.copyFileSync(ONTOLOGY_SRC, path.join(root, ".context", "ontology.cypher"));

  const w = (name, records) => fs.writeFileSync(path.join(cache, name), jsonl(records), "utf8");

  w("entities.file.jsonl", [
    { id: "file:a.ts", path: "src/a.ts", kind: "CODE", excerpt: NASTY, checksum: "c1", updated_at: "2026-01-01T00:00:00Z", source_of_truth: false, trust_level: 80, status: "active" },
    { id: "file:b.ts", path: "src/b.ts", kind: "CODE", excerpt: "", checksum: "", updated_at: "2026-01-02T00:00:00Z", source_of_truth: false, trust_level: 80, status: "active" }
  ]);
  w("entities.rule.jsonl", [
    { id: "rule:r1", title: 'Rule "one"', body: NASTY, scope: "global", priority: 3, updated_at: "2026-01-01T00:00:00Z", source_of_truth: true, trust_level: 95, status: "active" }
  ]);
  w("entities.adr.jsonl", [
    { id: "adr:first", path: "docs/adr-1.md", title: "First", body: "decided,\nyes", decision_date: "2026-01-01", supersedes_id: "", source_of_truth: true, trust_level: 95, status: "active" },
    { id: "adr:second", path: "docs/adr-2.md", title: "Second", body: "", decision_date: "2026-02-01", supersedes_id: "adr:first", source_of_truth: true, trust_level: 95, status: "active" }
  ]);
  w("entities.chunk.jsonl", [
    { id: "chunk:a.ts#1", file_id: "file:a.ts", name: "doThing", kind: "function", signature: "doThing(x)", body: NASTY, description: "does, things\n", start_line: 1, end_line: 9, language: "typescript", exported: true, checksum: "k1", updated_at: "2026-01-01T00:00:00Z", source_of_truth: false, trust_level: 80, status: "active" },
    { id: "chunk:b.ts#1", file_id: "file:b.ts", name: "empty", kind: "function", signature: "", body: "", description: "", start_line: 2, end_line: 2, language: "typescript", exported: false, checksum: "k2", updated_at: "2026-01-02T00:00:00Z", source_of_truth: false, trust_level: 80, status: "active" }
  ]);
  w("entities.module.jsonl", [
    { id: "module:src", path: "src", name: "src", summary: "the, source\nmodule", file_count: 2, exported_symbols: "doThing", updated_at: "2026-01-01T00:00:00Z", source_of_truth: false, trust_level: 75, status: "active" },
    { id: "module:src.sub", path: "src/sub", name: "sub", summary: "nested", file_count: 0, exported_symbols: "", updated_at: "2026-01-01T00:00:00Z", source_of_truth: false, trust_level: 75, status: "active" }
  ]);
  w("entities.project.jsonl", [
    { id: "project:root", path: ".", name: "root", kind: "project", language: "typescript", target_framework: "", summary: "root proj", file_count: 2, updated_at: "2026-01-01T00:00:00Z", source_of_truth: false, trust_level: 80, status: "active" },
    { id: "project:sub", path: "sub", name: "sub", kind: "project", language: "typescript", target_framework: "", summary: "sub, \"proj\"", file_count: 0, updated_at: "2026-01-01T00:00:00Z", source_of_truth: false, trust_level: 80, status: "active" }
  ]);

  // Edges, including dangling references that BOTH loaders must skip:
  // file:ghost / chunk:ghost do not exist as nodes.
  w("relations.constrains.jsonl", [
    { from: "rule:r1", to: "file:a.ts", note: 'constrains, "tightly"' },
    { from: "rule:r1", to: "file:ghost", note: "dangling" }
  ]);
  w("relations.implements.jsonl", [
    { from: "file:a.ts", to: "rule:r1", note: "implements\nit" }
  ]);
  w("relations.supersedes.jsonl", [
    { from: "adr:second", to: "adr:first", reason: "newer,\nbetter" }
  ]);
  w("relations.defines.jsonl", [
    { from: "file:a.ts", to: "chunk:a.ts#1" },
    { from: "file:b.ts", to: "chunk:b.ts#1" },
    { from: "file:a.ts", to: "chunk:ghost" }
  ]);
  w("relations.calls.jsonl", [
    { from: "chunk:a.ts#1", to: "chunk:b.ts#1", call_type: "direct" },
    { from: "chunk:a.ts#1", to: "chunk:ghost", call_type: "direct" }
  ]);
  w("relations.imports.jsonl", [
    { from: "chunk:a.ts#1", to: "file:b.ts", import_name: "./b" }
  ]);
  w("relations.contains.jsonl", [
    { from: "module:src", to: "file:a.ts" },
    { from: "module:src", to: "file:b.ts" }
  ]);
  w("relations.exports.jsonl", [
    { from: "module:src", to: "chunk:a.ts#1" }
  ]);
  w("relations.includes_file.jsonl", [
    { from: "project:root", to: "file:a.ts" },
    { from: "project:root", to: "file:b.ts" }
  ]);
  // The remaining relation tables the COPY path also bulk-loads. Each carries a
  // nasty note and at least one dangling edge so a typo in any single mapping
  // (wrong endpoint set, wrong note column, missing filter) breaks equivalence.
  w("relations.calls_sql.jsonl", [
    { from: "file:a.ts", to: "chunk:b.ts#1", note: 'sql, "ref"\nline2' },
    { from: "file:a.ts", to: "chunk:ghost", note: "dangling" }
  ]);
  w("relations.uses_config_key.jsonl", [
    { from: "file:a.ts", to: "chunk:a.ts#1", note: "cfg key" }
  ]);
  w("relations.uses_resource_key.jsonl", [
    { from: "file:b.ts", to: "chunk:a.ts#1", note: "res, key" }
  ]);
  w("relations.uses_setting_key.jsonl", [
    { from: "file:a.ts", to: "chunk:b.ts#1", note: "setting\nkey" }
  ]);
  w("relations.contains_module.jsonl", [
    { from: "module:src", to: "module:src.sub" },
    { from: "module:src", to: "module:ghost" }
  ]);
  w("relations.references_project.jsonl", [
    { from: "project:root", to: "project:sub", note: 'refs, "sub"' },
    { from: "project:root", to: "project:ghost", note: "dangling" }
  ]);
  w("relations.uses_resource.jsonl", [
    { from: "file:a.ts", to: "file:b.ts", note: "uses res" }
  ]);
  w("relations.uses_setting.jsonl", [
    { from: "file:b.ts", to: "file:a.ts", note: "uses, setting" }
  ]);
  w("relations.uses_config.jsonl", [
    { from: "file:a.ts", to: "file:b.ts", note: "uses cfg" },
    { from: "file:a.ts", to: "file:ghost", note: "dangling" }
  ]);
  w("relations.transforms_config.jsonl", [
    { from: "file:b.ts", to: "file:a.ts", note: "transforms\nconfig" }
  ]);
  fs.writeFileSync(
    path.join(cache, "manifest.json"),
    `${JSON.stringify({
      schema_version: 2,
      generation_id: "graph-bulk-load-fixture",
      generated_at: "2026-01-01T00:00:00Z"
    })}\n`,
    "utf8"
  );
}

const NODE_LABELS = ["File", "Rule", "ADR", "Chunk", "Module", "Project"];
const REL_TYPES = [
  "CONSTRAINS", "IMPLEMENTS", "SUPERSEDES", "DEFINES", "CALLS",
  "IMPORTS", "CONTAINS", "EXPORTS", "INCLUDES_FILE",
  "CALLS_SQL", "USES_CONFIG_KEY", "USES_RESOURCE_KEY", "USES_SETTING_KEY",
  "CONTAINS_MODULE", "REFERENCES_PROJECT", "USES_RESOURCE", "USES_SETTING",
  "USES_CONFIG", "TRANSFORMS_CONFIG"
];

function stable(value) {
  return JSON.stringify(value, (_key, v) =>
    typeof v === "bigint" ? Number(v) : v
  );
}

function stripInternal(obj) {
  const out = {};
  for (const key of Object.keys(obj).sort()) {
    if (key.startsWith("_")) continue;
    out[key] = obj[key];
  }
  return out;
}

async function getAll(conn, query) {
  const result = await conn.query(query);
  const resolved = Array.isArray(result) ? result[result.length - 1] : result;
  return resolved.getAll();
}

async function dumpGraph(dbPath) {
  const db = new ryugraph.Database(dbPath);
  const conn = new ryugraph.Connection(db);
  const dump = { nodes: {}, rels: {} };

  for (const label of NODE_LABELS) {
    const rows = await getAll(conn, `MATCH (n:${label}) RETURN n ORDER BY n.id;`);
    dump.nodes[label] = rows.map((row) => stripInternal(row.n)).sort((a, b) => a.id.localeCompare(b.id));
  }
  for (const type of REL_TYPES) {
    const rows = await getAll(
      conn,
      `MATCH (a)-[r:${type}]->(b) RETURN a.id AS from, b.id AS to, r AS rel ORDER BY a.id, b.id;`
    );
    dump.rels[type] = rows
      .map((row) => ({ from: row.from, to: row.to, props: stripInternal(row.rel) }))
      .sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to));
  }
  return dump;
}

function runLoader(root, { bulk, extraEnv = {} }) {
  return execFileSync("node", [LOADER], {
    cwd: MCP_DIR,
    env: {
      ...process.env,
      CORTEX_PROJECT_ROOT: root,
      ...extraEnv,
      ...(bulk ? {} : { CORTEX_GRAPH_BULK_LOAD: "never" })
    },
    encoding: "utf8"
  });
}

test("graph bulk COPY load produces a byte-identical graph to row-by-row inserts", async () => {
  if (!fs.existsSync(ONTOLOGY_SRC)) {
    // The loader needs a real ontology; skip rather than fail in stripped checkouts.
    return;
  }

  const base = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-graph-eq-"));
  const rowRoot = path.join(base, "row");
  // Put the bulk fixture under a directory whose name contains a double quote
  // (where the OS permits it) so the COPY path literal is exercised against
  // P3b: if the quote were not escaped, COPY would throw and silently fall back
  // to row-by-row, failing the "loaded via COPY bulk import" assertion below.
  const bulkRoot = path.join(base, process.platform === "win32" ? "bulk" : 'bu"lk');
  fs.mkdirSync(rowRoot, { recursive: true });
  fs.mkdirSync(bulkRoot, { recursive: true });

  try {
    writeFixture(rowRoot);
    writeFixture(bulkRoot);

    const rowOut = runLoader(rowRoot, { bulk: false });
    const bulkOut = runLoader(bulkRoot, { bulk: true });

    // The two paths must actually have been exercised.
    assert.doesNotMatch(rowOut, /loaded via COPY bulk import/, "row run should not use bulk");
    assert.match(bulkOut, /loaded via COPY bulk import/, "bulk run should use COPY");

    const rowManifest = JSON.parse(fs.readFileSync(path.join(rowRoot, ".context", "cache", "graph-manifest.json"), "utf8"));
    const bulkManifest = JSON.parse(fs.readFileSync(path.join(bulkRoot, ".context", "cache", "graph-manifest.json"), "utf8"));
    const rowDump = await dumpGraph(rowManifest.db_path);
    const bulkDump = await dumpGraph(bulkManifest.db_path);

    for (const label of NODE_LABELS) {
      assert.equal(
        stable(bulkDump.nodes[label]),
        stable(rowDump.nodes[label]),
        `node table ${label} differs between bulk and row-by-row`
      );
    }
    for (const type of REL_TYPES) {
      assert.equal(
        stable(bulkDump.rels[type]),
        stable(rowDump.rels[type]),
        `rel table ${type} differs between bulk and row-by-row`
      );
    }

    // Spot-check the dangling-edge filtering actually dropped edges across a
    // spread of the relation tables (node-pair filters of every endpoint kind).
    assert.equal(bulkDump.rels.DEFINES.length, 2, "ghost DEFINES edge should be filtered");
    assert.equal(bulkDump.rels.CALLS.length, 1, "ghost CALLS edge should be filtered");
    assert.equal(bulkDump.rels.CALLS_SQL.length, 1, "ghost CALLS_SQL edge should be filtered");
    assert.equal(bulkDump.rels.CONTAINS_MODULE.length, 1, "ghost CONTAINS_MODULE edge should be filtered");
    assert.equal(bulkDump.rels.REFERENCES_PROJECT.length, 1, "ghost REFERENCES_PROJECT edge should be filtered");
    assert.equal(bulkDump.rels.USES_CONFIG.length, 1, "ghost USES_CONFIG edge should be filtered");
    // The SUPERSEDES reason and the new note columns must round-trip exactly.
    assert.equal(bulkDump.rels.SUPERSEDES[0].props.reason, "newer,\nbetter");
    assert.equal(bulkDump.rels.CALLS_SQL[0].props.note, 'sql, "ref"\nline2');
    // And that the nasty body survived round-trip exactly.
    const chunkA = bulkDump.nodes.Chunk.find((n) => n.id === "chunk:a.ts#1");
    assert.equal(chunkA.body, NASTY, "adversarial chunk body must round-trip exactly");
    const chunkB = bulkDump.nodes.Chunk.find((n) => n.id === "chunk:b.ts#1");
    assert.equal(chunkB.body, "", "empty chunk body must stay an empty string, not null");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("graph publication keeps the previous generation across crash points", () => {
  if (!fs.existsSync(ONTOLOGY_SRC)) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-graph-publish-"));
  try {
    writeFixture(root);
    runLoader(root, { bulk: true });
    const manifestPath = path.join(root, ".context", "cache", "graph-manifest.json");
    const previousRaw = fs.readFileSync(manifestPath, "utf8");
    const previous = JSON.parse(previousRaw);
    assert.equal(fs.existsSync(previous.db_path), true);

    for (const crashAt of ["before-db-publish", "after-db-publish"]) {
      assert.throws(() => runLoader(root, {
        bulk: true,
        extraEnv: { CORTEX_GRAPH_TEST_CRASH_AT: crashAt }
      }));
      assert.equal(fs.readFileSync(manifestPath, "utf8"), previousRaw);
      assert.equal(fs.existsSync(previous.db_path), true);
    }

    runLoader(root, { bulk: true });
    const current = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const dbDir = path.join(root, ".context", "db");
    const cacheDir = path.join(root, ".context", "cache");
    const published = fs.readdirSync(dbDir).filter((name) => /^graph-[A-Za-z0-9-]+\.ryu$/.test(name));
    assert.ok(published.length <= 2, `expected at most two retained graph generations, found ${published.length}`);
    assert.equal(fs.existsSync(current.db_path), true);
    assert.deepEqual(
      fs.readdirSync(dbDir).filter((name) => /^\.graph-.*\.staging\.ryu$/.test(name)),
      []
    );
    assert.deepEqual(
      fs.readdirSync(cacheDir).filter((name) => /^\.graph-manifest-.*\.staging\.json$/.test(name)),
      []
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("graph cleanup rejects redirected cache and DB ancestors without external mutation", () => {
  if (!fs.existsSync(ONTOLOGY_SRC) || process.platform === "win32") return;
  for (const redirected of ["cache", "db"]) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), `cortex-graph-redirect-${redirected}-`));
    const root = path.join(base, "project");
    const outside = path.join(base, "outside");
    try {
      fs.mkdirSync(root);
      fs.mkdirSync(outside);
      writeFixture(root);
      const target = path.join(root, ".context", redirected);
      fs.rmSync(target, { recursive: true, force: true });
      fs.writeFileSync(path.join(outside, "canary"), "unchanged", "utf8");
      fs.symlinkSync(outside, target, "dir");
      assert.throws(() => runLoader(root, { bulk: true }), /Command failed/);
      assert.deepEqual(fs.readdirSync(outside), ["canary"]);
      assert.equal(fs.readFileSync(path.join(outside, "canary"), "utf8"), "unchanged");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  }
});

test("graph cleanup rejects a redirected staging leaf without touching its target", () => {
  if (!fs.existsSync(ONTOLOGY_SRC) || process.platform === "win32") return;
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-graph-staging-leaf-"));
  const root = path.join(base, "project");
  const outside = path.join(base, "outside-canary");
  try {
    fs.mkdirSync(root);
    writeFixture(root);
    const db = path.join(root, ".context", "db");
    fs.mkdirSync(db);
    fs.writeFileSync(outside, "unchanged", "utf8");
    const staging = path.join(db, ".graph-redirect.staging.ryu");
    fs.symlinkSync(outside, staging);
    assert.throws(() => runLoader(root, { bulk: true }), /Command failed/);
    assert.equal(fs.readFileSync(outside, "utf8"), "unchanged");
    assert.equal(fs.lstatSync(staging).isSymbolicLink(), true);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("graph publication rejects file and FIFO managed ancestors before cleanup", () => {
  if (!fs.existsSync(ONTOLOGY_SRC) || process.platform === "win32") return;
  for (const kind of ["file", "fifo"]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `cortex-graph-special-${kind}-`));
    try {
      writeFixture(root);
      const db = path.join(root, ".context", "db");
      if (kind === "file") fs.writeFileSync(db, "canary", "utf8");
      else assert.equal(spawnSync("mkfifo", [db]).status, 0);
      const cacheBefore = fs.readdirSync(path.join(root, ".context", "cache")).sort();
      assert.throws(() => runLoader(root, { bulk: true }), /Command failed/);
      assert.deepEqual(fs.readdirSync(path.join(root, ".context", "cache")).sort(), cacheBefore);
      assert.equal(fs.lstatSync(db)[kind === "file" ? "isFile" : "isFIFO"](), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("graph publication rejects a socket managed ancestor before cleanup", async () => {
  if (!fs.existsSync(ONTOLOGY_SRC) || process.platform === "win32") return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-graph-special-socket-"));
  const socketPath = path.join(root, ".context", "db");
  const server = net.createServer();
  try {
    writeFixture(root);
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    const cacheBefore = fs.readdirSync(path.join(root, ".context", "cache")).sort();
    assert.throws(() => runLoader(root, { bulk: true }), /Command failed/);
    assert.deepEqual(fs.readdirSync(path.join(root, ".context", "cache")).sort(), cacheBefore);
    assert.equal(fs.lstatSync(socketPath).isSocket(), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
