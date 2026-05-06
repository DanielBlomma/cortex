import { readFileSync } from "node:fs";
import { artifactPath, readRunState } from "./artifact-io.js";
import { workflowDefinitionSchema, type WorkflowDefinition } from "./schemas.js";

/**
 * Composes the prompt one stage's agent sees. Pure function over the
 * persisted run state plus the workflow definition — no agent invocation,
 * no MCP, no daemon. The harness later wraps this into an MCP call or a
 * CLI invocation.
 *
 * Design: the agent gets four sections in a fixed order so it can anchor
 * on them reliably:
 *
 *   TASK     — what the developer asked for, copied verbatim from RunState
 *   STAGE    — what *this* stage is supposed to produce
 *   HANDOFFS — every prior-stage artifact the new stage declared in `reads`,
 *              inlined raw (frontmatter + body) so the agent sees structured
 *              outcomes alongside the reasoning
 *   OUTPUT   — exact frontmatter contract the agent must satisfy plus the
 *              expected artifact filename
 *
 * Capability constraints (which files the agent may edit, which tools it
 * may call) are NOT enforced by the prompt — they're enforced by hooks
 * downstream. The capability key is surfaced in the prompt as a label so
 * the agent knows under what role it's running, but the real gate is
 * pre-tool-use.
 */

export type ComposedEnvelope = {
  /** The full prompt the agent will receive. */
  prompt: string;
  /** Expected artifact filename the agent must produce. */
  expectedArtifact: string;
  /** Frontmatter keys the agent must populate (beyond stage/status/references). */
  requiredFields: string[];
  /** Capability key the stage runs under (informational). */
  capability: string | null;
};

export type ComposeStageEnvelopeOptions = {
  cwd: string;
  taskId: string;
  workflow: WorkflowDefinition;
  /**
   * Defaults to the run's current_stage. Pass an explicit stageName when
   * dry-running an envelope without driving state forward.
   */
  stageName?: string;
};

export function composeStageEnvelope(
  options: ComposeStageEnvelopeOptions,
): ComposedEnvelope {
  const workflow = workflowDefinitionSchema.parse(options.workflow);
  const state = readRunState(options.cwd, options.taskId);
  if (!state) {
    throw new Error(
      `No run state found for task ${options.taskId}. Call createRun() first.`,
    );
  }
  if (state.workflow_id !== workflow.id) {
    throw new Error(
      `Workflow mismatch: run was started with ${state.workflow_id}, envelope was composed with ${workflow.id}`,
    );
  }

  const stageName = options.stageName ?? state.current_stage;
  if (!stageName) {
    throw new Error(
      `Run ${options.taskId} is not at any stage (outcome=${state.outcome}). Cannot compose envelope.`,
    );
  }
  const stage = workflow.stages.find((s) => s.name === stageName);
  if (!stage) {
    throw new Error(
      `Stage ${stageName} is not defined in workflow ${workflow.id}`,
    );
  }

  const handoffs: string[] = [];
  for (const readName of stage.reads) {
    const priorStage = workflow.stages.find((s) => s.name === readName);
    if (!priorStage) {
      throw new Error(
        `Stage ${stageName} declares reads from unknown stage ${readName}`,
      );
    }
    const priorRecord = state.stages.find((r) => r.name === readName);
    if (!priorRecord || priorRecord.status === "pending" || !priorRecord.artifact) {
      throw new Error(
        `Stage ${stageName} requires artifact from ${readName}, but it has not been produced yet`,
      );
    }
    const path = artifactPath(options.cwd, options.taskId, priorRecord.artifact);
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (err) {
      throw new Error(
        `Failed to read handoff artifact for ${readName} at ${path}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    handoffs.push(renderHandoff(readName, priorRecord.artifact, raw));
  }

  const requiredFields = stage.required_fields;
  const capability = stage.capability ?? null;

  const prompt = renderPrompt({
    taskDescription: state.task_description,
    workflowId: workflow.id,
    workflowDescription: workflow.description,
    stageName: stage.name,
    stageDescription: stage.description,
    expectedArtifact: stage.artifact,
    requiredFields,
    capability,
    handoffs,
  });

  return {
    prompt,
    expectedArtifact: stage.artifact,
    requiredFields,
    capability,
  };
}

function renderHandoff(
  stageName: string,
  artifactName: string,
  rawArtifact: string,
): string {
  return [
    `--- handoff:${stageName} (${artifactName}) ---`,
    rawArtifact.trim(),
    `--- end handoff:${stageName} ---`,
  ].join("\n");
}

type RenderPromptOptions = {
  taskDescription: string;
  workflowId: string;
  workflowDescription: string;
  stageName: string;
  stageDescription: string;
  expectedArtifact: string;
  requiredFields: string[];
  capability: string | null;
  handoffs: string[];
};

function renderPrompt(o: RenderPromptOptions): string {
  const sections: string[] = [];

  sections.push(
    [
      `# TASK`,
      ``,
      o.taskDescription.trim(),
      ``,
      `Workflow: ${o.workflowId} — ${o.workflowDescription}`,
    ].join("\n"),
  );

  sections.push(
    [
      `# STAGE: ${o.stageName}`,
      ``,
      o.stageDescription.trim(),
      ``,
      o.capability
        ? `Running under capability: \`${o.capability}\` (file and tool restrictions are enforced by Cortex hooks at tool-use time, not by you).`
        : `No capability constraint declared for this stage.`,
    ].join("\n"),
  );

  if (o.handoffs.length === 0) {
    sections.push(
      [`# HANDOFFS`, ``, `_No prior-stage artifacts; this is the first stage._`].join(
        "\n",
      ),
    );
  } else {
    sections.push(
      [
        `# HANDOFFS`,
        ``,
        `The following stages have already run. Each artifact below is the complete file as it lives on disk; use the frontmatter for structured outcomes and the body for reasoning.`,
        ``,
        ...o.handoffs,
      ].join("\n"),
    );
  }

  const requiredLines =
    o.requiredFields.length === 0
      ? `_No additional required fields beyond the harness defaults._`
      : o.requiredFields.map((f) => `- \`${f}\``).join("\n");

  sections.push(
    [
      `# OUTPUT`,
      ``,
      `Produce a single markdown file named \`${o.expectedArtifact}\` with YAML frontmatter on top.`,
      ``,
      `Required frontmatter fields (in addition to \`stage\`, \`status\`, \`references\`, \`written_at\` which the harness manages):`,
      ``,
      requiredLines,
      ``,
      `Body: clear, well-structured markdown explaining your reasoning. Cite handoff artifacts by stage name when relevant.`,
      ``,
      `If you cannot complete this stage (missing context, blocking concern, conflicting prior decisions), set \`status: blocked\` in frontmatter and explain why in the body — do not fabricate work.`,
    ].join("\n"),
  );

  return sections.join("\n\n");
}
