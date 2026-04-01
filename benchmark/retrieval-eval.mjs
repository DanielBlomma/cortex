#!/usr/bin/env node

/**
 * Cortex Retrieval Quality Evaluator
 *
 * Measures whether context.search returns the right files and chunks
 * for a set of queries with human-annotated gold context.
 *
 * Metrics (inspired by ContextBench):
 *   - File Recall:  how many expected files appeared in results
 *   - Chunk Recall: how many expected chunk patterns matched results
 *   - Precision:    what fraction of returned results were in the gold set
 *   - F1:           harmonic mean of recall and precision
 *
 * Usage:
 *   node benchmark/retrieval-eval.mjs [options]
 *
 * Options:
 *   --discover             Show what Cortex returns (for building gold sets)
 *   --queries <ids>        Comma-separated query IDs (default: all)
 *   --top-k <n>            Number of results per query (default: 10)
 *   --threshold <pct>      Minimum recall % for CI pass (default: 60)
 *   --ci                   Exit 1 if below threshold
 *   --output <dir>         Output directory (default: benchmark/results)
 *   --ground-truth <path>  Path to retrieval-ground-truth.json
 *   --verbose              Show per-result match details
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const MCP_DIR = join(PROJECT_ROOT, "mcp");

// Resolve MCP SDK from the mcp/ workspace where it is installed
const require = createRequire(join(MCP_DIR, "node_modules", ".package-lock.json"));
const { Client } = await import(require.resolve("@modelcontextprotocol/sdk/client/index.js"));
const { StdioClientTransport } = await import(require.resolve("@modelcontextprotocol/sdk/client/stdio.js"));

const DEFAULT_TOP_K = 10;
const DEFAULT_THRESHOLD = 60;

// --- Args ---

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    discover: false,
    queries: null,
    topK: DEFAULT_TOP_K,
    threshold: DEFAULT_THRESHOLD,
    ci: false,
    outputDir: join(__dirname, "results"),
    groundTruth: join(__dirname, "retrieval-ground-truth.json"),
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--discover": opts.discover = true; break;
      case "--queries": opts.queries = args[++i]?.split(","); break;
      case "--top-k": opts.topK = parseInt(args[++i]); break;
      case "--threshold": opts.threshold = parseInt(args[++i]); break;
      case "--ci": opts.ci = true; break;
      case "--output": opts.outputDir = args[++i]; break;
      case "--ground-truth": opts.groundTruth = args[++i]; break;
      case "--verbose": opts.verbose = true; break;
      case "--help":
        console.log(`
Cortex Retrieval Quality Evaluator

Usage: node benchmark/retrieval-eval.mjs [options]

Options:
  --discover             Show raw Cortex results per query (for building gold sets)
  --queries <ids>        Comma-separated query IDs (default: all)
  --top-k <n>            Results per query (default: ${DEFAULT_TOP_K})
  --threshold <pct>      Minimum file recall % for CI (default: ${DEFAULT_THRESHOLD})
  --ci                   CI mode: exit 1 if below threshold
  --output <dir>         Output directory
  --ground-truth <path>  Path to retrieval-ground-truth.json
  --verbose              Show per-result match details
  --help                 This help
        `);
        process.exit(0);
    }
  }

  return opts;
}

// --- MCP Client ---

async function withClient(fn) {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/server.js"],
    cwd: MCP_DIR,
    stderr: "pipe",
    env: process.env,
  });

  const client = new Client({ name: "retrieval-eval", version: "1.0.0" });
  await client.connect(transport);
  try {
    await fn(client);
  } finally {
    await client.close();
  }
}

async function searchContext(client, query, topK) {
  const result = await client.callTool({
    name: "context.search",
    arguments: { query, top_k: topK, include_content: false },
  });

  if (result.isError) {
    throw new Error(`context.search failed: ${JSON.stringify(result)}`);
  }

  return result.structuredContent;
}

// --- Matching ---

function matchesPath(resultPath, expectedPath) {
  if (!resultPath) return false;
  return resultPath === expectedPath || resultPath.endsWith(`/${expectedPath}`);
}

function matchesChunkPattern(resultTitle, pattern) {
  try {
    return new RegExp(pattern).test(resultTitle || "");
  } catch {
    return (resultTitle || "").includes(pattern);
  }
}

function evaluateQuery(queryDef, searchResults) {
  const results = searchResults.results || [];
  const gold = queryDef.goldContext;

  // File recall: how many expected files appeared
  const matchedFiles = new Set();
  const matchedChunks = new Set();

  for (const result of results) {
    for (const expectedPath of gold.expectedPaths) {
      if (matchesPath(result.path, expectedPath)) {
        matchedFiles.add(expectedPath);
      }
    }
    for (const pattern of gold.expectedChunkPatterns || []) {
      if (matchesChunkPattern(result.title, pattern)) {
        matchedChunks.add(pattern);
      }
    }
  }

  const fileRecall = gold.expectedPaths.length > 0
    ? matchedFiles.size / gold.expectedPaths.length
    : 1;

  const chunkPatterns = gold.expectedChunkPatterns || [];
  const chunkRecall = chunkPatterns.length > 0
    ? matchedChunks.size / chunkPatterns.length
    : 1;

  // Precision: what fraction of results matched any gold file or chunk
  let relevantCount = 0;
  for (const result of results) {
    const matchesAnyFile = gold.expectedPaths.some((p) => matchesPath(result.path, p));
    const matchesAnyChunk = chunkPatterns.some((p) => matchesChunkPattern(result.title, p));
    if (matchesAnyFile || matchesAnyChunk) {
      relevantCount++;
    }
  }
  const precision = results.length > 0 ? relevantCount / results.length : 0;

  // Combined recall (weighted: files 40%, chunks 60%)
  const recall = gold.expectedPaths.length > 0 && chunkPatterns.length > 0
    ? 0.4 * fileRecall + 0.6 * chunkRecall
    : fileRecall;

  const f1 = recall + precision > 0
    ? (2 * recall * precision) / (recall + precision)
    : 0;

  return {
    queryId: queryDef.id,
    fileRecall,
    chunkRecall,
    precision,
    recall,
    f1,
    matchedFiles: [...matchedFiles],
    missedFiles: gold.expectedPaths.filter((p) => !matchedFiles.has(p)),
    matchedChunks: [...matchedChunks],
    missedChunks: chunkPatterns.filter((p) => !matchedChunks.has(p)),
    totalResults: results.length,
    relevantResults: relevantCount,
  };
}

// --- Discover mode ---

function printDiscovery(queryDef, searchResults) {
  const results = searchResults.results || [];
  console.log(`\n--- ${queryDef.id}: "${queryDef.query}" ---`);
  console.log(`    ${results.length} results (of ${searchResults.total_candidates} candidates)\n`);

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(`  ${i + 1}. [${r.entity_type}] ${r.title}`);
    console.log(`     path: ${r.path || "(none)"}`);
    console.log(`     id:   ${r.id}`);
    console.log(`     score: ${r.score}  (semantic=${r.semantic_score} graph=${r.graph_score})`);
  }
}

// --- Report ---

function generateReport(evaluations, opts) {
  const timestamp = new Date().toISOString().split("T")[0];

  const avgFileRecall = evaluations.reduce((s, e) => s + e.fileRecall, 0) / evaluations.length;
  const avgChunkRecall = evaluations.reduce((s, e) => s + e.chunkRecall, 0) / evaluations.length;
  const avgPrecision = evaluations.reduce((s, e) => s + e.precision, 0) / evaluations.length;
  const avgRecall = evaluations.reduce((s, e) => s + e.recall, 0) / evaluations.length;
  const avgF1 = evaluations.reduce((s, e) => s + e.f1, 0) / evaluations.length;

  const pctRecall = (avgRecall * 100).toFixed(1);
  const pass = parseFloat(pctRecall) >= opts.threshold;

  let md = `# Cortex Retrieval Quality Report\n`;
  md += `**Date:** ${timestamp}  \n`;
  md += `**top_k:** ${opts.topK}  \n`;
  md += `**Queries:** ${evaluations.length}  \n\n`;

  md += `## Aggregate Metrics\n\n`;
  md += `| Metric | Score |\n`;
  md += `|--------|-------|\n`;
  md += `| File Recall | ${(avgFileRecall * 100).toFixed(1)}% |\n`;
  md += `| Chunk Recall | ${(avgChunkRecall * 100).toFixed(1)}% |\n`;
  md += `| Combined Recall | ${pctRecall}% |\n`;
  md += `| Precision | ${(avgPrecision * 100).toFixed(1)}% |\n`;
  md += `| F1 | ${(avgF1 * 100).toFixed(1)}% |\n`;
  md += `| Threshold | ${opts.threshold}% — ${pass ? "PASS" : "FAIL"} |\n\n`;

  md += `## Per-Query Results\n\n`;
  md += `| Query | File Recall | Chunk Recall | Precision | F1 | Missed |\n`;
  md += `|-------|------------|-------------|-----------|-----|--------|\n`;

  for (const e of evaluations) {
    const missed = [...e.missedFiles, ...e.missedChunks].join(", ") || "-";
    md += `| ${e.queryId} | ${(e.fileRecall * 100).toFixed(0)}% | ${(e.chunkRecall * 100).toFixed(0)}% | ${(e.precision * 100).toFixed(0)}% | ${(e.f1 * 100).toFixed(0)}% | ${missed} |\n`;
  }

  return { markdown: md, avgRecall: parseFloat(pctRecall), pass };
}

// --- Main ---

async function main() {
  const opts = parseArgs();

  const gt = JSON.parse(readFileSync(opts.groundTruth, "utf-8"));
  let queries = gt.queries;

  if (opts.queries) {
    queries = queries.filter((q) => opts.queries.includes(q.id));
  }

  console.log(`Cortex Retrieval Eval — ${queries.length} queries, top_k=${opts.topK}\n`);

  const evaluations = [];

  await withClient(async (client) => {
    for (const queryDef of queries) {
      process.stdout.write(`  ${queryDef.id}: `);

      const searchResults = await searchContext(client, queryDef.query, opts.topK);

      if (opts.discover) {
        printDiscovery(queryDef, searchResults);
        continue;
      }

      const evaluation = evaluateQuery(queryDef, searchResults);
      evaluations.push(evaluation);

      const status = evaluation.recall >= 0.8 ? "OK" : evaluation.recall >= 0.5 ? "PARTIAL" : "MISS";
      console.log(
        `${status}  recall=${(evaluation.recall * 100).toFixed(0)}%  ` +
        `precision=${(evaluation.precision * 100).toFixed(0)}%  ` +
        `f1=${(evaluation.f1 * 100).toFixed(0)}%`
      );

      if (opts.verbose && (evaluation.missedFiles.length > 0 || evaluation.missedChunks.length > 0)) {
        if (evaluation.missedFiles.length > 0) {
          console.log(`    missed files:  ${evaluation.missedFiles.join(", ")}`);
        }
        if (evaluation.missedChunks.length > 0) {
          console.log(`    missed chunks: ${evaluation.missedChunks.join(", ")}`);
        }
      }
    }
  });

  if (opts.discover) {
    return;
  }

  // Generate report
  const { markdown, avgRecall, pass } = generateReport(evaluations, opts);

  mkdirSync(opts.outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = join(opts.outputDir, `retrieval-${timestamp}.md`);
  const jsonPath = join(opts.outputDir, `retrieval-${timestamp}.json`);

  writeFileSync(reportPath, markdown);
  writeFileSync(jsonPath, JSON.stringify({ opts, evaluations, avgRecall, pass }, null, 2));

  console.log(`\n  Recall: ${avgRecall}%  ${pass ? "PASS" : "FAIL"} (threshold: ${opts.threshold}%)`);
  console.log(`  Report: ${reportPath}`);

  if (opts.ci && !pass) {
    console.error(`\nRetrieval eval FAILED: ${avgRecall}% < ${opts.threshold}%`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
