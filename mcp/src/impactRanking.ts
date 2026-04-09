import type { JsonObject, SearchEntity } from "./types.js";

const SQL_ENTITY_KINDS = new Set(["procedure", "view", "function", "table", "trigger"]);
const SQL_LIKE_EXTENSIONS = [".sql"];
const CONFIG_LIKE_EXTENSIONS = [".config"];
const RESOURCE_LIKE_EXTENSIONS = [".resx"];
const SETTINGS_LIKE_EXTENSIONS = [".settings"];

function normalizeText(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function pathHasExtension(pathValue: string, extensions: string[]): boolean {
  const normalized = normalizeText(pathValue);
  return extensions.some((extension) => normalized.endsWith(extension));
}

export function impactBaseScore(hops: number, graphScore: number, trustScore: number, semantic = 0): number {
  const hopScore = 1 / (1 + Math.max(0, hops));
  const score = hopScore * 0.55 + graphScore * 0.2 + trustScore * 0.15 + semantic * 0.1;
  return Number(score.toFixed(4));
}

export function impactResultComparator(
  sortBy: "impact_score" | "shortest_path" | "semantic_score" | "graph_score" | "trust_score"
): (a: Record<string, unknown>, b: Record<string, unknown>) => number {
  return (a, b) => {
    const aHops = Number(a.hops ?? Number.POSITIVE_INFINITY);
    const bHops = Number(b.hops ?? Number.POSITIVE_INFINITY);
    const aImpact = Number(a.impact_score ?? 0);
    const bImpact = Number(b.impact_score ?? 0);
    const aSemantic = Number(a.semantic_score ?? 0);
    const bSemantic = Number(b.semantic_score ?? 0);
    const aGraph = Number(a.graph_score ?? 0);
    const bGraph = Number(b.graph_score ?? 0);
    const aTrust = Number(a.trust_score ?? 0);
    const bTrust = Number(b.trust_score ?? 0);

    if (sortBy === "shortest_path") {
      return aHops - bHops || bImpact - aImpact || bSemantic - aSemantic;
    }
    if (sortBy === "semantic_score") {
      return bSemantic - aSemantic || bImpact - aImpact || aHops - bHops;
    }
    if (sortBy === "graph_score") {
      return bGraph - aGraph || bImpact - aImpact || aHops - bHops;
    }
    if (sortBy === "trust_score") {
      return bTrust - aTrust || bImpact - aImpact || aHops - bHops;
    }
    return bImpact - aImpact || aHops - bHops || bSemantic - aSemantic;
  };
}

export function impactDomainsForEntity(
  entity: SearchEntity | undefined,
  catalogEntry: JsonObject | undefined
): string[] {
  const domains = new Set<string>();
  const normalizedKind = normalizeText(entity?.kind ?? "");
  const normalizedType = normalizeText(entity?.entity_type ?? String(catalogEntry?.type ?? ""));
  const pathValue = String(entity?.path ?? catalogEntry?.path ?? "");

  if (SQL_ENTITY_KINDS.has(normalizedKind) || pathHasExtension(pathValue, SQL_LIKE_EXTENSIONS)) {
    domains.add("sql");
  }

  if (
    normalizedKind === "connection_string" ||
    normalizedKind === "database_target" ||
    normalizedKind === "app_setting" ||
    pathHasExtension(pathValue, CONFIG_LIKE_EXTENSIONS)
  ) {
    domains.add("config");
  }

  if (normalizedKind === "resource_entry" || pathHasExtension(pathValue, RESOURCE_LIKE_EXTENSIONS)) {
    domains.add("resource");
    domains.add("config");
  }

  if (normalizedKind === "setting_entry" || pathHasExtension(pathValue, SETTINGS_LIKE_EXTENSIONS)) {
    domains.add("settings");
    domains.add("config");
  }

  if (normalizedType === "project") {
    domains.add("project");
  }

  if (
    !domains.has("sql") &&
    !domains.has("config") &&
    !domains.has("resource") &&
    !domains.has("settings") &&
    (normalizedType === "file" || normalizedType === "chunk" || normalizedType === "module")
  ) {
    domains.add("code");
  }

  return [...domains];
}

export function impactProfileBoost(
  profile: "all" | "config_only" | "config_to_sql" | "code_only" | "sql_only",
  domains: string[],
  pathEdges: JsonObject[]
): number {
  const relationTypes = new Set(pathEdges.map((edge) => String(edge.relation ?? "")));
  const hasSqlPath = relationTypes.has("CALLS_SQL");
  const hasConfigKeyPath =
    relationTypes.has("USES_CONFIG_KEY") ||
    relationTypes.has("USES_RESOURCE_KEY") ||
    relationTypes.has("USES_SETTING_KEY") ||
    relationTypes.has("USES_CONFIG");

  let boost = 0;

  if (profile === "config_to_sql") {
    if (domains.includes("sql")) {
      boost += 0.18;
    }
    if (domains.includes("config")) {
      boost += 0.04;
    }
    if (hasSqlPath) {
      boost += 0.08;
    }
    if (hasConfigKeyPath && hasSqlPath) {
      boost += 0.08;
    }
  } else if (profile === "config_only") {
    if (domains.includes("config")) {
      boost += 0.08;
    }
    if (!hasSqlPath && !relationTypes.has("CALLS")) {
      boost += 0.04;
    }
  } else if (profile === "sql_only") {
    if (domains.includes("sql")) {
      boost += 0.14;
    }
    if (hasSqlPath) {
      boost += 0.08;
    }
  } else if (profile === "code_only") {
    if (domains.includes("code")) {
      boost += 0.08;
    }
    if (relationTypes.has("CALLS") || relationTypes.has("IMPORTS")) {
      boost += 0.05;
    }
  } else if (domains.includes("sql") && hasSqlPath) {
    boost += 0.04;
  }

  return Number(boost.toFixed(4));
}

export function impactNoteScore(
  queryTokens: string[],
  queryPhrase: string,
  pathEdges: JsonObject[],
  semanticScorer: (queryTokens: string[], queryPhrase: string, text: string) => number
): number {
  if (pathEdges.length === 0 || (queryTokens.length === 0 && !queryPhrase)) {
    return 0;
  }

  const noteText = pathEdges
    .map((edge) => String(edge.note ?? "").trim())
    .filter(Boolean)
    .join("\n");
  if (!noteText) {
    return 0;
  }

  return Number(semanticScorer(queryTokens, queryPhrase, noteText).toFixed(4));
}
