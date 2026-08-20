#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const DEFAULT_CORTEX = path.join(REPO_ROOT, "bin", "cortex.mjs");
const QUERY_RUNNER = path.join(HERE, "run-query-pack.mjs");
const CHECKPOINTS = [0, 10, 25, 50, 100];
const QUERY_CHECKPOINT_TIMEOUT_MS = 30 * 60_000;
const SOURCE_PATHS = [
  "packages/compiler-cli",
  "packages/core",
  "packages/compiler",
  "packages/router",
  "packages/platform-browser",
  "README.md"
];

function flag(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runCli(cortexBin, repoRoot, args, env, timeout = 120_000) {
  const result = spawnSync(process.execPath, [cortexBin, ...args], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    timeout
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`cortex ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function readStatus(cortexBin, repoRoot, env) {
  return JSON.parse(runCli(cortexBin, repoRoot, ["indexing", "status", "--json"], env));
}

function processTable() {
  const result = spawnSync("ps", ["-axo", "pid=,ppid=,rss=,%cpu="], { encoding: "utf8" });
  if (result.status !== 0) return [];
  return result.stdout.trim().split(/\n/).map((line) => {
    const [pid, ppid, rss, cpu] = line.trim().split(/\s+/).map(Number);
    return { pid, ppid, rss_kb: rss, cpu_percent: cpu };
  }).filter((item) => Number.isFinite(item.pid));
}

export function processTreeMetrics(rootPid, table = processTable()) {
  const children = new Map();
  for (const item of table) {
    const values = children.get(item.ppid) || [];
    values.push(item);
    children.set(item.ppid, values);
  }
  const pending = [Number(rootPid)];
  const seen = new Set();
  let rssKb = 0;
  let cpuPercent = 0;
  while (pending.length) {
    const pid = pending.pop();
    if (!Number.isFinite(pid) || seen.has(pid)) continue;
    seen.add(pid);
    const item = table.find((entry) => entry.pid === pid);
    if (item) {
      rssKb += item.rss_kb || 0;
      cpuPercent += item.cpu_percent || 0;
    }
    for (const child of children.get(pid) || []) pending.push(child.pid);
  }
  return { rss_kb: rssKb, cpu_percent: Number(cpuPercent.toFixed(1)), process_count: seen.size };
}

export function expectedHitSet(queryOutput) {
  const found = new Set();
  for (const query of queryOutput.queries || []) {
    for (const expected of query.expected || []) {
      if (expected.match_level !== "missing") found.add(`${query.id}\u0000${expected.expected}`);
    }
  }
  return found;
}

export function compareExpectedHits(baseline, candidate) {
  const before = expectedHitSet(baseline);
  const after = expectedHitSet(candidate);
  return {
    gained: [...after].filter((key) => !before.has(key)).sort(),
    lost: [...before].filter((key) => !after.has(key)).sort()
  };
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const SOURCE_BINDINGS = [
  ["scaffold/mcp/src/embed.ts", ".context/mcp/src/embed.ts"],
  ["scaffold/mcp/src/embeddings.ts", ".context/mcp/src/embeddings.ts"],
  ["scaffold/mcp/src/graph.ts", ".context/mcp/src/graph.ts"],
  ["scaffold/mcp/src/loadGraph.ts", ".context/mcp/src/loadGraph.ts"],
  ["scaffold/mcp/src/paths.ts", ".context/mcp/src/paths.ts"],
  ["scaffold/mcp/src/progressiveIndexing.ts", ".context/mcp/src/progressiveIndexing.ts"],
  ["scaffold/scripts/indexing.mjs", ".context/scripts/indexing.mjs"],
  ["scaffold/scripts/bootstrap.sh", ".context/scripts/bootstrap.sh"],
  ["scaffold/scripts/context.sh", ".context/scripts/context.sh"],
  ["scaffold/scripts/embed.sh", ".context/scripts/embed.sh"],
  ["scaffold/scripts/ingest.sh", ".context/scripts/ingest.sh"],
  ["scaffold/scripts/load-ryu.sh", ".context/scripts/load-ryu.sh"],
  ["scaffold/scripts/watch.sh", ".context/scripts/watch.sh"],
  ["scaffold/scripts/lib/ingest/pipeline-stages.mjs", ".context/scripts/lib/ingest/pipeline-stages.mjs"]
];

function sourceBindings(repoRoot) {
  return SOURCE_BINDINGS.map(([source, installed]) => {
    const sourcePath = path.join(REPO_ROOT, source);
    const installedPath = path.join(repoRoot, installed);
    const sourceSha256 = sha256(sourcePath);
    const installedSha256 = sha256(installedPath);
    return { source, installed, source_sha256: sourceSha256, installed_sha256: installedSha256, equal: sourceSha256 === installedSha256 };
  });
}

function resetBenchmarkIndexingArtifacts(cortexBin, repoRoot, env) {
  const previous = readStatus(cortexBin, repoRoot, env);
  if (previous.active) {
    throw new Error(`Refusing to reset benchmark artifacts while indexing pid ${previous.pid} is active`);
  }
  for (const managedPath of [
    path.join(repoRoot, ".context", "embeddings"),
    path.join(repoRoot, ".context", "indexing.lock")
  ]) {
    let stat;
    try {
      stat = fs.lstatSync(managedPath);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Refusing to reset unsafe benchmark artifact path: ${managedPath}`);
    }
    fs.rmSync(managedPath, { recursive: true });
  }
}

function measureForegroundSearch(cortexBin, repoRoot, env) {
  const firstQuery = fs.readFileSync(
    path.join(HERE, "query-packs", "semantic-quality-v1", "angular__angular.jsonl"),
    "utf8"
  ).split(/\r?\n/).find(Boolean);
  const query = JSON.parse(firstQuery).query;
  const started = Date.now();
  const result = spawnSync(process.execPath, [cortexBin, "search", query, "--top-k", "10", "--preset", "compact", "--json"], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    timeout: 120_000
  });
  return {
    duration_ms: Date.now() - started,
    exit_code: result.status,
    ok: result.status === 0,
    semantic_engine: result.status === 0 ? JSON.parse(result.stdout)?.data?.semantic_engine ?? null : null,
    error: result.status === 0 ? null : result.stderr || result.error?.message || "search failed"
  };
}

async function runQueryCheckpoint({ label, repoRoot, cortexBin, outDir, env, status }) {
  const out = path.join(outDir, `query-${label}.json`);
  const started = Date.now();
  const result = spawnSync(process.execPath, [
    QUERY_RUNNER,
    "--repo-root", repoRoot,
    "--repo-key", "angular__angular",
    "--run-id", `wo046-${label}`,
    "--cortex-bin", cortexBin,
    "--out", out
  ], { cwd: REPO_ROOT, env, encoding: "utf8", timeout: QUERY_CHECKPOINT_TIMEOUT_MS });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`query checkpoint ${label} failed: ${result.stderr || result.stdout}`);
  return {
    label,
    captured_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    status,
    output: JSON.parse(fs.readFileSync(out, "utf8"))
  };
}

async function waitForPaused(cortexBin, repoRoot, env) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const status = readStatus(cortexBin, repoRoot, env);
    if (status.state === "paused") return status;
    if (["failed", "interrupted"].includes(status.state)) {
      throw new Error(`indexing entered ${status.state}: ${status.error || "unknown error"}`);
    }
    await sleep(500);
  }
  throw new Error("timed out waiting for paused indexing checkpoint");
}

async function main() {
  const args = process.argv.slice(2);
  const repoRoot = path.resolve(flag(args, "--repo-root") || "");
  const outDir = path.resolve(flag(args, "--out-dir") || path.join(HERE, "results", "wo046-progressive-angular"));
  const cortexBin = path.resolve(flag(args, "--cortex-bin", DEFAULT_CORTEX));
  if (!repoRoot || !fs.existsSync(path.join(repoRoot, ".git"))) {
    throw new Error("--repo-root must point to the pinned Angular worktree");
  }
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim();
  if (head !== "71bb19d772aa77a30922fb896f775b58a0862c36") {
    throw new Error(`Angular HEAD mismatch: ${head}`);
  }
  fs.mkdirSync(outDir, { recursive: true });

  const env = {
    ...process.env,
    CORTEX_EMBED_MODEL: flag(args, "--model", "Xenova/all-MiniLM-L6-v2"),
    CORTEX_INDEXING_START_PAUSED: "1",
    CORTEX_AUTO_MIGRATE: "0"
  };
  runCli(cortexBin, repoRoot, ["init", repoRoot, "--force", "--no-watch"], env, 120_000);
  const contextConfigPath = path.join(repoRoot, ".context", "config.yaml");
  const initialContextConfig = fs.readFileSync(contextConfigPath, "utf8");
  const sourcePathsBlock = `source_paths:\n${SOURCE_PATHS.map((entry) => `  - ${entry}`).join("\n")}\n`;
  const sourcePathsPattern = /^source_paths:\s*\n(?:\s+-[^\n]*\n)+/m;
  if (!sourcePathsPattern.test(initialContextConfig)) {
    throw new Error("Angular evidence could not find the generated source_paths block");
  }
  const contextConfig = initialContextConfig.replace(sourcePathsPattern, sourcePathsBlock);
  fs.writeFileSync(contextConfigPath, contextConfig, "utf8");
  const bindings = sourceBindings(repoRoot);
  if (bindings.some((binding) => !binding.equal)) {
    throw new Error(`Installed WO-046 sources do not match the current scaffold: ${JSON.stringify(bindings)}`);
  }
  resetBenchmarkIndexingArtifacts(cortexBin, repoRoot, env);
  const startedAt = Date.now();
  const bootstrapLog = fs.createWriteStream(path.join(outDir, "bootstrap.log"), { flags: "w" });
  let readyAt = null;
  let bootstrapPid = null;
  const samples = [];

  const bootstrap = spawn(process.execPath, [cortexBin, "bootstrap", "--background", "--profile", "interactive"], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  bootstrapPid = bootstrap.pid;
  const onChunk = (channel) => (chunk) => {
    const text = chunk.toString();
    bootstrapLog.write(`${Date.now()} ${channel} ${text}`);
    if (text.includes("search_ready=lexical+graph") && readyAt === null) readyAt = Date.now();
  };
  bootstrap.stdout.on("data", onChunk("stdout"));
  bootstrap.stderr.on("data", onChunk("stderr"));

  let activePid = bootstrapPid;
  const sampleTimer = setInterval(() => {
    if (!activePid) return;
    samples.push({ at: new Date().toISOString(), phase: activePid === bootstrapPid ? "bootstrap" : "embedding", pid: activePid, ...processTreeMetrics(activePid) });
  }, 1000);

  const bootstrapCode = await new Promise((resolve, reject) => {
    bootstrap.on("error", reject);
    bootstrap.on("close", resolve);
  });
  bootstrapLog.end();
  if (bootstrapCode !== 0) throw new Error(`background bootstrap exited ${bootstrapCode}`);
  const cliReturnedAt = Date.now();

  let status = await waitForPaused(cortexBin, repoRoot, env);
  activePid = status.pid;
  const captures = [];
  captures.push(await runQueryCheckpoint({ label: "lexical-graph", repoRoot, cortexBin, outDir, env, status }));
  const pauseResume = [{ action: "initial-paused", at: new Date().toISOString(), completed: status.completed_entities }];
  runCli(cortexBin, repoRoot, ["indexing", "resume"], env);
  pauseResume.push({ action: "resume", at: new Date().toISOString(), completed: status.completed_entities });
  const foregroundSearchWhileEmbedding = measureForegroundSearch(cortexBin, repoRoot, env);

  for (const threshold of CHECKPOINTS.slice(1, -1)) {
    while (true) {
      await sleep(2000);
      status = readStatus(cortexBin, repoRoot, env);
      activePid = status.pid;
      if (["failed", "interrupted"].includes(status.state)) {
        throw new Error(`indexing entered ${status.state}: ${status.error || "unknown error"}`);
      }
      if (Number(status.semantic_coverage_percent) >= threshold || status.state === "complete") break;
    }
    if (status.state !== "complete" && status.state !== "complete_with_failures") {
      runCli(cortexBin, repoRoot, ["indexing", "pause"], env, 180_000);
      status = await waitForPaused(cortexBin, repoRoot, env);
      pauseResume.push({ action: "pause", threshold, at: new Date().toISOString(), completed: status.completed_entities });
    }
    captures.push(await runQueryCheckpoint({ label: `semantic-${threshold}`, repoRoot, cortexBin, outDir, env, status }));
    if (status.state === "paused") {
      if (threshold === 25) {
        const interruptedAt = status.completed_entities;
        process.kill(Number(status.pid), "SIGTERM");
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
          status = readStatus(cortexBin, repoRoot, env);
          if (status.state === "interrupted") break;
          await sleep(250);
        }
        if (status.state !== "interrupted") throw new Error("worker did not enter interrupted state after SIGTERM");
        pauseResume.push({ action: "forced-interruption", threshold, at: new Date().toISOString(), completed: interruptedAt });
        runCli(cortexBin, repoRoot, ["indexing", "resume"], env);
        status = readStatus(cortexBin, repoRoot, env);
        if (status.completed_entities !== interruptedAt) {
          throw new Error(`resume checkpoint mismatch: ${status.completed_entities} != ${interruptedAt}`);
        }
        pauseResume.push({ action: "resume-after-interruption", threshold, at: new Date().toISOString(), completed: interruptedAt });
      } else {
        runCli(cortexBin, repoRoot, ["indexing", "resume"], env);
        pauseResume.push({ action: "resume", threshold, at: new Date().toISOString(), completed: status.completed_entities });
      }
    }
  }

  while (true) {
    await sleep(2000);
    status = readStatus(cortexBin, repoRoot, env);
    activePid = status.pid;
    if (["complete", "complete_with_failures"].includes(status.state)) break;
    if (["failed", "interrupted"].includes(status.state)) throw new Error(`indexing ${status.state}: ${status.error || "unknown error"}`);
  }
  const completedAt = Date.now();
  clearInterval(sampleTimer);
  captures.push(await runQueryCheckpoint({ label: "semantic-100", repoRoot, cortexBin, outDir, env, status }));

  const entitiesPath = path.join(repoRoot, ".context", "embeddings", "entities.jsonl");
  const embeddingsDir = path.dirname(entitiesPath);
  const manifestPath = path.join(embeddingsDir, "manifest.json");
  const progressiveHash = sha256(entitiesPath);
  const progressiveManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  fs.copyFileSync(entitiesPath, path.join(outDir, "progressive-entities.jsonl"));
  writeJson(path.join(outDir, "progressive-manifest.json"), progressiveManifest);
  for (const entry of fs.readdirSync(embeddingsDir)) {
    if (/^entities(?:\.progress-[A-Za-z0-9-]+)?\.jsonl$/.test(entry)) {
      fs.rmSync(path.join(embeddingsDir, entry));
    }
  }
  fs.rmSync(manifestPath);
  runCli(cortexBin, repoRoot, ["embed"], { ...env, CORTEX_INDEXING_START_PAUSED: "0" }, 30 * 60_000);
  const foregroundHash = sha256(entitiesPath);
  const foregroundManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (foregroundManifest.counts?.embedded !== foregroundManifest.counts?.entities || foregroundManifest.counts?.reused !== 0) {
    throw new Error(`foreground control reused embeddings: ${JSON.stringify(foregroundManifest.counts)}`);
  }
  fs.copyFileSync(entitiesPath, path.join(outDir, "foreground-entities.jsonl"));
  writeJson(path.join(outDir, "foreground-manifest.json"), foregroundManifest);
  const foregroundCapture = await runQueryCheckpoint({
    label: "foreground-control",
    repoRoot,
    cortexBin,
    outDir,
    env,
    status: readStatus(cortexBin, repoRoot, env)
  });

  const baseline = captures[0].output;
  const checkpointSummaries = captures.map((capture) => ({
    label: capture.label,
    captured_at: capture.captured_at,
    duration_ms: capture.duration_ms,
    status: capture.status,
    summary: capture.output.summary,
    delta_vs_lexical_graph: compareExpectedHits(baseline, capture.output)
  }));
  const bootstrapSamples = samples.filter((sample) => sample.phase === "bootstrap");
  const embeddingSamples = samples.filter((sample) => sample.phase === "embedding");
  const resourceSummary = (phaseSamples) => ({
    samples: phaseSamples.length,
    peak_rss_mb: Number((Math.max(0, ...phaseSamples.map((sample) => sample.rss_kb)) / 1024).toFixed(2)),
    peak_cpu_percent: Math.max(0, ...phaseSamples.map((sample) => sample.cpu_percent)
  )});
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    repo: "angular/angular",
    repo_sha: head,
    model: env.CORTEX_EMBED_MODEL,
    system: {
      platform: process.platform,
      release: os.release(),
      cpu_model: os.cpus()[0]?.model ?? null,
      logical_cpus: os.cpus().length,
      total_memory_bytes: os.totalmem()
    },
    profile: { ingest_workers: 2, embedding_pool: 1, embedding_threads: 4 },
    source_scope: {
      source_paths: SOURCE_PATHS,
      context_config_sha256: sha256(contextConfigPath),
      query_checkpoint_timeout_ms: QUERY_CHECKPOINT_TIMEOUT_MS
    },
    harness_sha256: sha256(fileURLToPath(import.meta.url)),
    source_bindings: bindings,
    timing: {
      time_to_search_ready_ms: readyAt === null ? null : readyAt - startedAt,
      cli_return_ms: cliReturnedAt - startedAt,
      total_completion_ms: completedAt - startedAt
    },
    resources: {
      bootstrap: resourceSummary(bootstrapSamples),
      embedding: resourceSummary(embeddingSamples)
    },
    pause_resume: pauseResume,
    foreground_search_while_embedding: foregroundSearchWhileEmbedding,
    final_status: status,
    deterministic_foreground_control: {
      progressive_sha256: progressiveHash,
      foreground_sha256: foregroundHash,
      equal: progressiveHash === foregroundHash,
      progressive_manifest: progressiveManifest,
      foreground_manifest: foregroundManifest,
      query_equal: JSON.stringify(captures.at(-1)?.output?.summary) === JSON.stringify(foregroundCapture.output.summary),
      foreground_query_summary: foregroundCapture.output.summary
    },
    checkpoints: checkpointSummaries,
    samples
  };
  writeJson(path.join(outDir, "report.json"), report);
  process.stdout.write(`${JSON.stringify({ ok: status.state === "complete" && progressiveHash === foregroundHash, report: path.join(outDir, "report.json"), timing: report.timing }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[wo046] ${error.stack || error.message}`);
    process.exit(1);
  });
}
