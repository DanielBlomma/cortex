#!/usr/bin/env node
/**
 * Pins the bootstrapbench repo manifest (repos.json) to concrete commits.
 *
 * Each manifest entry is pinned to the current HEAD of the repo's default
 * branch via `git ls-remote`. Pins are intentionally sticky: re-running this
 * script only fills missing pins unless --update is passed, so eval runs stay
 * reproducible on the exact same tree until someone deliberately refreshes.
 *
 * Usage:
 *   node benchmark/bootstrapbench/sync-repos.mjs            # pin repos without a pin
 *   node benchmark/bootstrapbench/sync-repos.mjs --update   # re-pin everything to latest HEAD
 *   node benchmark/bootstrapbench/sync-repos.mjs --repo iamkun/dayjs --update
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasFlag, isHttpsUrl, loadJson, nowIso, parseFlag, runCommand, usageError, writeJson } from "./lib.mjs";

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST = path.join(HARNESS_DIR, "repos.json");
const LS_REMOTE_TIMEOUT_MS = 60 * 1000;

function printHelp() {
  console.log(`Bootstrapbench Repo Pinning

Usage:
  node benchmark/bootstrapbench/sync-repos.mjs [--manifest <path>] [--update] [--repo <owner/name>] [--concurrency N]

Behavior:
  - Without flags, only repos missing a pin are resolved.
  - --update re-resolves every selected repo to the latest default-branch HEAD.
  - --repo limits the operation to a single repo (repeatable via comma list).
`);
}

async function resolveHead(url) {
  // The URL comes from the editable manifest and is handed to git on the
  // HOST; only plain https remotes are acceptable (no ext::/ssh tricks,
  // no option-injection via leading dashes).
  if (!isHttpsUrl(url)) {
    throw new Error(`Refusing non-https repo url: ${url}`);
  }
  const result = await runCommand({
    command: "git",
    args: ["ls-remote", "--symref", url, "HEAD"],
    timeoutMs: LS_REMOTE_TIMEOUT_MS
  });
  if (!result.ok) {
    throw new Error(result.stderr.trim() || result.error || `git ls-remote failed (exit ${result.code})`);
  }
  // Output:
  //   ref: refs/heads/main\tHEAD
  //   <sha>\tHEAD
  let defaultBranch = null;
  let sha = null;
  for (const line of result.stdout.split("\n")) {
    const symref = line.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD$/);
    if (symref) {
      defaultBranch = symref[1];
      continue;
    }
    const head = line.match(/^([0-9a-f]{40})\s+HEAD$/);
    if (head) {
      sha = head[1];
    }
  }
  if (!sha) {
    throw new Error(`Could not parse HEAD sha from ls-remote output for ${url}`);
  }
  return { sha, defaultBranch };
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const lanes = Array.from({ length: Math.max(1, limit) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(lanes);
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  if (hasFlag(args, "--help")) {
    printHelp();
    return;
  }

  const manifestPath = path.resolve(parseFlag(args, "--manifest", DEFAULT_MANIFEST));
  const update = hasFlag(args, "--update");
  const repoFilterRaw = parseFlag(args, "--repo");
  const concurrency = Number.parseInt(parseFlag(args, "--concurrency", "8"), 10);
  if (!Number.isFinite(concurrency) || concurrency <= 0) {
    throw usageError("--concurrency must be a positive integer");
  }

  const manifest = loadJson(manifestPath);
  if (!Array.isArray(manifest.repos) || manifest.repos.length === 0) {
    throw usageError(`Manifest ${manifestPath} has no repos`);
  }

  const repoFilter = repoFilterRaw
    ? new Set(repoFilterRaw.split(",").map((value) => value.trim()).filter(Boolean))
    : null;

  const selected = manifest.repos.filter((repo) => {
    if (repoFilter && !repoFilter.has(repo.name)) {
      return false;
    }
    return update || !repo.pin?.sha;
  });

  if (selected.length === 0) {
    console.log("All selected repos already pinned; use --update to refresh pins.");
    return;
  }

  console.log(`Resolving HEAD for ${selected.length} repos (concurrency ${concurrency})`);
  const failures = [];
  const resolvedByName = new Map();

  await mapWithConcurrency(selected, concurrency, async (repo) => {
    try {
      const { sha, defaultBranch } = await resolveHead(repo.url);
      resolvedByName.set(repo.name, {
        sha,
        ref: defaultBranch ? `refs/heads/${defaultBranch}` : null,
        pinned_at: nowIso()
      });
      console.log(`${repo.name} -> ${sha.slice(0, 12)} (${defaultBranch ?? "unknown branch"})`);
    } catch (error) {
      failures.push({ name: repo.name, error: error.message });
      console.error(`${repo.name} -> FAILED: ${error.message}`);
    }
  });

  const updatedManifest = {
    ...manifest,
    pinned_at: nowIso(),
    repos: manifest.repos.map((repo) =>
      resolvedByName.has(repo.name) ? { ...repo, pin: resolvedByName.get(repo.name) } : repo
    )
  };
  writeJson(manifestPath, updatedManifest);

  console.log(
    `Manifest updated: ${resolvedByName.size} pinned, ${failures.length} failed, ` +
      `${manifest.repos.length - selected.length} untouched`
  );
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(error?.isUsageError ? 2 : 1);
});
