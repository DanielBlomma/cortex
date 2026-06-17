import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
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

function runIngest(root, workers, extraEnv = {}) {
  const env = {
    ...process.env,
    CORTEX_PROJECT_ROOT: root,
    CORTEX_INGEST_WORKERS: String(workers),
    ...extraEnv
  };
  if (!Object.prototype.hasOwnProperty.call(extraEnv, "CORTEX_INGEST_TRACE_MEMORY")) {
    delete env.CORTEX_INGEST_TRACE_MEMORY;
  }
  const result = spawnSync(process.execPath, [INGEST], {
    cwd: root,
    env,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function readOutputFiles(root) {
  const roots = [
    path.join(root, ".context", "cache"),
    path.join(root, ".context", "db", "import")
  ];
  const out = {};
  for (const dir of roots) {
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith(".jsonl") && !name.endsWith(".tsv")) continue;
      const rel = toPosix(path.relative(root, path.join(dir, name)));
      out[rel] = fs.readFileSync(path.join(dir, name), "utf8");
    }
  }
  return out;
}

function toPosix(value) {
  return value.split(path.sep).join("/");
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
    const parallelRun = runIngest(parRoot, 4, { CORTEX_INGEST_TRACE_MEMORY: "1" }); // 4-worker pool

    const seqCache = readOutputFiles(seqRoot);
    const parCache = readOutputFiles(parRoot);

    assert.deepEqual(
      Object.keys(parCache).sort(),
      Object.keys(seqCache).sort(),
      "same set of cache files"
    );
    for (const name of Object.keys(seqCache)) {
      assert.equal(parCache[name], seqCache[name], `${name} differs between parallel and sequential ingest`);
    }

    // Sanity: chunks were actually produced (parsers ran, not all-empty).
    const chunks = seqCache[".context/cache/entities.chunk.jsonl"] ?? "";
    assert.ok(chunks.trim().length > 0, "expected chunk entities to be produced");

    const traceRecords = parallelRun.stderr
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const workersComplete = traceRecords.find((record) => record.label === "parse:workers_complete");
    assert.ok(workersComplete, "expected parse:workers_complete trace");
    assert.equal(workersComplete.counts.worker_results_retained, 0);
    assert.equal(workersComplete.counts.worker_results_pending, 0);
    assert.ok(workersComplete.counts.worker_results_retained_peak >= 0);
    assert.ok(workersComplete.counts.worker_results_consumed > 0, "parallel worker results should be consumed");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
