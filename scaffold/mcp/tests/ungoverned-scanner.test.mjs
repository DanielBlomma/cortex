import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runScanOnce, writeHostAuditEvent, startUngovernedScanner } from "../dist/daemon/ungoverned-scanner.js";
import { claimEnterpriseHostIdentity } from "../dist/core/enterprise-host-identity.js";
import { enterpriseCredentialId } from "../dist/core/license.js";

function makeWorkspace(governMode, installs = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-ungoverned-"));
  const ctx = path.join(root, ".context");
  fs.mkdirSync(ctx, { recursive: true });
  if (governMode) {
    const defaultInstalls = {
      claude: { mode: governMode, path: "/x", version: "v", frameworks: [], installed_at: "now" },
    };
    fs.writeFileSync(
      path.join(ctx, "govern.local.json"),
      JSON.stringify({
        installs: installs ?? defaultInstalls,
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

test("runScanOnce: does not write unattributed host process metadata into project audit", async () => {
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

    assert.equal(
      fs.existsSync(path.join(root, ".context", "audit")),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runScanOnce: writes detections only to the credential-bound user-global queue", async () => {
  const { root } = makeWorkspace("advisory");
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-global-events-"));
  const endpoint = "https://events.example.com";
  const apiKey = "ent_global_events_12345678";
  const credentialId = enterpriseCredentialId(endpoint, apiKey);
  process.env.HOME = homeDir;
  try {
    assert.equal(
      claimEnterpriseHostIdentity(credentialId, endpoint),
      true,
    );
    await runScanOnce({
      cwd: root,
      credentialId,
      detectorOptions: {
        hostId: "host-global",
        processes: [
          {
            pid: 4321,
            ppid: 1,
            user: os.userInfo().username,
            comm: "claude",
            args: "claude --prompt private",
          },
        ],
      },
    });

    assert.equal(fs.existsSync(path.join(root, ".context", "audit")), false);
    const queueDir = path.join(homeDir, ".cortex", "host-events");
    const queueFile = fs.readdirSync(queueDir).find((name) =>
      name.startsWith("ungoverned-")
    );
    assert.ok(queueFile);
    assert.equal(fs.statSync(path.join(queueDir, queueFile)).mode & 0o777, 0o600);
    const event = JSON.parse(
      fs.readFileSync(path.join(queueDir, queueFile), "utf8").trim(),
    );
    assert.equal(event.credential_id, credentialId);
    assert.equal(event.pid, 4321);
    assert.match(event.args, /private/);
  } finally {
    delete process.env.HOME;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
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

    assert.deepEqual(killed, [99999, "SIGTERM"]);
    assert.equal(
      fs.existsSync(path.join(root, ".context", "audit")),
      false,
    );
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

test("runScanOnce: skips Tier 1 CLIs that already have managed installs", async () => {
  const { root } = makeWorkspace("enforced");
  const managedClaudePath = path.join(root, "managed-settings.json");
  fs.writeFileSync(
    managedClaudePath,
    JSON.stringify({ allowManagedHooksOnly: true }) + "\n",
  );
  const managedCodexPath = path.join(root, "requirements.toml");
  fs.writeFileSync(
    managedCodexPath,
    "# Cortex govern — codex requirements (test).\n",
  );
  fs.writeFileSync(
    path.join(root, ".context", "govern.local.json"),
    JSON.stringify({
      installs: {
        claude: {
          mode: "enforced",
          path: managedClaudePath,
          version: "v1",
          frameworks: [],
          installed_at: "now",
        },
        codex: {
          mode: "enforced",
          path: managedCodexPath,
          version: "v2",
          frameworks: [],
          installed_at: "now",
        },
      },
    }),
  );
  try {
    const fakeProcs = [
      { pid: 200, ppid: 1, user: os.userInfo().username, comm: "claude", args: "claude --prompt hi" },
      { pid: 300, ppid: 1, user: os.userInfo().username, comm: "codex", args: "codex exec hi" },
      { pid: 400, ppid: 1, user: os.userInfo().username, comm: "copilot", args: "copilot suggest" },
    ];
    const findings = await runScanOnce({
      cwd: root,
      mode: "enforced",
      managedPathOverrides: {
        claude: managedClaudePath,
        codex: managedCodexPath,
      },
      detectorOptions: { processes: fakeProcs, hostId: "test-host" },
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].cli, "copilot");

    assert.equal(fs.existsSync(path.join(root, ".context", "audit")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runScanOnce: forged persisted paths cannot suppress Tier 1 findings", async () => {
  const { root } = makeWorkspace("advisory", {
    claude: {
      mode: "advisory",
      path: "/bin/sh",
      version: "forged",
      frameworks: [],
      installed_at: "now",
    },
  });
  try {
    const findings = await runScanOnce({
      cwd: root,
      mode: "advisory",
      detectorOptions: {
        processes: [{
          pid: 7654,
          ppid: 1,
          user: os.userInfo().username,
          comm: "claude",
          args: "claude --prompt hi",
        }],
      },
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].cli, "claude");
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
