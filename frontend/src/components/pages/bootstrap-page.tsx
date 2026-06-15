import { useEffect, useMemo, useState } from "react";
import { Boxes, Clock, Database, FileCode2, Network, Share2 } from "lucide-react";

import { RepoTable } from "@/components/bootstrap/repo-table";
import { VersionSelect } from "@/components/bootstrap/version-select";
import { StatCards } from "@/components/bootstrap/stat-cards";
import {
  CategoryBarChart,
  DistributionDonutChart,
  DistributionLineChart,
  RepoScatterChart,
  chartColor,
  type DistributionSlice,
  type HistogramSeries
} from "@/components/charts";
import { SectionShell } from "@/components/section-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { BootstrapSummaryDoc, HistogramBucket, RepoDetailDoc, RepoRow, VersionIndexEntry } from "@/data/bootstrap-types";
import { loadRepoDetail } from "@/data/load-bootstrap";
import { formatCount, formatDate, formatDuration, formatNumber, formatPercent, modelDisplayName } from "@/lib/format";
import { bootstrapHash } from "@/routes";

/** Metric per 1,000 lines of cortex-indexed code (suite volume-weighted). */
function perKiloLine(total: number | undefined, indexedLines: number | undefined): number | null {
  if (!Number.isFinite(total ?? NaN) || !Number.isFinite(indexedLines ?? NaN) || (indexedLines as number) < 1) {
    return null;
  }
  return Math.round(((total as number) / ((indexedLines as number) / 1000)) * 10) / 10;
}

/** Share of all tracked repo lines that cortex actually ingested. */
function coveragePct(indexedLines: number | undefined, trackedLines: number | undefined): number | null {
  if (
    !Number.isFinite(indexedLines ?? NaN) ||
    !Number.isFinite(trackedLines ?? NaN) ||
    (trackedLines as number) < 1
  ) {
    return null;
  }
  return Math.round(((indexedLines as number) / (trackedLines as number)) * 1000) / 10;
}

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "dataset", label: "Dataset" },
  { key: "chunks", label: "Chunks & models" },
  { key: "graph", label: "Graph" },
  { key: "languages", label: "Languages" },
  { key: "repositories", label: "Repositories" },
  { key: "methodology", label: "Methodology" }
] as const;

type TabKey = (typeof TABS)[number]["key"];
type ChunkDistributionMode = "all" | "language";
type LanguageTokenHistograms = Record<string, HistogramBucket[]>;

const REPO_SIZE_BUCKETS = [
  { id: "size-tiny", label: "<50k LOC", min: 0, max: 50_000 },
  { id: "size-small", label: "50k-100k", min: 50_000, max: 100_000 },
  { id: "size-medium", label: "100k-250k", min: 100_000, max: 250_000 },
  { id: "size-large", label: "250k-500k", min: 250_000, max: 500_000 },
  { id: "size-xlarge", label: "500k+ LOC", min: 500_000, max: Infinity }
] as const;

const ESTIMATED_CHARS_PER_TOKEN = 4;

function TabBar({ active, onSelect }: { active: TabKey; onSelect: (tab: TabKey) => void }) {
  return (
    <nav className="scrollbar-hidden flex gap-1 overflow-x-auto border-b" aria-label="Metric sections">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onSelect(tab.key)}
          className={
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring " +
            (active === tab.key
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground")
          }
          aria-current={active === tab.key ? "page" : undefined}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

function uniqueRepoRows(rows: RepoRow[]): RepoRow[] {
  const byKey = new Map<string, RepoRow>();
  for (const row of rows) {
    if (!byKey.has(row.key)) {
      byKey.set(row.key, row);
    }
  }
  return [...byKey.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function countMemberships(rows: RepoRow[], getValues: (row: RepoRow) => string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const value of getValues(row)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return counts;
}

function slicesFromCounts(counts: Map<string, number>): DistributionSlice[] {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([label, count], index) => ({
      id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-") || `slice-${index}`,
      label,
      count,
      fill: chartColor(index)
    }));
}

function slicesFromBuckets<T extends { id: string; label: string; min: number; max: number }>(
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

function tokenBucketLabel(min: number, max: number | null): string {
  const tokenMin = Math.floor(min / ESTIMATED_CHARS_PER_TOKEN);
  if (max === null) {
    return `${tokenMin}+`;
  }
  const tokenMax = Math.max(tokenMin, Math.ceil(max / ESTIMATED_CHARS_PER_TOKEN));
  return `${tokenMin}-${tokenMax}`;
}

function charHistogramToEstimatedTokens(histogram: HistogramBucket[] | null | undefined): HistogramBucket[] {
  return (histogram ?? []).map((bucket) => ({
    ...bucket,
    min: Math.floor(bucket.min / ESTIMATED_CHARS_PER_TOKEN),
    max: bucket.max === null ? null : Math.ceil(bucket.max / ESTIMATED_CHARS_PER_TOKEN),
    label: tokenBucketLabel(bucket.min, bucket.max)
  }));
}

function mergeHistograms(left: HistogramBucket[] | null | undefined, right: HistogramBucket[] | null | undefined) {
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

function mean(values: Array<number | null | undefined>): number | null {
  const finite = values.filter((value): value is number => Number.isFinite(value ?? NaN));
  if (finite.length === 0) {
    return null;
  }
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function aggregateLanguageCharHistograms(details: RepoDetailDoc[]): LanguageTokenHistograms {
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

export function BootstrapPage({
  summary,
  versions,
  selectedVersion
}: {
  summary: BootstrapSummaryDoc;
  versions: VersionIndexEntry[];
  selectedVersion: string;
}) {
  const { aggregate, run } = summary;
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
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

  const datasetBenchSlices = useMemo(
    () => slicesFromCounts(countMemberships(datasetRows, (row) => row.benches)),
    [datasetRows]
  );
  const datasetLanguageSlices = useMemo(
    () => slicesFromCounts(countMemberships(datasetRows, (row) => row.languages)),
    [datasetRows]
  );
  const datasetSizeSlices = useMemo(
    () => slicesFromBuckets(datasetRows, REPO_SIZE_BUCKETS, (row) => row.tracked_lines),
    [datasetRows]
  );
  const largestIndexedRepos = useMemo(
    () =>
      datasetRows
        .filter((row): row is RepoRow & { indexed_lines: number } =>
          Number.isFinite(row.indexed_lines ?? NaN)
        )
        .sort((left, right) => right.indexed_lines - left.indexed_lines)
        .slice(0, 10)
        .map((row) => ({ name: row.name, value: row.indexed_lines })),
    [datasetRows]
  );

  return (
    <main className="mx-auto flex max-w-[96rem] flex-col gap-10 px-4 pb-16 pt-8">
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-3xl font-semibold tracking-tight">Bootstrap metrics</h1>
          <VersionSelect
            versions={versions}
            selected={selectedVersion}
            onSelect={(version) => {
              window.location.hash = bootstrapHash(version);
            }}
          />
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Every repository below was bootstrapped from scratch in an isolated container: cloned at a pinned
          commit, indexed, embedded and graph-loaded with cortex built from source. Run{" "}
          <span className="font-medium text-foreground">{run.id}</span>
          {run.cortex_version ? ` · cortex v${run.cortex_version}` : ""} · {formatDate(run.generated_at)}.
        </p>
      </section>

      <TabBar active={activeTab} onSelect={setActiveTab} />

      {activeTab === "overview" ? (
        <>
          <StatCards
            stats={[
              {
                label: "Repositories",
                value: formatCount(aggregate.totals.repos),
                hint: `${formatCount(aggregate.totals.succeeded)} bootstrapped ok`,
                explanation: "Number of pinned repositories included in this bootstrap benchmark run.",
                icon: Database
              },
              {
                label: "Chunks / 1k LOC",
                value: formatNumber(perKiloLine(aggregate.totals.chunks, aggregate.totals.indexed_lines)),
                hint: "per 1,000 indexed lines",
                explanation:
                  "Chunks generated by Cortex per 1,000 indexed lines of code. LOC means lines of code; this uses indexed lines, not total repository lines.",
                icon: Boxes
              },
              {
                label: "Edges / 1k LOC",
                value: formatNumber(perKiloLine(aggregate.totals.edges, aggregate.totals.indexed_lines)),
                hint: "per 1,000 indexed lines",
                explanation:
                  "Graph relation edges loaded per 1,000 indexed lines of code. LOC means lines of code; this normalizes graph density by the code Cortex processed.",
                icon: Network
              },
              {
                label: "Cortex coverage",
                value: formatPercent(
                  coveragePct(aggregate.totals.indexed_lines, aggregate.totals.tracked_lines)
                ),
                hint: "indexed lines / repo lines",
                explanation:
                  "Share of tracked repository lines that Cortex indexed. Lower values usually mean generated, vendored, binary, or unsupported files were skipped.",
                icon: FileCode2
              },
              {
                label: "Embedding models",
                value: String(aggregate.totals.models.length),
                hint: aggregate.totals.models.map(modelDisplayName).join(", "),
                explanation: "Number of embedding models measured in this run.",
                icon: Share2
              },
              {
                label: "Time / 1k LOC",
                value: formatDuration(
                  perKiloLine(aggregate.totals.duration_ms, aggregate.totals.indexed_lines)
                ),
                hint: "bootstrap wall-clock",
                explanation:
                  "Total bootstrap wall-clock time per 1,000 indexed lines of code. LOC means lines of code, and the denominator is Cortex indexed lines.",
                icon: Clock
              }
            ]}
          />
          <SectionShell
            title="Repo size vs chunking output"
            description="Relationship between repository size and the number of chunks the ingest phase produced. Switch the size axis between all tracked files and the lines actually subject to cortex processing."
            headerAside={
              <ToggleGroup
                type="single"
                value={sizeAxis}
                onValueChange={(value) => value && setSizeAxis(value as "files" | "lines")}
              >
                <ToggleGroupItem value="files">Tracked files</ToggleGroupItem>
                <ToggleGroupItem value="lines">Indexed lines</ToggleGroupItem>
              </ToggleGroup>
            }
          >
            <Card>
              <CardContent className="pt-6">
                <RepoScatterChart
                  points={sizeScatter}
                  xLabel={sizeAxis === "files" ? "tracked files" : "indexed lines"}
                  yLabel="chunks"
                  height={340}
                />
              </CardContent>
            </Card>
          </SectionShell>
        </>
      ) : null}

      {activeTab === "dataset" ? (
        <>
          <StatCards
            stats={[
              {
                label: "Dataset repos",
                value: formatCount(datasetRows.length),
                hint: "unique pinned repositories",
                explanation: "Unique repositories included in this dataset view after de-duplicating embedding model runs.",
                icon: Database
              },
              {
                label: "Benchmark sources",
                value: formatCount(datasetBenchSlices.length),
                hint: "source benchmark tags",
                explanation:
                  "Distinct benchmark families that contributed repositories. A repository can carry more than one source tag.",
                icon: Share2
              },
              {
                label: "Language tags",
                value: formatCount(datasetLanguageSlices.length),
                hint: "detected primary tags",
                explanation:
                  "Distinct language tags attached to the pinned repositories. Multi-language repositories can contribute more than one tag.",
                icon: FileCode2
              },
              {
                label: "Tracked LOC",
                value: formatCount(aggregate.totals.tracked_lines),
                hint: "repo lines before filtering",
                explanation:
                  "Total tracked repository lines at the pinned commits. LOC means lines of code, although this raw count can include non-code tracked text.",
                icon: Network
              },
              {
                label: "Indexed LOC",
                value: formatCount(aggregate.totals.indexed_lines),
                hint: "lines Cortex processed",
                explanation:
                  "Total lines accepted by Cortex after source path, file kind, and ignore filtering. LOC means lines of code.",
                icon: Boxes
              },
              {
                label: "Coverage",
                value: formatPercent(
                  coveragePct(aggregate.totals.indexed_lines, aggregate.totals.tracked_lines)
                ),
                hint: "indexed / tracked LOC",
                explanation:
                  "Share of tracked lines included in Cortex indexing across this dataset.",
                icon: Clock
              }
            ]}
          />
          <SectionShell
            title="Dataset composition"
            description="How the benchmark corpus is distributed by source dataset, language, repository size and indexed-line coverage."
          >
            <div className="grid gap-8 lg:grid-cols-3">
              <DatasetChartCard title="Benchmark sources" description="Repository memberships by source benchmark">
                <DistributionDonutChart
                  data={datasetBenchSlices}
                  centerLabel="sources"
                  valueLabel="memberships"
                />
              </DatasetChartCard>
              <DatasetChartCard title="Languages" description="Repository language tags">
                <DistributionDonutChart
                  data={datasetLanguageSlices}
                  variant="label"
                  centerLabel="tags"
                  valueLabel="tags"
                />
              </DatasetChartCard>
              <DatasetChartCard title="Repository size" description="Tracked LOC buckets">
                <DistributionDonutChart
                  data={datasetSizeSlices}
                  variant="label"
                  centerLabel="repos"
                  valueLabel="repos"
                />
              </DatasetChartCard>
            </div>
          </SectionShell>
          <SectionShell
            title="Largest indexed repositories"
            description="Top repositories by lines accepted into Cortex indexing. This highlights which projects dominate the processing volume."
          >
            <Card>
              <CardContent className="pt-6">
                <CategoryBarChart data={largestIndexedRepos} valueLabel="indexed lines" colorByIndex />
              </CardContent>
            </Card>
          </SectionShell>
        </>
      ) : null}

      {activeTab === "chunks" ? (
      <SectionShell
        title="Chunk token distribution"
        description="Number of chunks by estimated token size. Token buckets are estimated from exported character counts at roughly four characters per token."
        headerAside={
          <ToggleGroup
            type="single"
            value={chunkDistributionMode}
            onValueChange={(value) => value && setChunkDistributionMode(value as ChunkDistributionMode)}
          >
            <ToggleGroupItem value="all">All languages</ToggleGroupItem>
            <ToggleGroupItem value="language">Per language</ToggleGroupItem>
          </ToggleGroup>
        }
      >
        <Card>
          <CardContent className="space-y-3 pt-6">
            {languageTokenError ? (
              <p className="text-sm text-rose-700">{languageTokenError}</p>
            ) : chunkDistributionMode === "language" && !languageTokenHistograms ? (
              <p className="text-sm text-muted-foreground">Loading per-language chunk distributions…</p>
            ) : null}
            <DistributionLineChart series={chunkTokenSeries} unit="estimated tokens" valueLabel="chunks" height={360} />
          </CardContent>
        </Card>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Average chunk connectivity</CardTitle>
              <CardDescription>Average CALLS chunk-to-chunk edge metrics across repositories.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <ModelStat label="Avg CALLS edges" value={formatNumber(chunkConnectivitySummary.avgCallsEdges, 0)} />
              <ModelStat label="Avg degree" value={formatNumber(chunkConnectivitySummary.avgDegree)} />
              <ModelStat label="Avg max degree" value={formatNumber(chunkConnectivitySummary.avgMaxDegree, 0)} />
              <ModelStat label="Avg isolated" value={formatPercent(chunkConnectivitySummary.avgIsolatedPct)} />
            </CardContent>
          </Card>
          <ChartCard
            title="Isolated chunks by repository"
            description="Each point is a repository, colored by primary language."
          >
            <RepoScatterChart
              points={isolatedScatter}
              xLabel="indexed lines"
              yLabel="isolated chunks (%)"
              yValueFormatter={(value) => formatPercent(value)}
              height={320}
            />
          </ChartCard>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {models.map(([model, rollup]) => (
            <Card key={model}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{modelDisplayName(model)}</CardTitle>
                <CardDescription className="break-all text-xs">{model}</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <ModelStat label="Dimensions" value={rollup.dimensions ? String(rollup.dimensions) : "—"} />
                <ModelStat label="Repos" value={formatCount(rollup.repos)} />
                <ModelStat label="Chunks" value={formatCount(rollup.chunks)} />
                <ModelStat label="Vectors" value={formatCount(rollup.embedded)} />
                <ModelStat label="Failed" value={formatCount(rollup.failed_embeddings)} />
                <ModelStat
                  label="Throughput"
                  value={rollup.avg_throughput_per_s ? `${formatNumber(rollup.avg_throughput_per_s)}/s` : "—"}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      </SectionShell>
      ) : null}

      {activeTab === "graph" ? (
      <SectionShell
        title="Graph interconnection"
        description="How chunks relate to each other in the graph model: total edges per relation type across all repos, and per-repo chunk-to-chunk connectivity (CALLS edges)."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Relations by type" description="Edges loaded into RyuGraph across all repos">
            <CategoryBarChart data={relationTypes} valueLabel="edges" />
          </ChartCard>
          <ChartCard
            title="Chunks vs chunk-to-chunk edges"
            description="Each point is a repository; more edges per chunk means a denser call graph"
          >
            <RepoScatterChart points={connectivityScatter} xLabel="chunks" yLabel="CALLS edges" />
          </ChartCard>
        </div>
      </SectionShell>
      ) : null}

      {activeTab === "languages" ? (
      <SectionShell
        title="Languages"
        description="Normalized chunking intensity and typical chunk size per language, aggregated over every repository in the run."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Chunks / 1k indexed LOC by language"
            description="Chunks per 1,000 Cortex-indexed lines, grouped by each repository's primary language."
          >
            <CategoryBarChart data={languageChunkIntensity} valueLabel="chunks / 1k LOC" colorByIndex />
          </ChartCard>
          <ChartCard title="Mean chunk size by language" description="Average chunk length in lines">
            <CategoryBarChart data={languageMeanLines} valueLabel="lines (mean)" colorByIndex />
          </ChartCard>
        </div>
      </SectionShell>
      ) : null}

      {activeTab === "repositories" ? (
      <SectionShell
        title="Per-repository results"
        description="Click a row for the full per-repo breakdown: timings, chunk histograms, relation types, degree distribution and most-connected chunks."
      >
        <RepoTable rows={aggregate.repo_rows} version={selectedVersion} />
      </SectionShell>
      ) : null}

      {activeTab === "methodology" ? (
      <SectionShell title="Methodology">
        <Card>
          <CardContent className="space-y-3 pt-6 text-sm text-muted-foreground">
            <p>
              Test repositories come from the datasets behind SWE-bench Verified, SWE-bench Pro, SWE-PolyBench
              and Multi-SWE-Bench — 67 large, actively developed projects across eight languages — plus cortex
              and AgentStackBench themselves. Each repo is pinned to a fixed commit so runs are repeatable on
              identical inputs; pins are refreshed deliberately, never implicitly.
            </p>
            <p>
              For every (repository × embedding model) pair, an isolated Docker container clones the pinned
              commit, installs cortex packed from the local source tree, runs{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">cortex init</code> +{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">cortex bootstrap</code>, and extracts
              statistics from the resulting <code className="rounded bg-muted px-1 py-0.5 text-xs">.context/</code>{" "}
              artifacts. See <code className="rounded bg-muted px-1 py-0.5 text-xs">benchmark/bootstrapbench/</code>{" "}
              in the repository for the harness.
            </p>
          </CardContent>
        </Card>
      </SectionShell>
      ) : null}
    </main>
  );
}

function ModelStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function ChartCard({
  title,
  description,
  children
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function DatasetChartCard({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="pb-2 text-center">
        <h3 className="text-base font-semibold leading-none tracking-tight">{title}</h3>
        <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
      </div>
      <div>{children}</div>
    </div>
  );
}
