import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  bindEnterpriseIdentity,
  runEnterpriseSetup,
} from "../dist/cli/enterprise-setup.js";

function makeWorkspace() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-enterprise-setup-"));
  fs.mkdirSync(path.join(cwd, ".context"), { recursive: true });
  const homeDir = path.join(cwd, "home");
  fs.mkdirSync(homeDir);
  process.env.HOME = homeDir;
  return cwd;
}

function stubValidLicense() {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      valid: true,
      edition: "enterprise",
      features: ["govern"],
      expires_at: "2099-01-01T00:00:00.000Z",
      max_repos: 10,
    }),
  });
}

test.afterEach(() => {
  delete process.env.HOME;
  globalThis.fetch = undefined;
});

test("runEnterpriseSetup: atomically creates enterprise.yml with mode 0600", async () => {
  const cwd = makeWorkspace();
  stubValidLicense();

  try {
    const result = await runEnterpriseSetup({
      cwd,
      endpoint: "https://licenses.example.com",
      apiKey: "ent_secure_12345678",
    });
    assert.equal(result.ok, true);
    assert.ok(result.configPath);
    assert.equal(fs.statSync(result.configPath).mode & 0o777, 0o600);
    assert.match(fs.readFileSync(result.configPath, "utf8"), /ent_secure_12345678/);
    assert.equal(
      fs.existsSync(
        path.join(process.env.HOME, ".cortex", "enterprise-host-identity.json"),
      ),
      false,
      "license/config validation must not implicitly enroll host-global state",
    );
    assert.deepEqual(
      fs.readdirSync(path.join(cwd, ".context")).filter((name) => name.endsWith(".tmp")),
      [],
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("bindEnterpriseIdentity creates a user-owned marker and permits explicit same-endpoint rotation", () => {
  const cwd = makeWorkspace();
  const homeDir = process.env.HOME;
  const endpoint = "https://licenses.example.com";
  try {
    assert.equal(
      bindEnterpriseIdentity({
        endpoint,
        apiKey: "ent_first_rotation_12345678",
      }),
      true,
    );
    const markerPath = path.join(
      homeDir,
      ".cortex",
      "enterprise-host-identity.json",
    );
    assert.equal(fs.statSync(markerPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(markerPath).uid, process.getuid());
    const first = JSON.parse(fs.readFileSync(markerPath, "utf8"));

    assert.equal(
      bindEnterpriseIdentity({
        endpoint,
        apiKey: "ent_second_rotation_12345678",
      }),
      true,
    );
    const second = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    assert.notEqual(second.credential_id, first.credential_id);
    assert.equal(second.endpoint_sha256, first.endpoint_sha256);

    assert.equal(
      bindEnterpriseIdentity({
        endpoint: "https://another-org.example.com",
        apiKey: "ent_other_endpoint_12345678",
      }),
      false,
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(markerPath, "utf8")), second);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("bindEnterpriseIdentity refuses a symlinked user-global Cortex directory", () => {
  const cwd = makeWorkspace();
  const homeDir = process.env.HOME;
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-host-outside-"));
  fs.symlinkSync(outside, path.join(homeDir, ".cortex"), "dir");
  try {
    assert.equal(
      bindEnterpriseIdentity({
        endpoint: "https://licenses.example.com",
        apiKey: "ent_symlink_guard_12345678",
      }),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(outside, "enterprise-host-identity.json")),
      false,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("runEnterpriseSetup: replacing a permissive config leaves mode 0600", async () => {
  const cwd = makeWorkspace();
  const configPath = path.join(cwd, ".context", "enterprise.yml");
  fs.writeFileSync(configPath, "old", { encoding: "utf8", mode: 0o644 });
  fs.chmodSync(configPath, 0o644);
  stubValidLicense();

  try {
    const result = await runEnterpriseSetup({
      cwd,
      endpoint: "https://licenses.example.com",
      apiKey: "ent_replaced_12345678",
    });
    assert.equal(result.ok, true);
    assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
    assert.doesNotMatch(fs.readFileSync(configPath, "utf8"), /^old$/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("runEnterpriseSetup: rejects non-loopback HTTP before transmitting the API key", async () => {
  const cwd = makeWorkspace();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        valid: true,
        edition: "enterprise",
        features: ["govern"],
        expires_at: "2099-01-01T00:00:00.000Z",
        max_repos: 10,
      }),
    };
  };

  try {
    const result = await runEnterpriseSetup({
      cwd,
      endpoint: "http://licenses.example.com",
      apiKey: "ent_secure_12345678",
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /must use HTTPS/);
    assert.equal(calls, 0);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
