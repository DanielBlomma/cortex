import test from "node:test";
import assert from "node:assert/strict";

import { ExactVectorBackend } from "../dist/vectorBackend.js";
import { cosineSimilarity } from "../dist/searchCore.js";
import { buildSearchResults } from "../dist/searchResults.js";

function makeRng(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

function makeUnitVector(rng, dim) {
  const out = new Float32Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i += 1) {
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    out[i] = g;
    norm += g * g;
  }
  const inv = 1 / Math.sqrt(norm);
  for (let i = 0; i < dim; i += 1) out[i] *= inv;
  return out;
}

test("ExactVectorBackend reproduces cosineSimilarity exactly", () => {
  const rng = makeRng(11);
  const dim = 128;
  const vectors = new Map();
  for (let i = 0; i < 50; i += 1) {
    vectors.set(`e${i}`, makeUnitVector(rng, dim));
  }
  const backend = ExactVectorBackend.fromVectors(vectors);
  assert.equal(backend.size, 50);
  assert.equal(backend.dim, dim);

  const query = makeUnitVector(rng, dim);
  const score = backend.prepareQuery(query);
  for (const [id, vector] of vectors) {
    const exact = cosineSimilarity(query, vector);
    const got = score(id);
    assert.ok(Math.abs(got - exact) < 1e-5, `${id}: ${got} vs ${exact}`);
  }
  assert.equal(score("missing"), null);
});

test("ExactVectorBackend yields 0 on dimension mismatch, not a prefix score", () => {
  const rng = makeRng(66);
  const vectors = new Map();
  for (let i = 0; i < 10; i += 1) vectors.set(`e${i}`, makeUnitVector(rng, 64));
  const backend = ExactVectorBackend.fromVectors(vectors);
  const wrongDim = makeUnitVector(rng, 32);
  const score = backend.prepareQuery(wrongDim);
  assert.equal(score("e0"), 0, "mismatched-dim query must score 0 for indexed entities");
  assert.equal(score("missing"), null);
});

test("ExactVectorBackend handles a zero query vector", () => {
  const rng = makeRng(77);
  const vectors = new Map([["a", makeUnitVector(rng, 32)]]);
  const backend = ExactVectorBackend.fromVectors(vectors);
  const score = backend.prepareQuery(new Float32Array(32));
  assert.equal(score("a"), 0);
});

test("buildSearchResults uses scoreVectorById when provided", () => {
  const candidates = [
    { id: "near", entity_type: "Chunk", kind: "function", label: "near", path: "src/near.ts", text: "text near", status: "active", source_of_truth: false, trust_level: 50, updated_at: "2026-01-01T00:00:00Z", snippet: "", matched_rules: [] },
    { id: "far", entity_type: "Chunk", kind: "function", label: "far", path: "src/far.ts", text: "text far", status: "active", source_of_truth: false, trust_level: 50, updated_at: "2026-01-01T00:00:00Z", snippet: "", matched_rules: [] }
  ];
  const results = buildSearchResults({
    candidates,
    degreeByEntity: new Map(),
    queryTokens: ["text"],
    queryPhrase: "text",
    ranking: { semantic: 0.55, graph: 0.1, trust: 0.2, recency: 0.15 },
    includeScores: true,
    includeMatchedRules: false,
    includeContent: false,
    scoreVectorById: (id) => (id === "near" ? 0.95 : 0.1),
    topK: 2,
    minLexicalRelevance: 0,
    minVectorRelevance: 0,
    semanticScorer: () => 0.5,
    recencyScorer: () => 0.5,
    legacyDataAccessBooster: () => 0
  });
  assert.equal(results[0].id, "near", "higher vector score should rank first");
  assert.equal(results.find((r) => r.id === "near").embedding_score, 0.95);
});
