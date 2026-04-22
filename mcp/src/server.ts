import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { reloadContextGraph } from "./graph.js";
import {
  getSessionEndHook,
  getSessionEventHook,
  getToolCallHook,
  getToolEventHook,
  loadPlugins
} from "./plugin.js";
import type { SessionCallRecord } from "./plugin.js";
import { captureSession } from "./session-capture.js";
import { summarizeSearchResults, isSearchResultItem } from "./search-summary.js";
import { runContextRules } from "./rules.js";
import {
  runContextFindCallers,
  runContextImpactAnalysis,
  runContextRelated,
  runContextSearch,
  runContextTraceCalls
} from "./search.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

// Average file ~1200 tokens; cortex returns ~400 token snippets → savings ~800/result.
// The enterprise collector adds resultCount * 400 to get the full "without cortex" total.
const ESTIMATED_TOKENS_SAVED_PER_RESULT = 800;

type ToolPayload = Record<string, unknown>;

const MAX_SESSION_CALLS = 500;
const sessionCalls: SessionCallRecord[] = [];

const SearchInput = z.object({
  query: z.string().min(1),
  top_k: z.number().int().positive().max(20).default(5),
  include_deprecated: z.boolean().default(false),
  include_content: z.boolean().default(false),
  summarize: z.boolean().default(false)
});

const RelatedInput = z.object({
  entity_id: z.string().min(1),
  depth: z.number().int().positive().max(3).default(1),
  include_edges: z.boolean().default(true)
});

const FindCallersInput = z.object({
  entity_id: z.string().min(1),
  depth: z.number().int().positive().max(4).default(1),
  include_edges: z.boolean().default(true)
});

const TraceCallsInput = z.object({
  entity_id: z.string().min(1),
  depth: z.number().int().positive().max(4).default(2),
  direction: z.enum(["outgoing", "incoming", "both"]).default("outgoing"),
  include_edges: z.boolean().default(true)
});

const ImpactAnalysisInput = z
  .object({
    entity_id: z.string().min(1).optional(),
    query: z.string().min(1).optional(),
    depth: z.number().int().positive().max(4).default(2),
    top_k: z.number().int().positive().max(20).default(8),
    direction: z.enum(["incoming", "outgoing", "both"]).default("incoming"),
    include_edges: z.boolean().default(true)
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

const MAX_RESULT_CHARS = 80_000;
const MAX_STRING_PREVIEW = 200;
const MAX_ARRAY_PREVIEW = 10;
const sessionStartedAt = Date.now();
let successfulToolCalls = 0;
let failedToolCalls = 0;

function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function sanitizeString(value: string): string {
  if (value.length <= MAX_STRING_PREVIEW) return value;
  return `${value.slice(0, MAX_STRING_PREVIEW - 1)}…`;
}

function sanitizeInputValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_PREVIEW).map((item) => sanitizeInputValue(item));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_ARRAY_PREVIEW);
    return Object.fromEntries(entries.map(([key, item]) => [key, sanitizeInputValue(item)]));
  }
  return String(value);
}

function sanitizeToolInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).map(([key, value]) => [key, sanitizeInputValue(value)])
  );
}

function extractQuery(input: unknown, result?: ToolPayload): string | undefined {
  if (input && typeof input === "object" && typeof (input as Record<string, unknown>).query === "string") {
    return sanitizeString((input as Record<string, unknown>).query as string);
  }
  if (result && typeof result.query === "string") {
    return sanitizeString(result.query);
  }
  return undefined;
}

function extractEntitiesReturned(result: ToolPayload): string[] {
  if (Array.isArray(result.results)) {
    return result.results
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const record = item as Record<string, unknown>;
        if (typeof record.id === "string") return record.id;
        if (typeof record.path === "string") return record.path;
        if (typeof record.title === "string") return record.title;
        if (typeof record.label === "string") return record.label;
        return null;
      })
      .filter((item): item is string => Boolean(item))
      .slice(0, 25);
  }

  if (Array.isArray(result.rules)) {
    return result.rules
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const record = item as Record<string, unknown>;
        if (typeof record.id === "string") return record.id;
        if (typeof record.title === "string") return record.title;
        return null;
      })
      .filter((item): item is string => Boolean(item))
      .slice(0, 25);
  }

  return [];
}

function extractRulesApplied(result: ToolPayload): string[] {
  const applied = new Set<string>();

  if (Array.isArray(result.results)) {
    for (const item of result.results) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      if (Array.isArray(record.matched_rules)) {
        for (const rule of record.matched_rules) {
          if (typeof rule === "string") applied.add(rule);
        }
      }
    }
  }

  if (Array.isArray(result.matched_rules)) {
    for (const rule of result.matched_rules) {
      if (typeof rule === "string") applied.add(rule);
    }
  }

  return [...applied].slice(0, 25);
}

function truncateResults(data: ToolPayload): ToolPayload {
  const json = JSON.stringify(data);
  if (json.length <= MAX_RESULT_CHARS) return data;

  const results = data.results;
  if (!Array.isArray(results) || results.length === 0) return data;

  // First pass: strip content fields from results
  const stripped = results.map((r: Record<string, unknown>) => {
    const { content, context_envelope, ...rest } = r;
    void content;
    void context_envelope;
    return rest;
  });
  const pass1 = { ...data, results: stripped, truncated: true };
  if (JSON.stringify(pass1).length <= MAX_RESULT_CHARS) return pass1;

  // Second pass: reduce result count until it fits
  let trimmed = stripped;
  while (trimmed.length > 1 && JSON.stringify({ ...pass1, results: trimmed }).length > MAX_RESULT_CHARS) {
    trimmed = trimmed.slice(0, trimmed.length - 1);
  }
  return { ...pass1, results: trimmed, truncated: true, original_count: results.length };
}

function buildToolResult(data: ToolPayload) {
  const safeData = truncateResults(data);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(safeData, null, 2)
      }
    ],
    structuredContent: safeData
  };
}

function notifyToolCall(toolName: string, input: unknown, result: ToolPayload, durationMs: number, startedAtIso: string): void {
  const resultCount = Array.isArray(result.results) ? result.results.length : 0;
  const query = extractQuery(input, result);
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
      input: sanitizeToolInput(input),
      query,
      query_length: query?.length,
      result_count: resultCount,
      estimated_tokens_saved: resultCount * ESTIMATED_TOKENS_SAVED_PER_RESULT,
      entities_returned: extractEntitiesReturned(result),
      rules_applied: extractRulesApplied(result),
      duration_ms: durationMs,
    });
  }
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
      input: sanitizeToolInput(input),
      query,
      query_length: query?.length,
    });
  }
  return timestamp;
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
      error: summarizeError(error),
    });
  }

  failedToolCalls++;

  const eventHook = getToolEventHook();
  if (eventHook) {
    void eventHook({
      phase: "error",
      tool: toolName,
      timestamp: new Date().toISOString(),
      input: sanitizeToolInput(input),
      query,
      query_length: query?.length,
      duration_ms: durationMs,
      error: summarizeError(error),
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
    async (input) => executeInstrumentedTool("context.search", input, async () => {
      const parsed = SearchInput.parse(input ?? {});
      const result = await runContextSearch(parsed);
      return parsed.summarize && Array.isArray(result.results) && result.results.length > 0
        ? { ...result, summary: summarizeSearchResults(parsed.query, result.results.filter(isSearchResultItem)) }
        : result;
    })
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
    "context.find_callers",
    {
      description: "Return chunk callers for a chunk or file entity using the indexed call graph.",
      inputSchema: FindCallersInput
    },
    async (input) => executeInstrumentedTool(
      "context.find_callers",
      input,
      async () => runContextFindCallers(FindCallersInput.parse(input ?? {}))
    )
  );

  server.registerTool(
    "context.trace_calls",
    {
      description: "Trace call graph neighbors from a chunk or file entity in the requested direction.",
      inputSchema: TraceCallsInput
    },
    async (input) => executeInstrumentedTool(
      "context.trace_calls",
      input,
      async () => runContextTraceCalls(TraceCallsInput.parse(input ?? {}))
    )
  );

  server.registerTool(
    "context.impact_analysis",
    {
      description: "Analyze likely impacted call-graph entities starting from an entity id or search query.",
      inputSchema: ImpactAnalysisInput
    },
    async (input) => executeInstrumentedTool(
      "context.impact_analysis",
      input,
      async () => runContextImpactAnalysis(ImpactAnalysisInput.parse(input ?? {}))
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
}

let shutdownCalled = false;

const SHUTDOWN_TIMEOUT_MS = 3000;

async function onShutdown(): Promise<void> {
  if (shutdownCalled) return;
  shutdownCalled = true;
  const contextDir = process.env.CORTEX_PROJECT_ROOT
    ? `${process.env.CORTEX_PROJECT_ROOT}/.context`
    : `${process.cwd()}/.context`;
  try {
    await captureSession(sessionCalls, contextDir);
  } catch {
    // Best effort — don't block shutdown
  }
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
    version: pkg.version
  });

  registerTools(server);
  await loadPlugins(server);
  const sessionEventHook = getSessionEventHook();
  if (sessionEventHook) {
    try {
      await Promise.resolve(sessionEventHook({
        phase: "start",
        timestamp: new Date().toISOString(),
      }));
    } catch {
      // Best effort — don't block startup
    }
  }

  process.once("SIGTERM", () => { onShutdown().then(() => process.exit(0)).catch(() => process.exit(1)); });
  process.once("SIGINT", () => { onShutdown().then(() => process.exit(0)).catch(() => process.exit(1)); });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Fatal error"}\n`);
  process.exit(1);
});
