import { runContextRules } from "../rules.js";
import { runContextImpact, runContextRelated, runContextSearch } from "../search.js";
import type {
  ImpactParams,
  RelatedParams,
  RelationType,
  RulesParams,
  SearchParams,
  ToolPayload,
} from "../types.js";

type Flags = Record<string, string | boolean>;

type ParsedArgs = {
  flags: Flags;
  rest: string[];
};

type JsonEnvelope = {
  ok: boolean;
  command: string;
  input?: Record<string, unknown>;
  context_source?: unknown;
  warning?: unknown;
  data?: ToolPayload;
  error?: {
    code: string;
    message: string;
  };
};

const QUERY_COMMANDS = new Set(["search", "related", "impact", "rules", "explain"]);

const ENTITY_ID_PREFIXES = [
  "file:",
  "chunk:",
  "rule:",
  "adr:",
  "module:",
  "project:",
];

export async function runQueryCommand(args: string[]): Promise<void> {
  const command = args[0] ?? "help";
  const rest = args.slice(1);

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (!QUERY_COMMANDS.has(command)) {
    throw new Error(`Unknown query command: ${command}`);
  }

  const json = wantsJson(rest);
  try {
    switch (command) {
      case "search":
        return await runSearch(rest);
      case "related":
        return await runRelated(rest);
      case "impact":
        return await runImpact(rest);
      case "rules":
        return await runRules(rest);
      case "explain":
        return await runExplain(rest);
      default:
        throw new Error(`Unknown query command: ${command}`);
    }
  } catch (error) {
    if (!json) {
      throw error;
    }
    emitJson({
      ok: false,
      command,
      error: {
        code: "INVALID_ARGS",
        message: error instanceof Error ? error.message : String(error),
      },
    });
    process.exitCode = 1;
  }
}

function printHelp(): void {
  const lines = [
    "Usage:",
    "  cortex search <query> [--top-k <n>] [--preset <full|compact|minimal>] [--include-content] [--json]",
    "  cortex related <entity-id> [--depth <n>] [--edges] [--metadata] [--json]",
    "  cortex impact <query-or-entity-id> [--entity-id <id>] [--query <q>] [--depth <n>] [--top-k <n>] [--json]",
    "  cortex rules [--scope <scope>] [--include-inactive] [--json]",
    "  cortex explain <query-or-entity-id> [--top-k <n>] [--json]",
    "",
    "These commands read the local Cortex graph and emit MCP-equivalent data with --json.",
  ];
  process.stdout.write(lines.join("\n") + "\n");
}

function parseArgs(args: string[]): ParsedArgs {
  const flags: Flags = {};
  const rest: string[] = [];
  let i = 0;

  while (i < args.length) {
    const arg = args[i];
    if (arg === "--") {
      rest.push(...args.slice(i + 1));
      break;
    }

    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[name] = true;
        i += 1;
        continue;
      }
      flags[name] = next;
      i += 2;
      continue;
    }

    rest.push(arg);
    i += 1;
  }

  return { flags, rest };
}

function wantsJson(args: string[]): boolean {
  return args.includes("--json");
}

function isFlagEnabled(flags: Flags, name: string): boolean {
  return flags[name] === true;
}

function optionalString(flags: Flags, name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parsePositiveIntFlag(
  flags: Flags,
  name: string,
  defaultValue: number,
  max: number,
): number {
  const raw = flags[name];
  if (raw === undefined) {
    return defaultValue;
  }
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error(`--${name} requires a numeric value`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new Error(`--${name} must be an integer from 1 to ${max}`);
  }
  return parsed;
}

function parsePreset(flags: Flags): "full" | "compact" | "minimal" | undefined {
  const value = optionalString(flags, "preset") ?? optionalString(flags, "response-preset");
  if (value === undefined) {
    return undefined;
  }
  if (value === "full" || value === "compact" || value === "minimal") {
    return value;
  }
  throw new Error("--preset must be one of full, compact, minimal");
}

function parseCsvFlag<T extends string>(
  flags: Flags,
  name: string,
  allowed: readonly T[],
): T[] | undefined {
  const raw = optionalString(flags, name);
  if (!raw) {
    return undefined;
  }
  const allowedSet = new Set<string>(allowed);
  const parsed = raw.split(",").map((value) => value.trim()).filter(Boolean);
  for (const value of parsed) {
    if (!allowedSet.has(value)) {
      throw new Error(`--${name} contains unsupported value: ${value}`);
    }
  }
  return parsed as T[];
}

function positionalText(rest: string[], label: string): string {
  const value = rest.join(" ").trim();
  if (!value) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function emitJson(value: JsonEnvelope): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function emitEnvelope(command: string, input: Record<string, unknown>, data: ToolPayload): void {
  emitJson({
    ok: true,
    command,
    input,
    context_source: data.context_source,
    warning: data.warning,
    data,
  });
}

function printSummary(command: string, data: ToolPayload): void {
  const source = data.context_source ? ` context_source=${String(data.context_source)}` : "";
  const warning = data.warning ? ` warning=${String(data.warning)}` : "";

  if (Array.isArray(data.results)) {
    process.stdout.write(`${command}: ${data.results.length} results${source}${warning}\n`);
    for (const result of data.results.slice(0, 10)) {
      printEntityLine(result);
    }
    return;
  }

  if (Array.isArray(data.related)) {
    process.stdout.write(`${command}: ${data.related.length} related${source}${warning}\n`);
    for (const result of data.related.slice(0, 10)) {
      printEntityLine(result);
    }
    return;
  }

  if (Array.isArray(data.rules)) {
    process.stdout.write(`${command}: ${data.rules.length} rules${source}${warning}\n`);
    for (const rule of data.rules.slice(0, 10)) {
      if (rule && typeof rule === "object") {
        const row = rule as Record<string, unknown>;
        process.stdout.write(`- ${String(row.id ?? "")} priority=${String(row.priority ?? "")} scope=${String(row.scope ?? "")}\n`);
      }
    }
    return;
  }

  process.stdout.write(`${command}: ok${source}${warning}\n`);
}

function printEntityLine(value: unknown): void {
  if (!value || typeof value !== "object") {
    return;
  }
  const row = value as Record<string, unknown>;
  const title = row.title ?? row.label ?? row.id ?? "";
  const path = row.path ? ` ${String(row.path)}` : "";
  process.stdout.write(`- ${String(title)}${path}\n`);
}

async function runSearch(args: string[]): Promise<void> {
  const { flags, rest } = parseArgs(args);
  const query = optionalString(flags, "query") ?? positionalText(rest, "query");
  const input: SearchParams = {
    query,
    top_k: parsePositiveIntFlag(flags, "top-k", 5, 20),
    include_deprecated: isFlagEnabled(flags, "include-deprecated"),
    response_preset: parsePreset(flags),
    include_scores: isFlagEnabled(flags, "scores") || isFlagEnabled(flags, "include-scores") || undefined,
    include_matched_rules:
      isFlagEnabled(flags, "matched-rules") || isFlagEnabled(flags, "include-matched-rules") || undefined,
    include_content: isFlagEnabled(flags, "include-content") || undefined,
  };
  const data = await runContextSearch(input);
  if (isFlagEnabled(flags, "json")) {
    emitEnvelope("search", input, data);
    return;
  }
  printSummary("search", data);
}

async function runRelated(args: string[]): Promise<void> {
  const { flags, rest } = parseArgs(args);
  const entityId = optionalString(flags, "entity-id") ?? positionalText(rest, "entity-id");
  const input: RelatedParams = {
    entity_id: entityId,
    depth: parsePositiveIntFlag(flags, "depth", 1, 3),
    include_edges: isFlagEnabled(flags, "edges") || isFlagEnabled(flags, "include-edges") || undefined,
    response_preset: parsePreset(flags),
    include_entity_metadata:
      isFlagEnabled(flags, "metadata") || isFlagEnabled(flags, "include-entity-metadata") || undefined,
  };
  const data = await runContextRelated(input);
  if (isFlagEnabled(flags, "json")) {
    emitEnvelope("related", input, data);
    return;
  }
  printSummary("related", data);
}

async function runImpact(args: string[]): Promise<void> {
  const { flags, rest } = parseArgs(args);
  const explicitEntityId = optionalString(flags, "entity-id");
  const explicitQuery = optionalString(flags, "query");
  const positional = rest.length > 0 ? positionalText(rest, "query-or-entity-id") : undefined;
  const seed = explicitEntityId ?? explicitQuery ?? positional;

  if (!seed) {
    throw new Error("Either --entity-id, --query, or a positional seed is required");
  }

  const relationTypes = parseCsvFlag(flags, "relation-types", [
    "CALLS",
    "CALLS_SQL",
    "IMPORTS",
    "USES_CONFIG_KEY",
    "USES_RESOURCE_KEY",
    "USES_SETTING_KEY",
    "USES_CONFIG",
    "TRANSFORMS_CONFIG",
    "PART_OF",
  ] as const);
  const input: ImpactParams = {
    depth: parsePositiveIntFlag(flags, "depth", 2, 4),
    top_k: parsePositiveIntFlag(flags, "top-k", 8, 20),
    include_edges: !isFlagEnabled(flags, "no-edges"),
    response_preset: parsePreset(flags),
    include_scores: isFlagEnabled(flags, "scores") || isFlagEnabled(flags, "include-scores") || undefined,
    include_reasons: isFlagEnabled(flags, "reasons") || isFlagEnabled(flags, "include-reasons") || undefined,
    verbose_paths: isFlagEnabled(flags, "verbose-paths") || undefined,
    max_path_hops_shown: parsePositiveIntFlag(flags, "max-path-hops-shown", 3, 8),
    profile: parseProfile(flags),
    sort_by: parseSortBy(flags),
    relation_types: relationTypes as RelationType[] | undefined,
    path_must_include: parseCsvFlag(flags, "path-must-include", relationTypesAllowed()) as RelationType[] | undefined,
    path_must_exclude: parseCsvFlag(flags, "path-must-exclude", relationTypesAllowed()) as RelationType[] | undefined,
    result_domains: parseCsvFlag(flags, "result-domains", [
      "code",
      "config",
      "resource",
      "settings",
      "sql",
      "project",
    ] as const),
    result_entity_types: parseCsvFlag(flags, "result-entity-types", [
      "File",
      "Chunk",
      "Module",
      "Project",
      "ADR",
      "Rule",
    ] as const),
  };

  if (explicitEntityId || (!explicitQuery && seedLooksLikeEntityId(seed))) {
    input.entity_id = seed;
  } else {
    input.query = seed;
  }

  const data = await runContextImpact(input);
  if (isFlagEnabled(flags, "json")) {
    emitEnvelope("impact", input as Record<string, unknown>, data);
    return;
  }
  printSummary("impact", data);
}

function relationTypesAllowed(): readonly RelationType[] {
  return [
    "CALLS",
    "CALLS_SQL",
    "IMPORTS",
    "USES_CONFIG_KEY",
    "USES_RESOURCE_KEY",
    "USES_SETTING_KEY",
    "USES_CONFIG",
    "TRANSFORMS_CONFIG",
    "PART_OF",
  ];
}

function seedLooksLikeEntityId(value: string): boolean {
  return ENTITY_ID_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function parseProfile(flags: Flags): ImpactParams["profile"] {
  const value = optionalString(flags, "profile");
  if (!value) {
    return "all";
  }
  if (value === "all" || value === "config_only" || value === "config_to_sql" || value === "code_only" || value === "sql_only") {
    return value;
  }
  throw new Error("--profile must be one of all, config_only, config_to_sql, code_only, sql_only");
}

function parseSortBy(flags: Flags): ImpactParams["sort_by"] {
  const value = optionalString(flags, "sort-by");
  if (!value) {
    return "impact_score";
  }
  if (value === "impact_score" || value === "shortest_path" || value === "semantic_score" || value === "graph_score" || value === "trust_score") {
    return value;
  }
  throw new Error("--sort-by must be one of impact_score, shortest_path, semantic_score, graph_score, trust_score");
}

async function runRules(args: string[]): Promise<void> {
  const { flags } = parseArgs(args);
  const input: RulesParams = {
    scope: optionalString(flags, "scope"),
    include_inactive: isFlagEnabled(flags, "include-inactive"),
  };
  const data = await runContextRules(input);
  if (isFlagEnabled(flags, "json")) {
    emitEnvelope("rules", input, data);
    return;
  }
  printSummary("rules", data);
}

async function runExplain(args: string[]): Promise<void> {
  const { flags, rest } = parseArgs(args);
  const target = optionalString(flags, "id") ?? optionalString(flags, "query") ?? positionalText(rest, "query-or-entity-id");
  const input: SearchParams = {
    query: target,
    top_k: parsePositiveIntFlag(flags, "top-k", 3, 20),
    include_deprecated: isFlagEnabled(flags, "include-deprecated"),
    response_preset: parsePreset(flags) ?? "full",
    include_scores: true,
    include_matched_rules: true,
    include_content: isFlagEnabled(flags, "include-content") || undefined,
  };
  const search = await runContextSearch(input);
  const data: ToolPayload = {
    query: target,
    entity_id: seedLooksLikeEntityId(target) ? target : undefined,
    context_source: search.context_source,
    warning: search.warning,
    semantic_engine: search.semantic_engine,
    ranking: search.ranking,
    results: search.results,
    explanation: "Scores and matched_rules come from the same local search ranking used by context.search.",
  };

  if (isFlagEnabled(flags, "json")) {
    emitEnvelope("explain", input, data);
    return;
  }
  printSummary("explain", data);
}
