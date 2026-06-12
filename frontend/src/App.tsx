import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { BootstrapPage } from "@/components/pages/bootstrap-page";
import { OverviewPage } from "@/components/pages/overview-page";
import { RepoDetailPage } from "@/components/pages/repo-detail-page";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { BootstrapSummaryDoc, RepoDetailDoc, VersionIndex } from "@/data/bootstrap-types";
import { loadBootstrapSummary, loadRepoDetail, loadVersionIndex } from "@/data/load-bootstrap";
import { parseRoute, type Route } from "@/routes";

export default function App() {
  const [route, setRoute] = useState<Route>(() =>
    typeof window === "undefined" ? { page: "overview" } : parseRoute(window.location.hash)
  );
  // undefined = loading, null = not published / not found
  const [versionIndex, setVersionIndex] = useState<VersionIndex | null | undefined>(undefined);
  const [summary, setSummary] = useState<{ version: string; doc: BootstrapSummaryDoc } | null | undefined>(
    undefined
  );
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [repoDetail, setRepoDetail] = useState<RepoDetailDoc | null | undefined>(undefined);
  const [repoDetailError, setRepoDetailError] = useState<string | null>(null);

  const onBootstrapPages = route.page === "bootstrap" || route.page === "repoDetail";
  const latestVersion = versionIndex?.versions[0]?.version;
  // Route version wins; otherwise newest published version from the index.
  const effectiveVersion = (onBootstrapPages ? route.version : undefined) ?? latestVersion;

  useEffect(() => {
    const handleHashChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    if (!onBootstrapPages || versionIndex !== undefined) {
      return;
    }
    let active = true;
    void loadVersionIndex()
      .then((index) => {
        if (active) {
          setVersionIndex(index);
        }
      })
      .catch(() => {
        if (active) {
          setVersionIndex(null);
        }
      });
    return () => {
      active = false;
    };
  }, [onBootstrapPages, versionIndex]);

  useEffect(() => {
    if (route.page !== "bootstrap" || !effectiveVersion) {
      return;
    }
    if (summary && summary.version === effectiveVersion) {
      return;
    }
    let active = true;
    setSummary(undefined);
    setSummaryError(null);
    void loadBootstrapSummary(effectiveVersion)
      .then((doc) => {
        if (active) {
          setSummary(doc ? { version: effectiveVersion, doc } : null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, effectiveVersion]);

  useEffect(() => {
    if (route.page !== "repoDetail" || !effectiveVersion) {
      return;
    }
    let active = true;
    setRepoDetail(undefined);
    setRepoDetailError(null);
    void loadRepoDetail(effectiveVersion, route.repoKey)
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
  }, [route, effectiveVersion]);

  const versionsKnown = versionIndex !== undefined;
  const noVersions = versionIndex === null || (versionIndex?.versions.length ?? 0) === 0;

  return (
    <TooltipProvider delayDuration={150}>
      <AppShell route={route}>
        {route.page === "overview" ? (
          <OverviewPage />
        ) : !versionsKnown ? (
          <StatusPage title="Loading bootstrap metrics…" />
        ) : noVersions ? (
          <NoDataPage error={null} />
        ) : route.page === "bootstrap" ? (
          summary === undefined ? (
            <StatusPage title="Loading bootstrap metrics…" />
          ) : summary === null ? (
            <NoDataPage
              error={summaryError}
              message={`No published results for cortex v${effectiveVersion ?? "?"}.`}
            />
          ) : (
            <BootstrapPage
              summary={summary.doc}
              versions={versionIndex?.versions ?? []}
              selectedVersion={summary.version}
            />
          )
        ) : repoDetail === undefined ? (
          <StatusPage title="Loading repository data…" />
        ) : repoDetail === null ? (
          <NoDataPage
            error={repoDetailError}
            message="No published data for this repository in the selected version."
          />
        ) : (
          <RepoDetailPage
            key={`${effectiveVersion}-${repoDetail.repo.key}`}
            detail={repoDetail}
            version={effectiveVersion}
          />
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
