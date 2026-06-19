import type { RankingWeights, SearchEntity } from "./types.js";

type SearchResult = Record<string, unknown>;

type RankedSearchResult = {
  result: SearchResult;
  rankScore: number;
};

type SearchCandidateSource = Iterable<SearchEntity> | (() => Iterable<SearchEntity>);

type BaseChunkMetadata = {
  label: string;
  path: string;
};

function isWindowChunkId(id: string): boolean {
  return id.includes(":window:");
}

function baseChunkId(id: string): string {
  const markerIndex = id.indexOf(":window:");
  return markerIndex === -1 ? id : id.slice(0, markerIndex);
}

function baseChunkLabel(label: string): string {
  const markerIndex = label.indexOf("#window");
  return markerIndex === -1 ? label : label.slice(0, markerIndex);
}

function pruneRankedResults(bestById: Map<string, RankedSearchResult>, limit: number): void {
  if (bestById.size <= limit) {
    return;
  }

  const retained = [...bestById.entries()]
    .sort(([, a], [, b]) => b.rankScore - a.rankScore)
    .slice(0, limit);
  bestById.clear();
  for (const [id, result] of retained) {
    bestById.set(id, result);
  }
}

function candidatesFrom(source: SearchCandidateSource): Iterable<SearchEntity> {
  return typeof source === "function" ? source() : source;
}

export function buildSearchResultsWithStats(params: {
  candidates: SearchCandidateSource;
  degreeByEntity: Map<string, number>;
  queryTokens: string[];
  queryPhrase: string;
  ranking: RankingWeights;
  includeScores: boolean;
  includeMatchedRules: boolean;
  includeContent: boolean;
  queryVector: Float32Array | null;
  embeddingVectors: Map<string, Float32Array>;
  topK: number;
  minLexicalRelevance: number;
  minVectorRelevance: number;
  semanticScorer: (queryTokens: string[], queryPhrase: string, text: string) => number;
  vectorScorer: (a: Float32Array, b: Float32Array) => number;
  recencyScorer: (isoDate: string) => number;
  legacyDataAccessBooster: (entity: SearchEntity, queryTokens: string[], queryPhrase: string) => number;
}): { results: Record<string, unknown>[]; totalCandidates: number } {
  if (params.topK <= 0) {
    return { results: [], totalCandidates: 0 };
  }

  // Graph score = midrank percentile of relation degree within the entity's
  // own type. The previous min(1, degree/4) saturated at degree >= 4, which
  // nearly every entity exceeds, making the graph weight a constant. Per-type
  // percentiles discriminate by connectivity while staying type-neutral
  // (every type averages ~0.5), so hub-heavy types like rules cannot drown
  // out leaf code files or doc sections.
  const sortedDegreesByType = new Map<string, number[]>();
  const chunkCandidatesById = new Map<string, BaseChunkMetadata>();
  let totalCandidates = 0;
  for (const entity of candidatesFrom(params.candidates)) {
    totalCandidates += 1;
    const degree = params.degreeByEntity.get(entity.id) ?? 0;
    const list = sortedDegreesByType.get(entity.entity_type);
    if (list) {
      list.push(degree);
    } else {
      sortedDegreesByType.set(entity.entity_type, [degree]);
    }

    if (entity.entity_type === "Chunk" && !isWindowChunkId(entity.id)) {
      chunkCandidatesById.set(entity.id, {
        label: entity.label,
        path: entity.path
      });
    }
  }
  for (const list of sortedDegreesByType.values()) {
    list.sort((a, b) => a - b);
  }
  const midrankPercentile = (sorted: number[], value: number): number => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    let upper = lo;
    while (upper < sorted.length && sorted[upper] === value) upper += 1;
    return sorted.length > 0 ? (lo + upper) / (2 * sorted.length) : 0;
  };

  const resultLimit = Math.max(1, params.topK);
  const pruneThreshold = Math.max(resultLimit * 4, 64);
  const bestById = new Map<string, RankedSearchResult>();

  for (const entity of candidatesFrom(params.candidates)) {
    const lexicalSemantic = params.semanticScorer(params.queryTokens, params.queryPhrase, entity.text);
    const entityVector = params.embeddingVectors.get(entity.id);
    const vectorSemantic =
      params.queryVector && entityVector
        ? Math.max(0, Math.min(1, params.vectorScorer(params.queryVector, entityVector)))
        : 0;
    const hasRelevanceSignal =
      lexicalSemantic >= params.minLexicalRelevance || vectorSemantic >= params.minVectorRelevance;
    if (!hasRelevanceSignal) {
      continue;
    }

    const semantic =
      vectorSemantic > 0 ? vectorSemantic * 0.75 + lexicalSemantic * 0.25 : lexicalSemantic;
    const degree = params.degreeByEntity.get(entity.id) ?? 0;
    const graphScore = midrankPercentile(sortedDegreesByType.get(entity.entity_type) ?? [], degree);
    const trustScore = Math.max(0, Math.min(1, entity.trust_level / 100));
    const dateScore = params.recencyScorer(entity.updated_at);

    let score = 0;
    score += params.ranking.semantic * semantic;
    score += params.ranking.graph * graphScore;
    score += params.ranking.trust * trustScore;
    score += params.ranking.recency * dateScore;
    score += params.legacyDataAccessBooster(entity, params.queryTokens, params.queryPhrase);

    if (entity.source_of_truth) {
      score += 0.1 * semantic;
    }

    const result: SearchResult = {
      id: entity.id,
      entity_type: entity.entity_type,
      kind: entity.kind,
      title: entity.label,
      path: entity.path || undefined,
      source_of_truth: entity.source_of_truth,
      status: entity.status,
      updated_at: entity.updated_at,
      excerpt: entity.snippet,
      ...(params.includeScores
        ? {
            score: Number(score.toFixed(4)),
            semantic_score: Number(semantic.toFixed(4)),
            embedding_score: Number(vectorSemantic.toFixed(4)),
            lexical_score: Number(lexicalSemantic.toFixed(4)),
            graph_score: Number(graphScore.toFixed(4))
          }
        : {}),
      ...(params.includeMatchedRules
        ? {
            matched_rules: entity.matched_rules
          }
        : {}),
      ...(params.includeContent
        ? {
            content: entity.content
          }
        : {})
    };

    if (entity.entity_type === "Chunk" && isWindowChunkId(entity.id)) {
      const canonicalId = baseChunkId(entity.id);
      const baseChunk = chunkCandidatesById.get(canonicalId);
      if (baseChunk) {
        result.id = canonicalId;
        result.title = baseChunkLabel(baseChunk.label);
        result.path = baseChunk.path || undefined;
      }
    }

    const resultId = String(result.id);
    const existing = bestById.get(resultId);
    if (!existing || score > existing.rankScore) {
      bestById.set(resultId, { result, rankScore: score });
    }

    if (bestById.size > pruneThreshold) {
      pruneRankedResults(bestById, resultLimit);
    }
  }

  const results = [...bestById.values()]
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, params.topK)
    .map((ranked) => ranked.result);
  return { results, totalCandidates };
}

export function buildSearchResults(params: Parameters<typeof buildSearchResultsWithStats>[0]): Record<string, unknown>[] {
  return buildSearchResultsWithStats(params).results;
}
