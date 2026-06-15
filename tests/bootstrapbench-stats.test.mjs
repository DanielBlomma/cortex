/**
 * Unit tests for the bootstrapbench stats engine: distribution summaries,
 * chunk statistics, graph connectivity, and bootstrap log timing parsing.
 *
 * Run with: node --test tests/bootstrapbench-stats.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHistogram,
  CHUNK_CHAR_BUCKETS,
  CHUNK_LINE_BUCKETS,
  computeChunkStats,
  computeGraphStats,
  computeVectorStats,
  isWindowChunkId,
  mergeHistograms,
  parseBootstrapTimings,
  percentile,
  summarizeDistribution
} from "../benchmark/bootstrapbench/stats.mjs";

// ─── percentile / summarizeDistribution ──────────────────────────────────────

test("percentile: linear interpolation between closest ranks", () => {
  assert.equal(percentile([1, 2, 3, 4], 50), 2.5);
  assert.equal(percentile([1, 2, 3, 4], 0), 1);
  assert.equal(percentile([1, 2, 3, 4], 100), 4);
  assert.equal(percentile([10], 75), 10);
});

test("percentile: rejects unsorted input guards via sorted copy upstream", () => {
  assert.equal(percentile([], 50), null);
});

test("summarizeDistribution: reports count, extremes, mean and percentiles", () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const summary = summarizeDistribution(values, [1, 6]);
  assert.equal(summary.count, 10);
  assert.equal(summary.min, 1);
  assert.equal(summary.max, 10);
  assert.equal(summary.mean, 5.5);
  assert.equal(summary.p50, 5.5);
  assert.equal(summary.p90, 9.1);
  assert.deepEqual(
    summary.histogram.map((bucket) => bucket.count),
    [5, 5]
  );
});

test("summarizeDistribution: empty input yields null summary", () => {
  assert.equal(summarizeDistribution([], [1, 2]), null);
});

// ─── histograms ──────────────────────────────────────────────────────────────

test("buildHistogram: assigns values to buckets with open-ended tail", () => {
  const histogram = buildHistogram([1, 5, 10, 11, 21, 40], [1, 11, 21]);
  assert.deepEqual(
    histogram.map((bucket) => ({ label: bucket.label, count: bucket.count })),
    [
      { label: "1-10", count: 3 },
      { label: "11-20", count: 1 },
      { label: "21+", count: 2 }
    ]
  );
});

test("buildHistogram: clamps values below the first edge into the first bucket", () => {
  const histogram = buildHistogram([0, 1], [1, 3]);
  assert.equal(histogram[0].count, 2);
});

test("mergeHistograms: adds counts bucket by bucket", () => {
  const left = buildHistogram([1, 2], [1, 11, 21]);
  const right = buildHistogram([15, 30], [1, 11, 21]);
  const merged = mergeHistograms(left, right);
  assert.deepEqual(
    merged.map((bucket) => bucket.count),
    [2, 1, 1]
  );
});

test("mergeHistograms: tolerates one side being missing", () => {
  const right = buildHistogram([15], [1, 11, 21]);
  const merged = mergeHistograms(null, right);
  assert.deepEqual(
    merged.map((bucket) => bucket.count),
    [0, 1, 0]
  );
});

// ─── chunk stats ─────────────────────────────────────────────────────────────

const SAMPLE_CHUNKS = [
  {
    id: "chunk:src/a.js:alpha",
    file_id: "file:src/a.js",
    name: "alpha",
    kind: "function",
    body: "x".repeat(100),
    start_line: 1,
    end_line: 10,
    language: "javascript",
    exported: true
  },
  {
    id: "chunk:src/a.js:beta",
    file_id: "file:src/a.js",
    name: "beta",
    kind: "class",
    body: "y".repeat(300),
    start_line: 12,
    end_line: 51,
    language: "javascript"
  },
  {
    id: "chunk:lib/b.py:gamma",
    file_id: "file:lib/b.py",
    name: "gamma",
    kind: "function",
    body: "z".repeat(50),
    start_line: 5,
    end_line: 9,
    language: "python",
    exported: false
  }
];

test("computeChunkStats: totals, kinds, languages and size distributions", () => {
  const stats = computeChunkStats(SAMPLE_CHUNKS);
  assert.equal(stats.total, 3);
  assert.equal(stats.exported, 1);
  assert.deepEqual(stats.by_kind, { function: 2, class: 1 });
  assert.equal(stats.by_language.javascript.count, 2);
  assert.equal(stats.by_language.python.count, 1);
  // Lines: alpha 10, beta 40, gamma 5.
  assert.equal(stats.lines.min, 5);
  assert.equal(stats.lines.max, 40);
  assert.equal(stats.lines.count, 3);
  // Chars from body length: 100, 300, 50.
  assert.equal(stats.chars.max, 300);
  assert.equal(stats.by_language.javascript.lines.mean, 25);
});

test("computeChunkStats: skips records with invalid line ranges", () => {
  const stats = computeChunkStats([
    { ...SAMPLE_CHUNKS[0] },
    { id: "chunk:bad", body: "", start_line: 20, end_line: 3, language: "go", kind: "function" }
  ]);
  assert.equal(stats.total, 2);
  assert.equal(stats.lines.count, 1);
  assert.equal(stats.by_language.go.lines, null);
});

test("computeChunkStats: empty input returns zeroed shape", () => {
  const stats = computeChunkStats([]);
  assert.equal(stats.total, 0);
  assert.equal(stats.windowed, 0);
  assert.equal(stats.ast, 0);
  assert.equal(stats.lines, null);
  assert.deepEqual(stats.by_language, {});
});

test("isWindowChunkId: only flags ids carrying the :window: marker", () => {
  assert.equal(isWindowChunkId("chunk:src/a.js:big:window:2:40-79"), true);
  assert.equal(isWindowChunkId("chunk:src/a.js:alpha"), false);
  assert.equal(isWindowChunkId(undefined), false);
  assert.equal(isWindowChunkId(42), false);
});

test("computeChunkStats: splits AST vs fallback-window chunks overall and per language", () => {
  const stats = computeChunkStats([
    { id: "chunk:src/a.js:alpha", kind: "function", language: "javascript", start_line: 1, end_line: 5 },
    { id: "chunk:src/a.js:big:window:1:1-80", kind: "function", language: "javascript", start_line: 1, end_line: 80 },
    { id: "chunk:src/a.js:big:window:2:81-160", kind: "function", language: "javascript", start_line: 81, end_line: 160 },
    { id: "chunk:docs/readme.md:section", kind: "section", language: "markdown", start_line: 1, end_line: 4 }
  ]);
  assert.equal(stats.total, 4);
  assert.equal(stats.windowed, 2);
  assert.equal(stats.ast, 2);
  assert.equal(stats.by_language.javascript.windowed, 2);
  assert.equal(stats.by_language.markdown.windowed, 0);
});

// ─── vector sanity ───────────────────────────────────────────────────────────

test("computeVectorStats: summarizes norms and counts healthy normalized vectors", () => {
  const stats = computeVectorStats([
    { dims: 4, norm: 1.0, zero: false, nonFinite: false },
    { dims: 4, norm: 0.999, zero: false, nonFinite: false },
    { dims: 4, norm: 1.001, zero: false, nonFinite: false }
  ]);
  assert.equal(stats.count, 3);
  assert.equal(stats.zero_vectors, 0);
  assert.equal(stats.non_finite_vectors, 0);
  assert.deepEqual(stats.dimensions, { expected: 4, mismatched: 0 });
  assert.equal(stats.norm.count, 3);
  assert.ok(stats.norm.min <= 1 && stats.norm.max >= 1);
});

test("computeVectorStats: counts zero, non-finite, and dimension-mismatched vectors", () => {
  const stats = computeVectorStats([
    { dims: 4, norm: 1.0, zero: false, nonFinite: false },
    { dims: 4, norm: 0, zero: true, nonFinite: false },
    { dims: 4, norm: NaN, zero: false, nonFinite: true },
    { dims: 8, norm: 1.0, zero: false, nonFinite: false }
  ]);
  assert.equal(stats.count, 4);
  assert.equal(stats.zero_vectors, 1);
  assert.equal(stats.non_finite_vectors, 1);
  // 4 is the most common dimension (3 of 4); the dims:8 vector is the mismatch.
  assert.equal(stats.dimensions.expected, 4);
  assert.equal(stats.dimensions.mismatched, 1);
  // The NaN-norm vector is excluded from the norm distribution.
  assert.equal(stats.norm.count, 3);
});

test("computeVectorStats: returns null when nothing was embedded", () => {
  assert.equal(computeVectorStats([]), null);
  assert.equal(computeVectorStats(null), null);
  assert.equal(computeVectorStats([{ dims: null, norm: null, zero: false, nonFinite: false }]), null);
});

// ─── graph stats ─────────────────────────────────────────────────────────────

test("computeGraphStats: relation totals and chunk connectivity", () => {
  const stats = computeGraphStats({
    nodeCounts: { files: 2, chunks: 5, rules: 1, adrs: 0, modules: 0, projects: 0 },
    relationCounts: { CALLS: 3, DEFINES: 5, IMPORTS: 2 },
    callEdges: [
      { from: "chunk:a", to: "chunk:b" },
      { from: "chunk:a", to: "chunk:c" },
      { from: "chunk:d", to: "chunk:d" }
    ],
    chunkIds: ["chunk:a", "chunk:b", "chunk:c", "chunk:d", "chunk:e"]
  });

  assert.equal(stats.edges.total, 10);
  assert.equal(stats.edges.by_type.CALLS, 3);
  const connectivity = stats.chunk_connectivity;
  assert.equal(connectivity.chunk_chunk_edges, 3);
  // Degrees: a=2, b=1, c=1, d=2 (self loop counts once in, once out), e=0.
  assert.equal(connectivity.avg_degree, 1.2);
  assert.equal(connectivity.max_degree, 2);
  assert.equal(connectivity.isolated_count, 1);
  assert.equal(connectivity.isolated_pct, 20);
  assert.equal(connectivity.degree.count, 5);
  assert.equal(connectivity.top_connected[0].degree, 2);
});

test("computeGraphStats: ignores call edges pointing at unknown chunks", () => {
  const stats = computeGraphStats({
    nodeCounts: { files: 1, chunks: 1 },
    relationCounts: { CALLS: 1 },
    callEdges: [{ from: "chunk:a", to: "chunk:ghost" }],
    chunkIds: ["chunk:a"]
  });
  assert.equal(stats.chunk_connectivity.chunk_chunk_edges, 0);
  assert.equal(stats.chunk_connectivity.isolated_count, 1);
});

// ─── bootstrap log timings ───────────────────────────────────────────────────

test("parseBootstrapTimings: derives per-phase durations from step markers", () => {
  const lines = [
    { ts: 1000, text: "[cortex] bootstrap start" },
    { ts: 2000, text: "[cortex][1/6] Installing MCP dependencies" },
    { ts: 12000, text: "[cortex][2/6] Indexing repository context" },
    { ts: 30000, text: "[cortex][3/6] Generating semantic embeddings" },
    { ts: 90000, text: "[cortex][4/6] Loading RyuGraph" },
    { ts: 100000, text: "[cortex][5/6] Reading context status" },
    { ts: 101000, text: "[cortex] bootstrap complete" }
  ];
  const timings = parseBootstrapTimings(lines);
  assert.equal(timings.deps, 10000);
  assert.equal(timings.ingest, 18000);
  assert.equal(timings.embed, 60000);
  assert.equal(timings.graph_load, 10000);
  assert.equal(timings.status, 1000);
  assert.equal(timings.total, 100000);
});

test("parseBootstrapTimings: returns nulls when markers are missing", () => {
  const timings = parseBootstrapTimings([{ ts: 5, text: "unrelated" }]);
  assert.equal(timings.deps, null);
  assert.equal(timings.total, null);
});

// Buckets are exported so the frontend adapter and tests agree on shape.
test("bucket constants are ascending", () => {
  for (const buckets of [CHUNK_LINE_BUCKETS, CHUNK_CHAR_BUCKETS]) {
    const sorted = [...buckets].sort((a, b) => a - b);
    assert.deepEqual(buckets, sorted);
  }
});

// ─── npm version resolution parsing ──────────────────────────────────────────

test("parseNpmViewVersion: plain string output", async () => {
  const { parseNpmViewVersion } = await import("../benchmark/bootstrapbench/lib.mjs");
  assert.equal(parseNpmViewVersion('"2.0.19"'), "2.0.19");
  assert.equal(parseNpmViewVersion('2.1.0\n'), "2.1.0");
});

test("parseNpmViewVersion: range output returns the newest match", async () => {
  const { parseNpmViewVersion } = await import("../benchmark/bootstrapbench/lib.mjs");
  assert.equal(parseNpmViewVersion('["2.0.18","2.0.19","2.1.0"]'), "2.1.0");
});

test("parseNpmViewVersion: empty or invalid output yields null", async () => {
  const { parseNpmViewVersion } = await import("../benchmark/bootstrapbench/lib.mjs");
  assert.equal(parseNpmViewVersion(""), null);
  assert.equal(parseNpmViewVersion("[]"), null);
  assert.equal(parseNpmViewVersion("not json or version !!"), null);
});
