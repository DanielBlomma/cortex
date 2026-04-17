#!/usr/bin/env node
/**
 * Java parser benchmark — file-level baseline vs tree-sitter.
 *
 * Usage:
 *   node benchmark/java-parser-compare.mjs               # synthetic corpus
 *   node benchmark/java-parser-compare.mjs --corpus src
 *   node benchmark/java-parser-compare.mjs --output benchmark/java-delta.md
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { performance } from "node:perf_hooks";
import { parseCode as parseJava } from "../scaffold/scripts/parsers/java-treesitter.mjs";

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

function collectJavaFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    const entries = readdirSync(cur, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "target" || entry.name === "build" || entry.name === "out" || entry.name.startsWith(".")) continue;
      const full = join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (extname(entry.name) === ".java") out.push(full);
    }
  }
  return out;
}

const SYNTHETIC_CORPUS = [
  {
    path: "src/com/app/Cache.java",
    content: [
      "package com.app;",
      "",
      "import java.util.HashMap;",
      "import java.util.Map;",
      "",
      "public class Cache<K, V> {",
      "    private final Map<K, V> store = new HashMap<>();",
      "    private final int capacity;",
      "",
      "    public Cache(int capacity) { this.capacity = capacity; }",
      "",
      "    public V get(K key) { return store.get(key); }",
      "",
      "    public void put(K key, V value) {",
      "        if (store.size() >= capacity) evict();",
      "        store.put(key, value);",
      "    }",
      "",
      "    private void evict() { }",
      "}"
    ].join("\n")
  },
  {
    path: "src/com/app/Handler.java",
    content: [
      "package com.app;",
      "",
      "public interface Handler<T> {",
      "    Response<T> handle(Request<T> request);",
      "    String name();",
      "    default boolean supports(String type) { return name().equals(type); }",
      "}"
    ].join("\n")
  },
  {
    path: "src/com/app/UserService.java",
    content: [
      "package com.app;",
      "",
      "import java.util.Optional;",
      "import java.util.logging.Logger;",
      "",
      "public class UserService implements Handler<User> {",
      "    private static final Logger LOG = Logger.getLogger(UserService.class.getName());",
      "    private final Cache<Long, User> cache;",
      "    private final UserRepository repo;",
      "",
      "    public UserService(Cache<Long, User> cache, UserRepository repo) {",
      "        this.cache = cache;",
      "        this.repo = repo;",
      "    }",
      "",
      "    @Override",
      "    public Response<User> handle(Request<User> request) {",
      "        LOG.info(\"handling user request\");",
      "        Optional<User> user = findOrLoad(request.id());",
      "        return user.map(Response::ok).orElse(Response.notFound());",
      "    }",
      "",
      "    @Override",
      "    public String name() { return \"user\"; }",
      "",
      "    private Optional<User> findOrLoad(long id) {",
      "        User cached = cache.get(id);",
      "        if (cached != null) return Optional.of(cached);",
      "        return repo.findById(id).map(u -> { cache.put(id, u); return u; });",
      "    }",
      "}"
    ].join("\n")
  },
  {
    path: "src/com/app/model/User.java",
    content: [
      "package com.app.model;",
      "",
      "public record User(long id, String name, String email) {",
      "    public User {",
      "        if (name == null) throw new IllegalArgumentException(\"name\");",
      "    }",
      "",
      "    public String displayName() {",
      "        return name + \" <\" + email + \">\";",
      "    }",
      "}"
    ].join("\n")
  },
  {
    path: "src/com/app/model/Status.java",
    content: [
      "package com.app.model;",
      "",
      "public enum Status {",
      "    ACTIVE,",
      "    INACTIVE,",
      "    SUSPENDED;",
      "",
      "    public boolean isActive() { return this == ACTIVE; }",
      "}"
    ].join("\n")
  },
  {
    path: "src/com/app/api/Endpoint.java",
    content: [
      "package com.app.api;",
      "",
      "import com.app.UserService;",
      "import com.app.model.User;",
      "",
      "public class Endpoint {",
      "    private final UserService service;",
      "",
      "    public Endpoint(UserService service) { this.service = service; }",
      "",
      "    public Response<User> user(long id) {",
      "        return service.handle(new Request<>(id));",
      "    }",
      "",
      "    public static class ErrorResponse {",
      "        public final String message;",
      "        public ErrorResponse(String message) { this.message = message; }",
      "    }",
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
  const files = collectJavaFiles(corpusDir);
  return files.map((filePath) => {
    const content = readFileSync(filePath, "utf8");
    return { path: filePath, content, bytes: Buffer.byteLength(content, "utf8") };
  });
}

function baselineFileChunks(corpus) {
  return corpus.map((file) => ({
    name: file.path,
    kind: "file",
    language: "java",
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
      const result = parseJava(file.content, file.path, "java");
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
    const a = Object.hasOwn(base, k) ? base[k] : 0;
    const b = Object.hasOwn(ts, k) ? ts[k] : 0;
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
    "# Java parser benchmark — file-level baseline vs tree-sitter",
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
    "- **Chunks** go from file-blobs to fine-grained classes, interfaces, enums, records, methods, and constructors — each addressable individually by retrieval.",
    "- **Call edges** 0 → N unlock find_callers and impact_analysis for Java. Method calls include selector chains (System.out.println, obj.method()).",
    "- **Imports** cover single imports, wildcard (`java.util.*`), and static imports (`java.lang.Math.max`).",
    "- Methods and constructors are qualified by enclosing type path: `UserService.handle`, `Endpoint.ErrorResponse.ctor`.",
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
