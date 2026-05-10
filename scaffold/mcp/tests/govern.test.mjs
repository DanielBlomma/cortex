import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { getManagedSettingsPath, buildCodexRequirementsToml } from "../dist/cli/govern.js";

test("getManagedSettingsPath: claude on darwin returns macOS managed-settings path", () => {
  const p = getManagedSettingsPath("claude", "darwin");
  assert.equal(p, "/Library/Application Support/ClaudeCode/managed-settings.json");
});

test("getManagedSettingsPath: claude on linux returns /etc path", () => {
  const p = getManagedSettingsPath("claude", "linux");
  assert.equal(p, "/etc/claude-code/managed-settings.json");
});

test("getManagedSettingsPath: codex on darwin returns macOS requirements.toml path", () => {
  const p = getManagedSettingsPath("codex", "darwin");
  assert.equal(p, "/Library/Application Support/Codex/requirements.toml");
});

test("getManagedSettingsPath: codex on linux returns /etc/codex path", () => {
  const p = getManagedSettingsPath("codex", "linux");
  assert.equal(p, "/etc/codex/requirements.toml");
});

test("getManagedSettingsPath: throws on unsupported OS", () => {
  assert.throws(() => getManagedSettingsPath("claude", "win32"), /not yet supported/);
});

test("getManagedSettingsPath: throws on unsupported cli (copilot has no managed file)", () => {
  assert.throws(() => getManagedSettingsPath("copilot", "darwin"), /not yet supported/);
});

test("buildCodexRequirementsToml: emits sandbox + approval upper bounds", () => {
  const config = {
    cli: "codex",
    managed_settings: {
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit|Write|Bash|MultiEdit",
            command: '"/Library/Application Support/Codex/hooks/pre-tool-use.sh"',
            statusMessage: "Checking Cortex policy",
            timeout: 30,
          },
        ],
        SessionEnd: [
          {
            command: "cortex hook session-end",
          },
        ],
      },
    },
    deny_rules: [
      { pattern: "Edit(~/.codex/config.toml)", source_frameworks: ["iso27001"] },
      { pattern: "Bash(curl *)", source_frameworks: ["iso27001"] },
    ],
    tamper_config: { heartbeat_interval_seconds: 60, missing_threshold_seconds: 300 },
    frameworks: [{ id: "iso27001", version: "0.1.0" }],
  };
  const toml = buildCodexRequirementsToml(config, {
    managedHookDir: "/Library/Application Support/Codex/hooks",
  });
  assert.match(toml, /allowed_sandbox_modes = \["read-only", "workspace-write"\]/);
  assert.match(toml, /allowed_approval_policies = \["untrusted", "on-request"\]/);
  assert.match(toml, /\[permissions\.filesystem\]/);
  assert.match(toml, /deny_read = \["~\/.codex\/config\.toml"\]/);
  assert.match(toml, /\[hooks\]/);
  assert.match(toml, /managed_dir = "\/Library\/Application Support\/Codex\/hooks"/);
  assert.match(toml, /\[\[hooks\.PreToolUse\]\]/);
  assert.match(toml, /matcher = "Edit\|Write\|Bash\|MultiEdit"/);
  assert.match(toml, /command = "\\"\/Library\/Application Support\/Codex\/hooks\/pre-tool-use\.sh\\""/);
  assert.match(toml, /statusMessage = "Checking Cortex policy"/);
  assert.match(toml, /timeout = 30/);
  assert.doesNotMatch(toml, /hooks\.SessionEnd/);
  // Bash(...) patterns should not appear in deny_read (filesystem only)
  assert.doesNotMatch(toml, /curl/);
});

test("buildCodexRequirementsToml: empty deny_rules emit empty deny_read", () => {
  const toml = buildCodexRequirementsToml({
    cli: "codex",
    managed_settings: {},
    deny_rules: [],
    tamper_config: { heartbeat_interval_seconds: 60, missing_threshold_seconds: 300 },
    frameworks: [],
  });
  assert.match(toml, /deny_read = \[\]/);
});

test("buildCodexRequirementsToml: escapes quotes in patterns", () => {
  const toml = buildCodexRequirementsToml({
    cli: "codex",
    managed_settings: {},
    deny_rules: [{ pattern: 'Edit(~/.codex/file with "quote".toml)', source_frameworks: ["iso27001"] }],
    tamper_config: { heartbeat_interval_seconds: 60, missing_threshold_seconds: 300 },
    frameworks: [],
  });
  assert.match(toml, /\\"quote\\"/);
});

test("buildCodexRequirementsToml: emits managed hook paths under the provided directory", () => {
  const managedHookDir = path.join("/tmp", "Codex Hooks");
  const toml = buildCodexRequirementsToml({
    cli: "codex",
    managed_settings: {
      hooks: {
        SessionStart: [
          {
            matcher: "startup|resume|clear",
            hooks: [
              {
                type: "command",
                command: `"${path.join(managedHookDir, "session-start.sh")}"`,
              },
            ],
          },
        ],
      },
    },
    deny_rules: [],
    tamper_config: { heartbeat_interval_seconds: 60, missing_threshold_seconds: 300 },
    frameworks: [],
  }, {
    managedHookDir,
  });
  assert.match(toml, /managed_dir = "\/tmp\/Codex Hooks"/);
  assert.match(toml, /\[\[hooks\.SessionStart\]\]/);
  assert.match(toml, /matcher = "startup\|resume\|clear"/);
  assert.match(toml, /command = "\\"\/tmp\/Codex Hooks\/session-start\.sh\\""/);
});
