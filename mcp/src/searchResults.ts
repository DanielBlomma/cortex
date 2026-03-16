import type { RankingWeights, SearchEntity } from "./types.js";

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

export function buildSearchResults(params: {
  candidates: SearchEntity[];
  degreeByEntity: Map<string, number>;
  queryTokens: string[];
  queryPhrase: string;
  ranking: RankingWeights;
  includeScores: boolean;
  includeMatchedRules: boolean;
  includeContent: boolean;
  queryVector: number[] | null;
  embeddingVectors: Map<string, number[]>;
  topK: number;
  minLexicalRelevance: number;
  minVectorRelevance: number;
  semanticScorer: (queryTokens: string[], queryPhrase: string, text: string) => number;
  vectorScorer: (a: number[], b: number[]) => number;
  recencyScorer: (isoDate: string) => number;
  legacyDataAccessBooster: (entity: SearchEntity, queryTokens: string[], queryPhrase: string) => number;
}): Record<string, unknown>[] {
  const rawResults = params.candidates
    .map((entity) => {
      const lexicalSemantic = params.semanticScorer(params.queryTokens, params.queryPhrase, entity.text);
      const entityVector = params.embeddingVectors.get(entity.id);
      const vectorSemantic =
        params.queryVector && entityVector
          ? Math.max(0, Math.min(1, params.vectorScorer(params.queryVector, entityVector)))
          : 0;
      const hasRelevanceSignal =
        lexicalSemantic >= params.minLexicalRelevance || vectorSemantic >= params.minVectorRelevance;
      if (!hasRelevanceSignal) {
        return null;
      }

      const semantic =
        vectorSemantic > 0 ? vectorSemantic * 0.75 + lexicalSemantic * 0.25 : lexicalSemantic;
      const graphScore = Math.min(1, (params.degreeByEntity.get(entity.id) ?? 0) / 4);
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

      return {
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
    })
    .filter((result): result is NonNullable<typeof result> => result !== null)
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));

  const chunkCandidatesById = new Map(
    params.candidates.filter((entity) => entity.entity_type === "Chunk").map((entity) => [entity.id, entity])
  );
  const normalizedById = new Map<string, (typeof rawResults)[number]>();

  for (const result of rawResults) {
    if (result.entity_type !== "Chunk" || !isWindowChunkId(String(result.id))) {
      if (!normalizedById.has(String(result.id))) {
        normalizedById.set(String(result.id), result);
      }
      continue;
    }

    const canonicalId = baseChunkId(String(result.id));
    const baseChunk = chunkCandidatesById.get(canonicalId);
    const normalizedResult = baseChunk
      ? {
          ...result,
          id: canonicalId,
          title: baseChunkLabel(baseChunk.label),
          path: baseChunk.path || undefined
        }
      : result;
    const existing = normalizedById.get(String(normalizedResult.id));
    if (!existing || Number(normalizedResult.score ?? 0) > Number(existing.score ?? 0)) {
      normalizedById.set(String(normalizedResult.id), normalizedResult);
    }
  }

  return [...normalizedById.values()]
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
    .slice(0, params.topK);
}
