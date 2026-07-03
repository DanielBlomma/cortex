import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchResults, buildSearchResultsWithStats } from "../dist/searchResults.js";
import { expandQueryTokens, semanticScore, structuralSearchBoost, tokenize } from "../dist/searchCore.js";

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

test("tokenization exposes camel-case code identifiers for lexical matching", () => {
  const tokens = tokenize("buildSearchResults parseRankingFromConfig parseJavaScriptCode parseCSharpParser C# VB.NET");

  assert.ok(tokens.includes("build"));
  assert.ok(tokens.includes("search"));
  assert.ok(tokens.includes("results"));
  assert.ok(tokens.includes("parse"));
  assert.ok(tokens.includes("ranking"));
  assert.ok(tokens.includes("config"));
  assert.ok(tokens.includes("javascript"));
  assert.ok(tokens.includes("csharp"));
  assert.ok(tokens.includes("vbnet"));
  assert.equal(tokens.includes("java"), false);
});

test("query aliases do not dilute lexical semantic scoring", () => {
  assert.equal(semanticScore(expandQueryTokens(["dashboard"]), "", "status"), 0.85);
  assert.equal(semanticScore(expandQueryTokens(["import"]), "", "imports"), 0.85);
});

test("structural search boost favors matching path and symbol fields", () => {
  const query = "How does the JavaScript and TypeScript parser collect calls and imports?";
  const queryTokens = expandQueryTokens(Array.from(new Set(tokenize(query))));
  const jsImports = makeEntity("js-imports", "Chunk", {
    label: "collectImports",
    path: "scaffold/scripts/parsers/javascript/imports.mjs"
  });
  const cppParser = makeEntity("cpp-parser", "Chunk", {
    label: "parseCode",
    path: "scaffold/scripts/parsers/cpp-treesitter.mjs"
  });
  const csharpParser = makeEntity("csharp-parser", "Chunk", {
    label: "CSharpParser",
    path: "scaffold/scripts/parsers/dotnet/CSharpParser/Program.cs"
  });

  assert.ok(
    structuralSearchBoost(jsImports, queryTokens, query.toLowerCase()) >
      structuralSearchBoost(cppParser, queryTokens, query.toLowerCase())
  );
  assert.ok(
    structuralSearchBoost(jsImports, queryTokens, query.toLowerCase()) >
      structuralSearchBoost(csharpParser, queryTokens, query.toLowerCase())
  );
});

test("low-semantic graph hubs cannot outrank strong semantic code matches on secondary signals alone", () => {
  const candidates = [
    makeEntity("hub", "Chunk", {
      text: "broad weak query",
      trust_level: 100
    }),
    makeEntity("leaf", "Chunk", {
      text: "precise strong query",
      trust_level: 10
    })
  ];

  const results = buildSearchResults({
    candidates,
    degreeByEntity: new Map([
      ["hub", 100],
      ["leaf", 0]
    ]),
    queryTokens: ["query"],
    queryPhrase: "query",
    ranking: { semantic: 0.4, graph: 0.25, trust: 0.2, recency: 0.15 },
    includeScores: true,
    includeMatchedRules: false,
    includeContent: false,
    queryVector: null,
    embeddingVectors: new Map(),
    topK: 2,
    minLexicalRelevance: 0,
    minVectorRelevance: 0,
    semanticScorer: (_tokens, _phrase, text) => (text.includes("strong") ? 0.7 : 0.2),
    vectorScorer: () => 0,
    recencyScorer: () => 1,
    structuralSearchBooster: () => 0,
    legacyDataAccessBooster: () => 0
  });

  assert.equal(results[0].id, "leaf");
});

test("diverse top-k selection admits a near-tie from another path", () => {
  const candidates = [
    makeEntity("a1", "Chunk", { path: "src/a.ts", text: "a1 query" }),
    makeEntity("a2", "Chunk", { path: "src/a.ts", text: "a2 query" }),
    makeEntity("a3", "Chunk", { path: "src/a.ts", text: "a3 query" }),
    makeEntity("b1", "Chunk", { path: "src/b.ts", text: "b1 query" })
  ];
  const semanticById = new Map([
    ["a1", 0.9],
    ["a2", 0.89],
    ["a3", 0.88],
    ["b1", 0.86]
  ]);

  const results = buildSearchResults({
    candidates,
    degreeByEntity: new Map(),
    queryTokens: ["query"],
    queryPhrase: "query",
    ranking: { semantic: 1, graph: 0, trust: 0, recency: 0 },
    includeScores: true,
    includeMatchedRules: false,
    includeContent: false,
    queryVector: null,
    embeddingVectors: new Map(),
    topK: 3,
    minLexicalRelevance: 0,
    minVectorRelevance: 0,
    semanticScorer: (_tokens, _phrase, text) => semanticById.get(text.split(" ")[0]) ?? 0,
    vectorScorer: () => 0,
    recencyScorer: () => 0,
    structuralSearchBooster: () => 0,
    legacyDataAccessBooster: () => 0
  });

  assert.deepEqual(results.map((result) => result.id), ["a1", "a2", "b1"]);
  assert.equal(results.some((result) => result.id === "a3"), false);
  assert.deepEqual(results.map((result) => result.score), [0.9, 0.89, 0.86]);
});

test("strong test evidence can outrank a slightly weaker graph hub", () => {
  const candidates = [
    makeEntity("hub", "Chunk", {
      path: "src/hub.ts",
      text: "implementation query",
      trust_level: 50
    }),
    makeEntity("test-evidence", "File", {
      path: "tests/context-regressions.test.mjs",
      text: "regression evidence query",
      trust_level: 50
    })
  ];

  const results = buildSearchResults({
    candidates,
    degreeByEntity: new Map([
      ["hub", 100],
      ["test-evidence", 0]
    ]),
    queryTokens: ["query"],
    queryPhrase: "query",
    ranking: { semantic: 0.4, graph: 0.25, trust: 0.2, recency: 0.15 },
    includeScores: true,
    includeMatchedRules: false,
    includeContent: false,
    queryVector: null,
    embeddingVectors: new Map(),
    topK: 2,
    minLexicalRelevance: 0,
    minVectorRelevance: 0,
    semanticScorer: (_tokens, _phrase, text) => (text.includes("regression") ? 0.5 : 0.49),
    vectorScorer: () => 0,
    recencyScorer: () => 1,
    structuralSearchBooster: () => 0,
    legacyDataAccessBooster: () => 0
  });

  assert.equal(results[0].id, "test-evidence");
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
