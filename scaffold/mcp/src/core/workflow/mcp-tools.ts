import { z } from "zod";
import { advanceStage, createRun, getRunState } from "./run-lifecycle.js";
import { composeStageEnvelope } from "./envelope.js";
import { DEFAULT_WORKFLOWS } from "./default-workflows.js";
import { loadSyncedWorkflows } from "./synced-registry.js";
import {
  stageStatusSchema,
  type StageStatus,
  type WorkflowDefinition,
} from "./schemas.js";

/**
 * Pure runner functions that back the cortex.workflow.* MCP tools.
 * Kept separate from server.ts so they can be unit-tested without spinning
 * up an MCP server. server.ts is a thin shim that registers each runner
 * under its tool name and serializes the result through buildToolResult.
 */

const slugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);

export const WorkflowStartInput = z.object({
  task_id: slugSchema,
  task_description: z.string().min(1).max(2000),
  workflow_id: slugSchema.default("secure-build"),
});
export type WorkflowStartInputT = z.infer<typeof WorkflowStartInput>;

export const WorkflowAdvanceInput = z.object({
  task_id: slugSchema,
  /** Required for safety: must equal the run's current_stage. */
  stage: slugSchema,
  /**
   * Stage frontmatter as a free-form object. Stage / status / references /
   * written_at are managed by the harness and may be omitted (or, if set,
   * are overridden). Stage-specific fields like `approved` or `score` are
   * passed through.
   */
  frontmatter: z.record(z.string(), z.unknown()).default({}),
  body: z.string().min(1),
  /** Final stage status. Defaults to "complete". Use "blocked" or "failed" to halt the run. */
  status: stageStatusSchema.optional(),
  /** Optional structured outcome surfaced into state.json for fast lookup by later stages. */
  outcome: z.record(z.string(), z.unknown()).optional(),
});
export type WorkflowAdvanceInputT = z.infer<typeof WorkflowAdvanceInput>;

export const WorkflowStatusInput = z.object({
  task_id: slugSchema,
});
export type WorkflowStatusInputT = z.infer<typeof WorkflowStatusInput>;

export const WorkflowEnvelopeInput = z.object({
  task_id: slugSchema,
  /** Defaults to the run's current stage. */
  stage: slugSchema.optional(),
});
export type WorkflowEnvelopeInputT = z.infer<typeof WorkflowEnvelopeInput>;

/**
 * Resolves the project root. The MCP server is started with cwd =
 * project root and CORTEX_PROJECT_ROOT set to the same value (see
 * bin/cortex.mjs `mcp` command). Tests pass cwd explicitly.
 */
export function resolveProjectRoot(): string {
  const fromEnv = process.env.CORTEX_PROJECT_ROOT?.trim();
  if (fromEnv) return fromEnv;
  return process.cwd();
}

export type WorkflowToolContext = {
  cwd: string;
  workflows?: Record<string, WorkflowDefinition>;
};

function resolveWorkflow(
  workflowId: string,
  registry: Record<string, WorkflowDefinition> | undefined,
): WorkflowDefinition {
  // When the caller passes an explicit registry, it wins outright (used
  // by tests). Otherwise we merge bundled defaults with the org-authored
  // workflows the daemon has synced into ~/.cortex/workflows.local.json,
  // with the synced ones taking precedence on workflow_id collisions so
  // org overrides actually override.
  const workflows =
    registry ?? { ...DEFAULT_WORKFLOWS, ...loadSyncedWorkflows() };
  const workflow = workflows[workflowId];
  if (!workflow) {
    throw new Error(
      `Unknown workflow_id: ${workflowId}. Available: ${Object.keys(workflows).join(", ") || "<none>"}`,
    );
  }
  return workflow;
}

export function runWorkflowStart(
  input: WorkflowStartInputT,
  ctx: WorkflowToolContext,
) {
  const workflow = resolveWorkflow(input.workflow_id, ctx.workflows);
  const state = createRun({
    cwd: ctx.cwd,
    taskId: input.task_id,
    workflow,
    taskDescription: input.task_description,
  });
  const envelope = composeStageEnvelope({
    cwd: ctx.cwd,
    taskId: input.task_id,
    workflow,
  });
  return {
    state,
    envelope,
  };
}

export function runWorkflowAdvance(
  input: WorkflowAdvanceInputT,
  ctx: WorkflowToolContext,
) {
  const state = getRunState(ctx.cwd, input.task_id);
  if (!state) {
    throw new Error(
      `No run state found for task ${input.task_id}. Call cortex.workflow.start first.`,
    );
  }
  const workflow = resolveWorkflow(state.workflow_id, ctx.workflows);
  const stage = workflow.stages.find((s) => s.name === input.stage);
  if (!stage) {
    throw new Error(`Stage ${input.stage} is not defined in workflow ${workflow.id}`);
  }

  const finalStatus: StageStatus = input.status ?? "complete";

  const nextState = advanceStage({
    cwd: ctx.cwd,
    taskId: input.task_id,
    workflow,
    stageName: input.stage,
    artifactName: stage.artifact,
    frontmatter: {
      ...input.frontmatter,
      stage: input.stage,
      status: finalStatus,
      references:
        (Array.isArray((input.frontmatter as Record<string, unknown>).references)
          ? ((input.frontmatter as Record<string, unknown>).references as unknown[])
              .filter((v): v is string => typeof v === "string")
          : null) ?? deriveReferencesFromReads(stage.reads, workflow),
    },
    body: input.body,
    outcome: input.outcome,
    status: finalStatus,
  });

  // If the run is still going, also return the next envelope so the caller
  // can immediately know what comes next without a follow-up status round-trip.
  let nextEnvelope: ReturnType<typeof composeStageEnvelope> | null = null;
  if (nextState.outcome === "in_progress" && nextState.current_stage) {
    nextEnvelope = composeStageEnvelope({
      cwd: ctx.cwd,
      taskId: input.task_id,
      workflow,
    });
  }

  return {
    state: nextState,
    next_envelope: nextEnvelope,
  };
}

function deriveReferencesFromReads(
  reads: string[],
  workflow: WorkflowDefinition,
): string[] {
  const refs: string[] = [];
  for (const readName of reads) {
    const stage = workflow.stages.find((s) => s.name === readName);
    if (stage) refs.push(stage.artifact);
  }
  return refs;
}

export function runWorkflowStatus(
  input: WorkflowStatusInputT,
  ctx: WorkflowToolContext,
) {
  const state = getRunState(ctx.cwd, input.task_id);
  return { state };
}

export function runWorkflowEnvelope(
  input: WorkflowEnvelopeInputT,
  ctx: WorkflowToolContext,
) {
  const state = getRunState(ctx.cwd, input.task_id);
  if (!state) {
    throw new Error(
      `No run state found for task ${input.task_id}. Call cortex.workflow.start first.`,
    );
  }
  const workflow = resolveWorkflow(state.workflow_id, ctx.workflows);
  const envelope = composeStageEnvelope({
    cwd: ctx.cwd,
    taskId: input.task_id,
    workflow,
    stageName: input.stage,
  });
  return { envelope };
}
