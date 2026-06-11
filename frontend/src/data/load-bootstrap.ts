import type { BootstrapSummaryDoc, RepoDetailDoc } from "@/data/bootstrap-types";

/**
 * Loads eval documents exported into site-data/bootstrap/. Served as static
 * assets via Vite's publicDir, so paths are relative to the deploy base.
 * Returns null when no eval has been published yet (404).
 */
async function fetchJson<T>(relativePath: string): Promise<T | null> {
  const response = await fetch(`${import.meta.env.BASE_URL}${relativePath}`, {
    headers: { Accept: "application/json" }
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to load ${relativePath}: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export function loadBootstrapSummary(): Promise<BootstrapSummaryDoc | null> {
  return fetchJson<BootstrapSummaryDoc>("bootstrap/summary.json");
}

export function loadRepoDetail(repoKey: string): Promise<RepoDetailDoc | null> {
  if (!/^[a-z0-9._-]+(__[a-z0-9._-]+)*$/.test(repoKey)) {
    return Promise.resolve(null);
  }
  return fetchJson<RepoDetailDoc>(`bootstrap/repos/${repoKey}.json`);
}
