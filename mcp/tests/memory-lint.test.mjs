import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LINT_SCRIPT = path.resolve(__dirname, "../../scripts/memory-lint.mjs");

// ── Helpers ──────────────────────────────────────────────────

function buildFixture() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-lint-"));
  const contextDir = path.join(fixtureRoot, ".context");
  const cacheDir = path.join(contextDir, "cache");
  const compiledDir = path.join(contextDir, "memory", "compiled");
  fs.mkdirSync(compiledDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });

  // Write index files
  fs.writeFileSync(
    path.join(cacheDir, "documents.jsonl"),
    ['{"id":"file:src/search.ts","path":"src/search.ts"}', '{"id":"file:src/server.ts","path":"src/server.ts"}'].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(cacheDir, "entities.chunk.jsonl"),
    '{"id":"chunk:src/search.ts:runContextSearch:1-25"}',
    "utf8"
  );
  fs.writeFileSync(path.join(cacheDir, "entities.adr.jsonl"), "", "utf8");
  fs.writeFileSync(path.join(cacheDir, "entities.rule.jsonl"), "", "utf8");

  return { fixtureRoot, compiledDir };
}

function writeArticle(compiledDir, filename, content) {
  fs.writeFileSync(path.join(compiledDir, filename), content, "utf8");
}

function runLint(fixtureRoot, extraArgs = []) {
  try {
    const stdout = execFileSync("node", [LINT_SCRIPT, "--json", ...extraArgs], {
      env: { ...process.env, CORTEX_PROJECT_ROOT: fixtureRoot },
      encoding: "utf8",
      timeout: 10000
    });
    return { exitCode: 0, ...JSON.parse(stdout) };
  } catch (error) {
    if (error.stdout) {
      return { exitCode: error.status, ...JSON.parse(error.stdout) };
    }
    throw error;
  }
}

function cleanup(fixtureRoot) {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

// ── Tests ────────────────────────────────────────────────────

test("clean article produces no issues", () => {
  const { fixtureRoot, compiledDir } = buildFixture();
  writeArticle(
    compiledDir,
    "clean.md",
    `---
id: memory:clean
title: Clean article
type: gotcha
summary: Everything is fine.
applies_to: file:src/search.ts
sources: src/search.ts
freshness: current
updated_at: 2026-04-08T08:00:00Z
status: active
trust_level: 72
---
A valid memory article.
`
  );

  const result = runLint(fixtureRoot);
  assert.equal(result.summary.errors, 0);
  assert.equal(result.summary.warnings, 0);
  assert.equal(result.summary.articles, 1);
  cleanup(fixtureRoot);
});

test("missing required fields produce errors", () => {
  const { fixtureRoot, compiledDir } = buildFixture();
  writeArticle(
    compiledDir,
    "missing.md",
    `---
id: memory:missing
---
Body text.
`
  );

  const result = runLint(fixtureRoot);
  assert.equal(result.exitCode, 1);
  const errors = result.issues.filter((i) => i.severity === "error");
  const messages = errors.map((i) => i.message);
  assert.ok(messages.some((m) => m.includes("title")));
  assert.ok(messages.some((m) => m.includes("type")));
  assert.ok(messages.some((m) => m.includes("summary")));
  cleanup(fixtureRoot);
});

test("unknown type produces error", () => {
  const { fixtureRoot, compiledDir } = buildFixture();
  writeArticle(
    compiledDir,
    "badtype.md",
    `---
id: memory:badtype
title: Bad type
type: invalid-type
summary: Has bad type.
updated_at: 2026-04-08T08:00:00Z
status: active
---
Body.
`
  );

  const result = runLint(fixtureRoot);
  assert.equal(result.exitCode, 1);
  assert.ok(result.issues.some((i) => i.message.includes('unknown type "invalid-type"')));
  cleanup(fixtureRoot);
});

test("orphaned applies_to targets produce warnings", () => {
  const { fixtureRoot, compiledDir } = buildFixture();
  writeArticle(
    compiledDir,
    "orphaned.md",
    `---
id: memory:orphaned
title: Orphaned refs
type: fix
summary: References nonexistent entities.
applies_to: file:nonexistent.ts, chunk:fake:1-10
sources: does-not-exist.ts
updated_at: 2026-04-08T08:00:00Z
status: active
---
Body text.
`
  );

  const result = runLint(fixtureRoot);
  const warns = result.issues.filter((i) => i.severity === "warn");
  assert.ok(warns.some((w) => w.message.includes("file:nonexistent.ts")));
  assert.ok(warns.some((w) => w.message.includes("chunk:fake:1-10")));
  assert.ok(warns.some((w) => w.message.includes("does-not-exist.ts")));
  cleanup(fixtureRoot);
});

test("valid applies_to and sources produce no orphan warnings", () => {
  const { fixtureRoot, compiledDir } = buildFixture();
  writeArticle(
    compiledDir,
    "linked.md",
    `---
id: memory:linked
title: Well linked
type: gotcha
summary: Links to real entities.
applies_to: file:src/search.ts, chunk:src/search.ts:runContextSearch:1-25
sources: src/server.ts
updated_at: 2026-04-08T08:00:00Z
status: active
---
Body.
`
  );

  const result = runLint(fixtureRoot);
  const orphanWarns = result.issues.filter((i) => i.message.includes("not found in index"));
  assert.equal(orphanWarns.length, 0);
  cleanup(fixtureRoot);
});

test("stale freshness produces warning", () => {
  const { fixtureRoot, compiledDir } = buildFixture();
  writeArticle(
    compiledDir,
    "stale.md",
    `---
id: memory:stale
title: Stale note
type: note
summary: Marked stale.
applies_to: file:src/search.ts
freshness: stale
updated_at: 2025-01-01T00:00:00Z
status: active
---
Old note.
`
  );

  const result = runLint(fixtureRoot);
  assert.ok(result.issues.some((i) => i.message.includes("freshness is marked stale")));
  cleanup(fixtureRoot);
});

test("old updated_at produces stale warning", () => {
  const { fixtureRoot, compiledDir } = buildFixture();
  writeArticle(
    compiledDir,
    "old.md",
    `---
id: memory:old
title: Old article
type: note
summary: Very old.
applies_to: file:src/search.ts
freshness: current
updated_at: 2024-01-01T00:00:00Z
status: active
---
Ancient note.
`
  );

  const result = runLint(fixtureRoot);
  assert.ok(result.issues.some((i) => i.message.includes("days old")));
  cleanup(fixtureRoot);
});

test("duplicate ids produce error", () => {
  const { fixtureRoot, compiledDir } = buildFixture();
  writeArticle(
    compiledDir,
    "dup-a.md",
    `---
id: memory:dup
title: Dup A
type: decision
summary: First.
applies_to: file:src/search.ts
updated_at: 2026-04-08T08:00:00Z
status: active
---
Body A.
`
  );
  writeArticle(
    compiledDir,
    "dup-b.md",
    `---
id: memory:dup
title: Dup B
type: decision
summary: Second.
applies_to: file:src/search.ts
updated_at: 2026-04-08T08:00:00Z
status: active
---
Body B.
`
  );

  const result = runLint(fixtureRoot);
  assert.equal(result.exitCode, 1);
  assert.ok(result.issues.some((i) => i.message.includes('duplicate memory id "memory:dup"')));
  cleanup(fixtureRoot);
});

test("contradicting decisions on same target produce warning", () => {
  const { fixtureRoot, compiledDir } = buildFixture();
  writeArticle(
    compiledDir,
    "decision-a.md",
    `---
id: memory:decision-a
title: Decision A
type: decision
summary: Use approach A.
applies_to: file:src/search.ts
updated_at: 2026-04-08T08:00:00Z
status: active
---
Approach A.
`
  );
  writeArticle(
    compiledDir,
    "decision-b.md",
    `---
id: memory:decision-b
title: Decision B
type: decision
summary: Use approach B.
applies_to: file:src/search.ts
updated_at: 2026-04-08T08:00:00Z
status: active
---
Approach B.
`
  );

  const result = runLint(fixtureRoot);
  assert.ok(result.issues.some((i) => i.message.includes("potential contradiction")));
  cleanup(fixtureRoot);
});

test("supersedes suppresses contradiction warning", () => {
  const { fixtureRoot, compiledDir } = buildFixture();
  writeArticle(
    compiledDir,
    "old-decision.md",
    `---
id: memory:old-decision
title: Old decision
type: decision
summary: Outdated approach.
applies_to: file:src/search.ts
updated_at: 2026-04-01T00:00:00Z
status: active
---
Old approach.
`
  );
  writeArticle(
    compiledDir,
    "new-decision.md",
    `---
id: memory:new-decision
title: New decision
type: decision
summary: Updated approach.
applies_to: file:src/search.ts
supersedes: memory:old-decision
updated_at: 2026-04-08T08:00:00Z
status: active
---
New approach.
`
  );

  const result = runLint(fixtureRoot);
  const contradictions = result.issues.filter((i) => i.message.includes("potential contradiction"));
  assert.equal(contradictions.length, 0);
  cleanup(fixtureRoot);
});

test("broken supersedes reference produces warning", () => {
  const { fixtureRoot, compiledDir } = buildFixture();
  writeArticle(
    compiledDir,
    "broken-supersedes.md",
    `---
id: memory:broken
title: Broken supersedes
type: fix
summary: References nonexistent superseded article.
applies_to: file:src/search.ts
supersedes: memory:does-not-exist
updated_at: 2026-04-08T08:00:00Z
status: active
---
Body.
`
  );

  const result = runLint(fixtureRoot);
  assert.ok(result.issues.some((i) => i.message.includes("supersedes target") && i.message.includes("not found")));
  cleanup(fixtureRoot);
});

test("no compiled directory exits cleanly", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-lint-empty-"));
  fs.mkdirSync(path.join(tmpDir, ".context", "cache"), { recursive: true });

  const result = runLint(tmpDir);
  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.articles, 0);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("empty body produces error", () => {
  const { fixtureRoot, compiledDir } = buildFixture();
  writeArticle(
    compiledDir,
    "nobody.md",
    `---
id: memory:nobody
title: No body
type: note
summary: Has summary but no body.
applies_to: file:src/search.ts
updated_at: 2026-04-08T08:00:00Z
status: active
---
`
  );

  const result = runLint(fixtureRoot);
  assert.ok(result.issues.some((i) => i.message.includes("empty body")));
  cleanup(fixtureRoot);
});

test("no applies_to or sources produces unlinked warning", () => {
  const { fixtureRoot, compiledDir } = buildFixture();
  writeArticle(
    compiledDir,
    "unlinked.md",
    `---
id: memory:unlinked
title: Unlinked article
type: note
summary: No links at all.
updated_at: 2026-04-08T08:00:00Z
status: active
---
Body text.
`
  );

  const result = runLint(fixtureRoot);
  assert.ok(result.issues.some((i) => i.message.includes("no applies_to or sources")));
  cleanup(fixtureRoot);
});
