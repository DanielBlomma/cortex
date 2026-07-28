import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { verifyLicense } from "../dist/core/license.js";

function makeContextDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-license-"));
  const contextDir = path.join(root, ".context");
  fs.mkdirSync(contextDir, { recursive: true });
  return { root, contextDir };
}

function validResponse() {
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
}

function cachePath(contextDir) {
  return path.join(contextDir, "telemetry", "license_cache.json");
}

test.afterEach(() => {
  globalThis.fetch = undefined;
});

test("verifyLicense: reuses a fresh cache only for the same endpoint and API key", async () => {
  const { root, contextDir } = makeContextDir();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return validResponse();
  };

  try {
    const first = await verifyLicense(
      contextDir,
      "https://licenses.example.com/",
      "ent_first_12345678",
    );
    const second = await verifyLicense(
      contextDir,
      "https://licenses.example.com",
      "ent_first_12345678",
    );

    assert.equal(first.valid, true);
    assert.equal(first.source, "remote");
    assert.equal(second.valid, true);
    assert.equal(second.source, "cache");
    assert.equal(calls, 1);

    const rawCache = fs.readFileSync(cachePath(contextDir), "utf8");
    assert.doesNotMatch(rawCache, /ent_first_12345678/);
    const parsedCache = JSON.parse(rawCache);
    assert.equal(parsedCache.version, 2);
    assert.equal(parsedCache.endpoint, "https://licenses.example.com");
    assert.match(parsedCache.api_key_sha256, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("verifyLicense: atomic cache replacement does not follow a dangling cache symlink", async () => {
  const { root, contextDir } = makeContextDir();
  const victim = path.join(root, "must-not-be-created");
  fs.mkdirSync(path.dirname(cachePath(contextDir)), { recursive: true });
  fs.symlinkSync(victim, cachePath(contextDir));
  globalThis.fetch = async () => validResponse();

  try {
    const result = await verifyLicense(
      contextDir,
      "https://licenses.example.com",
      "ent_symlink_cache_12345678",
    );
    assert.equal(result.valid, true);
    assert.equal(fs.existsSync(victim), false);
    assert.equal(fs.lstatSync(cachePath(contextDir)).isSymbolicLink(), false);
    assert.equal(fs.statSync(cachePath(contextDir)).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("verifyLicense: does not reuse a cache for another key or endpoint", async () => {
  const { root, contextDir } = makeContextDir();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return validResponse();
    throw new Error("offline");
  };

  try {
    const first = await verifyLicense(
      contextDir,
      "https://licenses.example.com",
      "ent_first_12345678",
    );
    assert.equal(first.valid, true);

    const otherKey = await verifyLicense(
      contextDir,
      "https://licenses.example.com",
      "ent_second_12345678",
    );
    assert.deepEqual(
      {
        valid: otherKey.valid,
        source: otherKey.source,
        reason: otherKey.valid ? undefined : otherKey.reason,
      },
      {
        valid: false,
        source: "grace_expired",
        reason: "endpoint_unreachable_grace_expired",
      },
    );

    const otherEndpoint = await verifyLicense(
      contextDir,
      "https://other.example.com",
      "ent_first_12345678",
    );
    assert.equal(otherEndpoint.valid, false);
    assert.equal(otherEndpoint.source, "grace_expired");
    assert.equal(calls, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("verifyLicense: 401 and 403 are authoritative and never use grace", async () => {
  for (const status of [401, 403]) {
    const { root, contextDir } = makeContextDir();
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) return validResponse();
      return {
        ok: false,
        status,
        statusText: "Rejected",
      };
    };

    try {
      await verifyLicense(
        contextDir,
        "https://licenses.example.com",
        "ent_first_12345678",
      );
      const cache = JSON.parse(fs.readFileSync(cachePath(contextDir), "utf8"));
      cache.cached_at = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      fs.writeFileSync(cachePath(contextDir), JSON.stringify(cache), "utf8");

      const rejected = await verifyLicense(
        contextDir,
        "https://licenses.example.com",
        "ent_first_12345678",
      );
      assert.equal(rejected.valid, false);
      assert.equal(rejected.source, "remote");
      assert.equal(rejected.reason, "authentication_rejected");
      assert.equal(fs.existsSync(cachePath(contextDir)), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("verifyLicense: an identity-matched positive cache remains available for transient grace", async () => {
  const { root, contextDir } = makeContextDir();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return validResponse();
    throw new Error("offline");
  };

  try {
    await verifyLicense(
      contextDir,
      "https://licenses.example.com",
      "ent_first_12345678",
    );
    const cache = JSON.parse(fs.readFileSync(cachePath(contextDir), "utf8"));
    cache.cached_at = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(cachePath(contextDir), JSON.stringify(cache), "utf8");

    const grace = await verifyLicense(
      contextDir,
      "https://licenses.example.com",
      "ent_first_12345678",
    );
    assert.equal(grace.valid, true);
    assert.equal(grace.source, "cache");
    assert.equal(calls, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("verifyLicense: legacy unbound cache entries are never trusted", async () => {
  const { root, contextDir } = makeContextDir();
  fs.mkdirSync(path.dirname(cachePath(contextDir)), { recursive: true });
  fs.writeFileSync(
    cachePath(contextDir),
    JSON.stringify({
      cached_at: new Date().toISOString(),
      result: {
        valid: true,
        edition: "enterprise",
        features: [],
        expires_at: "2099-01-01T00:00:00.000Z",
        max_repos: 10,
        verified_at: new Date().toISOString(),
        source: "remote",
      },
    }),
    "utf8",
  );
  globalThis.fetch = async () => {
    throw new Error("offline");
  };

  try {
    const result = await verifyLicense(
      contextDir,
      "https://licenses.example.com",
      "ent_first_12345678",
    );
    assert.equal(result.valid, false);
    assert.equal(result.source, "grace_expired");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("verifyLicense: malformed cache shapes fail closed instead of throwing", async () => {
  const { root, contextDir } = makeContextDir();
  fs.mkdirSync(path.dirname(cachePath(contextDir)), { recursive: true });
  fs.writeFileSync(
    cachePath(contextDir),
    JSON.stringify({ cached_at: new Date().toISOString() }),
    "utf8",
  );
  globalThis.fetch = async () => {
    throw new Error("offline");
  };

  try {
    const result = await verifyLicense(
      contextDir,
      "https://licenses.example.com",
      "ent_first_12345678",
    );
    assert.equal(result.valid, false);
    assert.equal(result.source, "grace_expired");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("verifyLicense: structurally partial v2 cache entries are never trusted", async () => {
  const { root, contextDir } = makeContextDir();
  fs.mkdirSync(path.dirname(cachePath(contextDir)), { recursive: true });
  fs.writeFileSync(
    cachePath(contextDir),
    JSON.stringify({
      version: 2,
      endpoint: "https://licenses.example.com",
      api_key_sha256: "a".repeat(64),
      cached_at: new Date(Date.now() + 60_000).toISOString(),
      result: {
        valid: true,
        expires_at: null,
      },
    }),
    "utf8",
  );
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("offline");
  };

  try {
    const result = await verifyLicense(
      contextDir,
      "https://licenses.example.com",
      "ent_first_12345678",
    );
    assert.equal(result.valid, false);
    assert.equal(result.source, "grace_expired");
    assert.equal(calls, 1);
    assert.equal(fs.existsSync(cachePath(contextDir)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("verifyLicense: a future-dated otherwise valid cache fails closed and is removed", async () => {
  const { root, contextDir } = makeContextDir();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return validResponse();
    throw new Error("offline");
  };

  try {
    await verifyLicense(
      contextDir,
      "https://licenses.example.com",
      "ent_first_12345678",
    );
    const cache = JSON.parse(fs.readFileSync(cachePath(contextDir), "utf8"));
    cache.cached_at = new Date(Date.now() + 60_000).toISOString();
    fs.writeFileSync(cachePath(contextDir), JSON.stringify(cache), "utf8");

    const result = await verifyLicense(
      contextDir,
      "https://licenses.example.com",
      "ent_first_12345678",
    );
    assert.equal(result.valid, false);
    assert.equal(result.source, "grace_expired");
    assert.equal(calls, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("verifyLicense: refuses cleartext non-loopback endpoints before sending a bearer key", async () => {
  const { root, contextDir } = makeContextDir();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return validResponse();
  };

  try {
    const result = await verifyLicense(
      contextDir,
      "http://licenses.example.com",
      "ent_first_12345678",
    );
    assert.equal(result.valid, false);
    assert.equal(result.reason, "insecure_or_invalid_endpoint");
    assert.equal(calls, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
