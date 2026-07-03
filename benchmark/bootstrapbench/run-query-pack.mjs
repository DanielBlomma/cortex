#!/usr/bin/env node
/**
 * Runs semantic quality query packs against a bootstrapped Cortex repo.
 *
 * This is intentionally separate from the Docker bootstrap runner: it can run
 * against a pinned local clone, a bootstrapbench container workspace, or the
 * current repository as long as `.context/` is already initialized and indexed.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDir, loadJson, nowIso, parseFlag, runCommand, usageError, writeJson } from "./lib.mjs";

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HARNESS_DIR, "..", "..");
const DEFAULT_PACK_DIR = path.join(HARNESS_DIR, "query-packs", "semantic-quality-v1");
const DEFAULT_RESULTS_DIR = path.join(HARNESS_DIR, "results");
const DEFAULT_CORTEX_BIN = path.join(REPO_ROOT, "bin", "cortex.mjs");

function printHelp() {
  console.log(`Semantic Query Pack Runner

Usage:
  node benchmark/bootstrapbench/run-query-pack.mjs \\
    --repo-root <path> --repo-key <key> --run-id <id> [options]

Options:
  --pack-dir <path>      query pack directory (default semantic-quality-v1)
  --results-dir <path>   output root (default benchmark/bootstrapbench/results)
  --out <path>           explicit output JSON path
  --cortex-bin <path>    cortex executable or JS entrypoint (default local bin/cortex.mjs)
  --preset <name>        search response preset (default compact)
  --allow-sha-mismatch   allow running even if repo HEAD differs from pack SHA
  --fail-on-missing      exit non-zero when any expected path is missing

The target repo must already have a Cortex index. The runner calls:
  cortex search <query> --top-k <n> --preset <preset> --json
`);
}

function readJsonl(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${filePath}:${index + 1}: invalid JSONL: ${error.message}`);
      }
    });
}

function loadQueryPack(packDir, repoKey) {
  const manifest = loadJson(path.join(packDir, "manifest.json"));
  const repo = manifest.repos?.find((entry) => entry.repo_key === repoKey);
  if (!repo) {
    throw usageError(`Repo key '${repoKey}' not found in ${path.join(packDir, "manifest.json")}`);
  }
  const queries = readJsonl(path.join(packDir, repo.file));
  return { manifest, repo, queries };
}

async function readGitHead(repoRoot) {
  const result = await runCommand({
    command: "git",
    args: ["rev-parse", "HEAD"],
    cwd: repoRoot,
    timeoutMs: 10_000,
  });
  if (!result.ok) {
    throw usageError(`Cannot read git HEAD in ${repoRoot}: ${result.stderr.trim() || result.error || result.code}`);
  }
  return result.stdout.trim();
}

function normalizeText(value) {
  return String(value ?? "").toLowerCase();
}

function normalizePath(value) {
  return String(value ?? "")
    .replace(/^file:/, "")
    .replace(/^chunk:/, "")
    .replace(/\\/g, "/")
    .replace(/\/+$/g, "");
}

export function parseExpectedHit(raw) {
  const value = String(raw ?? "").trim();
  const rustStyle = value.match(/^(.+\.[A-Za-z0-9]+)::(.+)$/);
  if (rustStyle) {
    return { raw: value, path: normalizePath(rustStyle[1]), symbol: rustStyle[2] };
  }

  const colonStyle = value.match(/^(.+\.[A-Za-z0-9]+):(.+)$/);
  if (colonStyle) {
    return { raw: value, path: normalizePath(colonStyle[1]), symbol: colonStyle[2] };
  }

  return { raw: value, path: normalizePath(value), symbol: null };
}

function resultPathMatches(result, expectedPath) {
  const pathValue = normalizePath(result?.path);
  if (pathValue === expectedPath) {
    return true;
  }

  const id = normalizePath(result?.id);
  return id === expectedPath || id.startsWith(`${expectedPath}:`);
}

function symbolMatches(result, symbol) {
  if (!symbol) {
    return false;
  }
  const needle = normalizeText(symbol);
  return [
    result?.id,
    result?.title,
    result?.label,
    result?.excerpt,
  ].some((value) => normalizeText(value).includes(needle));
}

export function matchExpectedHit(results, expectedHit) {
  const expected = typeof expectedHit === "string" ? parseExpectedHit(expectedHit) : expectedHit;
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (!resultPathMatches(result, expected.path)) {
      continue;
    }
    const symbol_match = symbolMatches(result, expected.symbol);
    return {
      expected: expected.raw,
      path: expected.path,
      symbol: expected.symbol,
      rank: index + 1,
      match_level: symbol_match ? "symbol" : "path",
      result_id: result.id ?? null,
      result_path: result.path ?? null,
      result_title: result.title ?? null,
    };
  }

  return {
    expected: expected.raw,
    path: expected.path,
    symbol: expected.symbol,
    rank: null,
    match_level: "missing",
    result_id: null,
    result_path: null,
    result_title: null,
  };
}

function resultSummary(result, rank) {
  return {
    rank,
    id: result?.id ?? null,
    entity_type: result?.entity_type ?? null,
    kind: result?.kind ?? null,
    title: result?.title ?? null,
    path: result?.path ?? null,
    score: result?.score ?? null,
    semantic_score: result?.semantic_score ?? null,
    graph_score: result?.graph_score ?? null,
    trust_score: result?.trust_score ?? null,
    recency_score: result?.recency_score ?? null,
  };
}

function commandForCortex(cortexBin, query, topK, preset) {
  const args = ["search", query, "--top-k", String(topK), "--preset", preset, "--json"];
  if (cortexBin.endsWith(".mjs") || cortexBin.endsWith(".js")) {
    return { command: process.execPath, args: [cortexBin, ...args] };
  }
  return { command: cortexBin, args };
}

async function runQuery({ repoRoot, cortexBin, preset, queryRecord }) {
  const topK = Number(queryRecord.top_k) || 10;
  const commandSpec = commandForCortex(cortexBin, queryRecord.query, topK, preset);
  const startedAt = Date.now();
  const result = await runCommand({
    ...commandSpec,
    cwd: repoRoot,
    timeoutMs: 120_000,
  });
  const durationMs = Date.now() - startedAt;

  if (!result.ok) {
    return {
      id: queryRecord.id,
      query: queryRecord.query,
      category: queryRecord.category,
      top_k: topK,
      status: result.timedOut ? "timeout" : "error",
      duration_ms: durationMs,
      error: result.error ?? result.stderr.trim() ?? `cortex search exited ${result.code}`,
      results: [],
      expected: queryRecord.expected_hits.map((hit) => matchExpectedHit([], hit)),
    };
  }

  let envelope;
  try {
    envelope = JSON.parse(result.stdout);
  } catch (error) {
    return {
      id: queryRecord.id,
      query: queryRecord.query,
      category: queryRecord.category,
      top_k: topK,
      status: "invalid_json",
      duration_ms: durationMs,
      error: error.message,
      stdout: result.stdout.slice(0, 1000),
      results: [],
      expected: queryRecord.expected_hits.map((hit) => matchExpectedHit([], hit)),
    };
  }

  const searchResults = Array.isArray(envelope?.data?.results) ? envelope.data.results : [];
  const expected = queryRecord.expected_hits.map((hit) => matchExpectedHit(searchResults, hit));
  const missing = expected.filter((hit) => hit.match_level === "missing");

  return {
    id: queryRecord.id,
    query: queryRecord.query,
    category: queryRecord.category,
    top_k: topK,
    status: envelope.ok === false ? "error" : "ok",
    duration_ms: durationMs,
    semantic_engine: envelope?.data?.semantic_engine ?? null,
    context_source: envelope?.context_source ?? envelope?.data?.context_source ?? null,
    total_candidates: envelope?.data?.total_candidates ?? null,
    expected,
    expected_found: expected.length - missing.length,
    expected_missing: missing.length,
    results: searchResults.map((item, index) => resultSummary(item, index + 1)),
  };
}

function buildSummary(queryResults) {
  const totals = {
    queries: queryResults.length,
    ok: 0,
    errored: 0,
    expected_hits: 0,
    expected_found: 0,
    expected_missing: 0,
    symbol_matches: 0,
    path_only_matches: 0,
  };

  for (const query of queryResults) {
    if (query.status === "ok") {
      totals.ok += 1;
    } else {
      totals.errored += 1;
    }
    for (const expected of query.expected) {
      totals.expected_hits += 1;
      if (expected.match_level === "missing") {
        totals.expected_missing += 1;
      } else {
        totals.expected_found += 1;
      }
      if (expected.match_level === "symbol") {
        totals.symbol_matches += 1;
      } else if (expected.match_level === "path") {
        totals.path_only_matches += 1;
      }
    }
  }

  totals.expected_recall = totals.expected_hits > 0
    ? Math.round((totals.expected_found / totals.expected_hits) * 10000) / 100
    : 0;
  return totals;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const repoRoot = path.resolve(parseFlag(args, "--repo-root") ?? "");
  const repoKey = parseFlag(args, "--repo-key");
  const runId = parseFlag(args, "--run-id");
  if (!repoRoot || repoRoot === process.cwd()) {
    // process.cwd() is a valid repo root; this only catches missing parseFlag,
    // which resolves "" to cwd. Check args directly to avoid rejecting cwd.
    if (!args.includes("--repo-root")) {
      throw usageError("--repo-root is required");
    }
  }
  if (!repoKey) {
    throw usageError("--repo-key is required");
  }
  if (!runId) {
    throw usageError("--run-id is required");
  }

  const packDir = path.resolve(parseFlag(args, "--pack-dir", DEFAULT_PACK_DIR));
  const resultsDir = path.resolve(parseFlag(args, "--results-dir", DEFAULT_RESULTS_DIR));
  const cortexBin = path.resolve(parseFlag(args, "--cortex-bin", DEFAULT_CORTEX_BIN));
  const preset = parseFlag(args, "--preset", "compact");
  const allowShaMismatch = args.includes("--allow-sha-mismatch");
  const failOnMissing = args.includes("--fail-on-missing");

  if (!fs.existsSync(repoRoot)) {
    throw usageError(`--repo-root does not exist: ${repoRoot}`);
  }
  if (!fs.existsSync(cortexBin)) {
    throw usageError(`--cortex-bin does not exist: ${cortexBin}`);
  }

  const { manifest, repo, queries } = loadQueryPack(packDir, repoKey);
  const repoHead = await readGitHead(repoRoot);
  const repoShaMatches = repoHead === repo.repo_sha;
  if (!repoShaMatches && !allowShaMismatch) {
    throw usageError(
      `Repo ${repoKey} is at ${repoHead}, but query pack expects ${repo.repo_sha}; use --allow-sha-mismatch only for exploratory local runs`
    );
  }

  const queryResults = [];
  for (const queryRecord of queries) {
    process.stderr.write(`[query-pack] ${repoKey} ${queryRecord.id}\n`);
    queryResults.push(await runQuery({ repoRoot, cortexBin, preset, queryRecord }));
  }

  const summary = buildSummary(queryResults);
  const output = {
    schema_version: 1,
    generated_at: nowIso(),
    run_id: runId,
    pack: manifest.pack,
    pack_dir: path.relative(REPO_ROOT, packDir),
    repo,
    repo_head: repoHead,
    repo_sha_matches: repoShaMatches,
    repo_root: repoRoot,
    cortex_bin: cortexBin,
    preset,
    summary,
    queries: queryResults,
  };

  const outPath = path.resolve(parseFlag(args, "--out", path.join(resultsDir, runId, "query-quality", `${repoKey}.json`)));
  writeJson(outPath, output);
  process.stdout.write(`${JSON.stringify({ ok: summary.errored === 0 && summary.expected_missing === 0, out: outPath, summary }, null, 2)}\n`);

  if (summary.errored > 0 || (failOnMissing && summary.expected_missing > 0)) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    const message = error?.isUsageError ? error.message : (error?.stack ?? String(error));
    console.error(`[query-pack] ${message}`);
    process.exit(error?.isUsageError ? 2 : 1);
  });
}
