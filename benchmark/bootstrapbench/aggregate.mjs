/**
 * Cross-repo aggregation for bootstrapbench results plus the adapter that
 * shapes results into the static JSON consumed by the frontend (site-data/).
 *
 * Input items are the per-(repo x embedding model) stats documents produced by
 * extract-stats.mjs. All functions are pure; callers handle file I/O.
 */
import { mergeHistograms } from "./stats.mjs";

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function isSuccess(item) {
  return item?.run?.status === "ok" || item?.run?.status === "embed_failed";
}

function addTo(target, key, amount) {
  if (Number.isFinite(amount)) {
    target[key] = (target[key] ?? 0) + amount;
  }
}

function buildModelRollups(succeeded) {
  const byModel = {};
  for (const item of succeeded) {
    const model = item.run?.embed_model ?? "unknown";
    const entry =
      byModel[model] ??
      {
        items: 0,
        repos: new Set(),
        chunks: 0,
        embedded: 0,
        failed_embeddings: 0,
        dimensions: null,
        throughputs: [],
        chunk_lines_histogram: null,
        chunk_chars_histogram: null
      };
    entry.items += 1;
    entry.repos.add(item.repo?.key ?? "unknown");
    entry.chunks += item.chunks?.total ?? 0;
    entry.embedded += item.embeddings?.counts?.embedded ?? 0;
    entry.failed_embeddings += item.embeddings?.counts?.failed ?? 0;
    if (item.embeddings?.dimensions) {
      entry.dimensions = item.embeddings.dimensions;
    }
    if (Number.isFinite(item.embeddings?.throughput_per_s)) {
      entry.throughputs.push(item.embeddings.throughput_per_s);
    }
    if (item.chunks?.lines?.histogram) {
      entry.chunk_lines_histogram = mergeHistograms(entry.chunk_lines_histogram, item.chunks.lines.histogram);
    }
    if (item.chunks?.chars?.histogram) {
      entry.chunk_chars_histogram = mergeHistograms(entry.chunk_chars_histogram, item.chunks.chars.histogram);
    }
    byModel[model] = entry;
  }

  return Object.fromEntries(
    Object.entries(byModel).map(([model, entry]) => [
      model,
      {
        items: entry.items,
        repos: entry.repos.size,
        chunks: entry.chunks,
        embedded: entry.embedded,
        failed_embeddings: entry.failed_embeddings,
        dimensions: entry.dimensions,
        avg_throughput_per_s:
          entry.throughputs.length > 0
            ? round(entry.throughputs.reduce((acc, value) => acc + value, 0) / entry.throughputs.length)
            : null,
        chunk_lines_histogram: entry.chunk_lines_histogram,
        chunk_chars_histogram: entry.chunk_chars_histogram
      }
    ])
  );
}

function buildLanguageRollups(succeeded) {
  const byLanguage = {};
  for (const item of succeeded) {
    for (const [language, entry] of Object.entries(item.chunks?.by_language ?? {})) {
      const rollup =
        byLanguage[language] ??
        { chunks: 0, repos: new Set(), weighted_line_sum: 0, weighted_line_count: 0, lines_histogram: null };
      rollup.chunks += entry.count ?? 0;
      rollup.repos.add(item.repo?.key ?? "unknown");
      if (entry.lines && Number.isFinite(entry.lines.mean) && Number.isFinite(entry.lines.count)) {
        rollup.weighted_line_sum += entry.lines.mean * entry.lines.count;
        rollup.weighted_line_count += entry.lines.count;
      }
      if (entry.lines?.histogram) {
        rollup.lines_histogram = mergeHistograms(rollup.lines_histogram, entry.lines.histogram);
      }
      byLanguage[language] = rollup;
    }
  }

  return Object.fromEntries(
    Object.entries(byLanguage).map(([language, rollup]) => [
      language,
      {
        chunks: rollup.chunks,
        repos: rollup.repos.size,
        mean_chunk_lines:
          rollup.weighted_line_count > 0 ? round(rollup.weighted_line_sum / rollup.weighted_line_count) : null,
        lines_histogram: rollup.lines_histogram
      }
    ])
  );
}

function buildRepoIndexRow(item) {
  return {
    key: item.repo?.key ?? "unknown",
    name: item.repo?.name ?? "unknown",
    languages: item.repo?.languages ?? [],
    benches: item.repo?.benches ?? [],
    sha: item.repo?.sha ?? null,
    model: item.run?.embed_model ?? null,
    status: item.run?.status ?? "error",
    error: item.run?.error ?? null,
    tracked_files: item.workspace?.tracked_files ?? null,
    tracked_bytes: item.workspace?.tracked_bytes ?? null,
    tracked_lines: item.workspace?.tracked_lines ?? null,
    indexed_lines: item.files?.indexed_lines ?? null,
    files: item.files?.total ?? null,
    chunks: item.chunks?.total ?? null,
    chunk_p50_lines: item.chunks?.lines?.p50 ?? null,
    chunk_mean_lines: item.chunks?.lines?.mean ?? null,
    edges: item.graph?.edges?.total ?? null,
    chunk_chunk_edges: item.graph?.chunk_connectivity?.chunk_chunk_edges ?? null,
    avg_degree: item.graph?.chunk_connectivity?.avg_degree ?? null,
    isolated_pct: item.graph?.chunk_connectivity?.isolated_pct ?? null,
    embedded: item.embeddings?.counts?.embedded ?? null,
    dimensions: item.embeddings?.dimensions ?? null,
    total_ms: item.timings_ms?.total ?? null,
    ingest_ms: item.timings_ms?.ingest ?? null,
    embed_ms: item.timings_ms?.embed ?? null
  };
}

/** Aggregates per-(repo x model) stats items into one run-level summary. */
export function aggregateResults(items) {
  if (!Array.isArray(items)) {
    throw new Error("aggregateResults expects an array of stats items");
  }
  const succeeded = items.filter(isSuccess);
  const failed = items.filter((item) => !isSuccess(item));

  const totals = { items: items.length, succeeded: succeeded.length, failed: failed.length };
  const relationsByType = {};
  for (const item of succeeded) {
    addTo(totals, "chunks", item.chunks?.total);
    addTo(totals, "files", item.files?.total);
    addTo(totals, "edges", item.graph?.edges?.total);
    addTo(totals, "duration_ms", item.timings_ms?.total);
    addTo(totals, "indexed_lines", item.files?.indexed_lines);
    addTo(totals, "tracked_lines", item.workspace?.tracked_lines);
    for (const [type, count] of Object.entries(item.graph?.edges?.by_type ?? {})) {
      addTo(relationsByType, type, count);
    }
  }
  totals.repos = new Set(items.map((item) => item.repo?.key ?? "unknown")).size;
  totals.models = [...new Set(items.map((item) => item.run?.embed_model).filter(Boolean))].sort();

  return {
    totals,
    by_model: buildModelRollups(succeeded),
    by_language: buildLanguageRollups(succeeded),
    relations_by_type: relationsByType,
    repo_rows: items.map(buildRepoIndexRow)
  };
}

function stripHeavyFields(item) {
  // Per-repo site files keep full detail; the run summary keeps slim rows.
  // Drop raw log references and any future bulky fields defensively.
  const { raw_log: _rawLog, ...rest } = item;
  return rest;
}

/**
 * Shapes a finished run into the static site-data payloads:
 *  - summary: one document for the aggregate bootstrap page
 *  - repos: one document per repo (all embedding-model runs grouped together)
 */
export function buildSiteData({ runId, generatedAt, cortexVersion, items }) {
  if (!runId || typeof runId !== "string") {
    throw new Error("buildSiteData requires a runId");
  }
  if (!Array.isArray(items)) {
    throw new Error("buildSiteData requires an items array");
  }

  const aggregate = aggregateResults(items);

  const byRepo = new Map();
  for (const item of items) {
    const key = item.repo?.key ?? "unknown";
    const existing = byRepo.get(key) ?? { repo: item.repo ?? { key }, runs: [] };
    existing.runs.push(stripHeavyFields(item));
    byRepo.set(key, existing);
  }

  const repoSummaries = [...byRepo.entries()]
    .map(([key, entry]) => ({
      key,
      name: entry.repo?.name ?? key,
      languages: entry.repo?.languages ?? [],
      benches: entry.repo?.benches ?? [],
      models: [...new Set(entry.runs.map((run) => run.run?.embed_model).filter(Boolean))],
      statuses: entry.runs.map((run) => run.run?.status ?? "error"),
      chunks: entry.runs.find((run) => Number.isFinite(run.chunks?.total))?.chunks?.total ?? null,
      edges: entry.runs.find((run) => Number.isFinite(run.graph?.edges?.total))?.graph?.edges?.total ?? null
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    summary: {
      schema_version: 1,
      run: {
        id: runId,
        generated_at: generatedAt ?? null,
        cortex_version: cortexVersion ?? null
      },
      aggregate,
      repos: repoSummaries
    },
    repos: [...byRepo.entries()].map(([key, entry]) => ({
      key,
      data: {
        schema_version: 1,
        run: { id: runId, generated_at: generatedAt ?? null, cortex_version: cortexVersion ?? null },
        repo: entry.repo,
        runs: entry.runs
      }
    }))
  };
}

/**
 * Descending semver-ish comparator: numeric dot segments compared piecewise;
 * a release sorts above its own pre-release ("2.1.0" > "2.1.0-rc.1").
 */
export function compareVersionsDesc(left, right) {
  const parse = (value) => {
    const [core, pre = null] = String(value).split("-", 2);
    const nums = core.split(".").map((part) => Number.parseInt(part, 10) || 0);
    return { nums, pre };
  };
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.nums.length, b.nums.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (b.nums[i] ?? 0) - (a.nums[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  if (a.pre === b.pre) {
    return 0;
  }
  if (a.pre === null) {
    return -1; // release before pre-release in descending order
  }
  if (b.pre === null) {
    return 1;
  }
  return a.pre < b.pre ? 1 : -1;
}

/**
 * Adds or replaces one published-version entry in the site index. Returns a
 * new index document (never mutates the input); entries are kept sorted by
 * version, newest first.
 */
export function mergeVersionIndex(existing, entry) {
  if (!entry || typeof entry.version !== "string" || !entry.version.trim()) {
    throw new Error("mergeVersionIndex requires an entry with a version");
  }
  const current = Array.isArray(existing?.versions) ? existing.versions : [];
  const others = current.filter((item) => item?.version !== entry.version);
  const versions = [...others, { ...entry }].sort((a, b) => compareVersionsDesc(a.version, b.version));
  return { schema_version: 1, versions };
}
