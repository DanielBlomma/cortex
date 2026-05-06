import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createRun,
  advanceStage,
} from "../dist/core/workflow/run-lifecycle.js";
import { composeStageEnvelope } from "../dist/core/workflow/envelope.js";
import {
  runWorkflowAdvance,
  runWorkflowStart,
} from "../dist/core/workflow/mcp-tools.js";

function makeWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cortex-validators-"));
}

const WORKFLOW = {
  id: "validated",
  description: "One stage that requires two validators",
  version: 1,
  stages: [
    {
      name: "build",
      artifact: "changes.md",
      reads: [],
      required_fields: [],
      validators: [
        { id: "tests-pass", description: "Test suite must pass" },
        { id: "build-passes", description: "Build must succeed" },
      ],
      capability: "builder",
      description: "Implement the change.",
    },
  ],
};

const REGISTRY = { validated: WORKFLOW };

test("advanceStage: blocks when validators_passed misses required ids", () => {
  const cwd = makeWorkspace();
  createRun({
    cwd,
    taskId: "task-1",
    workflow: WORKFLOW,
    taskDescription: "Test",
  });

  assert.throws(
    () =>
      advanceStage({
        cwd,
        taskId: "task-1",
        workflow: WORKFLOW,
        stageName: "build",
        artifactName: "changes.md",
        frontmatter: { stage: "build", status: "complete", references: [] },
        body: "# Changes",
        validatorsPassed: ["tests-pass"], // missing build-passes
      }),
    /Missing: build-passes/,
  );
});

test("advanceStage: allows when validators_passed covers required ids", () => {
  const cwd = makeWorkspace();
  createRun({
    cwd,
    taskId: "task-1",
    workflow: WORKFLOW,
    taskDescription: "Test",
  });

  const next = advanceStage({
    cwd,
    taskId: "task-1",
    workflow: WORKFLOW,
    stageName: "build",
    artifactName: "changes.md",
    frontmatter: { stage: "build", status: "complete", references: [] },
    body: "# Changes",
    validatorsPassed: ["tests-pass", "build-passes"],
  });
  assert.equal(next.outcome, "complete");
  assert.deepEqual(next.stages[0].validators_passed, ["tests-pass", "build-passes"]);
});

test("advanceStage: override.skipped_validators bypasses missing-validator block", () => {
  const cwd = makeWorkspace();
  createRun({
    cwd,
    taskId: "task-1",
    workflow: WORKFLOW,
    taskDescription: "Test",
  });

  const next = advanceStage({
    cwd,
    taskId: "task-1",
    workflow: WORKFLOW,
    stageName: "build",
    artifactName: "changes.md",
    frontmatter: { stage: "build", status: "complete", references: [] },
    body: "# Changes",
    validatorsPassed: ["tests-pass"],
    override: {
      reason: "Build infra is down on CI; skipping per ops-incident-2026-05-06",
      skipped_validators: ["build-passes"],
    },
  });

  assert.equal(next.outcome, "complete");
  assert.equal(next.stages[0].override?.reason.includes("Build infra is down"), true);
  assert.deepEqual(next.stages[0].override?.skipped_validators, ["build-passes"]);
});

test("advanceStage: blocked status is exempt from validator coverage check", () => {
  const cwd = makeWorkspace();
  createRun({
    cwd,
    taskId: "task-1",
    workflow: WORKFLOW,
    taskDescription: "Test",
  });

  const next = advanceStage({
    cwd,
    taskId: "task-1",
    workflow: WORKFLOW,
    stageName: "build",
    artifactName: "changes.md",
    frontmatter: { stage: "build", status: "blocked", references: [] },
    body: "# Plan blocked\n\nMissing context.",
    status: "blocked",
    validatorsPassed: [], // exempt
  });
  assert.equal(next.outcome, "blocked");
});

test("advanceStage: override is stamped into the artifact frontmatter", () => {
  const cwd = makeWorkspace();
  createRun({
    cwd,
    taskId: "task-1",
    workflow: WORKFLOW,
    taskDescription: "Test",
  });

  advanceStage({
    cwd,
    taskId: "task-1",
    workflow: WORKFLOW,
    stageName: "build",
    artifactName: "changes.md",
    frontmatter: { stage: "build", status: "complete", references: [] },
    body: "# Changes",
    validatorsPassed: ["tests-pass"],
    override: {
      reason: "Hot fix, will follow up",
      skipped_validators: ["build-passes"],
    },
  });

  const text = fs.readFileSync(
    path.join(cwd, ".agents", "task-1", "changes.md"),
    "utf8",
  );
  assert.match(text, /override:/);
  assert.match(text, /reason: Hot fix/);
  assert.match(text, /- build-passes/);
});

test("composeStageEnvelope: renders VALIDATORS section when stage declares them", () => {
  const cwd = makeWorkspace();
  createRun({
    cwd,
    taskId: "task-1",
    workflow: WORKFLOW,
    taskDescription: "Test",
  });

  const env = composeStageEnvelope({
    cwd,
    taskId: "task-1",
    workflow: WORKFLOW,
  });

  assert.match(env.prompt, /# VALIDATORS/);
  assert.match(env.prompt, /`tests-pass` — Test suite must pass/);
  assert.match(env.prompt, /`build-passes` — Build must succeed/);
  assert.match(env.prompt, /`validators_passed: \[<id1>, <id2>, \.\.\.\]`/);
  assert.deepEqual(env.validators.map((v) => v.id), ["tests-pass", "build-passes"]);
});

test("composeStageEnvelope: VALIDATORS section is empty when stage has none", () => {
  const cwd = makeWorkspace();
  const noValidators = {
    ...WORKFLOW,
    stages: [{ ...WORKFLOW.stages[0], validators: [] }],
  };
  createRun({
    cwd,
    taskId: "task-1",
    workflow: noValidators,
    taskDescription: "Test",
  });

  const env = composeStageEnvelope({
    cwd,
    taskId: "task-1",
    workflow: noValidators,
  });

  assert.match(env.prompt, /No validators required for this stage/);
  assert.equal(env.validators.length, 0);
});

test("runWorkflowAdvance MCP runner: forwards validators_passed + override", () => {
  const cwd = makeWorkspace();
  runWorkflowStart(
    { task_id: "task-1", task_description: "x", workflow_id: "validated" },
    { cwd, workflows: REGISTRY },
  );

  const result = runWorkflowAdvance(
    {
      task_id: "task-1",
      stage: "build",
      frontmatter: {},
      body: "# Changes",
      validators_passed: ["tests-pass"],
      override: {
        reason: "CI builder offline; manual verification done",
        skipped_validators: ["build-passes"],
        skipped_requirements: [],
      },
    },
    { cwd, workflows: REGISTRY },
  );

  assert.equal(result.state.outcome, "complete");
  assert.equal(
    result.state.stages[0].override?.reason.includes("CI builder offline"),
    true,
  );
});

test("runWorkflowAdvance MCP runner: rejects missing validators without override", () => {
  const cwd = makeWorkspace();
  runWorkflowStart(
    { task_id: "task-1", task_description: "x", workflow_id: "validated" },
    { cwd, workflows: REGISTRY },
  );

  assert.throws(
    () =>
      runWorkflowAdvance(
        {
          task_id: "task-1",
          stage: "build",
          frontmatter: {},
          body: "# Changes",
          validators_passed: [],
        },
        { cwd, workflows: REGISTRY },
      ),
    /Missing: tests-pass, build-passes/,
  );
});
