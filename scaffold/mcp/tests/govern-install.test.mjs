import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

import {
  runGovernInstall,
  runGovernUninstall,
  runGovernStatus,
} from "../dist/cli/govern.js";

function startMockServer(handlers) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const handler = handlers[`${req.method} ${url.pathname}`];
    if (!handler) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => handler(req, res, url, body));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function makeProject({ apiKey, baseUrl, frameworks = ["iso27001"] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-govern-"));
  const ctx = path.join(root, ".context");
  fs.mkdirSync(ctx, { recursive: true });
  const yaml = [
    "enterprise:",
    `  api_key: ${apiKey}`,
    `  base_url: ${baseUrl}`,
    "compliance:",
    `  frameworks: [${frameworks.join(", ")}]`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(ctx, "enterprise.yml"), yaml);
  return { root, ctx };
}

test("install --cli claude writes managed-settings.json and records state", async () => {
  let appliedCalls = 0;
  const { server, baseUrl } = await startMockServer({
    "GET /api/v1/govern/config": (req, res) => {
      const config = {
        cli: "claude",
        managed_settings: {
          allowManagedHooksOnly: true,
          permissions: { deny: ["Edit(~/.claude/settings.json)"] },
        },
        deny_rules: [{ pattern: "Edit(~/.claude/settings.json)", source_frameworks: ["iso27001"] }],
        tamper_config: { heartbeat_interval_seconds: 60, missing_threshold_seconds: 300 },
        frameworks: [{ id: "iso27001", version: "0.1.0-seed" }],
      };
      res.setHeader("ETag", '"abc123version"');
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(config));
    },
    "POST /api/v1/govern/applied": (req, res, url, body) => {
      appliedCalls += 1;
      const payload = JSON.parse(body);
      assert.equal(payload.cli, "claude");
      assert.equal(payload.success, true);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    },
  });

  const { root, ctx } = makeProject({ apiKey: "ent_test_key_12345678", baseUrl });
  const claudeManagedPath = path.join(root, "fake-managed-settings.json");
  try {
    const result = await runGovernInstall({
      cli: "claude",
      cwd: root,
      mode: "advisory",
      pathOverride: { claude: claudeManagedPath },
      skipRoot: true,
    });
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(result.installed, ["claude"]);

    const written = JSON.parse(fs.readFileSync(claudeManagedPath, "utf8"));
    assert.equal(written.allowManagedHooksOnly, true);
    assert.deepEqual(written.permissions.deny, ["Edit(~/.claude/settings.json)"]);

    const state = JSON.parse(fs.readFileSync(path.join(ctx, "govern.local.json"), "utf8"));
    assert.equal(state.installs.claude.path, claudeManagedPath);
    assert.equal(state.installs.claude.version, "abc123version");
    assert.equal(state.installs.claude.mode, "advisory");
    assert.equal(appliedCalls, 1);
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("install --cli codex writes requirements.toml with sandbox bounds", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /api/v1/govern/config": (req, res) => {
      const config = {
        cli: "codex",
        managed_settings: {
          hooks: {
            PreToolUse: [
              {
                matcher: "Edit|Write|Bash|MultiEdit",
                command: "cortex hook pre-tool-use",
                statusMessage: "Checking Cortex policy",
                timeout: 30,
              },
            ],
            PostToolUse: [
              {
                command: "cortex hook post-tool-use",
              },
            ],
            PermissionRequest: [
              {
                command: "cortex hook permission-request",
              },
            ],
            SessionStart: [
              {
                matcher: "startup|resume|clear",
                command: "cortex hook session-start",
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
        ],
        tamper_config: { heartbeat_interval_seconds: 60, missing_threshold_seconds: 300 },
        frameworks: [{ id: "iso27001", version: "0.1.0-seed" }],
      };
      res.setHeader("ETag", '"codex_v1"');
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(config));
    },
    "POST /api/v1/govern/applied": (req, res) => res.end(JSON.stringify({ ok: true })),
  });

  const { root } = makeProject({ apiKey: "ent_test_key_12345678", baseUrl });
  const codexDir = path.join(root, "fake managed codex");
  const codexPath = path.join(codexDir, "requirements.toml");
  try {
    const result = await runGovernInstall({
      cli: "codex",
      cwd: root,
      pathOverride: { codex: codexPath },
      skipRoot: true,
    });
    assert.equal(result.ok, true, result.message);

    const toml = fs.readFileSync(codexPath, "utf8");
    assert.match(toml, /allowed_sandbox_modes = \["read-only", "workspace-write"\]/);
    assert.match(toml, /\[permissions\.filesystem\]/);
    assert.match(toml, /deny_read = \["~\/.codex\/config\.toml"\]/);
    assert.match(toml, /\[hooks\]/);
    assert.match(toml, /managed_dir = ".+fake managed codex\/hooks"/);
    assert.match(toml, /\[\[hooks\.PreToolUse\]\]/);
    assert.match(toml, /matcher = "Edit\|Write\|Bash\|MultiEdit"/);
    assert.match(toml, /command = "\\".+fake managed codex\/hooks\/pre-tool-use\.sh\\""/);
    assert.match(toml, /\[\[hooks\.PostToolUse\]\]/);
    assert.match(toml, /command = "\\".+fake managed codex\/hooks\/post-tool-use\.sh\\""/);
    assert.match(toml, /\[\[hooks\.PermissionRequest\]\]/);
    assert.match(toml, /command = "\\".+fake managed codex\/hooks\/permission-request\.sh\\""/);
    assert.match(toml, /\[\[hooks\.SessionStart\]\]/);
    assert.match(toml, /command = "\\".+fake managed codex\/hooks\/session-start\.sh\\""/);
    assert.match(toml, /\[\[hooks\.SessionEnd\]\]/);
    assert.match(toml, /command = "\\".+fake managed codex\/hooks\/session-end\.sh\\""/);

    const preToolUseWrapper = path.join(codexDir, "hooks", "pre-tool-use.sh");
    const postToolUseWrapper = path.join(codexDir, "hooks", "post-tool-use.sh");
    const permissionRequestWrapper = path.join(codexDir, "hooks", "permission-request.sh");
    const sessionStartWrapper = path.join(codexDir, "hooks", "session-start.sh");
    const sessionEndWrapper = path.join(codexDir, "hooks", "session-end.sh");
    assert.equal(fs.existsSync(preToolUseWrapper), true);
    assert.equal(fs.existsSync(postToolUseWrapper), true);
    assert.equal(fs.existsSync(permissionRequestWrapper), true);
    assert.equal(fs.existsSync(sessionStartWrapper), true);
    assert.equal(fs.existsSync(sessionEndWrapper), true);
    const preToolUseContents = fs.readFileSync(preToolUseWrapper, "utf8");
    assert.match(preToolUseContents, /exec "\$CORTEX" hook pre-tool-use "\$@"/);
    const postToolUseContents = fs.readFileSync(postToolUseWrapper, "utf8");
    assert.match(postToolUseContents, /exec "\$CORTEX" hook post-tool-use "\$@"/);
    const permissionRequestContents = fs.readFileSync(permissionRequestWrapper, "utf8");
    assert.match(permissionRequestContents, /exec "\$CORTEX" hook permission-request "\$@"/);
    const sessionEndContents = fs.readFileSync(sessionEndWrapper, "utf8");
    assert.match(sessionEndContents, /exec "\$CORTEX" hook session-end "\$@"/);
    const mode = fs.statSync(preToolUseWrapper).mode & 0o777;
    assert.equal(mode, 0o755);
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("install --all installs claude+codex managed files plus copilot Tier-2 shim", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /api/v1/govern/config": (req, res) => {
      const config = {
        cli: req.url.includes("cli=claude") ? "claude" : "codex",
        managed_settings: {},
        deny_rules: [],
        tamper_config: { heartbeat_interval_seconds: 60, missing_threshold_seconds: 300 },
        frameworks: [{ id: "iso27001", version: "0.1.0-seed" }],
      };
      res.setHeader("ETag", '"v1"');
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(config));
    },
    "POST /api/v1/govern/applied": (req, res) => res.end(JSON.stringify({ ok: true })),
  });

  const { root } = makeProject({ apiKey: "ent_test_key_12345678", baseUrl });
  // Stand up a fake real-copilot binary on a temp PATH so the shim install
  // can find it; otherwise copilot is skipped for missing-binary reasons.
  const realDir = path.join(root, "real-bin");
  fs.mkdirSync(realDir, { recursive: true });
  const realCopilot = path.join(realDir, "copilot");
  fs.writeFileSync(realCopilot, "#!/bin/sh\necho real copilot\n", { mode: 0o755 });
  const origPath = process.env.PATH;
  process.env.PATH = `${realDir}:${origPath ?? ""}`;
  try {
    const result = await runGovernInstall({
      cli: "all",
      cwd: root,
      pathOverride: {
        claude: path.join(root, "claude-managed.json"),
        codex: path.join(root, "codex-requirements.toml"),
        copilot: path.join(root, "fake-copilot-shim"),
      },
      skipRoot: true,
    });
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(result.installed.sort(), ["claude", "codex", "copilot"]);
    const shimContents = fs.readFileSync(path.join(root, "fake-copilot-shim"), "utf8");
    assert.match(shimContents, /cortex-shim-v1/);
    assert.match(shimContents, new RegExp(realCopilot));
  } finally {
    process.env.PATH = origPath;
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("uninstall removes managed file and updates state", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /api/v1/govern/config": (req, res) => {
      res.setHeader("ETag", '"v1"');
      res.end(
        JSON.stringify({
          cli: "claude",
          managed_settings: { allowManagedHooksOnly: true },
          deny_rules: [],
          tamper_config: { heartbeat_interval_seconds: 60, missing_threshold_seconds: 300 },
          frameworks: [{ id: "iso27001", version: "0.1.0-seed" }],
        }),
      );
    },
    "POST /api/v1/govern/applied": (req, res) => res.end(JSON.stringify({ ok: true })),
  });

  const { root, ctx } = makeProject({ apiKey: "ent_test_key_12345678", baseUrl });
  const target = path.join(root, "claude-managed.json");
  try {
    await runGovernInstall({
      cli: "claude",
      cwd: root,
      mode: "advisory",
      pathOverride: { claude: target },
      skipRoot: true,
    });
    assert.equal(fs.existsSync(target), true);

    const result = await runGovernUninstall({ cli: "claude", cwd: root, skipRoot: true });
    assert.equal(result.ok, true, result.message);
    assert.equal(fs.existsSync(target), false);

    const state = JSON.parse(fs.readFileSync(path.join(ctx, "govern.local.json"), "utf8"));
    assert.equal(state.installs.claude, undefined);
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("uninstall in enforced mode requires --break-glass + --reason", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /api/v1/govern/config": (req, res) => {
      res.setHeader("ETag", '"v1"');
      res.end(
        JSON.stringify({
          cli: "claude",
          managed_settings: { allowManagedHooksOnly: true },
          deny_rules: [],
          tamper_config: { heartbeat_interval_seconds: 60, missing_threshold_seconds: 300 },
          frameworks: [{ id: "iso27001", version: "0.1.0-seed" }],
        }),
      );
    },
    "POST /api/v1/govern/applied": (req, res) => res.end(JSON.stringify({ ok: true })),
  });

  const { root } = makeProject({ apiKey: "ent_test_key_12345678", baseUrl });
  const target = path.join(root, "claude-managed.json");
  try {
    await runGovernInstall({
      cli: "claude",
      cwd: root,
      mode: "enforced",
      pathOverride: { claude: target },
      skipRoot: true,
    });

    const blocked = await runGovernUninstall({ cli: "claude", cwd: root, skipRoot: true });
    assert.equal(blocked.ok, false);
    assert.match(blocked.message, /enforced mode/);
    assert.equal(fs.existsSync(target), true);

    const noReason = await runGovernUninstall({
      cli: "claude",
      cwd: root,
      breakGlass: true,
      skipRoot: true,
    });
    assert.equal(noReason.ok, false);
    assert.match(noReason.message, /requires --reason/);

    const allowed = await runGovernUninstall({
      cli: "claude",
      cwd: root,
      breakGlass: true,
      reason: "Incident response",
      skipRoot: true,
    });
    assert.equal(allowed.ok, true, allowed.message);
    assert.equal(fs.existsSync(target), false);
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("install with no api_key returns helpful error", async () => {
  const { root } = makeProject({ apiKey: "", baseUrl: "http://example.com" });
  try {
    const result = await runGovernInstall({ cli: "claude", cwd: root, skipRoot: true });
    assert.equal(result.ok, false);
    assert.match(result.message, /No enterprise.api_key/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("status with no installs prints the empty-state hint", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-govern-status-"));
  fs.mkdirSync(path.join(root, ".context"));
  const lines = [];
  const origLog = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  try {
    runGovernStatus({ cwd: root });
  } finally {
    console.log = origLog;
    fs.rmSync(root, { recursive: true, force: true });
  }
  const output = lines.join("\n");
  assert.match(output, /No CLIs governed/);
  assert.match(output, /sudo cortex enterprise/);
});
