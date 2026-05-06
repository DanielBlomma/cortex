import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { evaluateToolCall } from "../dist/core/workflow/enforcement.js";
import { createRun } from "../dist/core/workflow/run-lifecycle.js";
import { capabilityDefinitionSchema, DEFAULT_CAPABILITIES } from "../dist/core/workflow/capabilities.js";

function makeWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cortex-enforcement-"));
}

const WORKFLOW_PLANNER = {
  id: "planner-only",
  description: "Single planner stage",
  version: 1,
  stages: [
    {
      name: "plan",
      artifact: "plan.md",
      reads: [],
      required_fields: [],
      capability: "planner",
      description: "Plan",
    },
  ],
};

const WORKFLOW_BUILDER = {
  id: "builder-only",
  description: "Single builder stage",
  version: 1,
  stages: [
    {
      name: "build",
      artifact: "changes.md",
      reads: [],
      required_fields: [],
      capability: "builder",
      description: "Build",
    },
  ],
};

const WORKFLOWS = {
  "planner-only": WORKFLOW_PLANNER,
  "builder-only": WORKFLOW_BUILDER,
};

function startPlannerRun(cwd, taskId = "task-1") {
  return createRun({
    cwd,
    taskId,
    workflow: WORKFLOW_PLANNER,
    taskDescription: "x",
  });
}

function startBuilderRun(cwd, taskId = "task-1") {
  return createRun({
    cwd,
    taskId,
    workflow: WORKFLOW_BUILDER,
    taskDescription: "x",
  });
}

test("capabilities: default registry validates against schema", () => {
  for (const cap of Object.values(DEFAULT_CAPABILITIES)) {
    capabilityDefinitionSchema.parse(cap);
  }
});

test("evaluator: allows everything when no run state exists", () => {
  const cwd = makeWorkspace();
  const result = evaluateToolCall({
    cwd,
    taskId: "ghost",
    call: { toolName: "Edit", toolInput: { file_path: "src/foo.ts" } },
    workflows: WORKFLOWS,
  });
  assert.equal(result.allowed, true);
});

test("planner: blocks Edit (read-only capability)", () => {
  const cwd = makeWorkspace();
  startPlannerRun(cwd);
  const result = evaluateToolCall({
    cwd,
    taskId: "task-1",
    call: { toolName: "Edit", toolInput: { file_path: "src/foo.ts" } },
    workflows: WORKFLOWS,
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /read-only/);
});

test("planner: blocks Bash (could mutate filesystem under read-only)", () => {
  const cwd = makeWorkspace();
  startPlannerRun(cwd);
  const result = evaluateToolCall({
    cwd,
    taskId: "task-1",
    call: { toolName: "Bash", toolInput: { command: "rm -rf /" } },
    workflows: WORKFLOWS,
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /Bash/);
});

test("planner: allows Read on any path", () => {
  const cwd = makeWorkspace();
  startPlannerRun(cwd);
  const result = evaluateToolCall({
    cwd,
    taskId: "task-1",
    call: { toolName: "Read", toolInput: { file_path: "src/anything.ts" } },
    workflows: WORKFLOWS,
  });
  assert.equal(result.allowed, true);
});

test("planner: allows Grep without explicit path", () => {
  const cwd = makeWorkspace();
  startPlannerRun(cwd);
  const result = evaluateToolCall({
    cwd,
    taskId: "task-1",
    call: { toolName: "Grep", toolInput: { pattern: "TODO" } },
    workflows: WORKFLOWS,
  });
  assert.equal(result.allowed, true);
});

test("builder: allows Edit on src/", () => {
  const cwd = makeWorkspace();
  startBuilderRun(cwd);
  const result = evaluateToolCall({
    cwd,
    taskId: "task-1",
    call: { toolName: "Edit", toolInput: { file_path: "src/foo.ts" } },
    workflows: WORKFLOWS,
  });
  assert.equal(result.allowed, true);
});

test("builder: allows Edit on tests/", () => {
  const cwd = makeWorkspace();
  startBuilderRun(cwd);
  const result = evaluateToolCall({
    cwd,
    taskId: "task-1",
    call: { toolName: "Edit", toolInput: { file_path: "tests/foo.test.ts" } },
    workflows: WORKFLOWS,
  });
  assert.equal(result.allowed, true);
});

test("builder: blocks Edit on package.json (outside write_globs)", () => {
  const cwd = makeWorkspace();
  startBuilderRun(cwd);
  const result = evaluateToolCall({
    cwd,
    taskId: "task-1",
    call: { toolName: "Edit", toolInput: { file_path: "package.json" } },
    workflows: WORKFLOWS,
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /outside capability builder/);
});

test("builder: blocks Edit on .github/workflows (CI file)", () => {
  const cwd = makeWorkspace();
  startBuilderRun(cwd);
  const result = evaluateToolCall({
    cwd,
    taskId: "task-1",
    call: {
      toolName: "Edit",
      toolInput: { file_path: ".github/workflows/release.yml" },
    },
    workflows: WORKFLOWS,
  });
  assert.equal(result.allowed, false);
});

test("builder: handles absolute path inside cwd", () => {
  const cwd = makeWorkspace();
  startBuilderRun(cwd);
  const abs = path.join(cwd, "src", "foo.ts");
  const result = evaluateToolCall({
    cwd,
    taskId: "task-1",
    call: { toolName: "Edit", toolInput: { file_path: abs } },
    workflows: WORKFLOWS,
  });
  assert.equal(result.allowed, true);
});

test("builder: blocks absolute path outside cwd", () => {
  const cwd = makeWorkspace();
  startBuilderRun(cwd);
  const result = evaluateToolCall({
    cwd,
    taskId: "task-1",
    call: { toolName: "Edit", toolInput: { file_path: "/etc/passwd" } },
    workflows: WORKFLOWS,
  });
  assert.equal(result.allowed, false);
});

test("builder: blocks Edit without file_path", () => {
  const cwd = makeWorkspace();
  startBuilderRun(cwd);
  const result = evaluateToolCall({
    cwd,
    taskId: "task-1",
    call: { toolName: "Edit", toolInput: {} },
    workflows: WORKFLOWS,
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /did not include a file_path/);
});

test("evaluator: tools_allowed list restricts tools by name", () => {
  const cwd = makeWorkspace();
  const customCapabilities = {
    ...DEFAULT_CAPABILITIES,
    "search-only": {
      name: "search-only",
      description: "Only Read + Grep allowed",
      read_globs: ["**"],
      write_globs: [],
      tools_allowed: ["Read", "Grep"],
    },
  };
  const customWorkflow = {
    id: "search-only",
    description: "Search only",
    version: 1,
    stages: [
      {
        name: "scan",
        artifact: "scan.md",
        reads: [],
        required_fields: [],
        capability: "search-only",
        description: "Scan",
      },
    ],
  };
  createRun({
    cwd,
    taskId: "task-1",
    workflow: customWorkflow,
    taskDescription: "x",
  });

  const grep = evaluateToolCall({
    cwd,
    taskId: "task-1",
    call: { toolName: "Grep", toolInput: { pattern: "x" } },
    workflows: { "search-only": customWorkflow },
    capabilities: customCapabilities,
  });
  assert.equal(grep.allowed, true);

  const glob = evaluateToolCall({
    cwd,
    taskId: "task-1",
    call: { toolName: "Glob", toolInput: { pattern: "*.ts" } },
    workflows: { "search-only": customWorkflow },
    capabilities: customCapabilities,
  });
  assert.equal(glob.allowed, false);
  assert.match(glob.reason, /does not allow tool Glob/);
});

test("evaluator: human capability blocks all tool calls", () => {
  const cwd = makeWorkspace();
  const humanWorkflow = {
    id: "human-only",
    description: "Human-only stage",
    version: 1,
    stages: [
      {
        name: "approval",
        artifact: "approval.md",
        reads: [],
        required_fields: [],
        capability: "human",
        description: "Approve",
      },
    ],
  };
  createRun({
    cwd,
    taskId: "task-1",
    workflow: humanWorkflow,
    taskDescription: "x",
  });

  const read = evaluateToolCall({
    cwd,
    taskId: "task-1",
    call: { toolName: "Read", toolInput: { file_path: "src/foo.ts" } },
    workflows: { "human-only": humanWorkflow },
  });
  assert.equal(read.allowed, false);
});

test("evaluator: stage without capability is unrestricted", () => {
  const cwd = makeWorkspace();
  const noCapabilityWorkflow = {
    id: "free",
    description: "No capability",
    version: 1,
    stages: [
      {
        name: "free-stage",
        artifact: "out.md",
        reads: [],
        required_fields: [],
        description: "No restriction",
      },
    ],
  };
  createRun({
    cwd,
    taskId: "task-1",
    workflow: noCapabilityWorkflow,
    taskDescription: "x",
  });

  const result = evaluateToolCall({
    cwd,
    taskId: "task-1",
    call: { toolName: "Bash", toolInput: { command: "ls" } },
    workflows: { free: noCapabilityWorkflow },
  });
  assert.equal(result.allowed, true);
});

test("evaluator: completed run does not gate any tool calls", () => {
  const cwd = makeWorkspace();
  const completed = createRun({
    cwd,
    taskId: "task-1",
    workflow: WORKFLOW_PLANNER,
    taskDescription: "x",
  });
  // Manually corrupt to "complete" without going through advanceStage —
  // simulates a run that finished before the hook fires.
  const statePath = path.join(cwd, ".agents", "task-1", "state.json");
  const raw = JSON.parse(fs.readFileSync(statePath, "utf8"));
  raw.outcome = "complete";
  raw.current_stage = null;
  raw.completed_at = new Date().toISOString();
  fs.writeFileSync(statePath, JSON.stringify(raw, null, 2));

  const result = evaluateToolCall({
    cwd,
    taskId: "task-1",
    call: { toolName: "Edit", toolInput: { file_path: "src/foo.ts" } },
    workflows: WORKFLOWS,
  });
  assert.equal(result.allowed, true);
});
