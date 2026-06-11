#!/usr/bin/env node
/**
 * Publishes a finished bootstrapbench run as static site data, keyed by the
 * cortex version the run measured so older results are never overwritten:
 *
 *   site-data/bootstrap/index.json                 - published versions (newest first)
 *   site-data/bootstrap/<version>/summary.json     - aggregate page payload
 *   site-data/bootstrap/<version>/repos/<key>.json - per-repo detail payloads
 *
 * Re-exporting a run for an already-published version replaces only that
 * version's directory and its index entry; every other version stays intact.
 *
 * Usage:
 *   node benchmark/bootstrapbench/export-site-data.mjs --run-dir benchmark/bootstrapbench/results/<run-id>
 *   node benchmark/bootstrapbench/export-site-data.mjs --run-dir <dir> --site-dir site-data/bootstrap
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDir, loadJson, loadJsonIfExists, parseFlag, usageError, writeJson } from "./lib.mjs";
import { buildSiteData, mergeVersionIndex } from "./aggregate.mjs";

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HARNESS_DIR, "..", "..");
const DEFAULT_SITE_DIR = path.join(REPO_ROOT, "site-data", "bootstrap");
const VERSION_DIR_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function main() {
  const args = process.argv.slice(2);
  const runDirArg = parseFlag(args, "--run-dir");
  if (!runDirArg) {
    throw usageError("export-site-data.mjs requires --run-dir <results/<run-id>>");
  }
  const runDir = path.resolve(runDirArg);
  const siteDirArg = parseFlag(args, "--site-dir");
  const siteDir = siteDirArg ? path.resolve(siteDirArg) : DEFAULT_SITE_DIR;

  const summaryPath = path.join(runDir, "summary.json");
  const runSummary = loadJson(summaryPath);

  const itemsDir = path.join(runDir, "items");
  if (!fs.existsSync(itemsDir)) {
    throw usageError(`No items directory in ${runDir}; did the run finish?`);
  }
  const items = [];
  for (const entry of fs.readdirSync(itemsDir).sort()) {
    const statsPath = path.join(itemsDir, entry, "stats.json");
    if (!fs.existsSync(statsPath)) {
      continue;
    }
    try {
      items.push(loadJson(statsPath));
    } catch (error) {
      console.warn(`[export-site-data] skipping unreadable ${statsPath}: ${error.message}`);
    }
  }
  if (items.length === 0) {
    throw usageError(`No stats.json documents under ${itemsDir}`);
  }

  const cortexVersion = runSummary.run?.cortex_version ?? null;
  if (!cortexVersion || !VERSION_DIR_PATTERN.test(cortexVersion)) {
    throw usageError(
      `Run summary has no usable cortex_version (${JSON.stringify(cortexVersion)}); cannot key the export`
    );
  }

  const site = buildSiteData({
    runId: runSummary.run?.id ?? path.basename(runDir),
    generatedAt: runSummary.run?.finished_at ?? new Date().toISOString(),
    cortexVersion,
    items
  });

  // Only this version's directory is replaced; sibling versions are untouched.
  const versionDir = path.join(siteDir, cortexVersion);
  const reposDir = path.join(versionDir, "repos");
  fs.rmSync(versionDir, { recursive: true, force: true });
  ensureDir(reposDir);
  writeJson(path.join(versionDir, "summary.json"), site.summary);
  for (const repo of site.repos) {
    writeJson(path.join(reposDir, `${repo.key}.json`), repo.data);
  }

  const indexPath = path.join(siteDir, "index.json");
  const index = mergeVersionIndex(loadJsonIfExists(indexPath), {
    version: cortexVersion,
    run_id: site.summary.run.id,
    generated_at: site.summary.run.generated_at,
    models: site.summary.run ? (runSummary.run?.embed_models ?? []) : [],
    repos: site.repos.length
  });
  writeJson(indexPath, index);

  console.log(
    `[export-site-data] wrote ${path.join(versionDir, "summary.json")}, ` +
      `${site.repos.length} repo document(s), index now lists ${index.versions.length} version(s)`
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(error?.isUsageError ? 2 : 1);
}
