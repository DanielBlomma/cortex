#!/usr/bin/env node
/**
 * Publishes a finished bootstrapbench run as static site data for the
 * frontend: site-data/bootstrap/summary.json plus one detail document per
 * repo under site-data/bootstrap/repos/.
 *
 * Usage:
 *   node benchmark/bootstrapbench/export-site-data.mjs --run-dir benchmark/bootstrapbench/results/<run-id>
 *   node benchmark/bootstrapbench/export-site-data.mjs --run-dir <dir> --site-dir site-data/bootstrap
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDir, loadJson, parseFlag, usageError, writeJson } from "./lib.mjs";
import { buildSiteData } from "./aggregate.mjs";

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HARNESS_DIR, "..", "..");
const DEFAULT_SITE_DIR = path.join(REPO_ROOT, "site-data", "bootstrap");

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

  const site = buildSiteData({
    runId: runSummary.run?.id ?? path.basename(runDir),
    generatedAt: runSummary.run?.finished_at ?? new Date().toISOString(),
    cortexVersion: runSummary.run?.cortex_version ?? null,
    items
  });

  const reposDir = path.join(siteDir, "repos");
  fs.rmSync(reposDir, { recursive: true, force: true });
  ensureDir(reposDir);
  writeJson(path.join(siteDir, "summary.json"), site.summary);
  for (const repo of site.repos) {
    writeJson(path.join(reposDir, `${repo.key}.json`), repo.data);
  }

  console.log(
    `[export-site-data] wrote ${path.join(siteDir, "summary.json")} and ${site.repos.length} repo document(s)`
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(error?.isUsageError ? 2 : 1);
}
