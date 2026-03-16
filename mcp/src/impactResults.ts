import {
  buildCompactImpactSummary,
  buildImpactPath,
  buildImpactTopReasons,
  buildImpactWhy
} from "./impactPresentation.js";
import type { ImpactTraversalStep } from "./impactPresentation.js";
import {
  impactBaseScore,
  impactDomainsForEntity,
  impactNoteScore,
  impactProfileBoost,
  impactResultComparator
} from "./impactRanking.js";
import type { ImpactParams, JsonObject, SearchEntity } from "./types.js";

function normalizeText(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function matchesImpactFilters(
  result: Record<string, unknown>,
  resultDomains: Set<string> | null,
  resultEntityTypes: Set<string> | null,
  pathMustInclude: Set<string> | null,
  pathMustExclude: Set<string> | null
): boolean {
  const pathRelationTypes = new Set(
    ((result.path_relation_types as string[] | undefined) ?? []).map((relation) => normalizeText(String(relation)))
  );
  if (pathMustInclude && pathMustInclude.size > 0) {
    for (const requiredRelation of pathMustInclude) {
      if (!pathRelationTypes.has(requiredRelation)) {
        return false;
      }
    }
  }
  if (pathMustExclude && pathMustExclude.size > 0) {
    for (const blockedRelation of pathMustExclude) {
      if (pathRelationTypes.has(blockedRelation)) {
        return false;
      }
    }
  }
  if (!resultDomains || resultDomains.size === 0) {
    return !resultEntityTypes || resultEntityTypes.has(normalizeText(String(result.entity_type ?? "")));
  }
  const impactDomains = Array.isArray(result.impact_domains) ? result.impact_domains : [];
  const matchesDomain = impactDomains.some((domain) => resultDomains.has(normalizeText(String(domain))));
  if (!matchesDomain) {
    return false;
  }
  return !resultEntityTypes || resultEntityTypes.has(normalizeText(String(result.entity_type ?? "")));
}

export function buildImpactResults(params: {
  visited: Map<string, ImpactTraversalStep>;
  seedId: string;
  catalog: Map<string, JsonObject>;
  searchEntities: Map<string, SearchEntity>;
  degreeByEntity: Map<string, number>;
  queryTokens: string[];
  queryPhrase: string;
  hasQuery: boolean;
  profile: NonNullable<ImpactParams["profile"]>;
  includeReasons: boolean;
  includeScores: boolean;
  verbosePaths: boolean;
  maxPathHopsShown: number;
  resultDomains: Set<string> | null;
  resultEntityTypes: Set<string> | null;
  pathMustInclude: Set<string> | null;
  pathMustExclude: Set<string> | null;
  sortBy: NonNullable<ImpactParams["sort_by"]>;
  topK: number;
  semanticScorer: (queryTokens: string[], queryPhrase: string, text: string) => number;
}): Record<string, unknown>[] {
  return [...params.visited.entries()]
    .filter(([id]) => id !== params.seedId)
    .map(([id, metadata]) => {
      const entity = params.searchEntities.get(id);
      const catalogEntry = params.catalog.get(id) ?? {
        id,
        type: "Unknown",
        label: id,
        status: "unknown",
        source_of_truth: false
      };
      const semantic =
        entity && params.hasQuery ? params.semanticScorer(params.queryTokens, params.queryPhrase, entity.text) : 0;
      const graphScore = Math.min(1, (params.degreeByEntity.get(id) ?? 0) / 4);
      const trustScore = entity ? Math.max(0, Math.min(1, entity.trust_level / 100)) : 0.5;
      const impactPath = buildImpactPath(id, params.seedId, params.visited, params.catalog, params.searchEntities);
      const impactDomains = impactDomainsForEntity(entity, catalogEntry);
      const profileScore = impactProfileBoost(params.profile, impactDomains, impactPath.edges);
      const noteScore = impactNoteScore(
        params.queryTokens,
        params.queryPhrase,
        impactPath.edges,
        params.semanticScorer
      );
      const impactScore = Number(
        (impactBaseScore(metadata.hops, graphScore, trustScore, semantic) + profileScore + noteScore * 0.12).toFixed(4)
      );
      const topReasons = buildImpactTopReasons({
        hops: metadata.hops,
        profile: params.profile,
        semanticScore: semantic,
        noteScore,
        profileScore,
        impactDomains,
        pathEdges: impactPath.edges
      });

      return {
        id,
        entity_type: entity?.entity_type ?? String(catalogEntry.type ?? "Unknown"),
        kind: entity?.kind ?? "",
        title: entity?.label ?? String(catalogEntry.label ?? id),
        path: entity?.path || catalogEntry.path || undefined,
        hops: metadata.hops,
        via_relation: metadata.via_relation,
        direction: metadata.direction,
        via_entity: metadata.via_entity,
        impact_domains: impactDomains,
        why: buildImpactWhy(params.seedId, id, impactPath.edges, metadata.hops, params.catalog, params.searchEntities),
        path_summary: impactPath.summary,
        path_summary_compact: buildCompactImpactSummary(
          impactPath.entities,
          impactPath.edges,
          params.catalog,
          params.searchEntities,
          params.maxPathHopsShown
        ),
        path_relation_types: impactPath.edges.map((edge) => String(edge.relation ?? "")),
        excerpt: entity?.snippet ?? "",
        status: entity?.status ?? String(catalogEntry.status ?? "unknown"),
        source_of_truth: entity?.source_of_truth ?? Boolean(catalogEntry.source_of_truth),
        ...(params.includeReasons
          ? {
              top_reasons: topReasons
            }
          : {}),
        ...(params.includeScores
          ? {
              impact_score: impactScore,
              profile_score: profileScore,
              note_score: noteScore,
              semantic_score: Number(semantic.toFixed(4)),
              graph_score: Number(graphScore.toFixed(4)),
              trust_score: Number(trustScore.toFixed(4))
            }
          : {}),
        ...(params.verbosePaths
          ? {
              path_entities: impactPath.entities,
              path_edges: impactPath.edges
            }
          : {})
      };
    })
    .filter((result) =>
      matchesImpactFilters(
        result,
        params.resultDomains,
        params.resultEntityTypes,
        params.pathMustInclude,
        params.pathMustExclude
      )
    )
    .sort(impactResultComparator(params.sortBy))
    .slice(0, params.topK);
}
