import { RepoTable } from "@/components/bootstrap/repo-table";
import { SectionShell } from "@/components/section-shell";
import type { RepoRow } from "@/data/bootstrap-types";

export function RepositoriesTab({ rows, version }: { rows: RepoRow[]; version: string }) {
  return (
    <SectionShell
      title="Per-repository results"
      description="Click a row for the full per-repo breakdown: timings, chunk histograms, relation types, degree distribution and most-connected chunks."
    >
      <RepoTable rows={rows} version={version} />
    </SectionShell>
  );
}
