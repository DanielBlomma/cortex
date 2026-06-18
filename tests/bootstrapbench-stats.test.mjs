/**
 * Unit tests for the bootstrapbench stats engine: distribution summaries,
 * chunk statistics, graph connectivity, and bootstrap log timing parsing.
 *
 * Run with: node --test tests/bootstrapbench-stats.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { collectWorkspaceCandidates } from "../benchmark/bootstrapbench/extract-stats.mjs";
import {
  buildHistogram,
  CHUNK_CHAR_BUCKETS,
  CHUNK_LINE_BUCKETS,
  computeChunkStats,
  computeCoverageDiagnostics,
  computeGraphStats,
  detectBootstrapPhase,
  mergeHistograms,
  parseBootstrapTimings,
  percentile,
  summarizeBootstrapMemory,
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
  assert.equal(stats.lines, null);
  assert.deepEqual(stats.by_language, {});
});

// ─── coverage diagnostics ───────────────────────────────────────────────────

test("computeCoverageDiagnostics: exposes skipped extensions and parser gaps", () => {
  const diagnostics = computeCoverageDiagnostics({
    candidateFiles: [
      { path: "src/app.ts" },
      { path: "src/component.tsx" },
      { path: "src/module.mts" },
      { path: "src/template.html" },
      { path: "src/styles.css" },
      { path: "README.md" },
      { path: "data/schema.json" },
      { path: "assets/logo.png" },
      { path: "docs/huge.txt", too_large: true },
      { path: "docs/nulls.txt", binary: true }
    ],
    indexedDocuments: [
      { id: "file:src/app.ts", path: "src/app.ts" },
      { id: "file:src/component.tsx", path: "src/component.tsx" },
      { id: "file:src/module.mts", path: "src/module.mts" },
      { id: "file:README.md", path: "README.md" },
      { id: "file:data/schema.json", path: "data/schema.json" }
    ],
    chunkRecords: [
      { id: "chunk:a", file_id: "file:src/app.ts" },
      { id: "chunk:b", file_id: "file:src/app.ts" },
      { id: "chunk:mts", file_id: "file:src/module.mts" },
      { id: "chunk:readme", file_id: "file:README.md" }
    ],
    ingestSkipped: { unsupported: 3, tooLarge: 1, binary: 1 }
  });

  assert.equal(diagnostics.counts.candidate_files, 10);
  assert.equal(diagnostics.counts.unsupported_files, 3);
  assert.equal(diagnostics.skipped.by_extension.unsupported[".html"], 1);
  assert.equal(diagnostics.skipped.by_extension.unsupported[".css"], 1);
  assert.equal(diagnostics.skipped.by_extension.unsupported[".png"], 1);
  assert.equal(diagnostics.skipped.by_extension.too_large[".txt"], 1);
  assert.equal(diagnostics.skipped.by_extension.binary[".txt"], 1);
  assert.equal(diagnostics.parser_eligibility.by_extension[".tsx"].parser_supported, true);
  assert.equal(diagnostics.parser_eligibility.by_extension[".tsx"].text_supported_no_parser, false);
  assert.equal(diagnostics.parser_eligibility.by_extension[".tsx"].indexed_files, 1);
  assert.equal(diagnostics.parser_eligibility.by_extension[".tsx"].chunks, 0);
  assert.equal(diagnostics.parser_eligibility.by_extension[".mts"].parser_supported, true);
  assert.equal(diagnostics.parser_eligibility.by_extension[".mts"].chunks, 1);
  assert.equal(diagnostics.parser_eligibility.text_supported_no_parser_by_extension[".json"], 1);
  assert.deepEqual(diagnostics.skipped.ingest_totals, { unsupported: 3, tooLarge: 1, binary: 1 });
});

test("collectWorkspaceCandidates: de-duplicates overlapping source paths", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-bootstrapbench-extract-"));
  fs.mkdirSync(path.join(tempRoot, "src", "nested"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "src", "app.ts"), "export const app = 1;\n");
  fs.writeFileSync(path.join(tempRoot, "src", "nested", "feature.ts"), "export const feature = 1;\n");

  const candidates = collectWorkspaceCandidates(tempRoot, ["src", "src/nested"]);

  assert.deepEqual(
    candidates.map((candidate) => candidate.path),
    ["src/app.ts", "src/nested/feature.ts"]
  );
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
    { ts: 2000, text: "[cortex][1/6] Installing context runtime dependencies" },
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

test("detectBootstrapPhase: maps bootstrap marker lines to phase keys", () => {
  assert.equal(detectBootstrapPhase("[cortex][1/6] Installing MCP dependencies"), "deps");
  assert.equal(detectBootstrapPhase("[cortex][1/6] Installing context runtime dependencies"), "deps");
  assert.equal(detectBootstrapPhase("[cortex][2/6] Indexing repository context"), "ingest");
  assert.equal(detectBootstrapPhase("[cortex][4/6] Loading RyuGraph"), "graph_load");
  assert.equal(detectBootstrapPhase("unrelated"), null);
});

test("summarizeBootstrapMemory: reports total and per-phase peak RSS", () => {
  const summary = summarizeBootstrapMemory([
    { ts: 1000, phase: "ingest", rss_kb: 100_000 },
    { ts: 1500, phase: "embed", rss_kb: 250_000 },
    { ts: 2000, phase: "embed", rss_kb: 200_000 },
    { ts: 2500, phase: "graph_load", rss_kb: 300_000 }
  ]);

  assert.equal(summary.max_rss_kb, 300_000);
  assert.equal(summary.max_rss_mb, 292.97);
  assert.equal(summary.max_phase, "graph_load");
  assert.equal(summary.sample_count, 4);
  assert.equal(summary.duration_ms, 1500);
  assert.equal(summary.by_phase.ingest.max_rss_kb, 100_000);
  assert.equal(summary.by_phase.embed.max_rss_kb, 250_000);
});

test("summarizeBootstrapMemory: empty or invalid samples yield null", () => {
  assert.equal(summarizeBootstrapMemory([]), null);
  assert.equal(summarizeBootstrapMemory([{ phase: "ingest", rss_kb: "nope" }]), null);
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
