import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { BootstrapPage } from "@/components/pages/bootstrap-page";
import { OverviewPage } from "@/components/pages/overview-page";
import { RepoDetailPage } from "@/components/pages/repo-detail-page";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { BootstrapSummaryDoc, RepoDetailDoc } from "@/data/bootstrap-types";
import { loadBootstrapSummary, loadRepoDetail } from "@/data/load-bootstrap";
import { parseRoute, type Route } from "@/routes";

export default function App() {
  const [route, setRoute] = useState<Route>(() =>
    typeof window === "undefined" ? { page: "overview" } : parseRoute(window.location.hash)
  );
  // undefined = loading, null = not published / not found
  const [summary, setSummary] = useState<BootstrapSummaryDoc | null | undefined>(undefined);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [repoDetail, setRepoDetail] = useState<RepoDetailDoc | null | undefined>(undefined);
  const [repoDetailError, setRepoDetailError] = useState<string | null>(null);

  useEffect(() => {
    const handleHashChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    if (route.page === "overview" || summary !== undefined) {
      return;
    }
    let active = true;
    void loadBootstrapSummary()
      .then((doc) => {
        if (active) {
          setSummary(doc);
          setSummaryError(null);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setSummary(null);
          setSummaryError(error instanceof Error ? error.message : "Failed to load bootstrap data.");
        }
      });
    return () => {
      active = false;
    };
  }, [route, summary]);

  useEffect(() => {
    if (route.page !== "repoDetail") {
      return;
    }
    let active = true;
    setRepoDetail(undefined);
    setRepoDetailError(null);
    void loadRepoDetail(route.repoKey)
      .then((doc) => {
        if (active) {
          setRepoDetail(doc);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setRepoDetail(null);
          setRepoDetailError(error instanceof Error ? error.message : "Failed to load repository data.");
        }
      });
    return () => {
      active = false;
    };
  }, [route]);

  return (
    <TooltipProvider delayDuration={150}>
      <AppShell route={route}>
        {route.page === "overview" ? (
          <OverviewPage />
        ) : route.page === "bootstrap" ? (
          summary === undefined ? (
            <StatusPage title="Loading bootstrap metrics…" />
          ) : summary === null ? (
            <NoDataPage error={summaryError} />
          ) : (
            <BootstrapPage summary={summary} />
          )
        ) : repoDetail === undefined ? (
          <StatusPage title="Loading repository data…" />
        ) : repoDetail === null ? (
          <NoDataPage
            error={repoDetailError}
            message="No published data for this repository. It may not be part of the latest eval run."
          />
        ) : (
          <RepoDetailPage key={repoDetail.repo.key} detail={repoDetail} />
        )}
      </AppShell>
    </TooltipProvider>
  );
}

function StatusPage({ title, message }: { title: string; message?: string }) {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
    </main>
  );
}

function NoDataPage({ error, message }: { error: string | null; message?: string }) {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">No bootstrap eval published yet</h1>
      <p className="text-sm text-muted-foreground">
        {message ??
          "Run the harness and export its results to publish metrics here: node benchmark/bootstrapbench/run.mjs --config benchmark/bootstrapbench/config.example.json, then node benchmark/bootstrapbench/export-site-data.mjs --run-dir <results dir>."}
      </p>
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
    </main>
  );
}
