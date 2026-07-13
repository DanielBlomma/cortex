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

function runIngest(root, extraEnv = {}, args = []) {
  const env = {
    ...process.env,
    CORTEX_PROJECT_ROOT: root,
    CORTEX_INGEST_WORKERS: "0",
    ...extraEnv
  };
  if (!Object.prototype.hasOwnProperty.call(extraEnv, "CORTEX_INGEST_TRACE_MEMORY")) {
    delete env.CORTEX_INGEST_TRACE_MEMORY;
  }

  return spawnSync(process.execPath, [INGEST, ...args], {
    cwd: root,
    env,
    encoding: "utf8"
  });
}

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function readJsonl(file) {
  return fs.readFileSync(file, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
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
      "writes:file_cache_staged",
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

    const ruleMatchRecord = records.find((record) => record.label === "tokens:rule_matching_complete");
    assert.equal(ruleMatchRecord.counts.file_token_sets, 1);
    assert.equal(ruleMatchRecord.counts.file_token_sets_retained, 0);
    assert.equal(ruleMatchRecord.counts.file_content_records_released, 1);
    assert.equal(ruleMatchRecord.counts.file_content_records_retained, 0);

    const stagedRecord = records.find((record) => record.label === "writes:file_cache_staged");
    assert.equal(stagedRecord.counts.file_content_records, 1);

    const documents = readJsonl(path.join(root, ".context", "cache", "documents.jsonl"));
    const fileEntities = readJsonl(path.join(root, ".context", "cache", "entities.file.jsonl"));
    assert.match(documents[0].content, /rule\.trace/);
    assert.match(fileEntities[0].content, /rule\.trace/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("repo-root source path indexes repository files while skipping .context", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-ingest-root-source-"));
  try {
    writeFixture(root);
    fs.mkdirSync(path.join(root, ".context", "cache"), { recursive: true });
    fs.mkdirSync(path.join(root, ".context", "notes"), { recursive: true });
    fs.mkdirSync(path.join(root, "bin"), { recursive: true });
    fs.mkdirSync(path.join(root, "Project", "bin", "Debug"), { recursive: true });
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, ".context", "config.yaml"), "repo_id: fixture\nsource_paths:\n  - .\n", "utf8");
    fs.writeFileSync(path.join(root, ".context", "cache", "generated.js"), "export const generated = true;\n", "utf8");
    fs.writeFileSync(path.join(root, ".context", "notes", "note.md"), "# Internal note\n", "utf8");
    fs.writeFileSync(path.join(root, "bin", "tool.mjs"), "console.log('tool');\n", "utf8");
    fs.writeFileSync(path.join(root, "Project", "bin", "Debug", "generated.js"), "export const generated = true;\n", "utf8");
    fs.writeFileSync(path.join(root, "scripts", "deploy.sh"), "echo deploy\n", "utf8");
    fs.writeFileSync(path.join(root, "README.md"), "# Fixture\n", "utf8");

    const result = runIngest(root);
    assert.equal(result.status, 0, result.stderr);

    const fileEntities = readJsonl(path.join(root, ".context", "cache", "entities.file.jsonl"));
    const paths = fileEntities.map((record) => record.path).sort();
    assert.ok(paths.includes("README.md"));
    assert.ok(paths.includes("bin/tool.mjs"));
    assert.ok(paths.includes("scripts/deploy.sh"));
    assert.ok(paths.includes("src/app.js"));
    assert.equal(paths.some((filePath) => filePath.startsWith(".context/")), false);
    assert.equal(paths.some((filePath) => filePath.startsWith("Project/bin/")), false);

    runCommand("git", ["init"], root);
    runCommand("git", ["checkout", "-b", "main"], root);
    runCommand("git", ["config", "user.email", "tests@example.com"], root);
    runCommand("git", ["config", "user.name", "Cortex Tests"], root);
    runCommand("git", ["add", "README.md", "bin/tool.mjs", "scripts/deploy.sh", "src/app.js"], root);
    runCommand("git", ["commit", "-m", "initial fixture"], root);

    fs.appendFileSync(path.join(root, "src", "app.js"), "\n// changed through root source path\n", "utf8");
    fs.writeFileSync(path.join(root, ".context", "cache", "generated.js"), "export const changed = true;\n", "utf8");

    const changed = runIngest(root, {}, ["--changed"]);
    assert.equal(changed.status, 0, changed.stderr);
    assert.match(changed.stdout, /^\[ingest\] incremental changed_candidates=/m);

    const changedFileEntities = readJsonl(path.join(root, ".context", "cache", "entities.file.jsonl"));
    const changedPaths = changedFileEntities.map((record) => record.path).sort();
    assert.ok(changedPaths.includes("README.md"));
    assert.ok(changedPaths.includes("bin/tool.mjs"));
    assert.ok(changedPaths.includes("scripts/deploy.sh"));
    assert.ok(changedPaths.includes("src/app.js"));
    assert.equal(changedPaths.some((filePath) => filePath.startsWith(".context/")), false);
    assert.equal(changedPaths.some((filePath) => filePath.startsWith("Project/bin/")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ingest rule matching keeps duplicate rule ids de-duplicated", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-ingest-rules-"));
  try {
    writeFixture(root);
    fs.writeFileSync(
      path.join(root, ".context", "rules.yaml"),
      [
        "rules:",
        "  - id: rule.trace",
        "    description: First duplicate trace rule",
        "    priority: 10",
        "    enforce: true",
        "  - id: rule.trace",
        "    description: Second duplicate trace rule",
        "    priority: 10",
        "    enforce: true",
        ""
      ].join("\n"),
      "utf8"
    );

    const result = runIngest(root);
    assert.equal(result.status, 0, result.stderr);

    const constrains = readJsonl(path.join(root, ".context", "cache", "relations.constrains.jsonl"));
    const implementsRelations = readJsonl(path.join(root, ".context", "cache", "relations.implements.jsonl"));

    assert.equal(
      constrains.filter((relation) => relation.from === "rule.trace" && relation.to === "file:src/app.js").length,
      1
    );
    assert.equal(
      implementsRelations.filter((relation) => relation.from === "file:src/app.js" && relation.to === "rule.trace").length,
      1
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
