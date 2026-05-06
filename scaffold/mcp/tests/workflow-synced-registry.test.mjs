import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadSyncedWorkflows,
  syncedWorkflowsCachePath,
} from "../dist/core/workflow/synced-registry.js";
import { runWorkflowStart } from "../dist/core/workflow/mcp-tools.js";
import { SECURE_BUILD_WORKFLOW } from "../dist/core/workflow/default-workflows.js";

function makeWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cortex-synced-registry-"));
}

const TINY_WORKFLOW = {
  id: "tiny",
  description: "Two-stage tests workflow",
  version: 1,
  stages: [
    {
      name: "plan",
      artifact: "plan.md",
      reads: [],
      required_fields: [],
      capability: "planner",
      description: "Produce a plan.",
    },
    {
      name: "review",
      artifact: "review.md",
      reads: ["plan"],
      required_fields: ["approved"],
      capability: "reviewer",
      description: "Review the plan.",
    },
  ],
};

function writeCache(dir, payload) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    syncedWorkflowsCachePath(dir),
    JSON.stringify(payload, null, 2),
    "utf8",
  );
}

test("syncedWorkflowsCachePath: defaults to ~/.cortex/workflows.local.json", () => {
  const expected = path.join(os.homedir(), ".cortex", "workflows.local.json");
  assert.equal(syncedWorkflowsCachePath(), expected);
});

test("loadSyncedWorkflows: returns {} when cache is missing", () => {
  const dir = makeWorkspace();
  assert.deepEqual(loadSyncedWorkflows(dir), {});
});

test("loadSyncedWorkflows: returns {} when cache is unreadable JSON", () => {
  const dir = makeWorkspace();
  fs.writeFileSync(syncedWorkflowsCachePath(dir), "not valid json", "utf8");
  assert.deepEqual(loadSyncedWorkflows(dir), {});
});

test("loadSyncedWorkflows: returns {} when 'workflows' key is missing", () => {
  const dir = makeWorkspace();
  writeCache(dir, { last_synced_at: "x" });
  assert.deepEqual(loadSyncedWorkflows(dir), {});
});

test("loadSyncedWorkflows: drops entries whose definition fails schema", () => {
  const dir = makeWorkspace();
  writeCache(dir, {
    workflows: {
      "valid-one": {
        workflow_id: "valid-one",
        version: 1,
        updated_at: "2026-05-06T12:00:00.000Z",
        definition: TINY_WORKFLOW,
      },
      "broken-one": {
        workflow_id: "broken-one",
        version: 1,
        updated_at: "2026-05-06T12:00:00.000Z",
        definition: { id: "broken-one" /* missing stages */ },
      },
    },
  });
  const loaded = loadSyncedWorkflows(dir);
  assert.deepEqual(Object.keys(loaded).sort(), ["valid-one"]);
});

test("loadSyncedWorkflows: returns valid workflow definitions keyed by workflow_id", () => {
  const dir = makeWorkspace();
  writeCache(dir, {
    workflows: {
      tiny: {
        workflow_id: "tiny",
        version: 1,
        updated_at: "2026-05-06T12:00:00.000Z",
        definition: TINY_WORKFLOW,
      },
    },
  });
  const loaded = loadSyncedWorkflows(dir);
  assert.equal(loaded.tiny.id, "tiny");
  assert.equal(loaded.tiny.stages.length, 2);
});

test("resolveWorkflow integration: synced workflow takes precedence over bundled default", () => {
  // We can't easily intercept loadSyncedWorkflows() from inside
  // mcp-tools.ts (it reads from a fixed home-dir path). Instead, exercise
  // the explicit-registry path which mirrors what the merge would do
  // and confirm the contract: passing a registry that includes the same
  // id as a bundled default uses the registry version.
  const cwd = makeWorkspace();
  process.env.HOME = cwd; // sandbox the cache lookup
  try {
    const overridden = {
      ...SECURE_BUILD_WORKFLOW,
      description: "Org-overridden secure-build",
    };
    const registry = { "secure-build": overridden };
    const result = runWorkflowStart(
      {
        task_id: "task-1",
        task_description: "test",
        workflow_id: "secure-build",
      },
      { cwd, workflows: registry },
    );
    assert.equal(result.state.workflow_id, "secure-build");
    // The envelope renders the workflow description verbatim — confirms
    // we got the org-overridden version and not the bundled one.
    assert.match(result.envelope.prompt, /Org-overridden secure-build/);
  } finally {
    delete process.env.HOME;
  }
});

test("resolveWorkflow integration: synced cache adds new workflow_ids beyond defaults", () => {
  const cwd = makeWorkspace();
  // Build a cache under a tmp HOME and point HOME at it, so that the
  // home-dir-based loader picks it up.
  const fakeHome = makeWorkspace();
  process.env.HOME = fakeHome;
  try {
    fs.mkdirSync(path.join(fakeHome, ".cortex"), { recursive: true });
    fs.writeFileSync(
      path.join(fakeHome, ".cortex", "workflows.local.json"),
      JSON.stringify({
        workflows: {
          tiny: {
            workflow_id: "tiny",
            version: 1,
            updated_at: "2026-05-06T12:00:00.000Z",
            definition: TINY_WORKFLOW,
          },
        },
      }),
      "utf8",
    );

    const result = runWorkflowStart(
      {
        task_id: "task-2",
        task_description: "Use synced workflow",
        workflow_id: "tiny",
      },
      { cwd },
    );
    assert.equal(result.state.workflow_id, "tiny");
    assert.equal(result.state.current_stage, "plan");
  } finally {
    delete process.env.HOME;
  }
});
