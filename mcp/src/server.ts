import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { reloadContextGraph } from "./graph.js";
import { loadPlugins } from "./plugin.js";
import { runContextRules } from "./rules.js";
import {
  runContextFindCallers,
  runContextImpactAnalysis,
  runContextRelated,
  runContextSearch,
  runContextTraceCalls
} from "./search.js";

type ToolPayload = Record<string, unknown>;

const SearchInput = z.object({
  query: z.string().min(1),
  top_k: z.number().int().positive().max(20).default(5),
  include_deprecated: z.boolean().default(false),
  include_content: z.boolean().default(false)
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

function registerTools(server: McpServer): void {
  server.registerTool(
    "context.search",
    {
      description: "Search ranked context documents and code using semantic, graph and trust weighting.",
      inputSchema: SearchInput
    },
    async (input) => buildToolResult(await runContextSearch(SearchInput.parse(input ?? {})))
  );

  server.registerTool(
    "context.get_related",
    {
      description: "Return related entities and graph edges for a context entity id.",
      inputSchema: RelatedInput
    },
    async (input) => buildToolResult(await runContextRelated(RelatedInput.parse(input ?? {})))
  );

  server.registerTool(
    "context.find_callers",
    {
      description: "Return chunk callers for a chunk or file entity using the indexed call graph.",
      inputSchema: FindCallersInput
    },
    async (input) => buildToolResult(await runContextFindCallers(FindCallersInput.parse(input ?? {})))
  );

  server.registerTool(
    "context.trace_calls",
    {
      description: "Trace call graph neighbors from a chunk or file entity in the requested direction.",
      inputSchema: TraceCallsInput
    },
    async (input) => buildToolResult(await runContextTraceCalls(TraceCallsInput.parse(input ?? {})))
  );

  server.registerTool(
    "context.impact_analysis",
    {
      description: "Analyze likely impacted call-graph entities starting from an entity id or search query.",
      inputSchema: ImpactAnalysisInput
    },
    async (input) =>
      buildToolResult(await runContextImpactAnalysis(ImpactAnalysisInput.parse(input ?? {})))
  );

  server.registerTool(
    "context.get_rules",
    {
      description: "List indexed rules filtered by scope and active status.",
      inputSchema: RulesInput.optional()
    },
    async (input) => buildToolResult(await runContextRules(RulesInput.parse(input ?? {})))
  );

  server.registerTool(
    "context.reload",
    {
      description: "Reload RyuGraph connection after graph updates or maintenance.",
      inputSchema: ReloadInput.optional()
    },
    async (input) => {
      const parsed = ReloadInput.parse(input ?? {});
      return buildToolResult(await reloadContextGraph(parsed.force));
    }
  );
}

async function main(): Promise<void> {
  const server = new McpServer({
    name: "cortex-context",
    version: "0.1.0"
  });

  registerTools(server);
  await loadPlugins(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Fatal error"}\n`);
  process.exit(1);
});
