/**
 * Unit tests for bootstrapbench cross-repo aggregation and the site-data
 * adapter that feeds the frontend bootstrap metrics pages.
 *
 * Run with: node --test tests/bootstrapbench-aggregate.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildHistogram, CHUNK_LINE_BUCKETS } from "../benchmark/bootstrapbench/stats.mjs";
import {
  aggregateResults,
  buildSiteData,
  compareVersionsDesc,
  mergeVersionIndex
} from "../benchmark/bootstrapbench/aggregate.mjs";

function sampleItem(overrides = {}) {
  const lineValues = overrides.lineValues ?? [5, 10, 20];
  const base = {
    schema_version: 1,
    repo: {
      key: "iamkun__dayjs",
      name: "iamkun/dayjs",
      url: "https://github.com/iamkun/dayjs.git",
      sha: "abc123",
      languages: ["javascript"],
      benches: ["Multi"],
      instances: 9
    },
    run: {
      status: "ok",
      embed_model: "Xenova/all-MiniLM-L6-v2",
      cortex_version: "2.0.19",
      started_at: "2026-06-11T10:00:00.000Z",
      finished_at: "2026-06-11T10:10:00.000Z"
    },
    workspace: { tracked_files: 300, tracked_bytes: 1_000_000, tracked_lines: 40_000, detected_source_paths: ["src"] },
    timings_ms: { deps: 1000, ingest: 2000, embed: 3000, graph_load: 500, status: 100, total: 6600 },
    files: { total: 120, by_kind: { CODE: 100, DOC: 20, ADR: 0 }, indexed_lines: 25_000 },
    chunks: {
      total: lineValues.length,
      exported: 1,
      by_kind: { function: lineValues.length },
      by_language: {
        javascript: {
          count: lineValues.length,
          lines: {
            count: lineValues.length,
            mean: lineValues.reduce((a, b) => a + b, 0) / lineValues.length,
            p50: lineValues[1],
            histogram: buildHistogram(lineValues, CHUNK_LINE_BUCKETS)
          },
          chars: null
        }
      },
      lines: {
        count: lineValues.length,
        min: Math.min(...lineValues),
        max: Math.max(...lineValues),
        mean: lineValues.reduce((a, b) => a + b, 0) / lineValues.length,
        p50: lineValues[1],
        p90: Math.max(...lineValues),
        histogram: buildHistogram(lineValues, CHUNK_LINE_BUCKETS)
      },
      chars: null
    },
    embeddings: {
      model: "Xenova/all-MiniLM-L6-v2",
      dimensions: 384,
      counts: { entities: 130, output: 130, embedded: 130, reused: 0, failed: 0 },
      by_entity_type: { Chunk: lineValues.length, File: 120 },
      throughput_per_s: 10
    },
    graph: {
      nodes: { files: 120, chunks: lineValues.length, rules: 1, adrs: 0, modules: 0, projects: 0 },
      edges: { total: 50, by_type: { CALLS: 20, DEFINES: 25, IMPORTS: 5 } },
      chunk_connectivity: {
        chunk_chunk_edges: 20,
        avg_degree: 1.5,
        max_degree: 4,
        isolated_count: 1,
        isolated_pct: 33.3,
        degree: { count: lineValues.length, histogram: [] },
        top_connected: []
      }
    }
  };
  return { ...base, ...overrides };
}

test("aggregateResults: sums totals across successful items and tracks failures", () => {
  const failed = sampleItem({
    repo: { key: "broken__repo", name: "broken/repo", url: "x", sha: "s", languages: ["go"] },
    run: { status: "error", embed_model: "Xenova/all-MiniLM-L6-v2", error: "boom" },
    chunks: null,
    graph: null,
    embeddings: null
  });
  const second = sampleItem({ lineValues: [40, 50, 60, 70] });
  second.repo = { ...second.repo, key: "expressjs__express", name: "expressjs/express" };
  const summary = aggregateResults([sampleItem(), second, failed]);

  assert.equal(summary.totals.items, 3);
  assert.equal(summary.totals.succeeded, 2);
  assert.equal(summary.totals.failed, 1);
  assert.equal(summary.totals.chunks, 7);
  assert.equal(summary.totals.edges, 100);
  assert.equal(summary.relations_by_type.CALLS, 40);
  assert.equal(summary.relations_by_type.DEFINES, 50);
  // LOC denominators sum over succeeded items only (2 x sample values).
  assert.equal(summary.totals.indexed_lines, 50_000);
  assert.equal(summary.totals.tracked_lines, 80_000);
  assert.equal(summary.repo_rows[0].indexed_lines, 25_000);
  assert.equal(summary.repo_rows[0].tracked_lines, 40_000);

  const model = summary.by_model["Xenova/all-MiniLM-L6-v2"];
  assert.equal(model.items, 2);
  assert.equal(model.chunks, 7);
  assert.equal(model.dimensions, 384);
  const totalBucketCount = model.chunk_lines_histogram.reduce((acc, bucket) => acc + bucket.count, 0);
  assert.equal(totalBucketCount, 7);

  assert.equal(summary.by_language.javascript.chunks, 7);
  assert.equal(summary.by_language.javascript.repos, 2);
});

test("aggregateResults: weighted mean chunk lines per language", () => {
  const summary = aggregateResults([
    sampleItem({ lineValues: [10, 10, 10] }),
    sampleItem({ lineValues: [40] })
  ]);
  // (3*10 + 1*40) / 4 = 17.5
  assert.equal(summary.by_language.javascript.mean_chunk_lines, 17.5);
});

test("buildSiteData: produces summary plus one detail file per repo", () => {
  const items = [
    sampleItem(),
    sampleItem({
      run: { status: "ok", embed_model: "Xenova/bge-small-en-v1.5", cortex_version: "2.0.19" }
    })
  ];
  const site = buildSiteData({
    runId: "2026-06-11-smoke",
    generatedAt: "2026-06-11T12:00:00.000Z",
    cortexVersion: "2.0.19",
    items
  });

  assert.equal(site.summary.run.id, "2026-06-11-smoke");
  assert.equal(site.summary.run.cortex_version, "2.0.19");
  assert.ok(site.summary.aggregate.totals.chunks > 0);
  assert.equal(site.summary.repos.length, 1);
  assert.deepEqual(
    site.summary.repos[0].models.sort(),
    ["Xenova/all-MiniLM-L6-v2", "Xenova/bge-small-en-v1.5"]
  );

  assert.equal(site.repos.length, 1);
  const detail = site.repos[0];
  assert.equal(detail.key, "iamkun__dayjs");
  assert.equal(detail.data.repo.name, "iamkun/dayjs");
  assert.equal(detail.data.runs.length, 2);
  const models = detail.data.runs.map((run) => run.run.embed_model).sort();
  assert.deepEqual(models, ["Xenova/all-MiniLM-L6-v2", "Xenova/bge-small-en-v1.5"]);
});

test("buildSiteData: validates required run metadata", () => {
  assert.throws(() => buildSiteData({ items: [] }), /runId/);
});

// ─── version index ───────────────────────────────────────────────────────────

test("compareVersionsDesc: semver-aware descending order", () => {
  const versions = ["2.0.19", "2.1.0", "2.0.2", "10.0.0", "2.1.0-rc.1"];
  const sorted = [...versions].sort(compareVersionsDesc);
  assert.deepEqual(sorted, ["10.0.0", "2.1.0", "2.1.0-rc.1", "2.0.19", "2.0.2"]);
});

test("mergeVersionIndex: adds new versions and keeps existing entries", () => {
  const existing = {
    schema_version: 1,
    versions: [{ version: "2.0.19", run_id: "full-3", generated_at: "2026-06-11T20:00:00.000Z" }]
  };
  const merged = mergeVersionIndex(existing, {
    version: "2.1.0",
    run_id: "full-4",
    generated_at: "2026-06-12T08:00:00.000Z"
  });
  assert.equal(merged.versions.length, 2);
  assert.equal(merged.versions[0].version, "2.1.0");
  assert.equal(merged.versions[1].version, "2.0.19");
  // Existing index object must not be mutated.
  assert.equal(existing.versions.length, 1);
});

test("mergeVersionIndex: replaces the entry for a re-published version", () => {
  const existing = {
    schema_version: 1,
    versions: [
      { version: "2.1.0", run_id: "full-4", generated_at: "a" },
      { version: "2.0.19", run_id: "full-3", generated_at: "b" }
    ]
  };
  const merged = mergeVersionIndex(existing, { version: "2.1.0", run_id: "full-5", generated_at: "c" });
  assert.equal(merged.versions.length, 2);
  assert.equal(merged.versions[0].run_id, "full-5");
});

test("mergeVersionIndex: starts a fresh index from null", () => {
  const merged = mergeVersionIndex(null, { version: "2.0.19", run_id: "full-3", generated_at: "x" });
  assert.equal(merged.schema_version, 1);
  assert.equal(merged.versions.length, 1);
});

test("mergeVersionIndex: rejects entries without a version", () => {
  assert.throws(() => mergeVersionIndex(null, { run_id: "r" }), /version/);
});
