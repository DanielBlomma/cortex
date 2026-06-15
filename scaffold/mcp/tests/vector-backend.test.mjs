import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ExactVectorBackend } from "../dist/vectorBackend.js";
import { cosineSimilarity } from "../dist/searchCore.js";
import { fitTurboQuant, encodeTurboQuant, prepareQuery, scoreQuantized } from "../dist/turboquant.js";
import {
  writeTurboQuantIndex,
  readTurboQuantIndex,
  QuantizedVectorBackend
} from "../dist/turboquantIndex.js";
import { compileTurboQuantIndex } from "../dist/compileVectorIndex.js";
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

test("TurboQuant artifact round-trips through disk", () => {
  const rng = makeRng(22);
  const dim = 96;
  const vectors = Array.from({ length: 300 }, () => makeUnitVector(rng, dim));
  const ids = vectors.map((_, i) => `chunk:${i}`);
  const params = fitTurboQuant(vectors, dim, { bits: 4 });
  const codes = encodeTurboQuant(vectors, params);

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tqz-")), "index.tqz");
  writeTurboQuantIndex(file, params, codes, ids, "test-model");
  const loaded = readTurboQuantIndex(file);

  assert.equal(loaded.model, "test-model");
  assert.equal(loaded.ids.length, ids.length);
  assert.equal(loaded.params.dim, dim);
  assert.equal(loaded.params.paddedDim, 128);
  assert.deepEqual(Array.from(loaded.codes.codes.slice(0, 48)), Array.from(codes.codes.slice(0, 48)));

  // Scores from the reloaded artifact match in-memory scores.
  const q = makeUnitVector(rng, dim);
  const memPrepared = prepareQuery(q, params);
  const backend = new QuantizedVectorBackend(loaded);
  const diskScore = backend.prepareQuery(q);
  for (let i = 0; i < 30; i += 1) {
    const mem = scoreQuantized(memPrepared, codes.codes, codes.corrections[i], i, params.paddedDim);
    const disk = diskScore(`chunk:${i}`);
    assert.ok(Math.abs(mem - disk) < 1e-6, `slot ${i}: ${mem} vs ${disk}`);
  }
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test("QuantizedVectorBackend keeps recall@10 close to exact", () => {
  const rng = makeRng(33);
  const dim = 384;
  const corpus = Array.from({ length: 1500 }, () => makeUnitVector(rng, dim));
  const ids = corpus.map((_, i) => `e${i}`);
  const params = fitTurboQuant(corpus, dim, { bits: 4 });
  const codes = encodeTurboQuant(corpus, params);
  const backend = new QuantizedVectorBackend({ params, codes, ids, model: null });
  const exact = ExactVectorBackend.fromVectors(new Map(ids.map((id, i) => [id, corpus[i]])));

  let hits = 0;
  const k = 10;
  const queries = 30;
  for (let qi = 0; qi < queries; qi += 1) {
    const query = makeUnitVector(rng, dim);
    const exactScore = exact.prepareQuery(query);
    const approxScore = backend.prepareQuery(query);
    const exactTop = ids
      .map((id) => ({ id, s: exactScore(id) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, k)
      .map((r) => r.id);
    const approxTop = ids
      .map((id) => ({ id, s: approxScore(id) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, k)
      .map((r) => r.id);
    const set = new Set(exactTop);
    hits += approxTop.filter((id) => set.has(id)).length;
  }
  const recall = hits / (queries * k);
  assert.ok(recall >= 0.8, `recall@10 = ${recall.toFixed(3)} should be >= 0.8`);
});

test("compileTurboQuantIndex skips small corpora and writes large ones", () => {
  const rng = makeRng(44);
  const dim = 64;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tqc-"));
  const file = path.join(dir, "index.tqz");

  const small = Array.from({ length: 100 }, (_, i) => ({ id: `s${i}`, vector: makeUnitVector(rng, dim) }));
  const skipped = compileTurboQuantIndex(small, "m", file);
  assert.equal(skipped.written, false);
  assert.equal(fs.existsSync(file), false);

  const big = Array.from({ length: 600 }, (_, i) => ({ id: `b${i}`, vector: makeUnitVector(rng, dim) }));
  process.env.CORTEX_VECTOR_QUANTIZE_MIN = "500";
  const written = compileTurboQuantIndex(big, "m", file);
  delete process.env.CORTEX_VECTOR_QUANTIZE_MIN;
  assert.equal(written.written, true);
  assert.equal(written.size, 600);
  assert.ok(fs.existsSync(file));

  fs.rmSync(dir, { recursive: true, force: true });
});

test("TurboQuant artifact stores and returns its source stamp (P2)", () => {
  const rng = makeRng(55);
  const dim = 64;
  const vectors = Array.from({ length: 200 }, () => makeUnitVector(rng, dim));
  const ids = vectors.map((_, i) => `e${i}`);
  const params = fitTurboQuant(vectors, dim, { bits: 4 });
  const codes = encodeTurboQuant(vectors, params);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tqs-")), "index.tqz");
  writeTurboQuantIndex(file, params, codes, ids, "model-a", "2026-06-15T00:00:00.000Z");
  const loaded = readTurboQuantIndex(file);
  assert.equal(loaded.source, "2026-06-15T00:00:00.000Z");
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test("compileTurboQuantIndex drops a stale artifact on non-written paths (P3)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tqd-"));
  const file = path.join(dir, "index.tqz");
  fs.writeFileSync(file, "stale bytes");
  process.env.CORTEX_VECTOR_QUANTIZE_MIN = "10";

  // Enough records to pass the threshold, but all vectors empty → must delete.
  const empty = Array.from({ length: 50 }, (_, i) => ({ id: `e${i}`, vector: new Float32Array(0) }));
  const result = compileTurboQuantIndex(empty, "m", file);
  delete process.env.CORTEX_VECTOR_QUANTIZE_MIN;

  assert.equal(result.written, false);
  assert.equal(fs.existsSync(file), false, "stale artifact must be removed");
  fs.rmSync(dir, { recursive: true, force: true });
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
