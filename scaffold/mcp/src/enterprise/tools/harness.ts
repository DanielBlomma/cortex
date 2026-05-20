import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isEnforcedMode } from "../../hooks/shared.js";
import {
  WorkflowAdvanceInput,
  WorkflowEnvelopeInput,
  WorkflowStartInput,
  WorkflowStatusInput,
  resolveProjectRoot,
  runWorkflowAdvance,
  runWorkflowEnvelope,
  runWorkflowStart,
  runWorkflowStatus,
} from "../../core/workflow/mcp-tools.js";

/**
 * Registers the cortex.workflow.* tools that drive the Cortex Harness.
 * These are an enterprise-only feature: they're only registered when
 * the enterprise plugin successfully loads (license + config valid).
 *
 * Community-mode MCP servers do not see these tools at all — the
 * harness depends on org-authored workflows from cortex-web, which
 * itself requires an enterprise plan.
 *
 * Pure runner functions live in core/workflow/mcp-tools.ts so they can
 * be unit-tested without spinning up an MCP server. This module only
 * wires them onto the server with the right tool names + input schemas.
 */

type ToolPayload = Record<string, unknown>;

export function registerHarnessTools(server: McpServer): void {
  server.registerTool(
    "cortex.workflow.start",
    {
      description:
        "Start a Cortex Harness workflow run for a task. Creates .agents/<task_id>/state.json and returns the first stage's envelope (the prompt the agent should answer). Enterprise-only.",
      inputSchema: WorkflowStartInput,
    },
    async (input) => buildResult(
      runWorkflowStart(WorkflowStartInput.parse(input ?? {}), {
        cwd: resolveProjectRoot(),
        bundledFallbackPolicy: isEnforcedMode(resolveProjectRoot()) ? "block" : "allow",
      }) as ToolPayload,
    ),
  );

  server.registerTool(
    "cortex.workflow.advance",
    {
      description:
        "Complete the current stage of a workflow run by writing its artifact and advancing the run pointer. Returns the new run state plus the next stage's envelope (or null when the run is finished, blocked, or failed). Enterprise-only.",
      inputSchema: WorkflowAdvanceInput,
    },
    async (input) => buildResult(
      runWorkflowAdvance(WorkflowAdvanceInput.parse(input ?? {}), {
        cwd: resolveProjectRoot(),
      }) as ToolPayload,
    ),
  );

  server.registerTool(
    "cortex.workflow.status",
    {
      description:
        "Read the current run state for a task (current stage, completed stages, outcome). Returns null state when no run exists for the given task_id. Enterprise-only.",
      inputSchema: WorkflowStatusInput,
    },
    async (input) => buildResult(
      runWorkflowStatus(WorkflowStatusInput.parse(input ?? {}), {
        cwd: resolveProjectRoot(),
      }) as ToolPayload,
    ),
  );

  server.registerTool(
    "cortex.workflow.envelope",
    {
      description:
        "Compose the prompt envelope for a workflow stage without advancing the run. Defaults to the run's current_stage; pass `stage` to dry-run a different stage. Enterprise-only.",
      inputSchema: WorkflowEnvelopeInput,
    },
    async (input) => buildResult(
      runWorkflowEnvelope(WorkflowEnvelopeInput.parse(input ?? {}), {
        cwd: resolveProjectRoot(),
      }) as ToolPayload,
    ),
  );
}

function buildResult(data: ToolPayload) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: data,
  };
}
