import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { captureSession } from "../dist/session-capture.js";
import { summarizeSearchResults, isSearchResultItem } from "../dist/search-summary.js";

function makeCalls(count, overrides = {}) {
  const base = new Date("2026-04-14T10:00:00Z");
  return Array.from({ length: count }, (_, i) => ({
    tool: overrides.tool ?? "context.search",
    query: overrides.query ?? `query-${i}`,
    resultCount: overrides.resultCount ?? 3,
    time: new Date(base.getTime() + i * 60_000).toISOString()
  }));
}

let tmpDir;

test.beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-test-"));
});

test.afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- captureSession ---

test("captureSession returns false for fewer than 3 calls", () => {
  assert.equal(captureSession(makeCalls(2), tmpDir), false);
  assert.equal(captureSession([], tmpDir), false);
  assert.equal(captureSession(makeCalls(1), tmpDir), false);
});

test("captureSession returns true and creates file for >= 3 calls", () => {
  assert.equal(captureSession(makeCalls(3), tmpDir), true);
  const rawDir = path.join(tmpDir, "memory", "raw");
  const files = fs.readdirSync(rawDir);
  assert.equal(files.length, 1);
  assert.match(files[0], /^auto-session-.*\.md$/);
});

test("captureSession writes correct YAML frontmatter", () => {
  captureSession(makeCalls(4), tmpDir);
  const rawDir = path.join(tmpDir, "memory", "raw");
  const file = fs.readdirSync(rawDir)[0];
  const content = fs.readFileSync(path.join(rawDir, file), "utf8");

  assert.match(content, /^---\n/);
  assert.match(content, /title: '/);
  assert.match(content, /type: note/);
  assert.match(content, /summary: '/);
  assert.match(content, /trust_level: 40/);
  assert.match(content, /status: draft/);
  assert.match(content, /updated_at: /);
});

test("captureSession includes top queries in output", () => {
  const calls = [
    ...makeCalls(2, { query: "repeated query" }),
    ...makeCalls(2, { query: "another query" })
  ];
  captureSession(calls, tmpDir);
  const rawDir = path.join(tmpDir, "memory", "raw");
  const file = fs.readdirSync(rawDir)[0];
  const content = fs.readFileSync(path.join(rawDir, file), "utf8");

  assert.match(content, /repeated query/);
  assert.match(content, /another query/);
});

test("captureSession includes tool summary", () => {
  const calls = [
    ...makeCalls(2, { tool: "context.search" }),
    ...makeCalls(1, { tool: "context.get_related" })
  ];
  captureSession(calls, tmpDir);
  const rawDir = path.join(tmpDir, "memory", "raw");
  const file = fs.readdirSync(rawDir)[0];
  const content = fs.readFileSync(path.join(rawDir, file), "utf8");

  assert.match(content, /context\.search: 2/);
  assert.match(content, /context\.get_related: 1/);
});

test("captureSession computes duration from first to last call", () => {
  const calls = makeCalls(4); // 1 min apart → 3 min total
  captureSession(calls, tmpDir);
  const rawDir = path.join(tmpDir, "memory", "raw");
  const file = fs.readdirSync(rawDir)[0];
  const content = fs.readFileSync(path.join(rawDir, file), "utf8");

  assert.match(content, /3 min/);
});

test("captureSession handles YAML-special characters in queries via single-quote escaping", () => {
  const calls = makeCalls(3, { query: "key: value # comment {arr: [1]}" });
  captureSession(calls, tmpDir);
  const rawDir = path.join(tmpDir, "memory", "raw");
  const file = fs.readdirSync(rawDir)[0];
  const content = fs.readFileSync(path.join(rawDir, file), "utf8");

  // Should not break YAML frontmatter — title and summary use single quotes
  assert.match(content, /title: '/);
  assert.match(content, /summary: '/);
  // The special characters should appear in the body (top queries section)
  assert.match(content, /key: value # comment/);
});

test("captureSession escapes single quotes in topic", () => {
  const calls = makeCalls(3, { query: "it's a test" });
  captureSession(calls, tmpDir);
  const rawDir = path.join(tmpDir, "memory", "raw");
  const file = fs.readdirSync(rawDir)[0];
  const content = fs.readFileSync(path.join(rawDir, file), "utf8");

  // Single quote in YAML single-quoted string must be doubled
  assert.match(content, /it''s a test/);
});

// --- summarizeSearchResults ---

test("summarizeSearchResults formats results with type, title, score", () => {
  const results = [
    { entity_type: "file", title: "auth.ts", score: 0.95, excerpt: "handles authentication" }
  ];
  const summary = summarizeSearchResults("auth", results);

  assert.match(summary, /Found 1 result for "auth"/);
  assert.match(summary, /\[file\] auth\.ts \(score: 0\.95\)/);
  assert.match(summary, /handles authentication/);
});

test("summarizeSearchResults truncates excerpts at 150 chars", () => {
  const longExcerpt = "x".repeat(200);
  const results = [{ entity_type: "file", title: "test.ts", excerpt: longExcerpt }];
  const summary = summarizeSearchResults("test", results);

  assert.match(summary, /x{150}\.\.\./);
});

test("summarizeSearchResults limits to 10 results", () => {
  const results = Array.from({ length: 15 }, (_, i) => ({
    entity_type: "file",
    title: `file-${i}.ts`
  }));
  const summary = summarizeSearchResults("files", results);

  assert.match(summary, /Found 15 results/);
  assert.match(summary, /file-9\.ts/);
  assert.doesNotMatch(summary, /file-10\.ts/);
});

test("summarizeSearchResults truncates total output at 2000 chars", () => {
  const results = Array.from({ length: 10 }, (_, i) => ({
    entity_type: "file",
    title: `file-${"a".repeat(100)}-${i}.ts`,
    excerpt: "b".repeat(150),
    matched_rules: ["rule-one", "rule-two"]
  }));
  const summary = summarizeSearchResults("test", results);

  assert.ok(summary.length <= 2000);
});

test("summarizeSearchResults handles missing fields gracefully", () => {
  const results = [
    { id: "chunk:1" },
    { path: "/src/foo.ts" },
    {}
  ];
  const summary = summarizeSearchResults("test", results);

  assert.match(summary, /\[Unknown\] chunk:1/);
  assert.match(summary, /\[Unknown\] \/src\/foo\.ts/);
  assert.match(summary, /\[Unknown\] untitled/);
});

test("summarizeSearchResults includes matched rules", () => {
  const results = [
    { entity_type: "rule", title: "no-eval", matched_rules: ["security", "best-practice"] }
  ];
  const summary = summarizeSearchResults("rules", results);

  assert.match(summary, /Rules: security, best-practice/);
});

// --- isSearchResultItem ---

test("isSearchResultItem returns true for objects with entity_type", () => {
  assert.equal(isSearchResultItem({ entity_type: "file" }), true);
});

test("isSearchResultItem returns true for objects with title", () => {
  assert.equal(isSearchResultItem({ title: "test" }), true);
});

test("isSearchResultItem returns true for objects with path", () => {
  assert.equal(isSearchResultItem({ path: "/foo" }), true);
});

test("isSearchResultItem returns false for null", () => {
  assert.equal(isSearchResultItem(null), false);
});

test("isSearchResultItem returns false for primitives", () => {
  assert.equal(isSearchResultItem("string"), false);
  assert.equal(isSearchResultItem(42), false);
  assert.equal(isSearchResultItem(undefined), false);
});

test("isSearchResultItem returns false for empty objects", () => {
  assert.equal(isSearchResultItem({}), false);
});
