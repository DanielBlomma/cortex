import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { reloadContextGraph } from "./graph.js";
import { runContextRules } from "./rules.js";
import { runContextImpact, runContextRelated, runContextSearch } from "./search.js";
import {
  getToolCallHook,
  getToolEventHook,
  getSessionEndHook,
  getSessionEventHook,
  loadPlugins,
} from "./plugin.js";
import {
  WorkflowStartInput,
  WorkflowAdvanceInput,
  WorkflowStatusInput,
  WorkflowEnvelopeInput,
  resolveProjectRoot,
  runWorkflowAdvance,
  runWorkflowEnvelope,
  runWorkflowStart,
  runWorkflowStatus,
} from "./core/workflow/mcp-tools.js";

type ToolPayload = Record<string, unknown>;

const ESTIMATED_TOKENS_SAVED_PER_RESULT = 400;
const MAX_SESSION_CALLS = 1000;
const SHUTDOWN_TIMEOUT_MS = 3000;

type SessionCall = {
  tool: string;
  query?: string;
  resultCount: number;
  time: string;
  outcome?: "success" | "error";
  duration_ms?: number;
  error?: string;
};

const sessionCalls: SessionCall[] = [];
const sessionStartedAt = Date.now();
let successfulToolCalls = 0;
let failedToolCalls = 0;

const SearchInput = z.object({
  query: z.string().min(1),
  top_k: z.number().int().positive().max(20).default(5),
  include_deprecated: z.boolean().default(false),
  response_preset: z.enum(["full", "compact", "minimal"]).optional(),
  include_scores: z.boolean().optional(),
  include_matched_rules: z.boolean().optional(),
  include_content: z.boolean().optional()
});

const RelatedInput = z.object({
  entity_id: z.string().min(1),
  depth: z.number().int().positive().max(3).default(1),
  include_edges: z.boolean().optional(),
  response_preset: z.enum(["full", "compact", "minimal"]).optional(),
  include_entity_metadata: z.boolean().optional()
});

const ImpactInput = z
  .object({
    entity_id: z.string().min(1).optional(),
    query: z.string().min(1).optional(),
    depth: z.number().int().positive().max(4).default(2),
    top_k: z.number().int().positive().max(20).default(8),
    include_edges: z.boolean().default(true),
    response_preset: z.enum(["full", "compact", "minimal"]).optional(),
    include_scores: z.boolean().optional(),
    include_reasons: z.boolean().optional(),
    verbose_paths: z.boolean().optional(),
    max_path_hops_shown: z.number().int().positive().max(8).optional(),
    profile: z.enum(["all", "config_only", "config_to_sql", "code_only", "sql_only"]).default("all"),
    sort_by: z
      .enum(["impact_score", "shortest_path", "semantic_score", "graph_score", "trust_score"])
      .default("impact_score"),
    relation_types: z
      .array(
        z.enum([
          "CALLS",
          "CALLS_SQL",
          "IMPORTS",
          "USES_CONFIG_KEY",
          "USES_RESOURCE_KEY",
          "USES_SETTING_KEY",
          "USES_CONFIG",
          "TRANSFORMS_CONFIG",
          "PART_OF"
        ])
      )
      .max(9)
      .optional(),
    path_must_include: z
      .array(
        z.enum([
          "CALLS",
          "CALLS_SQL",
          "IMPORTS",
          "USES_CONFIG_KEY",
          "USES_RESOURCE_KEY",
          "USES_SETTING_KEY",
          "USES_CONFIG",
          "TRANSFORMS_CONFIG",
          "PART_OF"
        ])
      )
      .max(9)
      .optional(),
    path_must_exclude: z
      .array(
        z.enum([
          "CALLS",
          "CALLS_SQL",
          "IMPORTS",
          "USES_CONFIG_KEY",
          "USES_RESOURCE_KEY",
          "USES_SETTING_KEY",
          "USES_CONFIG",
          "TRANSFORMS_CONFIG",
          "PART_OF"
        ])
      )
      .max(9)
      .optional(),
    result_domains: z
      .array(z.enum(["code", "config", "resource", "settings", "sql", "project"]))
      .max(6)
      .optional(),
    result_entity_types: z
      .array(z.enum(["File", "Chunk", "Module", "Project", "ADR", "Rule"]))
      .max(6)
      .optional()
  })
  .refine((value) => Boolean(value.entity_id || value.query), {
    message: "Either entity_id or query is required."
  });

const RulesInput = z.object({
  scope: z.string().optional(),
  include_inactive: z.boolean().default(false)
});

const ReloadInput = z.object({
  force: z.boolean().default(true)
});

function buildToolResult(data: ToolPayload) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2)
      }
    ],
    structuredContent: data
  };
}

function extractQuery(input: unknown): string | undefined {
  if (input && typeof input === "object" && "query" in input) {
    const q = (input as { query?: unknown }).query;
    if (typeof q === "string") return q;
  }
  return undefined;
}

function notifyToolStart(toolName: string, input: unknown): string {
  const timestamp = new Date().toISOString();
  const eventHook = getToolEventHook();
  if (eventHook) {
    const query = extractQuery(input);
    void eventHook({
      phase: "start",
      tool: toolName,
      timestamp,
      input: (input ?? {}) as Record<string, unknown>,
      query,
      query_length: query?.length,
    });
  }
  return timestamp;
}

function notifyToolCall(toolName: string, input: unknown, result: ToolPayload, durationMs: number, startedAtIso: string): void {
  const resultCount = Array.isArray((result as { results?: unknown }).results)
    ? ((result as { results: unknown[] }).results).length
    : 0;
  const query = extractQuery(input);
  if (sessionCalls.length < MAX_SESSION_CALLS) {
    sessionCalls.push({
      tool: toolName,
      query,
      resultCount,
      time: startedAtIso,
      outcome: "success",
      duration_ms: durationMs,
    });
  }
  successfulToolCalls++;

  const eventHook = getToolEventHook();
  const hook = getToolCallHook();
  if (!eventHook && hook) {
    hook(toolName, resultCount, resultCount * ESTIMATED_TOKENS_SAVED_PER_RESULT);
  }
  if (eventHook) {
    void eventHook({
      phase: "success",
      tool: toolName,
      timestamp: new Date().toISOString(),
      input: (input ?? {}) as Record<string, unknown>,
      query,
      query_length: query?.length,
      result_count: resultCount,
      estimated_tokens_saved: resultCount * ESTIMATED_TOKENS_SAVED_PER_RESULT,
      duration_ms: durationMs,
    });
  }
}

function notifyToolError(toolName: string, input: unknown, error: unknown, durationMs: number, startedAtIso: string): void {
  const query = extractQuery(input);
  if (sessionCalls.length < MAX_SESSION_CALLS) {
    sessionCalls.push({
      tool: toolName,
      query,
      resultCount: 0,
      time: startedAtIso,
      outcome: "error",
      duration_ms: durationMs,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  failedToolCalls++;

  const eventHook = getToolEventHook();
  if (eventHook) {
    void eventHook({
      phase: "error",
      tool: toolName,
      timestamp: new Date().toISOString(),
      input: (input ?? {}) as Record<string, unknown>,
      query,
      query_length: query?.length,
      duration_ms: durationMs,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function executeInstrumentedTool(
  toolName: string,
  input: unknown,
  run: () => Promise<ToolPayload>
) {
  const startedAt = Date.now();
  const startedAtIso = notifyToolStart(toolName, input);
  try {
    const result = await run();
    notifyToolCall(toolName, input, result, Date.now() - startedAt, startedAtIso);
    return buildToolResult(result);
  } catch (error) {
    notifyToolError(toolName, input, error, Date.now() - startedAt, startedAtIso);
    throw error;
  }
}

function registerTools(server: McpServer): void {
  server.registerTool(
    "context.search",
    {
      description: "Search ranked context documents and code using semantic, graph and trust weighting.",
      inputSchema: SearchInput
    },
    async (input) => executeInstrumentedTool(
      "context.search",
      input,
      async () => runContextSearch(SearchInput.parse(input ?? {}))
    )
  );

  server.registerTool(
    "context.get_related",
    {
      description: "Return related entities and graph edges for a context entity id.",
      inputSchema: RelatedInput
    },
    async (input) => executeInstrumentedTool(
      "context.get_related",
      input,
      async () => runContextRelated(RelatedInput.parse(input ?? {}))
    )
  );

  server.registerTool(
    "context.impact",
    {
      description: "Traverse likely impact paths across config, code and SQL starting from an entity id or query.",
      inputSchema: ImpactInput
    },
    async (input) => executeInstrumentedTool(
      "context.impact",
      input,
      async () => runContextImpact(ImpactInput.parse(input ?? {}))
    )
  );

  server.registerTool(
    "context.get_rules",
    {
      description: "List indexed rules filtered by scope and active status.",
      inputSchema: RulesInput.optional()
    },
    async (input) => executeInstrumentedTool(
      "context.get_rules",
      input,
      async () => runContextRules(RulesInput.parse(input ?? {}))
    )
  );

  server.registerTool(
    "context.reload",
    {
      description: "Reload RyuGraph connection after graph updates or maintenance.",
      inputSchema: ReloadInput.optional()
    },
    async (input) => executeInstrumentedTool("context.reload", input, async () => {
      const parsed = ReloadInput.parse(input ?? {});
      return reloadContextGraph(parsed.force);
    })
  );

  server.registerTool(
    "cortex.workflow.start",
    {
      description:
        "Start a Cortex Harness workflow run for a task. Creates .agents/<task_id>/state.json and returns the first stage's envelope (the prompt the agent should answer).",
      inputSchema: WorkflowStartInput,
    },
    async (input) => executeInstrumentedTool(
      "cortex.workflow.start",
      input,
      async () => runWorkflowStart(WorkflowStartInput.parse(input ?? {}), {
        cwd: resolveProjectRoot(),
      }) as ToolPayload,
    ),
  );

  server.registerTool(
    "cortex.workflow.advance",
    {
      description:
        "Complete the current stage of a workflow run by writing its artifact and advancing the run pointer. Returns the new run state plus the next stage's envelope (or null when the run is finished, blocked, or failed).",
      inputSchema: WorkflowAdvanceInput,
    },
    async (input) => executeInstrumentedTool(
      "cortex.workflow.advance",
      input,
      async () => runWorkflowAdvance(WorkflowAdvanceInput.parse(input ?? {}), {
        cwd: resolveProjectRoot(),
      }) as ToolPayload,
    ),
  );

  server.registerTool(
    "cortex.workflow.status",
    {
      description:
        "Read the current run state for a task (current stage, completed stages, outcome). Returns null state when no run exists for the given task_id.",
      inputSchema: WorkflowStatusInput,
    },
    async (input) => executeInstrumentedTool(
      "cortex.workflow.status",
      input,
      async () => runWorkflowStatus(WorkflowStatusInput.parse(input ?? {}), {
        cwd: resolveProjectRoot(),
      }) as ToolPayload,
    ),
  );

  server.registerTool(
    "cortex.workflow.envelope",
    {
      description:
        "Compose the prompt envelope for a workflow stage without advancing the run. Defaults to the run's current_stage; pass `stage` to dry-run a different stage.",
      inputSchema: WorkflowEnvelopeInput,
    },
    async (input) => executeInstrumentedTool(
      "cortex.workflow.envelope",
      input,
      async () => runWorkflowEnvelope(WorkflowEnvelopeInput.parse(input ?? {}), {
        cwd: resolveProjectRoot(),
      }) as ToolPayload,
    ),
  );
}

let shutdownCalled = false;

async function onShutdown(): Promise<void> {
  if (shutdownCalled) return;
  shutdownCalled = true;
  const sessionEventHook = getSessionEventHook();
  if (sessionEventHook) {
    try {
      await Promise.race([
        Promise.resolve(sessionEventHook({
          phase: "end",
          timestamp: new Date().toISOString(),
          duration_ms: Date.now() - sessionStartedAt,
          tool_calls: sessionCalls.length,
          successful_tool_calls: successfulToolCalls,
          failed_tool_calls: failedToolCalls,
          calls: [...sessionCalls],
        })),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("session event hook timeout")), SHUTDOWN_TIMEOUT_MS))
      ]);
    } catch {
      // Best effort — don't block shutdown
    }
  }
  const hook = getSessionEndHook();
  if (hook) {
    try {
      await Promise.race([
        hook([...sessionCalls]),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("shutdown hook timeout")), SHUTDOWN_TIMEOUT_MS))
      ]);
    } catch {
      // Best effort — don't block shutdown
    }
  }
}

async function main(): Promise<void> {
  const server = new McpServer({
    name: "cortex-context",
    version: "0.1.0"
  });

  registerTools(server);

  // v2.0.0: load enterprise plugin in-process if .context/enterprise.yml
  // is present and license validates. Community-mode is a no-op.
  await loadPlugins(server);

  // Notify session start to enterprise (if active).
  const sessionEventHook = getSessionEventHook();
  if (sessionEventHook) {
    void sessionEventHook({
      phase: "start",
      timestamp: new Date(sessionStartedAt).toISOString(),
    });
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const cleanup = () => {
    void onShutdown().finally(() => process.exit(0));
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("beforeExit", () => {
    void onShutdown();
  });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Fatal error"}\n`);
  process.exit(1);
});
