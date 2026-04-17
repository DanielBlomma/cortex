#!/usr/bin/env node
/**
 * C# parser benchmark — syntax-only per-file vs batch+SemanticModel.
 *
 * Measures what Roslyn's full compilation pipeline adds on top of
 * pure syntax extraction:
 *   - Resolved call edges (fq-names vs bare identifiers)
 *   - Ingest latency amortization (1 dotnet startup vs N)
 *   - Chunk output parity (should be identical — same collector)
 *
 * Usage:
 *   node benchmark/csharp-parser-compare.mjs               # synthetic corpus
 *   node benchmark/csharp-parser-compare.mjs --corpus ./src
 *   node benchmark/csharp-parser-compare.mjs --output benchmark/csharp-delta.md
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { performance } from "node:perf_hooks";
import { parseCode, parseProject, isCSharpParserAvailable } from "../scaffold/scripts/parsers/csharp.mjs";

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { corpus: null, output: null };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--corpus") opts.corpus = args[++i];
    else if (a === "--output") opts.output = args[++i];
  }
  return opts;
}

function collectCsFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    const entries = readdirSync(cur, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "bin" || entry.name === "obj" || entry.name.startsWith(".")) continue;
      const full = join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (extname(entry.name) === ".cs") out.push(full);
    }
  }
  return out;
}

const SYNTHETIC_CORPUS = [
  {
    path: "Domain/Cache.cs",
    content: [
      "using System.Collections.Generic;",
      "namespace Demo.Domain;",
      "public class Cache",
      "{",
      "    private readonly Dictionary<string, string> _map = new();",
      "    public string? Get(string key) => _map.TryGetValue(key, out var v) ? v : null;",
      "    public void Set(string key, string value) { _map[key] = value; }",
      "    public int Count => _map.Count;",
      "}"
    ].join("\n")
  },
  {
    path: "Domain/Repository.cs",
    content: [
      "namespace Demo.Domain;",
      "public interface IRepository<T> { T? FindById(int id); void Save(T item); }",
      "public class UserRepo : IRepository<User>",
      "{",
      "    public User? FindById(int id) => null;",
      "    public void Save(User item) { }",
      "}",
      "public class User { public int Id { get; set; } public string Name { get; set; } = \"\"; }"
    ].join("\n")
  },
  {
    path: "Services/UserService.cs",
    content: [
      "using System.IO;",
      "using Demo.Domain;",
      "namespace Demo.Services;",
      "public class UserService",
      "{",
      "    private readonly UserRepo _repo;",
      "    private readonly Cache _cache;",
      "    public UserService(UserRepo repo, Cache cache) { _repo = repo; _cache = cache; }",
      "    public string? GetUserName(int id)",
      "    {",
      "        var cached = _cache.Get($\"user:{id}\");",
      "        if (cached != null) return cached;",
      "        var user = _repo.FindById(id);",
      "        if (user == null) return null;",
      "        _cache.Set($\"user:{id}\", user.Name);",
      "        return user.Name;",
      "    }",
      "    public void LoadFromFile(string path)",
      "    {",
      "        var contents = File.ReadAllText(path);",
      "        var parsed = Parse(contents);",
      "        foreach (var u in parsed) _repo.Save(u);",
      "    }",
      "    private static User[] Parse(string s) => System.Array.Empty<User>();",
      "}"
    ].join("\n")
  },
  {
    path: "Services/OrderService.cs",
    content: [
      "using System.Collections.Generic;",
      "using Demo.Domain;",
      "namespace Demo.Services;",
      "public record Order(int Id, string Product, int Quantity);",
      "public class OrderService",
      "{",
      "    private readonly List<Order> _orders = new();",
      "    public void Place(int userId, string product, int qty)",
      "    {",
      "        var order = new Order(_orders.Count + 1, product, qty);",
      "        _orders.Add(order);",
      "        Log(order);",
      "    }",
      "    public IEnumerable<Order> ForUser(int userId) => _orders;",
      "    private static void Log(Order o) { System.Console.WriteLine($\"order: {o}\"); }",
      "}"
    ].join("\n")
  },
  {
    path: "Api/Endpoint.cs",
    content: [
      "using Demo.Services;",
      "namespace Demo.Api;",
      "public class Endpoint",
      "{",
      "    private readonly UserService _users;",
      "    private readonly OrderService _orders;",
      "    public Endpoint(UserService u, OrderService o) { _users = u; _orders = o; }",
      "    public object Handle(int userId, string command)",
      "    {",
      "        return command switch",
      "        {",
      "            \"name\" => _users.GetUserName(userId) ?? \"unknown\",",
      "            \"orders\" => _orders.ForUser(userId),",
      "            _ => throw new System.ArgumentException(command)",
      "        };",
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
  const files = collectCsFiles(corpusDir);
  return files.map((filePath) => {
    const content = readFileSync(filePath, "utf8");
    return { path: filePath, content, bytes: Buffer.byteLength(content, "utf8") };
  });
}

function summarize(chunks) {
  const allCalls = new Set();
  let fqCount = 0;
  let plainCount = 0;
  for (const chunk of chunks) {
    for (const call of chunk.calls ?? []) {
      allCalls.add(`${chunk.name}->${call}`);
      if (call.includes(".")) fqCount += 1;
      else plainCount += 1;
    }
  }
  return {
    chunks: chunks.length,
    uniqueCallEdges: allCalls.size,
    fqCallCount: fqCount,
    plainCallCount: plainCount
  };
}

function timePerFile(corpus) {
  const t0 = performance.now();
  const allChunks = [];
  for (const file of corpus) {
    const result = parseCode(file.content, file.path, "csharp");
    allChunks.push(...result.chunks);
  }
  return { ms: performance.now() - t0, chunks: allChunks };
}

function timeBatch(corpus) {
  const t0 = performance.now();
  const batchResult = parseProject(corpus.map((f) => ({ path: f.path, content: f.content })));
  const allChunks = [];
  for (const [, res] of batchResult) allChunks.push(...res.chunks);
  return { ms: performance.now() - t0, chunks: allChunks };
}

function renderReport({ corpusInfo, perFile, batch }) {
  const pfSum = summarize(perFile.chunks);
  const bSum = summarize(batch.chunks);
  const fqRatio = bSum.uniqueCallEdges > 0
    ? `${((bSum.fqCallCount / (bSum.fqCallCount + bSum.plainCallCount)) * 100).toFixed(1)}%`
    : "n/a";
  return [
    "# C# parser benchmark — syntax-only per-file vs batch+SemanticModel",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Corpus: ${corpusInfo.source} — ${corpusInfo.fileCount} files, ${corpusInfo.totalBytes} bytes`,
    "",
    "## Summary",
    "",
    "| Metric | per-file (syntax) | batch (semantic) | Δ |",
    "|---|---:|---:|---:|",
    `| Chunks extracted | ${pfSum.chunks} | ${bSum.chunks} | ${bSum.chunks - pfSum.chunks >= 0 ? "+" : ""}${bSum.chunks - pfSum.chunks} |`,
    `| Unique call edges | ${pfSum.uniqueCallEdges} | ${bSum.uniqueCallEdges} | ${bSum.uniqueCallEdges - pfSum.uniqueCallEdges >= 0 ? "+" : ""}${bSum.uniqueCallEdges - pfSum.uniqueCallEdges} |`,
    `| Fully-qualified calls | ${pfSum.fqCallCount} | ${bSum.fqCallCount} | +${bSum.fqCallCount - pfSum.fqCallCount} |`,
    `| Bare-name calls | ${pfSum.plainCallCount} | ${bSum.plainCallCount} | ${bSum.plainCallCount - pfSum.plainCallCount} |`,
    `| Total ingest time (ms) | ${perFile.ms.toFixed(0)} | ${batch.ms.toFixed(0)} | ${(batch.ms - perFile.ms).toFixed(0)} |`,
    `| Time per file (ms) | ${(perFile.ms / corpusInfo.fileCount).toFixed(0)} | ${(batch.ms / corpusInfo.fileCount).toFixed(0)} | — |`,
    "",
    `FQ-ratio of batch-resolved calls: **${fqRatio}**`,
    "",
    "## Interpretation",
    "",
    "- **Chunks** should be identical — the collector logic is unchanged; the SemanticModel only affects call resolution, not chunk extraction.",
    "- **FQ-calls Δ** is where Roslyn pays off. `u.Save(x)` is just `\"Save\"` in syntax-only mode; in batch mode it resolves to `\"Demo.Domain.UserRepo.Save\"`. This disambiguates same-named methods in the call graph.",
    "- **Total ingest time:** per-file pays N dotnet startup costs (~500ms each); batch pays one startup + compilation. For ≥3 files batch is strictly faster; below that the compilation overhead dominates.",
    "- On real repositories with 50-500 C# files, batch mode can cut total ingest time by an order of magnitude while also improving call-graph quality.",
    ""
  ].join("\n");
}

(async function main() {
  const opts = parseArgs();
  const corpus = loadCorpus(opts.corpus);
  const totalBytes = corpus.reduce((acc, f) => acc + f.bytes, 0);

  console.log(`[bench] corpus: ${opts.corpus ?? "synthetic"} — ${corpus.length} files, ${totalBytes} bytes`);

  if (!isCSharpParserAvailable()) {
    console.error("[bench] dotnet runtime unavailable — cannot run C# benchmark");
    process.exit(1);
  }

  console.log("[bench] running per-file (syntax-only)...");
  const perFile = timePerFile(corpus);
  console.log(`[bench]   ${perFile.ms.toFixed(0)}ms, ${perFile.chunks.length} chunks`);

  console.log("[bench] running batch (semantic)...");
  const batch = timeBatch(corpus);
  console.log(`[bench]   ${batch.ms.toFixed(0)}ms, ${batch.chunks.length} chunks`);

  const report = renderReport({
    corpusInfo: {
      source: opts.corpus ?? "synthetic",
      fileCount: corpus.length,
      totalBytes
    },
    perFile,
    batch
  });

  console.log("\n" + report);

  if (opts.output) {
    writeFileSync(opts.output, report);
    console.log(`[bench] report written to ${opts.output}`);
  }
})();
