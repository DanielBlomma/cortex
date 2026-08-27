import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyFileHashes } from "../scripts/check-deepseek-harness-compatibility.mjs";

const MANIFEST_PATH = fileURLToPath(
  new URL("./fixtures/deepseek-harness-compatibility.json", import.meta.url),
);
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

function publicToolName(serverName, rawName) {
  const joined = `mcp__${serverName}__${rawName}`;
  const normalized = joined.replace(/[^A-Za-z0-9_-]/g, "_");
  if (normalized === joined && normalized.length <= 64) return normalized;
  const hash = crypto
    .createHash("sha256")
    .update(`${serverName}\0${rawName}`)
    .digest("hex")
    .slice(0, 12);
  return `${normalized.slice(0, 51)}_${hash}`;
}

test("DeepSeek Harness compatibility fixture pins the complete Stage 0 API", () => {
  assert.equal(manifest.schema_version, 1);
  assert.match(manifest.upstream.commit, /^[0-9a-f]{40}$/);
  assert.equal(manifest.upstream.release, "0.1.1-rc.2");
  assert.equal(manifest.upstream.cordis, "4.0.1");
  assert.equal(manifest.contracts.mcp_cwd_scope, "static-plugin-instance");
  assert.equal(manifest.contracts.mcp_tool_scope, "host-global");
  assert.equal(manifest.contracts.workspace_identity, "agent.session.header.cwd");
  assert.equal(manifest.files.length, 18);
  assert.equal(new Set(manifest.files.map((entry) => entry.path)).size, 18);
});

test("pinned Cortex MCP names match the Harness normalization contract", () => {
  assert.deepEqual(
    manifest.tool_names.map(({ raw, public: publicName }) => ({
      raw,
      public: publicToolName(manifest.contracts.mcp_server_name, raw),
    })),
    manifest.tool_names,
  );
});

test("compatibility file verifier accepts exact files and rejects drift", (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-harness-compat-"));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const relative = "packages/example/index.ts";
  const absolute = path.join(fixtureRoot, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, "export const api = 1;\n", "utf8");
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
  assert.equal(verifyFileHashes(fixtureRoot, [{ path: relative, sha256 }]), 1);
  fs.appendFileSync(absolute, "export const drift = true;\n", "utf8");
  assert.throws(
    () => verifyFileHashes(fixtureRoot, [{ path: relative, sha256 }]),
    /compatibility check failed.*expected.*got/,
  );
});

test("compatibility file verifier rejects paths outside the checkout", (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-harness-containment-"));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  assert.throws(
    () => verifyFileHashes(fixtureRoot, [{ path: "../outside", sha256: "0".repeat(64) }]),
    /escapes checkout/,
  );
});

test(
  "compatibility file verifier rejects an ancestor symlink outside the checkout",
  { skip: process.platform === "win32" },
  (t) => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-harness-symlink-"));
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-harness-outside-"));
    t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
    t.after(() => fs.rmSync(outsideRoot, { recursive: true, force: true }));
    const outsideFile = path.join(outsideRoot, "index.ts");
    fs.writeFileSync(outsideFile, "export const outside = true;\n", "utf8");
    fs.symlinkSync(outsideRoot, path.join(fixtureRoot, "linked"), "dir");
    const sha256 = crypto
      .createHash("sha256")
      .update(fs.readFileSync(outsideFile))
      .digest("hex");
    assert.throws(
      () => verifyFileHashes(fixtureRoot, [{ path: "linked/index.ts", sha256 }]),
      /resolved file path escapes checkout/,
    );
  },
);
