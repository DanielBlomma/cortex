#!/usr/bin/env node
/**
 * Go parser benchmark — file-level baseline vs tree-sitter.
 *
 * Baseline is how Cortex handled .go files before this rollout
 * (whole-file indexing, no call-graph, no imports-as-edges).
 *
 * Usage:
 *   node benchmark/go-parser-compare.mjs               # synthetic corpus
 *   node benchmark/go-parser-compare.mjs --corpus ./path/to/go/src
 *   node benchmark/go-parser-compare.mjs --runs 5
 *   node benchmark/go-parser-compare.mjs --output benchmark/go-delta.md
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { performance } from "node:perf_hooks";
import { parseCode as parseGo } from "../scripts/parsers/go-treesitter.mjs";

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

function collectGoFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    const entries = readdirSync(cur, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "vendor" || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (extname(entry.name) === ".go" && !entry.name.endsWith("_test.go")) out.push(full);
    }
  }
  return out;
}

const SYNTHETIC_CORPUS = [
  {
    path: "pkg/cache/cache.go",
    content: [
      "package cache",
      "",
      "import (",
      "    \"sync\"",
      "    \"time\"",
      ")",
      "",
      "type Entry struct {",
      "    Value     string",
      "    ExpiresAt time.Time",
      "}",
      "",
      "type Cache struct {",
      "    mu      sync.RWMutex",
      "    entries map[string]Entry",
      "}",
      "",
      "func New() *Cache {",
      "    return &Cache{entries: make(map[string]Entry)}",
      "}",
      "",
      "func (c *Cache) Get(key string) (string, bool) {",
      "    c.mu.RLock()",
      "    defer c.mu.RUnlock()",
      "    entry, ok := c.entries[key]",
      "    if !ok || time.Now().After(entry.ExpiresAt) {",
      "        return \"\", false",
      "    }",
      "    return entry.Value, true",
      "}",
      "",
      "func (c *Cache) Set(key, value string, ttl time.Duration) {",
      "    c.mu.Lock()",
      "    defer c.mu.Unlock()",
      "    c.entries[key] = Entry{Value: value, ExpiresAt: time.Now().Add(ttl)}",
      "}"
    ].join("\n")
  },
  {
    path: "pkg/http/server.go",
    content: [
      "package http",
      "",
      "import (",
      "    \"encoding/json\"",
      "    \"net/http\"",
      "    \"log\"",
      ")",
      "",
      "type Server struct {",
      "    addr    string",
      "    handler http.Handler",
      "}",
      "",
      "func NewServer(addr string, handler http.Handler) *Server {",
      "    return &Server{addr: addr, handler: handler}",
      "}",
      "",
      "func (s *Server) Start() error {",
      "    log.Printf(\"starting server at %s\", s.addr)",
      "    return http.ListenAndServe(s.addr, s.handler)",
      "}",
      "",
      "func writeJSON(w http.ResponseWriter, status int, body interface{}) error {",
      "    w.Header().Set(\"Content-Type\", \"application/json\")",
      "    w.WriteHeader(status)",
      "    return json.NewEncoder(w).Encode(body)",
      "}"
    ].join("\n")
  },
  {
    path: "pkg/types/types.go",
    content: [
      "package types",
      "",
      "type UserID int64",
      "type StringMap = map[string]string",
      "",
      "type Handler interface {",
      "    Handle(req Request) Response",
      "    Name() string",
      "}",
      "",
      "type Request struct {",
      "    Method string",
      "    Path   string",
      "    Body   []byte",
      "}",
      "",
      "type Response struct {",
      "    Status int",
      "    Body   []byte",
      "}"
    ].join("\n")
  },
  {
    path: "pkg/generics/slice.go",
    content: [
      "package generics",
      "",
      "func Map[T, U any](items []T, fn func(T) U) []U {",
      "    result := make([]U, 0, len(items))",
      "    for _, item := range items {",
      "        result = append(result, fn(item))",
      "    }",
      "    return result",
      "}",
      "",
      "func Filter[T any](items []T, pred func(T) bool) []T {",
      "    result := make([]T, 0)",
      "    for _, item := range items {",
      "        if pred(item) {",
      "            result = append(result, item)",
      "        }",
      "    }",
      "    return result",
      "}",
      "",
      "func Reduce[T, U any](items []T, initial U, fn func(U, T) U) U {",
      "    acc := initial",
      "    for _, item := range items {",
      "        acc = fn(acc, item)",
      "    }",
      "    return acc",
      "}"
    ].join("\n")
  },
  {
    path: "cmd/app/main.go",
    content: [
      "package main",
      "",
      "import (",
      "    \"fmt\"",
      "    \"os\"",
      "    \"example.com/pkg/cache\"",
      "    \"example.com/pkg/http\"",
      ")",
      "",
      "type App struct {",
      "    cache  *cache.Cache",
      "    server *http.Server",
      "}",
      "",
      "func NewApp() *App {",
      "    c := cache.New()",
      "    return &App{cache: c}",
      "}",
      "",
      "func (a *App) Run() error {",
      "    a.cache.Set(\"greeting\", \"hello\", 0)",
      "    fmt.Println(\"app starting\")",
      "    return a.server.Start()",
      "}",
      "",
      "func main() {",
      "    app := NewApp()",
      "    if err := app.Run(); err != nil {",
      "        fmt.Fprintln(os.Stderr, err)",
      "        os.Exit(1)",
      "    }",
      "}"
    ].join("\n")
  },
  {
    path: "pkg/util/strings.go",
    content: [
      "package util",
      "",
      "import \"strings\"",
      "",
      "func Normalize(s string) string {",
      "    s = strings.TrimSpace(s)",
      "    s = strings.ToLower(s)",
      "    return s",
      "}",
      "",
      "func isVowel(r rune) bool {",
      "    switch r {",
      "    case 'a', 'e', 'i', 'o', 'u':",
      "        return true",
      "    }",
      "    return false",
      "}",
      "",
      "func CountVowels(s string) int {",
      "    count := 0",
      "    for _, r := range s {",
      "        if isVowel(r) {",
      "            count++",
      "        }",
      "    }",
      "    return count",
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
  const files = collectGoFiles(corpusDir);
  return files.map((filePath) => {
    const content = readFileSync(filePath, "utf8");
    return { path: filePath, content, bytes: Buffer.byteLength(content, "utf8") };
  });
}

function baselineFileChunks(corpus) {
  return corpus.map((file) => ({
    name: file.path,
    kind: "file",
    language: "go",
    calls: [],
    imports: []
  }));
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

function timeTreeSitter(corpus, runs) {
  const timings = [];
  let lastChunks = [];
  for (let run = 0; run < runs; run += 1) {
    const t0 = performance.now();
    const allChunks = [];
    for (const file of corpus) {
      const result = parseGo(file.content, file.path, "go");
      allChunks.push(...result.chunks);
    }
    timings.push(performance.now() - t0);
    if (run === runs - 1) lastChunks = allChunks;
  }
  timings.sort((a, b) => a - b);
  return {
    medianMs: timings[Math.floor(timings.length / 2)],
    p95Ms: timings[Math.min(timings.length - 1, Math.floor(timings.length * 0.95))],
    chunks: lastChunks
  };
}

function formatKindCounts(base, ts) {
  const kinds = new Set([...Object.keys(base), ...Object.keys(ts)]);
  return [...kinds].sort().map((k) => {
    const a = base[k] ?? 0;
    const b = ts[k] ?? 0;
    const delta = b - a;
    const arrow = delta > 0 ? "+" : "";
    return `| ${k} | ${a} | ${b} | ${arrow}${delta} |`;
  }).join("\n");
}

function renderReport({ corpusInfo, baseline, ts }) {
  const bSum = summarize(baseline);
  const tSum = summarize(ts.chunks);
  const ratio = bSum.chunks > 0 ? (tSum.chunks / bSum.chunks).toFixed(1) : "∞";

  return [
    "# Go parser benchmark — file-level baseline vs tree-sitter",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Corpus: ${corpusInfo.source} — ${corpusInfo.fileCount} files, ${corpusInfo.totalBytes} bytes`,
    `Runs: ${corpusInfo.runs}`,
    "",
    "## Summary",
    "",
    "| Metric | baseline (file-level) | tree-sitter | Δ |",
    "|---|---:|---:|---:|",
    `| Chunks extracted | ${bSum.chunks} | ${tSum.chunks} | ${tSum.chunks - bSum.chunks >= 0 ? "+" : ""}${tSum.chunks - bSum.chunks} (${ratio}×) |`,
    `| Unique call edges | ${bSum.uniqueCallEdges} | ${tSum.uniqueCallEdges} | +${tSum.uniqueCallEdges} |`,
    `| Unique imports | ${bSum.uniqueImports} | ${tSum.uniqueImports} | +${tSum.uniqueImports} |`,
    `| Median parse time (ms) | n/a | ${ts.medianMs.toFixed(2)} | — |`,
    `| p95 parse time (ms) | n/a | ${ts.p95Ms.toFixed(2)} | — |`,
    "",
    "## Chunks by kind",
    "",
    "| Kind | baseline | tree-sitter | Δ |",
    "|---|---:|---:|---:|",
    formatKindCounts(bSum.kindCounts, tSum.kindCounts),
    "",
    "## Interpretation",
    "",
    "- **Chunk ratio** shows the granularity jump: each Go file was one blob; now it's functions, methods (qualified by receiver type), structs, interfaces, and type aliases.",
    "- **Call edges** 0 → N unlocks find_callers and impact_analysis for Go, previously broken.",
    "- **Imports** go from 0 to structured edges — including grouped import blocks and path aliases, unquoted for clean graph edges.",
    "- Methods are unified by receiver type regardless of pointer-vs-value: `func (s S) F()` and `func (s *S) F()` both become `S.F`, so the call graph doesn't double-count.",
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
  console.log(`[bench] baseline: ${baseline.length} chunks, 0 edges`);

  console.log("[bench] running tree-sitter parser...");
  const ts = timeTreeSitter(corpus, opts.runs);
  console.log(`[bench]   median ${ts.medianMs.toFixed(2)}ms, ${ts.chunks.length} chunks`);

  const report = renderReport({
    corpusInfo: { source: opts.corpus ?? "synthetic", fileCount: corpus.length, totalBytes, runs: opts.runs },
    baseline,
    ts
  });

  console.log("\n" + report);

  if (opts.output) {
    writeFileSync(opts.output, report);
    console.log(`[bench] report written to ${opts.output}`);
  }
})();
