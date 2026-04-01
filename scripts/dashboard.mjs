#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const CONTEXT_DIR = path.join(REPO_ROOT, ".context");
const CACHE_DIR = path.join(CONTEXT_DIR, "cache");
const CONFIG_PATH = path.join(CONTEXT_DIR, "config.yaml");

// Same extensions as ingest.mjs
const SUPPORTED_TEXT_EXTENSIONS = new Set([
  ".md", ".mdx", ".txt", ".adoc", ".rst",
  ".yaml", ".yml", ".json", ".toml", ".csv",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".java", ".cs", ".rb", ".rs", ".php", ".swift", ".kt",
  ".sql", ".sh", ".bash", ".zsh", ".ps1",
  ".c", ".h", ".cpp", ".hpp", ".cc", ".hh"
]);

// Same skip dirs as ingest.mjs
const SKIP_DIRECTORIES = new Set([
  ".git", ".idea", ".vscode", "node_modules",
  "dist", "build", "coverage", ".next", ".cache", ".context"
]);

const MAX_FILE_BYTES = 1024 * 1024;

// ── ANSI helpers ──────────────────────────────────────────────
const ESC = "\x1b";
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const CLEAR = `${ESC}[2J${ESC}[H`;

const C = {
  gray: `${ESC}[38;5;245m`,
  dimGray: `${ESC}[38;5;239m`,
  white: `${ESC}[37m`,
  green: `${ESC}[38;5;34m`,
  blue: `${ESC}[38;5;33m`,
  orange: `${ESC}[38;5;208m`,
  cyan: `${ESC}[38;5;37m`,
  red: `${ESC}[38;5;196m`,
  yellow: `${ESC}[38;5;220m`,
  purple: `${ESC}[38;5;135m`,
};

const col = (text, color) => `${color}${text}${RESET}`;
const bold = (text) => `${BOLD}${text}${RESET}`;
const dim = (text) => `${DIM}${text}${RESET}`;

// ── Data: source_paths parsing (same as ingest.mjs) ──────────
function parseSourcePaths(configText) {
  const sourcePaths = [];
  const lines = configText.split(/\r?\n/);
  let inSourcePaths = false;
  for (const line of lines) {
    if (!inSourcePaths && /^source_paths:\s*$/.test(line.trim())) {
      inSourcePaths = true;
      continue;
    }
    if (!inSourcePaths) continue;
    const m = line.match(/^\s*-\s*(.+?)\s*$/);
    if (m) {
      sourcePaths.push(m[1].replace(/^['"]|['"]$/g, ""));
      continue;
    }
    if (line.trim() !== "" && !/^\s/.test(line)) break;
  }
  return sourcePaths;
}

// ── Data: filesystem walk (same as ingest.mjs) ───────────────
function walkDirectory(dirPath, files) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
    const abs = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkDirectory(abs, files);
    } else if (entry.isFile()) {
      files.push(abs);
    }
  }
}

function toPosixPath(p) {
  return p.split(path.sep).join("/");
}

function hasSourcePrefix(relPath, sourcePaths) {
  return sourcePaths.some((sp) => {
    const s = toPosixPath(sp).replace(/\/+$/, "");
    if (s === "" || s === ".") return true;
    return relPath === s || relPath.startsWith(`${s}/`);
  });
}

// ── Data: baseline scan ──────────────────────────────────────
function scanBaseline() {
  if (!fs.existsSync(CONFIG_PATH)) return { files: 0, lines: 0, chars: 0, tokens: 0 };

  const configText = fs.readFileSync(CONFIG_PATH, "utf8");
  const sourcePaths = parseSourcePaths(configText);
  if (sourcePaths.length === 0) return { files: 0, lines: 0, chars: 0, tokens: 0 };

  const allFiles = [];
  for (const sp of sourcePaths) {
    const abs = path.resolve(REPO_ROOT, sp);
    if (!fs.existsSync(abs)) continue;
    const stat = fs.statSync(abs);
    if (stat.isFile()) {
      allFiles.push(abs);
    } else if (stat.isDirectory()) {
      walkDirectory(abs, allFiles);
    }
  }

  let fileCount = 0;
  let totalLines = 0;
  let totalChars = 0;

  for (const filePath of allFiles) {
    const ext = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_TEXT_EXTENSIONS.has(ext)) continue;
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_FILE_BYTES) continue;
      const content = fs.readFileSync(filePath, "utf8");
      fileCount++;
      totalLines += content.split("\n").length;
      totalChars += content.length;
    } catch {
      // skip unreadable
    }
  }

  return {
    files: fileCount,
    lines: totalLines,
    chars: totalChars,
    tokens: Math.round(totalChars / 4),
  };
}

// ── Data: read JSONL safely ──────────────────────────────────
function readJsonlSafe(filePath) {
  try {
    const text = fs.readFileSync(filePath, "utf8").trim();
    if (!text) return [];
    return text.split("\n").map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

// ── Data: read JSON safely ───────────────────────────────────
function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

// ── Data: read manifests ─────────────────────────────────────
function readManifests() {
  return {
    ingest: readJsonSafe(path.join(CACHE_DIR, "manifest.json")),
    graph: readJsonSafe(path.join(CACHE_DIR, "graph-manifest.json")),
    embed: readJsonSafe(path.join(CONTEXT_DIR, "embeddings", "manifest.json")),
  };
}

// ── Data: freshness (same logic as status.sh) ────────────────
function computeFreshness(manifest) {
  const sourcePaths = Array.isArray(manifest?.source_paths) ? manifest.source_paths : [];
  const indexedFiles = Number(manifest?.counts?.files ?? 0);

  let relevantChanged = 0;
  let relevantDeleted = 0;

  try {
    const output = execSync("git status --porcelain", {
      cwd: REPO_ROOT, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8", timeout: 3000,
    });

    for (const rawLine of output.split(/\r?\n/)) {
      if (!rawLine) continue;
      const status = rawLine.slice(0, 2);
      const payload = rawLine.slice(3).trim();
      if (!payload) continue;

      const paths = payload.includes(" -> ")
        ? payload.split(" -> ")
        : [payload];

      for (const p of paths) {
        const relPath = toPosixPath(p);
        if (relPath.startsWith(".context/")) continue;
        if (!hasSourcePrefix(relPath, sourcePaths)) continue;
        if (status.includes("D")) {
          relevantDeleted++;
        } else {
          relevantChanged++;
        }
      }
    }
  } catch {
    return { percent: -1, pending: 0, changed: 0, deleted: 0 };
  }

  const pending = relevantChanged + relevantDeleted;
  const baseline = Math.max(indexedFiles, pending, 1);
  const freshness = Math.max(0, (baseline - pending) / baseline);

  return {
    percent: Math.round(freshness * 100),
    pending,
    changed: relevantChanged,
    deleted: relevantDeleted,
  };
}

// ── Data: degree analysis ────────────────────────────────────
function computeTopConnected() {
  const degree = new Map();

  const relationFiles = [
    "relations.constrains.jsonl", "relations.implements.jsonl",
    "relations.supersedes.jsonl", "relations.defines.jsonl",
    "relations.calls.jsonl", "relations.imports.jsonl",
  ];

  for (const file of relationFiles) {
    const records = readJsonlSafe(path.join(CACHE_DIR, file));
    for (const r of records) {
      if (r.from) degree.set(r.from, (degree.get(r.from) || 0) + 1);
      if (r.to) degree.set(r.to, (degree.get(r.to) || 0) + 1);
    }
  }

  return [...degree.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, deg]) => {
      let label = id.includes("/") ? path.basename(id.replace(/^file:/, "")) : id.replace(/^(file|chunk|rule):/, "");
      if (label.length > 18) label = label.slice(0, 17) + "…";
      return { id, label, degree: deg };
    });
}

// ── Data: estimate Cortex search tokens ──────────────────────
function estimateCortexSearchTokens() {
  const entities = readJsonlSafe(path.join(CACHE_DIR, "entities.file.jsonl"));
  if (entities.length === 0) return { searchTokens: 0, avgExcerptTokens: 0 };

  let totalExcerptChars = 0;
  for (const e of entities) {
    totalExcerptChars += (e.excerpt || "").length;
  }

  const avgExcerptChars = totalExcerptChars / entities.length;
  const topK = 5;
  const searchTokens = Math.round((topK * avgExcerptChars) / 4 + 200);

  return { searchTokens, avgExcerptTokens: Math.round(avgExcerptChars / 4) };
}

// ── Data: gather all ─────────────────────────────────────────
function gatherData(baselineCache) {
  const baseline = baselineCache || scanBaseline();
  const manifests = readManifests();
  const gc = manifests.graph?.counts || {};
  const ic = manifests.ingest?.counts || {};
  const ec = manifests.embed?.counts || {};

  const totalEntities = (gc.files || 0) + (gc.rules || 0) + (gc.adrs || 0) + (gc.chunks || 0);
  const relCalls = gc.calls || ic.relations_calls || 0;
  const relDefines = gc.defines || ic.relations_defines || 0;
  const relConstrains = gc.constrains || ic.relations_constrains || 0;
  const relImplements = gc.implements || ic.relations_implements || 0;
  const relImports = gc.imports || ic.relations_imports || 0;
  const relSupersedes = gc.supersedes || ic.relations_supersedes || 0;
  const totalRelations = relCalls + relDefines + relConstrains + relImplements + relImports + relSupersedes;

  const tokenEstimate = estimateCortexSearchTokens();
  const rawTokens = baseline.tokens;
  const cortexTokens = tokenEstimate.searchTokens;
  const ratio = cortexTokens > 0 ? Math.round(rawTokens / cortexTokens) : 0;
  const reduction = rawTokens > 0 ? Math.round((1 - cortexTokens / rawTokens) * 100) : 0;

  const embedCount = ec.embedded ?? ec.output ?? ec.entities ?? 0;
  const embedModel = manifests.embed?.model || null;
  const embedDim = manifests.embed?.dimensions || 0;

  const freshness = computeFreshness(manifests.ingest);
  const topConnected = computeTopConnected();

  const timeAgo = (isoStr) => {
    if (!isoStr) return "never";
    const diff = Date.now() - new Date(isoStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return {
    baseline,
    cortex: {
      files: gc.files || ic.files || 0,
      chunks: gc.chunks || ic.chunks || 0,
      rules: gc.rules || ic.rules || 0,
      adrs: gc.adrs || ic.adrs || 0,
      totalEntities,
      relations: { calls: relCalls, defines: relDefines, constrains: relConstrains, implements: relImplements, imports: relImports, supersedes: relSupersedes, total: totalRelations },
    },
    tokens: { raw: rawTokens, cortexSearch: cortexTokens, ratio, reduction },
    embeddings: embedModel ? { model: embedModel, count: embedCount, dimensions: embedDim } : null,
    freshness,
    topConnected,
    timestamps: {
      lastIngest: timeAgo(manifests.ingest?.generated_at),
      lastGraph: timeAgo(manifests.graph?.generated_at),
      lastEmbed: timeAgo(manifests.embed?.generated_at),
    },
  };
}

// ── Render helpers ────────────────────────────────────────────
function formatNum(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function bar(value, max, width = 16) {
  if (max <= 0) return col("░".repeat(width), C.dimGray);
  const ratio = Math.min(1, value / max);
  const filled = Math.round(ratio * width);
  return col("█".repeat(filled), C.cyan) + col("░".repeat(width - filled), C.dimGray);
}

function freshnessBar(percent, width = 10) {
  const color = percent >= 70 ? C.green : percent >= 40 ? C.yellow : C.red;
  const filled = Math.round((percent / 100) * width);
  return col("█".repeat(filled), color) + col("░".repeat(width - filled), C.dimGray);
}

function padR(str, len) {
  const visible = str.replace(/\x1b\[[0-9;]*m/g, "");
  return str + " ".repeat(Math.max(0, len - visible.length));
}

function padL(str, len) {
  const visible = str.replace(/\x1b\[[0-9;]*m/g, "");
  return " ".repeat(Math.max(0, len - visible.length)) + str;
}

function borderLine(left, fill, right, width) {
  return col(`${left}${fill.repeat(Math.max(0, width - 2))}${right}`, C.gray);
}

function sideBorder(content, width) {
  const visible = content.replace(/\x1b\[[0-9;]*m/g, "");
  const pad = Math.max(0, width - 4 - visible.length);
  return col("│", C.gray) + "  " + content + " ".repeat(pad) + " " + col("│", C.gray);
}

function emptyLine(width) {
  return col("│", C.gray) + " ".repeat(width - 2) + col("│", C.gray);
}

// ── Render sections ──────────────────────────────────────────
function render(data, isTTY) {
  const termWidth = process.stdout.columns || 80;
  const w = Math.min(Math.max(termWidth, 50), 72);
  const lines = [];

  // Header
  const clock = new Date().toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  const title = "─ cortex dashboard ";
  const clockPart = ` ${clock} ─`;
  const fillLen = w - 2 - title.length - clockPart.length;
  lines.push(col(`┌${title}${"─".repeat(Math.max(0, fillLen))}${clockPart}┐`, C.gray));
  lines.push(emptyLine(w));

  // ── WITHOUT vs WITH CORTEX ──
  lines.push(sideBorder(
    `${dim("WITHOUT CORTEX")}                ${bold(col("WITH CORTEX", C.green))}`, w));
  lines.push(sideBorder(
    `${dim("───────────────")}                ${col("────────────────", C.green)}`, w));

  const leftCol = 17;
  const compRows = [
    [dim(padR(`${data.baseline.files} raw files`, leftCol + 14)),
      col(`${data.cortex.files} files`, C.green) + ` + ` + col(`${data.cortex.chunks} chunks`, C.green)],
    [dim(padR(`0 relationships`, leftCol + 14)),
      col(`${data.cortex.relations.total} mapped relations`, C.green)],
    [dim(padR(`0 architectural rules`, leftCol + 14)),
      col(`${data.cortex.rules} enforced rules`, C.green)],
    [dim(padR(`0 trust signals`, leftCol + 14)),
      col(`${data.cortex.totalEntities} trust-scored entities`, C.green)],
    [dim(padR(`0 semantic vectors`, leftCol + 14)),
      data.embeddings ? col(`${data.embeddings.count} embedded vectors`, C.green) : col("no embeddings", C.yellow)],
    [dim(padR(`flat file list`, leftCol + 14)),
      col(`ranked hybrid search`, C.green)],
  ];
  for (const [left, right] of compRows) {
    lines.push(sideBorder(`${left}  ${right}`, w));
  }
  lines.push(emptyLine(w));

  // ── TOKENS ──
  lines.push(sideBorder(bold("TOKENS"), w));
  lines.push(sideBorder(
    `${dim("Raw dump:")}     ${col(`~${formatNum(data.tokens.raw)} tokens`, C.gray)}`, w));
  lines.push(sideBorder(
    `${dim("Cortex search:")} ${col(`~${formatNum(data.tokens.cortexSearch)} tokens`, C.green)} ${dim("(top 5 results)")}`, w));
  if (data.tokens.ratio > 0) {
    lines.push(sideBorder(
      `${dim("Efficiency:")}   ${bold(col(`${data.tokens.ratio}x`, C.green))} ${dim("reduction")}`, w));
    const reductionWidth = Math.min(40, w - 16);
    const filled = Math.round((data.tokens.reduction / 100) * reductionWidth);
    const reductionBar = col("█".repeat(filled), C.green) + col("░".repeat(reductionWidth - filled), C.dimGray);
    lines.push(sideBorder(`${reductionBar}  ${col(`${data.tokens.reduction}% less tokens`, C.green)}`, w));
  }
  lines.push(emptyLine(w));

  // ── CORTEX ADDS ──
  lines.push(sideBorder(bold("CORTEX ADDS"), w));
  const adds = [
    data.cortex.chunks > 0 ? col(`+${data.cortex.chunks} chunks`, C.green) : null,
    data.cortex.relations.total > 0 ? col(`+${data.cortex.relations.total} relations`, C.green) : null,
    data.cortex.rules > 0 ? col(`+${data.cortex.rules} rules`, C.green) : null,
    data.embeddings ? col(`+${data.embeddings.count} embeddings`, C.green) : null,
  ].filter(Boolean);
  if (adds.length > 0) {
    lines.push(sideBorder(adds.join("   "), w));
  }
  const caps = [
    data.embeddings ? "Semantic search" : null,
    data.cortex.relations.total > 0 ? "Graph traversal" : null,
    data.cortex.chunks > 0 ? "Impact analysis" : null,
  ].filter(Boolean);
  if (caps.length > 0) {
    lines.push(sideBorder(dim(caps.join("  •  ")), w));
  }
  lines.push(emptyLine(w));

  // ── RELATIONS ──
  lines.push(sideBorder(bold("RELATIONS"), w));
  const rels = data.cortex.relations;
  const maxRel = Math.max(rels.calls, rels.defines, rels.constrains, rels.implements, rels.imports, rels.supersedes, 1);
  const barW = Math.min(16, w - 30);
  const relRows = [
    ["CALLS", rels.calls, C.cyan],
    ["DEFINES", rels.defines, C.blue],
    ["CONSTRAINS", rels.constrains, C.orange],
    ["IMPLEMENTS", rels.implements, C.green],
    ["IMPORTS", rels.imports, C.purple],
    ["SUPERSEDES", rels.supersedes, C.gray],
  ];
  for (const [label, count, _color] of relRows) {
    const b = bar(count, maxRel, barW);
    lines.push(sideBorder(`${padR(label, 12)} ${b}  ${padL(String(count), 4)}`, w));
  }
  lines.push(emptyLine(w));

  // ── HEALTH ──
  lines.push(sideBorder(bold("HEALTH"), w));
  if (data.freshness.percent >= 0) {
    const fb = freshnessBar(data.freshness.percent);
    lines.push(sideBorder(
      `Freshness ${col("[", C.gray)}${fb}${col("]", C.gray)} ${data.freshness.percent}%  ${dim(`Last sync: ${data.timestamps.lastIngest}`)}`, w));
  } else {
    lines.push(sideBorder(dim("Freshness: unavailable (git not accessible)"), w));
  }
  if (data.embeddings) {
    const check = data.embeddings.count > 0 ? col("✓", C.green) : col("✗", C.red);
    lines.push(sideBorder(
      `Embeddings: ${data.embeddings.count} ${check}       ${dim(`Model: ${data.embeddings.model}`)}`, w));
  } else {
    lines.push(sideBorder(`Embeddings: ${col("not generated", C.yellow)}  ${dim("Run: cortex embed")}`, w));
  }
  lines.push(emptyLine(w));

  // ── TOP CONNECTED ──
  if (data.topConnected.length > 0) {
    lines.push(sideBorder(bold("TOP CONNECTED"), w));
    for (const t of data.topConnected) {
      const degStr = padL(String(t.degree), 4);
      lines.push(sideBorder(`  ${padR(t.label, 20)} ${dim("───")} ${col(degStr, C.cyan)} edges`, w));
    }
    lines.push(emptyLine(w));
  }

  // Footer
  const interval = parseInterval();
  const footerLeft = " q quit  r refresh ";
  const footerRight = ` ${interval}s auto `;
  const footerFill = w - 2 - footerLeft.length - footerRight.length;
  lines.push(col(`└──${footerLeft}${"─".repeat(Math.max(0, footerFill))}${footerRight}─┘`, C.gray));

  return lines.join("\n");
}

// ── CLI arg parsing ──────────────────────────────────────────
function parseInterval() {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--interval");
  if (idx >= 0 && args[idx + 1]) {
    const val = Number(args[idx + 1]);
    if (val > 0) return val;
  }
  return 2;
}

// ── Main ─────────────────────────────────────────────────────
function main() {
  const interval = parseInterval();
  const isTTY = process.stdout.isTTY;

  // Non-TTY: one-shot plain output
  if (!isTTY) {
    const baseline = scanBaseline();
    const data = gatherData(baseline);
    // Strip ANSI for pipe output
    const output = render(data, false).replace(/\x1b\[[0-9;]*m/g, "");
    process.stdout.write(output + "\n");
    process.exit(0);
  }

  // TTY: live TUI
  let baselineCache = scanBaseline();
  let timer = null;

  function cleanup() {
    if (timer) clearInterval(timer);
    process.stdout.write(SHOW_CURSOR + RESET + "\n");
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.exit(0);
  }

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  process.stdout.write(HIDE_CURSOR);

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    process.stdin.on("data", (key) => {
      if (key === "q" || key === "\x03") {
        cleanup();
      } else if (key === "r") {
        baselineCache = scanBaseline();
        renderFrame();
      }
    });
  }

  function renderFrame() {
    const data = gatherData(baselineCache);
    const output = render(data, true);
    process.stdout.write(CLEAR + output);
  }

  renderFrame();
  timer = setInterval(renderFrame, interval * 1000);

  process.stdout.on("resize", () => {
    renderFrame();
  });
}

main();
