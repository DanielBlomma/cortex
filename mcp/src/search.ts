import { embedQuery, getEmbeddingRuntimeWarning, loadEmbeddingIndex } from "./embeddings.js";
import {
  buildChunkPartOfRelations,
  buildEntitySearchMap,
  buildSearchEntities,
  entityCatalog
} from "./contextEntities.js";
import { relationDegree } from "./graphMetrics.js";
import { loadContextData } from "./graph.js";
import { buildEmptyImpactResponse, buildImpactResponseMeta } from "./impactResponse.js";
import { buildImpactResults } from "./impactResults.js";
import { resolveImpactSeed } from "./impactSeed.js";
import {
  cosineSimilarity,
  expandQueryTokens,
  legacyDataAccessBoost,
  normalizeText,
  recencyScore,
  semanticScore,
  tokenize
} from "./searchCore.js";
import { buildSearchResults } from "./searchResults.js";
import { traverseImpactGraph } from "./impactTraversal.js";
import { buildEmptyRelatedResponse, buildRelatedResponseMeta } from "./relatedResponse.js";
import { traverseRelatedGraph } from "./relatedTraversal.js";
import {
  resolveImpactPathMustExclude,
  resolveImpactPathMustInclude,
  resolveImpactRelationTypes,
  resolveImpactResultDomains,
  resolveImpactResultEntityTypes
} from "./impactRanking.js";
import {
  resolveImpactResponsePreset,
  resolveRelatedResponsePreset,
  resolveSearchResponsePreset
} from "./presets.js";
import type {
  ImpactParams,
  RelatedParams,
  RelationType,
  SearchParams,
  ToolPayload
} from "./types.js";

const MIN_LEXICAL_RELEVANCE = 0.05;
const MIN_VECTOR_RELEVANCE = 0.2;
const IMPACT_RELATION_TYPES = new Set([
  "CALLS",
  "CALLS_SQL",
  "IMPORTS",
  "USES_CONFIG_KEY",
  "USES_RESOURCE_KEY",
  "USES_SETTING_KEY",
  "USES_CONFIG",
  "TRANSFORMS_CONFIG",
  "PART_OF"
]);

export async function runContextSearch(parsed: SearchParams): Promise<ToolPayload> {
  const searchPresetConfig = resolveSearchResponsePreset(parsed);
  const responsePreset = searchPresetConfig.responsePreset;
  const includeScores = searchPresetConfig.includeScores;
  const includeMatchedRules = searchPresetConfig.includeMatchedRules;
  const includeContent = searchPresetConfig.includeContent;
  const data = await loadContextData();
  const allRelations = [...data.relations, ...buildChunkPartOfRelations(data)];
  const degreeByEntity = relationDegree(allRelations);
  const queryTokens = expandQueryTokens(Array.from(new Set(tokenize(parsed.query))));
  const queryPhrase = normalizeText(parsed.query).trim();
  const candidates = buildSearchEntities(data, includeContent).filter(
    (entity) => parsed.include_deprecated || entity.status.toLowerCase() !== "deprecated"
  );
  const embeddings = loadEmbeddingIndex();
  const queryVector =
    embeddings.model && embeddings.vectors.size > 0
      ? await embedQuery(parsed.query, embeddings.model)
      : null;

  const results = buildSearchResults({
    candidates,
    degreeByEntity,
    queryTokens,
    queryPhrase,
    ranking: data.ranking,
    includeScores,
    includeMatchedRules,
    includeContent,
    queryVector,
    embeddingVectors: embeddings.vectors,
    topK: parsed.top_k,
    minLexicalRelevance: MIN_LEXICAL_RELEVANCE,
    minVectorRelevance: MIN_VECTOR_RELEVANCE,
    semanticScorer: semanticScore,
    vectorScorer: cosineSimilarity,
    recencyScorer: recencyScore,
    legacyDataAccessBooster: legacyDataAccessBoost
  });

  const warningMessages = [data.warning, embeddings.warning, getEmbeddingRuntimeWarning()].filter(Boolean);

  return {
    query: parsed.query,
    top_k: parsed.top_k,
    response_preset: responsePreset,
    include_scores: includeScores,
    include_matched_rules: includeMatchedRules,
    include_content: includeContent,
    ranking: data.ranking,
    total_candidates: candidates.length,
    context_source: data.source,
    warning: warningMessages.length > 0 ? warningMessages.join(" | ") : undefined,
    semantic_engine:
      queryVector && embeddings.model ? `embedding+lexical (${embeddings.model})` : "lexical-only",
    results
  };
}

export async function runContextRelated(parsed: RelatedParams): Promise<ToolPayload> {
  const relatedPresetConfig = resolveRelatedResponsePreset(parsed);
  const responsePreset = relatedPresetConfig.responsePreset;
  const includeEdges = relatedPresetConfig.includeEdges;
  const includeEntityMetadata = relatedPresetConfig.includeEntityMetadata;
  const data = await loadContextData();
  const catalog = entityCatalog(data);
  const relations = [...data.relations, ...buildChunkPartOfRelations(data)];
  const relatedResponseMeta = buildRelatedResponseMeta({
    parsed,
    responsePreset,
    includeEdges,
    includeEntityMetadata,
    contextSource: data.source
  });

  if (!catalog.has(parsed.entity_id)) {
    return buildEmptyRelatedResponse({
      meta: relatedResponseMeta,
      warning: "Entity not found in indexed context."
    });
  }

  const { related, traversedEdges } = traverseRelatedGraph({
    entityId: parsed.entity_id,
    relations,
    depth: parsed.depth,
    catalog,
    includeEntityMetadata
  });

  return {
    ...relatedResponseMeta,
    warning: data.warning,
    related,
    edges: includeEdges ? traversedEdges : []
  };
}

export async function runContextImpact(parsed: ImpactParams): Promise<ToolPayload> {
  const data = await loadContextData();
  const catalog = entityCatalog(data);
  const relations = [...data.relations, ...buildChunkPartOfRelations(data)];
  const allowedRelationTypes = resolveImpactRelationTypes(parsed);
  const impactRelations = relations.filter((relation) => allowedRelationTypes.has(relation.relation));
  const searchEntities = buildEntitySearchMap(data);
  const degreeByEntity = relationDegree(relations);
  const profile = parsed.profile ?? "all";
  const sortBy = parsed.sort_by ?? "impact_score";
  const responsePresetConfig = resolveImpactResponsePreset(parsed);
  const responsePreset = responsePresetConfig.responsePreset;
  const includeScores = responsePresetConfig.includeScores;
  const includeReasons = responsePresetConfig.includeReasons;
  const verbosePaths = responsePresetConfig.verbosePaths;
  const maxPathHopsShown = responsePresetConfig.maxPathHopsShown;
  const resultDomains = resolveImpactResultDomains(parsed);
  const resultEntityTypes = resolveImpactResultEntityTypes(parsed);
  const pathMustInclude = resolveImpactPathMustInclude(parsed);
  const pathMustExclude = resolveImpactPathMustExclude(parsed);
  const seedResolution = await resolveImpactSeed(parsed, runContextSearch);
  const seedId = seedResolution.id;
  const impactResponseMeta = buildImpactResponseMeta({
    parsed,
    responsePreset,
    includeScores,
    includeReasons,
    verbosePaths,
    maxPathHopsShown,
    profile,
    sortBy,
    allowedRelationTypes,
    contextSource: data.source
  });

  if (!seedId) {
    return buildEmptyImpactResponse({
      meta: impactResponseMeta,
      warning: seedResolution.warning ?? "No matching seed entity found for impact analysis."
    });
  }

  if (!catalog.has(seedId)) {
    return buildEmptyImpactResponse({
      meta: impactResponseMeta,
      warning: "Seed entity not found in indexed context."
    });
  }

  const { visited, traversedEdges } = traverseImpactGraph({
    seedId,
    relations: impactRelations,
    depth: parsed.depth
  });
  const queryTokens = parsed.query ? expandQueryTokens(Array.from(new Set(tokenize(parsed.query)))) : [];
  const queryPhrase = parsed.query ? normalizeText(parsed.query).trim() : "";

  const results = buildImpactResults({
    visited,
    seedId,
    catalog,
    searchEntities,
    degreeByEntity,
    queryTokens,
    queryPhrase,
    hasQuery: Boolean(parsed.query),
    profile,
    includeReasons,
    includeScores,
    verbosePaths,
    maxPathHopsShown,
    resultDomains,
    resultEntityTypes,
    pathMustInclude,
    pathMustExclude,
    sortBy,
    topK: parsed.top_k,
    semanticScorer: semanticScore
  });

  return {
    ...impactResponseMeta,
    resolved_seed_id: seedId,
    resolved_from_query: !parsed.entity_id,
    seed: catalog.get(seedId),
    warning: data.warning,
    query_results: seedResolution.query_results,
    results,
    edges: parsed.include_edges && verbosePaths ? traversedEdges : []
  };
}
