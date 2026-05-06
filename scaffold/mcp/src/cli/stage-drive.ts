import { spawn } from "node:child_process";
import {
  composeStageEnvelope,
  createRun,
  getRunState,
  loadSyncedWorkflows,
} from "../core/workflow/index.js";
import { DEFAULT_WORKFLOWS } from "../core/workflow/default-workflows.js";
import type { RunState, WorkflowDefinition } from "../core/workflow/schemas.js";

/**
 * Orchestrator for `cortex stage drive`. Loops through every stage of a
 * workflow run until the run reaches a terminal state. For each stage:
 *
 *   1. Compose the stage envelope (prompt + expected artifact + capability).
 *   2. Spawn the user-supplied agent command with:
 *        - the envelope text written to stdin
 *        - CORTEX_ACTIVE_TASK_ID set so the pre-tool-use hook applies the
 *          stage's capability gate
 *   3. Wait for the agent to exit. The agent is expected to call
 *      cortex.workflow.advance (via MCP) before terminating.
 *   4. Re-read the run state. If current_stage advanced, loop. If the
 *      stage didn't advance, fail loud — a missing advance is a contract
 *      violation, not a transient.
 *
 * The orchestrator never *itself* writes artifacts or advances the run.
 * That keeps the trust model simple: every state transition is owned by
 * a validated MCP/CLI call, never by orchestrator implicit behaviour.
 */

export type DriveOptions = {
  cwd: string;
  taskId: string;
  /** Used only when no run exists yet. Ignored for resumption. */
  description?: string;
  /** Used only when no run exists yet. Defaults to "secure-build". */
  workflowId?: string;
  maxStages: number;
  agentCommand: string;
  agentArgs: string[];
  /** Hook for tests / progress UI. Called once per stage transition. */
  onStageStart?: (stage: string, envelopePrompt: string) => void;
  onStageEnd?: (stage: string, nextState: RunState) => void;
  /**
   * Defaults to spawning a real subprocess. Tests pass a mock that
   * mutates the run state directly (see workflow-drive.test.mjs).
   */
  spawnAgent?: SpawnAgentFn;
  /** Optional registry override; tests pass an explicit one. */
  workflows?: Record<string, WorkflowDefinition>;
};

export type DriveResult = {
  state: RunState;
  /** Number of stages this invocation drove (not the run's total). */
  stagesDriven: number;
};

export type SpawnAgentArgs = {
  cwd: string;
  taskId: string;
  envelopePrompt: string;
  command: string;
  args: string[];
};

export type SpawnAgentFn = (args: SpawnAgentArgs) => Promise<void>;

function resolveRegistry(
  override?: Record<string, WorkflowDefinition>,
): Record<string, WorkflowDefinition> {
  if (override) return override;
  return { ...DEFAULT_WORKFLOWS, ...loadSyncedWorkflows() };
}

function ensureWorkflow(
  workflowId: string,
  registry: Record<string, WorkflowDefinition>,
): WorkflowDefinition {
  const workflow = registry[workflowId];
  if (!workflow) {
    throw new Error(
      `Unknown workflow_id: ${workflowId}. Available: ${
        Object.keys(registry).join(", ") || "<none>"
      }`,
    );
  }
  return workflow;
}

const defaultSpawnAgent: SpawnAgentFn = ({ cwd, taskId, envelopePrompt, command, args }) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "inherit", "inherit"],
      env: {
        ...process.env,
        CORTEX_ACTIVE_TASK_ID: taskId,
      },
      cwd,
    });

    child.on("error", (err) => reject(err));
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`agent terminated by signal ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`agent exited with code ${code}`));
        return;
      }
      resolve();
    });

    if (!child.stdin) {
      reject(new Error("agent stdin is unavailable"));
      return;
    }
    child.stdin.write(envelopePrompt);
    child.stdin.end();
  });

export async function runDrive(options: DriveOptions): Promise<DriveResult> {
  const registry = resolveRegistry(options.workflows);
  const spawnAgent = options.spawnAgent ?? defaultSpawnAgent;

  // Step 1: ensure a run exists. Resume or start.
  let state = getRunState(options.cwd, options.taskId);
  if (!state) {
    if (!options.description) {
      throw new Error(
        `No run exists for task ${options.taskId} and --description was not provided. ` +
          "Pass --description \"...\" to start a new run, or call cortex stage start first.",
      );
    }
    const workflowId = options.workflowId ?? "secure-build";
    const workflow = ensureWorkflow(workflowId, registry);
    state = createRun({
      cwd: options.cwd,
      taskId: options.taskId,
      workflow,
      taskDescription: options.description,
    });
  }

  let stagesDriven = 0;
  while (state.outcome === "in_progress" && state.current_stage) {
    if (stagesDriven >= options.maxStages) {
      throw new Error(
        `Reached --max-stages ${options.maxStages} without completing run for task ${options.taskId} ` +
          `(current_stage: ${state.current_stage})`,
      );
    }

    const workflow = ensureWorkflow(state.workflow_id, registry);
    const previousStage = state.current_stage;

    const envelope = composeStageEnvelope({
      cwd: options.cwd,
      taskId: options.taskId,
      workflow,
    });

    options.onStageStart?.(previousStage, envelope.prompt);

    await spawnAgent({
      cwd: options.cwd,
      taskId: options.taskId,
      envelopePrompt: envelope.prompt,
      command: options.agentCommand,
      args: options.agentArgs,
    });

    const nextState = getRunState(options.cwd, options.taskId);
    if (!nextState) {
      throw new Error(
        `Run state for task ${options.taskId} disappeared during stage ${previousStage}`,
      );
    }

    if (
      nextState.current_stage === previousStage &&
      nextState.outcome === "in_progress"
    ) {
      throw new Error(
        `Agent for stage ${previousStage} exited without advancing the run. ` +
          `Did the agent call cortex.workflow.advance? CORTEX_ACTIVE_TASK_ID was ${options.taskId}.`,
      );
    }

    options.onStageEnd?.(previousStage, nextState);
    state = nextState;
    stagesDriven += 1;
  }

  return { state, stagesDriven };
}
