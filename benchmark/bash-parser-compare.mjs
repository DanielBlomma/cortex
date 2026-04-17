#!/usr/bin/env node
/**
 * Bash parser benchmark — file-level baseline vs tree-sitter.
 *
 * Usage:
 *   node benchmark/bash-parser-compare.mjs               # synthetic corpus
 *   node benchmark/bash-parser-compare.mjs --corpus ./scripts
 *   node benchmark/bash-parser-compare.mjs --output benchmark/bash-delta.md
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { performance } from "node:perf_hooks";
import { parseCode as parseBash } from "../scaffold/scripts/parsers/bash-treesitter.mjs";

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

function collectBashFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    const entries = readdirSync(cur, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if ([".sh", ".bash", ".zsh"].includes(extname(entry.name))) out.push(full);
    }
  }
  return out;
}

const SYNTHETIC_CORPUS = [
  {
    path: "scripts/deploy.sh",
    content: [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "",
      "source ./lib/common.sh",
      ". ./lib/secrets.sh",
      "",
      "build_artifact() {",
      "  local target=\"$1\"",
      "  echo \"building $target\"",
      "  run_compiler \"$target\"",
      "  compress_output \"$target\"",
      "}",
      "",
      "deploy_to() {",
      "  local env=\"$1\"",
      "  local artifact=\"$2\"",
      "  check_environment \"$env\"",
      "  upload \"$artifact\" \"$env\"",
      "  notify_deployment \"$env\"",
      "}",
      "",
      "main() {",
      "  local target=\"${1:-production}\"",
      "  build_artifact \"$target\"",
      "  deploy_to \"$target\" \"./dist/app.tar.gz\"",
      "  echo \"done\"",
      "}",
      "",
      "main \"$@\""
    ].join("\n")
  },
  {
    path: "scripts/lib/common.sh",
    content: [
      "# shared helpers",
      "",
      "run_compiler() {",
      "  local target=\"$1\"",
      "  gcc -O2 -o \"./dist/$target\" \"./src/$target.c\"",
      "}",
      "",
      "compress_output() {",
      "  local target=\"$1\"",
      "  tar czf \"./dist/$target.tar.gz\" -C ./dist \"$target\"",
      "}",
      "",
      "check_environment() {",
      "  local env=\"$1\"",
      "  if [ -z \"$env\" ]; then",
      "    echo \"error: no environment\"",
      "    exit 1",
      "  fi",
      "}",
      "",
      "_log_internal() {",
      "  echo \"[$(date)] $*\" >> /tmp/deploy.log",
      "}"
    ].join("\n")
  },
  {
    path: "scripts/lib/secrets.sh",
    content: [
      "# secret-fetching helpers",
      "",
      "fetch_secret() {",
      "  local name=\"$1\"",
      "  aws secretsmanager get-secret-value --secret-id \"$name\" --query SecretString --output text",
      "}",
      "",
      "upload() {",
      "  local artifact=\"$1\"",
      "  local env=\"$2\"",
      "  local token",
      "  token=$(fetch_secret \"deploy/$env\")",
      "  curl -X POST -H \"Auth: $token\" --data-binary \"@$artifact\" \"https://deploy.example.com/$env\"",
      "}",
      "",
      "notify_deployment() {",
      "  local env=\"$1\"",
      "  curl -X POST \"https://slack.example.com/hooks/deploy\" --data \"env=$env\"",
      "}"
    ].join("\n")
  },
  {
    path: "scripts/ci.sh",
    content: [
      "#!/usr/bin/env bash",
      "",
      "source ./lib/common.sh",
      "",
      "run_tests() {",
      "  pushd ./tests > /dev/null",
      "  bash ./run_all.sh",
      "  local exit_code=$?",
      "  popd > /dev/null",
      "  return $exit_code",
      "}",
      "",
      "lint_code() {",
      "  find ./src -name '*.sh' -exec shellcheck {} +",
      "}",
      "",
      "ci_main() {",
      "  lint_code",
      "  run_tests",
      "}",
      "",
      "ci_main"
    ].join("\n")
  },
  {
    path: "scripts/util/strings.sh",
    content: [
      "# string utilities",
      "",
      "trim_whitespace() {",
      "  local s=\"$1\"",
      "  s=\"${s#\"${s%%[![:space:]]*}\"}\"",
      "  s=\"${s%\"${s##*[![:space:]]}\"}\"",
      "  echo \"$s\"",
      "}",
      "",
      "to_lower() {",
      "  echo \"$1\" | tr '[:upper:]' '[:lower:]'",
      "}",
      "",
      "to_upper() {",
      "  echo \"$1\" | tr '[:lower:]' '[:upper:]'",
      "}",
      "",
      "_is_empty() {",
      "  [ -z \"${1:-}\" ]",
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
  const files = collectBashFiles(corpusDir);
  return files.map((filePath) => {
    const content = readFileSync(filePath, "utf8");
    return { path: filePath, content, bytes: Buffer.byteLength(content, "utf8") };
  });
}

function baselineFileChunks(corpus) {
  return corpus.map((file) => ({
    name: file.path,
    kind: "file",
    language: "bash",
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
      const result = parseBash(file.content, file.path, "bash");
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
    "# Bash parser benchmark — file-level baseline vs tree-sitter",
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
    "- **Chunks** go from whole-file blobs to individual functions. Each function becomes addressable in retrieval.",
    "- **Call edges** reflect user-defined function-to-function invocations; shell builtins (echo, cd, export) and common system commands (grep, curl, tar) are filtered so the graph shows script-internal wiring.",
    "- **Imports** capture top-level `source` and `.` directives with static paths. Dynamic paths (e.g. `. \"$(dirname \"$0\")/lib.sh\"`) and lazy requires inside function bodies are intentionally skipped — they can't be statically resolved.",
    "- **Covered extensions:** `.sh`, `.bash`, `.zsh` — zsh shares enough syntax with bash for the grammar to extract function definitions correctly.",
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
