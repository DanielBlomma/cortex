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
        managed_settings: {},
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
  const codexPath = path.join(root, "fake-codex-requirements.toml");
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
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("install --all skips copilot with a Tier-2 message", async () => {
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
  try {
    const result = await runGovernInstall({
      cli: "all",
      cwd: root,
      pathOverride: {
        claude: path.join(root, "claude-managed.json"),
        codex: path.join(root, "codex-requirements.toml"),
      },
      skipRoot: true,
    });
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(result.installed.sort(), ["claude", "codex"]);
  } finally {
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
  assert.match(output, /sudo cortex govern install/);
});
