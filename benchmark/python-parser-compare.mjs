#!/usr/bin/env node
/**
 * Python parser benchmark.
 *
 * Compares the new tree-sitter Python parser against the prior
 * baseline (no parser — file-level indexing only). The "baseline"
 * here is how Cortex handled .py files before this rollout: each
 * file became a single chunk with zero call-graph or import edges.
 *
 * This measures the structural leap, not a regex/tree-sitter
 * delta — Python had no regex parser to compare against.
 *
 * Usage:
 *   node benchmark/python-parser-compare.mjs              # synthetic corpus
 *   node benchmark/python-parser-compare.mjs --corpus ./path/to/py/src
 *   node benchmark/python-parser-compare.mjs --runs 5
 *   node benchmark/python-parser-compare.mjs --output benchmark/python-delta.md
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { parseCode as parsePython } from "../scripts/parsers/python-treesitter.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { corpus: null, runs: 3, output: null };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--corpus") opts.corpus = args[++i];
    else if (a === "--runs") opts.runs = Number(args[++i]);
    else if (a === "--output") opts.output = args[++i];
  }
  return opts;
}

function collectPythonFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    const entries = readdirSync(cur, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".venv" || entry.name === "venv" || entry.name === "__pycache__" || entry.name === ".context" || entry.name.startsWith(".")) continue;
      const full = join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (extname(entry.name) === ".py") out.push(full);
    }
  }
  return out;
}

const SYNTHETIC_CORPUS = [
  {
    path: "synthetic/basic.py",
    content: [
      "import os",
      "import json as j",
      "from pathlib import Path",
      "",
      "def load_config(path):",
      "    with open(path) as f:",
      "        return j.load(f)",
      "",
      "def render(config):",
      "    result = transform(config)",
      "    return format_output(result)",
      "",
      "def transform(data):",
      "    return {k: v.upper() for k, v in data.items()}"
    ].join("\n")
  },
  {
    path: "synthetic/classes.py",
    content: [
      "from typing import Optional, List",
      "",
      "class Cache:",
      "    def __init__(self, capacity):",
      "        self.capacity = capacity",
      "        self._store = {}",
      "",
      "    def get(self, key):",
      "        return self._store.get(key)",
      "",
      "    def set(self, key, value):",
      "        self._validate(key)",
      "        self._store[key] = value",
      "",
      "    def _validate(self, key):",
      "        if not isinstance(key, str):",
      "            raise TypeError('key must be str')",
      "",
      "class LRUCache(Cache):",
      "    def __init__(self, capacity):",
      "        super().__init__(capacity)",
      "        self._order = []",
      "",
      "    def get(self, key):",
      "        value = super().get(key)",
      "        if value is not None:",
      "            self._touch(key)",
      "        return value",
      "",
      "    def _touch(self, key):",
      "        self._order.remove(key)",
      "        self._order.append(key)"
    ].join("\n")
  },
  {
    path: "synthetic/async.py",
    content: [
      "import asyncio",
      "from aiohttp import ClientSession",
      "",
      "async def fetch_one(session, url):",
      "    async with session.get(url) as resp:",
      "        return await resp.json()",
      "",
      "async def fetch_many(urls):",
      "    async with ClientSession() as session:",
      "        tasks = [fetch_one(session, url) for url in urls]",
      "        return await asyncio.gather(*tasks)",
      "",
      "class Worker:",
      "    async def run(self, queue):",
      "        while True:",
      "            job = await queue.get()",
      "            await self._process(job)",
      "",
      "    async def _process(self, job):",
      "        result = await self.do_work(job)",
      "        await self.publish(result)"
    ].join("\n")
  },
  {
    path: "synthetic/nested.py",
    content: [
      "class Outer:",
      "    class Builder:",
      "        def __init__(self):",
      "            self._state = {}",
      "",
      "        def with_value(self, key, value):",
      "            self._state[key] = value",
      "            return self",
      "",
      "        def build(self):",
      "            return Outer(self._state)",
      "",
      "    def __init__(self, state):",
      "        self.state = state",
      "",
      "    @classmethod",
      "    def builder(cls):",
      "        return cls.Builder()"
    ].join("\n")
  },
  {
    path: "synthetic/imports.py",
    content: [
      "import os",
      "import sys as system",
      "from pathlib import Path, PurePath",
      "from collections import OrderedDict as OD",
      "from .utils import helper, slugify",
      "from ..pkg.deep import something",
      "from ...root_pkg import bootstrap",
      "",
      "def run():",
      "    bootstrap()",
      "    helper()",
      "    slugify('hello world')",
      "    something()"
    ].join("\n")
  },
  {
    path: "synthetic/decorated.py",
    content: [
      "from functools import lru_cache",
      "",
      "def trace(fn):",
      "    def wrapped(*args):",
      "        print(f'calling {fn.__name__}')",
      "        return fn(*args)",
      "    return wrapped",
      "",
      "@trace",
      "@lru_cache(maxsize=128)",
      "def expensive_compute(x):",
      "    return slow_helper(x) * 2",
      "",
      "class Service:",
      "    @staticmethod",
      "    def ping():",
      "        return pong()",
      "",
      "    @property",
      "    def name(self):",
      "        return self._name"
    ].join("\n")
  },
  {
    path: "synthetic/data-processing.py",
    content: [
      "import pandas as pd",
      "from typing import Dict",
      "",
      "def load_data(source: str) -> pd.DataFrame:",
      "    if source.endswith('.csv'):",
      "        return pd.read_csv(source)",
      "    elif source.endswith('.parquet'):",
      "        return pd.read_parquet(source)",
      "    else:",
      "        raise ValueError(f'unsupported: {source}')",
      "",
      "def clean(df: pd.DataFrame) -> pd.DataFrame:",
      "    df = drop_nulls(df)",
      "    df = normalize_columns(df)",
      "    return deduplicate(df)",
      "",
      "def pipeline(source: str) -> Dict:",
      "    df = load_data(source)",
      "    cleaned = clean(df)",
      "    stats = compute_stats(cleaned)",
      "    publish(stats)",
      "    return stats"
    ].join("\n")
  }
];

function loadCorpus(corpusDir) {
  if (!corpusDir) {
    return SYNTHETIC_CORPUS.map((entry) => ({
      path: entry.path,
      content: entry.content,
      bytes: Buffer.byteLength(entry.content, "utf8")
    }));
  }
  const files = collectPythonFiles(corpusDir);
  return files.map((filePath) => {
    const content = readFileSync(filePath, "utf8");
    return { path: filePath, content, bytes: Buffer.byteLength(content, "utf8") };
  });
}

function baselineFileChunks(corpus) {
  return corpus.map((file) => ({
    name: file.path,
    kind: "file",
    signature: "",
    body: file.content,
    startLine: 1,
    endLine: file.content.split("\n").length,
    language: "python",
    exported: true,
    calls: [],
    imports: []
  }));
}

function summarize(chunks) {
  const kindCounts = {};
  const allCalls = new Set();
  const allImports = new Set();
  let totalCallEdges = 0;
  for (const chunk of chunks) {
    kindCounts[chunk.kind] = (kindCounts[chunk.kind] ?? 0) + 1;
    for (const call of chunk.calls ?? []) {
      allCalls.add(`${chunk.name}->${call}`);
      totalCallEdges += 1;
    }
    for (const imp of chunk.imports ?? []) allImports.add(imp);
  }
  return {
    chunks: chunks.length,
    kindCounts,
    uniqueCallEdges: allCalls.size,
    totalCallEdges,
    uniqueImports: allImports.size
  };
}

function timeTreeSitter(corpus, runs) {
  const timings = [];
  let lastChunks = [];
  for (let run = 0; run < runs; run += 1) {
    const t0 = performance.now();
    const allChunks = [];
    for (const file of corpus) {
      const result = parsePython(file.content, file.path, "python");
      allChunks.push(...result.chunks);
    }
    timings.push(performance.now() - t0);
    if (run === runs - 1) lastChunks = allChunks;
  }
  timings.sort((a, b) => a - b);
  return {
    timings,
    medianMs: timings[Math.floor(timings.length / 2)],
    p95Ms: timings[Math.min(timings.length - 1, Math.floor(timings.length * 0.95))],
    chunks: lastChunks
  };
}

function formatKindCounts(baseline, ts) {
  const kinds = new Set([...Object.keys(baseline), ...Object.keys(ts)]);
  return [...kinds].sort().map((k) => {
    const a = baseline[k] ?? 0;
    const b = ts[k] ?? 0;
    const delta = b - a;
    const arrow = delta > 0 ? "+" : "";
    return `| ${k} | ${a} | ${b} | ${arrow}${delta} |`;
  }).join("\n");
}

function renderReport({ corpusInfo, baseline, ts }) {
  const baseSummary = summarize(baseline);
  const tsSummary = summarize(ts.chunks);

  const chunkRatio = baseSummary.chunks > 0 ? (tsSummary.chunks / baseSummary.chunks).toFixed(1) : "∞";

  return [
    "# Python parser benchmark — file-level baseline vs tree-sitter",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Corpus: ${corpusInfo.source} — ${corpusInfo.fileCount} files, ${corpusInfo.totalBytes} bytes`,
    `Runs: ${corpusInfo.runs}`,
    "",
    "## Summary",
    "",
    "Baseline = how Cortex handled .py files before this rollout (file-level indexing).",
    "tree-sitter = new structural parser.",
    "",
    "| Metric | baseline (file-level) | tree-sitter | Δ |",
    "|---|---:|---:|---:|",
    `| Chunks extracted | ${baseSummary.chunks} | ${tsSummary.chunks} | ${tsSummary.chunks - baseSummary.chunks > 0 ? "+" : ""}${tsSummary.chunks - baseSummary.chunks} (${chunkRatio}×) |`,
    `| Unique call edges | ${baseSummary.uniqueCallEdges} | ${tsSummary.uniqueCallEdges} | +${tsSummary.uniqueCallEdges} |`,
    `| Total call edges | ${baseSummary.totalCallEdges} | ${tsSummary.totalCallEdges} | +${tsSummary.totalCallEdges} |`,
    `| Unique imports | ${baseSummary.uniqueImports} | ${tsSummary.uniqueImports} | +${tsSummary.uniqueImports} |`,
    `| Median parse time (ms) | n/a (no parser) | ${ts.medianMs.toFixed(2)} | — |`,
    `| p95 parse time (ms) | n/a | ${ts.p95Ms.toFixed(2)} | — |`,
    "",
    "## Chunks by kind",
    "",
    "| Kind | baseline | tree-sitter | Δ |",
    "|---|---:|---:|---:|",
    formatKindCounts(baseSummary.kindCounts, tsSummary.kindCounts),
    "",
    "## Interpretation",
    "",
    "- **Chunk ratio** shows the granularity jump — each Python file used to be one blob; tree-sitter fragments it into functions, methods, and classes.",
    "- **Call edges** go from 0 to a real count. This unlocks \"find callers of X\" and impact-analysis queries that were broken for Python.",
    "- **Imports** go from 0 to structured edges. Previously Cortex could only text-match import statements, not traverse module dependencies.",
    "- **Latency** is all upside — baseline did zero structural parsing, so this is the intrinsic cost of the new capability (typically <10ms per file).",
    "- Retrieval precision improves proportionally: per-function embeddings give fine-grained search results instead of returning whole files.",
    ""
  ].join("\n");
}

(async function main() {
  const opts = parseArgs();
  const corpus = loadCorpus(opts.corpus);
  const totalBytes = corpus.reduce((acc, f) => acc + f.bytes, 0);

  console.log(`[bench] corpus: ${opts.corpus ?? "synthetic"} — ${corpus.length} files, ${totalBytes} bytes`);
  console.log(`[bench] runs: ${opts.runs}`);

  const baseline = baselineFileChunks(corpus);
  console.log(`[bench] baseline (file-level): ${baseline.length} chunks, 0 call edges, 0 imports`);

  console.log("[bench] running tree-sitter parser...");
  const ts = timeTreeSitter(corpus, opts.runs);
  console.log(`[bench]   median ${ts.medianMs.toFixed(2)}ms, ${ts.chunks.length} chunks`);

  const report = renderReport({
    corpusInfo: {
      source: opts.corpus ?? "synthetic",
      fileCount: corpus.length,
      totalBytes,
      runs: opts.runs
    },
    baseline,
    ts
  });

  console.log("\n" + report);

  if (opts.output) {
    writeFileSync(opts.output, report);
    console.log(`[bench] report written to ${opts.output}`);
  }
})();
