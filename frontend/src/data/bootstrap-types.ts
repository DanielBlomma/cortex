/**
 * Types for the static JSON exported by
 * benchmark/bootstrapbench/export-site-data.mjs (site-data/bootstrap/).
 */

export type HistogramBucket = {
  label: string;
  min: number;
  max: number | null;
  count: number;
};

export type Distribution = {
  count: number;
  min: number;
  max: number;
  mean: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p99: number;
  histogram: HistogramBucket[];
} | null;

export type RepoMeta = {
  key: string;
  name: string;
  url: string;
  sha: string;
  languages: string[];
  benches: string[];
  instances: number | null;
};

export type RunMeta = {
  status: "ok" | "embed_failed" | "error";
  error: string | null;
  embed_model: string;
  cortex_version: string;
  run_id?: string;
  started_at?: string | null;
  extracted_at?: string;
};

export type LanguageChunkStats = {
  count: number;
  /** Chunks from the fallback windowed splitter (added in schema v2). */
  windowed?: number;
  lines: Distribution;
  chars: Distribution;
};

export type ChunkStats = {
  total: number;
  exported: number;
  /** Fallback windowed chunks vs. AST/structured chunks (added in schema v2). */
  windowed?: number;
  ast?: number;
  by_kind: Record<string, number>;
  by_language: Record<string, LanguageChunkStats>;
  lines: Distribution;
  chars: Distribution;
};

/**
 * Embedding vector sanity (schema v2). Vectors are L2-normalized, so a healthy
 * run shows norms at ~1.0 with zero faults. Null when nothing was embedded.
 */
export type VectorSanity = {
  count: number;
  zero_vectors: number;
  non_finite_vectors: number;
  dimensions: { expected: number | null; mismatched: number };
  norm: { count: number; min: number; max: number; mean: number; p50: number; p99: number } | null;
} | null;

export type EmbeddingStats = {
  model: string | null;
  dimensions: number | null;
  mode: string | null;
  counts: {
    entities: number | null;
    output: number | null;
    embedded: number | null;
    reused: number | null;
    failed: number | null;
  };
  by_entity_type: Record<string, number>;
  throughput_per_s: number | null;
} | null;

export type GraphStats = {
  nodes: Record<string, number | null>;
  edges: { total: number; by_type: Record<string, number> };
  chunk_connectivity: {
    chunk_chunk_edges: number;
    avg_degree: number | null;
    max_degree: number | null;
    isolated_count: number;
    isolated_pct: number | null;
    degree: Distribution;
    top_connected: Array<{ id: string; degree: number }>;
  };
} | null;

export type TimingsMs = {
  deps: number | null;
  ingest: number | null;
  embed: number | null;
  graph_load: number | null;
  status: number | null;
  total: number | null;
};

export type StatsItem = {
  schema_version: number;
  repo: RepoMeta | null;
  run: RunMeta;
  workspace: {
    tracked_files?: number | null;
    tracked_bytes?: number | null;
    tracked_lines?: number | null;
    detected_source_paths?: string[];
  } | null;
  timings_ms: TimingsMs | null;
  ingest: {
    mode: string | null;
    counts: Record<string, number> | null;
    skipped: Record<string, number> | null;
    parser_health: Record<string, unknown> | null;
  } | null;
  files: { total: number; by_kind: Record<string, number>; indexed_lines?: number } | null;
  chunks: ChunkStats | null;
  embeddings: EmbeddingStats;
  vector_sanity?: VectorSanity;
  graph: GraphStats;
};

export type RepoRow = {
  key: string;
  name: string;
  languages: string[];
  benches: string[];
  sha: string | null;
  model: string | null;
  status: string;
  error: string | null;
  tracked_files: number | null;
  tracked_bytes: number | null;
  tracked_lines: number | null;
  indexed_lines: number | null;
  files: number | null;
  chunks: number | null;
  chunk_p50_lines: number | null;
  chunk_mean_lines: number | null;
  edges: number | null;
  chunk_chunk_edges: number | null;
  avg_degree: number | null;
  isolated_pct: number | null;
  embedded: number | null;
  dimensions: number | null;
  total_ms: number | null;
  ingest_ms: number | null;
  embed_ms: number | null;
};

export type ModelRollup = {
  items: number;
  repos: number;
  chunks: number;
  embedded: number;
  failed_embeddings: number;
  dimensions: number | null;
  avg_throughput_per_s: number | null;
  chunk_lines_histogram: HistogramBucket[] | null;
  chunk_chars_histogram: HistogramBucket[] | null;
};

export type LanguageRollup = {
  chunks: number;
  repos: number;
  mean_chunk_lines: number | null;
  lines_histogram: HistogramBucket[] | null;
};

export type Aggregate = {
  totals: {
    items: number;
    succeeded: number;
    failed: number;
    repos: number;
    models: string[];
    chunks?: number;
    files?: number;
    edges?: number;
    duration_ms?: number;
    indexed_lines?: number;
    tracked_lines?: number;
  };
  by_model: Record<string, ModelRollup>;
  by_language: Record<string, LanguageRollup>;
  relations_by_type: Record<string, number>;
  repo_rows: RepoRow[];
};

export type RepoSummary = {
  key: string;
  name: string;
  languages: string[];
  benches: string[];
  models: string[];
  statuses: string[];
  chunks: number | null;
  edges: number | null;
};

export type BootstrapSummaryDoc = {
  schema_version: number;
  run: { id: string; generated_at: string | null; cortex_version: string | null };
  aggregate: Aggregate;
  repos: RepoSummary[];
};

export type RepoDetailDoc = {
  schema_version: number;
  run: { id: string; generated_at: string | null; cortex_version: string | null };
  repo: RepoMeta;
  runs: StatsItem[];
};

export type VersionIndexEntry = {
  version: string;
  run_id: string;
  generated_at: string | null;
  models?: string[];
  /** Where the measured cortex build came from: "local" working tree or "npm". */
  source?: string;
  repos?: number;
};

export type VersionIndex = {
  schema_version: number;
  versions: VersionIndexEntry[];
};
