import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { reloadContextGraph } from "./graph.js";
import { runContextRules } from "./rules.js";
import { runContextImpact, runContextRelated, runContextSearch } from "./search.js";

type ToolPayload = Record<string, unknown>;

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
    "context.impact",
    {
      description: "Traverse likely impact paths across config, code and SQL starting from an entity id or query.",
      inputSchema: ImpactInput
    },
    async (input) => buildToolResult(await runContextImpact(ImpactInput.parse(input ?? {})))
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
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Fatal error"}\n`);
  process.exit(1);
});
