import { chartColor, type DistributionSlice } from "@/components/charts";
import type { HistogramBucket, RepoDetailDoc, RepoRow } from "@/data/bootstrap-types";

export type LanguageTokenHistograms = Record<string, HistogramBucket[]>;

export const REPO_SIZE_BUCKETS = [
  { id: "size-tiny", label: "<50k LOC", min: 0, max: 50_000 },
  { id: "size-small", label: "50k-100k", min: 50_000, max: 100_000 },
  { id: "size-medium", label: "100k-250k", min: 100_000, max: 250_000 },
  { id: "size-large", label: "250k-500k", min: 250_000, max: 500_000 },
  { id: "size-xlarge", label: "500k+ LOC", min: 500_000, max: Infinity }
] as const;

export const ESTIMATED_CHARS_PER_TOKEN = 4;

/** Metric per 1,000 lines of cortex-indexed code (suite volume-weighted). */
export function perKiloLine(total: number | undefined, indexedLines: number | undefined): number | null {
  if (!Number.isFinite(total ?? NaN) || !Number.isFinite(indexedLines ?? NaN) || (indexedLines as number) < 1) {
    return null;
  }
  return Math.round(((total as number) / ((indexedLines as number) / 1000)) * 10) / 10;
}

/** Share of all tracked repo lines that cortex actually ingested. */
export function coveragePct(indexedLines: number | undefined, trackedLines: number | undefined): number | null {
  if (
    !Number.isFinite(indexedLines ?? NaN) ||
    !Number.isFinite(trackedLines ?? NaN) ||
    (trackedLines as number) < 1
  ) {
    return null;
  }
  return Math.round(((indexedLines as number) / (trackedLines as number)) * 1000) / 10;
}

export function uniqueRepoRows(rows: RepoRow[]): RepoRow[] {
  const byKey = new Map<string, RepoRow>();
  for (const row of rows) {
    if (!byKey.has(row.key)) {
      byKey.set(row.key, row);
    }
  }
  return [...byKey.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function countMemberships(rows: RepoRow[], getValues: (row: RepoRow) => string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const value of getValues(row)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return counts;
}

export function slicesFromCounts(counts: Map<string, number>): DistributionSlice[] {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([label, count], index) => ({
      id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-") || `slice-${index}`,
      label,
      count,
      fill: chartColor(index)
    }));
}

export function slicesFromBuckets<T extends { id: string; label: string; min: number; max: number }>(
  rows: RepoRow[],
  buckets: readonly T[],
  getValue: (row: RepoRow) => number | null | undefined
): DistributionSlice[] {
  return buckets
    .map((bucket, index) => ({
      id: bucket.id,
      label: bucket.label,
      count: rows.filter((row) => {
        const value = getValue(row);
        return Number.isFinite(value ?? NaN) && (value as number) >= bucket.min && (value as number) < bucket.max;
      }).length,
      fill: chartColor(index)
    }))
    .filter((entry) => entry.count > 0);
}

export function tokenBucketLabel(min: number, max: number | null): string {
  const tokenMin = Math.floor(min / ESTIMATED_CHARS_PER_TOKEN);
  if (max === null) {
    return `${tokenMin}+`;
  }
  const tokenMax = Math.max(tokenMin, Math.ceil(max / ESTIMATED_CHARS_PER_TOKEN));
  return `${tokenMin}-${tokenMax}`;
}

export function charHistogramToEstimatedTokens(histogram: HistogramBucket[] | null | undefined): HistogramBucket[] {
  return (histogram ?? []).map((bucket) => ({
    ...bucket,
    min: Math.floor(bucket.min / ESTIMATED_CHARS_PER_TOKEN),
    max: bucket.max === null ? null : Math.ceil(bucket.max / ESTIMATED_CHARS_PER_TOKEN),
    label: tokenBucketLabel(bucket.min, bucket.max)
  }));
}

export function mergeHistograms(left: HistogramBucket[] | null | undefined, right: HistogramBucket[] | null | undefined) {
  if (!left || left.length === 0) {
    return right ? right.map((bucket) => ({ ...bucket })) : [];
  }
  if (!right || right.length === 0) {
    return left.map((bucket) => ({ ...bucket }));
  }
  return left.map((bucket, index) => ({
    ...bucket,
    count: bucket.count + (right[index]?.count ?? 0)
  }));
}

export function mean(values: Array<number | null | undefined>): number | null {
  const finite = values.filter((value): value is number => Number.isFinite(value ?? NaN));
  if (finite.length === 0) {
    return null;
  }
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

export function aggregateLanguageCharHistograms(details: RepoDetailDoc[]): LanguageTokenHistograms {
  const histograms: LanguageTokenHistograms = {};
  for (const detail of details) {
    const run = detail.runs.find((item) => item.run.status === "ok" || item.run.status === "embed_failed") ?? detail.runs[0];
    if (!run?.chunks?.by_language) {
      continue;
    }
    for (const [language, stats] of Object.entries(run.chunks.by_language)) {
      histograms[language] = mergeHistograms(histograms[language], stats.chars?.histogram);
    }
  }
  return histograms;
}
