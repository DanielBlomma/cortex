import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

import {
  buildHeartbeatPayload,
  pushHeartbeat,
} from "../dist/daemon/heartbeat-pusher.js";

function startMockServer(handler) {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => handler(req, res, body));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function makeProject({ baseUrl = "https://example.com", apiKey = "ent_test_key_12345678", installs = {}, frameworks = ["iso27001"] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-heartbeat-"));
  const ctx = path.join(root, ".context");
  fs.mkdirSync(ctx, { recursive: true });
  fs.writeFileSync(
    path.join(ctx, "enterprise.yml"),
    [
      "enterprise:",
      `  api_key: ${apiKey}`,
      `  base_url: ${baseUrl}`,
      "compliance:",
      `  frameworks: [${frameworks.join(", ")}]`,
      "",
    ].join("\n"),
  );
  if (Object.keys(installs).length > 0) {
    fs.writeFileSync(path.join(ctx, "govern.local.json"), JSON.stringify({ installs }));
  }
  return { root, ctx };
}

test("buildHeartbeatPayload: empty installs → mode off, empty ai_clis", () => {
  const { root } = makeProject();
  try {
    const payload = buildHeartbeatPayload(root, "test-host");
    assert.equal(payload.host_id, "test-host");
    assert.equal(payload.govern_mode, "off");
    assert.deepEqual(payload.ai_clis_detected, []);
    assert.deepEqual(payload.active_frameworks, ["iso27001"]);
    assert.equal(payload.config_version, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("buildHeartbeatPayload: enforced wins over advisory across multiple installs", () => {
  const { root } = makeProject({
    installs: {
      claude: { mode: "advisory", version: "v1", frameworks: [] },
      codex: { mode: "enforced", version: "v2", frameworks: [] },
    },
  });
  try {
    const payload = buildHeartbeatPayload(root);
    assert.equal(payload.govern_mode, "enforced");
    assert.equal(payload.ai_clis_detected.length, 2);
    assert.equal(payload.ai_clis_detected.find((c) => c.name === "claude").tier, "prevent");
    assert.equal(payload.ai_clis_detected.find((c) => c.name === "codex").tier, "prevent");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("buildHeartbeatPayload: copilot maps to wrap tier", () => {
  const { root } = makeProject({
    installs: {
      copilot: { mode: "advisory", version: "shim-v1", frameworks: [] },
    },
  });
  try {
    const payload = buildHeartbeatPayload(root);
    assert.equal(payload.ai_clis_detected[0].name, "copilot");
    assert.equal(payload.ai_clis_detected[0].tier, "wrap");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pushHeartbeat: posts canonical payload to /api/v1/govern/heartbeat", async () => {
  let received = null;
  let receivedAuth = null;
  const { server, baseUrl } = await startMockServer((req, res, body) => {
    if (req.url === "/api/v1/govern/heartbeat" && req.method === "POST") {
      received = JSON.parse(body);
      receivedAuth = req.headers["authorization"];
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, server_time: new Date().toISOString() }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  const { root } = makeProject({
    baseUrl,
    installs: { claude: { mode: "enforced", version: "v1", frameworks: [] } },
  });
  try {
    const result = await pushHeartbeat(root);
    assert.equal(result.ok, true);
    assert.equal(receivedAuth, "Bearer ent_test_key_12345678");
    assert.equal(received.govern_mode, "enforced");
    assert.equal(received.config_version, "v1");
    assert.ok(received.host_id.length > 0);
    assert.ok(["darwin", "linux", "windows"].includes(received.os));
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pushHeartbeat: returns error when enterprise not configured", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-heartbeat-bare-"));
  fs.mkdirSync(path.join(root, ".context"));
  try {
    const result = await pushHeartbeat(root);
    assert.equal(result.ok, false);
    assert.match(result.error, /enterprise not configured/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pushHeartbeat: server 500 surfaces error string", async () => {
  const { server, baseUrl } = await startMockServer((req, res) => {
    res.statusCode = 500;
    res.end("boom");
  });
  const { root } = makeProject({ baseUrl });
  try {
    const result = await pushHeartbeat(root);
    assert.equal(result.ok, false);
    assert.match(result.error, /HTTP 500/);
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
