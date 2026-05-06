import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runDrive } from "../dist/cli/stage-drive.js";
import {
  createRun,
  advanceStage,
  getRunState,
} from "../dist/core/workflow/run-lifecycle.js";

function makeWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cortex-drive-"));
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

const REGISTRY = { tiny: TINY_WORKFLOW };

/**
 * Fake agent that "completes" the current stage by directly calling
 * advanceStage(). The real flow is: agent gets envelope on stdin →
 * agent does work → agent calls cortex.workflow.advance via MCP. This
 * mock collapses that into a synchronous call for unit-test purposes.
 */
function makeAdvancingAgent({
  status = "complete",
  body = "# Stage body",
  frontmatter = {},
} = {}) {
  return async (args) => {
    const state = getRunState(args.cwd, args.taskId);
    if (!state || !state.current_stage) {
      throw new Error("agent invoked but run is not in progress");
    }
    const stage = TINY_WORKFLOW.stages.find((s) => s.name === state.current_stage);
    if (!stage) throw new Error(`unknown stage ${state.current_stage}`);
    advanceStage({
      cwd: args.cwd,
      taskId: args.taskId,
      workflow: TINY_WORKFLOW,
      stageName: state.current_stage,
      artifactName: stage.artifact,
      frontmatter: {
        stage: state.current_stage,
        status,
        references: [],
        ...frontmatter,
      },
      body,
      status,
    });
  };
}

test("runDrive: starts a new run when none exists", async () => {
  const cwd = makeWorkspace();
  let stagesSeen = 0;

  const result = await runDrive({
    cwd,
    taskId: "task-1",
    description: "Add a thing",
    workflowId: "tiny",
    maxStages: 10,
    agentCommand: "<unused>",
    agentArgs: [],
    spawnAgent: makeAdvancingAgent(),
    onStageStart: () => {
      stagesSeen += 1;
    },
    workflows: REGISTRY,
  });

  assert.equal(result.state.outcome, "complete");
  assert.equal(result.state.current_stage, null);
  assert.equal(result.stagesDriven, 2);
  assert.equal(stagesSeen, 2);
});

test("runDrive: resumes an existing run when no description given", async () => {
  const cwd = makeWorkspace();
  createRun({
    cwd,
    taskId: "task-1",
    workflow: TINY_WORKFLOW,
    taskDescription: "pre-existing",
  });

  const result = await runDrive({
    cwd,
    taskId: "task-1",
    maxStages: 10,
    agentCommand: "<unused>",
    agentArgs: [],
    spawnAgent: makeAdvancingAgent(),
    workflows: REGISTRY,
  });

  assert.equal(result.state.outcome, "complete");
  assert.equal(result.state.task_description, "pre-existing");
});

test("runDrive: rejects when no run exists and no --description given", async () => {
  const cwd = makeWorkspace();
  await assert.rejects(
    runDrive({
      cwd,
      taskId: "ghost",
      maxStages: 10,
      agentCommand: "<unused>",
      agentArgs: [],
      spawnAgent: makeAdvancingAgent(),
      workflows: REGISTRY,
    }),
    /No run exists.*--description was not provided/s,
  );
});

test("runDrive: rejects when agent exits without advancing", async () => {
  const cwd = makeWorkspace();
  const noopAgent = async () => {
    /* no-op: doesn't advance state */
  };

  await assert.rejects(
    runDrive({
      cwd,
      taskId: "task-1",
      description: "Test",
      workflowId: "tiny",
      maxStages: 10,
      agentCommand: "<unused>",
      agentArgs: [],
      spawnAgent: noopAgent,
      workflows: REGISTRY,
    }),
    /exited without advancing the run/,
  );
});

test("runDrive: stops at max-stages limit", async () => {
  const cwd = makeWorkspace();
  await assert.rejects(
    runDrive({
      cwd,
      taskId: "task-1",
      description: "Test",
      workflowId: "tiny",
      maxStages: 1, // workflow has 2 stages
      agentCommand: "<unused>",
      agentArgs: [],
      spawnAgent: makeAdvancingAgent(),
      workflows: REGISTRY,
    }),
    /Reached --max-stages 1/,
  );
});

test("runDrive: blocked status halts the loop and surfaces the run state", async () => {
  const cwd = makeWorkspace();
  const blockingAgent = makeAdvancingAgent({
    status: "blocked",
    body: "# Plan blocked\n\nMissing context.",
  });

  const result = await runDrive({
    cwd,
    taskId: "task-1",
    description: "Test",
    workflowId: "tiny",
    maxStages: 10,
    agentCommand: "<unused>",
    agentArgs: [],
    spawnAgent: blockingAgent,
    workflows: REGISTRY,
  });

  assert.equal(result.state.outcome, "blocked");
  assert.equal(result.stagesDriven, 1);
});

test("runDrive: rejects unknown workflow_id when starting fresh", async () => {
  const cwd = makeWorkspace();
  await assert.rejects(
    runDrive({
      cwd,
      taskId: "task-1",
      description: "Test",
      workflowId: "no-such",
      maxStages: 10,
      agentCommand: "<unused>",
      agentArgs: [],
      spawnAgent: makeAdvancingAgent(),
      workflows: REGISTRY,
    }),
    /Unknown workflow_id/,
  );
});

test("runDrive: passes envelope text to the spawned agent for each stage", async () => {
  const cwd = makeWorkspace();
  const seenPrompts = [];
  const spy = async (args) => {
    seenPrompts.push({ stage: args.taskId, prompt: args.envelopePrompt });
    const state = getRunState(args.cwd, args.taskId);
    const stage = TINY_WORKFLOW.stages.find((s) => s.name === state.current_stage);
    advanceStage({
      cwd: args.cwd,
      taskId: args.taskId,
      workflow: TINY_WORKFLOW,
      stageName: state.current_stage,
      artifactName: stage.artifact,
      frontmatter: {
        stage: state.current_stage,
        status: "complete",
        references: [],
      },
      body: "# done",
    });
  };

  await runDrive({
    cwd,
    taskId: "task-1",
    description: "x",
    workflowId: "tiny",
    maxStages: 10,
    agentCommand: "<unused>",
    agentArgs: [],
    spawnAgent: spy,
    workflows: REGISTRY,
  });

  assert.equal(seenPrompts.length, 2);
  assert.match(seenPrompts[0].prompt, /# STAGE: plan/);
  assert.match(seenPrompts[1].prompt, /# STAGE: review/);
});

test("runDrive: surfaces stage transitions via callbacks in the right order", async () => {
  const cwd = makeWorkspace();
  const events = [];

  await runDrive({
    cwd,
    taskId: "task-1",
    description: "x",
    workflowId: "tiny",
    maxStages: 10,
    agentCommand: "<unused>",
    agentArgs: [],
    spawnAgent: makeAdvancingAgent(),
    onStageStart: (stage) => {
      events.push(`start:${stage}`);
    },
    onStageEnd: (stage, nextState) => {
      events.push(`end:${stage}:${nextState.current_stage ?? nextState.outcome}`);
    },
    workflows: REGISTRY,
  });

  assert.deepEqual(events, [
    "start:plan",
    "end:plan:review",
    "start:review",
    "end:review:complete",
  ]);
});
