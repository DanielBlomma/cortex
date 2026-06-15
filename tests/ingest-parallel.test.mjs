import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INGEST = path.join(REPO_ROOT, "scaffold", "scripts", "ingest.mjs");

// Enough files across parallel-safe languages to cross the worker-pool
// threshold (>= 50 tasks) so the parallel path actually engages.
function writeSources(srcDir) {
  fs.mkdirSync(srcDir, { recursive: true });
  const langs = [
    [".js", (i) => `export function fn${i}(a, b) {\n  return helper${i}(a) + b;\n}\nfunction helper${i}(x) { return x * ${i}; }\n`],
    [".ts", (i) => `export function tfn${i}(a: number): number {\n  return a + ${i};\n}\nexport const C${i} = ${i};\n`],
    [".py", (i) => `def py_fn${i}(a):\n    return helper${i}(a)\n\ndef helper${i}(x):\n    return x + ${i}\n`],
    [".go", (i) => `package main\n\nfunc GoFn${i}(a int) int {\n\treturn a + ${i}\n}\n`],
    [".java", (i) => `class K${i} {\n  int m${i}(int a) { return a + ${i}; }\n}\n`],
    [".rb", (i) => `def rb_fn${i}(a)\n  a + ${i}\nend\n`],
    [".sql", (i) => `CREATE PROCEDURE usp_${i} AS BEGIN SELECT ${i}; END;\n`],
    [".md", (i) => `# Doc ${i}\n\nSome "quoted", multi-line\ncontent for doc ${i}.\n`]
  ];
  let count = 0;
  for (let i = 0; i < 9; i += 1) {
    for (const [ext, body] of langs) {
      fs.writeFileSync(path.join(srcDir, `mod${i}${ext}`), body(i), "utf8");
      count += 1;
    }
  }
  return count;
}

// Fixed mtime so updated_at (derived from stats.mtime) is identical across the
// two fixtures — otherwise the millisecond gap between writes shows up as a
// spurious diff that has nothing to do with sequential-vs-parallel parsing.
const FIXED_MTIME = new Date("2026-01-01T00:00:00.000Z");

function writeFixture(root) {
  fs.mkdirSync(path.join(root, ".context"), { recursive: true });
  fs.writeFileSync(path.join(root, ".context", "config.yaml"), "repo_id: fixture\nsource_paths:\n  - src\n", "utf8");
  fs.writeFileSync(path.join(root, ".context", "rules.yaml"), "rules: []\n", "utf8");
  const count = writeSources(path.join(root, "src"));
  const srcDir = path.join(root, "src");
  for (const name of fs.readdirSync(srcDir)) {
    fs.utimesSync(path.join(srcDir, name), FIXED_MTIME, FIXED_MTIME);
  }
  return count;
}

function runIngest(root, workers) {
  execFileSync("node", [INGEST], {
    cwd: root,
    env: { ...process.env, CORTEX_PROJECT_ROOT: root, CORTEX_INGEST_WORKERS: String(workers) },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function readCache(root) {
  const cacheDir = path.join(root, ".context", "cache");
  const out = {};
  for (const name of fs.readdirSync(cacheDir).sort()) {
    if (!name.endsWith(".jsonl")) continue;
    out[name] = fs.readFileSync(path.join(cacheDir, name), "utf8");
  }
  return out;
}

test("parallel ingest produces byte-identical cache output to sequential", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-ingest-eq-"));
  const seqRoot = path.join(base, "seq");
  const parRoot = path.join(base, "par");
  fs.mkdirSync(seqRoot, { recursive: true });
  fs.mkdirSync(parRoot, { recursive: true });

  try {
    const seqCount = writeFixture(seqRoot);
    const parCount = writeFixture(parRoot);
    assert.equal(seqCount, parCount);
    assert.ok(seqCount >= 50, `fixture should exceed the worker threshold (got ${seqCount})`);

    runIngest(seqRoot, 0); // sequential
    runIngest(parRoot, 4); // 4-worker pool

    const seqCache = readCache(seqRoot);
    const parCache = readCache(parRoot);

    assert.deepEqual(
      Object.keys(parCache).sort(),
      Object.keys(seqCache).sort(),
      "same set of cache files"
    );
    for (const name of Object.keys(seqCache)) {
      assert.equal(parCache[name], seqCache[name], `${name} differs between parallel and sequential ingest`);
    }

    // Sanity: chunks were actually produced (parsers ran, not all-empty).
    const chunks = seqCache["entities.chunk.jsonl"] ?? "";
    assert.ok(chunks.trim().length > 0, "expected chunk entities to be produced");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
