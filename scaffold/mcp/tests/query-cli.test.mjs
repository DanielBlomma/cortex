import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const QUERY_MODULE = fileURLToPath(new URL("../dist/cli/query.js", import.meta.url));
const PROJECT_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

function runQuery(args) {
  const script = [
    "const mod = await import(process.argv[1]);",
    "await mod.runQueryCommand(JSON.parse(process.argv[2]));",
  ].join("\n");

  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      script,
      pathToFileURL(QUERY_MODULE).href,
      JSON.stringify(args),
    ],
    {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      env: { ...process.env, CORTEX_PROJECT_ROOT: PROJECT_ROOT },
    },
  );
}

function runJson(args, expectedStatus = 0) {
  const result = runQuery(args);
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("rules --json emits a stable envelope", () => {
  const parsed = runJson(["rules", "--json"]);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.command, "rules");
  assert.equal(parsed.input.include_inactive, false);
  assert.ok(["ryu", "cache"].includes(String(parsed.context_source)));
  assert.ok(Array.isArray(parsed.data.rules));
  assert.equal(parsed.data.count, parsed.data.rules.length);
});

test("search --json maps flags to context.search input", () => {
  const parsed = runJson([
    "search",
    "rule.source_of_truth",
    "--top-k",
    "3",
    "--preset",
    "full",
    "--scores",
    "--matched-rules",
    "--json",
  ]);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.command, "search");
  assert.equal(parsed.input.query, "rule.source_of_truth");
  assert.equal(parsed.input.top_k, 3);
  assert.equal(parsed.input.response_preset, "full");
  assert.equal(parsed.input.include_scores, true);
  assert.equal(parsed.input.include_matched_rules, true);
  assert.ok(Array.isArray(parsed.data.results));
  assert.ok(parsed.data.results.length <= 3);
});

test("related --json preserves missing-entity runtime behavior", () => {
  const parsed = runJson(["related", "file:no-such-file", "--json"]);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.command, "related");
  assert.equal(parsed.input.entity_id, "file:no-such-file");
  assert.deepEqual(parsed.data.related, []);
  assert.match(parsed.data.warning, /Entity not found/);
});

test("impact --json supports positional entity ids", () => {
  const parsed = runJson([
    "impact",
    "file:bin/cortex.mjs",
    "--depth",
    "1",
    "--top-k",
    "2",
    "--json",
  ]);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.command, "impact");
  assert.equal(parsed.input.entity_id, "file:bin/cortex.mjs");
  assert.equal(parsed.input.depth, 1);
  assert.equal(parsed.input.top_k, 2);
  assert.ok(Array.isArray(parsed.data.results));
});

test("explain --json enables scores and matched rules", () => {
  const parsed = runJson(["explain", "rule.source_of_truth", "--json"]);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.command, "explain");
  assert.equal(parsed.input.include_scores, true);
  assert.equal(parsed.input.include_matched_rules, true);
  assert.equal(parsed.data.explanation.includes("context.search"), true);
  assert.ok(Array.isArray(parsed.data.results));
});

test("pattern-evidence --json emits ordered cited evidence tiers", () => {
  const parsed = runJson([
    "pattern-evidence",
    "bin/cli/query-command.mjs",
    "--query",
    "CLI argument parsing error handling",
    "--top-k",
    "2",
    "--json",
  ]);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.command, "pattern-evidence");
  assert.equal(parsed.input.target, "bin/cli/query-command.mjs");
  assert.equal(parsed.input.top_k, 2);
  assert.deepEqual(parsed.data.evidence_order, [
    "same_file",
    "same_module",
    "same_feature_area",
    "repo_wide",
  ]);
  assert.equal(typeof parsed.data.local_pattern_found, "boolean");
  assert.equal(parsed.data.tiers.length, 4);
  for (const tier of parsed.data.tiers) {
    assert.ok(Array.isArray(tier.evidence));
    for (const evidence of tier.evidence) {
      assert.equal(typeof evidence.path, "string");
      assert.ok(evidence.path.length > 0);
      if (evidence.entity_type === "Chunk") {
        assert.equal(Number.isInteger(evidence.start_line), true);
        assert.equal(Number.isInteger(evidence.end_line), true);
      }
    }
  }
});

test("pattern-evidence --json rejects targets that are not file-backed", () => {
  const parsed = runJson(["pattern-evidence", "rule.source_of_truth", "--json"], 1);

  assert.equal(parsed.ok, false);
  assert.equal(parsed.command, "pattern-evidence");
  assert.match(parsed.error.message, /not file-backed/);
});

test("pattern-evidence derives a query from the target when --query is omitted", () => {
  const parsed = runJson(["pattern-evidence", "bin/cli/query-command.mjs", "--top-k", "1", "--json"]);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.query_source, "derived_from_target");
  assert.equal(typeof parsed.data.query, "string");
  assert.ok(parsed.data.query.length > 0);
});

test("pattern-evidence rejects malformed --top-k values", () => {
  const parsed = runJson([
    "pattern-evidence",
    "bin/cli/query-command.mjs",
    "--top-k",
    "2junk",
    "--json",
  ], 1);

  assert.equal(parsed.ok, false);
  assert.equal(parsed.command, "pattern-evidence");
  assert.match(parsed.error.message, /must be an integer/);
});

test("conventions --json emits versioned deterministic profiles", () => {
  const parsed = runJson(["conventions", "bin/cli/query-command.mjs", "--json"]);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.command, "conventions");
  assert.equal(parsed.input.target, "bin/cli/query-command.mjs");
  assert.equal(parsed.data.schema_version, 1);
  assert.ok(parsed.data.profile_count >= 1);
  assert.equal(parsed.data.profiles.length, parsed.data.profile_count);
  for (const profile of parsed.data.profiles) {
    assert.equal(typeof profile.profile_hash, "string");
    assert.equal(typeof profile.source_hash, "string");
    assert.ok(Array.isArray(profile.reusable_symbols));
    assert.ok(profile.structural_facts.every((fact) => fact.normative === false));
  }
});

test("guidance --json emits deterministic hashed additive context without persistence", () => {
  const manifestPath = path.join(PROJECT_ROOT, ".context", "cache", "conventions", "v1", "manifest.json");
  const before = fs.statSync(manifestPath);
  const beforeBytes = fs.readFileSync(manifestPath);
  const args = ["guidance", "bin/cli/query-command.mjs", "--task", "add strict guidance argument validation", "--json"];
  const firstResult = runQuery(args);
  const secondResult = runQuery(args);
  assert.equal(firstResult.status, 0, firstResult.stderr);
  assert.equal(secondResult.status, 0, secondResult.stderr);
  assert.equal(firstResult.stdout, secondResult.stdout);
  const parsed = JSON.parse(firstResult.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.command, "guidance");
  assert.equal(parsed.schema_version, 1);
  assert.equal(parsed.generator_version, "repo-guidance-v1");
  assert.match(parsed.input.task_hash, /^[a-f0-9]{64}$/u);
  assert.equal(firstResult.stdout.includes("add strict guidance argument validation"), false);
  assert.ok(parsed.data.active_governing_rules.items.length <= 8);
  assert.ok(parsed.data.reusable_symbols.items.length <= 12);
  assert.ok(parsed.data.concrete_examples.items.length <= 6);
  assert.equal(Object.hasOwn(parsed.data, "retrieval_evidence"), false);
  assert.equal(Object.hasOwn(parsed.data.limits, "max_retrieval_evidence"), false);
  assert.ok(parsed.data.conflicts.items.length <= 10);
  assert.deepEqual(fs.readFileSync(manifestPath), beforeBytes);
  assert.equal(fs.statSync(manifestPath).mtimeMs, before.mtimeMs);
});

test("guidance rejects missing, repeated, unknown, surplus, and unsafe arguments without task leakage", () => {
  const secret = "guidance-secret-do-not-echo";
  for (const args of [
    ["guidance", "bin/cli/query-command.mjs", "--json"],
    ["guidance", "bin/cli/query-command.mjs", "--task", secret, "--task", "again", "--json"],
    ["guidance", "bin/cli/query-command.mjs", "--task", secret, "--unknown", "x", "--json"],
    ["guidance", "bin/cli/query-command.mjs", "extra.ts", "--task", secret, "--json"],
    ["guidance", "bin/cli/query-command.mjs", "--task", `${secret}\nline`, "--json"],
    ["guidance", "--target", "bin/cli/query-command.mjs", "--task", secret, "--json"],
    ["guidance", "bin/cli/query-command.mjs", "--target", "README.md", "--task", secret, "--json"],
    ["guidance", "bin/cli/query-command.mjs", "--task", "", "--json"],
    ["guidance", "bin/cli/query-command.mjs", "--task", secret, "--json", "--json"],
    ["guidance", "file:/private/secret.ts", "--task", secret, "--json"],
    ["guidance", "chunk:../secret.ts:name:1-2", "--task", secret, "--json"],
  ]) {
    const result = runQuery(args);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.equal(result.stderr, "");
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.command, "guidance");
    assert.equal(parsed.schema_version, 1);
    assert.equal(result.stdout.includes(secret), false);
    assert.ok(Buffer.byteLength(result.stdout) < 1_024);
  }
});

test("conventions --json rejects malformed and non-code-backed targets", () => {
  const malformed = runJson(["conventions", "../outside.ts", "--json"], 1);
  assert.equal(malformed.ok, false);
  assert.equal(malformed.command, "conventions");
  assert.match(malformed.error.message, /Invalid repository-relative/);

  const rule = runJson(["conventions", "rule.source_of_truth", "--json"], 1);
  assert.equal(rule.ok, false);
  assert.match(rule.error.message, /not code-backed/);
});

test("conventions bounds and sanitizes near/over-limit JSON and text errors before persistence", () => {
  const manifestPath = path.join(PROJECT_ROOT, ".context", "cache", "conventions", "v1", "manifest.json");
  const before = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath) : null;
  const nearTarget = "x".repeat(1024);
  const near = runQuery(["conventions", nearTarget, "--json"]);
  assert.equal(near.status, 1, near.stderr || near.stdout);
  const nearParsed = JSON.parse(near.stdout);
  assert.deepEqual(nearParsed.input, { target: nearTarget });
  assert.equal(near.stdout, `${JSON.stringify(nearParsed, null, 2)}\n`);
  assert.ok(Buffer.byteLength(near.stdout) < 4096);

  const overTarget = `external-secret-${"x".repeat(1025)}`;
  const overJson = runQuery(["conventions", overTarget, "--json"]);
  assert.equal(overJson.status, 1, overJson.stderr || overJson.stdout);
  const overParsed = JSON.parse(overJson.stdout);
  assert.deepEqual(overParsed.input, { target: "[rejected]" });
  assert.equal(overJson.stdout, `${JSON.stringify(overParsed, null, 2)}\n`);
  assert.equal(overJson.stdout.includes("external-secret"), false);
  assert.ok(Buffer.byteLength(overJson.stdout) < 1024);

  const overText = runQuery(["conventions", overTarget]);
  assert.notEqual(overText.status, 0);
  assert.equal(overText.stdout.includes("external-secret"), false);
  assert.equal(overText.stderr.includes("external-secret"), false);
  assert.ok(Buffer.byteLength(overText.stderr) < 4096);

  const after = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath) : null;
  assert.deepEqual(after, before);
});

test("conventions applies the entity limit to dot and colon rule and ADR IDs in JSON and text", () => {
  const manifestPath = path.join(PROJECT_ROOT, ".context", "cache", "conventions", "v1", "manifest.json");
  const before = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath) : null;
  for (const prefix of ["rule.", "rule:", "adr.", "adr:"]) {
    for (const length of [999, 1000]) {
      const target = `${prefix}${"x".repeat(length - prefix.length)}`;
      const json = runQuery(["conventions", target, "--json"]);
      assert.equal(json.status, 1, json.stderr || json.stdout);
      const parsed = JSON.parse(json.stdout);
      assert.deepEqual(parsed.input, { target });
      assert.match(parsed.error.message, /not code-backed/);

      const text = runQuery(["conventions", target]);
      assert.notEqual(text.status, 0);
      assert.equal(text.stdout.includes(target), false);
      assert.equal(text.stderr.includes(target), false);
    }
    const target = `${prefix}${"x".repeat(1001 - prefix.length)}`;
    const json = runQuery(["conventions", target, "--json"]);
    assert.equal(json.status, 1, json.stderr || json.stdout);
    const parsed = JSON.parse(json.stdout);
    assert.deepEqual(parsed.input, { target: "[rejected]" });
    assert.equal(json.stdout.includes(target), false);

    const text = runQuery(["conventions", target]);
    assert.notEqual(text.status, 0);
    assert.equal(text.stdout.includes(target), false);
    assert.equal(text.stderr.includes(target), false);
  }
  const after = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath) : null;
  assert.deepEqual(after, before);
});

test("json validation errors emit an error envelope", () => {
  const parsed = runJson(["impact", "--json"], 1);

  assert.equal(parsed.ok, false);
  assert.equal(parsed.command, "impact");
  assert.equal(parsed.error.code, "INVALID_ARGS");
  assert.match(parsed.error.message, /Either --entity-id/);
});
