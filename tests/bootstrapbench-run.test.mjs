/**
 * Unit tests for bootstrapbench runner config and benchmark gates.
 *
 * Run with: node --test tests/bootstrapbench-run.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

import { evaluateBenchmarkGates, validateConfig } from "../benchmark/bootstrapbench/run.mjs";

function minimalConfig(overrides = {}) {
  return {
    run_name: "test",
    repos: ["DanielBlomma/cortex"],
    embed_models: ["Xenova/all-MiniLM-L6-v2"],
    ...overrides
  };
}

function sampleStats(overrides = {}) {
  return {
    repo: { key: "danielblomma__cortex", name: "DanielBlomma/cortex" },
    run: { status: "ok" },
    timings_ms: { total: 60_000 },
    memory: { max_rss_kb: 512_000 },
    ...overrides
  };
}

test("validateConfig: normalizes benchmark gates", () => {
  const config = validateConfig(
    minimalConfig({
      gates: {
        max_rss_mb: 1024,
        max_duration_minutes: 30,
        by_repo: {
          "DanielBlomma/cortex": {
            max_rss_mb: 900,
            max_duration_ms: 10_000
          }
        }
      }
    }),
    "test.json"
  );

  assert.equal(config.gates.max_rss_kb, 1_048_576);
  assert.equal(config.gates.max_duration_ms, 1_800_000);
  assert.equal(config.gates.by_repo["DanielBlomma/cortex"].max_rss_kb, 921_600);
  assert.equal(config.gates.by_repo["DanielBlomma/cortex"].max_duration_ms, 10_000);
});

test("validateConfig: normalizes extra container env and rejects managed env", () => {
  const config = validateConfig(
    minimalConfig({
      env: {
        CORTEX_EMBED_MAX_TOKENS: 2048,
        CORTEX_EMBED_BATCH_SIZE: "4"
      }
    }),
    "test.json"
  );

  assert.deepEqual(config.env, {
    CORTEX_EMBED_MAX_TOKENS: "2048",
    CORTEX_EMBED_BATCH_SIZE: "4"
  });

  assert.throws(
    () => validateConfig(minimalConfig({ env: { CORTEX_EMBED_MODEL: "other" } }), "test.json"),
    /managed by bootstrapbench/
  );
  assert.throws(
    () => validateConfig(minimalConfig({ env: { PATH: "/tmp" } }), "test.json"),
    /must be a CORTEX_\*/
  );
});

test("validateConfig: rejects invalid gates", () => {
  assert.throws(
    () => validateConfig(minimalConfig({ gates: { max_rss_mb: 0 } }), "test.json"),
    /gates\.max_rss_mb/
  );
  assert.throws(
    () =>
      validateConfig(
        minimalConfig({ gates: { max_duration_ms: 10, max_duration_minutes: 1 } }),
        "test.json"
      ),
    /cannot set both/
  );
});

test("evaluateBenchmarkGates: passes under repo-specific RSS and duration thresholds", () => {
  const config = validateConfig(
    minimalConfig({
      gates: {
        max_rss_mb: 400,
        by_repo: {
          danielblomma__cortex: {
            max_rss_mb: 600,
            max_duration_minutes: 2
          }
        }
      }
    }),
    "test.json"
  );

  const evaluation = evaluateBenchmarkGates(sampleStats(), config.gates);
  assert.equal(evaluation.ok, true);
  assert.deepEqual(
    evaluation.checks.map((check) => check.status),
    ["pass", "pass"]
  );
});

test("evaluateBenchmarkGates: fails on threshold breach or missing configured metric", () => {
  const failingConfig = validateConfig(minimalConfig({ gates: { max_rss_mb: 1000, max_duration_ms: 30_000 } }), "test.json");
  const failing = evaluateBenchmarkGates(sampleStats(), failingConfig.gates);
  assert.equal(failing.ok, false);
  assert.deepEqual(
    failing.failures.map((failure) => failure.metric),
    ["total_duration_ms"]
  );

  const missingConfig = validateConfig(minimalConfig({ gates: { max_rss_mb: 1000 } }), "test.json");
  const missing = evaluateBenchmarkGates(sampleStats({ memory: null }), missingConfig.gates);
  assert.equal(missing.ok, false);
  assert.equal(missing.failures[0].status, "missing");

  const nullFieldsConfig = validateConfig(
    minimalConfig({ gates: { max_rss_mb: 1000, max_duration_ms: 120_000 } }),
    "test.json"
  );
  const nullFields = evaluateBenchmarkGates(
    sampleStats({ memory: { max_rss_kb: null }, timings_ms: { total: null } }),
    nullFieldsConfig.gates
  );
  assert.equal(nullFields.ok, false);
  assert.deepEqual(
    nullFields.failures.map((failure) => [failure.metric, failure.status]),
    [
      ["max_rss_mb", "missing"],
      ["total_duration_ms", "missing"]
    ]
  );
});
