import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  DIALECT_CAPABILITY_MANIFEST,
  DIALECT_LIMITS,
  canonicalJson,
  sha256,
} from "../scaffold/scripts/lib/dialect-observation-contract.mjs";
import {
  DIALECT_INDEX_ID,
  DIALECT_MANIFEST_FIELD,
  createDialectObservationFileRecord,
  parseDialectObservationSidecar,
  serializeDialectObservationSidecar,
  summarizeDialectObservationSidecar,
} from "../scaffold/scripts/lib/ingest/pipeline-stages.mjs";
import { MAX_CONTENT_CHARS } from "../scaffold/scripts/lib/ingest/constants.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INGEST = path.join(REPO_ROOT, "scaffold", "scripts", "ingest.mjs");
const FIXED_MTIME = new Date("2026-01-01T00:00:00.000Z");

function emptyEnvelope(status = "ok", message = null, omitted = 0) {
  return {
    diagnostics: {
      message,
      observed_count: omitted,
      omitted_count: omitted,
    },
    observations: [],
    schema_version: 1,
    status,
  };
}

function makeRecord(family, extension, index, envelope = emptyEnvelope()) {
  return createDialectObservationFileRecord({
    repositoryPath: `src/mode-${String(index).padStart(2, "0")}${extension}`,
    sourceSha256: sha256(`source-${family}-${extension}`),
    family,
    syntaxMode: extension,
    observationEnvelope: envelope,
  });
}

function writeFixture(root, source = "export function shared(value) { return value + 1; }\n") {
  fs.mkdirSync(path.join(root, ".context"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".context", "config.yaml"),
    "repo_id: dialect-sidecar\nsource_paths:\n  - src\n",
  );
  fs.writeFileSync(path.join(root, ".context", "rules.yaml"), "rules: []\n");
  fs.writeFileSync(path.join(root, ".gitignore"), ".context/cache/\n.context/db/\n");
  fs.writeFileSync(path.join(root, "src", "shared.js"), source);
  fs.writeFileSync(path.join(root, "src", "broken.js"), "export function broken( {\n");
  fs.writeFileSync(
    path.join(root, "src", "large.js"),
    `export const large = true;\n//${"x".repeat(MAX_CONTENT_CHARS + 10_000)}\n`,
  );
  fs.writeFileSync(path.join(root, "src", "unavailable.cs"), "public class Example {}\n");
  fs.writeFileSync(path.join(root, "src", "structured.config"), "<configuration />\n");
  for (const file of ["shared.js", "broken.js", "large.js", "unavailable.cs", "structured.config"]) {
    fs.utimesSync(path.join(root, "src", file), FIXED_MTIME, FIXED_MTIME);
  }
}

function git(root, args) {
  const hooks = path.join(root, ".git-test-hooks");
  fs.mkdirSync(hooks, { recursive: true });
  const result = spawnSync("git", ["-c", `core.hooksPath=${hooks}`, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: path.join(root, ".git-home"),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: path.join(root, ".git-config"),
    },
  });
  assert.equal(result.status, 0, result.stderr);
}

function initializeGit(root) {
  git(root, ["init"]);
  git(root, ["checkout", "-b", "main"]);
  git(root, ["config", "user.email", "tests@example.com"]);
  git(root, ["config", "user.name", "Cortex Tests"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "fixture"]);
}

function runIngest(root, args = [], workers = 0) {
  return spawnSync(process.execPath, [INGEST, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      CORTEX_PROJECT_ROOT: root,
      CORTEX_DOTNET_CMD: path.join(root, "missing-dotnet"),
      CORTEX_INGEST_WORKERS: String(workers),
    },
  });
}

function sidecarPath(root) {
  return path.join(root, ".context", "cache", "dialect-observations.v1.jsonl");
}

test("all 14 families and 29 canonical modes persist exact bounded records", () => {
  const records = DIALECT_CAPABILITY_MANIFEST.families.flatMap((family) =>
    family.modes.map((mode, index) => makeRecord(family.family, mode.extension, index)));
  assert.equal(DIALECT_CAPABILITY_MANIFEST.families.length, 14);
  assert.equal(records.length, 29);

  const serialized = serializeDialectObservationSidecar(records.toReversed());
  const reparsed = parseDialectObservationSidecar(serialized.text);
  assert.equal(reparsed.records.length, 29);
  assert.deepEqual(
    reparsed.records.map((record) => record.repository_path),
    reparsed.records.map((record) => record.repository_path).toSorted(),
  );
  for (const record of reparsed.records) {
    const identityPayload = { ...record };
    delete identityPayload.record_id;
    assert.equal(record.record_id, `dialect-observation-file-v1:${sha256(canonicalJson(identityPayload))}`);
    assert.deepEqual(Object.keys(record).sort(), [
      "family", "observation_envelope", "record_id", "record_type", "repository_path",
      "schema_version", "source_sha256", "syntax_mode",
    ]);
  }
  const summary = summarizeDialectObservationSidecar(serialized);
  assert.equal(summary.index_id, DIALECT_INDEX_ID);
  assert.equal(summary.file_records, 29);
  assert.equal(summary.sha256, sha256(serialized.text));
});

test("sidecar rejects duplicates, non-canonical bytes, and aggregate caps", () => {
  const record = makeRecord("javascript", ".js", 0);
  assert.throws(() => serializeDialectObservationSidecar([record, record]), /duplicate/);
  const serialized = serializeDialectObservationSidecar([record]);
  assert.throws(() => parseDialectObservationSidecar(serialized.text.trimEnd()), /newline/);
  assert.throws(
    () => serializeDialectObservationSidecar(Array(DIALECT_LIMITS.max_source_catalog_files + 1).fill(record)),
    /cap/,
  );
  assert.throws(
    () => createDialectObservationFileRecord({
      repositoryPath: "src/mismatched.ts",
      sourceSha256: sha256("source"),
      family: "typescript",
      syntaxMode: ".tsx",
      observationEnvelope: emptyEnvelope(),
    }),
    /extension/,
  );

  const truncated = makeRecord(
    "javascript",
    ".js",
    1,
    emptyEnvelope("truncated", "observation cap reached", 3),
  );
  const summary = summarizeDialectObservationSidecar(serializeDialectObservationSidecar([truncated]));
  assert.equal(summary.status_counts.truncated, 1);
  assert.equal(summary.observed_count, 3);
  assert.equal(summary.omitted_count, 3);
});

test("full, changed, sequential, and parallel ingest converge on identical sidecar bytes", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-dialect-sidecar-convergence-"));
  const changedRoot = path.join(parent, "changed");
  const fullRoot = path.join(parent, "full");
  const parallelRoot = path.join(parent, "parallel");
  fs.mkdirSync(changedRoot);
  fs.mkdirSync(fullRoot);
  fs.mkdirSync(parallelRoot);
  try {
    writeFixture(changedRoot);
    initializeGit(changedRoot);
    assert.equal(runIngest(changedRoot).status, 0);
    const finalSource = "export function shared(value) { return value + 2; }\n";
    fs.writeFileSync(path.join(changedRoot, "src", "shared.js"), finalSource);
    fs.utimesSync(path.join(changedRoot, "src", "shared.js"), FIXED_MTIME, FIXED_MTIME);
    const changed = runIngest(changedRoot, ["--changed"]);
    assert.equal(changed.status, 0, changed.stderr);

    writeFixture(fullRoot, finalSource);
    const full = runIngest(fullRoot);
    assert.equal(full.status, 0, full.stderr);
    writeFixture(parallelRoot, finalSource);
    const parallel = runIngest(parallelRoot, [], 4);
    assert.equal(parallel.status, 0, parallel.stderr);

    const expected = fs.readFileSync(sidecarPath(fullRoot), "utf8");
    assert.equal(fs.readFileSync(sidecarPath(changedRoot), "utf8"), expected);
    assert.equal(fs.readFileSync(sidecarPath(parallelRoot), "utf8"), expected);

    const records = parseDialectObservationSidecar(expected).records;
    assert.deepEqual(records.map((record) => record.repository_path), [
      "src/broken.js", "src/large.js", "src/shared.js", "src/unavailable.cs",
    ]);
    assert.equal(records.find((record) => record.repository_path === "src/broken.js").observation_envelope.status, "malformed");
    const truncated = records.find((record) => record.repository_path === "src/large.js").observation_envelope;
    assert.equal(truncated.status, "truncated");
    assert.deepEqual(truncated.observations, []);
    assert.equal(truncated.diagnostics.observed_count, truncated.diagnostics.omitted_count);
    assert.equal(records.find((record) => record.repository_path === "src/unavailable.cs").observation_envelope.status, "unavailable");
    assert.equal(records.some((record) => record.repository_path.endsWith(".config")), false);
    const manifest = JSON.parse(fs.readFileSync(path.join(fullRoot, ".context", "cache", "manifest.json"), "utf8"));
    assert.deepEqual(manifest[DIALECT_MANIFEST_FIELD], summarizeDialectObservationSidecar(parseDialectObservationSidecar(expected)));
    assert.equal(expected.includes(finalSource.trim()), false, "raw source must not be persisted in the sidecar");
    assert.equal(expected.includes(parent), false, "absolute paths must not be persisted in the sidecar");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("changed ingest removes deleted records and rebuilds malformed or stale prior sidecars", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-dialect-sidecar-stale-"));
  try {
    writeFixture(root);
    initializeGit(root);
    assert.equal(runIngest(root).status, 0);
    fs.rmSync(path.join(root, "src", "broken.js"));
    fs.renameSync(path.join(root, "src", "shared.js"), path.join(root, "src", "renamed.js"));
    fs.writeFileSync(sidecarPath(root), "not canonical jsonl\n");
    const changed = runIngest(root, ["--changed"]);
    assert.equal(changed.status, 0, changed.stderr);
    const records = parseDialectObservationSidecar(fs.readFileSync(sidecarPath(root), "utf8")).records;
    assert.equal(records.some((record) => record.repository_path === "src/broken.js"), false);
    assert.deepEqual(
      records.map((record) => record.repository_path),
      ["src/large.js", "src/renamed.js", "src/unavailable.cs"],
    );
    for (const record of records) {
      const parsedSource = fs.readFileSync(path.join(root, record.repository_path), "utf8")
        .slice(0, MAX_CONTENT_CHARS);
      assert.equal(
        record.source_sha256,
        crypto.createHash("sha256").update(parsedSource).digest("hex"),
        "source hash must bind the exact bytes passed to the parser",
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("changed ingest rejects a self-consistent stale prior generation as a whole", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-dialect-sidecar-generation-"));
  try {
    writeFixture(root);
    initializeGit(root);
    assert.equal(runIngest(root).status, 0);
    const expected = fs.readFileSync(sidecarPath(root), "utf8");
    const records = parseDialectObservationSidecar(expected).records;
    const shared = records.find((record) => record.repository_path === "src/shared.js");
    const fabricatedShared = createDialectObservationFileRecord({
      repositoryPath: shared.repository_path,
      sourceSha256: shared.source_sha256,
      family: shared.family,
      syntaxMode: shared.syntax_mode,
      observationEnvelope: emptyEnvelope("unsupported", "fabricated prior record"),
    });
    const unknown = createDialectObservationFileRecord({
      repositoryPath: "src/ghost.js",
      sourceSha256: sha256("ghost source"),
      family: "javascript",
      syntaxMode: ".js",
      observationEnvelope: emptyEnvelope("unsupported", "stale unknown path"),
    });
    const stale = serializeDialectObservationSidecar([
      ...records.filter((record) => record.repository_path !== "src/shared.js"),
      fabricatedShared,
      unknown,
    ]);
    fs.writeFileSync(sidecarPath(root), stale.text);
    const manifestPath = path.join(root, ".context", "cache", "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest[DIALECT_MANIFEST_FIELD] = summarizeDialectObservationSidecar(stale);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const changed = runIngest(root, ["--changed"]);
    assert.equal(changed.status, 0, changed.stderr);
    assert.equal(fs.readFileSync(sidecarPath(root), "utf8"), expected);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
