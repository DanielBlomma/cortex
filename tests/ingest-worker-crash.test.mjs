import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { parseFilesInWorkers } from "../scaffold/scripts/ingest.mjs";

const CRASH_WORKER = new URL("./fixtures/ingest-crash-worker.mjs", import.meta.url);

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

test("parseFilesInWorkers returns empty for no tasks without spawning workers", async () => {
  const results = await parseFilesInWorkers([], { workerCount: 4, workerUrl: CRASH_WORKER });
  assert.equal(results.size, 0);
});
