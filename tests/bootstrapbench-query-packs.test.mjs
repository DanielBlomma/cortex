/**
 * Unit tests for bootstrapbench semantic quality query packs.
 *
 * Run with: node --test tests/bootstrapbench-query-packs.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchExpectedHit, parseExpectedHit } from "../benchmark/bootstrapbench/run-query-pack.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACK_DIR = path.resolve(__dirname, "../benchmark/bootstrapbench/query-packs/semantic-quality-v1");
const ASCII_RE = /^[\x09\x0a\x0d\x20-\x7e]*$/;
const TRIVIAL_FIND_RE = /^\s*(find|show|locate|open)\s+[`'"]?[\w./-]+\s*[`'"]?\s*\.?\s*$/i;
const SEMANTIC_PROMPT_RE =
  /\b(how|what|when|where|trace|decide|resolve|handle|flow|pattern|fallback|cache|integration|behavior|tests?|metadata|provider|router|serialize|deserialize|compile|runtime)\b/i;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonl(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${filePath}:${index + 1}: invalid JSONL: ${error.message}`);
      }
    });
}

test("semantic query pack manifest matches JSONL files", () => {
  const manifest = readJson(path.join(PACK_DIR, "manifest.json"));
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.pack, "semantic-quality-v1");
  assert.equal(manifest.query_language, "en");

  const listedFiles = new Set(manifest.repos.map((repo) => repo.file));
  const jsonlFiles = fs.readdirSync(PACK_DIR).filter((file) => file.endsWith(".jsonl"));
  assert.deepEqual(new Set(jsonlFiles), listedFiles);

  for (const repo of manifest.repos) {
    const records = readJsonl(path.join(PACK_DIR, repo.file));
    assert.equal(records.length, repo.query_count, `${repo.file} query count`);
  }
});

test("semantic query pack records are structured and task-like", () => {
  const manifest = readJson(path.join(PACK_DIR, "manifest.json"));
  const ids = new Set();

  for (const repo of manifest.repos) {
    const records = readJsonl(path.join(PACK_DIR, repo.file));
    for (const record of records) {
      assert.equal(record.schema_version, manifest.schema_version);
      assert.equal(record.pack, manifest.pack);
      assert.equal(record.repo_key, repo.repo_key);
      assert.equal(record.repo, repo.repo);
      assert.equal(record.repo_sha, repo.repo_sha);
      assert.equal(record.language, "en");
      assert.equal(record.top_k, manifest.default_top_k);
      assert.equal(record.must_keep, true);
      assert.equal(record.review_status, "agent_drafted");

      assert.match(record.id, /^[a-z0-9]+-semantic-\d{3}$/);
      assert.equal(ids.has(record.id), false, `duplicate query id ${record.id}`);
      ids.add(record.id);

      assert.ok(typeof record.query === "string" && record.query.split(/\s+/).length >= 12, record.id);
      assert.match(record.query, ASCII_RE, `${record.id} query must be ASCII English`);
      assert.doesNotMatch(record.query, TRIVIAL_FIND_RE, `${record.id} must not be a file lookup`);
      assert.match(record.query, SEMANTIC_PROMPT_RE, `${record.id} should be task-like`);

      assert.ok(typeof record.category === "string" && record.category.length > 0, record.id);
      assert.ok(Array.isArray(record.expected_hits), `${record.id} expected_hits`);
      assert.ok(record.expected_hits.length >= 2, `${record.id} should require related hits`);
      assert.ok(record.expected_hits.length <= 6, `${record.id} expected_hits should stay reviewable`);
      for (const hit of record.expected_hits) {
        assert.ok(typeof hit === "string" && hit.length > 0, `${record.id} expected hit`);
        assert.match(hit, ASCII_RE, `${record.id} expected hit must be ASCII`);
      }
      assert.ok(typeof record.rationale === "string" && record.rationale.length >= 40, record.id);
    }
  }

  assert.equal(ids.size, 32);
});

test("query pack runner matches expected hits by path and reports symbol strength", () => {
  assert.deepEqual(parseExpectedHit("src/assets.rs::HighlightingAssets::get_syntax"), {
    raw: "src/assets.rs::HighlightingAssets::get_syntax",
    path: "src/assets.rs",
    symbol: "HighlightingAssets::get_syntax",
  });
  assert.deepEqual(parseExpectedHit("scripts/status.sh"), {
    raw: "scripts/status.sh",
    path: "scripts/status.sh",
    symbol: null,
  });

  const results = [
    {
      id: "file:src/assets.rs",
      path: "src/assets.rs",
      title: "src/assets.rs",
    },
    {
      id: "chunk:src/theme.rs:theme_impl:10-30",
      path: "src/theme.rs",
      title: "theme_impl",
      excerpt: "function theme_impl",
    },
  ];

  assert.deepEqual(matchExpectedHit(results, "src/assets.rs::HighlightingAssets::get_syntax"), {
    expected: "src/assets.rs::HighlightingAssets::get_syntax",
    path: "src/assets.rs",
    symbol: "HighlightingAssets::get_syntax",
    rank: 1,
    match_level: "path",
    result_id: "file:src/assets.rs",
    result_path: "src/assets.rs",
    result_title: "src/assets.rs",
  });
  assert.deepEqual(matchExpectedHit(results, "src/theme.rs:theme_impl"), {
    expected: "src/theme.rs:theme_impl",
    path: "src/theme.rs",
    symbol: "theme_impl",
    rank: 2,
    match_level: "symbol",
    result_id: "chunk:src/theme.rs:theme_impl:10-30",
    result_path: "src/theme.rs",
    result_title: "theme_impl",
  });
  assert.equal(matchExpectedHit(results, "src/missing.rs").match_level, "missing");
});
