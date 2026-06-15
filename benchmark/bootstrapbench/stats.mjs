/**
 * Pure statistics helpers for the cortex bootstrap benchmark.
 *
 * Everything in this module is side-effect free and operates on plain data so
 * it can run both inside the eval container (extract-stats.mjs) and on the
 * host (aggregate.mjs), and is unit-testable without fixtures on disk.
 */

// Shared bucket edges so per-repo histograms can be merged across runs.
// Each edge starts a bucket; the final bucket is open-ended.
export const CHUNK_LINE_BUCKETS = [1, 11, 21, 41, 81, 161, 321];
export const CHUNK_CHAR_BUCKETS = [0, 201, 501, 1001, 2001, 4001, 8001, 12001];
export const DEGREE_BUCKETS = [0, 1, 2, 3, 5, 9, 17, 33];

const PERCENTILES = [25, 50, 75, 90, 99];
const TOP_CONNECTED_LIMIT = 10;

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Linear-interpolation percentile over an ascending-sorted numeric array.
 * Returns null for empty input.
 */
export function percentile(sortedValues, p) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) {
    return null;
  }
  if (sortedValues.length === 1) {
    return sortedValues[0];
  }
  const rank = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) {
    return sortedValues[lower];
  }
  const weight = rank - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function bucketLabel(edges, index) {
  const start = edges[index];
  if (index === edges.length - 1) {
    return `${start}+`;
  }
  const end = edges[index + 1] - 1;
  return start === end ? `${start}` : `${start}-${end}`;
}

/**
 * Histogram over fixed ascending bucket edges. Values below the first edge are
 * clamped into the first bucket; the last bucket is open-ended.
 */
export function buildHistogram(values, bucketEdges) {
  if (!Array.isArray(bucketEdges) || bucketEdges.length === 0) {
    throw new Error("buildHistogram requires at least one bucket edge");
  }
  const counts = bucketEdges.map(() => 0);
  for (const value of values) {
    let index = 0;
    for (let i = bucketEdges.length - 1; i >= 0; i -= 1) {
      if (value >= bucketEdges[i]) {
        index = i;
        break;
      }
    }
    counts[index] += 1;
  }
  return bucketEdges.map((edge, index) => ({
    label: bucketLabel(bucketEdges, index),
    min: edge,
    max: index === bucketEdges.length - 1 ? null : bucketEdges[index + 1] - 1,
    count: counts[index]
  }));
}

/** Adds two histograms with identical bucket layout; either side may be null. */
export function mergeHistograms(left, right) {
  if (!left && !right) {
    return null;
  }
  if (!left || !right) {
    const present = left ?? right;
    const empty = present.map((bucket) => ({ ...bucket, count: 0 }));
    return mergeHistograms(left ?? empty, right ?? empty);
  }
  if (left.length !== right.length) {
    throw new Error(`Cannot merge histograms with different layouts (${left.length} vs ${right.length})`);
  }
  return left.map((bucket, index) => {
    const other = right[index];
    if (bucket.label !== other.label) {
      throw new Error(`Histogram bucket mismatch at ${index}: ${bucket.label} vs ${other.label}`);
    }
    return { ...bucket, count: bucket.count + other.count };
  });
}

/**
 * Full distribution summary: count, extremes, mean, selected percentiles, and
 * a fixed-bucket histogram. Returns null for empty input.
 */
export function summarizeDistribution(values, bucketEdges) {
  const numeric = values.filter((value) => Number.isFinite(value));
  if (numeric.length === 0) {
    return null;
  }
  const sorted = [...numeric].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  const summary = {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: round(sum / sorted.length),
    histogram: buildHistogram(sorted, bucketEdges)
  };
  for (const p of PERCENTILES) {
    summary[`p${p}`] = round(percentile(sorted, p));
  }
  return summary;
}

/**
 * A chunk produced by the fallback windowed splitter (large content sliced into
 * overlapping windows) rather than a precise AST/structured parse. The splitter
 * encodes `:window:` into the chunk id (see scaffold/scripts/ingest.mjs); window
 * chunks otherwise inherit their parent's kind, so the id is the only marker.
 */
export function isWindowChunkId(chunkId) {
  return typeof chunkId === "string" && chunkId.includes(":window:");
}

function chunkLineCount(chunk) {
  const start = Number(chunk.start_line);
  const end = Number(chunk.end_line);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || start < 0) {
    return null;
  }
  return end - start + 1;
}

/**
 * Per-repo chunk statistics from entities.chunk.jsonl records.
 * Records with invalid line ranges still count toward totals but are excluded
 * from line distributions. `exported` and `language` are optional fields.
 */
export function computeChunkStats(chunkRecords) {
  const byKind = {};
  const byLanguageValues = new Map();
  const lineValues = [];
  const charValues = [];
  let exported = 0;
  let windowed = 0;

  for (const chunk of chunkRecords) {
    const kind = String(chunk.kind ?? "unknown");
    byKind[kind] = (byKind[kind] ?? 0) + 1;
    if (chunk.exported === true) {
      exported += 1;
    }
    const isWindow = isWindowChunkId(chunk.id);
    if (isWindow) {
      windowed += 1;
    }

    const language = String(chunk.language ?? "unknown");
    const entry = byLanguageValues.get(language) ?? { count: 0, windowed: 0, lines: [], chars: [] };
    entry.count += 1;
    if (isWindow) {
      entry.windowed += 1;
    }

    const lines = chunkLineCount(chunk);
    if (lines !== null) {
      lineValues.push(lines);
      entry.lines.push(lines);
    }
    // Streaming callers pass precomputed body_chars to avoid retaining bodies.
    const chars = Number.isFinite(chunk.body_chars)
      ? chunk.body_chars
      : typeof chunk.body === "string"
        ? chunk.body.length
        : null;
    if (chars !== null && chars > 0) {
      charValues.push(chars);
      entry.chars.push(chars);
    }
    byLanguageValues.set(language, entry);
  }

  const byLanguage = {};
  for (const [language, entry] of byLanguageValues) {
    byLanguage[language] = {
      count: entry.count,
      windowed: entry.windowed,
      lines: summarizeDistribution(entry.lines, CHUNK_LINE_BUCKETS),
      chars: summarizeDistribution(entry.chars, CHUNK_CHAR_BUCKETS)
    };
  }

  const total = chunkRecords.length;
  return {
    total,
    exported,
    // AST/structured chunks vs. fallback windowed chunks. A high windowed share
    // means large content is being sliced rather than precisely parsed — a
    // parse-coverage signal worth watching per language.
    windowed,
    ast: total - windowed,
    by_kind: byKind,
    by_language: byLanguage,
    lines: summarizeDistribution(lineValues, CHUNK_LINE_BUCKETS),
    chars: summarizeDistribution(charValues, CHUNK_CHAR_BUCKETS)
  };
}

/**
 * Graph statistics: node/edge totals by type plus chunk-to-chunk connectivity
 * derived from CALLS edges. Call edges referencing unknown chunk ids (e.g.
 * pruned entities) are ignored. Self-loops contribute one in- and one
 * out-degree to the same chunk.
 */
export function computeGraphStats({ nodeCounts, relationCounts, callEdges, chunkIds }) {
  const byType = {};
  let totalEdges = 0;
  for (const [type, count] of Object.entries(relationCounts ?? {})) {
    const numeric = Number(count) || 0;
    byType[type] = numeric;
    totalEdges += numeric;
  }

  const knownChunks = new Set(chunkIds ?? []);
  const degrees = new Map([...knownChunks].map((id) => [id, 0]));
  let chunkChunkEdges = 0;

  for (const edge of callEdges ?? []) {
    if (!knownChunks.has(edge.from) || !knownChunks.has(edge.to)) {
      continue;
    }
    chunkChunkEdges += 1;
    degrees.set(edge.from, degrees.get(edge.from) + 1);
    degrees.set(edge.to, degrees.get(edge.to) + 1);
  }

  const degreeValues = [...degrees.values()];
  const isolatedCount = degreeValues.filter((degree) => degree === 0).length;
  const degreeSum = degreeValues.reduce((acc, value) => acc + value, 0);
  // Avoid Math.max(...values): argument spreading overflows the call stack
  // beyond ~100k elements, which large repos exceed.
  const maxDegree = degreeValues.reduce((max, value) => (value > max ? value : max), 0);
  const topConnected = [...degrees.entries()]
    .filter(([, degree]) => degree > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, TOP_CONNECTED_LIMIT)
    .map(([id, degree]) => ({ id, degree }));

  return {
    nodes: { ...nodeCounts },
    edges: { total: totalEdges, by_type: byType },
    chunk_connectivity: {
      chunk_chunk_edges: chunkChunkEdges,
      avg_degree: degreeValues.length > 0 ? round(degreeSum / degreeValues.length) : null,
      max_degree: degreeValues.length > 0 ? maxDegree : null,
      isolated_count: isolatedCount,
      isolated_pct: degreeValues.length > 0 ? round((isolatedCount / degreeValues.length) * 100) : null,
      degree: summarizeDistribution(degreeValues, DEGREE_BUCKETS),
      top_connected: topConnected
    }
  };
}

/**
 * Embedding vector sanity check. Input is one lightweight probe per embedded
 * entity — `{ dims, norm, zero, nonFinite }` — computed while streaming the
 * embeddings file so raw vectors are never retained. Surfaces the failure modes
 * that silently poison semantic search: all-zero vectors, NaN/Inf components,
 * dimension drift, and norms that stray from the expected ~1.0 (vectors are
 * L2-normalized at write time). Returns null when nothing was embedded.
 */
export function computeVectorStats(probes) {
  const present = (probes ?? []).filter((probe) => probe && Number.isFinite(probe.dims) && probe.dims > 0);
  if (present.length === 0) {
    return null;
  }

  const norms = [];
  const dimsCounts = new Map();
  let zeroVectors = 0;
  let nonFiniteVectors = 0;
  for (const probe of present) {
    dimsCounts.set(probe.dims, (dimsCounts.get(probe.dims) ?? 0) + 1);
    if (probe.zero) {
      zeroVectors += 1;
    }
    if (probe.nonFinite) {
      nonFiniteVectors += 1;
    }
    if (Number.isFinite(probe.norm)) {
      norms.push(probe.norm);
    }
  }

  let expectedDims = null;
  let expectedCount = -1;
  for (const [dims, count] of dimsCounts) {
    if (count > expectedCount) {
      expectedCount = count;
      expectedDims = dims;
    }
  }

  // Norms hover at ~1.0 (L2-normalized), so a fixed-bucket histogram adds no
  // signal and 6 decimals are needed to see drift; report spread directly.
  const sortedNorms = norms.sort((a, b) => a - b);
  const norm =
    sortedNorms.length === 0
      ? null
      : {
          count: sortedNorms.length,
          min: round(sortedNorms[0], 6),
          max: round(sortedNorms[sortedNorms.length - 1], 6),
          mean: round(sortedNorms.reduce((acc, value) => acc + value, 0) / sortedNorms.length, 6),
          p50: round(percentile(sortedNorms, 50), 6),
          p99: round(percentile(sortedNorms, 99), 6)
        };

  return {
    count: present.length,
    zero_vectors: zeroVectors,
    non_finite_vectors: nonFiniteVectors,
    dimensions: { expected: expectedDims, mismatched: present.length - expectedCount },
    norm
  };
}

// Bootstrap step markers printed by scaffold/scripts/bootstrap.sh, mapped to
// stable phase keys. The numbered prefix looks like "[cortex][2/6] <title>".
const PHASE_MARKERS = [
  { key: "deps", pattern: /\[cortex\]\[\d+\/\d+\] Installing MCP dependencies/ },
  { key: "ingest", pattern: /\[cortex\]\[\d+\/\d+\] Indexing repository context/ },
  { key: "embed", pattern: /\[cortex\]\[\d+\/\d+\] Generating semantic embeddings/ },
  { key: "graph_load", pattern: /\[cortex\]\[\d+\/\d+\] Loading RyuGraph/ },
  { key: "status", pattern: /\[cortex\]\[\d+\/\d+\] Reading context status/ }
];
const BOOTSTRAP_START = /\[cortex\] bootstrap start/;
const BOOTSTRAP_COMPLETE = /\[cortex\] bootstrap complete/;

/**
 * Derives per-phase durations (ms) from a timestamped bootstrap log.
 * Input lines are `{ ts: epochMs, text: string }`. Each phase runs from its
 * marker until the next marker (or the completion line for the last phase).
 * Missing markers yield null durations rather than throwing.
 */
export function parseBootstrapTimings(lines) {
  const markerTimestamps = new Map();
  let startTs = null;
  let completeTs = null;
  let lastTs = null;

  for (const line of lines ?? []) {
    if (!Number.isFinite(line?.ts) || typeof line?.text !== "string") {
      continue;
    }
    lastTs = line.ts;
    if (startTs === null && BOOTSTRAP_START.test(line.text)) {
      startTs = line.ts;
    }
    if (BOOTSTRAP_COMPLETE.test(line.text)) {
      completeTs = line.ts;
    }
    for (const marker of PHASE_MARKERS) {
      if (!markerTimestamps.has(marker.key) && marker.pattern.test(line.text)) {
        markerTimestamps.set(marker.key, line.ts);
      }
    }
  }

  const endTs = completeTs ?? lastTs;
  const timings = {};
  for (let index = 0; index < PHASE_MARKERS.length; index += 1) {
    const currentKey = PHASE_MARKERS[index].key;
    const currentTs = markerTimestamps.get(currentKey);
    if (!Number.isFinite(currentTs)) {
      timings[currentKey] = null;
      continue;
    }
    let nextTs = null;
    for (let lookahead = index + 1; lookahead < PHASE_MARKERS.length; lookahead += 1) {
      const candidate = markerTimestamps.get(PHASE_MARKERS[lookahead].key);
      if (Number.isFinite(candidate)) {
        nextTs = candidate;
        break;
      }
    }
    const phaseEnd = nextTs ?? endTs;
    timings[currentKey] = Number.isFinite(phaseEnd) && phaseEnd >= currentTs ? phaseEnd - currentTs : null;
  }

  const totalStart = startTs ?? markerTimestamps.get("deps") ?? null;
  timings.total =
    Number.isFinite(totalStart) && Number.isFinite(endTs) && endTs >= totalStart ? endTs - totalStart : null;
  return timings;
}
