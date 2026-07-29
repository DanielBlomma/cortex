import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parseFilesInWorkers } from "../scaffold/scripts/lib/ingest/main.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INGEST = path.join(REPO_ROOT, "scaffold", "scripts", "ingest.mjs");
const INGEST_LIB = path.join(REPO_ROOT, "scaffold", "scripts", "lib", "ingest");
const INGEST_PARSERS = path.join(
  REPO_ROOT,
  "scaffold",
  "scripts",
  "ingest-parsers.mjs",
);
const PARSERS_DIR = path.join(REPO_ROOT, "scaffold", "scripts", "parsers");
const CRASH_WORKER = new URL("./fixtures/ingest-crash-worker.mjs", import.meta.url);
const FIXED_MTIME = new Date("2026-01-01T00:00:00.000Z");

function withTimeout(promise, ms, label) {
  let timer;
  const guard = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms}ms (pool hang)`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

function makeTasks(count, crashIndices = new Set()) {
  const tasks = [];
  for (let i = 0; i < count; i += 1) {
    tasks.push({
      id: `t${i}`,
      ext: ".js",
      content: "x",
      path: crashIndices.has(i) ? `CRASH-${i}.js` : `f${i}.js`
    });
  }
  return tasks;
}

function writePipelineFixture(root) {
  const contextDir = path.join(root, ".context");
  const srcDir = path.join(root, "src");
  fs.mkdirSync(contextDir, { recursive: true });
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(
    path.join(contextDir, "config.yaml"),
    "repo_id: worker-fallback\nsource_paths:\n  - src\n",
    "utf8",
  );
  fs.writeFileSync(path.join(contextDir, "rules.yaml"), "rules: []\n", "utf8");
  for (let i = 0; i < 56; i += 1) {
    const file = path.join(srcDir, `file-${i}.js`);
    fs.writeFileSync(
      file,
      `export function value${i}(input) {\n  return input + ${i};\n}\n`,
      "utf8",
    );
    fs.utimesSync(file, FIXED_MTIME, FIXED_MTIME);
  }
}

function writeFallbackIngest(scriptDir) {
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.copyFileSync(INGEST, path.join(scriptDir, "ingest.mjs"));
  fs.cpSync(INGEST_LIB, path.join(scriptDir, "lib", "ingest"), { recursive: true });
  fs.copyFileSync(INGEST_PARSERS, path.join(scriptDir, "ingest-parsers.mjs"));
  fs.symlinkSync(PARSERS_DIR, path.join(scriptDir, "parsers"), "dir");
  fs.writeFileSync(
    path.join(scriptDir, "ingest-worker.mjs"),
    [
      "import { parentPort } from 'node:worker_threads';",
      "if (!parentPort) throw new Error('worker only');",
      "parentPort.on('message', (message) => {",
      "  if (message?.type === 'shutdown') process.exit(0);",
      "  if (message.filePath === 'src/file-5.js') process.exit(91);",
      "  parentPort.postMessage({",
      "    taskId: message.taskId,",
      "    ok: false,",
      "    reason: 'forced inline fallback',",
      "  });",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );
  return fs.realpathSync(path.join(scriptDir, "ingest.mjs"));
}

function runPipeline(root, ingest, workers, trace = false) {
  const env = {
    ...process.env,
    CORTEX_PROJECT_ROOT: root,
    CORTEX_INGEST_WORKERS: String(workers),
  };
  delete env.CORTEX_INGEST_TRACE_MEMORY;
  if (trace) env.CORTEX_INGEST_TRACE_MEMORY = "1";
  const result = spawnSync(process.execPath, [ingest], {
    cwd: root,
    encoding: "utf8",
    env,
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function readPipelineOutputs(root) {
  const output = new Map();
  for (const relativeDir of [".context/cache", ".context/db/import"]) {
    const dir = path.join(root, relativeDir);
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith(".jsonl") && !name.endsWith(".tsv")) continue;
      const relativePath = path.join(relativeDir, name).split(path.sep).join("/");
      output.set(relativePath, fs.readFileSync(path.join(dir, name), "utf8"));
    }
  }
  return output;
}

test("parseFilesInWorkers resolves and isolates a worker that exits without a message", async () => {
  const tasks = makeTasks(24, new Set([5, 17]));
  const results = await withTimeout(
    parseFilesInWorkers(tasks, { workerCount: 4, workerUrl: CRASH_WORKER }),
    15000,
    "mixed crash run"
  );

  // The crashed tasks have no result (they fall back to inline parsing in the
  // real pipeline); every other task completed.
  assert.equal(results.has("t5"), false, "crashed task t5 must not have a worker result");
  assert.equal(results.has("t17"), false, "crashed task t17 must not have a worker result");
  for (let i = 0; i < 24; i += 1) {
    if (i === 5 || i === 17) continue;
    assert.ok(results.has(`t${i}`), `expected a result for t${i}`);
  }
});

test("parseFilesInWorkers resolves even when every worker dies", async () => {
  // Every task crashes its worker; the pool must still resolve (remaining work
  // falls back to inline parsing) instead of hanging.
  const tasks = makeTasks(6, new Set([0, 1, 2, 3, 4, 5]));
  const results = await withTimeout(
    parseFilesInWorkers(tasks, { workerCount: 2, workerUrl: CRASH_WORKER }),
    15000,
    "all-crash run"
  );
  assert.equal(results.size, 0, "no task should have produced a worker result");
});

test("parseFilesInWorkers leaves skipped or unavailable parser results for inline fallback", async () => {
  const tasks = makeTasks(6);
  tasks[2].path = "SKIP-2.js";
  tasks[4].path = "SKIP-4.js";

  const results = await withTimeout(
    parseFilesInWorkers(tasks, { workerCount: 2, workerUrl: CRASH_WORKER }),
    10000,
    "skipped-result run"
  );

  assert.equal(results.has("t2"), false);
  assert.equal(results.has("t4"), false);
  for (const id of ["t0", "t1", "t3", "t5"]) {
    assert.ok(results.has(id), `expected a worker result for ${id}`);
  }
});

test("worker skip and crash paths fall back inline with byte-identical pipeline output", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-worker-fallback-pipeline-"));
  const inlineRoot = path.join(base, "inline");
  const fallbackRoot = path.join(base, "fallback");
  const scriptDir = path.join(base, "scripts");
  fs.mkdirSync(inlineRoot, { recursive: true });
  fs.mkdirSync(fallbackRoot, { recursive: true });
  writePipelineFixture(inlineRoot);
  writePipelineFixture(fallbackRoot);
  const fallbackIngest = writeFallbackIngest(scriptDir);

  try {
    runPipeline(inlineRoot, INGEST, 0);
    const fallbackRun = runPipeline(fallbackRoot, fallbackIngest, 4, true);
    const inlineOutput = readPipelineOutputs(inlineRoot);
    const fallbackOutput = readPipelineOutputs(fallbackRoot);

    assert.deepEqual(
      [...fallbackOutput.keys()],
      [...inlineOutput.keys()],
      "worker failure lane must persist the same output files",
    );
    for (const [name, expected] of inlineOutput) {
      assert.equal(
        fallbackOutput.get(name),
        expected,
        `${name} differs after skipped/crashed worker fallback`,
      );
    }

    const traceRecords = fallbackRun.stderr
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const workersComplete = traceRecords.find(
      (record) => record.label === "parse:workers_complete",
    );
    assert.ok(workersComplete);
    assert.ok(workersComplete.counts.worker_tasks >= 50);
    assert.equal(workersComplete.counts.worker_count, 4);
    assert.equal(workersComplete.counts.worker_results, 0);
    assert.equal(
      workersComplete.counts.worker_results_missing,
      workersComplete.counts.worker_tasks,
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("parseFilesInWorkers returns empty for no tasks without spawning workers", async () => {
  const results = await parseFilesInWorkers([], { workerCount: 4, workerUrl: CRASH_WORKER });
  assert.equal(results.size, 0);
});

test("parseFilesInWorkers does not hang on an invalid worker count", async () => {
  const tasks = makeTasks(8);
  // undefined, 0, and negative all yield poolSize < 1; each must resolve to an
  // empty map (caller parses inline) instead of waiting on a pool of zero.
  for (const workerCount of [undefined, 0, -1]) {
    const results = await withTimeout(
      parseFilesInWorkers(tasks, { workerCount, workerUrl: CRASH_WORKER }),
      10000,
      `workerCount=${workerCount}`
    );
    assert.equal(results.size, 0, `workerCount=${workerCount} should produce no worker results`);
  }
});

test("parseFilesInWorkers runs single-worker when workerCount is 1", async () => {
  const tasks = makeTasks(5);
  const results = await withTimeout(
    parseFilesInWorkers(tasks, { workerCount: 1, workerUrl: CRASH_WORKER }),
    10000,
    "single worker"
  );
  assert.equal(results.size, 5, "all tasks parse through a single worker");
});
