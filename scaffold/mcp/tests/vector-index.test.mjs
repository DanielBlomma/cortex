import test from "node:test";
import assert from "node:assert/strict";

import { cosineSimilarity } from "../dist/searchCore.js";
import { buildSearchResults } from "../dist/searchResults.js";

// Reference cosine over float64 number[] — what the index used to store.
function cosineFloat64(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Deterministic 384-dim vectors rounded to 6 decimals, mirroring the
// canonical JSONL form the embedder writes.
function makeVector(seed, dim = 384) {
  const out = [];
  let state = seed;
  for (let i = 0; i < dim; i += 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const raw = (state / 0x7fffffff) * 2 - 1; // [-1, 1)
    out.push(Number(raw.toFixed(6)));
  }
  return out;
}

test("cosineSimilarity (float32) matches the float64 reference within 1e-6 and after 4-decimal rounding", () => {
  for (let pair = 0; pair < 50; pair += 1) {
    const a = makeVector(pair * 7 + 1);
    const b = makeVector(pair * 13 + 2);
    const ref = cosineFloat64(a, b);
    const got = cosineSimilarity(Float32Array.from(a), Float32Array.from(b));
    assert.ok(
      Math.abs(got - ref) < 1e-6,
      `pair ${pair}: |${got} - ${ref}| = ${Math.abs(got - ref)} exceeds 1e-6`
    );
    // The API rounds embedding_score to 4 decimals — float32 cannot change it.
    assert.equal(Number(got.toFixed(4)), Number(ref.toFixed(4)), `pair ${pair} differs at 4 decimals`);
  }
});

test("cosineSimilarity handles identical and zero vectors", () => {
  const v = Float32Array.from(makeVector(99));
  assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 1e-6);
  const zero = new Float32Array(384);
  assert.equal(cosineSimilarity(v, zero), 0);
  assert.equal(cosineSimilarity(new Float32Array(0), new Float32Array(0)), 0);
});

function makeEntity(id, overrides = {}) {
  return {
    id,
    entity_type: "Chunk",
    kind: "function",
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

test("buildSearchResults ranks via Float32Array vectors end-to-end", () => {
  const query = Float32Array.from(makeVector(1));
  const near = Float32Array.from(makeVector(1)); // identical → cosine 1
  const far = Float32Array.from(makeVector(500)); // unrelated

  const candidates = [makeEntity("near"), makeEntity("far")];
  const results = buildSearchResults({
    candidates,
    degreeByEntity: new Map(),
    queryTokens: ["text"],
    queryPhrase: "text",
    ranking: { semantic: 0.55, graph: 0.1, trust: 0.2, recency: 0.15 },
    includeScores: true,
    includeMatchedRules: false,
    includeContent: false,
    queryVector: query,
    embeddingVectors: new Map([
      ["near", near],
      ["far", far]
    ]),
    topK: 2,
    minLexicalRelevance: 0,
    minVectorRelevance: 0,
    semanticScorer: () => 0.5,
    vectorScorer: cosineSimilarity,
    recencyScorer: () => 0.5,
    legacyDataAccessBooster: () => 0
  });

  assert.equal(results.length, 2);
  assert.equal(results[0].id, "near", "identical-vector entity should rank first");
  // embedding_score is reported rounded to 4 decimals; near==query → 1.0000.
  const nearScore = results.find((r) => r.id === "near").embedding_score;
  assert.equal(nearScore, 1, "identical float32 vectors score 1.0000");
});
