import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  HeartbeatTracker,
  TAMPER_LOCK_FILENAME,
  writeTamperLock,
  readTamperLock,
  removeTamperLock,
} from "../dist/daemon/heartbeat-tracker.js";

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-heartbeat-"));
  fs.mkdirSync(path.join(root, ".context"), { recursive: true });
  return root;
}

function ts(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

test("recordHeartbeat: SessionStart registers an active session", () => {
  const tracker = new HeartbeatTracker({ hostId: "test-host" });
  tracker.recordHeartbeat({
    cli: "claude",
    hook: "SessionStart",
    session_id: "sess-1",
    cwd: "/p",
    ts: ts(),
  });
  assert.equal(tracker.getActiveSessions().length, 1);
});

test("recordHeartbeat: SessionEnd marks session ended", () => {
  const tracker = new HeartbeatTracker();
  tracker.recordHeartbeat({
    cli: "claude",
    hook: "SessionStart",
    session_id: "sess-1",
    cwd: "/p",
    ts: ts(),
  });
  tracker.recordHeartbeat({
    cli: "claude",
    hook: "SessionEnd",
    session_id: "sess-1",
    cwd: "/p",
    ts: ts(),
  });
  assert.equal(tracker.getActiveSessions().length, 0);
});

test("detectTamper: pure idle (only SessionStart) is NOT flagged", () => {
  const tracker = new HeartbeatTracker();
  tracker.recordHeartbeat({
    cli: "claude",
    hook: "SessionStart",
    session_id: "sess-idle",
    cwd: "/p",
    ts: ts(-10 * 60 * 1000), // 10 min ago
  });
  const findings = tracker.detectTamper({
    cwds: ["/p"],
    missingThresholdSeconds: 60,
  });
  assert.equal(findings.length, 0);
});

test("detectTamper: had-activity-then-silence IS flagged", () => {
  const tracker = new HeartbeatTracker({ hostId: "h" });
  tracker.recordHeartbeat({
    cli: "claude",
    hook: "SessionStart",
    session_id: "sess-tamper",
    cwd: "/p",
    ts: ts(-10 * 60 * 1000),
  });
  tracker.recordHeartbeat({
    cli: "claude",
    hook: "PreToolUse",
    session_id: "sess-tamper",
    cwd: "/p",
    ts: ts(-9 * 60 * 1000), // last activity 9 min ago
  });
  const findings = tracker.detectTamper({
    cwds: ["/p"],
    missingThresholdSeconds: 60, // 1 min threshold → 9 min silence is tamper
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].cli, "claude");
  assert.equal(findings[0].session_id, "sess-tamper");
  assert.equal(findings[0].cwd, "/p");
  assert.ok(findings[0].missing_seconds >= 60);
});

test("detectTamper: same session is not flagged twice", () => {
  const tracker = new HeartbeatTracker();
  tracker.recordHeartbeat({
    cli: "claude",
    hook: "SessionStart",
    session_id: "sess-once",
    cwd: "/p",
    ts: ts(-10 * 60 * 1000),
  });
  tracker.recordHeartbeat({
    cli: "claude",
    hook: "PreToolUse",
    session_id: "sess-once",
    cwd: "/p",
    ts: ts(-9 * 60 * 1000),
  });
  const first = tracker.detectTamper({ cwds: ["/p"], missingThresholdSeconds: 60 });
  assert.equal(first.length, 1);
  const second = tracker.detectTamper({ cwds: ["/p"], missingThresholdSeconds: 60 });
  assert.equal(second.length, 0, "session marked ended after first detection");
});

test("detectTamper: ended session is not flagged", () => {
  const tracker = new HeartbeatTracker();
  tracker.recordHeartbeat({
    cli: "claude",
    hook: "SessionStart",
    session_id: "sess-ended",
    cwd: "/p",
    ts: ts(-15 * 60 * 1000),
  });
  tracker.recordHeartbeat({
    cli: "claude",
    hook: "PreToolUse",
    session_id: "sess-ended",
    cwd: "/p",
    ts: ts(-14 * 60 * 1000),
  });
  tracker.recordHeartbeat({
    cli: "claude",
    hook: "SessionEnd",
    session_id: "sess-ended",
    cwd: "/p",
    ts: ts(-13 * 60 * 1000),
  });
  const findings = tracker.detectTamper({
    cwds: ["/p"],
    missingThresholdSeconds: 60,
  });
  assert.equal(findings.length, 0);
});

test("detectTamper: stale session beyond cleanupAfterMs is auto-removed", () => {
  const tracker = new HeartbeatTracker({ cleanupAfterMs: 1000 });
  tracker.recordHeartbeat({
    cli: "claude",
    hook: "SessionStart",
    session_id: "sess-stale",
    cwd: "/p",
    ts: ts(-10 * 1000),
  });
  tracker.recordHeartbeat({
    cli: "claude",
    hook: "PreToolUse",
    session_id: "sess-stale",
    cwd: "/p",
    ts: ts(-9 * 1000),
  });
  assert.equal(tracker._size(), 1);
  tracker.detectTamper({ cwds: ["/p"], missingThresholdSeconds: 60 });
  assert.equal(tracker._size(), 0, "stale session removed");
});

test("writeTamperLock + readTamperLock + removeTamperLock round-trip", () => {
  const root = makeWorkspace();
  try {
    const entry = {
      version: 1,
      detected_at: ts(),
      cli: "claude",
      session_id: "sess-1",
      hook_name: "any",
      last_seen: ts(-60_000),
      missing_seconds: 60,
      host_id: "h",
      cwd: root,
    };
    const written = writeTamperLock(root, entry);
    assert.match(written, new RegExp(TAMPER_LOCK_FILENAME));

    const read = readTamperLock(root);
    assert.deepEqual(read, entry);

    const removed = removeTamperLock(root);
    assert.equal(removed, true);
    assert.equal(readTamperLock(root), null);
    assert.equal(removeTamperLock(root), false, "no-op on second remove");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("recordHeartbeat: response includes tamper_lock_active flag", () => {
  const root = makeWorkspace();
  try {
    const tracker = new HeartbeatTracker();
    const before = tracker.recordHeartbeat({
      cli: "claude",
      hook: "SessionStart",
      session_id: "s",
      cwd: root,
      ts: ts(),
    });
    assert.equal(before.tamper_lock_active, false);

    writeTamperLock(root, {
      version: 1,
      detected_at: ts(),
      cli: "claude",
      session_id: "s",
      hook_name: "any",
      last_seen: ts(),
      missing_seconds: 0,
      host_id: "h",
      cwd: root,
    });

    const after = tracker.recordHeartbeat({
      cli: "claude",
      hook: "PreToolUse",
      session_id: "s",
      cwd: root,
      ts: ts(),
    });
    assert.equal(after.tamper_lock_active, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
