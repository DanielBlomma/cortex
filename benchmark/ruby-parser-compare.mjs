#!/usr/bin/env node
/**
 * Ruby parser benchmark — file-level baseline vs tree-sitter.
 *
 * Usage:
 *   node benchmark/ruby-parser-compare.mjs               # synthetic corpus
 *   node benchmark/ruby-parser-compare.mjs --corpus lib
 *   node benchmark/ruby-parser-compare.mjs --output benchmark/ruby-delta.md
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { performance } from "node:perf_hooks";
import { parseCode as parseRuby } from "../scripts/parsers/ruby-treesitter.mjs";

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

function collectRubyFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    const entries = readdirSync(cur, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "vendor" || entry.name === "tmp" || entry.name === ".bundle" || entry.name.startsWith(".")) continue;
      const full = join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (extname(entry.name) === ".rb") out.push(full);
    }
  }
  return out;
}

const SYNTHETIC_CORPUS = [
  {
    path: "lib/cache.rb",
    content: [
      "require 'monitor'",
      "",
      "class Cache",
      "  include MonitorMixin",
      "",
      "  def initialize(capacity = 100)",
      "    super()",
      "    @capacity = capacity",
      "    @store = {}",
      "  end",
      "",
      "  def get(key)",
      "    synchronize { @store[key] }",
      "  end",
      "",
      "  def set(key, value)",
      "    synchronize do",
      "      evict! if @store.size >= @capacity",
      "      @store[key] = value",
      "    end",
      "  end",
      "",
      "  def self.shared",
      "    @@shared ||= new",
      "  end",
      "",
      "  private",
      "",
      "  def evict!",
      "    @store.shift",
      "  end",
      "end"
    ].join("\n")
  },
  {
    path: "lib/user.rb",
    content: [
      "require 'digest'",
      "require_relative './cache'",
      "",
      "module App",
      "  class User",
      "    attr_reader :id, :name, :email",
      "",
      "    def initialize(id:, name:, email:)",
      "      @id = id",
      "      @name = name",
      "      @email = email",
      "    end",
      "",
      "    def display_name",
      "      \"#{@name} <#{@email}>\"",
      "    end",
      "",
      "    def self.find(id)",
      "      Cache.shared.get(\"user:#{id}\")",
      "    end",
      "",
      "    def to_h",
      "      { id: @id, name: @name, email: @email }",
      "    end",
      "  end",
      "end"
    ].join("\n")
  },
  {
    path: "lib/service.rb",
    content: [
      "require_relative './user'",
      "",
      "module App",
      "  class UserService",
      "    def initialize(repo)",
      "      @repo = repo",
      "    end",
      "",
      "    def find(id)",
      "      cached = Cache.shared.get(id)",
      "      return cached if cached",
      "      user = @repo.find_by(id: id)",
      "      Cache.shared.set(id, user) if user",
      "      user",
      "    end",
      "",
      "    def update(id, attrs)",
      "      user = find(id)",
      "      user.update(attrs) if user",
      "    end",
      "  end",
      "end"
    ].join("\n")
  },
  {
    path: "lib/parser.rb",
    content: [
      "require 'json'",
      "",
      "module App",
      "  module Parsers",
      "    class JSONParser",
      "      def parse(content)",
      "        JSON.parse(content)",
      "      rescue JSON::ParserError => e",
      "        raise AppError.new(e.message)",
      "      end",
      "",
      "      def self.default",
      "        @default ||= new",
      "      end",
      "    end",
      "",
      "    class YAMLParser",
      "      def parse(content)",
      "        YAML.safe_load(content)",
      "      end",
      "    end",
      "  end",
      "end"
    ].join("\n")
  },
  {
    path: "lib/app.rb",
    content: [
      "require_relative './cache'",
      "require_relative './user'",
      "require_relative './service'",
      "require_relative './parser'",
      "",
      "module App",
      "  class Application",
      "    def initialize(config)",
      "      @service = UserService.new(config.repo)",
      "    end",
      "",
      "    def run(user_id)",
      "      @service.find(user_id)",
      "    end",
      "",
      "    def self.configure(&block)",
      "      config = Config.new",
      "      block.call(config)",
      "      new(config)",
      "    end",
      "  end",
      "end"
    ].join("\n")
  },
  {
    path: "lib/util.rb",
    content: [
      "module Utils",
      "  def self.slugify(str)",
      "    str.downcase.gsub(/[^a-z0-9]+/, '-')",
      "  end",
      "",
      "  def self.deep_freeze(obj)",
      "    obj.freeze",
      "    obj.each(&method(:deep_freeze)) if obj.respond_to?(:each)",
      "    obj",
      "  end",
      "",
      "  def self._internal_helper",
      "    :used_internally",
      "  end",
      "end"
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
  const files = collectRubyFiles(corpusDir);
  return files.map((filePath) => {
    const content = readFileSync(filePath, "utf8");
    return { path: filePath, content, bytes: Buffer.byteLength(content, "utf8") };
  });
}

function baselineFileChunks(corpus) {
  return corpus.map((file) => ({
    name: file.path,
    kind: "file",
    language: "ruby",
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
      const result = parseRuby(file.content, file.path, "ruby");
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
    "# Ruby parser benchmark — file-level baseline vs tree-sitter",
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
    "- **Chunks** granularize files into classes, modules, instance methods, and class methods — each addressable individually.",
    "- **`Class#method` vs `Class.method`** naming distinguishes instance from class-method calls in the graph (Ruby doc convention). This matters for find-callers accuracy when both forms share a bare name.",
    "- **Imports** extract require / require_relative / autoload paths from top-level calls; lazy requires inside methods are ignored so the file's declared dependencies aren't polluted.",
    "- **Call filter** excludes stdlib/DSL noise (puts, p, attr_*, private, raise, etc.) to keep the graph focused on real function-to-function edges.",
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
