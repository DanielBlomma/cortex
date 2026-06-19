import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchResults, buildSearchResultsWithStats } from "../dist/searchResults.js";

function makeEntity(id, entityType, overrides = {}) {
  return {
    id,
    entity_type: entityType,
    kind: entityType === "Chunk" ? "function" : "DOC",
    label: id,
    path: `src/${id}.ts`,
    text: `text for ${id}`,
    status: "active",
    source_of_truth: false,
    trust_level: 50,
    updated_at: "2026-01-01T00:00:00Z",
    snippet: "",
    matched_rules: [],
    ...overrides
  };
}

function runSearch(candidates, degrees) {
  return buildSearchResults({
    candidates,
    degreeByEntity: new Map(degrees),
    queryTokens: ["query"],
    queryPhrase: "query",
    ranking: { semantic: 0.55, graph: 0.1, trust: 0.2, recency: 0.15 },
    includeScores: true,
    includeMatchedRules: false,
    includeContent: false,
    queryVector: null,
    embeddingVectors: new Map(),
    topK: 100,
    minLexicalRelevance: 0,
    minVectorRelevance: 0,
    semanticScorer: () => 0.5,
    vectorScorer: () => 0,
    recencyScorer: () => 0,
    legacyDataAccessBooster: () => 0
  });
}

function graphScoreById(results) {
  return new Map(results.map((result) => [result.id, result.graph_score]));
}

test("graph score gives midrank to ties: a mass of degree-1 chunks lands at 0.5", () => {
  const candidates = [1, 2, 3, 4].map((n) => makeEntity(`chunk-${n}`, "Chunk"));
  const degrees = candidates.map((entity) => [entity.id, 1]);

  const scores = graphScoreById(runSearch(candidates, degrees));

  for (const entity of candidates) {
    assert.equal(scores.get(entity.id), 0.5);
  }
});

test("graph score for a single-entity type is 0.5", () => {
  const candidates = [makeEntity("only-file", "File")];

  const scores = graphScoreById(runSearch(candidates, [["only-file", 7]]));

  assert.equal(scores.get("only-file"), 0.5);
});

test("graph score is monotonic in degree within a type", () => {
  const candidates = [
    makeEntity("low", "Chunk"),
    makeEntity("mid", "Chunk"),
    makeEntity("high", "Chunk"),
    makeEntity("top", "Chunk")
  ];
  const degrees = [
    ["low", 0],
    ["mid", 2],
    ["high", 5],
    ["top", 9]
  ];

  const scores = graphScoreById(runSearch(candidates, degrees));

  assert.ok(scores.get("low") < scores.get("mid"));
  assert.ok(scores.get("mid") < scores.get("high"));
  assert.ok(scores.get("high") < scores.get("top"));
});

test("graph score percentiles are isolated per type: hub types cannot drown out leaf code", () => {
  const chunks = [
    makeEntity("leaf-a", "Chunk"),
    makeEntity("leaf-b", "Chunk")
  ];
  const hubRules = [
    makeEntity("rule-hub-1", "Rule", { trust_level: 95 }),
    makeEntity("rule-hub-2", "Rule", { trust_level: 95 })
  ];
  const degrees = [
    ["leaf-a", 1],
    ["leaf-b", 3],
    ["rule-hub-1", 200],
    ["rule-hub-2", 400]
  ];

  const scores = graphScoreById(runSearch([...chunks, ...hubRules], degrees));

  // Chunk percentiles are computed against chunks only: degree 1 is the lower
  // half and degree 3 the upper half, despite rule degrees being 100x larger.
  assert.equal(scores.get("leaf-a"), 0.25);
  assert.equal(scores.get("leaf-b"), 0.75);
  assert.equal(scores.get("rule-hub-1"), 0.25);
  assert.equal(scores.get("rule-hub-2"), 0.75);
});

test("graph score never saturates to a shared constant for common degrees", () => {
  // The old min(1, degree/4) mapped every degree >= 4 to 1.0.
  const candidates = [
    makeEntity("deg-4", "Chunk"),
    makeEntity("deg-8", "Chunk"),
    makeEntity("deg-40", "Chunk")
  ];
  const degrees = [
    ["deg-4", 4],
    ["deg-8", 8],
    ["deg-40", 40]
  ];

  const scores = graphScoreById(runSearch(candidates, degrees));
  const unique = new Set(scores.values());

  assert.equal(unique.size, 3);
});

test("ranking is preserved when score fields are omitted from the response", () => {
  const candidates = [
    makeEntity("weak", "Chunk", { text: "weak query" }),
    makeEntity("strong", "Chunk", { text: "strong query" }),
    makeEntity("middle", "Chunk", { text: "middle query" })
  ];

  const results = buildSearchResults({
    candidates,
    degreeByEntity: new Map(),
    queryTokens: ["query"],
    queryPhrase: "query",
    ranking: { semantic: 1, graph: 0, trust: 0, recency: 0 },
    includeScores: false,
    includeMatchedRules: false,
    includeContent: false,
    queryVector: null,
    embeddingVectors: new Map(),
    topK: 2,
    minLexicalRelevance: 0,
    minVectorRelevance: 0,
    semanticScorer: (_tokens, _phrase, text) => {
      if (text.includes("strong")) return 0.9;
      if (text.includes("middle")) return 0.5;
      return 0.1;
    },
    vectorScorer: () => 0,
    recencyScorer: () => 0,
    legacyDataAccessBooster: () => 0
  });

  assert.deepEqual(results.map((result) => result.id), ["strong", "middle"]);
  assert.equal("score" in results[0], false);
});

test("search results can consume a repeatable candidate generator with stats", () => {
  let passes = 0;
  const candidateSource = function* () {
    passes += 1;
    yield makeEntity("weak", "Chunk", { text: "weak query" });
    yield makeEntity("strong", "Chunk", { text: "strong query" });
    yield makeEntity("middle", "Chunk", { text: "middle query" });
  };

  const { results, totalCandidates } = buildSearchResultsWithStats({
    candidates: candidateSource,
    degreeByEntity: new Map(),
    queryTokens: ["query"],
    queryPhrase: "query",
    ranking: { semantic: 1, graph: 0, trust: 0, recency: 0 },
    includeScores: false,
    includeMatchedRules: false,
    includeContent: false,
    queryVector: null,
    embeddingVectors: new Map(),
    topK: 2,
    minLexicalRelevance: 0,
    minVectorRelevance: 0,
    semanticScorer: (_tokens, _phrase, text) => {
      if (text.includes("strong")) return 0.9;
      if (text.includes("middle")) return 0.5;
      return 0.1;
    },
    vectorScorer: () => 0,
    recencyScorer: () => 0,
    legacyDataAccessBooster: () => 0
  });

  assert.equal(passes, 2);
  assert.equal(totalCandidates, 3);
  assert.deepEqual(results.map((result) => result.id), ["strong", "middle"]);
});
