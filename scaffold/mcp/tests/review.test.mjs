import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  REVIEW_GENERATOR_VERSION,
  REVIEW_LIMITS,
  canonicalReviewJson,
  formatReviewPublicText,
  runDiffReview,
  serializeReviewPublicError,
  serializeReviewPublicResponse,
  validateReviewData,
  validateReviewDataWithContext,
} from "../dist/review.js";

const NOW = "2026-01-01T00:00:00.000Z";

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function write(root, repoPath, contents) {
  const target = path.join(root, ...repoPath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function fixture(options = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-review-")));
  write(root, ".gitignore", "ignored.txt\n.context/\n");
  write(root, "src/shared.ts", "export function sharedLogger(value: string) { return value; }\n");
  write(root, "src/main.ts", "export function main(value: string) { return value; }\n");
  write(root, "tests/main.test.ts", "export function fixtureValue() { return 1; }\n");
  git(root, ["init", "-q"]);
  git(root, ["add", "."]);
  git(root, ["-c", "user.name=Cortex", "-c", "user.email=cortex@example.invalid", "commit", "-qm", "fixture"]);
  const documents = [
    ["src/shared.ts", "export function sharedLogger(value: string) { return value; }\n"],
    ["src/main.ts", "export function main(value: string) { return value; }\n"],
    ["tests/main.test.ts", "export function fixtureValue() { return 1; }\n"],
  ].map(([repoPath, content]) => ({ id: `file:${repoPath}`, path: repoPath, kind: "CODE", updated_at: NOW, source_of_truth: false, trust_level: 80, status: "active", excerpt: content.trim(), content }));
  const chunks = [
    { id: "chunk:src/shared.ts:sharedLogger:1-1", file_id: "file:src/shared.ts", name: "sharedLogger", kind: "function", signature: "sharedLogger(value)", body: "function sharedLogger(value: string) { return value; }", description: "function. exported. sharedLogger(value).", start_line: 1, end_line: 1, language: "typescript", exported: true, updated_at: NOW, source_of_truth: false, trust_level: 80, status: "active" },
    { id: "chunk:src/main.ts:main:1-1", file_id: "file:src/main.ts", name: "main", kind: "function", signature: "main(value)", body: "function main(value: string) { return value; }", description: "function. exported. main(value).", start_line: 1, end_line: 1, language: "typescript", exported: true, updated_at: NOW, source_of_truth: false, trust_level: 80, status: "active" },
    { id: "chunk:tests/main.test.ts:fixtureValue:1-1", file_id: "file:tests/main.test.ts", name: "fixtureValue", kind: "function", signature: "fixtureValue()", body: "function fixtureValue() { return 1; }", description: "function. exported. fixtureValue().", start_line: 1, end_line: 1, language: "typescript", exported: true, updated_at: NOW, source_of_truth: false, trust_level: 80, status: "active" },
  ];
  const ruleBodies = options.conflict
    ? ["convention:review.forbid.logging_convention = literal:console.log", "convention:review.forbid.logging_convention = literal:print("]
    : options.authority ? ["convention:review.forbid.logging_convention = literal:console.log"] : [];
  const rules = ruleBodies.map((body, index) => ({ id: `rule.review_${index}`, title: `review ${index}`, body, scope: "global", updated_at: NOW, source_of_truth: true, trust_level: 100, status: "active", priority: 100 - index }));
  const relations = [
    ...documents.flatMap((document) => [{ from: "module:src", to: document.id, relation: "CONTAINS", note: "" }]).filter((relation) => relation.to.startsWith("file:src/")),
    ...chunks.map((chunk) => ({ from: chunk.file_id, to: chunk.id, relation: "DEFINES", note: "" })),
    { from: "module:src", to: chunks[0].id, relation: "EXPORTS", note: "" },
    { from: "module:src", to: chunks[1].id, relation: "EXPORTS", note: "" },
    { from: "module:tests", to: documents[2].id, relation: "CONTAINS", note: "" },
    { from: "module:tests", to: chunks[2].id, relation: "EXPORTS", note: "" },
  ];
  const data = {
    documents, chunks, rules, adrs: [],
    modules: [
      { id: "module:src", path: "src", name: "src", summary: "source", file_count: 2, exported_symbols: "sharedLogger main", updated_at: NOW, source_of_truth: false, trust_level: 80, status: "active" },
      { id: "module:tests", path: "tests", name: "tests", summary: "tests", file_count: 1, exported_symbols: "fixtureValue", updated_at: NOW, source_of_truth: false, trust_level: 80, status: "active" },
    ],
    projects: [], relations,
    ranking: { semantic: 0.4, graph: 0.25, trust: 0.2, recency: 0.15 }, source: "cache",
  };
  return { root, data };
}

function cleanup(root) { fs.rmSync(root, { recursive: true, force: true }); }

function rehash(value) {
  const copy = structuredClone(value);
  delete copy.review_hash;
  value.review_hash = crypto.createHash("sha256").update(canonicalReviewJson(copy)).digest("hex");
}

function rehashAll(value) {
  for (const finding of value.findings.items) {
    const copy = structuredClone(finding); delete copy.id;
    finding.id = `review:${crypto.createHash("sha256").update(canonicalReviewJson(copy)).digest("hex").slice(0, 32)}`;
  }
  for (const conflict of value.conflicts.items) {
    const copy = structuredClone(conflict); delete copy.id;
    conflict.id = `review-conflict:${crypto.createHash("sha256").update(canonicalReviewJson(copy)).digest("hex").slice(0, 32)}`;
  }
  rehash(value);
}

test("review freezes schema, limits, no-diff behavior, and byte-stable JSON/text", async () => {
  const { root, data } = fixture();
  try {
    const first = await runDiffReview({ diff: true }, { repo_root: root, repository_id: "fixture", data });
    const second = await runDiffReview({ diff: true }, { repo_root: root, repository_id: "fixture", data });
    assert.equal(first.generator_version, REVIEW_GENERATOR_VERSION);
    assert.deepEqual(first.limits, REVIEW_LIMITS);
    assert.equal(first.changed_files.observed_count, 0);
    assert.equal(first.findings.observed_count, 0);
    assert.equal(serializeReviewPublicResponse({ diff: true }, first), serializeReviewPublicResponse({ diff: true }, second));
    assert.equal(formatReviewPublicText(first), formatReviewPublicText(second));
    assert.doesNotMatch(serializeReviewPublicResponse({ diff: true }, first), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  } finally { cleanup(root); }
});

test("review collects staged, unstaged, mixed, untracked, ignored, deletion, rename, binary, and duplicate paths canonically", async () => {
  const { root, data } = fixture();
  try {
    write(root, "src/main.ts", "export function main(value: string) {\n  console.log(value);\n  return value;\n}\n");
    git(root, ["add", "src/main.ts"]);
    fs.appendFileSync(path.join(root, "src/main.ts"), "export const tail = 1;\n");
    write(root, "src/new.ts", "export function sharedLogger() { return 'duplicate'; }\n");
    write(root, "ignored.txt", "secret\n");
    fs.unlinkSync(path.join(root, "tests/main.test.ts"));
    git(root, ["mv", "src/shared.ts", "src/renamed.ts"]);
    write(root, "src/blob.bin", Buffer.from([0, 1, 2, 3]));
    const result = await runDiffReview({ diff: true }, { repo_root: root, repository_id: "fixture", data });
    assert.deepEqual(result.changed_files.items.map((item) => item.path), ["src/blob.bin", "src/main.ts", "src/new.ts", "src/renamed.ts", "tests/main.test.ts"]);
    assert.equal(result.changed_files.items.some((item) => item.path === "ignored.txt"), false);
    assert.equal(result.changed_files.items.find((item) => item.path === "src/main.ts").status, "modified");
    assert.equal(result.changed_files.items.find((item) => item.path === "src/new.ts").status, "untracked");
    assert.equal(result.changed_files.items.find((item) => item.path === "src/renamed.ts").old_path, "src/shared.ts");
    assert.equal(result.changed_files.items.find((item) => item.path === "tests/main.test.ts").status, "deleted");
    assert.equal(result.changed_files.items.find((item) => item.path === "src/blob.bin").binary, true);
    assert.equal(new Set(result.changed_files.items.map((item) => item.path)).size, result.changed_files.items.length);
  } finally { cleanup(root); }
});

test("exact active authority creates deterministic findings and exact conflicts suppress them", async () => {
  for (const conflict of [false, true]) {
    const { root, data } = fixture({ authority: !conflict, conflict });
    try {
      write(root, "src/main.ts", "export function main(value: string) { console.log(value); return value; }\n");
      const result = await runDiffReview({ diff: true }, { repo_root: root, repository_id: "fixture", data });
      assert.equal(result.conflicts.observed_count > 0, conflict);
      const deterministic = result.findings.items.filter((item) => item.enforcement === "deterministic");
      assert.equal(deterministic.length > 0, !conflict);
      assert.ok(result.findings.items.every((item) => item.evidence.items.length > 0));
    } finally { cleanup(root); }
  }
});

test("authority eligibility, no-profile diagnostics, fallback, and reversed context stay deterministic", async () => {
  for (const mutation of [
    (rule) => { rule.status = "inactive"; },
    (rule) => { rule.status = "deprecated"; },
    (rule) => { rule.source_of_truth = false; },
  ]) {
    const { root, data } = fixture({ authority: true });
    try {
      mutation(data.rules[0]);
      write(root, "src/main.ts", "export function main(value: string) { console.log(value); return value; }\n");
      const result = await runDiffReview({ diff: true }, { repo_root: root, repository_id: "fixture", data });
      assert.equal(result.findings.items.some((item) => item.enforcement === "deterministic"), false);
    } finally { cleanup(root); }
  }

  const fallback = fixture();
  try {
    write(fallback.root, "root-base.ts", "export function rootBase() { return 1; }\n");
    git(fallback.root, ["add", "root-base.ts"]); git(fallback.root, ["-c", "user.name=Cortex", "-c", "user.email=cortex@example.invalid", "commit", "-qm", "root profile"]);
    fallback.data.documents.push({ id: "file:root-base.ts", path: "root-base.ts", kind: "CODE", updated_at: NOW, source_of_truth: false, trust_level: 80, status: "active", excerpt: "export function rootBase() { return 1; }", content: "export function rootBase() { return 1; }\n" });
    fallback.data.chunks.push({ id: "chunk:root-base.ts:rootBase:1-1", file_id: "file:root-base.ts", name: "rootBase", kind: "function", signature: "rootBase()", body: "function rootBase() { return 1; }", description: "function. exported. rootBase().", start_line: 1, end_line: 1, language: "typescript", exported: true, updated_at: NOW, source_of_truth: false, trust_level: 80, status: "active" });
    fallback.data.relations.push({ from: "file:root-base.ts", to: "chunk:root-base.ts:rootBase:1-1", relation: "DEFINES", note: "" });
    write(fallback.root, "root.ts", "export const rootValue = 1;\n");
    const first = await runDiffReview({ diff: true }, { repo_root: fallback.root, repository_id: "fixture", data: fallback.data });
    const reversedData = structuredClone(fallback.data);
    for (const key of ["documents", "chunks", "rules", "adrs", "modules", "projects", "relations"]) reversedData[key].reverse();
    const second = await runDiffReview({ diff: true }, { repo_root: fallback.root, repository_id: "fixture", data: reversedData });
    assert.equal(canonicalReviewJson(first), canonicalReviewJson(second));
    assert.ok(first.changed_files.items[0].profiles.length > 0);
    assert.ok(first.changed_files.items[0].profiles.every((profile) => profile.selection_tier === "repository_fallback"));
  } finally { cleanup(fallback.root); }

  const empty = fixture();
  try {
    write(empty.root, "new.swift", "let value = 1\n");
    const data = { ...empty.data, documents: [], chunks: [], rules: [], adrs: [], modules: [], projects: [], relations: [] };
    const result = await runDiffReview({ diff: true }, { repo_root: empty.root, repository_id: "fixture", data });
    assert.equal(result.diagnostics.eligible_code_files, 1);
    assert.equal(result.diagnostics.no_applicable_profile, 1);
    assert.deepEqual(result.changed_files.items[0].profiles, []);
  } finally { cleanup(empty.root); }
});

test("closest-profile selection is local and exact, never globally activated by related subsystems", async () => {
  const independent = fixture({ authority: true });
  try {
    independent.data.rules[0].scope = "subsystem";
    independent.data.relations.push({ from: independent.data.rules[0].id, to: "module:src", relation: "CONSTRAINS", note: "" });
    write(independent.root, "tests/main.test.ts", "export function fixtureValue() { console.log('tests'); return 1; }\n");
    const result = await runDiffReview({ diff: true }, { repo_root: independent.root, repository_id: "fixture", data: independent.data });
    assert.ok(result.changed_files.items[0].profiles.length > 0);
    assert.ok(result.changed_files.items[0].profiles.every((profile) => profile.subsystem_id === "module:tests"));
    assert.equal(result.findings.items.some((finding) => finding.enforcement === "deterministic"), false);
  } finally { cleanup(independent.root); }

  const unrelated = fixture();
  try {
    unrelated.data.relations.push({ from: "chunk:src/main.ts:main:1-1", to: "chunk:tests/main.test.ts:fixtureValue:1-1", relation: "CALLS", note: "" });
    write(unrelated.root, "unrelated/new.ts", "export const unrelated = 1;\n");
    const result = await runDiffReview({ diff: true }, { repo_root: unrelated.root, repository_id: "fixture", data: unrelated.data });
    assert.deepEqual(result.changed_files.items[0].profiles, []);
    assert.equal(result.findings.observed_count, 0);
  } finally { cleanup(unrelated.root); }
});

test("review rejects symlink, hard-link, special-file, root, Git, and stale-byte mutations", async (t) => {
  await t.test("symlink leaf", async () => {
    const { root, data } = fixture(); const outside = path.join(root, "outside.ts");
    try { write(root, "outside.ts", "export const outside = 1;\n"); fs.symlinkSync(outside, path.join(root, "src", "link.ts")); await assert.rejects(runDiffReview({ diff: true }, { repo_root: root, repository_id: "fixture", data }), /symbolic link/u); } finally { cleanup(root); }
  });
  await t.test("hard link", async () => {
    const { root, data } = fixture();
    try { const external = path.join(os.tmpdir(), `cortex-review-external-${process.pid}-${Date.now()}.ts`); fs.writeFileSync(external, "export const x = 1;\n"); fs.linkSync(external, path.join(root, "src", "hard.ts")); await assert.rejects(runDiffReview({ diff: true }, { repo_root: root, repository_id: "fixture", data }), /single-link/u); fs.unlinkSync(external); } finally { cleanup(root); }
  });
  await t.test("special file is not an eligible untracked regular file", async (subtest) => {
    if (process.platform === "win32") return subtest.skip("FIFO is not portable on Windows");
    const { root, data } = fixture();
    try { const made = spawnSync("mkfifo", [path.join(root, "src", "pipe.ts")]); assert.equal(made.status, 0); const result = await runDiffReview({ diff: true }, { repo_root: root, repository_id: "fixture", data }); assert.equal(result.changed_files.items.some((item) => item.path === "src/pipe.ts"), false); } finally { cleanup(root); }
  });
  await t.test("root identity hook", async () => {
    const { root, data } = fixture();
    try { write(root, "src/new.ts", "export const value = 1;\n"); await assert.rejects(runDiffReview({ diff: true }, { repo_root: root, repository_id: "fixture", data, hooks: { after_discovery: () => fs.utimesSync(root, new Date(), new Date(Date.now() + 1000)) } }), /repository, Git transaction, candidate identities, or diff/u); } finally { cleanup(root); }
  });
  await t.test("file bytes hook", async () => {
    const { root, data } = fixture();
    try { write(root, "src/new.ts", "export const value = 1;\n"); await assert.rejects(runDiffReview({ diff: true }, { repo_root: root, repository_id: "fixture", data, hooks: { after_file_read: (repoPath) => { if (repoPath === "src/new.ts") fs.appendFileSync(path.join(root, repoPath), "// changed\n"); } } }), /identity or bytes changed/u); } finally { cleanup(root); }
  });
  await t.test("Git identity hook", async () => {
    const { root, data } = fixture();
    try { write(root, "src/new.ts", "export const value = 1;\n"); await assert.rejects(runDiffReview({ diff: true }, { repo_root: root, repository_id: "fixture", data, hooks: { before_context: () => fs.utimesSync(path.join(root, ".git"), new Date(), new Date(Date.now() + 1000)) } }), /repository, Git transaction, candidate identities, or diff/u); } finally { cleanup(root); }
  });
  await t.test("submodule worktree", async () => {
    const { root, data } = fixture();
    const child = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-review-submodule-")));
    try {
      write(child, "README.md", "child\n"); git(child, ["init", "-q"]); git(child, ["add", "."]); git(child, ["-c", "user.name=Cortex", "-c", "user.email=cortex@example.invalid", "commit", "-qm", "child"]);
      git(root, ["-c", "protocol.file.allow=always", "submodule", "add", "-q", child, "vendor/sub"]);
      await assert.rejects(runDiffReview({ diff: true }, { repo_root: root, repository_id: "fixture", data }), /single-link regular file/u);
    } finally { cleanup(root); cleanup(child); }
  });
});

test("review binds the complete Git transaction across discovery, reads, index, untracked, and linked-worktree races", async (t) => {
  await t.test("omitted path appears after discovery", async () => {
    const { root, data } = fixture();
    try {
      write(root, "src/first.ts", "export const first = 1;\n");
      await assert.rejects(runDiffReview({ diff: true }, { repo_root: root, repository_id: "fixture", data, hooks: { after_discovery: () => write(root, "src/omitted.ts", "export const omitted = 1;\n") } }), /Git transaction|changed during collection/u);
    } finally { cleanup(root); }
  });
  await t.test("another candidate changes after the first read", async () => {
    const { root, data } = fixture();
    try {
      write(root, "src/a.ts", "export const a = 1;\n"); write(root, "src/b.ts", "export const b = 1;\n");
      await assert.rejects(runDiffReview({ diff: true }, { repo_root: root, repository_id: "fixture", data, hooks: { after_file_read: (repoPath) => { if (repoPath === "src/a.ts") fs.appendFileSync(path.join(root, "src/b.ts"), "// raced\n"); } } }), /identity or bytes changed/u);
    } finally { cleanup(root); }
  });
  await t.test("index-only identity mutation", async () => {
    const { root, data } = fixture();
    try {
      write(root, "src/new.ts", "export const value = 1;\n");
      await assert.rejects(runDiffReview({ diff: true }, { repo_root: root, repository_id: "fixture", data, hooks: { before_context: () => fs.utimesSync(path.join(root, ".git", "index"), new Date(), new Date(Date.now() + 2000)) } }), /Git transaction|changed during collection/u);
    } finally { cleanup(root); }
  });
  await t.test("untracked add and remove races", async () => {
    for (const mutation of ["add", "remove"]) {
      const { root, data } = fixture();
      try {
        write(root, "src/first.ts", "export const first = 1;\n");
        await assert.rejects(runDiffReview({ diff: true }, { repo_root: root, repository_id: "fixture", data, hooks: { after_discovery: () => mutation === "add" ? write(root, "src/late.ts", "export const late = 1;\n") : fs.unlinkSync(path.join(root, "src", "first.ts")) } }), /disappeared|Git transaction|changed during collection/u);
      } finally { cleanup(root); }
    }
  });
  await t.test("linked-worktree gitdir identity mutation", async () => {
    const primary = fixture(); const linked = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-review-linked-")));
    cleanup(linked);
    try {
      git(primary.root, ["worktree", "add", "--detach", "-q", linked, "HEAD"]);
      write(linked, "src/main.ts", "export function main(value: string) { return value + '!'; }\n");
      const gitDir = git(linked, ["rev-parse", "--absolute-git-dir"]).trim();
      await assert.rejects(runDiffReview({ diff: true }, { repo_root: linked, repository_id: "fixture", data: primary.data, hooks: { before_context: () => fs.utimesSync(path.join(gitDir, "index"), new Date(), new Date(Date.now() + 2000)) } }), /Git transaction|changed during collection/u);
    } finally {
      try { git(primary.root, ["worktree", "remove", "--force", linked]); } catch { /* temporary cleanup */ }
      cleanup(linked); cleanup(primary.root);
    }
  });
});

test("review enforces exact path and byte caps before semantic work", async () => {
  const exactPaths = fixture();
  try {
    for (let index = 0; index < REVIEW_LIMITS.max_changed_paths; index += 1) write(exactPaths.root, `generated/f${String(index).padStart(3, "0")}.txt`, "");
    const result = await runDiffReview({ diff: true }, { repo_root: exactPaths.root, repository_id: "fixture", data: exactPaths.data });
    assert.equal(result.changed_files.observed_count, REVIEW_LIMITS.max_changed_paths);
  } finally { cleanup(exactPaths.root); }

  const { root, data } = fixture();
  try {
    for (let index = 0; index <= REVIEW_LIMITS.max_changed_paths; index += 1) write(root, `generated/f${String(index).padStart(3, "0")}.ts`, "export const x = 1;\n");
    let contextCalled = false;
    await assert.rejects(runDiffReview({ diff: true }, { repo_root: root, repository_id: "fixture", data, hooks: { before_context: () => { contextCalled = true; } } }), /changed path count/u);
    assert.equal(contextCalled, false);
  } finally { cleanup(root); }

  const second = fixture();
  try {
    write(second.root, "src/large.ts", "x".repeat(REVIEW_LIMITS.max_file_diff_utf8_bytes + 1));
    let contextCalled = false;
    await assert.rejects(runDiffReview({ diff: true }, { repo_root: second.root, repository_id: "fixture", data: second.data, hooks: { before_context: () => { contextCalled = true; } } }), /per-file diff input/u);
    assert.equal(contextCalled, false);
  } finally { cleanup(second.root); }

  for (const delta of [-1, 0, 1]) {
    const boundary = fixture();
    try {
      const repoPath = "large.txt";
      const framingBytes = Buffer.byteLength(`untracked\0${repoPath}\0`);
      write(boundary.root, repoPath, "x".repeat(REVIEW_LIMITS.max_file_diff_utf8_bytes - framingBytes + delta));
      if (delta <= 0) {
        const result = await runDiffReview({ diff: true }, { repo_root: boundary.root, repository_id: "fixture", data: boundary.data });
        assert.equal(result.changed_files.items[0].diff_utf8_bytes, REVIEW_LIMITS.max_file_diff_utf8_bytes + delta);
      } else {
        let contextCalled = false;
        await assert.rejects(runDiffReview({ diff: true }, { repo_root: boundary.root, repository_id: "fixture", data: boundary.data, hooks: { before_context: () => { contextCalled = true; } } }), /per-file diff input/u);
        assert.equal(contextCalled, false);
      }
    } finally { cleanup(boundary.root); }
  }

  for (const delta of [-1, 0, 1]) {
    const boundary = fixture();
    try {
      for (let index = 0; index < 5; index += 1) {
        const repoPath = `total-${index}.txt`;
        const framingBytes = Buffer.byteLength(`untracked\0${repoPath}\0`);
        const target = (REVIEW_LIMITS.max_total_diff_utf8_bytes / 5) + (index === 4 ? delta : 0);
        write(boundary.root, repoPath, "x".repeat(target - framingBytes));
      }
      if (delta <= 0) {
        const result = await runDiffReview({ diff: true }, { repo_root: boundary.root, repository_id: "fixture", data: boundary.data });
        assert.equal(result.changed_files.items.reduce((sum, item) => sum + item.diff_utf8_bytes, 0), REVIEW_LIMITS.max_total_diff_utf8_bytes + delta);
      } else {
        let contextCalled = false;
        await assert.rejects(runDiffReview({ diff: true }, { repo_root: boundary.root, repository_id: "fixture", data: boundary.data, hooks: { before_context: () => { contextCalled = true; } } }), /total diff input/u);
        assert.equal(contextCalled, false);
      }
    } finally { cleanup(boundary.root); }
  }
});

test("review applies exact finding and conflict item caps with omission accounting", async () => {
  for (const fileCount of [49, 50, 51]) {
    const { root, data } = fixture({ authority: true });
    try {
      for (let index = 0; index < fileCount; index += 1) write(root, `src/findings/f${String(index).padStart(3, "0")}.ts`, "console.log('x');\n");
      const result = await runDiffReview({ diff: true }, { repo_root: root, repository_id: "fixture", data });
      const observed = fileCount * 2;
      assert.equal(result.findings.observed_count, observed);
      assert.equal(result.findings.items.length, Math.min(observed, REVIEW_LIMITS.max_findings));
      assert.equal(result.findings.omitted_count, Math.max(0, observed - REVIEW_LIMITS.max_findings));
    } finally { cleanup(root); }
  }
  for (const fileCount of [49, 50, 51]) {
    const { root, data } = fixture({ conflict: true });
    try {
      for (let index = 0; index < fileCount; index += 1) write(root, `src/conflicts/f${String(index).padStart(3, "0")}.ts`, "export const x = 1;\n");
      const result = await runDiffReview({ diff: true }, { repo_root: root, repository_id: "fixture", data });
      const observed = fileCount;
      assert.equal(result.conflicts.observed_count, observed);
      assert.equal(result.conflicts.items.length, Math.min(observed, REVIEW_LIMITS.max_conflicts));
      assert.equal(result.conflicts.omitted_count, Math.max(0, observed - REVIEW_LIMITS.max_conflicts));
    } finally { cleanup(root); }
  }
});

test("review fails closed when canonical profile meaning changes before output", async () => {
  const { root, data } = fixture({ authority: true });
  try {
    write(root, "src/main.ts", "export function main(value: string) { console.log(value); return value; }\n");
    await assert.rejects(runDiffReview({ diff: true }, { repo_root: root, repository_id: "fixture", data, hooks: { before_output: () => { data.rules[0].body = "convention:review.forbid.logging_convention = literal:print("; } } }), /context changed|profiles changed/u);
  } finally { cleanup(root); }
});

test("selected profiles and backing identities are validated and rechecked even with zero results", async () => {
  for (const stale of [
    (data) => { data.documents.find((item) => item.path === "src/shared.ts").content = "stale source bytes\n"; },
    (data) => { data.chunks.find((item) => item.name === "sharedLogger").name = "substitutedLogger"; },
  ]) {
    const { root, data } = fixture();
    try {
      stale(data); write(root, "src/main.ts", "export function main(value: string) { return `${value}!`; }\n");
      await assert.rejects(runDiffReview({ diff: true }, { repo_root: root, repository_id: "fixture", data }), /backing bytes are stale|chunk is stale/u);
    } finally { cleanup(root); }
  }
  for (const mutate of [
    (data) => { data.documents[0].id = "file:src/substituted.ts"; },
    (data) => { data.chunks[0].id = "chunk:src/shared.ts:substituted:1-1"; },
    (data) => { data.modules[0].id = "module:substituted"; },
    (data) => { data.projects.push({ id: "project:.", path: ".", name: "root", summary: "root", file_count: 3, exported_symbols: "", updated_at: NOW, source_of_truth: false, trust_level: 80, status: "active" }); },
    (data) => { data.modules.splice(0, 1); },
  ]) {
    const { root, data } = fixture();
    try {
      write(root, "src/main.ts", "export function main(value: string) { return `${value}!`; }\n");
      await assert.rejects(runDiffReview({ diff: true }, { repo_root: root, repository_id: "fixture", data, hooks: { before_output: () => mutate(data) } }), /context changed|backing|identity|profiles changed/u);
    } finally { cleanup(root); }
  }
});

test("selected chunks require fresh canonical semantic backing even for profile-only zero-result review", async () => {
  const control = fixture();
  try {
    write(control.root, "src/main.ts", "export function main(value: string) { return `${value}!`; }\n");
    const result = await runDiffReview({ diff: true }, { repo_root: control.root, repository_id: "fixture", data: control.data });
    assert.equal(result.findings.observed_count, 0);
    assert.equal(result.conflicts.observed_count, 0);
    assert.ok(result.changed_files.items[0].profiles.length > 0);
  } finally { cleanup(control.root); }

  for (const [field, fabricated] of [
    ["body", "function sharedLogger(value: string) { return 'fabricated'; }"],
    ["signature", "sharedLogger(fabricated)"],
    ["kind", "fabricated-kind"],
    ["description", "fabricated canonical-looking description."],
  ]) {
    const { root, data } = fixture();
    try {
      write(root, "src/main.ts", "export function main(value: string) { return `${value}!`; }\n");
      data.chunks.find((item) => item.name === "sharedLogger")[field] = fabricated;
      await assert.rejects(runDiffReview({ diff: true }, { repo_root: root, repository_id: "fixture", data }), /chunk semantic backing is stale or fabricated/u, field);
    } finally { cleanup(root); }
  }

  const liveTamper = fixture();
  try {
    const content = "export function sharedLogger(value: string) { return `${value}!`; }\n";
    write(liveTamper.root, "src/shared.ts", content);
    const document = liveTamper.data.documents.find((item) => item.path === "src/shared.ts");
    document.content = content; document.excerpt = content.trim();
    await assert.rejects(runDiffReview({ diff: true }, { repo_root: liveTamper.root, repository_id: "fixture", data: liveTamper.data }), /chunk semantic backing is stale or fabricated/u);
  } finally { cleanup(liveTamper.root); }
});

test("recursive schema, hash, counts, location, evidence, classification, and profile tampering fail closed", async () => {
  const { root, data } = fixture({ authority: true });
  try {
    write(root, "src/main.ts", "export function main(value: string) { console.log(value); return value; }\n");
    const value = await runDiffReview({ diff: true }, { repo_root: root, repository_id: "fixture", data });
    const mutations = [
      (copy) => { copy.unknown = true; },
      (copy) => { copy.changed_files.observed_count += 1; },
      (copy) => { copy.changed_files.items[0].path = "../escape.ts"; },
      (copy) => { copy.findings.items[0].enforcement = "policy"; },
      (copy) => { copy.findings.items[0].location.start_line = 0; },
      (copy) => { copy.findings.items[0].profile.profile_hash = "0".repeat(64); },
      (copy) => { copy.findings.items[0].evidence.items[0].entity_id = ""; },
      (copy) => { copy.diagnostics.reviewed_code_files += 1; },
    ];
    for (const mutate of mutations) {
      const copy = structuredClone(value); mutate(copy); rehash(copy); assert.throws(() => validateReviewData(copy));
    }
    const rawHash = structuredClone(value); rawHash.diff_hash = "0".repeat(64); assert.throws(() => validateReviewData(rawHash), /hash/u);
    const fabricated = structuredClone(value);
    fabricated.findings.items[0].message = "Fabricated but structurally valid review meaning.";
    const finding = fabricated.findings.items[0];
    const findingCopy = structuredClone(finding); delete findingCopy.id;
    finding.id = `review:${crypto.createHash("sha256").update(canonicalReviewJson(findingCopy)).digest("hex").slice(0, 32)}`;
    rehash(fabricated);
    validateReviewData(fabricated);
    await assert.rejects(validateReviewDataWithContext(fabricated, { repo_root: root, repository_id: "fixture", data }), /canonical current Git/u);
  } finally { cleanup(root); }
});

test("recursive schema rejects coherently rehashed type, ordering, uniqueness, and cross-field tampering", async () => {
  const authority = fixture({ authority: true });
  try {
    write(authority.root, "src/main.ts", "export function main(value: string) { console.log(value); return value; }\n");
    const value = await runDiffReview({ diff: true }, { repo_root: authority.root, repository_id: "fixture", data: authority.data });
    const mutations = [
      (copy) => { copy.changed_files.items[0].diff_utf8_bytes = `${copy.changed_files.items[0].diff_utf8_bytes}`; },
      (copy) => { copy.changed_files.items[0].binary = 0; },
      (copy) => { copy.changed_files.items[0].status = "changed"; },
      (copy) => { copy.changed_files.items[0].old_path = "src/old.ts"; },
      (copy) => { copy.changed_files.items[0].profiles[0].language = 1; },
      (copy) => { copy.changed_files.items[0].profiles[0].selection_tier = "authority"; },
      (copy) => { copy.findings.items[0].confidence = "100"; },
      (copy) => { copy.findings.items[0].path = "src/not-changed.ts"; },
      (copy) => { copy.findings.items[0].evidence.items[0].path = 42; },
      (copy) => { copy.findings.items[0].evidence.items[0].start_line = "1"; },
      (copy) => { copy.findings.items[0].evidence.items.push(structuredClone(copy.findings.items[0].evidence.items[0])); copy.findings.items[0].evidence.observed_count += 1; },
      (copy) => { copy.context_source = { source: "cache" }; },
      (copy) => { copy.diagnostics.reviewed_code_files = "1"; },
      (copy) => { copy.limits.max_findings = `${copy.limits.max_findings}`; },
    ];
    for (const mutate of mutations) { const copy = structuredClone(value); mutate(copy); rehashAll(copy); assert.throws(() => validateReviewData(copy)); }
  } finally { cleanup(authority.root); }

  const conflicting = fixture({ conflict: true });
  try {
    write(conflicting.root, "src/main.ts", "export function main(value: string) { console.log(value); return value; }\n");
    const value = await runDiffReview({ diff: true }, { repo_root: conflicting.root, repository_id: "fixture", data: conflicting.data });
    assert.ok(value.conflicts.items.length > 0);
    const mutations = [
      (copy) => { copy.conflicts.items[0].claims.items.reverse(); },
      (copy) => { copy.conflicts.items[0].claims.items.push(structuredClone(copy.conflicts.items[0].claims.items[0])); copy.conflicts.items[0].claims.observed_count += 1; },
      (copy) => { copy.conflicts.items[0].claims.items[0].priority = "100"; },
      (copy) => { copy.conflicts.items[0].claims.items[0].source_type = "rule"; },
      (copy) => { copy.conflicts.items[0].claims.items[0].evidence = []; },
      (copy) => { copy.conflicts.items[0].claims.observed_count += 1; },
      (copy) => { copy.conflicts.items[0].path = "src/not-changed.ts"; },
      (copy) => { copy.conflicts.items[0].profile.profile_id = "convention-profile:00000000000000000000000000000000"; },
    ];
    for (const mutate of mutations) { const copy = structuredClone(value); mutate(copy); rehashAll(copy); assert.throws(() => validateReviewData(copy)); }
  } finally { cleanup(conflicting.root); }
});

test("review parser input and public errors are bounded and sanitized", () => {
  assert.match(serializeReviewPublicError(new Error("private /tmp/secret\n\u001b[31m")), /Review failed safely/u);
  assert.doesNotMatch(serializeReviewPublicError(new Error("private /tmp/secret\n\u001b[31m")), /secret|tmp/u);
});

test("review is byte, identity, link, size, and mtime neutral across repeated runs", async () => {
  const { root, data } = fixture();
  try {
    write(root, "src/new.ts", "export const value = 1;\n");
    const sentinel = path.join(root, "sentinel.txt"); fs.writeFileSync(sentinel, "external sentinel\n");
    const paths = [path.join(root, ".git", "HEAD"), path.join(root, ".git", "index"), path.join(root, "src", "main.ts"), sentinel];
    const snapshot = () => paths.map((file) => { const stats = fs.lstatSync(file, { bigint: true }); return { file: path.relative(root, file), dev: String(stats.dev), ino: String(stats.ino), mode: String(stats.mode), nlink: String(stats.nlink), size: String(stats.size), mtimeNs: String(stats.mtimeNs), link: stats.isSymbolicLink() ? fs.readlinkSync(file) : null, sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") }; });
    const before = snapshot();
    const first = await runDiffReview({ diff: true }, { repo_root: root, repository_id: "fixture", data });
    const second = await runDiffReview({ diff: true }, { repo_root: root, repository_id: "fixture", data });
    assert.equal(canonicalReviewJson(first), canonicalReviewJson(second));
    assert.deepEqual(snapshot(), before);
  } finally { cleanup(root); }
});

test("review source has no model, embedding, planner, provider, telemetry, network, fetch, Enterprise, or persistence path", () => {
  const source = fs.readFileSync(new URL("../src/review.ts", import.meta.url), "utf8");
  for (const prohibited of ["embedQuery", "loadEmbeddingIndex", "runContextSearch", "planner", "provider", "telemetry", "fetch(", "http.request", "https.request", "context.review", "persistConventionProfiles", "buildAndPersistConventionProfiles"]) assert.equal(source.includes(prohibited), false, prohibited);
  for (const lifecycle of ["bootstrap.sh", "ingest.sh"]) assert.equal(fs.readFileSync(new URL(`../../scripts/${lifecycle}`, import.meta.url), "utf8").includes("review --diff"), false);
});
