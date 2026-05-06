import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  parseStageArtifact,
  renderStageArtifact,
  readRunState,
  readStageArtifact,
} from "../dist/core/workflow/artifact-io.js";
import {
  createRun,
  advanceStage,
  getRunState,
} from "../dist/core/workflow/run-lifecycle.js";
import {
  workflowDefinitionSchema,
  stageArtifactFrontmatterSchema,
  runStateSchema,
} from "../dist/core/workflow/schemas.js";
import { SECURE_BUILD_WORKFLOW } from "../dist/core/workflow/default-workflows.js";

function makeWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cortex-workflow-"));
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
      required_fields: [],
      description: "Produce a plan",
    },
    {
      name: "review",
      artifact: "review.md",
      reads: ["plan"],
      required_fields: ["approved"],
      description: "Review the plan",
    },
  ],
};

test("schemas: SECURE_BUILD_WORKFLOW validates against workflowDefinitionSchema", () => {
  const parsed = workflowDefinitionSchema.parse(SECURE_BUILD_WORKFLOW);
  assert.equal(parsed.id, "secure-build");
  assert.ok(parsed.stages.length > 0);
});

test("schemas: stage names must be slug-cased", () => {
  assert.throws(() =>
    workflowDefinitionSchema.parse({
      ...TINY_WORKFLOW,
      stages: [
        { ...TINY_WORKFLOW.stages[0], name: "Bad Name" },
        TINY_WORKFLOW.stages[1],
      ],
    }),
  );
});

test("schemas: stage artifact frontmatter requires status + stage", () => {
  assert.throws(() =>
    stageArtifactFrontmatterSchema.parse({
      stage: "plan",
      // status missing
      written_at: new Date().toISOString(),
    }),
  );
});

test("artifact-io: render + parse round-trips frontmatter", () => {
  const fm = stageArtifactFrontmatterSchema.parse({
    stage: "plan",
    status: "complete",
    references: [],
    written_at: "2026-05-06T19:00:00.000Z",
  });
  const text = renderStageArtifact(fm, "# Plan\n\nDo the thing.");
  const parsed = parseStageArtifact(text);
  assert.equal(parsed.frontmatter.stage, "plan");
  assert.equal(parsed.frontmatter.status, "complete");
  assert.equal(parsed.body, "# Plan\n\nDo the thing.");
});

test("artifact-io: parseStageArtifact rejects missing frontmatter", () => {
  assert.throws(() => parseStageArtifact("# No frontmatter here\n"));
});

test("artifact-io: parseStageArtifact rejects unterminated frontmatter", () => {
  assert.throws(() =>
    parseStageArtifact("---\nstage: plan\nstatus: complete\n# no close marker\n"),
  );
});

test("artifact-io: parseStageArtifact preserves passthrough fields", () => {
  const text = `---
stage: review
status: complete
references:
  - plan.md
written_at: "2026-05-06T19:00:00.000Z"
approved: true
blocking_comments: 0
---

# Review

Looks good.
`;
  const parsed = parseStageArtifact(text);
  assert.equal(parsed.frontmatter.stage, "review");
  assert.deepEqual(parsed.frontmatter.references, ["plan.md"]);
  assert.equal(parsed.frontmatter.approved, true);
  assert.equal(parsed.frontmatter.blocking_comments, 0);
});

test("createRun: writes state.json with all stages pending and current_stage = first", () => {
  const cwd = makeWorkspace();
  const state = createRun({
    cwd,
    taskId: "2026-05-06-fixture",
    workflow: TINY_WORKFLOW,
    taskDescription: "Test run",
  });

  assert.equal(state.task_id, "2026-05-06-fixture");
  assert.equal(state.current_stage, "plan");
  assert.equal(state.outcome, "in_progress");
  assert.deepEqual(
    state.stages.map((s) => s.status),
    ["pending", "pending"],
  );

  const persisted = readRunState(cwd, "2026-05-06-fixture");
  assert.deepEqual(persisted, state);
});

test("advanceStage: writes artifact, updates state, advances current_stage", () => {
  const cwd = makeWorkspace();
  const taskId = "2026-05-06-advance";
  createRun({ cwd, taskId, workflow: TINY_WORKFLOW, taskDescription: "Test" });

  const after = advanceStage({
    cwd,
    taskId,
    workflow: TINY_WORKFLOW,
    stageName: "plan",
    artifactName: "plan.md",
    frontmatter: { stage: "plan", status: "complete", references: [] },
    body: "# Plan\n\n- step 1\n- step 2",
  });

  assert.equal(after.current_stage, "review");
  assert.equal(after.outcome, "in_progress");
  assert.equal(after.stages[0].status, "complete");
  assert.equal(after.stages[0].artifact, "plan.md");
  assert.equal(after.stages[1].status, "pending");

  // Artifact lives on disk under .agents/<taskId>/
  const artifactPath = path.join(cwd, ".agents", taskId, "plan.md");
  assert.ok(fs.existsSync(artifactPath));
  const parsed = readStageArtifact(cwd, taskId, "plan.md");
  assert.equal(parsed.frontmatter.stage, "plan");
});

test("advanceStage: marks run complete after final stage", () => {
  const cwd = makeWorkspace();
  const taskId = "2026-05-06-final";
  createRun({ cwd, taskId, workflow: TINY_WORKFLOW, taskDescription: "Test" });

  advanceStage({
    cwd,
    taskId,
    workflow: TINY_WORKFLOW,
    stageName: "plan",
    artifactName: "plan.md",
    frontmatter: { stage: "plan", status: "complete", references: [] },
    body: "# Plan",
  });

  const after = advanceStage({
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
    },
    body: "# Review\n\napproved",
    outcome: { approved: true },
  });

  assert.equal(after.current_stage, null);
  assert.equal(after.outcome, "complete");
  assert.ok(after.completed_at);
  assert.deepEqual(after.stages[1].outcome, { approved: true });
});

test("advanceStage: blocked status surfaces as run outcome", () => {
  const cwd = makeWorkspace();
  const taskId = "2026-05-06-blocked";
  createRun({ cwd, taskId, workflow: TINY_WORKFLOW, taskDescription: "Test" });

  const after = advanceStage({
    cwd,
    taskId,
    workflow: TINY_WORKFLOW,
    stageName: "plan",
    artifactName: "plan.md",
    frontmatter: { stage: "plan", status: "blocked", references: [] },
    body: "# Plan blocked",
    status: "blocked",
  });

  assert.equal(after.outcome, "blocked");
  assert.equal(after.current_stage, null);
});

test("advanceStage: refuses to advance the wrong stage", () => {
  const cwd = makeWorkspace();
  const taskId = "2026-05-06-wrong";
  createRun({ cwd, taskId, workflow: TINY_WORKFLOW, taskDescription: "Test" });

  assert.throws(() =>
    advanceStage({
      cwd,
      taskId,
      workflow: TINY_WORKFLOW,
      stageName: "review",
      artifactName: "review.md",
      frontmatter: { stage: "review", status: "complete", references: [] },
      body: "# Out of order",
    }),
  );
});

test("getRunState: returns null for missing tasks", () => {
  const cwd = makeWorkspace();
  assert.equal(getRunState(cwd, "no-such-task"), null);
});

test("readRunState: validates persisted state against schema", () => {
  const cwd = makeWorkspace();
  const taskId = "2026-05-06-corrupt";
  createRun({ cwd, taskId, workflow: TINY_WORKFLOW, taskDescription: "Test" });

  // Corrupt the file: drop required field.
  const statePath = path.join(cwd, ".agents", taskId, "state.json");
  const raw = JSON.parse(fs.readFileSync(statePath, "utf8"));
  delete raw.workflow_id;
  fs.writeFileSync(statePath, JSON.stringify(raw, null, 2));

  assert.throws(() => readRunState(cwd, taskId));
});

test("runStateSchema: rejects unknown outcome", () => {
  assert.throws(() =>
    runStateSchema.parse({
      schema_version: 1,
      task_id: "x",
      workflow_id: "tiny",
      workflow_version: 1,
      task_description: "y",
      current_stage: null,
      outcome: "totally-bogus",
      started_at: new Date().toISOString(),
      completed_at: null,
      stages: [{ name: "plan", status: "complete" }],
    }),
  );
});
