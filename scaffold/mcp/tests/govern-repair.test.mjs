import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runGovernRepair } from "../dist/cli/govern.js";
import { writeTamperLock } from "../dist/daemon/heartbeat-tracker.js";

function makeWorkspace({ installs }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-repair-"));
  const ctx = path.join(root, ".context");
  fs.mkdirSync(ctx, { recursive: true });
  fs.writeFileSync(
    path.join(ctx, "govern.local.json"),
    JSON.stringify({ installs }, null, 2),
  );
  return { root, ctx };
}

test("repair: errors when nothing is governed yet", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-repair-empty-"));
  fs.mkdirSync(path.join(root, ".context"), { recursive: true });
  try {
    const result = await runGovernRepair({ cwd: root, skipRoot: true });
    assert.equal(result.ok, false);
    assert.match(result.message, /nothing to repair/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("repair: errors when managed file is missing", async () => {
  const { root } = makeWorkspace({
    installs: {
      claude: {
        path: path.join(os.tmpdir(), "definitely-not-here-claude-managed.json"),
        version: "v1",
        frameworks: [{ id: "iso27001", version: "0.1" }],
        installed_at: new Date().toISOString(),
        mode: "advisory",
      },
    },
  });
  try {
    const result = await runGovernRepair({ cwd: root, skipRoot: true });
    assert.equal(result.ok, false);
    assert.match(result.message, /missing/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("repair: errors when copilot shim has been replaced", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-repair-shim-"));
  const ctx = path.join(root, ".context");
  fs.mkdirSync(ctx, { recursive: true });
  const fakeShim = path.join(root, "fake-copilot");
  fs.writeFileSync(fakeShim, "#!/bin/sh\necho NOT a cortex shim\n", { mode: 0o755 });
  fs.writeFileSync(
    path.join(ctx, "govern.local.json"),
    JSON.stringify({
      installs: {
        copilot: {
          path: fakeShim,
          version: "shim-v1",
          frameworks: [],
          installed_at: new Date().toISOString(),
          mode: "advisory",
        },
      },
    }),
  );
  try {
    const result = await runGovernRepair({ cwd: root, skipRoot: true });
    assert.equal(result.ok, false);
    assert.match(result.message, /no longer a cortex shim/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("repair: clears tamper lock when managed paths verify clean", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-repair-ok-"));
  const ctx = path.join(root, ".context");
  fs.mkdirSync(ctx, { recursive: true });
  const claudeManaged = path.join(root, "managed.json");
  fs.writeFileSync(claudeManaged, '{"allowManagedHooksOnly":true}');
  fs.writeFileSync(
    path.join(ctx, "govern.local.json"),
    JSON.stringify({
      installs: {
        claude: {
          path: claudeManaged,
          version: "v1",
          frameworks: [],
          installed_at: new Date().toISOString(),
          mode: "enforced",
        },
      },
    }),
  );
  writeTamperLock(root, {
    version: 1,
    detected_at: new Date().toISOString(),
    cli: "claude",
    session_id: "s",
    hook_name: "any",
    last_seen: new Date(Date.now() - 60_000).toISOString(),
    missing_seconds: 60,
    host_id: "h",
    cwd: root,
  });
  try {
    const result = await runGovernRepair({
      cwd: root,
      skipRoot: true,
      reason: "Operator reviewed and cleared",
    });
    assert.equal(result.ok, true, result.message);
    assert.equal(result.removed_lock, true);
    assert.deepEqual(result.reverified, ["claude"]);
    assert.equal(fs.existsSync(path.join(ctx, ".cortex-tamper.lock")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("repair: success even when there is no lock — paths still verified", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-repair-clean-"));
  const ctx = path.join(root, ".context");
  fs.mkdirSync(ctx, { recursive: true });
  const claudeManaged = path.join(root, "managed.json");
  fs.writeFileSync(claudeManaged, "{}");
  fs.writeFileSync(
    path.join(ctx, "govern.local.json"),
    JSON.stringify({
      installs: {
        claude: {
          path: claudeManaged,
          version: "v1",
          frameworks: [],
          installed_at: new Date().toISOString(),
          mode: "advisory",
        },
      },
    }),
  );
  try {
    const result = await runGovernRepair({ cwd: root, skipRoot: true });
    assert.equal(result.ok, true, result.message);
    assert.equal(result.removed_lock, false);
    assert.match(result.message, /No tamper lock present/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
