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
import { formatCount, formatDate, formatDuration, formatNumber, modelDisplayName } from "@/lib/format";
import { bootstrapHash } from "@/routes";

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
    .filter((row) => row.tracked_files !== null && row.chunks !== null)
    .map((row) => ({
      x: row.tracked_files as number,
      y: row.chunks as number,
      name: row.name,
      group: row.languages[0] ?? "other"
    }));

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

      <StatCards
        stats={[
          { label: "Repositories", value: formatCount(aggregate.totals.repos), icon: Database },
          { label: "Files indexed", value: formatCount(aggregate.totals.files ?? null), icon: FileCode2 },
          { label: "Chunks", value: formatCount(aggregate.totals.chunks ?? null), icon: Boxes },
          { label: "Graph edges", value: formatCount(aggregate.totals.edges ?? null), icon: Network },
          {
            label: "Embedding models",
            value: String(aggregate.totals.models.length),
            hint: aggregate.totals.models.map(modelDisplayName).join(", "),
            icon: Share2
          },
          { label: "Total bootstrap time", value: formatDuration(aggregate.totals.duration_ms ?? null), icon: Clock }
        ]}
      />

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

      <SectionShell
        title="Repo size vs chunking output"
        description="Relationship between repository size (tracked files at the pinned commit) and the number of chunks the ingest phase produced."
      >
        <Card>
          <CardContent className="pt-6">
            <RepoScatterChart points={sizeScatter} xLabel="tracked files" yLabel="chunks" height={340} />
          </CardContent>
        </Card>
      </SectionShell>

      <SectionShell
        title="Per-repository results"
        description="Click a row for the full per-repo breakdown: timings, chunk histograms, relation types, degree distribution and most-connected chunks."
      >
        <RepoTable rows={aggregate.repo_rows} version={selectedVersion} />
      </SectionShell>

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
