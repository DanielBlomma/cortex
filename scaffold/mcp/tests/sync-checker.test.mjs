import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

import { checkSyncForCli, runSyncCheckOnce } from "../dist/daemon/sync-checker.js";

function startMockServer(handlers) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, `http://${req.headers.host}`);
    const handler = handlers[`${req.method} ${u.pathname}`];
    if (!handler) {
      res.statusCode = 404;
      res.end();
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => handler(req, res, u, body));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function makeProject({ baseUrl, installVersion }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-sync-"));
  const ctx = path.join(root, ".context");
  fs.mkdirSync(ctx, { recursive: true });
  fs.writeFileSync(
    path.join(ctx, "enterprise.yml"),
    [
      "enterprise:",
      "  api_key: ent_test_key_12345678",
      `  base_url: ${baseUrl}`,
      "compliance:",
      "  frameworks: [iso27001]",
      "",
    ].join("\n"),
  );
  if (installVersion) {
    fs.writeFileSync(
      path.join(ctx, "govern.local.json"),
      JSON.stringify({
        installs: {
          claude: {
            path: "/managed",
            version: installVersion,
            frameworks: [{ id: "iso27001", version: "0.1" }],
            installed_at: new Date().toISOString(),
            mode: "advisory",
          },
        },
      }),
    );
  }
  return { root, ctx };
}

test("checkSyncForCli: 304 maps to unchanged", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /api/v1/govern/config": (req, res) => {
      assert.equal(req.headers["if-none-match"], '"v123"', "should send If-None-Match");
      res.statusCode = 304;
      res.end();
    },
  });
  const { root } = makeProject({ baseUrl, installVersion: "v123" });
  try {
    const outcome = await checkSyncForCli({ cwd: root, cli: "claude" });
    assert.equal(outcome.kind, "unchanged");
    assert.equal(outcome.version, "v123");
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("checkSyncForCli: 200 with new ETag maps to available", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /api/v1/govern/config": (req, res) => {
      res.setHeader("ETag", '"v999"');
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ cli: "claude", managed_settings: {}, deny_rules: [], tamper_config: {}, frameworks: [] }));
    },
  });
  const { root } = makeProject({ baseUrl, installVersion: "v123" });
  try {
    const outcome = await checkSyncForCli({ cwd: root, cli: "claude" });
    assert.equal(outcome.kind, "available");
    assert.equal(outcome.latest_version, "v999");
    assert.equal(outcome.current_version, "v123");
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("checkSyncForCli: 500 maps to failed", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /api/v1/govern/config": (req, res) => {
      res.statusCode = 500;
      res.end();
    },
  });
  const { root } = makeProject({ baseUrl, installVersion: "v1" });
  try {
    const outcome = await checkSyncForCli({ cwd: root, cli: "claude" });
    assert.equal(outcome.kind, "failed");
    assert.match(outcome.error, /HTTP 500/);
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("checkSyncForCli: errors when enterprise not configured", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-sync-bare-"));
  fs.mkdirSync(path.join(root, ".context"));
  try {
    const outcome = await checkSyncForCli({ cwd: root, cli: "claude" });
    assert.equal(outcome.kind, "failed");
    assert.match(outcome.error, /enterprise not configured/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runSyncCheckOnce: writes update notification when new version is available", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /api/v1/govern/config": (req, res) => {
      res.setHeader("ETag", '"newer"');
      res.end(JSON.stringify({ cli: "claude" }));
    },
  });
  const { root, ctx } = makeProject({ baseUrl, installVersion: "older" });
  try {
    const outcomes = await runSyncCheckOnce(root, ["claude"]);
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].kind, "available");

    const notif = path.join(ctx, ".govern-update-available.json");
    assert.equal(fs.existsSync(notif), true);
    const parsed = JSON.parse(fs.readFileSync(notif, "utf8"));
    assert.equal(parsed.cli, "claude");
    assert.equal(parsed.latest_version, "newer");

    // Audit jsonl should contain a govern_config_available event
    const date = new Date().toISOString().slice(0, 10);
    const audit = path.join(ctx, "audit", `host-events-${date}.jsonl`);
    assert.equal(fs.existsSync(audit), true);
    const lines = fs.readFileSync(audit, "utf8").trim().split("\n").map(JSON.parse);
    assert.ok(lines.some((l) => l.event_type === "govern_config_available"));
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runSyncCheckOnce: writes govern_config_unchanged event on 304", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /api/v1/govern/config": (req, res) => {
      res.statusCode = 304;
      res.end();
    },
  });
  const { root, ctx } = makeProject({ baseUrl, installVersion: "current" });
  try {
    await runSyncCheckOnce(root, ["claude"]);
    const date = new Date().toISOString().slice(0, 10);
    const audit = path.join(ctx, "audit", `host-events-${date}.jsonl`);
    const lines = fs.readFileSync(audit, "utf8").trim().split("\n").map(JSON.parse);
    assert.ok(lines.some((l) => l.event_type === "govern_config_unchanged"));
    // No notification file written for unchanged
    assert.equal(fs.existsSync(path.join(ctx, ".govern-update-available.json")), false);
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
