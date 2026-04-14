import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { reloadContextGraph } from "./graph.js";
import { getToolCallHook, getSessionEndHook, loadPlugins } from "./plugin.js";
import type { SessionCallRecord } from "./plugin.js";
import { captureSession } from "./session-capture.js";
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

type SearchResultItem = {
  id?: string;
  entity_type?: string;
  title?: string;
  path?: string;
  score?: number;
  excerpt?: string;
  matched_rules?: string[];
};

function summarizeSearchResults(query: string, results: SearchResultItem[]): string {
  const lines: string[] = [`Found ${results.length} result${results.length === 1 ? "" : "s"} for "${query}":\n`];

  for (let i = 0; i < Math.min(results.length, 10); i++) {
    const r = results[i];
    const type = r.entity_type ?? "Unknown";
    const label = r.title ?? r.path ?? r.id ?? "untitled";
    const score = typeof r.score === "number" ? ` (score: ${r.score.toFixed(2)})` : "";
    const excerpt = typeof r.excerpt === "string" ? r.excerpt.slice(0, 150).replace(/\n/g, " ").trim() : "";
    lines.push(`${i + 1}. [${type}] ${label}${score}`);
    if (excerpt) {
      lines.push(`   ${excerpt}${r.excerpt && r.excerpt.length > 150 ? "..." : ""}`);
    }
    if (r.matched_rules && r.matched_rules.length > 0) {
      lines.push(`   Rules: ${r.matched_rules.join(", ")}`);
    }
  }

  return lines.join("\n").slice(0, 2000);
}

function notifyToolCall(toolName: string, result: ToolPayload): void {
  const resultCount = Array.isArray(result.results) ? result.results.length : 0;
  if (sessionCalls.length < MAX_SESSION_CALLS) {
    sessionCalls.push({
      tool: toolName,
      query: typeof result.query === "string" ? result.query : undefined,
      resultCount,
      time: new Date().toISOString()
    });
  }
  const hook = getToolCallHook();
  if (hook) {
    hook(toolName, resultCount, resultCount * ESTIMATED_TOKENS_SAVED_PER_RESULT);
  }
}

function registerTools(server: McpServer): void {
  server.registerTool(
    "context.search",
    {
      description: "Search ranked context documents and code using semantic, graph and trust weighting.",
      inputSchema: SearchInput
    },
    async (input) => {
      const parsed = SearchInput.parse(input ?? {});
      const result = await runContextSearch(parsed);
      if (parsed.summarize && Array.isArray(result.results) && result.results.length > 0) {
        result.summary = summarizeSearchResults(parsed.query, result.results as SearchResultItem[]);
      }
      notifyToolCall("context.search", result);
      return buildToolResult(result);
    }
  );

  server.registerTool(
    "context.get_related",
    {
      description: "Return related entities and graph edges for a context entity id.",
      inputSchema: RelatedInput
    },
    async (input) => {
      const result = await runContextRelated(RelatedInput.parse(input ?? {}));
      notifyToolCall("context.get_related", result);
      return buildToolResult(result);
    }
  );

  server.registerTool(
    "context.find_callers",
    {
      description: "Return chunk callers for a chunk or file entity using the indexed call graph.",
      inputSchema: FindCallersInput
    },
    async (input) => {
      const result = await runContextFindCallers(FindCallersInput.parse(input ?? {}));
      notifyToolCall("context.find_callers", result);
      return buildToolResult(result);
    }
  );

  server.registerTool(
    "context.trace_calls",
    {
      description: "Trace call graph neighbors from a chunk or file entity in the requested direction.",
      inputSchema: TraceCallsInput
    },
    async (input) => {
      const result = await runContextTraceCalls(TraceCallsInput.parse(input ?? {}));
      notifyToolCall("context.trace_calls", result);
      return buildToolResult(result);
    }
  );

  server.registerTool(
    "context.impact_analysis",
    {
      description: "Analyze likely impacted call-graph entities starting from an entity id or search query.",
      inputSchema: ImpactAnalysisInput
    },
    async (input) => {
      const result = await runContextImpactAnalysis(ImpactAnalysisInput.parse(input ?? {}));
      notifyToolCall("context.impact_analysis", result);
      return buildToolResult(result);
    }
  );

  server.registerTool(
    "context.get_rules",
    {
      description: "List indexed rules filtered by scope and active status.",
      inputSchema: RulesInput.optional()
    },
    async (input) => {
      const result = await runContextRules(RulesInput.parse(input ?? {}));
      notifyToolCall("context.get_rules", result);
      return buildToolResult(result);
    }
  );

  server.registerTool(
    "context.reload",
    {
      description: "Reload RyuGraph connection after graph updates or maintenance.",
      inputSchema: ReloadInput.optional()
    },
    async (input) => {
      const parsed = ReloadInput.parse(input ?? {});
      const result = await reloadContextGraph(parsed.force);
      notifyToolCall("context.reload", result);
      return buildToolResult(result);
    }
  );
}

let shutdownCalled = false;

async function onShutdown(): Promise<void> {
  if (shutdownCalled) return;
  shutdownCalled = true;
  const contextDir = process.env.CORTEX_PROJECT_ROOT
    ? `${process.env.CORTEX_PROJECT_ROOT}/.context`
    : `${process.cwd()}/.context`;
  try {
    captureSession(sessionCalls, contextDir);
  } catch {
    // Best effort — don't block shutdown
  }
  const hook = getSessionEndHook();
  if (hook) {
    try {
      await hook(sessionCalls);
    } catch {
      // Best effort
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

  process.on("beforeExit", () => { onShutdown().catch(() => {}); });
  process.once("SIGTERM", () => { onShutdown().then(() => process.exit(0)).catch(() => process.exit(1)); });
  process.once("SIGINT", () => { onShutdown().then(() => process.exit(0)).catch(() => process.exit(1)); });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Fatal error"}\n`);
  process.exit(1);
});
