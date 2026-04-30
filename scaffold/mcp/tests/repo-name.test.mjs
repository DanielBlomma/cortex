import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runTelemetryTest } from "../dist/cli/telemetry-test.js";
import { buildTelemetryPushPayload } from "../dist/enterprise/privacy/boundary.js";
import {
  pushWorkflowSnapshot,
  setWorkflowPushContext,
} from "../dist/enterprise/workflow/push.js";

function createProjectRoot(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

test("telemetry payload includes repo when provided", () => {
  const payload = buildTelemetryPushPayload(
    {
      period_start: "2026-01-01T00:00:00.000Z",
      period_end: "2026-01-01T00:01:00.000Z",
      total_tool_calls: 1,
      successful_tool_calls: 1,
      failed_tool_calls: 0,
      total_duration_ms: 100,
      session_starts: 1,
      session_ends: 1,
      session_duration_ms_total: 100,
      searches: 1,
      related_lookups: 0,
      caller_lookups: 0,
      trace_lookups: 0,
      impact_analyses: 0,
      rule_lookups: 0,
      reloads: 0,
      total_results_returned: 1,
      estimated_tokens_saved: 100,
      estimated_tokens_total: 500,
      client_version: "test-version",
      instance_id: "instance-1",
      tool_metrics: {},
    },
    {
      session_id: "session-1",
      repo: "demo-repo",
    },
  );

  assert.equal(payload.repo, "demo-repo");
});

test("workflow pushes include repo from context", async () => {
  const endpoint = "https://example.com/api/v1/policies/sync";
  const apiKey = "ent_12345678";
  const originalFetch = globalThis.fetch;
  let payload = null;

  globalThis.fetch = async (_url, init) => {
    payload = JSON.parse(String(init.body));
    return { ok: true, status: 200 };
  };

  setWorkflowPushContext({
    repo: "workflow-repo",
    instance_id: "instance-1",
    session_id: "session-1",
  });

  try {
    await pushWorkflowSnapshot(endpoint, apiKey, { phase: "clean" });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(payload);
  assert.equal(payload.repo, "workflow-repo");
});

test("telemetry test uses CORTEX_PROJECT_ROOT for repo", async () => {
  const projectRoot = createProjectRoot("cortex-project-");
  const shellCwd = createProjectRoot("cortex-shell-");
  const contextDir = path.join(projectRoot, ".context");
  const originalProjectRoot = process.env.CORTEX_PROJECT_ROOT;
  const originalVersion = process.env.CORTEX_VERSION;
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;
  let payload = null;

  mkdirSync(path.join(contextDir, "telemetry"), { recursive: true });
  writeFileSync(
    path.join(contextDir, "enterprise.yml"),
    [
      "enterprise:",
      "  endpoint: https://example.com/api/v1/enterprise",
      "  api_key: ent_12345678",
      "telemetry:",
      "  enabled: true",
      "  endpoint: https://example.com/api/v1/telemetry/push",
    ].join("\n"),
  );
  writeFileSync(path.join(contextDir, "telemetry", "machine_id"), "machine-123\n");

  globalThis.fetch = async (_url, init) => {
    payload = JSON.parse(String(init.body));
    return { ok: true, status: 200 };
  };

  process.env.CORTEX_PROJECT_ROOT = projectRoot;
  process.env.CORTEX_VERSION = "test-version";
  process.chdir(shellCwd);

  try {
    const exitCode = await runTelemetryTest();
    assert.equal(exitCode, 0);
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
    if (originalProjectRoot === undefined) {
      delete process.env.CORTEX_PROJECT_ROOT;
    } else {
      process.env.CORTEX_PROJECT_ROOT = originalProjectRoot;
    }
    if (originalVersion === undefined) {
      delete process.env.CORTEX_VERSION;
    } else {
      process.env.CORTEX_VERSION = originalVersion;
    }
  }

  assert.ok(payload);
  assert.equal(payload.repo, path.basename(projectRoot));
  assert.notEqual(payload.repo, path.basename(shellCwd));
});
