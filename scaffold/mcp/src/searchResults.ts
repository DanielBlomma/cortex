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

export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function rankedResultKey(ranked: RankedSearchResult): string {
  return `${String(ranked.result.id ?? "")}\u0000${String(ranked.result.path ?? "")}`;
}

function compareRankedResults(a: RankedSearchResult, b: RankedSearchResult): number {
  return b.rankScore - a.rankScore || compareText(rankedResultKey(a), rankedResultKey(b));
}

function pruneRankedResults(bestById: Map<string, RankedSearchResult>, limit: number): void {
  if (bestById.size <= limit) {
    return;
  }

  const retained = [...bestById.entries()]
    .sort(([, a], [, b]) => compareRankedResults(a, b))
    .slice(0, limit);
  bestById.clear();
  for (const [id, result] of retained) {
    bestById.set(id, result);
  }
}

function secondarySignalScale(semantic: number): number {
  return Math.min(1, 0.15 + Math.max(0, semantic) * 0.85);
}

function isTestEvidenceEntity(entity: SearchEntity): boolean {
  return /(^|\/)(tests?|__tests__)\//u.test(entity.path) || /\.(test|spec)\.[^.]+$/u.test(entity.path);
}

function testEvidenceBoost(entity: SearchEntity, semantic: number, lexicalSemantic: number): number {
  if (!isTestEvidenceEntity(entity)) {
    return 0;
  }
  if (semantic >= 0.5 && lexicalSemantic >= 0.4) {
    return 0.07;
  }
  if (semantic >= 0.4 && lexicalSemantic >= 0.25) {
    return 0.04;
  }
  return 0;
}

function resultPathKey(result: SearchResult): string {
  const path = typeof result.path === "string" ? result.path : "";
  return path || String(result.id ?? "");
}

function selectDiverseResults(rankedResults: RankedSearchResult[], topK: number): RankedSearchResult[] {
  const remaining = rankedResults
    .map((ranked) => ({ ranked }))
    .sort((a, b) => compareRankedResults(a.ranked, b.ranked));
  const selected: RankedSearchResult[] = [];
  const selectedByPath = new Map<string, number>();

  while (selected.length < topK && remaining.length > 0) {
    let bestIndex = 0;
    let bestAdjustedScore = Number.NEGATIVE_INFINITY;
    let bestRankScore = Number.NEGATIVE_INFINITY;
    let bestKey = "";

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index].ranked;
      const pathCount = selectedByPath.get(resultPathKey(candidate.result)) ?? 0;
      const samePathPenalty = pathCount === 0 ? 0 : Math.min(0.12, pathCount * 0.04);
      const adjustedScore = candidate.rankScore - samePathPenalty;
      const candidateKey = rankedResultKey(candidate);
      if (
        adjustedScore > bestAdjustedScore ||
        (adjustedScore === bestAdjustedScore && candidate.rankScore > bestRankScore) ||
        (adjustedScore === bestAdjustedScore && candidate.rankScore === bestRankScore && candidateKey < bestKey)
      ) {
        bestIndex = index;
        bestAdjustedScore = adjustedScore;
        bestRankScore = candidate.rankScore;
        bestKey = candidateKey;
      }
    }

    const [picked] = remaining.splice(bestIndex, 1);
    selected.push(picked.ranked);
    const pathKey = resultPathKey(picked.ranked.result);
    selectedByPath.set(pathKey, (selectedByPath.get(pathKey) ?? 0) + 1);
  }

  return selected;
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
  structuralSearchBooster?: (entity: SearchEntity, queryTokens: string[], queryPhrase: string) => number;
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
  const diversityPoolLimit = Math.max(resultLimit * 3, resultLimit);
  const pruneThreshold = Math.max(diversityPoolLimit * 2, 64);
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
    const structuralBoost = params.structuralSearchBooster?.(entity, params.queryTokens, params.queryPhrase) ?? 0;
    const evidenceBoost = testEvidenceBoost(entity, semantic, lexicalSemantic);
    const secondaryScale = secondarySignalScale(Math.max(semantic, structuralBoost));

    let score = 0;
    score += params.ranking.semantic * semantic;
    score += params.ranking.graph * graphScore * secondaryScale;
    score += params.ranking.trust * trustScore * secondaryScale;
    score += params.ranking.recency * dateScore * secondaryScale;
    score += structuralBoost;
    score += evidenceBoost;
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
      pruneRankedResults(bestById, diversityPoolLimit);
    }
  }

  const rankedResults = [...bestById.values()]
    .sort(compareRankedResults)
    .slice(0, diversityPoolLimit);
  const results = selectDiverseResults(rankedResults, params.topK)
    .sort(compareRankedResults)
    .map((ranked) => ranked.result);
  return { results, totalCandidates };
}

export function buildSearchResults(params: Parameters<typeof buildSearchResultsWithStats>[0]): Record<string, unknown>[] {
  return buildSearchResultsWithStats(params).results;
}
