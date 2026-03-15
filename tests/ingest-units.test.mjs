/**
 * Unit tests for ingest helper functions: generateChunkDescription,
 * generateModuleSummary, and generateModules.
 *
 * Run with: node --test tests/ingest-units.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateChunkDescription, generateModuleSummary, generateModules } from "../scripts/ingest.mjs";

// ─── generateChunkDescription ────────────────────────────────────────────────

test("generateChunkDescription: basic function with signature", () => {
  const chunk = { kind: "function", signature: "foo()", body: "", exported: false, async: false };
  const result = generateChunkDescription(chunk);
  assert.equal(result, "function. foo().");
});

test("generateChunkDescription: exported async function", () => {
  const chunk = { kind: "function", signature: "bar(x)", body: "", exported: true, async: true };
  const result = generateChunkDescription(chunk);
  assert.equal(result, "function. exported. async. bar(x).");
});

test("generateChunkDescription: extracts JSDoc comment", () => {
  const chunk = {
    kind: "function",
    signature: "process(data)",
    body: "/** Processes input data and returns the result */\nfunction process(data) { return data; }",
    exported: false,
    async: false
  };
  const result = generateChunkDescription(chunk);
  assert.ok(result.includes("Processes input data"), `Expected JSDoc content in: ${result}`);
});

test("generateChunkDescription: extracts line comment", () => {
  const chunk = {
    kind: "function",
    signature: "helper()",
    body: "// This is a helpful utility function\nfunction helper() {}",
    exported: false,
    async: false
  };
  const result = generateChunkDescription(chunk);
  assert.ok(result.includes("This is a helpful utility function"), `Expected comment in: ${result}`);
});

test("generateChunkDescription: ignores short comments (<= 10 chars)", () => {
  const chunk = {
    kind: "function",
    signature: "fn()",
    body: "// hi\nfunction fn() {}",
    exported: false,
    async: false
  };
  const result = generateChunkDescription(chunk);
  assert.equal(result, "function. fn().");
});

test("generateChunkDescription: body with no comments", () => {
  const chunk = {
    kind: "class",
    signature: "class Foo",
    body: "class Foo { constructor() {} }",
    exported: false,
    async: false
  };
  const result = generateChunkDescription(chunk);
  assert.equal(result, "class. class Foo.");
});

test("generateChunkDescription: very long signature is preserved", () => {
  const longSig = "a".repeat(500);
  const chunk = { kind: "function", signature: longSig, body: "", exported: false, async: false };
  const result = generateChunkDescription(chunk);
  assert.ok(result.includes(longSig));
});

// ─── generateModuleSummary ───────────────────────────────────────────────────

test("generateModuleSummary: auto-generated when no README", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-test-"));
  const files = [
    { path: "src/foo.ts", kind: "CODE" },
    { path: "src/bar.ts", kind: "CODE" }
  ];
  const result = generateModuleSummary("src", files, ["foo", "bar"], tmpDir);
  assert.ok(result.startsWith("Module src"), `Expected auto summary, got: ${result}`);
  assert.ok(result.includes("2 files"));
  assert.ok(result.includes("2 code"));
  assert.ok(result.includes("Key exports: foo, bar"));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("generateModuleSummary: reads README.md when present", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-test-"));
  const srcDir = path.join(tmpDir, "src");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, "README.md"), "# My Module\nThis module handles authentication and session management for the app.\n");

  const files = [{ path: "src/auth.ts", kind: "CODE" }];
  const result = generateModuleSummary("src", files, [], tmpDir);
  assert.ok(result.includes("authentication"), `Expected README content, got: ${result}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("generateModuleSummary: falls back to auto if README too short", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-test-"));
  const srcDir = path.join(tmpDir, "src");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, "README.md"), "# Title\nShort.\n");

  const files = [
    { path: "src/a.ts", kind: "CODE" },
    { path: "src/b.ts", kind: "CODE" }
  ];
  const result = generateModuleSummary("src", files, [], tmpDir);
  assert.ok(result.startsWith("Module src"), `Expected auto fallback, got: ${result}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("generateModuleSummary: mixed file types count correctly", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-test-"));
  const files = [
    { path: "lib/index.ts", kind: "CODE" },
    { path: "lib/README.md", kind: "DOC" },
    { path: "lib/utils.ts", kind: "CODE" }
  ];
  const result = generateModuleSummary("lib", files, [], tmpDir);
  assert.ok(result.includes("3 files"), `Expected 3 files, got: ${result}`);
  assert.ok(result.includes("2 code"), `Expected 2 code, got: ${result}`);
  assert.ok(result.includes("1 docs"), `Expected 1 docs, got: ${result}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("generateModuleSummary: single extension detected", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-test-"));
  const files = [
    { path: "src/a.ts", kind: "CODE" },
    { path: "src/b.ts", kind: "CODE" }
  ];
  const result = generateModuleSummary("src", files, [], tmpDir);
  assert.ok(result.includes("TypeScript"), `Expected TypeScript mention, got: ${result}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("generateModuleSummary: multiple extensions — no extension text", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-test-"));
  const files = [
    { path: "src/a.ts", kind: "CODE" },
    { path: "src/b.js", kind: "CODE" }
  ];
  const result = generateModuleSummary("src", files, [], tmpDir);
  assert.ok(!result.includes("TypeScript"), `Expected no extension text, got: ${result}`);
  assert.ok(!result.includes("JavaScript"), `Expected no extension text, got: ${result}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── generateModules ─────────────────────────────────────────────────────────

test("generateModules: skips directories with fewer than 2 files", () => {
  const files = [{ id: "file:src/only.ts", path: "src/only.ts", kind: "CODE", updated_at: "2026-01-01" }];
  const chunks = [];
  const result = generateModules(files, chunks);
  assert.equal(result.modules.length, 0);
  assert.equal(result.containsRelations.length, 0);
});

test("generateModules: creates module for directory with 2+ files", () => {
  const files = [
    { id: "file:src/a.ts", path: "src/a.ts", kind: "CODE", updated_at: "2026-01-01" },
    { id: "file:src/b.ts", path: "src/b.ts", kind: "CODE", updated_at: "2026-01-02" }
  ];
  const chunks = [];
  const result = generateModules(files, chunks);
  assert.equal(result.modules.length, 1);
  assert.equal(result.modules[0].id, "module:src");
  assert.equal(result.modules[0].name, "src");
  assert.equal(result.modules[0].file_count, 2);
  assert.equal(result.containsRelations.length, 2);
});

test("generateModules: CONTAINS_MODULE only creates direct parent-child links", () => {
  const files = [
    { id: "file:a/f1.ts", path: "a/f1.ts", kind: "CODE", updated_at: "2026-01-01" },
    { id: "file:a/f2.ts", path: "a/f2.ts", kind: "CODE", updated_at: "2026-01-01" },
    { id: "file:a/b/f1.ts", path: "a/b/f1.ts", kind: "CODE", updated_at: "2026-01-01" },
    { id: "file:a/b/f2.ts", path: "a/b/f2.ts", kind: "CODE", updated_at: "2026-01-01" },
    { id: "file:a/b/c/f1.ts", path: "a/b/c/f1.ts", kind: "CODE", updated_at: "2026-01-01" },
    { id: "file:a/b/c/f2.ts", path: "a/b/c/f2.ts", kind: "CODE", updated_at: "2026-01-01" }
  ];
  const chunks = [];
  const result = generateModules(files, chunks);

  assert.equal(result.modules.length, 3);
  assert.equal(result.containsModuleRelations.length, 2);

  const cmRels = result.containsModuleRelations;
  assert.ok(cmRels.some(r => r.from === "module:a" && r.to === "module:a/b"));
  assert.ok(cmRels.some(r => r.from === "module:a/b" && r.to === "module:a/b/c"));
  // No direct link from a to a/b/c
  assert.ok(!cmRels.some(r => r.from === "module:a" && r.to === "module:a/b/c"));
});

test("generateModules: exported chunks create EXPORTS relations", () => {
  const files = [
    { id: "file:lib/a.ts", path: "lib/a.ts", kind: "CODE", updated_at: "2026-01-01" },
    { id: "file:lib/b.ts", path: "lib/b.ts", kind: "CODE", updated_at: "2026-01-01" }
  ];
  const chunks = [
    { id: "chunk:lib/a.ts:foo:1-5", file_id: "file:lib/a.ts", name: "foo", exported: true },
    { id: "chunk:lib/b.ts:bar:1-5", file_id: "file:lib/b.ts", name: "bar", exported: true },
    { id: "chunk:lib/b.ts:internal:6-10", file_id: "file:lib/b.ts", name: "internal", exported: false }
  ];
  const result = generateModules(files, chunks);

  assert.equal(result.exportsRelations.length, 2);
  assert.ok(result.exportsRelations.some(r => r.from === "module:lib" && r.to === "chunk:lib/a.ts:foo:1-5"));
  assert.ok(result.exportsRelations.some(r => r.from === "module:lib" && r.to === "chunk:lib/b.ts:bar:1-5"));
});

test("generateModules: window chunks are excluded from module exports", () => {
  const files = [
    { id: "file:lib/a.ts", path: "lib/a.ts", kind: "CODE", updated_at: "2026-01-01" },
    { id: "file:lib/b.ts", path: "lib/b.ts", kind: "CODE", updated_at: "2026-01-01" }
  ];
  const chunks = [
    { id: "chunk:lib/a.ts:foo:1-120", file_id: "file:lib/a.ts", name: "foo", exported: true },
    {
      id: "chunk:lib/a.ts:foo:1-120:window:1:1-80",
      file_id: "file:lib/a.ts",
      name: "foo#window1",
      exported: true
    }
  ];
  const result = generateModules(files, chunks);

  assert.equal(result.exportsRelations.length, 1);
  assert.deepEqual(result.exportsRelations[0], {
    from: "module:lib",
    to: "chunk:lib/a.ts:foo:1-120"
  });
  assert.equal(result.modules[0].exported_symbols, "foo");
});

test("generateModules: no exported chunks means empty exports", () => {
  const files = [
    { id: "file:lib/a.ts", path: "lib/a.ts", kind: "CODE", updated_at: "2026-01-01" },
    { id: "file:lib/b.ts", path: "lib/b.ts", kind: "CODE", updated_at: "2026-01-01" }
  ];
  const chunks = [
    { id: "chunk:lib/a.ts:fn:1-5", file_id: "file:lib/a.ts", name: "fn", exported: false }
  ];
  const result = generateModules(files, chunks);

  assert.equal(result.modules.length, 1);
  assert.equal(result.exportsRelations.length, 0);
  assert.equal(result.modules[0].exported_symbols, "");
});
