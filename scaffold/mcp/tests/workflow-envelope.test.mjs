import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { composeStageEnvelope } from "../dist/core/workflow/envelope.js";
import { createRun, advanceStage } from "../dist/core/workflow/run-lifecycle.js";

function makeWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cortex-envelope-"));
}

const TINY_WORKFLOW = {
  id: "tiny",
  description: "Two-stage workflow used for tests",
  version: 1,
  stages: [
    {
      name: "plan",
      artifact: "plan.md",
      reads: [],
      required_fields: ["files_targeted"],
      capability: "planner",
      description: "Produce a step-by-step plan.",
    },
    {
      name: "review",
      artifact: "review.md",
      reads: ["plan"],
      required_fields: ["approved", "blocking_comments"],
      capability: "reviewer",
      description: "Review the plan for soundness.",
    },
  ],
};

function startRun(cwd, taskId) {
  return createRun({
    cwd,
    taskId,
    workflow: TINY_WORKFLOW,
    taskDescription: "Wire up the new dashboard endpoint.",
  });
}

function completePlanStage(cwd, taskId) {
  return advanceStage({
    cwd,
    taskId,
    workflow: TINY_WORKFLOW,
    stageName: "plan",
    artifactName: "plan.md",
    frontmatter: {
      stage: "plan",
      status: "complete",
      references: [],
      files_targeted: ["src/foo.ts"],
    },
    body: "# Plan\n\n1. Add endpoint\n2. Wire route",
  });
}

test("composeStageEnvelope: first stage has no handoffs and labels first-stage explicitly", () => {
  const cwd = makeWorkspace();
  const taskId = "envelope-first";
  startRun(cwd, taskId);

  const envelope = composeStageEnvelope({ cwd, taskId, workflow: TINY_WORKFLOW });

  assert.equal(envelope.expectedArtifact, "plan.md");
  assert.deepEqual(envelope.requiredFields, ["files_targeted"]);
  assert.equal(envelope.capability, "planner");
  assert.match(envelope.prompt, /# TASK/);
  assert.match(envelope.prompt, /Wire up the new dashboard endpoint\./);
  assert.match(envelope.prompt, /# STAGE: plan/);
  assert.match(envelope.prompt, /Running under capability: `planner`/);
  assert.match(envelope.prompt, /No prior-stage artifacts/);
  assert.match(envelope.prompt, /# OUTPUT/);
  assert.match(envelope.prompt, /`files_targeted`/);
});

test("composeStageEnvelope: mid-flow stage inlines prior artifact verbatim", () => {
  const cwd = makeWorkspace();
  const taskId = "envelope-mid";
  startRun(cwd, taskId);
  completePlanStage(cwd, taskId);

  const envelope = composeStageEnvelope({ cwd, taskId, workflow: TINY_WORKFLOW });

  assert.equal(envelope.expectedArtifact, "review.md");
  assert.deepEqual(envelope.requiredFields, ["approved", "blocking_comments"]);
  assert.match(envelope.prompt, /# STAGE: review/);
  // Handoff section uses fenced markers and contains the planning frontmatter + body.
  assert.match(envelope.prompt, /--- handoff:plan \(plan\.md\) ---/);
  assert.match(envelope.prompt, /--- end handoff:plan ---/);
  assert.match(envelope.prompt, /stage: plan/);
  assert.match(envelope.prompt, /1\. Add endpoint/);
});

test("composeStageEnvelope: explicit stageName overrides current_stage for dry-run", () => {
  const cwd = makeWorkspace();
  const taskId = "envelope-explicit";
  startRun(cwd, taskId);

  const envelope = composeStageEnvelope({
    cwd,
    taskId,
    workflow: TINY_WORKFLOW,
    stageName: "plan",
  });
  assert.match(envelope.prompt, /# STAGE: plan/);
});

test("composeStageEnvelope: throws when run hasn't been created", () => {
  const cwd = makeWorkspace();
  assert.throws(
    () => composeStageEnvelope({ cwd, taskId: "ghost", workflow: TINY_WORKFLOW }),
    /No run state/,
  );
});

test("composeStageEnvelope: throws when stage not in workflow", () => {
  const cwd = makeWorkspace();
  const taskId = "envelope-unknown";
  startRun(cwd, taskId);

  assert.throws(
    () =>
      composeStageEnvelope({
        cwd,
        taskId,
        workflow: TINY_WORKFLOW,
        stageName: "nonexistent",
      }),
    /not defined in workflow/,
  );
});

test("composeStageEnvelope: throws when prior handoff artifact hasn't been produced", () => {
  const cwd = makeWorkspace();
  const taskId = "envelope-missing";
  startRun(cwd, taskId);
  // Skip the plan stage — go straight to asking for a review envelope. Plan
  // is still pending so its artifact doesn't exist.
  assert.throws(
    () =>
      composeStageEnvelope({
        cwd,
        taskId,
        workflow: TINY_WORKFLOW,
        stageName: "review",
      }),
    /requires artifact from plan, but it has not been produced yet/,
  );
});

test("composeStageEnvelope: throws when stage declares reads from unknown stage", () => {
  const cwd = makeWorkspace();
  const taskId = "envelope-bad-reads";
  const broken = {
    ...TINY_WORKFLOW,
    stages: [
      TINY_WORKFLOW.stages[0],
      { ...TINY_WORKFLOW.stages[1], reads: ["does-not-exist"] },
    ],
  };
  createRun({
    cwd,
    taskId,
    workflow: broken,
    taskDescription: "Test bad reads",
  });
  advanceStage({
    cwd,
    taskId,
    workflow: broken,
    stageName: "plan",
    artifactName: "plan.md",
    frontmatter: { stage: "plan", status: "complete", references: [] },
    body: "# Plan",
  });

  assert.throws(
    () =>
      composeStageEnvelope({
        cwd,
        taskId,
        workflow: broken,
        stageName: "review",
      }),
    /declares reads from unknown stage/,
  );
});

test("composeStageEnvelope: surfaces lack of capability gracefully", () => {
  const cwd = makeWorkspace();
  const taskId = "envelope-no-capability";
  const noCapability = {
    ...TINY_WORKFLOW,
    stages: [
      { ...TINY_WORKFLOW.stages[0], capability: undefined },
      TINY_WORKFLOW.stages[1],
    ],
  };
  createRun({
    cwd,
    taskId,
    workflow: noCapability,
    taskDescription: "Test no capability",
  });

  const envelope = composeStageEnvelope({
    cwd,
    taskId,
    workflow: noCapability,
  });
  assert.equal(envelope.capability, null);
  assert.match(envelope.prompt, /No capability constraint declared/);
});

test("composeStageEnvelope: throws when run is already finished", () => {
  const cwd = makeWorkspace();
  const taskId = "envelope-finished";
  startRun(cwd, taskId);
  completePlanStage(cwd, taskId);
  advanceStage({
    cwd,
    taskId,
    workflow: TINY_WORKFLOW,
    stageName: "review",
    artifactName: "review.md",
    frontmatter: {
      stage: "review",
      status: "complete",
      references: ["plan.md"],
      approved: true,
      blocking_comments: 0,
    },
    body: "# Review\n\nLooks good.",
  });

  assert.throws(
    () => composeStageEnvelope({ cwd, taskId, workflow: TINY_WORKFLOW }),
    /not at any stage/,
  );
});
