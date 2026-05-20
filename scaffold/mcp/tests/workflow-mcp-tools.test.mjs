import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  WorkflowStartInput,
  WorkflowAdvanceInput,
  WorkflowStatusInput,
  WorkflowEnvelopeInput,
  runWorkflowStart,
  runWorkflowAdvance,
  runWorkflowStatus,
  runWorkflowEnvelope,
} from "../dist/core/workflow/mcp-tools.js";
import { SECURE_BUILD_WORKFLOW } from "../dist/core/workflow/default-workflows.js";

function makeWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cortex-mcp-tools-"));
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

const TINY_REGISTRY = { tiny: TINY_WORKFLOW };

test("input schemas: workflow_id defaults to secure-build", () => {
  const parsed = WorkflowStartInput.parse({
    task_id: "abc",
    task_description: "y",
  });
  assert.equal(parsed.workflow_id, "secure-build");
});

test("input schemas: advance requires stage + body", () => {
  assert.throws(() => WorkflowAdvanceInput.parse({ task_id: "abc" }));
  assert.throws(() =>
    WorkflowAdvanceInput.parse({ task_id: "abc", stage: "plan", body: "" }),
  );
});

test("input schemas: status accepts only task_id", () => {
  const parsed = WorkflowStatusInput.parse({ task_id: "abc" });
  assert.equal(parsed.task_id, "abc");
});

test("input schemas: envelope stage is optional", () => {
  const parsed = WorkflowEnvelopeInput.parse({ task_id: "abc" });
  assert.equal(parsed.stage, undefined);
});

test("runWorkflowStart: creates run and returns the first envelope", () => {
  const cwd = makeWorkspace();
  const result = runWorkflowStart(
    {
      task_id: "task-1",
      task_description: "Add login flow",
      workflow_id: "tiny",
    },
    { cwd, workflows: TINY_REGISTRY },
  );

  assert.equal(result.state.task_id, "task-1");
  assert.equal(result.state.current_stage, "plan");
  assert.equal(result.state.outcome, "in_progress");
  assert.equal(result.envelope.expectedArtifact, "plan.md");
  assert.equal(result.workflow_source, "injected");
  assert.match(result.envelope.prompt, /# STAGE: plan/);

  // state.json persisted under .agents/<task-id>/
  const statePath = path.join(cwd, ".agents", "task-1", "state.json");
  assert.ok(fs.existsSync(statePath));
});

test("runWorkflowStart: rejects unknown workflow_id", () => {
  const cwd = makeWorkspace();
  assert.throws(
    () =>
      runWorkflowStart(
        { task_id: "task-1", task_description: "x", workflow_id: "nope" },
        { cwd, workflows: TINY_REGISTRY },
      ),
    /Unknown workflow_id/,
  );
});

test("runWorkflowStart: defaults to bundled DEFAULT_WORKFLOWS when no registry given", () => {
  const cwd = makeWorkspace();
  const result = runWorkflowStart(
    {
      task_id: "task-1",
      task_description: "Use the default workflow",
      workflow_id: SECURE_BUILD_WORKFLOW.id,
    },
    { cwd },
  );
  assert.equal(result.state.workflow_id, "secure-build");
  assert.equal(result.envelope.expectedArtifact, "plan.md");
  assert.equal(result.workflow_source, "bundled");
  assert.equal(result.warnings.length, 0);
});

test("runWorkflowStart: blocks bundled fallback when the caller requires synced workflows", () => {
  const cwd = makeWorkspace();
  assert.throws(
    () =>
      runWorkflowStart(
        {
          task_id: "task-enforced",
          task_description: "Use the default workflow",
          workflow_id: SECURE_BUILD_WORKFLOW.id,
        },
        {
          cwd,
          bundledFallbackPolicy: "block",
        },
      ),
    /requires a synced org workflow/,
  );
});

test("runWorkflowAdvance: writes artifact + state, returns next envelope while in_progress", () => {
  const cwd = makeWorkspace();
  runWorkflowStart(
    { task_id: "task-2", task_description: "Multi-stage", workflow_id: "tiny" },
    { cwd, workflows: TINY_REGISTRY },
  );

  const advance = runWorkflowAdvance(
    {
      task_id: "task-2",
      stage: "plan",
      frontmatter: {},
      body: "# Plan\n\nDetailed plan body.",
    },
    { cwd, workflows: TINY_REGISTRY },
  );

  assert.equal(advance.state.current_stage, "review");
  assert.equal(advance.state.outcome, "in_progress");
  assert.equal(advance.state.stages[0].status, "complete");
  assert.equal(advance.state.stages[0].artifact, "plan.md");
  assert.ok(advance.next_envelope);
  assert.equal(advance.next_envelope.expectedArtifact, "review.md");
  // The handoff renders the plan artifact inline.
  assert.match(advance.next_envelope.prompt, /--- handoff:plan \(plan\.md\) ---/);
});

test("runWorkflowAdvance: returns next_envelope=null when run completes", () => {
  const cwd = makeWorkspace();
  runWorkflowStart(
    { task_id: "task-3", task_description: "x", workflow_id: "tiny" },
    { cwd, workflows: TINY_REGISTRY },
  );
  runWorkflowAdvance(
    { task_id: "task-3", stage: "plan", frontmatter: {}, body: "# Plan" },
    { cwd, workflows: TINY_REGISTRY },
  );

  const finalAdvance = runWorkflowAdvance(
    {
      task_id: "task-3",
      stage: "review",
      frontmatter: { approved: true },
      body: "# Review\n\nLooks good.",
      outcome: { approved: true },
    },
    { cwd, workflows: TINY_REGISTRY },
  );

  assert.equal(finalAdvance.state.current_stage, null);
  assert.equal(finalAdvance.state.outcome, "complete");
  assert.equal(finalAdvance.next_envelope, null);
});

test("runWorkflowAdvance: blocked status halts the run and returns null envelope", () => {
  const cwd = makeWorkspace();
  runWorkflowStart(
    { task_id: "task-4", task_description: "x", workflow_id: "tiny" },
    { cwd, workflows: TINY_REGISTRY },
  );

  const result = runWorkflowAdvance(
    {
      task_id: "task-4",
      stage: "plan",
      frontmatter: {},
      body: "# Plan blocked\n\nMissing context.",
      status: "blocked",
    },
    { cwd, workflows: TINY_REGISTRY },
  );

  assert.equal(result.state.outcome, "blocked");
  assert.equal(result.state.current_stage, null);
  assert.equal(result.next_envelope, null);
});

test("runWorkflowAdvance: rejects when no run exists", () => {
  const cwd = makeWorkspace();
  assert.throws(
    () =>
      runWorkflowAdvance(
        {
          task_id: "ghost",
          stage: "plan",
          frontmatter: {},
          body: "# Plan",
        },
        { cwd, workflows: TINY_REGISTRY },
      ),
    /No run state/,
  );
});

test("runWorkflowAdvance: auto-derives references from stage.reads when caller omits them", () => {
  const cwd = makeWorkspace();
  runWorkflowStart(
    { task_id: "task-5", task_description: "x", workflow_id: "tiny" },
    { cwd, workflows: TINY_REGISTRY },
  );
  runWorkflowAdvance(
    { task_id: "task-5", stage: "plan", frontmatter: {}, body: "# Plan" },
    { cwd, workflows: TINY_REGISTRY },
  );
  runWorkflowAdvance(
    {
      task_id: "task-5",
      stage: "review",
      frontmatter: { approved: false },
      body: "# Review",
    },
    { cwd, workflows: TINY_REGISTRY },
  );

  const reviewArtifact = path.join(cwd, ".agents", "task-5", "review.md");
  const text = fs.readFileSync(reviewArtifact, "utf8");
  assert.match(text, /references:/);
  assert.match(text, /- plan\.md/);
});

test("runWorkflowStatus: returns state for an active run", () => {
  const cwd = makeWorkspace();
  runWorkflowStart(
    { task_id: "task-6", task_description: "x", workflow_id: "tiny" },
    { cwd, workflows: TINY_REGISTRY },
  );

  const result = runWorkflowStatus({ task_id: "task-6" }, { cwd, workflows: TINY_REGISTRY });
  assert.equal(result.state?.task_id, "task-6");
  assert.equal(result.state?.current_stage, "plan");
});

test("runWorkflowStatus: returns null state when nothing exists", () => {
  const cwd = makeWorkspace();
  const result = runWorkflowStatus({ task_id: "no-run" }, { cwd, workflows: TINY_REGISTRY });
  assert.equal(result.state, null);
});

test("runWorkflowEnvelope: returns current envelope without mutating state", () => {
  const cwd = makeWorkspace();
  runWorkflowStart(
    { task_id: "task-7", task_description: "x", workflow_id: "tiny" },
    { cwd, workflows: TINY_REGISTRY },
  );

  const before = runWorkflowStatus({ task_id: "task-7" }, { cwd, workflows: TINY_REGISTRY });
  const envelope = runWorkflowEnvelope(
    { task_id: "task-7" },
    { cwd, workflows: TINY_REGISTRY },
  );
  const after = runWorkflowStatus({ task_id: "task-7" }, { cwd, workflows: TINY_REGISTRY });

  assert.equal(envelope.envelope.expectedArtifact, "plan.md");
  assert.deepEqual(before.state, after.state);
});

test("runWorkflowEnvelope: explicit stage overrides current_stage for dry-run", () => {
  const cwd = makeWorkspace();
  runWorkflowStart(
    { task_id: "task-8", task_description: "x", workflow_id: "tiny" },
    { cwd, workflows: TINY_REGISTRY },
  );

  // Dry-run review even though we're at plan — should fail because review
  // requires plan's artifact to exist.
  assert.throws(() =>
    runWorkflowEnvelope(
      { task_id: "task-8", stage: "review" },
      { cwd, workflows: TINY_REGISTRY },
    ),
  );
});
