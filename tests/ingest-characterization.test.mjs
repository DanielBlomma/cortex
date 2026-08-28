import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INGEST = path.join(REPO_ROOT, "scaffold", "scripts", "ingest.mjs");
const ROOT_INGEST = path.join(REPO_ROOT, "scripts", "ingest.mjs");
const FIXTURE = path.join(REPO_ROOT, "tests", "fixtures", "ingest-characterization");
const FIXED_MTIME = new Date("2026-01-01T00:00:00.000Z");
const CHANGED_MTIME = new Date("2026-01-02T00:00:00.000Z");
const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;

const EXPECTED_HASHES = {
  full: {
    jsonl: "937102d472623c4d852762ab700ae510bdc30927ee8aec9aa890976e3b4d44fe",
    tsv: "253278db329ecd74ebce9379a2e406e71841388f37ae2ee4ebf166459df7dd43",
  },
  changed: {
    jsonl: "4fe3cf7e15908215863476a53c785c045ea71af75fb3db76ee88b41020276f3f",
    tsv: "7e70109126569d4534c340ce6791bb4dc8c295c7db70eb9faf14196beda6c2f4",
  },
};

const REQUIRED_TRACE_LABELS = [
  "scan:start",
  "scan:file_records",
  "hydration:complete",
  "parse:eligible",
  "parse:workers_start",
  "parse:workers_complete",
  "parse:merge_complete",
  "materialize:chunks_relations",
  "materialize:modules_projects_relations",
  "writes:file_cache_staged",
  "tokens:rule_matching_start",
  "tokens:rule_matching_complete",
  "writes:cache_start",
  "writes:cache_complete",
  "writes:db_start",
  "writes:db_complete",
  "writes:manifest_complete",
];

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function visitFiles(root, operation) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      visitFiles(target, operation);
    } else {
      operation(target);
    }
  }
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-ingest-characterization-"));
  fs.cpSync(FIXTURE, root, { recursive: true });
  visitFiles(root, (file) => fs.utimesSync(file, FIXED_MTIME, FIXED_MTIME));
  return root;
}

function gitEnv(root) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (
      [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_COMMON_DIR",
        "GIT_NAMESPACE",
        "GIT_TEMPLATE_DIR",
        "GIT_CONFIG_COUNT",
      ].includes(name) ||
      /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(name)
    ) {
      delete env[name];
    }
  }
  env.HOME = path.join(root, ".git-test-home");
  env.XDG_CONFIG_HOME = path.join(env.HOME, ".config");
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = path.join(root, ".git-test-global-config");
  env.GIT_TEMPLATE_DIR = path.join(root, ".git-test-template");
  return env;
}

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env });
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stderr}`);
  return result;
}

function initializeGit(root) {
  const env = gitEnv(root);
  fs.mkdirSync(env.HOME, { recursive: true });
  fs.mkdirSync(env.GIT_TEMPLATE_DIR, { recursive: true });
  const hooksDir = path.join(root, ".git-test-hooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  const runGit = (args) =>
    run("git", ["-c", `core.hooksPath=${hooksDir}`, ...args], root, env);
  runGit(["init"]);
  runGit(["checkout", "-b", "main"]);
  runGit(["config", "user.email", "tests@example.com"]);
  runGit(["config", "user.name", "Cortex Tests"]);
  runGit(["add", "."]);
  runGit(["commit", "-m", "characterization fixture"]);
}

function runIngest(root, args = [], extraEnv = {}, ingestPath = INGEST) {
  const env = {
    ...process.env,
    CORTEX_PROJECT_ROOT: root,
    CORTEX_DOTNET_CMD: path.join(root, "missing-dotnet"),
    CORTEX_INGEST_WORKERS: "0",
    ...extraEnv,
  };
  if (!Object.prototype.hasOwnProperty.call(extraEnv, "CORTEX_INGEST_TRACE_MEMORY")) {
    delete env.CORTEX_INGEST_TRACE_MEMORY;
  }
  return spawnSync(process.execPath, [ingestPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env,
  });
}

function normalizedOutputHash(root, relativeDir, extension) {
  const directory = path.join(root, relativeDir);
  const names = fs.readdirSync(directory)
    .filter((name) => name.endsWith(extension))
    .filter((name) => name !== "dialect-observations.v1.jsonl")
    .sort();
  const hash = crypto.createHash("sha256");
  for (const name of names) {
    const relativePath = toPosix(path.join(relativeDir, name));
    const contents = fs.readFileSync(path.join(directory, name), "utf8")
      .replace(ISO_TIMESTAMP, "<timestamp>");
    hash.update(relativePath);
    hash.update("\0");
    hash.update(contents);
    hash.update("\0");
  }
  return {
    fileCount: names.length,
    sha256: hash.digest("hex"),
  };
}

function outputHashes(root) {
  return {
    jsonl: normalizedOutputHash(root, ".context/cache", ".jsonl"),
    tsv: normalizedOutputHash(root, ".context/db/import", ".tsv"),
  };
}

function readJsonl(file) {
  return fs.readFileSync(file, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("development and packaged wrappers use the same canonical ingest implementation", () => {
  const packagedRoot = makeFixture();
  const developmentRoot = makeFixture();
  try {
    const packaged = runIngest(packagedRoot);
    const development = runIngest(developmentRoot, [], {}, ROOT_INGEST);
    assert.equal(packaged.status, 0, packaged.stderr);
    assert.equal(development.status, 0, development.stderr);
    assert.deepEqual(outputHashes(developmentRoot), outputHashes(packagedRoot));
  } finally {
    fs.rmSync(packagedRoot, { recursive: true, force: true });
    fs.rmSync(developmentRoot, { recursive: true, force: true });
  }
});

test("multilingual full and incremental ingest match the recorded output hashes", () => {
  const root = makeFixture();
  try {
    initializeGit(root);

    const full = runIngest(root, [], { CORTEX_INGEST_TRACE_MEMORY: "1" });
    assert.equal(full.status, 0, full.stderr);
    assert.match(full.stdout, /^\[ingest\] mode=full$/m);

    const fullHashes = outputHashes(root);
    assert.deepEqual(
      {
        jsonl: fullHashes.jsonl.fileCount,
        tsv: fullHashes.tsv.fileCount,
      },
      { jsonl: 26, tsv: 21 },
    );
    assert.deepEqual(
      {
        jsonl: fullHashes.jsonl.sha256,
        tsv: fullHashes.tsv.sha256,
      },
      EXPECTED_HASHES.full,
    );

    const traceRecords = full.stderr
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.deepEqual(traceRecords.map((record) => record.label), REQUIRED_TRACE_LABELS);
    for (const record of traceRecords) {
      assert.equal(record.type, "cortex.ingest.memory");
      assert.equal(typeof record.label, "string");
      assert.ok(Number.isInteger(record.rss_bytes) && record.rss_bytes > 0);
      assert.equal(typeof record.rss_mb, "number");
      assert.ok(Number.isInteger(record.heap_used_bytes) && record.heap_used_bytes > 0);
      assert.ok(Number.isInteger(record.external_bytes) && record.external_bytes >= 0);
      assert.equal(typeof record.counts, "object");
      assert.notEqual(record.counts, null);
    }
    const workersComplete = traceRecords.find(
      (record) => record.label === "parse:workers_complete",
    );
    // CORTEX_INGEST_WORKERS=0 selects the inline lane, represented by the
    // resolver as worker_count=1; no Worker instance or result is created.
    assert.equal(workersComplete.counts.worker_count, 1);
    assert.equal(workersComplete.counts.worker_results, 0);
    assert.equal(
      workersComplete.counts.worker_results_missing,
      workersComplete.counts.worker_tasks,
    );

    const filesBefore = readJsonl(
      path.join(root, ".context", "cache", "entities.file.jsonl"),
    );
    assert.deepEqual(
      filesBefore.map((record) => record.path),
      filesBefore.map((record) => record.path).toSorted((a, b) => a.localeCompare(b)),
    );
    assert.ok(filesBefore.some((record) => record.path === "src/rapport.py"));
    assert.ok(filesBefore.some((record) => record.path === "docs/overview.md"));
    assert.ok(filesBefore.some((record) => record.path === "legacy/App/App.config"));
    assert.ok(filesBefore.some((record) => record.path === "legacy/App/Resources.resx"));
    assert.ok(filesBefore.some((record) => record.path === "database/report.sql"));

    const appPath = path.join(root, "src", "app.js");
    fs.appendFileSync(appPath, "\nexport const incrementalMarker = true;\n", "utf8");
    fs.utimesSync(appPath, CHANGED_MTIME, CHANGED_MTIME);
    fs.rmSync(path.join(root, "docs", "overview.md"));

    const changed = runIngest(root, ["--changed"]);
    assert.equal(changed.status, 0, changed.stderr);
    assert.equal(changed.stderr, "");
    assert.match(changed.stdout, /^\[ingest\] mode=changed$/m);
    assert.match(
      changed.stdout,
      /^\[ingest\] incremental changed_candidates=1 deleted_paths=1$/m,
    );

    const changedHashes = outputHashes(root);
    assert.deepEqual(
      {
        jsonl: changedHashes.jsonl.sha256,
        tsv: changedHashes.tsv.sha256,
      },
      EXPECTED_HASHES.changed,
    );

    const filesAfter = readJsonl(
      path.join(root, ".context", "cache", "entities.file.jsonl"),
    );
    assert.equal(filesAfter.some((record) => record.path === "docs/overview.md"), false);
    const appAfter = filesAfter.find((record) => record.path === "src/app.js");
    assert.match(appAfter.content, /incrementalMarker/);

    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, ".context", "cache", "manifest.json"), "utf8"),
    );
    assert.equal(manifest.mode, "changed");
    assert.equal(manifest.incremental_mode, true);
    assert.equal(manifest.changed_candidates, 1);
    assert.equal(manifest.deleted_paths, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an unavailable C# parser keeps file-level output and reports parser health", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-ingest-unavailable-parser-"));
  try {
    fs.mkdirSync(path.join(root, ".context"), { recursive: true });
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".context", "config.yaml"),
      "repo_id: unavailable-parser\nsource_paths:\n  - src\n",
      "utf8",
    );
    fs.writeFileSync(path.join(root, ".context", "rules.yaml"), "rules: []\n", "utf8");
    fs.writeFileSync(
      path.join(root, "src", "Program.cs"),
      "public static class Program { public static void Main() { } }\n",
      "utf8",
    );

    const result = runIngest(root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /\[ingest\] warning csharp parser unavailable:/);

    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, ".context", "cache", "manifest.json"), "utf8"),
    );
    assert.equal(manifest.counts.files, 1);
    assert.equal(manifest.counts.chunks, 0);
    assert.equal(manifest.parser_health.csharp.files, 1);
    assert.equal(manifest.parser_health.csharp.available, false);
    assert.equal(manifest.parser_health.csharp.chunks, 0);

    const files = readJsonl(path.join(root, ".context", "cache", "entities.file.jsonl"));
    assert.equal(files.length, 1);
    assert.equal(files[0].path, "src/Program.cs");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
