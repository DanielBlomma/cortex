import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const QUERY_MODULE = fileURLToPath(new URL("../dist/cli/query.js", import.meta.url));
const PROJECT_ROOT = fileURLToPath(new URL("../..", import.meta.url));

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
    "mcp/src/cli/query.ts",
    "--query",
    "CLI argument parsing error handling",
    "--top-k",
    "2",
    "--json",
  ]);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.command, "pattern-evidence");
  assert.equal(parsed.input.target, "mcp/src/cli/query.ts");
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
  const parsed = runJson(["pattern-evidence", "mcp/src/cli/query.ts", "--top-k", "1", "--json"]);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.query_source, "derived_from_target");
  assert.equal(typeof parsed.data.query, "string");
  assert.ok(parsed.data.query.length > 0);
});

test("pattern-evidence rejects malformed --top-k values", () => {
  const parsed = runJson([
    "pattern-evidence",
    "mcp/src/cli/query.ts",
    "--top-k",
    "2junk",
    "--json",
  ], 1);

  assert.equal(parsed.ok, false);
  assert.equal(parsed.command, "pattern-evidence");
  assert.match(parsed.error.message, /must be an integer/);
});

test("json validation errors emit an error envelope", () => {
  const parsed = runJson(["impact", "--json"], 1);

  assert.equal(parsed.ok, false);
  assert.equal(parsed.command, "impact");
  assert.equal(parsed.error.code, "INVALID_ARGS");
  assert.match(parsed.error.message, /Either --entity-id/);
});
