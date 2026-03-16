import type { ImpactParams, JsonObject, RelationType, SearchEntity } from "./types.js";

const SQL_ENTITY_KINDS = new Set(["procedure", "view", "function", "table", "trigger"]);
const SQL_LIKE_EXTENSIONS = [".sql"];
const CONFIG_LIKE_EXTENSIONS = [".config"];
const RESOURCE_LIKE_EXTENSIONS = [".resx"];
const SETTINGS_LIKE_EXTENSIONS = [".settings"];
const IMPACT_RELATION_TYPE_LIST: RelationType[] = [
  "CALLS",
  "CALLS_SQL",
  "IMPORTS",
  "USES_CONFIG_KEY",
  "USES_RESOURCE_KEY",
  "USES_SETTING_KEY",
  "USES_CONFIG",
  "TRANSFORMS_CONFIG",
  "PART_OF"
];
const IMPACT_PROFILE_RELATIONS: Record<
  NonNullable<ImpactParams["profile"]>,
  RelationType[]
> = {
  all: IMPACT_RELATION_TYPE_LIST,
  config_only: ["USES_CONFIG_KEY", "USES_RESOURCE_KEY", "USES_SETTING_KEY", "USES_CONFIG", "TRANSFORMS_CONFIG", "PART_OF"],
  config_to_sql: ["USES_CONFIG_KEY", "USES_RESOURCE_KEY", "USES_SETTING_KEY", "USES_CONFIG", "TRANSFORMS_CONFIG", "CALLS_SQL", "PART_OF"],
  code_only: ["CALLS", "IMPORTS", "PART_OF"],
  sql_only: ["CALLS_SQL", "PART_OF"]
};

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

export function resolveImpactRelationTypes(parsed: ImpactParams): Set<RelationType> {
  if (Array.isArray(parsed.relation_types) && parsed.relation_types.length > 0) {
    return new Set(parsed.relation_types);
  }

  const profile = parsed.profile ?? "all";
  return new Set(IMPACT_PROFILE_RELATIONS[profile]);
}

export function resolveImpactResultDomains(parsed: ImpactParams): Set<string> | null {
  if (!Array.isArray(parsed.result_domains) || parsed.result_domains.length === 0) {
    return null;
  }
  return new Set(parsed.result_domains.map((domain) => normalizeText(domain)));
}

export function resolveImpactResultEntityTypes(parsed: ImpactParams): Set<string> | null {
  if (!Array.isArray(parsed.result_entity_types) || parsed.result_entity_types.length === 0) {
    return null;
  }
  return new Set(parsed.result_entity_types.map((entityType) => normalizeText(entityType)));
}

export function resolveImpactPathMustInclude(parsed: ImpactParams): Set<string> | null {
  if (!Array.isArray(parsed.path_must_include) || parsed.path_must_include.length === 0) {
    return null;
  }
  return new Set(parsed.path_must_include.map((relation) => normalizeText(relation)));
}

export function resolveImpactPathMustExclude(parsed: ImpactParams): Set<string> | null {
  if (!Array.isArray(parsed.path_must_exclude) || parsed.path_must_exclude.length === 0) {
    return null;
  }
  return new Set(parsed.path_must_exclude.map((relation) => normalizeText(relation)));
}

export function impactResultComparator(
  sortBy: NonNullable<ImpactParams["sort_by"]>
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
  profile: NonNullable<ImpactParams["profile"]>,
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
