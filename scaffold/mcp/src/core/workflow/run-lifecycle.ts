import {
  readRunState,
  writeRunState,
  writeStageArtifact,
} from "./artifact-io.js";
import {
  runStateSchema,
  stageArtifactFrontmatterSchema,
  stageOverrideSchema,
  workflowDefinitionSchema,
  type RunState,
  type StageOverride,
  type StageRecord,
  type StageStatus,
  type WorkflowDefinition,
} from "./schemas.js";

/**
 * Lifecycle helpers for one workflow run. The harness composes envelopes
 * and invokes agents elsewhere; these primitives only manipulate the
 * persisted state under .agents/<task-id>/. Pure functions on top of
 * artifact-io.ts so unit tests can hit them without spawning agents.
 */

export type CreateRunOptions = {
  cwd: string;
  taskId: string;
  workflow: WorkflowDefinition;
  taskDescription: string;
  now?: () => Date;
};

export function createRun(options: CreateRunOptions): RunState {
  const workflow = workflowDefinitionSchema.parse(options.workflow);
  const now = (options.now ?? (() => new Date()))();
  const startedAt = now.toISOString();

  const stages: StageRecord[] = workflow.stages.map((stage) => ({
    name: stage.name,
    status: "pending" as StageStatus,
    validators_passed: [],
  }));

  const state: RunState = {
    schema_version: 1,
    task_id: options.taskId,
    workflow_id: workflow.id,
    workflow_version: workflow.version,
    task_description: options.taskDescription,
    current_stage: workflow.stages[0].name,
    outcome: "in_progress",
    started_at: startedAt,
    completed_at: null,
    stages,
  };

  // Validate before write so a malformed input never reaches disk.
  const validated = runStateSchema.parse(state);
  writeRunState(options.cwd, validated);
  return validated;
}

export function getRunState(cwd: string, taskId: string): RunState | null {
  return readRunState(cwd, taskId);
}

export type AdvanceStageOptions = {
  cwd: string;
  taskId: string;
  workflow: WorkflowDefinition;
  /** The stage we just finished. Must equal state.current_stage. */
  stageName: string;
  /** Filename of the artifact to write (e.g. "plan.md"). */
  artifactName: string;
  /** Frontmatter for the artifact, minus the auto-injected `written_at`. */
  frontmatter: Omit<
    import("./schemas.js").StageArtifactFrontmatter,
    "written_at"
  > & { written_at?: string };
  /** Markdown body of the artifact. */
  body: string;
  /** Per-stage outcome surfaced into state.json for fast lookup. */
  outcome?: Record<string, unknown>;
  /** Final status to record for this stage. Defaults to "complete". */
  status?: StageStatus;
  /** Validators the agent reports having run. Compared against stage.validators. */
  validatorsPassed?: string[];
  /** Process override; required when validators_passed doesn't cover stage.validators. */
  override?: StageOverride;
  now?: () => Date;
};

/**
 * Marks `stageName` as finished, writes its artifact under .agents/<task-id>/,
 * and advances `current_stage` to the next stage (or marks the run complete
 * if this was the final stage). Idempotent only at the artifact layer —
 * calling twice for the same stage will overwrite the artifact and the
 * state.json record.
 */
export function advanceStage(options: AdvanceStageOptions): RunState {
  const workflow = workflowDefinitionSchema.parse(options.workflow);
  const state = readRunState(options.cwd, options.taskId);
  if (!state) {
    throw new Error(
      `No run state found for task ${options.taskId}. Call createRun() first.`,
    );
  }
  if (state.workflow_id !== workflow.id) {
    throw new Error(
      `Workflow mismatch: run was started with ${state.workflow_id}, advance was called with ${workflow.id}`,
    );
  }
  if (state.current_stage !== options.stageName) {
    throw new Error(
      `Cannot advance stage ${options.stageName}: run is currently at ${
        state.current_stage ?? "<finished>"
      }`,
    );
  }

  const stageIndex = workflow.stages.findIndex((s) => s.name === options.stageName);
  const stageDef = workflow.stages[stageIndex];

  // Validator coverage check: every validator the stage declares must
  // appear in validators_passed unless the override explicitly skips it.
  // Process is enforced here even though the validators themselves run
  // in the agent's environment.
  const validatorsPassed = options.validatorsPassed ?? [];
  const override = options.override
    ? stageOverrideSchema.parse(options.override)
    : undefined;
  const requiredValidators = stageDef.validators.map((v) => v.id);
  const declaredSkipped = new Set(override?.skipped_validators ?? []);
  const missingValidators = requiredValidators.filter(
    (id) => !validatorsPassed.includes(id) && !declaredSkipped.has(id),
  );
  // blocked / failed stages are exempt from validator coverage — the
  // stage is explicitly halting before completion, so the validators
  // logically cannot have run.
  const finalStatus = options.status ?? "complete";
  const exemptStatus = finalStatus === "blocked" || finalStatus === "failed";
  if (missingValidators.length > 0 && !exemptStatus) {
    throw new Error(
      `Stage ${options.stageName} requires validators ${requiredValidators.join(", ")} ` +
        `but artifact reported only ${validatorsPassed.join(", ") || "<none>"}. ` +
        `Missing: ${missingValidators.join(", ")}. ` +
        `Pass override.skipped_validators with a reason to advance anyway.`,
    );
  }

  const now = (options.now ?? (() => new Date()))();
  const completedAt = now.toISOString();

  const frontmatter = stageArtifactFrontmatterSchema.parse({
    ...options.frontmatter,
    stage: options.stageName,
    validators_passed: validatorsPassed,
    ...(override
      ? {
          override: {
            reason: override.reason,
            skipped_validators: override.skipped_validators,
            skipped_requirements: override.skipped_requirements,
          },
        }
      : {}),
    written_at: options.frontmatter.written_at ?? completedAt,
  });
  writeStageArtifact(
    options.cwd,
    options.taskId,
    options.artifactName,
    frontmatter,
    options.body,
  );

  const nextStage = workflow.stages[stageIndex + 1] ?? null;

  const updatedStages: StageRecord[] = state.stages.map((record) => {
    if (record.name !== options.stageName) return record;
    return {
      ...record,
      status: finalStatus,
      artifact: options.artifactName,
      started_at: record.started_at ?? state.started_at,
      completed_at: completedAt,
      outcome: options.outcome,
      validators_passed: validatorsPassed,
      override,
    };
  });

  const runOutcome: RunState["outcome"] =
    finalStatus === "blocked" || finalStatus === "failed"
      ? finalStatus
      : nextStage
        ? "in_progress"
        : "complete";

  const next: RunState = {
    ...state,
    current_stage:
      runOutcome === "in_progress" && nextStage ? nextStage.name : null,
    outcome: runOutcome,
    completed_at: runOutcome === "in_progress" ? null : completedAt,
    stages: updatedStages,
  };

  const validated = runStateSchema.parse(next);
  writeRunState(options.cwd, validated);
  return validated;
}
