import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  pushGlobalUngovernedEvents,
  writeGlobalUngovernedEvent,
} from "../dist/daemon/global-host-events.js";
import { claimEnterpriseHostIdentity } from "../dist/core/enterprise-host-identity.js";
import { enterpriseCredentialId } from "../dist/core/license.js";

test("global host events push only under their enrolled credential", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-global-push-"));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-global-home-"));
  const endpoint = "https://govern.example.com";
  const apiKey = "ent_global_push_12345678";
  const credentialId = enterpriseCredentialId(endpoint, apiKey);
  fs.mkdirSync(path.join(cwd, ".context"));
  fs.writeFileSync(
    path.join(cwd, ".context", "enterprise.yml"),
    [
      "enterprise:",
      `  api_key: ${apiKey}`,
      `  endpoint: ${endpoint}`,
      "",
    ].join("\n"),
  );
  process.env.HOME = homeDir;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    return { ok: true, status: 200, statusText: "OK" };
  };

  try {
    assert.equal(claimEnterpriseHostIdentity(credentialId, endpoint), true);
    assert.equal(
      writeGlobalUngovernedEvent(credentialId, {
        event_type: "ungoverned_ai_session_detected",
        timestamp: "2026-07-28T10:00:00.000Z",
        host_id: "host-1",
        cli: "claude",
        binary: "/usr/local/bin/claude",
        pid: 42,
        ppid: 1,
        user: "alice",
        args: "claude --prompt secret",
        parent_chain: [],
        mode: "advisory",
        action: "logged",
      }),
      true,
    );

    assert.deepEqual(
      await pushGlobalUngovernedEvents(cwd, credentialId),
      { pushed: 1 },
    );
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].init.headers.Authorization,
      `Bearer ${apiKey}`,
    );
    const body = JSON.parse(requests[0].init.body);
    assert.equal(body.events[0].pid, 42);
    assert.equal(body.events[0].args, "claude --prompt secret");

    assert.deepEqual(
      await pushGlobalUngovernedEvents(cwd, credentialId),
      { pushed: 0 },
    );
    assert.equal(requests.length, 1);
  } finally {
    delete process.env.HOME;
    globalThis.fetch = undefined;
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});
