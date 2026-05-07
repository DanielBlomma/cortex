import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadSyncedCapabilities,
  syncedCapabilitiesCachePath,
} from "../dist/core/workflow/synced-capability-registry.js";
import { evaluateToolCall } from "../dist/core/workflow/enforcement.js";
import { createRun } from "../dist/core/workflow/run-lifecycle.js";

function makeWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cortex-synced-caps-"));
}

const FRONTEND_BUILDER = {
  name: "frontend-builder",
  description: "Frontend-only profile",
  read_globs: ["**"],
  write_globs: ["src/components/**"],
  tools_allowed: [],
};

const WORKFLOW = {
  id: "fe",
  description: "Frontend-only build",
  version: 1,
  stages: [
    {
      name: "build",
      artifact: "changes.md",
      reads: [],
      required_fields: [],
      validators: [],
      capability: "frontend-builder",
      description: "Build the frontend",
    },
  ],
};

function writeCache(dir, payload) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    syncedCapabilitiesCachePath(dir),
    JSON.stringify(payload, null, 2),
    "utf8",
  );
}

test("syncedCapabilitiesCachePath: defaults to ~/.cortex/capabilities.local.json", () => {
  const expected = path.join(os.homedir(), ".cortex", "capabilities.local.json");
  assert.equal(syncedCapabilitiesCachePath(), expected);
});

test("loadSyncedCapabilities: returns {} when cache is missing", () => {
  const dir = makeWorkspace();
  assert.deepEqual(loadSyncedCapabilities(dir), {});
});

test("loadSyncedCapabilities: returns {} when cache is unreadable JSON", () => {
  const dir = makeWorkspace();
  fs.writeFileSync(syncedCapabilitiesCachePath(dir), "not json", "utf8");
  assert.deepEqual(loadSyncedCapabilities(dir), {});
});

test("loadSyncedCapabilities: returns {} when 'capabilities' key is missing", () => {
  const dir = makeWorkspace();
  writeCache(dir, { last_synced_at: "x" });
  assert.deepEqual(loadSyncedCapabilities(dir), {});
});

test("loadSyncedCapabilities: drops entries whose definition fails schema", () => {
  const dir = makeWorkspace();
  writeCache(dir, {
    capabilities: {
      "valid-one": {
        capability_name: "valid-one",
        updated_at: "2026-05-07T12:00:00.000Z",
        definition: FRONTEND_BUILDER,
      },
      "broken-one": {
        capability_name: "broken-one",
        updated_at: "2026-05-07T12:00:00.000Z",
        definition: { name: "broken-one" /* missing description */ },
      },
    },
  });
  const loaded = loadSyncedCapabilities(dir);
  assert.deepEqual(Object.keys(loaded).sort(), ["valid-one"]);
});

test("loadSyncedCapabilities: returns valid capability definitions", () => {
  const dir = makeWorkspace();
  writeCache(dir, {
    capabilities: {
      "frontend-builder": {
        capability_name: "frontend-builder",
        updated_at: "2026-05-07T12:00:00.000Z",
        definition: FRONTEND_BUILDER,
      },
    },
  });
  const loaded = loadSyncedCapabilities(dir);
  assert.equal(loaded["frontend-builder"].name, "frontend-builder");
  assert.deepEqual(loaded["frontend-builder"].write_globs, ["src/components/**"]);
});

test("evaluateToolCall integration: synced capability is consulted via merged registry", () => {
  const cwd = makeWorkspace();
  // Sandbox the home-dir-based loader.
  const fakeHome = makeWorkspace();
  process.env.HOME = fakeHome;
  try {
    fs.mkdirSync(path.join(fakeHome, ".cortex"), { recursive: true });
    fs.writeFileSync(
      path.join(fakeHome, ".cortex", "capabilities.local.json"),
      JSON.stringify({
        capabilities: {
          "frontend-builder": {
            capability_name: "frontend-builder",
            updated_at: "2026-05-07T12:00:00.000Z",
            definition: FRONTEND_BUILDER,
          },
        },
      }),
      "utf8",
    );

    createRun({
      cwd,
      taskId: "task-1",
      workflow: WORKFLOW,
      taskDescription: "Build frontend",
    });

    // Allowed: src/components/**
    const allowed = evaluateToolCall({
      cwd,
      taskId: "task-1",
      call: { toolName: "Edit", toolInput: { file_path: "src/components/Foo.tsx" } },
      workflows: { fe: WORKFLOW },
    });
    assert.equal(allowed.allowed, true);

    // Blocked: outside write_globs
    const blocked = evaluateToolCall({
      cwd,
      taskId: "task-1",
      call: { toolName: "Edit", toolInput: { file_path: "src/server/api.ts" } },
      workflows: { fe: WORKFLOW },
    });
    assert.equal(blocked.allowed, false);
    assert.match(blocked.reason, /frontend-builder/);
  } finally {
    delete process.env.HOME;
  }
});

test("evaluateToolCall integration: synced capability with same name as bundled overrides bundled", () => {
  const cwd = makeWorkspace();
  const fakeHome = makeWorkspace();
  process.env.HOME = fakeHome;
  try {
    // Override the bundled "builder" capability with a much stricter version
    // — only test files writable.
    const stricterBuilder = {
      name: "builder",
      description: "Org-overridden strict builder",
      read_globs: ["**"],
      write_globs: ["tests/**"],
      tools_allowed: [],
    };
    fs.mkdirSync(path.join(fakeHome, ".cortex"), { recursive: true });
    fs.writeFileSync(
      path.join(fakeHome, ".cortex", "capabilities.local.json"),
      JSON.stringify({
        capabilities: {
          builder: {
            capability_name: "builder",
            updated_at: "2026-05-07T12:00:00.000Z",
            definition: stricterBuilder,
          },
        },
      }),
      "utf8",
    );

    const builderWorkflow = {
      id: "build-only",
      description: "Build-only workflow using bundled name",
      version: 1,
      stages: [
        {
          name: "build",
          artifact: "changes.md",
          reads: [],
          required_fields: [],
          validators: [],
          capability: "builder",
          description: "Build",
        },
      ],
    };
    createRun({
      cwd,
      taskId: "task-2",
      workflow: builderWorkflow,
      taskDescription: "Build",
    });

    // Bundled builder allows src/** + tests/**, but the org override only
    // allows tests/**. src/** must be blocked under the override.
    const result = evaluateToolCall({
      cwd,
      taskId: "task-2",
      call: { toolName: "Edit", toolInput: { file_path: "src/main.ts" } },
      workflows: { "build-only": builderWorkflow },
    });
    assert.equal(result.allowed, false);
    assert.match(result.reason, /Org-overridden|tests/i);
  } finally {
    delete process.env.HOME;
  }
});
