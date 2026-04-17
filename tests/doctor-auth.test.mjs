import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DOCTOR_SH = path.resolve(__dirname, "..", "scaffold", "scripts", "doctor.sh");

const VALID_KEY = "ctx_test_valid_123";

function startMock({ returnStatus } = {}) {
  const server = http.createServer((req, res) => {
    if (returnStatus) {
      res.writeHead(returnStatus, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "forced" }));
      return;
    }
    const auth = req.headers["authorization"] ?? "";
    if (auth === `Bearer ${VALID_KEY}`) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ rules: [], version: "test" }));
    } else {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing API key" }));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function closeMock(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function makeTempProject(enterpriseYaml) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-doctor-auth-"));
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, ".context"), { recursive: true });
  fs.copyFileSync(DOCTOR_SH, path.join(root, "scripts", "doctor.sh"));
  fs.chmodSync(path.join(root, "scripts", "doctor.sh"), 0o755);
  fs.writeFileSync(path.join(root, ".context", "enterprise.yaml"), enterpriseYaml);
  return root;
}

function runDoctor(projectRoot) {
  return new Promise((resolve) => {
    const child = spawn("bash", [path.join(projectRoot, "scripts", "doctor.sh")], {
      cwd: projectRoot,
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", () => {});
    child.on("close", () => resolve(stdout));
  });
}

function yaml({ telemetryEndpoint, telemetryKey, policyEndpoint, policyKey }) {
  const lines = ["telemetry:", `  endpoint: ${telemetryEndpoint}`];
  if (telemetryKey !== undefined) lines.push(`  api_key: ${telemetryKey}`);
  lines.push("", "policy:", `  endpoint: ${policyEndpoint}`);
  if (policyKey !== undefined) lines.push(`  api_key: ${policyKey}`);
  lines.push("");
  return lines.join("\n");
}

test("doctor reports authenticated when api_key matches", async () => {
  const { server, baseUrl } = await startMock();
  try {
    const project = makeTempProject(
      yaml({
        telemetryEndpoint: `${baseUrl}/telemetry`,
        telemetryKey: VALID_KEY,
        policyEndpoint: `${baseUrl}/policy`,
        policyKey: VALID_KEY,
      })
    );
    const out = await runDoctor(project);
    assert.match(out, /Policy: endpoint authenticated \(HTTP 200\)/);
    assert.match(out, /Telemetry: endpoint authenticated \(HTTP 200\)/);
  } finally {
    await closeMock(server);
  }
});

test("doctor fails loudly when api_key is wrong (policy 401)", async () => {
  const { server, baseUrl } = await startMock();
  try {
    const project = makeTempProject(
      yaml({
        telemetryEndpoint: `${baseUrl}/telemetry`,
        telemetryKey: "ctx_wrong",
        policyEndpoint: `${baseUrl}/policy`,
        policyKey: "ctx_wrong",
      })
    );
    const out = await runDoctor(project);
    assert.match(out, /Policy: auth rejected \(HTTP 401\) — check policy\.api_key/);
    assert.match(out, /Telemetry: auth rejected \(HTTP 401\) — check telemetry\.api_key/);
  } finally {
    await closeMock(server);
  }
});

test("doctor treats 401 as expected when no api_key configured", async () => {
  const { server, baseUrl } = await startMock();
  try {
    const project = makeTempProject(
      yaml({
        telemetryEndpoint: `${baseUrl}/telemetry`,
        policyEndpoint: `${baseUrl}/policy`,
      })
    );
    const out = await runDoctor(project);
    assert.match(out, /Policy: endpoint reachable \(auth required — expected\)/);
    assert.match(out, /Telemetry: endpoint reachable \(auth required — expected\)/);
  } finally {
    await closeMock(server);
  }
});

test("doctor warns on unexpected 500 response", async () => {
  const { server, baseUrl } = await startMock({ returnStatus: 500 });
  try {
    const project = makeTempProject(
      yaml({
        telemetryEndpoint: `${baseUrl}/telemetry`,
        telemetryKey: VALID_KEY,
        policyEndpoint: `${baseUrl}/policy`,
        policyKey: VALID_KEY,
      })
    );
    const out = await runDoctor(project);
    assert.match(out, /Policy: endpoint returned HTTP 500/);
    assert.match(out, /Telemetry: endpoint returned HTTP 500/);
  } finally {
    await closeMock(server);
  }
});
