import { CategoryBarChart, type CategoryDatum } from "@/components/charts";
import { SectionShell } from "@/components/section-shell";

import { ChartCard } from "./common";

export function LanguagesTab({
  languageChunkIntensity,
  languageMeanLines
}: {
  languageChunkIntensity: CategoryDatum[];
  languageMeanLines: CategoryDatum[];
}) {
  return (
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
  );
}
