import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runScanOnce, writeHostAuditEvent, startUngovernedScanner } from "../dist/daemon/ungoverned-scanner.js";

function makeWorkspace(governMode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-ungoverned-"));
  const ctx = path.join(root, ".context");
  fs.mkdirSync(ctx, { recursive: true });
  if (governMode) {
    fs.writeFileSync(
      path.join(ctx, "govern.local.json"),
      JSON.stringify({
        installs: { claude: { mode: governMode, path: "/x", version: "v", frameworks: [], installed_at: "now" } },
      }),
    );
  }
  return { root, ctx };
}

test("writeHostAuditEvent appends one JSONL line per call", async () => {
  const { root } = makeWorkspace();
  try {
    await writeHostAuditEvent(root, { event_type: "ungoverned_ai_session_detected", pid: 100 });
    await writeHostAuditEvent(root, { event_type: "ungoverned_ai_session_detected", pid: 200 });

    const date = new Date().toISOString().slice(0, 10);
    const file = path.join(root, ".context", "audit", `host-events-${date}.jsonl`);
    const content = fs.readFileSync(file, "utf8").trim().split("\n");
    assert.equal(content.length, 2);
    assert.equal(JSON.parse(content[0]).pid, 100);
    assert.equal(JSON.parse(content[1]).pid, 200);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runScanOnce: writes audit event with action=logged in advisory mode", async () => {
  const { root } = makeWorkspace("advisory");
  try {
    const fakeProcs = [
      { pid: 1, ppid: 0, user: "root", comm: "init", args: "init" },
      { pid: 100, ppid: 1, user: os.userInfo().username, comm: "claude", args: "claude --prompt hi" },
    ];
    const findings = await runScanOnce({
      cwd: root,
      detectorOptions: { processes: fakeProcs, hostId: "test-host" },
    });
    assert.equal(findings.length, 1);

    const date = new Date().toISOString().slice(0, 10);
    const file = path.join(root, ".context", "audit", `host-events-${date}.jsonl`);
    const events = fs.readFileSync(file, "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, "ungoverned_ai_session_detected");
    assert.equal(events[0].cli, "claude");
    assert.equal(events[0].mode, "advisory");
    assert.equal(events[0].action, "logged");
    assert.equal(events[0].host_id, "test-host");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runScanOnce: enforced mode marks action=sigterm but our mock doesn't actually signal real procs", async () => {
  const { root } = makeWorkspace("enforced");
  try {
    const me = os.userInfo().username;
    const fakeProcs = [
      { pid: 99999, ppid: 1, user: me, comm: "claude", args: "claude --prompt hi" },
    ];
    let killed = null;
    // Monkey-patch process.kill for the test (the enforce function uses it as default).
    const origKill = process.kill;
    process.kill = (pid, sig) => {
      killed = [pid, sig];
    };
    try {
      const findings = await runScanOnce({
        cwd: root,
        detectorOptions: { processes: fakeProcs, hostId: "test-host" },
      });
      assert.equal(findings.length, 1);
    } finally {
      process.kill = origKill;
    }

    const date = new Date().toISOString().slice(0, 10);
    const file = path.join(root, ".context", "audit", `host-events-${date}.jsonl`);
    const events = fs.readFileSync(file, "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(events[0].mode, "enforced");
    assert.equal(events[0].action, "sigterm");
    assert.deepEqual(killed, [99999, "SIGTERM"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runScanOnce: emits onFinding callback per detection", async () => {
  const { root } = makeWorkspace("advisory");
  try {
    const fakeProcs = [
      { pid: 200, ppid: 1, user: "alice", comm: "codex", args: "codex --prompt hi" },
      { pid: 300, ppid: 1, user: "alice", comm: "copilot", args: "copilot --prompt hi" },
    ];
    const seen = [];
    await runScanOnce({
      cwd: root,
      mode: "advisory",
      detectorOptions: { processes: fakeProcs },
      onFinding: (f) => seen.push({ cli: f.cli, action: f.action }),
    });
    assert.equal(seen.length, 2);
    assert.deepEqual(seen.map((s) => s.cli).sort(), ["codex", "copilot"]);
    for (const s of seen) assert.equal(s.action, "logged");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("startUngovernedScanner: stop() halts further ticks", async () => {
  const { root } = makeWorkspace("advisory");
  try {
    let calls = 0;
    const handle = startUngovernedScanner({
      cwd: root,
      intervalMs: 50,
      mode: "advisory",
      detectorOptions: { processes: [] },
      onFinding: () => {
        calls += 1;
      },
    });
    // Wait a moment to allow at least the immediate tick.
    await new Promise((resolve) => setTimeout(resolve, 20));
    handle.stop();
    assert.equal(handle.isRunning(), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
