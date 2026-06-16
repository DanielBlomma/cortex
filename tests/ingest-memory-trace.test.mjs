import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INGEST = path.join(REPO_ROOT, "scaffold", "scripts", "ingest.mjs");

function writeFixture(root) {
  fs.mkdirSync(path.join(root, ".context"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, ".context", "config.yaml"), "repo_id: fixture\nsource_paths:\n  - src\n", "utf8");
  fs.writeFileSync(
    path.join(root, ".context", "rules.yaml"),
    [
      "rules:",
      "  - id: rule.trace",
      "    description: Trace rule references application source",
      "    priority: 10",
      "    enforce: true",
      ""
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(root, "src", "app.js"),
    [
      "export function runTrace(value) {",
      "  // rule.trace",
      "  return helperTrace(value);",
      "}",
      "function helperTrace(value) {",
      "  return value + 1;",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );
}

function runIngest(root, extraEnv = {}) {
  const env = {
    ...process.env,
    CORTEX_PROJECT_ROOT: root,
    CORTEX_INGEST_WORKERS: "0",
    ...extraEnv
  };
  if (!Object.prototype.hasOwnProperty.call(extraEnv, "CORTEX_INGEST_TRACE_MEMORY")) {
    delete env.CORTEX_INGEST_TRACE_MEMORY;
  }

  return spawnSync(process.execPath, [INGEST], {
    cwd: root,
    env,
    encoding: "utf8"
  });
}

test("ingest memory trace is opt-in and emits checkpoint JSON lines", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-ingest-trace-"));
  try {
    writeFixture(root);

    const normal = runIngest(root);
    assert.equal(normal.status, 0, normal.stderr);
    assert.equal(normal.stderr, "", "normal ingest should not emit memory trace stderr");
    assert.match(normal.stdout, /^\[ingest\] mode=full/m);

    const traced = runIngest(root, { CORTEX_INGEST_TRACE_MEMORY: "1" });
    assert.equal(traced.status, 0, traced.stderr);
    assert.match(traced.stdout, /^\[ingest\] mode=full/m);

    const records = traced.stderr
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.ok(records.length >= 8, "expected multiple memory checkpoints");
    assert.ok(records.every((record) => record.type === "cortex.ingest.memory"));
    assert.ok(records.every((record) => Number.isInteger(record.rss_bytes) && record.rss_bytes > 0));

    const labels = new Set(records.map((record) => record.label));
    for (const label of [
      "scan:file_records",
      "hydration:complete",
      "parse:workers_complete",
      "parse:merge_complete",
      "materialize:chunks_relations",
      "materialize:modules_projects_relations",
      "tokens:rule_matching_complete",
      "writes:manifest_complete"
    ]) {
      assert.ok(labels.has(label), `missing checkpoint ${label}`);
    }

    const scanRecord = records.find((record) => record.label === "scan:file_records");
    assert.equal(scanRecord.counts.files, 1);
    assert.equal(scanRecord.counts.skipped_unsupported, 0);

    const writeRecord = records.find((record) => record.label === "writes:manifest_complete");
    assert.equal(writeRecord.counts.files, 1);
    assert.ok(writeRecord.counts.chunks >= 1);
    assert.ok(writeRecord.counts.total_relations >= 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
