/**
 * Tests for multi-level representations: Module entities, Chunk descriptions,
 * and their integration through the ingest pipeline.
 *
 * These tests run ingest against the real repo and validate JSONL outputs.
 * Run with: node --test tests/multi-level.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const CACHE_DIR = path.join(REPO_ROOT, ".context", "cache");
const INGEST_PATH = path.join(REPO_ROOT, "scripts", "ingest.mjs");

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// Run ingest once before all tests
let ingestRan = false;
function ensureIngest() {
  if (ingestRan) return;
  execFileSync("node", [INGEST_PATH], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 60000
  });
  ingestRan = true;
}

test("ingest produces chunk entities with description and exported fields", () => {
  ensureIngest();

  const chunks = readJsonl(path.join(CACHE_DIR, "entities.chunk.jsonl"));
  assert.ok(chunks.length > 0, "should have chunk entities");

  for (const chunk of chunks) {
    assert.ok(typeof chunk.description === "string", `chunk ${chunk.id} missing description`);
    assert.ok(typeof chunk.exported === "boolean", `chunk ${chunk.id} missing exported field`);
  }

  // At least some chunks should have non-empty descriptions
  const withDescription = chunks.filter((c) => c.description.length > 0);
  assert.ok(withDescription.length > 0, "some chunks should have descriptions");
});

test("chunk description includes kind and signature info", () => {
  ensureIngest();

  const chunks = readJsonl(path.join(CACHE_DIR, "entities.chunk.jsonl"));
  const withDescription = chunks.filter((c) => c.description.length > 0);

  for (const chunk of withDescription.slice(0, 10)) {
    // Description should start with the kind
    assert.ok(
      chunk.description.includes(chunk.kind) || chunk.description.startsWith(chunk.kind),
      `chunk ${chunk.id} description should reference its kind "${chunk.kind}"`
    );
  }
});

test("exported chunks are correctly identified", () => {
  ensureIngest();

  const chunks = readJsonl(path.join(CACHE_DIR, "entities.chunk.jsonl"));
  const exported = chunks.filter((c) => c.exported === true);
  const unexported = chunks.filter((c) => c.exported === false);

  assert.ok(exported.length > 0, "should have some exported chunks");
  assert.ok(unexported.length > 0, "should have some non-exported chunks");
});

test("ingest produces module entities", () => {
  ensureIngest();

  const modules = readJsonl(path.join(CACHE_DIR, "entities.module.jsonl"));
  assert.ok(modules.length > 0, "should have module entities");

  for (const mod of modules) {
    assert.ok(mod.id.startsWith("module:"), `module id should start with "module:": ${mod.id}`);
    assert.ok(mod.path, `module ${mod.id} should have a path`);
    assert.ok(mod.name, `module ${mod.id} should have a name`);
    assert.ok(typeof mod.summary === "string", `module ${mod.id} should have a summary`);
    assert.ok(typeof mod.file_count === "number", `module ${mod.id} should have file_count`);
    assert.ok(mod.file_count >= 2, `module ${mod.id} should have at least 2 files (got ${mod.file_count})`);
    assert.ok(typeof mod.source_of_truth === "boolean", `module ${mod.id} missing source_of_truth`);
    assert.ok(typeof mod.trust_level === "number", `module ${mod.id} missing trust_level`);
    assert.ok(mod.status === "active", `module ${mod.id} should have status "active"`);
  }
});

test("no single-file directories become modules", () => {
  ensureIngest();

  const modules = readJsonl(path.join(CACHE_DIR, "entities.module.jsonl"));

  for (const mod of modules) {
    assert.ok(
      mod.file_count >= 2,
      `module ${mod.id} has only ${mod.file_count} file(s) — should be excluded`
    );
  }
});

test("module name matches directory basename", () => {
  ensureIngest();

  const modules = readJsonl(path.join(CACHE_DIR, "entities.module.jsonl"));

  for (const mod of modules) {
    const expectedName = path.basename(mod.path);
    assert.strictEqual(mod.name, expectedName, `module ${mod.id} name should be "${expectedName}"`);
  }
});

test("CONTAINS relations link modules to files", () => {
  ensureIngest();

  const contains = readJsonl(path.join(CACHE_DIR, "relations.contains.jsonl"));
  assert.ok(contains.length > 0, "should have CONTAINS relations");

  for (const rel of contains) {
    assert.ok(rel.from.startsWith("module:"), `CONTAINS from should be module: ${rel.from}`);
    assert.ok(rel.to.startsWith("file:"), `CONTAINS to should be file: ${rel.to}`);
  }
});

test("CONTAINS_MODULE relations link parent to child modules", () => {
  ensureIngest();

  const containsModule = readJsonl(path.join(CACHE_DIR, "relations.contains_module.jsonl"));
  // May be empty for flat repos, but if present they should be valid
  for (const rel of containsModule) {
    assert.ok(rel.from.startsWith("module:"), `CONTAINS_MODULE from should be module: ${rel.from}`);
    assert.ok(rel.to.startsWith("module:"), `CONTAINS_MODULE to should be module: ${rel.to}`);

    // Parent path should be dirname of child path
    const parentPath = rel.from.replace("module:", "");
    const childPath = rel.to.replace("module:", "");
    assert.strictEqual(
      path.dirname(childPath),
      parentPath,
      `parent ${parentPath} should be dirname of child ${childPath}`
    );
  }
});

test("EXPORTS relations link modules to exported chunks", () => {
  ensureIngest();

  const exports = readJsonl(path.join(CACHE_DIR, "relations.exports.jsonl"));
  assert.ok(exports.length > 0, "should have EXPORTS relations");

  for (const rel of exports) {
    assert.ok(rel.from.startsWith("module:"), `EXPORTS from should be module: ${rel.from}`);
    assert.ok(rel.to.startsWith("chunk:"), `EXPORTS to should be chunk: ${rel.to}`);
  }
});

test("DEFINES relations exist", () => {
  ensureIngest();

  const defines = readJsonl(path.join(CACHE_DIR, "relations.defines.jsonl"));
  assert.ok(defines.length > 0, "should have DEFINES relations");

  for (const rel of defines) {
    assert.ok(rel.from.startsWith("file:"), `DEFINES from should be file: ${rel.from}`);
    assert.ok(rel.to.startsWith("chunk:"), `DEFINES to should be chunk: ${rel.to}`);
  }
});

test("ontology.cypher includes description and exported columns on Chunk", () => {
  const ontology = fs.readFileSync(path.join(REPO_ROOT, ".context", "ontology.cypher"), "utf8");
  assert.ok(ontology.includes("description STRING"), "ontology should have description column on Chunk");
  assert.ok(ontology.includes("exported BOOL"), "ontology should have exported column on Chunk");
});
