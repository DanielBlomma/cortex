import { CategoryBarChart, RepoScatterChart, type CategoryDatum, type ScatterPoint } from "@/components/charts";
import { SectionShell } from "@/components/section-shell";

import { ChartCard } from "./common";

export function GraphTab({
  relationTypes,
  connectivityScatter
}: {
  relationTypes: CategoryDatum[];
  connectivityScatter: ScatterPoint[];
}) {
  return (
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
  );
}
