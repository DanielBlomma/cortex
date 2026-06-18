import { DistributionLineChart, RepoScatterChart, type HistogramSeries, type ScatterPoint } from "@/components/charts";
import { SectionShell } from "@/components/section-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { BootstrapSummaryDoc } from "@/data/bootstrap-types";
import { formatCount, formatNumber, formatPercent, modelDisplayName } from "@/lib/format";

import { ChartCard, ModelStat } from "./common";
import type { ChunkDistributionMode } from "./use-bootstrap-dashboard-data";

export function ChunksAndModelsTab({
  chunkDistributionMode,
  chunkTokenSeries,
  languageTokenError,
  languageTokenLoaded,
  chunkConnectivitySummary,
  isolatedScatter,
  models,
  onChunkDistributionModeChange
}: {
  chunkDistributionMode: ChunkDistributionMode;
  chunkTokenSeries: HistogramSeries[];
  languageTokenError: string | null;
  languageTokenLoaded: boolean;
  chunkConnectivitySummary: {
    avgCallsEdges: number | null;
    avgDegree: number | null;
    avgMaxDegree: number | null;
    avgIsolatedPct: number | null;
  };
  isolatedScatter: ScatterPoint[];
  models: Array<[string, BootstrapSummaryDoc["aggregate"]["by_model"][string]]>;
  onChunkDistributionModeChange: (value: ChunkDistributionMode) => void;
}) {
  return (
    <SectionShell
      title="Chunk token distribution"
      description="Number of chunks by estimated token size. Token buckets are estimated from exported character counts at roughly four characters per token."
      headerAside={
        <ToggleGroup
          type="single"
          value={chunkDistributionMode}
          onValueChange={(value) => value && onChunkDistributionModeChange(value as ChunkDistributionMode)}
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
          ) : chunkDistributionMode === "language" && !languageTokenLoaded ? (
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
  );
}
