import { useMemo, useState } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { StatCards, StatusBadge } from "@/components/bootstrap/stat-cards";
import { CategoryBarChart, HistogramChart, chartColor } from "@/components/charts";
import { SectionShell } from "@/components/section-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { RepoDetailDoc, StatsItem, TimingsMs } from "@/data/bootstrap-types";
import { bootstrapHash } from "@/routes";
import {
  formatBytes,
  formatCount,
  formatDuration,
  formatNumber,
  formatPercent,
  modelDisplayName,
  shortSha
} from "@/lib/format";

const PHASES: Array<{ key: keyof TimingsMs; label: string }> = [
  { key: "deps", label: "Install deps" },
  { key: "ingest", label: "Ingest" },
  { key: "embed", label: "Embed" },
  { key: "graph_load", label: "Graph load" },
  { key: "status", label: "Status" }
];

export function RepoDetailPage({ detail, version }: { detail: RepoDetailDoc; version?: string }) {
  const models = detail.runs.map((run) => run.run.embed_model);
  const [selectedModel, setSelectedModel] = useState(models[0] ?? "");
  const item = useMemo(
    () => detail.runs.find((run) => run.run.embed_model === selectedModel) ?? detail.runs[0],
    [detail.runs, selectedModel]
  );
  const [sizeUnit, setSizeUnit] = useState<"lines" | "chars">("lines");

  if (!item) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-muted-foreground">No runs recorded for this repository.</p>
      </main>
    );
  }

  const repo = detail.repo;
  const chunkHistogram = sizeUnit === "lines" ? item.chunks?.lines?.histogram : item.chunks?.chars?.histogram;
  const kindRows = Object.entries(item.chunks?.by_kind ?? {}).sort((a, b) => b[1] - a[1]);
  const relationData = Object.entries(item.graph?.edges.by_type ?? {})
    .map(([name, value]) => ({ name, value }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value);
  const languageRows = Object.entries(item.chunks?.by_language ?? {}).sort((a, b) => b[1].count - a[1].count);
  const entityTypes = Object.entries(item.embeddings?.by_entity_type ?? {}).sort((a, b) => b[1] - a[1]);
  const connectivity = item.graph?.chunk_connectivity;

  return (
    <main className="mx-auto flex max-w-[96rem] flex-col gap-10 px-4 pb-16 pt-8">
      <section className="space-y-3">
        <a
          href={bootstrapHash(version)}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          All repositories
        </a>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{repo.name}</h1>
          <StatusBadge status={item.run.status} />
          <a
            href={repo.url.replace(/\.git$/, "")}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            GitHub <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{shortSha(repo.sha)}</code>
          {repo.languages.map((language) => (
            <Badge key={language} variant="secondary">
              {language}
            </Badge>
          ))}
          {repo.benches.map((bench) => (
            <Badge key={bench} variant="outline">
              {bench}
            </Badge>
          ))}
          {repo.instances ? <span>{repo.instances} benchmark tasks reference this repo</span> : null}
        </div>
        {item.run.error ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {item.run.error}
          </p>
        ) : null}
        {models.length > 1 ? (
          <ToggleGroup
            type="single"
            value={item.run.embed_model}
            onValueChange={(value) => value && setSelectedModel(value)}
          >
            {models.map((model) => (
              <ToggleGroupItem key={model} value={model}>
                {modelDisplayName(model)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}
      </section>

      <StatCards
        stats={[
          {
            label: "Tracked files",
            value: formatCount(item.workspace?.tracked_files ?? null),
            hint: formatBytes(item.workspace?.tracked_bytes ?? null)
          },
          { label: "Files indexed", value: formatCount(item.files?.total ?? null) },
          { label: "Chunks", value: formatCount(item.chunks?.total ?? null) },
          { label: "Graph edges", value: formatCount(item.graph?.edges.total ?? null) },
          {
            label: "Vectors",
            value: formatCount(item.embeddings?.counts.embedded ?? null),
            hint: item.embeddings?.dimensions ? `${item.embeddings.dimensions} dims` : undefined
          },
          { label: "Bootstrap time", value: formatDuration(item.timings_ms?.total ?? null) }
        ]}
      />

      <SectionShell
        title="Bootstrap phases"
        description="Wall-clock duration of each phase, derived from the bootstrap log step markers."
      >
        <Card>
          <CardContent className="pt-6">
            <PhaseBar timings={item.timings_ms} />
          </CardContent>
        </Card>
      </SectionShell>

      <SectionShell
        title="Chunks"
        description={`Chunk size distribution for the ${modelDisplayName(item.run.embed_model)} run.`}
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
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Size distribution</CardTitle>
              <CardDescription>
                p50 {formatNumber(item.chunks?.lines?.p50 ?? null, 0)} · p90{" "}
                {formatNumber(item.chunks?.lines?.p90 ?? null, 0)} · max{" "}
                {formatNumber(item.chunks?.lines?.max ?? null, 0)} lines
              </CardDescription>
            </CardHeader>
            <CardContent>
              <HistogramChart
                series={[{ name: modelDisplayName(item.run.embed_model), histogram: chunkHistogram ?? [] }]}
                unit={sizeUnit}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">By kind & language</CardTitle>
              <CardDescription>{formatCount(item.chunks?.exported ?? null)} exported symbols</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-6">
              <MiniTable header={["Kind", "Chunks"]} rows={kindRows.map(([kind, count]) => [kind, formatCount(count)])} />
              <MiniTable
                header={["Language", "Chunks"]}
                rows={languageRows.map(([language, stats]) => [language, formatCount(stats.count)])}
              />
            </CardContent>
          </Card>
        </div>
      </SectionShell>

      <SectionShell
        title="Graph interconnection"
        description="Relations loaded into the graph and how densely chunks call each other."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Relations by type</CardTitle>
            </CardHeader>
            <CardContent>
              <CategoryBarChart data={relationData} valueLabel="edges" />
            </CardContent>
          </Card>
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Chunk connectivity</CardTitle>
                <CardDescription>Degrees over CALLS (chunk-to-chunk) edges</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
                <KeyValue label="CALLS edges" value={formatCount(connectivity?.chunk_chunk_edges ?? null)} />
                <KeyValue label="Avg degree" value={formatNumber(connectivity?.avg_degree ?? null)} />
                <KeyValue label="Max degree" value={formatCount(connectivity?.max_degree ?? null)} />
                <KeyValue label="Isolated" value={formatPercent(connectivity?.isolated_pct ?? null)} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Degree distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <HistogramChart
                  series={[
                    {
                      name: "chunks",
                      histogram: connectivity?.degree?.histogram ?? [],
                      color: chartColor(3)
                    }
                  ]}
                  unit="degree"
                  height={180}
                />
              </CardContent>
            </Card>
          </div>
        </div>
        {connectivity && connectivity.top_connected.length > 0 ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Most connected chunks</CardTitle>
              <CardDescription>Hubs of the call graph — prime context candidates</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Chunk</TableHead>
                    <TableHead className="text-right">Degree</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {connectivity.top_connected.map((chunk) => (
                    <TableRow key={chunk.id}>
                      <TableCell>
                        <code className="break-all text-xs">{chunk.id.replace(/^chunk:/, "")}</code>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{chunk.degree}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}
      </SectionShell>

      <SectionShell title="Embeddings & workspace">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Embeddings</CardTitle>
              <CardDescription className="break-all">{item.embeddings?.model ?? "not generated"}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
                <KeyValue label="Dimensions" value={formatCount(item.embeddings?.dimensions ?? null)} />
                <KeyValue label="Embedded" value={formatCount(item.embeddings?.counts.embedded ?? null)} />
                <KeyValue label="Failed" value={formatCount(item.embeddings?.counts.failed ?? null)} />
                <KeyValue
                  label="Throughput"
                  value={
                    item.embeddings?.throughput_per_s ? `${formatNumber(item.embeddings.throughput_per_s)}/s` : "—"
                  }
                />
              </div>
              {entityTypes.length > 0 ? (
                <MiniTable
                  header={["Entity type", "Vectors"]}
                  rows={entityTypes.map(([type, count]) => [type, formatCount(count)])}
                />
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Workspace</CardTitle>
              <CardDescription>What cortex init detected at the pinned commit</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <KeyValue
                label="Detected source paths"
                value={item.workspace?.detected_source_paths?.join(", ") || "—"}
              />
              {item.ingest?.skipped ? (
                <KeyValue
                  label="Skipped files"
                  value={Object.entries(item.ingest.skipped)
                    .map(([reason, count]) => `${reason}: ${formatCount(count)}`)
                    .join(" · ")}
                />
              ) : null}
              <KeyValue label="Files by kind" value={formatKindMap(item)} />
            </CardContent>
          </Card>
        </div>
      </SectionShell>
    </main>
  );
}

function formatKindMap(item: StatsItem): string {
  const entries = Object.entries(item.files?.by_kind ?? {});
  if (entries.length === 0) {
    return "—";
  }
  return entries.map(([kind, count]) => `${kind}: ${formatCount(count)}`).join(" · ");
}

function PhaseBar({ timings }: { timings: TimingsMs | null }) {
  const phases = PHASES.map((phase, index) => ({
    ...phase,
    value: timings?.[phase.key] ?? null,
    color: chartColor(index)
  })).filter((phase) => phase.value !== null && phase.value > 0);
  const total = phases.reduce((acc, phase) => acc + (phase.value ?? 0), 0);

  if (total === 0) {
    return <p className="text-sm text-muted-foreground">No timing data captured.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex h-5 w-full overflow-hidden rounded-full">
        {phases.map((phase) => (
          <div
            key={phase.key}
            style={{ width: `${((phase.value ?? 0) / total) * 100}%`, background: phase.color }}
            title={`${phase.label}: ${formatDuration(phase.value)}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {phases.map((phase) => (
          <div key={phase.key} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: phase.color }} />
            <span className="text-muted-foreground">{phase.label}</span>
            <span className="font-medium tabular-nums">{formatDuration(phase.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function MiniTable({ header, rows }: { header: [string, string]; rows: Array<[string, string]> }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="px-0">{header[0]}</TableHead>
          <TableHead className="px-0 text-right">{header[1]}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(([name, value]) => (
          <TableRow key={name} className="hover:bg-transparent">
            <TableCell className="px-0 text-sm">{name}</TableCell>
            <TableCell className="px-0 text-right tabular-nums">{value}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
