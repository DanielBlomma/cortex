#!/usr/bin/env node
/**
 * Recall + latency + memory harness for the vector backends.
 *
 * Compares the quantized TurboQuant scan against the exact baseline on a real
 * embeddings index. Queries are sampled from the corpus itself (held-out
 * slots), so recall@k measures how often the quantized scan recovers the
 * exact top-k.
 *
 * Usage:
 *   node tools/vector-bench.mjs [entities.jsonl] [--k=10] [--queries=200] [--bits=4]
 *
 * Defaults to .context/embeddings/entities.jsonl.
 */
import fs from "node:fs";
import { performance } from "node:perf_hooks";

import { ExactVectorBackend } from "../dist/vectorBackend.js";
import { fitTurboQuant, encodeTurboQuant } from "../dist/turboquant.js";
import { QuantizedVectorBackend } from "../dist/turboquantIndex.js";

function parseArgs(argv) {
  const opts = { file: ".context/embeddings/entities.jsonl", k: 10, queries: 200, bits: 4, synthetic: 0, dim: 384 };
  for (const arg of argv) {
    if (arg.startsWith("--k=")) opts.k = Number(arg.slice(4));
    else if (arg.startsWith("--queries=")) opts.queries = Number(arg.slice(10));
    else if (arg.startsWith("--bits=")) opts.bits = Number(arg.slice(7));
    else if (arg.startsWith("--synthetic=")) opts.synthetic = Number(arg.slice(12));
    else if (arg.startsWith("--dim=")) opts.dim = Number(arg.slice(6));
    else if (!arg.startsWith("--")) opts.file = arg;
  }
  return opts;
}

function makeSynthetic(count, dim) {
  let state = 0x1234abcd;
  const rng = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
  const ids = [];
  const vectors = [];
  for (let n = 0; n < count; n += 1) {
    const out = new Float32Array(dim);
    let norm = 0;
    for (let i = 0; i < dim; i += 1) {
      const g = Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng());
      out[i] = g;
      norm += g * g;
    }
    const inv = 1 / Math.sqrt(norm);
    for (let i = 0; i < dim; i += 1) out[i] *= inv;
    ids.push(`syn:${n}`);
    vectors.push(out);
  }
  return { ids, vectors, dim };
}

function loadIndex(file) {
  const ids = [];
  const vectors = [];
  let dim = 0;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!parsed.id || !Array.isArray(parsed.vector) || parsed.vector.length === 0) continue;
    if (dim === 0) dim = parsed.vector.length;
    if (parsed.vector.length !== dim) continue;
    ids.push(parsed.id);
    vectors.push(Float32Array.from(parsed.vector));
  }
  return { ids, vectors, dim };
}

function topK(score, ids, k) {
  return ids
    .map((id) => ({ id, s: score(id) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((r) => r.id);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.synthetic && !fs.existsSync(opts.file)) {
    console.error(`No index at ${opts.file}`);
    process.exit(1);
  }
  const { ids, vectors, dim } = opts.synthetic
    ? makeSynthetic(opts.synthetic, opts.dim)
    : loadIndex(opts.file);
  if (vectors.length === 0) {
    console.error("Index has no usable vectors");
    process.exit(1);
  }
  console.log(`index: ${vectors.length} vectors x ${dim} dims  (${opts.synthetic ? "synthetic" : opts.file})`);

  const exact = ExactVectorBackend.fromVectors(new Map(ids.map((id, i) => [id, vectors[i]])));
  const params = fitTurboQuant(vectors, dim, { bits: opts.bits });
  const codes = encodeTurboQuant(vectors, params);
  const quant = new QuantizedVectorBackend({ params, codes, ids, model: null });

  const queryCount = Math.min(opts.queries, vectors.length);
  const step = Math.max(1, Math.floor(vectors.length / queryCount));
  const queryIdx = [];
  for (let i = 0; i < vectors.length && queryIdx.length < queryCount; i += step) queryIdx.push(i);

  let hits = 0;
  let exactMs = 0;
  let quantMs = 0;
  for (const qi of queryIdx) {
    const query = vectors[qi];

    let t = performance.now();
    const exactScore = exact.prepareQuery(query);
    const exactTop = topK(exactScore, ids, opts.k);
    exactMs += performance.now() - t;

    t = performance.now();
    const quantScore = quant.prepareQuery(query);
    const quantTop = topK(quantScore, ids, opts.k);
    quantMs += performance.now() - t;

    const set = new Set(exactTop);
    hits += quantTop.filter((id) => set.has(id)).length;
  }

  const recall = hits / (queryIdx.length * opts.k);
  const exactBytes = vectors.length * dim * 4;
  const stride = opts.bits === 4 ? params.paddedDim >> 1 : params.paddedDim;
  const quantBytes = vectors.length * (stride + 4); // codes + correction f32

  const fmtMB = (b) => (b / (1024 * 1024)).toFixed(1);
  console.log(`bits=${opts.bits} paddedDim=${params.paddedDim} queries=${queryIdx.length} k=${opts.k}`);
  console.log(`recall@${opts.k}: ${(recall * 100).toFixed(2)}%`);
  console.log(
    `scan latency/query: exact ${(exactMs / queryIdx.length).toFixed(2)}ms  quant ${(quantMs / queryIdx.length).toFixed(2)}ms  (${(exactMs / quantMs).toFixed(2)}x)`
  );
  console.log(
    `index memory: exact ${fmtMB(exactBytes)}MB  quant ${fmtMB(quantBytes)}MB  (${(exactBytes / quantBytes).toFixed(1)}x smaller)`
  );
}

main();
