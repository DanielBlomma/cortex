import { useState } from "react";

import { VersionSelect } from "@/components/bootstrap/version-select";
import { ChunksAndModelsTab } from "@/components/bootstrap-dashboard/chunks-and-models-tab";
import { DatasetTab } from "@/components/bootstrap-dashboard/dataset-tab";
import { GraphTab } from "@/components/bootstrap-dashboard/graph-tab";
import { LanguagesTab } from "@/components/bootstrap-dashboard/languages-tab";
import { MethodologyTab } from "@/components/bootstrap-dashboard/methodology-tab";
import { OverviewTab } from "@/components/bootstrap-dashboard/overview-tab";
import { RepositoriesTab } from "@/components/bootstrap-dashboard/repositories-tab";
import { TabBar, type TabKey } from "@/components/bootstrap-dashboard/tab-bar";
import { useBootstrapDashboardData } from "@/components/bootstrap-dashboard/use-bootstrap-dashboard-data";
import type { BootstrapSummaryDoc, VersionIndexEntry } from "@/data/bootstrap-types";
import { formatDate } from "@/lib/format";
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
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const dashboard = useBootstrapDashboardData({ summary, selectedVersion, activeTab });

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
          Every repository below was bootstrapped from scratch in an isolated container: cloned at a pinned commit,
          indexed, embedded and graph-loaded with cortex built from source. Run{" "}
          <span className="font-medium text-foreground">{run.id}</span>
          {run.cortex_version ? ` · cortex v${run.cortex_version}` : ""} · {formatDate(run.generated_at)}.
        </p>
      </section>

      <TabBar active={activeTab} onSelect={setActiveTab} />

      {activeTab === "overview" ? (
        <OverviewTab
          aggregate={aggregate}
          sizeAxis={dashboard.sizeAxis}
          sizeScatter={dashboard.sizeScatter}
          onSizeAxisChange={dashboard.setSizeAxis}
        />
      ) : null}

      {activeTab === "dataset" ? (
        <DatasetTab
          aggregate={aggregate}
          datasetRepoCount={dashboard.datasetRows.length}
          datasetBenchSlices={dashboard.datasetBenchSlices}
          datasetLanguageSlices={dashboard.datasetLanguageSlices}
          datasetSizeSlices={dashboard.datasetSizeSlices}
          largestIndexedRepos={dashboard.largestIndexedRepos}
        />
      ) : null}

      {activeTab === "chunks" ? (
        <ChunksAndModelsTab
          chunkDistributionMode={dashboard.chunkDistributionMode}
          chunkTokenSeries={dashboard.chunkTokenSeries}
          languageTokenError={dashboard.languageTokenError}
          languageTokenLoaded={Boolean(dashboard.languageTokenHistograms)}
          chunkConnectivitySummary={dashboard.chunkConnectivitySummary}
          isolatedScatter={dashboard.isolatedScatter}
          models={dashboard.models}
          onChunkDistributionModeChange={dashboard.setChunkDistributionMode}
        />
      ) : null}

      {activeTab === "graph" ? (
        <GraphTab relationTypes={dashboard.relationTypes} connectivityScatter={dashboard.connectivityScatter} />
      ) : null}

      {activeTab === "languages" ? (
        <LanguagesTab
          languageChunkIntensity={dashboard.languageChunkIntensity}
          languageMeanLines={dashboard.languageMeanLines}
        />
      ) : null}

      {activeTab === "repositories" ? (
        <RepositoriesTab rows={aggregate.repo_rows} version={selectedVersion} />
      ) : null}

      {activeTab === "methodology" ? <MethodologyTab /> : null}
    </main>
  );
}
