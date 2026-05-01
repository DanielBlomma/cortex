import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildGovernStatus, runGovernStatus } from "../dist/cli/govern.js";
import { writeTamperLock } from "../dist/daemon/heartbeat-tracker.js";

function makeProject({ frameworks = ["iso27001"], apiKey = "ent_test_12345678" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-status-"));
  const ctx = path.join(root, ".context");
  fs.mkdirSync(ctx, { recursive: true });
  fs.writeFileSync(
    path.join(ctx, "enterprise.yml"),
    [
      "enterprise:",
      `  api_key: ${apiKey}`,
      "  base_url: https://example.com",
      "compliance:",
      `  frameworks: [${frameworks.join(", ")}]`,
      "",
    ].join("\n"),
  );
  return { root, ctx };
}

function writeInstalls(ctx, installs) {
  fs.writeFileSync(path.join(ctx, "govern.local.json"), JSON.stringify({ installs }));
}

test("buildGovernStatus: empty workspace yields off mode and empty installs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-status-bare-"));
  fs.mkdirSync(path.join(root, ".context"));
  try {
    const report = buildGovernStatus({ cwd: root });
    assert.equal(report.mode_effective, "off");
    assert.equal(report.installs.length, 0);
    assert.equal(report.tamper_lock, null);
    assert.equal(report.update_notification, null);
    assert.equal(report.recent_events_24h.ungoverned_ai_session_detected, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("buildGovernStatus: counts deny rules from claude managed-settings JSON", () => {
  const { root, ctx } = makeProject();
  const managedPath = path.join(ctx, "managed-settings.json");
  fs.writeFileSync(
    managedPath,
    JSON.stringify({
      allowManagedHooksOnly: true,
      permissions: {
        deny: ["Bash(rm)", "Edit(~/.x)", "Bash(curl *)"],
      },
    }),
  );
  writeInstalls(ctx, {
    claude: {
      path: managedPath,
      version: "v1",
      frameworks: [{ id: "iso27001", version: "0.1" }],
      installed_at: new Date().toISOString(),
      mode: "advisory",
    },
  });
  try {
    const report = buildGovernStatus({ cwd: root });
    assert.equal(report.installs.length, 1);
    const claudeEntry = report.installs[0];
    assert.equal(claudeEntry.cli, "claude");
    assert.equal(claudeEntry.tier, "Tier 1 (Prevent)");
    assert.equal(claudeEntry.deny_rules_count, 3);
    assert.equal(claudeEntry.managed_path_present, true);
    assert.equal(claudeEntry.managed_path_kind, "managed-settings.json");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("buildGovernStatus: counts deny_read entries from codex requirements.toml", () => {
  const { root, ctx } = makeProject();
  const reqPath = path.join(ctx, "requirements.toml");
  fs.writeFileSync(
    reqPath,
    [
      'allowed_sandbox_modes = ["read-only", "workspace-write"]',
      "[permissions.filesystem]",
      'deny_read = ["~/.codex/config.toml", "/etc/secret"]',
      "",
    ].join("\n"),
  );
  writeInstalls(ctx, {
    codex: {
      path: reqPath,
      version: "v1",
      frameworks: [{ id: "iso27001", version: "0.1" }],
      installed_at: new Date().toISOString(),
      mode: "enforced",
    },
  });
  try {
    const report = buildGovernStatus({ cwd: root });
    assert.equal(report.installs[0].deny_rules_count, 2);
    assert.equal(report.installs[0].managed_path_kind, "requirements.toml");
    assert.equal(report.mode_effective, "enforced");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("buildGovernStatus: extracts shim real-binary path from copilot shim", () => {
  const { root, ctx } = makeProject();
  const shimPath = path.join(ctx, "fake-shim");
  fs.writeFileSync(
    shimPath,
    [
      "#!/bin/sh",
      "# cortex-shim-v1",
      "# Real binary captured at install time: /opt/homebrew/bin/copilot",
      'exec "$CORTEX" run copilot "$@"',
      "",
    ].join("\n"),
  );
  writeInstalls(ctx, {
    copilot: {
      path: shimPath,
      version: "shim-v1",
      frameworks: [],
      installed_at: new Date().toISOString(),
      mode: "advisory",
    },
  });
  try {
    const report = buildGovernStatus({ cwd: root });
    const c = report.installs[0];
    assert.equal(c.cli, "copilot");
    assert.equal(c.tier, "Tier 2 (Wrap)");
    assert.equal(c.shim_real_binary, "/opt/homebrew/bin/copilot");
    assert.equal(c.managed_path_kind, "shim");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("buildGovernStatus: surfaces active tamper-lock", () => {
  const { root, ctx } = makeProject();
  writeInstalls(ctx, {
    claude: {
      path: "/missing",
      version: "v1",
      frameworks: [],
      installed_at: new Date().toISOString(),
      mode: "enforced",
    },
  });
  writeTamperLock(root, {
    version: 1,
    detected_at: new Date().toISOString(),
    cli: "claude",
    session_id: "sess-x",
    hook_name: "any",
    last_seen: new Date(Date.now() - 60_000).toISOString(),
    missing_seconds: 60,
    host_id: "h",
    cwd: root,
  });
  try {
    const report = buildGovernStatus({ cwd: root });
    assert.notEqual(report.tamper_lock, null);
    assert.equal(report.tamper_lock.cli, "claude");
    assert.equal(report.tamper_lock.session_id, "sess-x");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("buildGovernStatus: surfaces update notification", () => {
  const { root, ctx } = makeProject({});
  fs.writeFileSync(
    path.join(ctx, ".govern-update-available.json"),
    JSON.stringify({
      cli: "claude",
      latest_version: "newer123",
      current_version: "older",
      detected_at: new Date().toISOString(),
    }),
  );
  try {
    const report = buildGovernStatus({ cwd: root });
    assert.notEqual(report.update_notification, null);
    assert.equal(report.update_notification.latest_version, "newer123");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("buildGovernStatus: counts events from host-events JSONL within last 24h", () => {
  const { root, ctx } = makeProject({});
  const auditDir = path.join(ctx, "audit");
  fs.mkdirSync(auditDir);
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(auditDir, `host-events-${date}.jsonl`);
  const now = Date.now();
  const recent = new Date(now - 60_000).toISOString();
  const old = new Date(now - 48 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(
    file,
    [
      JSON.stringify({ event_type: "ungoverned_ai_session_detected", timestamp: recent }),
      JSON.stringify({ event_type: "ungoverned_ai_session_detected", timestamp: recent }),
      JSON.stringify({ event_type: "hook_tamper_detected", timestamp: recent }),
      JSON.stringify({ event_type: "govern_config_unchanged", timestamp: recent }),
      // Outside 24h window — should not count.
      JSON.stringify({ event_type: "ungoverned_ai_session_detected", timestamp: old }),
    ].join("\n"),
  );
  try {
    const report = buildGovernStatus({ cwd: root });
    assert.equal(report.recent_events_24h.ungoverned_ai_session_detected, 2);
    assert.equal(report.recent_events_24h.hook_tamper_detected, 1);
    assert.equal(report.recent_events_24h.govern_config_unchanged, 1);
    assert.ok(report.recent_events_sample.length >= 4);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runGovernStatus: --json emits valid JSON containing the report", () => {
  const { root, ctx } = makeProject();
  writeInstalls(ctx, {
    claude: {
      path: "/some-managed",
      version: "v1",
      frameworks: [],
      installed_at: new Date().toISOString(),
      mode: "advisory",
    },
  });
  const lines = [];
  const orig = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  try {
    runGovernStatus({ cwd: root, json: true });
  } finally {
    console.log = orig;
    fs.rmSync(root, { recursive: true, force: true });
  }
  const parsed = JSON.parse(lines.join("\n"));
  assert.equal(parsed.installs.length, 1);
  assert.equal(parsed.installs[0].cli, "claude");
  assert.equal(parsed.mode_effective, "advisory");
});

test("runGovernStatus: compact format mentions tamper lock when present", () => {
  const { root, ctx } = makeProject();
  writeInstalls(ctx, {
    claude: {
      path: "/some-managed",
      version: "v1",
      frameworks: [],
      installed_at: new Date().toISOString(),
      mode: "enforced",
    },
  });
  writeTamperLock(root, {
    version: 1,
    detected_at: new Date().toISOString(),
    cli: "claude",
    session_id: "x",
    hook_name: "any",
    last_seen: new Date().toISOString(),
    missing_seconds: 60,
    host_id: "h",
    cwd: root,
  });
  const lines = [];
  const orig = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  try {
    runGovernStatus({ cwd: root });
  } finally {
    console.log = orig;
    fs.rmSync(root, { recursive: true, force: true });
  }
  const out = lines.join("\n");
  assert.match(out, /TAMPER LOCK ACTIVE/);
  assert.match(out, /sudo cortex enterprise repair/);
});

test("runGovernStatus: --verbose includes per-CLI detail block", () => {
  const { root, ctx } = makeProject({});
  const managedPath = path.join(ctx, "managed-settings.json");
  fs.writeFileSync(managedPath, JSON.stringify({ permissions: { deny: ["Bash(rm)"] } }));
  fs.writeFileSync(
    path.join(ctx, "govern.local.json"),
    JSON.stringify({
      installs: {
        claude: {
          path: managedPath,
          version: "v1",
          frameworks: [{ id: "iso27001", version: "0.1" }],
          installed_at: new Date().toISOString(),
          mode: "advisory",
        },
      },
    }),
  );
  const lines = [];
  const orig = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  try {
    runGovernStatus({ cwd: root, verbose: true });
  } finally {
    console.log = orig;
    fs.rmSync(root, { recursive: true, force: true });
  }
  const out = lines.join("\n");
  assert.match(out, /Per-CLI managed-config detail/);
  assert.match(out, /\[claude\]/);
  assert.match(out, /deny_rules:\s+1/);
});
