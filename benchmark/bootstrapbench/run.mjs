#!/usr/bin/env node
/**
 * Bootstrapbench orchestrator.
 *
 * For every selected (repo x embedding model) pair, launches an isolated
 * Docker container that clones the repo at its pinned commit, installs nothing
 * from the registry (cortex comes from the LOCAL source tree packed into the
 * image), runs `cortex bootstrap`, and extracts embedding/chunk/graph stats.
 * Results land under results/<run-id>/ together with an aggregated summary.
 *
 * Usage:
 *   node benchmark/bootstrapbench/run.mjs --config benchmark/bootstrapbench/config.smoke.json
 *   node benchmark/bootstrapbench/run.mjs --config <cfg> --skip-build --run-id my-run
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureDir,
  hasFlag,
  isHttpsUrl,
  loadJson,
  loadJsonIfExists,
  modelSlug,
  nowIso,
  parseFlag,
  runCommand,
  usageError,
  writeJson
} from "./lib.mjs";
import { aggregateResults } from "./aggregate.mjs";

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HARNESS_DIR, "..", "..");
const MANIFEST_PATH = path.join(HARNESS_DIR, "repos.json");
const BUILD_DIR = path.join(HARNESS_DIR, ".build");
const TARBALL_NAME = "cortex-local.tgz";
const DEFAULT_EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";

function printHelp() {
  console.log(`Bootstrapbench Runner

Usage:
  node benchmark/bootstrapbench/run.mjs --config <config.json> [--run-id <id>] [--skip-build] [--dry-run] [--resume]

  --resume   with a reused --run-id, skip items whose stats.json already
             exists with a non-error status (continue an interrupted run)

Config keys:
  run_name         string   prefix for generated run ids
  repos            "all" or array of "owner/name" entries from repos.json
  embed_models     array of embedding model ids (default ["${DEFAULT_EMBED_MODEL}"])
  parallelism      max concurrent containers (default 1)
  timeout_minutes  per-item timeout (default 90)
  docker.image     image tag (default cortex-bootstrapbench:local)
  docker.build     build the image before running (default true)
  results_dir      output root (default benchmark/bootstrapbench/results)
`);
}

function validateConfig(raw, configPath) {
  if (!raw || typeof raw !== "object") {
    throw usageError(`Config ${configPath} must be a JSON object`);
  }
  const config = {
    run_name: typeof raw.run_name === "string" && raw.run_name.trim() ? raw.run_name.trim() : "run",
    repos: raw.repos ?? "all",
    embed_models:
      Array.isArray(raw.embed_models) && raw.embed_models.length > 0 ? raw.embed_models : [DEFAULT_EMBED_MODEL],
    parallelism: raw.parallelism ?? 1,
    timeout_minutes: raw.timeout_minutes ?? 90,
    docker: {
      image: raw.docker?.image ?? "cortex-bootstrapbench:local",
      build: raw.docker?.build ?? true,
      // ryugraph's npm package ships a linux-arm64 prebuilt that actually
      // contains x86_64 code, so graph loading only works on amd64. Rosetta
      // handles emulation on Apple Silicon; CI runners are amd64 natively.
      platform: raw.docker?.platform ?? "linux/amd64"
    },
    results_dir: raw.results_dir ?? path.join("benchmark", "bootstrapbench", "results")
  };

  if (config.repos !== "all" && (!Array.isArray(config.repos) || config.repos.length === 0)) {
    throw usageError(`Config 'repos' must be "all" or a non-empty array of owner/name strings`);
  }
  if (!config.embed_models.every((model) => typeof model === "string" && model.trim())) {
    throw usageError("Config 'embed_models' must contain non-empty strings");
  }
  if (!Number.isInteger(config.parallelism) || config.parallelism <= 0) {
    throw usageError("Config 'parallelism' must be a positive integer");
  }
  if (!Number.isFinite(config.timeout_minutes) || config.timeout_minutes <= 0) {
    throw usageError("Config 'timeout_minutes' must be a positive number");
  }
  return config;
}

function selectRepos(manifest, selection) {
  const repos = manifest.repos ?? [];
  if (selection === "all") {
    return repos;
  }
  const byName = new Map(repos.map((repo) => [repo.name, repo]));
  return selection.map((name) => {
    const repo = byName.get(name);
    if (!repo) {
      throw usageError(`Repo '${name}' not found in repos.json (expected owner/name)`);
    }
    return repo;
  });
}

async function packCortex() {
  ensureDir(BUILD_DIR);
  console.log("[run] packing cortex from local source (npm pack)");
  const result = await runCommand({
    command: "npm",
    args: ["pack", "--pack-destination", BUILD_DIR],
    cwd: REPO_ROOT,
    timeoutMs: 5 * 60 * 1000
  });
  if (!result.ok) {
    throw new Error(`npm pack failed: ${result.stderr || result.stdout}`);
  }
  const packedName = result.stdout.trim().split("\n").at(-1);
  const packedPath = path.join(BUILD_DIR, packedName);
  if (!fs.existsSync(packedPath)) {
    throw new Error(`npm pack reported ${packedName} but it does not exist in ${BUILD_DIR}`);
  }
  fs.copyFileSync(packedPath, path.join(BUILD_DIR, TARBALL_NAME));
  fs.rmSync(packedPath);
  console.log(`[run] packed ${packedName} -> .build/${TARBALL_NAME}`);
}

async function buildImage(imageTag, platform) {
  console.log(`[run] building docker image ${imageTag} (${platform})`);
  const result = await runCommand({
    command: "docker",
    args: ["build", "--platform", platform, "-f", path.join("docker", "Dockerfile"), "-t", imageTag, "."],
    cwd: HARNESS_DIR,
    timeoutMs: 60 * 60 * 1000,
    onLine: (line) => console.log(`[docker-build] ${line}`)
  });
  if (!result.ok) {
    throw new Error(`docker build failed (exit ${result.code})`);
  }
}

function buildWorkItems(repos, config, runId, cortexVersion) {
  const items = [];
  for (const repo of repos) {
    if (!repo.pin?.sha) {
      throw usageError(`Repo ${repo.name} has no pinned sha; run sync-repos.mjs first`);
    }
    // Manifest values flow into git and docker invocations: insist on plain
    // https remotes, well-formed shas and filesystem-safe keys.
    if (!isHttpsUrl(repo.url)) {
      throw usageError(`Repo ${repo.name} has a non-https url: ${repo.url}`);
    }
    if (!/^[0-9a-f]{40}$/.test(repo.pin.sha)) {
      throw usageError(`Repo ${repo.name} has an invalid pinned sha: ${repo.pin.sha}`);
    }
    if (!/^[a-z0-9._-]+(__[a-z0-9._-]+)*$/.test(repo.key ?? "")) {
      throw usageError(`Repo ${repo.name} has an invalid key: ${repo.key}`);
    }
    for (const model of config.embed_models) {
      items.push({
        repo,
        model,
        containerName: `bb-${runId}-${items.length}`.replace(/[^a-zA-Z0-9_.-]/g, "-"),
        itemKey: `${repo.key}__${modelSlug(model)}`,
        meta: {
          repo: {
            key: repo.key,
            name: repo.name,
            url: repo.url,
            sha: repo.pin.sha,
            languages: repo.languages ?? [],
            benches: repo.benches ?? [],
            instances: repo.instances ?? null
          },
          run: {
            embed_model: model,
            cortex_version: cortexVersion,
            run_id: runId,
            started_at: null
          }
        }
      });
    }
  }
  return items;
}

// Containers started by this process; killed on SIGINT/SIGTERM so an
// interrupted run does not leave them running detached.
const activeContainers = new Set();
let interrupted = false;

// Set when the Docker daemon becomes unreachable. Infrastructure outages must
// stop the queue immediately instead of burning every remaining item as a
// fake repo failure; completed items stay on disk for --resume.
const DAEMON_ERROR_PATTERN = /Cannot connect to the Docker daemon|docker daemon is not running/i;
let infrastructureFailure = null;

function installSignalHandlers() {
  const cleanup = (signal) => {
    if (interrupted) {
      return;
    }
    interrupted = true;
    console.error(`\n[run] received ${signal}; stopping ${activeContainers.size} active container(s)`);
    const pending = [...activeContainers].map((name) =>
      runCommand({ command: "docker", args: ["kill", name], timeoutMs: 30 * 1000 })
    );
    void Promise.allSettled(pending).then(() => process.exit(130));
  };
  process.on("SIGINT", () => cleanup("SIGINT"));
  process.on("SIGTERM", () => cleanup("SIGTERM"));
}

function synthesizeErrorItem(item, message) {
  return {
    schema_version: 1,
    repo: item.meta.repo,
    run: { ...item.meta.run, status: "error", error: message },
    workspace: null,
    timings_ms: null,
    ingest: null,
    files: null,
    chunks: null,
    embeddings: null,
    graph: null
  };
}

async function runItem(item, config, paths) {
  const itemDir = path.join(paths.itemsDir, item.itemKey);
  ensureDir(itemDir);
  const statsPathExisting = path.join(itemDir, "stats.json");

  if (paths.resume) {
    let existing = null;
    try {
      existing = loadJsonIfExists(statsPathExisting);
    } catch {
      existing = null; // unreadable stats.json -> rerun the item
    }
    if (existing && existing.run?.status !== "error") {
      console.log(`[run] skip ${item.itemKey} (already complete: ${existing.run?.status})`);
      return existing;
    }
  }

  const startedAt = nowIso();
  const meta = { ...item.meta, run: { ...item.meta.run, started_at: startedAt } };

  console.log(`[run] start ${item.itemKey} (sha ${item.repo.pin.sha.slice(0, 12)})`);
  const timeoutMs = config.timeout_minutes * 60 * 1000;
  activeContainers.add(item.containerName);
  const result = await runCommand({
    command: "docker",
    args: [
      "run",
      "--rm",
      "--platform",
      config.docker.platform,
      "--name",
      item.containerName,
      "-v",
      `${itemDir}:/out`,
      "-e",
      `BB_REPO_URL=${item.repo.url}`,
      "-e",
      `BB_REPO_SHA=${item.repo.pin.sha}`,
      "-e",
      `BB_REPO_KEY=${item.repo.key}`,
      "-e",
      `BB_META_JSON=${JSON.stringify(meta)}`,
      "-e",
      `CORTEX_EMBED_MODEL=${item.model}`,
      config.docker.image
    ],
    timeoutMs,
    onLine: (line) => console.log(`[${item.itemKey}] ${line}`)
  });

  if (result.timedOut) {
    console.error(`[run] ${item.itemKey} timed out after ${config.timeout_minutes} minutes; killing container`);
    await runCommand({ command: "docker", args: ["kill", item.containerName], timeoutMs: 30 * 1000 });
  }
  activeContainers.delete(item.containerName);

  if (DAEMON_ERROR_PATTERN.test(`${result.stdout}\n${result.stderr}`)) {
    infrastructureFailure = `docker daemon unreachable while running ${item.itemKey}`;
    throw new Error(infrastructureFailure);
  }

  const statsPath = path.join(itemDir, "stats.json");
  const stats = loadJsonIfExists(statsPath);
  if (stats) {
    return stats;
  }
  const reason = result.timedOut
    ? `timed out after ${config.timeout_minutes} minutes`
    : `container exited with code ${result.code} and produced no stats.json`;
  const synthesized = synthesizeErrorItem({ ...item, meta }, reason);
  writeJson(statsPath, synthesized);
  return synthesized;
}

async function runQueue(items, config, paths) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const lanes = Array.from({ length: Math.min(config.parallelism, items.length) }, async () => {
    while (nextIndex < items.length) {
      if (infrastructureFailure) {
        return;
      }
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await runItem(items[index], config, paths);
      } catch (error) {
        console.error(`[run] ${items[index].itemKey} failed: ${error.message}`);
        if (infrastructureFailure) {
          // Not the repo's fault: leave no stats.json so --resume retries it.
          return;
        }
        results[index] = synthesizeErrorItem(items[index], error.message);
      }
    }
  });
  await Promise.all(lanes);
  return results.filter(Boolean);
}

async function main() {
  const args = process.argv.slice(2);
  if (hasFlag(args, "--help")) {
    printHelp();
    return;
  }

  const configPath = parseFlag(args, "--config");
  if (!configPath) {
    throw usageError("run.mjs requires --config <path>; see config.example.json");
  }
  const config = validateConfig(loadJson(configPath), configPath);
  const manifest = loadJson(MANIFEST_PATH);
  const repos = selectRepos(manifest, config.repos);
  const cortexVersion = loadJson(path.join(REPO_ROOT, "package.json")).version ?? "unknown";

  const startedAt = nowIso();
  const runId =
    parseFlag(args, "--run-id") ??
    `${config.run_name}-${startedAt.replace(/[:.]/g, "-").replace("T", "_").slice(0, 19)}`;

  const resultsRoot = path.isAbsolute(config.results_dir)
    ? config.results_dir
    : path.join(REPO_ROOT, config.results_dir);
  const runDir = path.join(resultsRoot, runId);
  const paths = { runDir, itemsDir: path.join(runDir, "items"), resume: hasFlag(args, "--resume") };

  const items = buildWorkItems(repos, config, runId, cortexVersion);
  console.log(
    `[run] run-id=${runId} repos=${repos.length} models=${config.embed_models.length} items=${items.length} parallelism=${config.parallelism}`
  );

  if (hasFlag(args, "--dry-run")) {
    for (const item of items) {
      console.log(`[dry-run] ${item.itemKey} <- ${item.repo.url} @ ${item.repo.pin.sha}`);
    }
    return;
  }

  ensureDir(paths.itemsDir);
  installSignalHandlers();
  writeJson(path.join(runDir, "config.json"), { ...config, run_id: runId, started_at: startedAt });

  if (config.docker.build && !hasFlag(args, "--skip-build")) {
    await packCortex();
    await buildImage(config.docker.image, config.docker.platform);
  }

  const results = await runQueue(items, config, paths);

  if (infrastructureFailure) {
    console.error(`[run] ABORTED: ${infrastructureFailure}`);
    console.error(
      `[run] ${results.length}/${items.length} item(s) have results on disk; ` +
        `relaunch with --run-id ${runId} --resume once Docker is back`
    );
    process.exitCode = 1;
    return;
  }

  const aggregate = aggregateResults(results);
  const summary = {
    schema_version: 1,
    run: {
      id: runId,
      started_at: startedAt,
      finished_at: nowIso(),
      cortex_version: cortexVersion,
      embed_models: config.embed_models,
      image: config.docker.image
    },
    aggregate
  };
  writeJson(path.join(runDir, "summary.json"), summary);

  const failed = aggregate.totals.failed;
  console.log(
    `[run] complete: ${aggregate.totals.succeeded}/${items.length} succeeded, summary at ${path.join(runDir, "summary.json")}`
  );
  if (failed > 0) {
    console.error(`[run] ${failed} item(s) failed`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(error?.isUsageError ? 2 : 1);
});
