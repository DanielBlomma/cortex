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
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ensureDir,
  hasFlag,
  isHttpsUrl,
  loadJson,
  loadJsonIfExists,
  modelSlug,
  nowIso,
  parseFlag,
  parseNpmViewVersion,
  runCommand,
  usageError,
  writeJson
} from "./lib.mjs";
import { aggregateResults } from "./aggregate.mjs";
import { stoppedEvalContainers } from "./cleanup.mjs";

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
  cortex.source    "local" (pack the working tree, default) or "npm"
  cortex.version   npm version/dist-tag to fetch when source is "npm"
                   (validated against the registry, exact version resolved)
  parallelism      max concurrent containers (default 1)
  timeout_minutes  per-item timeout (default 90)
  docker.image     image tag (default cortex-bootstrapbench:local)
  docker.build     build the image before running (default true)
  results_dir      output root (default benchmark/bootstrapbench/results)
  gates            optional max_rss_mb/max_duration_minutes thresholds
`);
}

function normalizePositiveNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw usageError(`Config '${fieldName}' must be a positive number`);
  }
  return number;
}

function normalizeGateSpec(raw, fieldName) {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw usageError(`Config '${fieldName}' must be an object`);
  }
  if (raw.max_duration_ms !== undefined && raw.max_duration_minutes !== undefined) {
    throw usageError(`Config '${fieldName}' cannot set both max_duration_ms and max_duration_minutes`);
  }

  const gate = {};
  if (raw.max_rss_mb !== undefined) {
    gate.max_rss_mb = normalizePositiveNumber(raw.max_rss_mb, `${fieldName}.max_rss_mb`);
    gate.max_rss_kb = Math.round(gate.max_rss_mb * 1024);
  }
  if (raw.max_duration_ms !== undefined) {
    gate.max_duration_ms = normalizePositiveNumber(raw.max_duration_ms, `${fieldName}.max_duration_ms`);
  }
  if (raw.max_duration_minutes !== undefined) {
    gate.max_duration_ms = normalizePositiveNumber(raw.max_duration_minutes, `${fieldName}.max_duration_minutes`) * 60 * 1000;
  }

  return Object.keys(gate).length > 0 ? gate : null;
}

function normalizeGates(raw) {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw usageError("Config 'gates' must be an object");
  }
  if (raw.by_repo !== undefined && (typeof raw.by_repo !== "object" || raw.by_repo === null || Array.isArray(raw.by_repo))) {
    throw usageError("Config 'gates.by_repo' must be an object");
  }

  const byRepo = {};
  for (const [repoName, repoGateRaw] of Object.entries(raw.by_repo ?? {})) {
    if (!repoName.trim()) {
      throw usageError("Config 'gates.by_repo' keys must be non-empty repo names or keys");
    }
    const repoGate = normalizeGateSpec(repoGateRaw, `gates.by_repo.${repoName}`);
    if (repoGate) {
      byRepo[repoName] = repoGate;
    }
  }

  const defaults = normalizeGateSpec(raw, "gates") ?? {};
  delete defaults.by_repo;

  if (Object.keys(defaults).length === 0 && Object.keys(byRepo).length === 0) {
    throw usageError("Config 'gates' must define max_rss_mb, max_duration_ms, max_duration_minutes, or by_repo thresholds");
  }

  return {
    ...defaults,
    by_repo: byRepo
  };
}

export function validateConfig(raw, configPath) {
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
      // Default: host-native platform (the Dockerfile compiles ryugraph from
      // source on arm64, where the published prebuilt is broken). Set
      // explicitly, e.g. "linux/amd64", to force emulation.
      platform: raw.docker?.platform ?? null,
      // CPU quota per container; "auto" divides the daemon's CPUs by
      // parallelism so co-located embedders don't oversubscribe cores.
      cpus: raw.docker?.cpus ?? "auto",
      // Hard memory limit per container (e.g. "12g"), passed as --memory and
      // --memory-swap. Essential for big models: the embedding scheduler's gate
      // is cgroup-aware, so without a limit it reads the whole host and
      // over-commits its session pool (large repos then OOM). null = no limit.
      memory: raw.docker?.memory ?? null
    },
    cortex: {
      source: raw.cortex?.source ?? "local",
      version: raw.cortex?.version ?? null
    },
    gates: normalizeGates(raw.gates),
    results_dir: raw.results_dir ?? path.join("benchmark", "bootstrapbench", "results")
  };

  if (!["local", "npm"].includes(config.cortex.source)) {
    throw usageError(`Config 'cortex.source' must be "local" or "npm", got '${config.cortex.source}'`);
  }
  if (config.cortex.source === "npm") {
    if (typeof config.cortex.version !== "string" || !config.cortex.version.trim()) {
      throw usageError(`Config 'cortex.version' is required when cortex.source is "npm" (e.g. "2.0.19" or "latest")`);
    }
    if (!/^[0-9a-zA-Z][0-9a-zA-Z._^~><=* -]*$/.test(config.cortex.version)) {
      throw usageError(`Config 'cortex.version' contains unsupported characters: '${config.cortex.version}'`);
    }
  }
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
  if (config.docker.memory !== null) {
    const memory = String(config.docker.memory);
    if (!/^[0-9]+(\.[0-9]+)?[bkmgBKMG]?$/.test(memory) || Number.parseFloat(memory) <= 0) {
      throw usageError(`Config 'docker.memory' must be a positive docker size like "12g" or "512m", got '${config.docker.memory}'`);
    }
  }
  return config;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function gateForStats(stats, gates) {
  if (!gates) {
    return null;
  }
  const repoKeys = [stats?.repo?.key, stats?.repo?.name].filter(Boolean);
  const repoGate = repoKeys.map((key) => gates.by_repo?.[key]).find(Boolean) ?? {};
  return {
    max_rss_kb: repoGate.max_rss_kb ?? gates.max_rss_kb ?? null,
    max_rss_mb: repoGate.max_rss_mb ?? gates.max_rss_mb ?? null,
    max_duration_ms: repoGate.max_duration_ms ?? gates.max_duration_ms ?? null
  };
}

function metricCheck({ metric, actual, threshold, displayActual, displayThreshold, unit }) {
  if (!Number.isFinite(threshold)) {
    return null;
  }
  if (!Number.isFinite(actual)) {
    return {
      metric,
      status: "missing",
      actual: null,
      threshold: displayThreshold ?? threshold,
      unit
    };
  }
  return {
    metric,
    status: actual <= threshold ? "pass" : "fail",
    actual: displayActual ?? actual,
    threshold: displayThreshold ?? threshold,
    unit
  };
}

function numericMetric(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : NaN;
}

export function evaluateBenchmarkGates(stats, gates) {
  const gate = gateForStats(stats, gates);
  if (!gate || (!Number.isFinite(gate.max_rss_kb) && !Number.isFinite(gate.max_duration_ms))) {
    return null;
  }

  const rssKb = numericMetric(stats?.memory?.max_rss_kb);
  const durationMs = numericMetric(stats?.timings_ms?.total);
  const checks = [
    metricCheck({
      metric: "max_rss_mb",
      actual: rssKb,
      threshold: gate.max_rss_kb,
      displayActual: Number.isFinite(rssKb) ? round(rssKb / 1024) : null,
      displayThreshold: gate.max_rss_mb,
      unit: "MB"
    }),
    metricCheck({
      metric: "total_duration_ms",
      actual: durationMs,
      threshold: gate.max_duration_ms,
      unit: "ms"
    })
  ].filter(Boolean);
  const failures = checks.filter((check) => check.status !== "pass");
  return {
    ok: failures.length === 0,
    checks,
    failures
  };
}

function gateFailureMessage(failures) {
  return failures
    .map((failure) =>
      failure.status === "missing"
        ? `${failure.metric} missing (threshold ${failure.threshold}${failure.unit ? ` ${failure.unit}` : ""})`
        : `${failure.metric} ${failure.actual}${failure.unit ? ` ${failure.unit}` : ""} > ${failure.threshold}${
            failure.unit ? ` ${failure.unit}` : ""
          }`
    )
    .join("; ");
}

function isGateEligibleStatus(status) {
  return status === "ok" || status === "embed_failed" || status === "gate_failed";
}

function applyBenchmarkGates(stats, config, statsPath) {
  if (!config.gates || !isGateEligibleStatus(stats?.run?.status)) {
    return stats;
  }
  const evaluation = evaluateBenchmarkGates(stats, config.gates);
  if (!evaluation) {
    return stats;
  }

  const baseStatus = stats.run.status_before_gates ?? stats.run.status;
  const baseError = stats.run.error_before_gates ?? stats.run.error ?? null;
  const nextStats = {
    ...stats,
    run: {
      ...stats.run,
      status: baseStatus,
      error: baseError,
      status_before_gates: baseStatus,
      error_before_gates: baseError,
      gates: evaluation
    }
  };

  if (!evaluation.ok) {
    nextStats.run.status = "gate_failed";
    nextStats.run.error = `benchmark gate failed: ${gateFailureMessage(evaluation.failures)}`;
  }

  writeJson(statsPath, nextStats);
  if (!evaluation.ok) {
    console.error(`[run] ${stats.repo?.key ?? "item"} failed benchmark gate: ${gateFailureMessage(evaluation.failures)}`);
  }
  return nextStats;
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

const CORTEX_NPM_PACKAGE = "@danielblomma/cortex-mcp";

/**
 * Resolves which cortex build this run measures. For "local" that is the
 * working tree's package version; for "npm" the requested version/dist-tag is
 * validated against the registry and resolved to one exact version, so the
 * run fails fast on typos instead of after an hour of containers.
 */
async function resolveCortexSource(config) {
  if (config.cortex.source === "local") {
    return { source: "local", version: loadJson(path.join(REPO_ROOT, "package.json")).version ?? "unknown" };
  }
  const spec = config.cortex.version.trim();
  const result = await runCommand({
    command: "npm",
    args: ["view", `${CORTEX_NPM_PACKAGE}@${spec}`, "version", "--json"],
    timeoutMs: 60 * 1000
  });
  const version = result.ok ? parseNpmViewVersion(result.stdout) : null;
  if (!version) {
    throw usageError(
      `cortex.version '${spec}' does not resolve to a published ${CORTEX_NPM_PACKAGE} version: ` +
        `${(result.stderr || result.stdout || "no matching version").trim().slice(0, 200)}`
    );
  }
  return { source: "npm", version };
}

async function packCortex(cortexSource) {
  ensureDir(BUILD_DIR);
  const packTarget =
    cortexSource.source === "local" ? null : `${CORTEX_NPM_PACKAGE}@${cortexSource.version}`;
  console.log(
    packTarget
      ? `[run] fetching cortex ${packTarget} from npm (npm pack)`
      : "[run] packing cortex from local source (npm pack)"
  );
  const result = await runCommand({
    command: "npm",
    args: ["pack", ...(packTarget ? [packTarget] : []), "--pack-destination", BUILD_DIR],
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

async function buildImage(imageTag, platform, warmupModel) {
  console.log(`[run] building docker image ${imageTag} (${platform ?? "host platform"})`);
  const platformArgs = platform ? ["--platform", platform] : [];
  const warmupArgs = warmupModel ? ["--build-arg", `BB_WARMUP_MODEL=${warmupModel}`] : [];
  const result = await runCommand({
    command: "docker",
    args: ["build", ...platformArgs, ...warmupArgs, "-f", path.join("docker", "Dockerfile"), "-t", imageTag, "."],
    cwd: HARNESS_DIR,
    timeoutMs: 90 * 60 * 1000,
    onLine: (line) => console.log(`[docker-build] ${line}`)
  });
  if (!result.ok) {
    throw new Error(`docker build failed (exit ${result.code})`);
  }
}

async function resolveCpusPerContainer(config) {
  if (config.docker.cpus === null || config.docker.cpus === false) {
    return null;
  }
  if (Number.isFinite(config.docker.cpus) && config.docker.cpus > 0) {
    return config.docker.cpus;
  }
  // "auto": split the daemon's CPUs across parallel containers.
  const info = await runCommand({
    command: "docker",
    args: ["info", "--format", "{{.NCPU}}"],
    timeoutMs: 30 * 1000
  });
  const total = Number.parseInt(info.stdout.trim(), 10);
  if (!Number.isFinite(total) || total < 1) {
    return null;
  }
  return Math.max(1, Math.floor(total / config.parallelism));
}

function buildWorkItems(repos, config, runId, cortexSource) {
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
            cortex_version: cortexSource.version,
            cortex_source: cortexSource.source,
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

// Remove stopped eval containers left by a prior crashed or SIGKILLed run.
// Normal runs self-remove via `docker run --rm`, so this only finds leftovers
// after an abnormal exit. Best-effort: any failure here is logged, never fatal.
async function sweepLeftoverContainers() {
  try {
    const ps = await runCommand({
      command: "docker",
      args: ["ps", "-a", "--format", "{{.Names}} {{.Status}}"],
      timeoutMs: 30 * 1000
    });
    if (!ps.ok) return;
    const leftover = stoppedEvalContainers(ps.stdout);
    if (leftover.length === 0) return;
    console.log(`[run] sweeping ${leftover.length} leftover bb-* container(s) from a prior run`);
    await runCommand({ command: "docker", args: ["rm", "--force", ...leftover], timeoutMs: 60 * 1000 });
  } catch (error) {
    console.warn(`[run] leftover-container sweep skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

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
      return applyBenchmarkGates(existing, config, statsPathExisting);
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
      ...(config.docker.platform ? ["--platform", config.docker.platform] : []),
      ...(paths.cpusPerContainer
        ? ["--cpus", String(paths.cpusPerContainer), "-e", `CORTEX_EMBED_THREADS=${paths.cpusPerContainer}`]
        : []),
      // --memory-swap = --memory disables swap, so the scheduler's cgroup-aware
      // gate sizes its pool to fit instead of thrashing or over-committing.
      ...(config.docker.memory ? ["--memory", config.docker.memory, "--memory-swap", config.docker.memory] : []),
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
    return applyBenchmarkGates(stats, config, statsPath);
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
  const cortexSource = await resolveCortexSource(config);
  console.log(`[run] cortex under test: ${cortexSource.source} v${cortexSource.version}`);

  const startedAt = nowIso();
  const runId =
    parseFlag(args, "--run-id") ??
    `${config.run_name}-${startedAt.replace(/[:.]/g, "-").replace("T", "_").slice(0, 19)}`;

  const resultsRoot = path.isAbsolute(config.results_dir)
    ? config.results_dir
    : path.join(REPO_ROOT, config.results_dir);
  const runDir = path.join(resultsRoot, runId);
  const paths = {
    runDir,
    itemsDir: path.join(runDir, "items"),
    resume: hasFlag(args, "--resume"),
    cpusPerContainer: await resolveCpusPerContainer(config)
  };
  if (paths.cpusPerContainer) {
    console.log(`[run] cpu quota per container: ${paths.cpusPerContainer}`);
  }
  if (config.docker.memory) {
    console.log(`[run] memory limit per container: ${config.docker.memory}`);
  }

  const items = buildWorkItems(repos, config, runId, cortexSource);
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
  await sweepLeftoverContainers();
  writeJson(path.join(runDir, "config.json"), { ...config, run_id: runId, started_at: startedAt });

  if (config.docker.build && !hasFlag(args, "--skip-build")) {
    await packCortex(cortexSource);
    await buildImage(config.docker.image, config.docker.platform, config.embed_models[0]);
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
      cortex_version: cortexSource.version,
      cortex_source: cortexSource.source,
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(error?.isUsageError ? 2 : 1);
  });
}
