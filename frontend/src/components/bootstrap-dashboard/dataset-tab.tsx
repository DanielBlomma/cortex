import { Boxes, Clock, Database, FileCode2, Network, Share2 } from "lucide-react";

import { StatCards } from "@/components/bootstrap/stat-cards";
import { CategoryBarChart, DistributionDonutChart, type CategoryDatum, type DistributionSlice } from "@/components/charts";
import { SectionShell } from "@/components/section-shell";
import { Card, CardContent } from "@/components/ui/card";
import type { BootstrapSummaryDoc } from "@/data/bootstrap-types";
import { formatCount, formatPercent } from "@/lib/format";

import { DatasetChartCard } from "./common";
import { coveragePct } from "./metrics";

export function DatasetTab({
  aggregate,
  datasetRepoCount,
  datasetBenchSlices,
  datasetLanguageSlices,
  datasetSizeSlices,
  largestIndexedRepos
}: {
  aggregate: BootstrapSummaryDoc["aggregate"];
  datasetRepoCount: number;
  datasetBenchSlices: DistributionSlice[];
  datasetLanguageSlices: DistributionSlice[];
  datasetSizeSlices: DistributionSlice[];
  largestIndexedRepos: CategoryDatum[];
}) {
  return (
    <>
      <StatCards
        stats={[
          {
            label: "Dataset repos",
            value: formatCount(datasetRepoCount),
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
            value: formatPercent(coveragePct(aggregate.totals.indexed_lines, aggregate.totals.tracked_lines)),
            hint: "indexed / tracked LOC",
            explanation: "Share of tracked lines included in Cortex indexing across this dataset.",
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
            <DistributionDonutChart data={datasetBenchSlices} centerLabel="sources" valueLabel="memberships" />
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
  );
}
