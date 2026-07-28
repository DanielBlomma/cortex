import test from "node:test";
import assert from "node:assert/strict";

import { isAllowedEnterpriseEndpoint } from "../dist/core/secure-endpoint.js";
import { pushMetrics } from "../dist/enterprise/telemetry/sync.js";
import { syncFromCloud } from "../dist/enterprise/policy/sync.js";

test("Enterprise endpoint policy allows TLS and loopback HTTP only", () => {
  assert.equal(isAllowedEnterpriseEndpoint("https://enterprise.example.com"), true);
  assert.equal(isAllowedEnterpriseEndpoint("http://127.0.0.1:8787"), true);
  assert.equal(isAllowedEnterpriseEndpoint("http://localhost:8787"), true);
  assert.equal(isAllowedEnterpriseEndpoint("http://[::1]:8787"), true);
  assert.equal(isAllowedEnterpriseEndpoint("http://external.example.com"), false);
  assert.equal(
    isAllowedEnterpriseEndpoint("https://user:pass@enterprise.example.com"),
    false,
  );
});

test("telemetry and policy send primitives reject external HTTP before attaching a bearer key", async () => {
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error("fetch must not be called");
  };
  try {
    const telemetry = await pushMetrics(
      {},
      "http://external.example.com/telemetry",
      "ent_secret_12345678",
    );
    assert.equal(telemetry.success, false);
    assert.match(telemetry.error, /insecure or invalid/);

    const policy = await syncFromCloud(
      "http://external.example.com/policy",
      "ent_secret_12345678",
      {},
    );
    assert.equal(policy.success, false);
    assert.match(policy.error, /insecure or invalid/);
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = undefined;
  }
});
