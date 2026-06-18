/**
 * Unit tests for the bootstrapbench cleanup helpers: stale run-dir selection
 * and stopped-container parsing.
 *
 * Run with: node --test tests/bootstrapbench-cleanup.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

import { selectStaleRunDirs, stoppedEvalContainers } from "../benchmark/bootstrapbench/cleanup.mjs";

test("selectStaleRunDirs: keeps the N newest by mtime, returns the rest", () => {
  const entries = [
    { path: "/r/old", mtimeMs: 100 },
    { path: "/r/newest", mtimeMs: 400 },
    { path: "/r/mid", mtimeMs: 200 },
    { path: "/r/recent", mtimeMs: 300 }
  ];
  assert.deepEqual(selectStaleRunDirs(entries, 2), ["/r/mid", "/r/old"]);
});

test("selectStaleRunDirs: keep-latest >= count keeps everything", () => {
  const entries = [
    { path: "/r/a", mtimeMs: 1 },
    { path: "/r/b", mtimeMs: 2 }
  ];
  assert.deepEqual(selectStaleRunDirs(entries, 5), []);
});

test("selectStaleRunDirs: keep-latest 0 marks all stale; empty input is empty", () => {
  assert.deepEqual(selectStaleRunDirs([{ path: "/r/a", mtimeMs: 1 }], 0), ["/r/a"]);
  assert.deepEqual(selectStaleRunDirs([], 3), []);
});

test("stoppedEvalContainers: only stopped bb-* containers", () => {
  const psOutput = [
    "bb-run1-0 Exited (0) 2 minutes ago",
    "bb-run1-1 Up 3 seconds",
    "bb-run2-0 Created",
    "bb-run2-1 Dead",
    "other-container Exited (1) 1 hour ago",
    "bb-run3-0 Restarting (1) 5 seconds ago"
  ].join("\n");
  assert.deepEqual(stoppedEvalContainers(psOutput), ["bb-run1-0", "bb-run2-0", "bb-run2-1"]);
});

test("stoppedEvalContainers: tolerates blank/empty input", () => {
  assert.deepEqual(stoppedEvalContainers(""), []);
  assert.deepEqual(stoppedEvalContainers("\n  \n"), []);
  assert.deepEqual(stoppedEvalContainers(null), []);
});
