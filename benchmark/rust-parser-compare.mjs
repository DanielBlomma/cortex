#!/usr/bin/env node
/**
 * Rust parser comparison benchmark.
 *
 * Runs the regex parser (scripts/parsers/rust.mjs) and the tree-sitter
 * parser (scripts/parsers/rust-treesitter.mjs) against the same corpus
 * and reports structural deltas:
 *
 *   - chunks extracted (total, by kind)
 *   - unique call-graph edge names
 *   - unique import entries
 *   - parse latency (median, p95, total)
 *
 * Default corpus is a synthetic Rust fixture assembled from realistic
 * patterns (generic impls, cfg-gated items, nested modules, macros,
 * trait impls). Point at a real corpus via --corpus <dir>.
 *
 * Usage:
 *   node benchmark/rust-parser-compare.mjs              # synthetic corpus
 *   node benchmark/rust-parser-compare.mjs --corpus ./path/to/rust/src
 *   node benchmark/rust-parser-compare.mjs --runs 5     # more timing samples
 *   node benchmark/rust-parser-compare.mjs --output benchmark/rust-delta.md
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { parseCode as parseRegex } from "../scripts/parsers/rust.mjs";
import { parseCode as parseTreeSitter } from "../scripts/parsers/rust-treesitter.mjs";

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

function collectRustFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    const entries = readdirSync(cur, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "target" || entry.name === ".context" || entry.name.startsWith(".")) continue;
      const full = join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (extname(entry.name) === ".rs") out.push(full);
    }
  }
  return out;
}

const SYNTHETIC_CORPUS = [
  {
    path: "synthetic/basic.rs",
    content: [
      "use std::collections::HashMap;",
      "use std::io::{self, Read, Write};",
      "use crate::config::Config;",
      "",
      "pub struct Cache {",
      "    map: HashMap<String, String>,",
      "}",
      "",
      "impl Cache {",
      "    pub fn new() -> Self {",
      "        Cache { map: HashMap::new() }",
      "    }",
      "    pub fn get(&self, key: &str) -> Option<&String> {",
      "        self.map.get(key)",
      "    }",
      "    pub fn insert(&mut self, k: String, v: String) {",
      "        self.map.insert(k, v);",
      "    }",
      "}",
      "",
      "pub fn process(input: &str) -> String {",
      "    let cache = Cache::new();",
      "    format!(\"{}: {}\", input, cache.get(input).cloned().unwrap_or_default())",
      "}"
    ].join("\n")
  },
  {
    path: "synthetic/generics.rs",
    content: [
      "use std::fmt::Debug;",
      "",
      "pub struct Wrapper<T: Clone + Send> {",
      "    inner: T,",
      "}",
      "",
      "impl<T: Clone + Send + Debug> Wrapper<T> {",
      "    pub fn new(value: T) -> Self {",
      "        Wrapper { inner: value }",
      "    }",
      "    pub fn get(&self) -> T {",
      "        self.inner.clone()",
      "    }",
      "    pub fn debug(&self) {",
      "        println!(\"{:?}\", self.inner);",
      "    }",
      "}",
      "",
      "impl<T> Iterator for Counter<T> where T: Clone {",
      "    type Item = T;",
      "    fn next(&mut self) -> Option<T> {",
      "        None",
      "    }",
      "}",
      "",
      "pub struct Counter<T> {",
      "    value: T,",
      "}"
    ].join("\n")
  },
  {
    path: "synthetic/cfg-gated.rs",
    content: [
      "#[cfg(target_os = \"linux\")]",
      "pub fn platform_specific() -> u32 {",
      "    linux_syscall()",
      "}",
      "",
      "#[cfg(not(target_os = \"linux\"))]",
      "pub fn platform_specific() -> u32 {",
      "    portable_fallback()",
      "}",
      "",
      "#[cfg(test)]",
      "mod tests {",
      "    use super::*;",
      "    fn test_platform() {",
      "        assert_eq!(platform_specific(), 42);",
      "    }",
      "}"
    ].join("\n")
  },
  {
    path: "synthetic/traits.rs",
    content: [
      "pub trait Handler {",
      "    fn handle(&self, req: Request) -> Response;",
      "    fn name(&self) -> &str { \"default\" }",
      "}",
      "",
      "pub trait AsyncHandler: Handler {",
      "    fn handle_async(&self, req: Request) -> Response;",
      "}",
      "",
      "impl Display for Cache {",
      "    fn fmt(&self, f: &mut Formatter) -> Result {",
      "        write!(f, \"Cache with {} entries\", self.map.len())",
      "    }",
      "}",
      "",
      "impl Handler for MyService {",
      "    fn handle(&self, req: Request) -> Response {",
      "        self.dispatch(req)",
      "    }",
      "}"
    ].join("\n")
  },
  {
    path: "synthetic/macros.rs",
    content: [
      "macro_rules! vec_of {",
      "    ( $( $x:expr ),* ) => {",
      "        {",
      "            let mut v = Vec::new();",
      "            $( v.push($x); )*",
      "            v",
      "        }",
      "    };",
      "}",
      "",
      "macro_rules! log_err {",
      "    ($expr:expr, $msg:expr) => (",
      "        match $expr {",
      "            Ok(v) => v,",
      "            Err(e) => { eprintln!(\"{}: {:?}\", $msg, e); return; }",
      "        }",
      "    );",
      "}",
      "",
      "macro_rules! assert_contains {",
      "    [$collection:expr, $item:expr] => {",
      "        assert!($collection.contains(&$item));",
      "    };",
      "}"
    ].join("\n")
  },
  {
    path: "synthetic/nested-mods.rs",
    content: [
      "pub mod outer {",
      "    pub mod middle {",
      "        pub mod inner {",
      "            pub fn deep_function() -> i32 {",
      "                helper_one() + helper_two()",
      "            }",
      "            fn helper_one() -> i32 { 1 }",
      "            fn helper_two() -> i32 { 2 }",
      "        }",
      "        pub fn middle_function() -> i32 {",
      "            inner::deep_function()",
      "        }",
      "    }",
      "    pub fn outer_function() -> i32 {",
      "        middle::middle_function()",
      "    }",
      "}"
    ].join("\n")
  },
  {
    path: "synthetic/enums-and-closures.rs",
    content: [
      "pub enum State {",
      "    Idle,",
      "    Running { started_at: u64 },",
      "    Failed(String),",
      "    Completed(Result<Output, Error>),",
      "}",
      "",
      "pub fn run_pipeline() {",
      "    let items: Vec<i32> = (0..100).collect();",
      "    let result: Vec<i32> = items.iter()",
      "        .filter(|x| **x > 10)",
      "        .map(|x| {",
      "            match *x {",
      "                n if n < 50 => { process_small(n) }",
      "                n => { process_large(n) }",
      "            }",
      "        })",
      "        .collect();",
      "    handle_result(result);",
      "}"
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
  const files = collectRustFiles(corpusDir);
  return files.map((filePath) => {
    const content = readFileSync(filePath, "utf8");
    return { path: filePath, content, bytes: Buffer.byteLength(content, "utf8") };
  });
}

function summarize(chunks) {
  const kindCounts = Object.create(null);
  const allCalls = new Set();
  const allImports = new Set();
  for (const chunk of chunks) {
    kindCounts[chunk.kind] = (kindCounts[chunk.kind] ?? 0) + 1;
    for (const call of chunk.calls ?? []) allCalls.add(`${chunk.name}->${call}`);
    for (const imp of chunk.imports ?? []) allImports.add(imp);
  }
  return {
    chunks: chunks.length,
    kindCounts,
    uniqueCallEdges: allCalls.size,
    uniqueImports: allImports.size
  };
}

function timeParser(parser, corpus, runs) {
  const timings = [];
  let lastChunks = [];
  for (let run = 0; run < runs; run += 1) {
    const t0 = performance.now();
    const allChunks = [];
    for (const file of corpus) {
      const result = parser(file.content, file.path, "rust");
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
    totalMs: timings.reduce((acc, x) => acc + x, 0),
    chunks: lastChunks
  };
}

function formatKindCounts(counts, otherCounts) {
  const kinds = new Set([...Object.keys(counts), ...Object.keys(otherCounts)]);
  const rows = [...kinds].sort().map((k) => {
    const a = counts[k] ?? 0;
    const b = otherCounts[k] ?? 0;
    const delta = b - a;
    const arrow = delta > 0 ? "+" : "";
    return `| ${k} | ${a} | ${b} | ${arrow}${delta} |`;
  });
  return rows.join("\n");
}

function renderReport({ corpusInfo, regex, ts }) {
  const regexSummary = summarize(regex.chunks);
  const tsSummary = summarize(ts.chunks);

  const delta = {
    chunks: tsSummary.chunks - regexSummary.chunks,
    callEdges: tsSummary.uniqueCallEdges - regexSummary.uniqueCallEdges,
    imports: tsSummary.uniqueImports - regexSummary.uniqueImports,
    medianMs: ts.medianMs - regex.medianMs
  };
  const pct = (a, b) => (a === 0 ? "∞" : `${((b - a) / a * 100).toFixed(1)}%`);

  return [
    "# Rust parser benchmark — regex vs tree-sitter",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Corpus: ${corpusInfo.source} — ${corpusInfo.fileCount} files, ${corpusInfo.totalBytes} bytes`,
    `Runs per parser: ${corpusInfo.runs}`,
    "",
    "## Summary",
    "",
    "| Metric | regex | tree-sitter | Δ | Δ% |",
    "|---|---:|---:|---:|---:|",
    `| Chunks extracted | ${regexSummary.chunks} | ${tsSummary.chunks} | ${delta.chunks >= 0 ? "+" : ""}${delta.chunks} | ${pct(regexSummary.chunks, tsSummary.chunks)} |`,
    `| Unique call edges | ${regexSummary.uniqueCallEdges} | ${tsSummary.uniqueCallEdges} | ${delta.callEdges >= 0 ? "+" : ""}${delta.callEdges} | ${pct(regexSummary.uniqueCallEdges, tsSummary.uniqueCallEdges)} |`,
    `| Unique imports | ${regexSummary.uniqueImports} | ${tsSummary.uniqueImports} | ${delta.imports >= 0 ? "+" : ""}${delta.imports} | ${pct(regexSummary.uniqueImports, tsSummary.uniqueImports)} |`,
    `| Median parse time (ms) | ${regex.medianMs.toFixed(2)} | ${ts.medianMs.toFixed(2)} | ${delta.medianMs >= 0 ? "+" : ""}${delta.medianMs.toFixed(2)} | ${pct(regex.medianMs, ts.medianMs)} |`,
    `| p95 parse time (ms) | ${regex.p95Ms.toFixed(2)} | ${ts.p95Ms.toFixed(2)} | — | — |`,
    "",
    "## Chunks by kind",
    "",
    "| Kind | regex | tree-sitter | Δ |",
    "|---|---:|---:|---:|",
    formatKindCounts(regexSummary.kindCounts, tsSummary.kindCounts),
    "",
    "## Interpretation",
    "",
    "- **Chunks Δ** > 0 means tree-sitter found structural units the regex parser missed (typically in generic impls, cfg-gated items, complex macros).",
    "- **Call edges Δ** > 0 means tree-sitter identified additional function calls, feeding the graph-rank component of retrieval.",
    "- **Parse time Δ** > 0 is expected — WASM tree-sitter is slower than native regex — but ingest time is dominated by embedding generation in practice.",
    "- These deltas translate to roughly proportional improvements in top-k retrieval precision on Rust-heavy repos, plus unlocked impact-analysis queries that require call edges.",
    ""
  ].join("\n");
}

(async function main() {
  const opts = parseArgs();
  const corpus = loadCorpus(opts.corpus);
  const totalBytes = corpus.reduce((acc, f) => acc + f.bytes, 0);

  console.log(`[bench] corpus: ${opts.corpus ?? "synthetic"} — ${corpus.length} files, ${totalBytes} bytes`);
  console.log(`[bench] runs per parser: ${opts.runs}`);

  console.log("[bench] running regex parser...");
  const regex = timeParser(parseRegex, corpus, opts.runs);
  console.log(`[bench]   median ${regex.medianMs.toFixed(2)}ms, ${regex.chunks.length} chunks`);

  console.log("[bench] running tree-sitter parser...");
  const ts = timeParser(parseTreeSitter, corpus, opts.runs);
  console.log(`[bench]   median ${ts.medianMs.toFixed(2)}ms, ${ts.chunks.length} chunks`);

  const report = renderReport({
    corpusInfo: {
      source: opts.corpus ?? "synthetic",
      fileCount: corpus.length,
      totalBytes,
      runs: opts.runs
    },
    regex,
    ts
  });

  console.log("\n" + report);

  if (opts.output) {
    writeFileSync(opts.output, report);
    console.log(`[bench] report written to ${opts.output}`);
  }
})();
