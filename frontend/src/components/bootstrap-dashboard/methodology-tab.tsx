import { SectionShell } from "@/components/section-shell";
import { Card, CardContent } from "@/components/ui/card";

export function MethodologyTab() {
  return (
    <SectionShell title="Methodology">
      <Card>
        <CardContent className="space-y-3 pt-6 text-sm text-muted-foreground">
          <p>
            Test repositories come from the datasets behind SWE-bench Verified, SWE-bench Pro, SWE-PolyBench and
            Multi-SWE-Bench — 67 large, actively developed projects across eight languages — plus cortex and
            AgentStackBench themselves. Each repo is pinned to a fixed commit so runs are repeatable on identical
            inputs; pins are refreshed deliberately, never implicitly.
          </p>
          <p>
            For every (repository × embedding model) pair, an isolated Docker container clones the pinned commit,
            installs cortex packed from the local source tree, runs{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">cortex init</code> +{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">cortex bootstrap</code>, and extracts statistics
            from the resulting <code className="rounded bg-muted px-1 py-0.5 text-xs">.context/</code> artifacts. See{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">benchmark/bootstrapbench/</code> in the repository
            for the harness.
          </p>
        </CardContent>
      </Card>
    </SectionShell>
  );
}
