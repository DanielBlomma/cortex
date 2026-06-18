import { useEffect, useMemo, useState } from "react";

import { chartColor, type HistogramSeries } from "@/components/charts";
import type { BootstrapSummaryDoc, HistogramBucket, RepoDetailDoc, RepoRow } from "@/data/bootstrap-types";
import { loadRepoDetail } from "@/data/load-bootstrap";

import type { TabKey } from "./tab-bar";
import {
  REPO_SIZE_BUCKETS,
  aggregateLanguageCharHistograms,
  charHistogramToEstimatedTokens,
  countMemberships,
  mean,
  mergeHistograms,
  perKiloLine,
  slicesFromBuckets,
  slicesFromCounts,
  uniqueRepoRows,
  type LanguageTokenHistograms
} from "./metrics";

export type ChunkDistributionMode = "all" | "language";

export function useBootstrapDashboardData({
  summary,
  selectedVersion,
  activeTab
}: {
  summary: BootstrapSummaryDoc;
  selectedVersion: string;
  activeTab: TabKey;
}) {
  const { aggregate } = summary;
  const [chunkDistributionMode, setChunkDistributionMode] = useState<ChunkDistributionMode>("all");
  const [sizeAxis, setSizeAxis] = useState<"files" | "lines">("files");
  const [chunkDetails, setChunkDetails] = useState<RepoDetailDoc[] | null>(null);
  const [languageTokenHistograms, setLanguageTokenHistograms] = useState<LanguageTokenHistograms | null>(null);
  const [languageTokenError, setLanguageTokenError] = useState<string | null>(null);

  const models = Object.entries(aggregate.by_model);
  const okRows = useMemo(
    () => aggregate.repo_rows.filter((row) => row.status === "ok" || row.status === "embed_failed"),
    [aggregate.repo_rows]
  );
  const datasetRows = useMemo(() => uniqueRepoRows(okRows), [okRows]);

  useEffect(() => {
    setChunkDetails(null);
    setLanguageTokenHistograms(null);
    setLanguageTokenError(null);
  }, [selectedVersion]);

  useEffect(() => {
    if (activeTab !== "chunks" || chunkDetails) {
      return;
    }
    let active = true;
    setLanguageTokenError(null);
    void Promise.all(datasetRows.map((row) => loadRepoDetail(selectedVersion, row.key)))
      .then((details) => {
        if (active) {
          const loadedDetails = details.filter(Boolean) as RepoDetailDoc[];
          setChunkDetails(loadedDetails);
          setLanguageTokenHistograms(aggregateLanguageCharHistograms(loadedDetails));
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLanguageTokenError(error instanceof Error ? error.message : "Failed to load per-language chunk data.");
        }
      });
    return () => {
      active = false;
    };
  }, [activeTab, chunkDetails, datasetRows, selectedVersion]);

  const allLanguageTokenSeries: HistogramSeries[] = useMemo(() => {
    const merged = languageTokenHistograms
      ? Object.values(languageTokenHistograms).reduce<HistogramBucket[]>((acc, histogram) => mergeHistograms(acc, histogram), [])
      : models[0]?.[1].chunk_chars_histogram ?? [];
    return [
      {
        name: "All languages",
        histogram: charHistogramToEstimatedTokens(merged),
        color: chartColor(0)
      }
    ];
  }, [languageTokenHistograms, models]);

  const perLanguageTokenSeries: HistogramSeries[] = useMemo(
    () =>
      Object.entries(languageTokenHistograms ?? {})
        .sort((left, right) => {
          const leftTotal = left[1].reduce((sum, bucket) => sum + bucket.count, 0);
          const rightTotal = right[1].reduce((sum, bucket) => sum + bucket.count, 0);
          return rightTotal - leftTotal || left[0].localeCompare(right[0]);
        })
        .map(([language, histogram], index) => ({
          name: language,
          histogram: charHistogramToEstimatedTokens(histogram),
          color: chartColor(index)
        })),
    [languageTokenHistograms]
  );

  const chunkTokenSeries = chunkDistributionMode === "language" ? perLanguageTokenSeries : allLanguageTokenSeries;

  const languageChunkIntensity = Object.entries(
    datasetRows.reduce<Record<string, { chunks: number; indexedLines: number }>>((acc, row) => {
      const language = row.languages[0] ?? "unknown";
      const chunks = Number.isFinite(row.chunks ?? NaN) ? (row.chunks as number) : 0;
      const indexedLines = Number.isFinite(row.indexed_lines ?? NaN) ? (row.indexed_lines as number) : 0;
      const current = acc[language] ?? { chunks: 0, indexedLines: 0 };
      current.chunks += chunks;
      current.indexedLines += indexedLines;
      acc[language] = current;
      return acc;
    }, {})
  )
    .map(([language, rollup]) => ({
      name: language,
      value: perKiloLine(rollup.chunks, rollup.indexedLines) ?? 0
    }))
    .filter((entry) => entry.value > 0)
    .sort((left, right) => right.value - left.value);

  const languageMeanLines = Object.entries(aggregate.by_language)
    .map(([language, rollup]) => ({ name: language, value: rollup.mean_chunk_lines ?? 0 }))
    .filter((entry) => entry.value > 0)
    .sort((left, right) => right.value - left.value);

  const relationTypes = Object.entries(aggregate.relations_by_type)
    .map(([type, count]) => ({ name: type, value: count }))
    .filter((entry) => entry.value > 0)
    .sort((left, right) => right.value - left.value);

  const sizeScatter = okRows
    .map((row) => ({
      x: sizeAxis === "files" ? row.tracked_files : row.indexed_lines,
      y: row.chunks,
      name: row.name,
      group: row.languages[0] ?? "other"
    }))
    .filter((point): point is { x: number; y: number; name: string; group: string } =>
      point.x !== null && Number.isFinite(point.x) && point.y !== null && Number.isFinite(point.y)
    );

  const connectivityScatter = okRows
    .filter((row) => row.chunks !== null && row.chunk_chunk_edges !== null)
    .map((row) => ({
      x: row.chunks as number,
      y: row.chunk_chunk_edges as number,
      name: row.name,
      group: row.languages[0] ?? "other"
    }));

  const chunkConnectivitySummary = useMemo(() => {
    const maxDegrees = (chunkDetails ?? []).map((detail) => {
      const run = detail.runs.find((item) => item.run.status === "ok" || item.run.status === "embed_failed") ?? detail.runs[0];
      return run?.graph?.chunk_connectivity.max_degree;
    });
    return {
      avgCallsEdges: mean(datasetRows.map((row) => row.chunk_chunk_edges)),
      avgDegree: mean(datasetRows.map((row) => row.avg_degree)),
      avgMaxDegree: mean(maxDegrees),
      avgIsolatedPct: mean(datasetRows.map((row) => row.isolated_pct))
    };
  }, [chunkDetails, datasetRows]);

  const isolatedScatter = datasetRows
    .filter(
      (row): row is RepoRow & { indexed_lines: number; isolated_pct: number } =>
        Number.isFinite(row.indexed_lines ?? NaN) && Number.isFinite(row.isolated_pct ?? NaN)
    )
    .map((row) => ({
      x: row.indexed_lines,
      y: row.isolated_pct,
      name: row.name,
      group: row.languages[0] ?? "other"
    }));

  return {
    chunkConnectivitySummary,
    chunkDistributionMode,
    chunkTokenSeries,
    connectivityScatter,
    datasetBenchSlices: slicesFromCounts(countMemberships(datasetRows, (row) => row.benches)),
    datasetLanguageSlices: slicesFromCounts(countMemberships(datasetRows, (row) => row.languages)),
    datasetRows,
    datasetSizeSlices: slicesFromBuckets(datasetRows, REPO_SIZE_BUCKETS, (row) => row.tracked_lines),
    isolatedScatter,
    languageChunkIntensity,
    languageMeanLines,
    languageTokenError,
    languageTokenHistograms,
    largestIndexedRepos: datasetRows
      .filter((row): row is RepoRow & { indexed_lines: number } => Number.isFinite(row.indexed_lines ?? NaN))
      .sort((left, right) => right.indexed_lines - left.indexed_lines)
      .slice(0, 10)
      .map((row) => ({ name: row.name, value: row.indexed_lines })),
    models,
    relationTypes,
    setChunkDistributionMode,
    setSizeAxis,
    sizeAxis,
    sizeScatter
  };
}
