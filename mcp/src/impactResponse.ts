import type { ImpactParams, RelationType, ToolPayload } from "./types.js";

export function buildImpactResponseMeta(params: {
  parsed: ImpactParams;
  responsePreset: "full" | "compact" | "minimal";
  includeScores: boolean;
  includeReasons: boolean;
  verbosePaths: boolean;
  maxPathHopsShown: number;
  profile: NonNullable<ImpactParams["profile"]>;
  sortBy: NonNullable<ImpactParams["sort_by"]>;
  allowedRelationTypes: Set<RelationType>;
  contextSource: string;
}): ToolPayload {
  return {
    entity_id: params.parsed.entity_id,
    query: params.parsed.query,
    depth: params.parsed.depth,
    top_k: params.parsed.top_k,
    response_preset: params.responsePreset,
    include_scores: params.includeScores,
    include_reasons: params.includeReasons,
    verbose_paths: params.verbosePaths,
    max_path_hops_shown: params.maxPathHopsShown,
    profile: params.profile,
    sort_by: params.sortBy,
    relation_types: [...params.allowedRelationTypes],
    path_must_include: params.parsed.path_must_include ?? [],
    path_must_exclude: params.parsed.path_must_exclude ?? [],
    result_domains: params.parsed.result_domains ?? [],
    result_entity_types: params.parsed.result_entity_types ?? [],
    context_source: params.contextSource
  };
}

export function buildEmptyImpactResponse(params: {
  meta: ToolPayload;
  warning: string;
}): ToolPayload {
  return {
    ...params.meta,
    warning: params.warning,
    seed: null,
    results: [],
    edges: []
  };
}
