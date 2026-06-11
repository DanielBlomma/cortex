import type { BootstrapSummaryDoc, RepoDetailDoc, VersionIndex } from "@/data/bootstrap-types";

const VERSION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const REPO_KEY_PATTERN = /^[a-z0-9._-]+(__[a-z0-9._-]+)*$/;

/**
 * Loads eval documents exported into site-data/bootstrap/, keyed by cortex
 * version (see benchmark/bootstrapbench/export-site-data.mjs). Served as
 * static assets via Vite's publicDir, so paths are relative to the deploy
 * base. Returns null when a document is not published (404).
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

export function loadVersionIndex(): Promise<VersionIndex | null> {
  return fetchJson<VersionIndex>("bootstrap/index.json");
}

export function loadBootstrapSummary(version: string): Promise<BootstrapSummaryDoc | null> {
  if (!VERSION_PATTERN.test(version)) {
    return Promise.resolve(null);
  }
  return fetchJson<BootstrapSummaryDoc>(`bootstrap/${version}/summary.json`);
}

export function loadRepoDetail(version: string, repoKey: string): Promise<RepoDetailDoc | null> {
  if (!VERSION_PATTERN.test(version) || !REPO_KEY_PATTERN.test(repoKey)) {
    return Promise.resolve(null);
  }
  return fetchJson<RepoDetailDoc>(`bootstrap/${version}/repos/${repoKey}.json`);
}
