import { useMemo, useState } from "react";
import { Boxes, Clock, Database, FileCode2, Network, Share2 } from "lucide-react";

import { RepoTable } from "@/components/bootstrap/repo-table";
import { VersionSelect } from "@/components/bootstrap/version-select";
import { StatCards } from "@/components/bootstrap/stat-cards";
import { CategoryBarChart, HistogramChart, RepoScatterChart, chartColor } from "@/components/charts";
import { SectionShell } from "@/components/section-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { BootstrapSummaryDoc, VersionIndexEntry } from "@/data/bootstrap-types";
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
  { key: "chunks", label: "Chunks & models" },
  { key: "graph", label: "Graph" },
  { key: "languages", label: "Languages" },
  { key: "repositories", label: "Repositories" },
  { key: "methodology", label: "Methodology" }
] as const;

type TabKey = (typeof TABS)[number]["key"];

function TabBar({ active, onSelect }: { active: TabKey; onSelect: (tab: TabKey) => void }) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b" aria-label="Metric sections">
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
  const [sizeUnit, setSizeUnit] = useState<"lines" | "chars">("lines");
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [sizeAxis, setSizeAxis] = useState<"files" | "lines">("files");

  const models = Object.entries(aggregate.by_model);
  const okRows = useMemo(
    () => aggregate.repo_rows.filter((row) => row.status === "ok" || row.status === "embed_failed"),
    [aggregate.repo_rows]
  );

  const histogramSeries = models.map(([model, rollup], index) => ({
    name: modelDisplayName(model),
    histogram: (sizeUnit === "lines" ? rollup.chunk_lines_histogram : rollup.chunk_chars_histogram) ?? [],
    color: chartColor(index)
  }));

  const languageChunks = Object.entries(aggregate.by_language)
    .map(([language, rollup]) => ({ name: language, value: rollup.chunks }))
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
                icon: Database
              },
              {
                label: "Chunks / 1k LOC",
                value: formatNumber(perKiloLine(aggregate.totals.chunks, aggregate.totals.indexed_lines)),
                hint: "per 1,000 indexed lines",
                icon: Boxes
              },
              {
                label: "Edges / 1k LOC",
                value: formatNumber(perKiloLine(aggregate.totals.edges, aggregate.totals.indexed_lines)),
                hint: "per 1,000 indexed lines",
                icon: Network
              },
              {
                label: "Cortex coverage",
                value: formatPercent(
                  coveragePct(aggregate.totals.indexed_lines, aggregate.totals.tracked_lines)
                ),
                hint: "indexed lines / repo lines",
                icon: FileCode2
              },
              {
                label: "Embedding models",
                value: String(aggregate.totals.models.length),
                hint: aggregate.totals.models.map(modelDisplayName).join(", "),
                icon: Share2
              },
              {
                label: "Time / 1k LOC",
                value: formatDuration(
                  perKiloLine(aggregate.totals.duration_ms, aggregate.totals.indexed_lines)
                ),
                hint: "bootstrap wall-clock",
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

      {activeTab === "chunks" ? (
      <SectionShell
        title="Chunk sizes vs embedding models"
        description="Distribution of chunk sizes produced by the ingest phase, grouped per embedding model run. Buckets are fixed so models and runs are directly comparable."
        headerAside={
          <ToggleGroup
            type="single"
            value={sizeUnit}
            onValueChange={(value) => value && setSizeUnit(value as "lines" | "chars")}
          >
            <ToggleGroupItem value="lines">Lines</ToggleGroupItem>
            <ToggleGroupItem value="chars">Characters</ToggleGroupItem>
          </ToggleGroup>
        }
      >
        <Card>
          <CardContent className="pt-6">
            <HistogramChart series={histogramSeries} unit={sizeUnit} height={300} />
          </CardContent>
        </Card>
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
        description="Chunk volume and typical chunk size per language, aggregated over every repository in the run."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Chunks by language" description="Total chunks produced per language">
            <CategoryBarChart data={languageChunks} valueLabel="chunks" colorByIndex />
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
