import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createWorkflowAnalysisErrorEnvelope,
  parseWorkflowAnalysisArgs,
  runWorkflowAnalysisQuery,
  serializeWorkflowAnalysisEnvelope,
  type WorkflowAnalysisEnvelope,
  type WorkflowAnalysisInput,
} from "./cli/workflow-analysis.js";
import { REGISTERED_PREDICATES } from "./core/analysis-state/engine.js";
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

const AnalysisTaskId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$/u);
const AnalysisFactId = z.string().regex(/^(?:base:obs|fact):[0-9a-f]{64}$/u);
const AnalysisPredicate = z.enum(REGISTERED_PREDICATES as [string, ...string[]]);
const AnalysisSince = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

function closedMcpInputSchema<T extends z.ZodRawShape>(shape: T): z.ZodObject<T, "strict"> {
  const schema = z.object(shape).strict();
  const safeParseAsync = schema.safeParseAsync.bind(schema);
  schema.safeParseAsync = (async (input: unknown, params?: z.ParseParams) => {
    const result = await safeParseAsync(input, params);
    // McpServer otherwise returns its own raw Zod diagnostic before invoking
    // the handler. Preserve the strict object for the advertised JSON Schema,
    // but hand rejected input to our closed manual parser and public envelope.
    return result.success ? result : { success: true, data: input };
  }) as typeof schema.safeParseAsync;
  return schema;
}

const AnalysisStateInput = closedMcpInputSchema({ task_id: AnalysisTaskId });
const AnalysisWhyInput = closedMcpInputSchema({ task_id: AnalysisTaskId, fact_id: AnalysisFactId });
const AnalysisWhyNotInput = closedMcpInputSchema({ task_id: AnalysisTaskId, predicate: AnalysisPredicate });
const AnalysisChangesInput = closedMcpInputSchema({ task_id: AnalysisTaskId, since: AnalysisSince });

type MaintainedAnalysisToolName =
  | "context.analysis_state"
  | "context.analysis_why"
  | "context.analysis_why_not"
  | "context.analysis_changes";

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

function buildWorkflowAnalysisToolResult(envelope: WorkflowAnalysisEnvelope) {
  return {
    content: [{ type: "text" as const, text: serializeWorkflowAnalysisEnvelope(envelope, true) }],
    structuredContent: envelope as unknown as ToolPayload,
    isError: !envelope.ok,
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(input: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(input).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseMaintainedAnalysisInput(
  toolName: MaintainedAnalysisToolName,
  rawInput: unknown,
): WorkflowAnalysisInput | undefined {
  if (!isPlainObject(rawInput)) return undefined;
  let args: string[];
  if (toolName === "context.analysis_state") {
    if (!hasExactKeys(rawInput, ["task_id"]) || typeof rawInput.task_id !== "string") return undefined;
    args = ["state", rawInput.task_id];
  } else if (toolName === "context.analysis_why") {
    if (
      !hasExactKeys(rawInput, ["task_id", "fact_id"]) ||
      typeof rawInput.task_id !== "string" ||
      typeof rawInput.fact_id !== "string"
    ) return undefined;
    args = ["why", rawInput.task_id, rawInput.fact_id];
  } else if (toolName === "context.analysis_why_not") {
    if (
      !hasExactKeys(rawInput, ["task_id", "predicate"]) ||
      typeof rawInput.task_id !== "string" ||
      typeof rawInput.predicate !== "string"
    ) return undefined;
    args = ["why-not", rawInput.task_id, rawInput.predicate];
  } else {
    if (
      !hasExactKeys(rawInput, ["task_id", "since"]) ||
      typeof rawInput.task_id !== "string" ||
      typeof rawInput.since !== "number"
    ) return undefined;
    args = ["changes", rawInput.task_id, "--since", String(rawInput.since)];
  }
  try {
    return parseWorkflowAnalysisArgs(args).input;
  } catch {
    return undefined;
  }
}

function publicMcpInput(input: WorkflowAnalysisInput): ToolPayload {
  const { operation: _operation, ...publicInput } = input;
  return publicInput;
}

async function executeMaintainedAnalysisTool(
  toolName: MaintainedAnalysisToolName,
  rawInput: unknown,
) {
  const input = parseMaintainedAnalysisInput(toolName, rawInput);
  const instrumentedInput = input ? publicMcpInput(input) : {};
  const startedAt = Date.now();
  const startedAtIso = notifyToolStart(toolName, instrumentedInput);
  const envelope = input
    ? runWorkflowAnalysisQuery(
        input,
        path.resolve(process.env.CORTEX_PROJECT_ROOT?.trim() || process.cwd()),
      )
    : createWorkflowAnalysisErrorEnvelope("INVALID_ARGS");
  const durationMs = Date.now() - startedAt;
  if (envelope.ok) {
    notifyToolCall(toolName, instrumentedInput, envelope as unknown as ToolPayload, durationMs, startedAtIso);
  } else {
    notifyToolError(
      toolName,
      instrumentedInput,
      new Error(envelope.error?.message ?? "Maintained analysis query failed"),
      durationMs,
      startedAtIso,
    );
  }
  return buildWorkflowAnalysisToolResult(envelope);
}

function registerMaintainedAnalysisTools(server: McpServer): void {
  server.registerTool(
    "context.analysis_state",
    {
      description: "Read the trusted maintained analysis state for a task.",
      inputSchema: AnalysisStateInput,
    },
    async (input) => executeMaintainedAnalysisTool("context.analysis_state", input),
  );
  server.registerTool(
    "context.analysis_why",
    {
      description: "Explain a fact in trusted maintained analysis state.",
      inputSchema: AnalysisWhyInput,
    },
    async (input) => executeMaintainedAnalysisTool("context.analysis_why", input),
  );
  server.registerTool(
    "context.analysis_why_not",
    {
      description: "Explain why a predicate is absent from trusted maintained analysis state.",
      inputSchema: AnalysisWhyNotInput,
    },
    async (input) => executeMaintainedAnalysisTool("context.analysis_why_not", input),
  );
  server.registerTool(
    "context.analysis_changes",
    {
      description: "Read trusted maintained analysis changes since an epoch.",
      inputSchema: AnalysisChangesInput,
    },
    async (input) => executeMaintainedAnalysisTool("context.analysis_changes", input),
  );
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

  if (process.env.CORTEX_MAINTAINED_ANALYSIS_MCP === "1") {
    registerMaintainedAnalysisTools(server);
  }

  // Note: cortex.workflow.* tools (the Cortex Harness) are enterprise-only
  // and registered by enterprise/index.ts::register() once the license has
  // verified. They intentionally do not appear here so community-mode MCP
  // servers do not surface them at all.
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
