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

export const TEXT_SUPPORTED_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".adoc",
  ".rst",
  ".yaml",
  ".yml",
  ".json",
  ".toml",
  ".csv",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".java",
  ".cs",
  ".vb",
  ".sln",
  ".vbproj",
  ".csproj",
  ".fsproj",
  ".props",
  ".targets",
  ".config",
  ".resx",
  ".settings",
  ".rb",
  ".rs",
  ".php",
  ".swift",
  ".kt",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cc",
  ".hh",
  ".bas",
  ".cls",
  ".frm",
  ".ctl"
]);

export const PARSER_SUPPORTED_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".vb",
  ".cs",
  ".sql",
  ".md",
  ".mdx",
  ".config",
  ".resx",
  ".settings",
  ".c",
  ".h",
  ".cpp",
  ".cc",
  ".hpp",
  ".hh",
  ".rs",
  ".py",
  ".go",
  ".java",
  ".rb",
  ".sh",
  ".bash",
  ".zsh",
  ".bas",
  ".cls",
  ".frm",
  ".ctl"
]);

const PERCENTILES = [25, 50, 75, 90, 99];
const TOP_CONNECTED_LIMIT = 10;

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function extensionKey(filePath) {
  const fileName = String(filePath ?? "").split(/[\\/]/).pop() ?? "";
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
    return "[none]";
  }
  return fileName.slice(dotIndex).toLowerCase();
}

function isReadmePath(filePath) {
  const base = String(filePath ?? "").split(/[\\/]/).pop()?.toLowerCase() ?? "";
  return base === "readme" || base.startsWith("readme.");
}

export function isTextSupportedPath(filePath) {
  return TEXT_SUPPORTED_EXTENSIONS.has(extensionKey(filePath)) || isReadmePath(filePath);
}

export function isParserSupportedPath(filePath) {
  return PARSER_SUPPORTED_EXTENSIONS.has(extensionKey(filePath));
}

function incrementExtensionCount(target, ext, amount = 1) {
  if (!Number.isFinite(amount) || amount === 0) {
    return;
  }
  target[ext] = (target[ext] ?? 0) + amount;
}

function sortedCountObject(counts) {
  return Object.fromEntries(
    Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  );
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

  for (const chunk of chunkRecords) {
    const kind = String(chunk.kind ?? "unknown");
    byKind[kind] = (byKind[kind] ?? 0) + 1;
    if (chunk.exported === true) {
      exported += 1;
    }

    const language = String(chunk.language ?? "unknown");
    const entry = byLanguageValues.get(language) ?? { count: 0, lines: [], chars: [] };
    entry.count += 1;

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
      lines: summarizeDistribution(entry.lines, CHUNK_LINE_BUCKETS),
      chars: summarizeDistribution(entry.chars, CHUNK_CHAR_BUCKETS)
    };
  }

  return {
    total: chunkRecords.length,
    exported,
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
 * File coverage diagnostics for benchmark output. Inputs are plain records so
 * extract-stats can build them from a workspace scan without touching ingest.
 */
export function computeCoverageDiagnostics({ candidateFiles, indexedDocuments, chunkRecords, ingestSkipped }) {
  const candidateList = Array.isArray(candidateFiles) ? candidateFiles : [];
  const indexedList = Array.isArray(indexedDocuments) ? indexedDocuments : [];
  const chunkList = Array.isArray(chunkRecords) ? chunkRecords : [];

  const byExtension = new Map();
  const skippedByExtension = {
    unsupported: {},
    too_large: {},
    binary: {}
  };
  const textSupportedNoParserByExtension = {};

  const entryFor = (ext) => {
    const existing = byExtension.get(ext);
    if (existing) {
      return existing;
    }
    const entry = {
      candidate_files: 0,
      indexed_files: 0,
      chunks: 0,
      unsupported_files: 0,
      too_large_files: 0,
      binary_files: 0,
      text_supported: ext === "[none]" ? null : TEXT_SUPPORTED_EXTENSIONS.has(ext),
      parser_supported: ext === "[none]" ? null : PARSER_SUPPORTED_EXTENSIONS.has(ext),
      text_supported_no_parser: false
    };
    byExtension.set(ext, entry);
    return entry;
  };

  for (const file of candidateList) {
    const ext = extensionKey(file.path);
    const entry = entryFor(ext);
    entry.candidate_files += 1;
    const textSupported = isTextSupportedPath(file.path);
    const parserSupported = isParserSupportedPath(file.path);
    entry.text_supported = entry.text_supported === true || textSupported;
    entry.parser_supported = entry.parser_supported === true || parserSupported;

    if (!textSupported) {
      entry.unsupported_files += 1;
      incrementExtensionCount(skippedByExtension.unsupported, ext);
      continue;
    }
    if (file.too_large === true) {
      entry.too_large_files += 1;
      incrementExtensionCount(skippedByExtension.too_large, ext);
      continue;
    }
    if (file.binary === true) {
      entry.binary_files += 1;
      incrementExtensionCount(skippedByExtension.binary, ext);
    }
  }

  for (const doc of indexedList) {
    entryFor(extensionKey(doc.path)).indexed_files += 1;
  }

  const indexedPathById = new Map(indexedList.map((doc) => [doc.id ?? `file:${doc.path}`, doc.path]));
  for (const chunk of chunkList) {
    const filePath = indexedPathById.get(chunk.file_id);
    if (filePath) {
      entryFor(extensionKey(filePath)).chunks += 1;
    }
  }

  let textSupportedFiles = 0;
  let parserSupportedFiles = 0;
  let textSupportedNoParserFiles = 0;
  for (const [ext, entry] of byExtension) {
    if (entry.text_supported === true) {
      textSupportedFiles += entry.candidate_files;
    }
    if (entry.parser_supported === true) {
      parserSupportedFiles += entry.candidate_files;
    }
    entry.text_supported_no_parser = entry.text_supported === true && entry.parser_supported !== true;
    if (entry.text_supported_no_parser) {
      textSupportedNoParserFiles += entry.candidate_files;
      incrementExtensionCount(textSupportedNoParserByExtension, ext, entry.candidate_files);
    }
  }

  const byExtensionObject = Object.fromEntries(
    [...byExtension.entries()]
      .sort((left, right) => right[1].candidate_files - left[1].candidate_files || left[0].localeCompare(right[0]))
      .map(([ext, entry]) => [ext, entry])
  );

  return {
    source: "workspace_scan",
    counts: {
      candidate_files: candidateList.length,
      indexed_files: indexedList.length,
      chunks: chunkList.length,
      text_supported_files: textSupportedFiles,
      parser_supported_files: parserSupportedFiles,
      text_supported_no_parser_files: textSupportedNoParserFiles,
      unsupported_files: Object.values(skippedByExtension.unsupported).reduce((acc, value) => acc + value, 0),
      too_large_files: Object.values(skippedByExtension.too_large).reduce((acc, value) => acc + value, 0),
      binary_files: Object.values(skippedByExtension.binary).reduce((acc, value) => acc + value, 0)
    },
    skipped: {
      ingest_totals: ingestSkipped ?? null,
      by_extension: {
        unsupported: sortedCountObject(skippedByExtension.unsupported),
        too_large: sortedCountObject(skippedByExtension.too_large),
        binary: sortedCountObject(skippedByExtension.binary)
      }
    },
    parser_eligibility: {
      text_supported_no_parser_by_extension: sortedCountObject(textSupportedNoParserByExtension),
      by_extension: byExtensionObject
    }
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
export const BOOTSTRAP_PHASE_KEYS = PHASE_MARKERS.map((marker) => marker.key);
const BOOTSTRAP_START = /\[cortex\] bootstrap start/;
const BOOTSTRAP_COMPLETE = /\[cortex\] bootstrap complete/;

export function detectBootstrapPhase(text) {
  if (typeof text !== "string") {
    return null;
  }
  for (const marker of PHASE_MARKERS) {
    if (marker.pattern.test(text)) {
      return marker.key;
    }
  }
  return null;
}

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

export function summarizeBootstrapMemory(samples) {
  const sampleList = Array.isArray(samples) ? samples : [];
  const byPhase = {};
  let maxRssKb = null;
  let maxSample = null;
  let firstTs = null;
  let lastTs = null;

  for (const sample of sampleList) {
    const rssKb = Number(sample?.rss_kb);
    if (!Number.isFinite(rssKb) || rssKb < 0) {
      continue;
    }
    const ts = Number(sample?.ts);
    if (Number.isFinite(ts)) {
      firstTs = firstTs === null ? ts : Math.min(firstTs, ts);
      lastTs = lastTs === null ? ts : Math.max(lastTs, ts);
    }
    const phase = BOOTSTRAP_PHASE_KEYS.includes(sample?.phase) ? sample.phase : "unknown";
    const phaseEntry = byPhase[phase] ?? { max_rss_kb: null, samples: 0 };
    phaseEntry.samples += 1;
    phaseEntry.max_rss_kb = phaseEntry.max_rss_kb === null ? rssKb : Math.max(phaseEntry.max_rss_kb, rssKb);
    byPhase[phase] = phaseEntry;

    if (maxRssKb === null || rssKb > maxRssKb) {
      maxRssKb = rssKb;
      maxSample = {
        ts: Number.isFinite(ts) ? ts : null,
        phase
      };
    }
  }

  if (maxRssKb === null) {
    return null;
  }
  return {
    max_rss_kb: maxRssKb,
    max_rss_mb: round(maxRssKb / 1024),
    max_phase: maxSample?.phase ?? null,
    sample_count: Object.values(byPhase).reduce((acc, entry) => acc + entry.samples, 0),
    duration_ms: firstTs !== null && lastTs !== null && lastTs >= firstTs ? lastTs - firstTs : null,
    by_phase: Object.fromEntries(
      Object.entries(byPhase)
        .sort((left, right) => {
          const leftIndex = BOOTSTRAP_PHASE_KEYS.indexOf(left[0]);
          const rightIndex = BOOTSTRAP_PHASE_KEYS.indexOf(right[0]);
          return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
        })
        .map(([phase, entry]) => [
          phase,
          {
            ...entry,
            max_rss_mb: round(entry.max_rss_kb / 1024)
          }
        ])
    )
  };
}
