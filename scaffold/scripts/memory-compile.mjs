#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter, parseStringList } from "../mcp/dist/frontmatter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function normalizeForWsl(rawPath) {
  const m = rawPath.match(/^([A-Za-z]):[/\\](.*)/);
  if (!m) return rawPath;
  try { if (!/microsoft|wsl/i.test(fs.readFileSync("/proc/version", "utf8"))) return rawPath; }
  catch { return rawPath; }
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/").replace(/\/+$/, "")}`;
}

const REPO_ROOT = process.env.CORTEX_PROJECT_ROOT
  ? path.resolve(normalizeForWsl(process.env.CORTEX_PROJECT_ROOT))
  : path.resolve(__dirname, "..");
const CONTEXT_DIR = path.join(REPO_ROOT, ".context");
const MEMORY_DIR = path.join(CONTEXT_DIR, "memory");
const RAW_DIR = path.join(MEMORY_DIR, "raw");
const COMPILED_DIR = path.join(MEMORY_DIR, "compiled");

const ALLOWED_TYPES = new Set([
  "decision",
  "gotcha",
  "fix",
  "benchmark",
  "migration-note",
  "note"
]);

const REQUIRED_FIELDS = ["title", "type", "summary"];

// ── ID generation ──────────────────────────────────────────

function normalizeId(filename) {
  const base = path.basename(filename, path.extname(filename)).toLowerCase();
  return `memory:${base.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

// ── Validation ─────────────────────────────────────────────

function validate(rawPath, fields, body) {
  const errors = [];

  for (const field of REQUIRED_FIELDS) {
    if (!fields.get(field)) {
      errors.push(`missing required field: ${field}`);
    }
  }

  const memoryType = fields.get("type") || "";
  if (memoryType && !ALLOWED_TYPES.has(memoryType)) {
    errors.push(`unknown type "${memoryType}" (allowed: ${[...ALLOWED_TYPES].join(", ")})`);
  }

  if (!body) {
    errors.push("empty body — compiled articles need explanatory text");
  }

  return errors;
}

// ── Supersession detection ─────────────────────────────────

function detectSuperseded(compiledArticles) {
  const byTarget = new Map();
  for (const article of compiledArticles) {
    for (const target of article.appliesTo) {
      const list = byTarget.get(target) ?? [];
      list.push(article);
      byTarget.set(target, list);
    }
  }

  const warnings = [];
  for (const [target, articles] of byTarget) {
    if (articles.length > 1) {
      const ids = articles.map((a) => a.id).join(", ");
      warnings.push(`multiple memories for ${target}: ${ids} — consider adding supersedes field`);
    }
  }
  return warnings;
}

// ── Compiled article serialization ─────────────────────────

function serializeCompiled(article) {
  const lines = ["---"];
  lines.push(`id: ${article.id}`);
  lines.push(`title: ${article.title}`);
  lines.push(`type: ${article.type}`);
  lines.push(`summary: ${article.summary}`);

  if (article.evidence) lines.push(`evidence: ${article.evidence}`);
  if (article.appliesTo.length > 0) lines.push(`applies_to: ${article.appliesTo.join(", ")}`);
  if (article.decisionOrGotcha) lines.push(`decision_or_gotcha: ${article.decisionOrGotcha}`);
  if (article.sources.length > 0) lines.push(`sources: ${article.sources.join(", ")}`);
  if (article.supersedes) lines.push(`supersedes: ${article.supersedes}`);
  lines.push(`freshness: ${article.freshness}`);
  lines.push(`updated_at: ${article.updatedAt}`);
  lines.push(`status: ${article.status}`);
  lines.push(`trust_level: ${article.trustLevel}`);
  if (article.sourceOfTruth) lines.push(`source_of_truth: true`);

  lines.push("---");
  lines.push("");
  lines.push(article.body);
  lines.push("");

  return lines.join("\n");
}

// ── Main compile pipeline ──────────────────────────────────

function compileRawNote(rawPath) {
  const markdown = fs.readFileSync(rawPath, "utf8");
  const stats = fs.statSync(rawPath);
  const { fields, body } = parseFrontmatter(markdown);
  const filename = path.basename(rawPath);

  const errors = validate(rawPath, fields, body);
  if (errors.length > 0) {
    return { ok: false, rawPath, errors };
  }

  const article = {
    id: fields.get("id") || normalizeId(filename),
    title: fields.get("title"),
    type: fields.get("type"),
    summary: fields.get("summary"),
    evidence: fields.get("evidence") || "",
    appliesTo: parseStringList(fields.get("applies_to")),
    decisionOrGotcha: fields.get("decision_or_gotcha") || fields.get("decision") || "",
    sources: parseStringList(fields.get("sources")),
    supersedes: fields.get("supersedes") || "",
    freshness: fields.get("freshness") || "current",
    updatedAt: fields.get("updated_at") || stats.mtime.toISOString(),
    status: fields.get("status") || "active",
    trustLevel: Number(fields.get("trust_level")) || 70,
    sourceOfTruth: fields.get("source_of_truth")?.toLowerCase() === "true",
    body
  };

  return { ok: true, rawPath, article };
}

function run() {
  const verbose = process.argv.includes("--verbose");
  const dryRun = process.argv.includes("--dry-run");

  if (!fs.existsSync(RAW_DIR)) {
    console.log(`[memory-compile] no raw directory at ${RAW_DIR} — nothing to compile`);
    console.log(`[memory-compile] create ${RAW_DIR} and add .md notes to get started`);
    process.exit(0);
  }

  const rawFiles = fs.readdirSync(RAW_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => entry.name)
    .sort();

  if (rawFiles.length === 0) {
    console.log("[memory-compile] no raw .md files found — nothing to compile");
    process.exit(0);
  }

  console.log(`[memory-compile] found ${rawFiles.length} raw note(s)`);

  fs.mkdirSync(COMPILED_DIR, { recursive: true });

  const results = rawFiles.map((filename) =>
    compileRawNote(path.join(RAW_DIR, filename))
  );

  const successes = results.filter((r) => r.ok);
  const failures = results.filter((r) => !r.ok);

  // Report validation failures
  for (const failure of failures) {
    console.log(`[memory-compile] SKIP ${path.basename(failure.rawPath)}:`);
    for (const error of failure.errors) {
      console.log(`  - ${error}`);
    }
  }

  // Detect supersession warnings
  const articles = successes.map((r) => r.article);
  const supersessionWarnings = detectSuperseded(articles);
  for (const warning of supersessionWarnings) {
    console.log(`[memory-compile] WARN ${warning}`);
  }

  // Write compiled articles
  let written = 0;
  let skipped = 0;

  for (const { article, rawPath } of successes) {
    const outputFilename = path.basename(rawPath);
    const outputPath = path.join(COMPILED_DIR, outputFilename);
    const compiled = serializeCompiled(article);

    // Skip if compiled output is identical to existing
    if (fs.existsSync(outputPath)) {
      const existing = fs.readFileSync(outputPath, "utf8");
      if (existing === compiled) {
        if (verbose) console.log(`[memory-compile] unchanged: ${outputFilename}`);
        skipped++;
        continue;
      }
    }

    if (dryRun) {
      console.log(`[memory-compile] would write: ${outputFilename} (${article.id})`);
      if (verbose) console.log(compiled);
    } else {
      fs.writeFileSync(outputPath, compiled, "utf8");
      console.log(`[memory-compile] compiled: ${outputFilename} → ${article.id}`);
    }
    written++;
  }

  console.log("");
  console.log(`[memory-compile] ${dryRun ? "dry-run " : ""}summary:`);
  console.log(`  compiled: ${written}`);
  console.log(`  skipped (unchanged): ${skipped}`);
  console.log(`  failed: ${failures.length}`);
  if (supersessionWarnings.length > 0) {
    console.log(`  supersession warnings: ${supersessionWarnings.length}`);
  }
  console.log(`  total raw: ${rawFiles.length}`);

  if (failures.length > 0) {
    process.exit(1);
  }
}

run();
