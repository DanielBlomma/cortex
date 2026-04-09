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
const COMPILED_DIR = path.join(MEMORY_DIR, "compiled");
const CACHE_DIR = path.join(CONTEXT_DIR, "cache");

const ALLOWED_TYPES = new Set([
  "decision",
  "gotcha",
  "fix",
  "benchmark",
  "migration-note",
  "note"
]);

const REQUIRED_FIELDS = ["title", "type", "summary"];

const STALE_DAYS = 90;

// ── Index loading ─────────────────────────────────────────

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); }
      catch { return null; }
    })
    .filter(Boolean);
}

function loadKnownEntityIds() {
  const ids = new Set();

  for (const row of readJsonl(path.join(CACHE_DIR, "documents.jsonl"))) {
    if (row.id) ids.add(row.id);
  }
  for (const row of readJsonl(path.join(CACHE_DIR, "entities.adr.jsonl"))) {
    if (row.id) ids.add(row.id);
  }
  for (const row of readJsonl(path.join(CACHE_DIR, "entities.rule.jsonl"))) {
    if (row.id) ids.add(row.id);
  }
  for (const row of readJsonl(path.join(CACHE_DIR, "entities.chunk.jsonl"))) {
    if (row.id) ids.add(row.id);
  }

  return ids;
}

function loadKnownFilePaths() {
  const paths = new Set();
  for (const row of readJsonl(path.join(CACHE_DIR, "documents.jsonl"))) {
    if (row.path) paths.add(row.path);
  }
  return paths;
}

// ── Compiled article loading ──────────────────────────────

function loadCompiledArticles() {
  if (!fs.existsSync(COMPILED_DIR)) return [];

  return fs
    .readdirSync(COMPILED_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => entry.name)
    .sort()
    .map((filename) => {
      const absolutePath = path.join(COMPILED_DIR, filename);
      const markdown = fs.readFileSync(absolutePath, "utf8");
      const stats = fs.statSync(absolutePath);
      const { fields, body } = parseFrontmatter(markdown);

      return {
        filename,
        id: fields.get("id") || "",
        title: fields.get("title") || "",
        type: fields.get("type") || "",
        summary: fields.get("summary") || "",
        evidence: fields.get("evidence") || "",
        appliesTo: parseStringList(fields.get("applies_to")),
        decisionOrGotcha: fields.get("decision_or_gotcha") || fields.get("decision") || "",
        sources: parseStringList(fields.get("sources")),
        supersedes: fields.get("supersedes") || "",
        freshness: fields.get("freshness") || "",
        updatedAt: fields.get("updated_at") || stats.mtime.toISOString(),
        status: fields.get("status") || "active",
        trustLevel: Number(fields.get("trust_level")) || 70,
        sourceOfTruth: fields.get("source_of_truth")?.toLowerCase() === "true",
        body
      };
    });
}

// ── Lint checks ───────────────────────────────────────────

function checkMissingProvenance(article) {
  const issues = [];

  for (const field of REQUIRED_FIELDS) {
    if (!article[field]) {
      issues.push({ severity: "error", file: article.filename, message: `missing required field: ${field}` });
    }
  }

  if (!article.id) {
    issues.push({ severity: "error", file: article.filename, message: "missing id field" });
  }

  const memoryType = article.type;
  if (memoryType && !ALLOWED_TYPES.has(memoryType)) {
    issues.push({
      severity: "error",
      file: article.filename,
      message: `unknown type "${memoryType}" (allowed: ${[...ALLOWED_TYPES].join(", ")})`
    });
  }

  if (!article.body) {
    issues.push({ severity: "error", file: article.filename, message: "empty body" });
  }

  if (article.appliesTo.length === 0 && article.sources.length === 0) {
    issues.push({
      severity: "warn",
      file: article.filename,
      message: "no applies_to or sources — memory has no link to codebase"
    });
  }

  return issues;
}

function checkOrphaned(article, knownEntityIds, knownFilePaths) {
  const issues = [];

  for (const target of article.appliesTo) {
    if (!knownEntityIds.has(target)) {
      issues.push({
        severity: "warn",
        file: article.filename,
        message: `applies_to target not found in index: ${target}`
      });
    }
  }

  for (const source of article.sources) {
    const asFileId = `file:${source}`;
    if (!knownEntityIds.has(asFileId) && !knownFilePaths.has(source)) {
      issues.push({
        severity: "warn",
        file: article.filename,
        message: `source file not found in index: ${source}`
      });
    }
  }

  return issues;
}

function checkStale(article) {
  const issues = [];

  if (article.freshness.toLowerCase() === "stale") {
    issues.push({
      severity: "warn",
      file: article.filename,
      message: "freshness is marked stale"
    });
    return issues;
  }

  if (!article.updatedAt) return issues;

  const updatedDate = new Date(article.updatedAt);
  if (isNaN(updatedDate.getTime())) return issues;

  const ageMs = Date.now() - updatedDate.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  if (ageDays > STALE_DAYS) {
    issues.push({
      severity: "warn",
      file: article.filename,
      message: `updated_at is ${Math.floor(ageDays)} days old (threshold: ${STALE_DAYS} days)`
    });
  }

  return issues;
}

function checkDuplicates(articles) {
  const issues = [];
  const byId = new Map();

  for (const article of articles) {
    if (!article.id) continue;
    const list = byId.get(article.id) ?? [];
    list.push(article);
    byId.set(article.id, list);
  }

  for (const [id, group] of byId) {
    if (group.length > 1) {
      const files = group.map((a) => a.filename).join(", ");
      issues.push({
        severity: "error",
        file: group[0].filename,
        message: `duplicate memory id "${id}" in files: ${files}`
      });
    }
  }

  return issues;
}

function checkContradictions(articles) {
  const issues = [];
  const activeArticles = articles.filter((a) => a.status === "active");

  // Group active articles by applies_to target
  const byTarget = new Map();
  for (const article of activeArticles) {
    for (const target of article.appliesTo) {
      const list = byTarget.get(target) ?? [];
      list.push(article);
      byTarget.set(target, list);
    }
  }

  // Conflicting types on the same target signal potential contradiction
  const conflictingPairs = new Set(["decision|decision", "gotcha|fix", "fix|fix", "decision|gotcha"]);

  for (const [target, group] of byTarget) {
    if (group.length < 2) continue;

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];

        // Skip if one supersedes the other
        if (a.supersedes === b.id || b.supersedes === a.id) continue;

        const pair = [a.type, b.type].sort().join("|");
        if (conflictingPairs.has(pair)) {
          issues.push({
            severity: "warn",
            file: a.filename,
            message: `potential contradiction on ${target}: "${a.id}" (${a.type}) vs "${b.id}" (${b.type})`
          });
        }
      }
    }
  }

  // Check for broken supersedes references
  const allIds = new Set(articles.map((a) => a.id));
  for (const article of articles) {
    if (!article.supersedes) continue;
    if (!allIds.has(article.supersedes)) {
      issues.push({
        severity: "warn",
        file: article.filename,
        message: `supersedes target "${article.supersedes}" not found among compiled articles`
      });
    }
  }

  return issues;
}

// ── Main ──────────────────────────────────────────────────

function run() {
  const verbose = process.argv.includes("--verbose");
  const json = process.argv.includes("--json");

  if (!fs.existsSync(COMPILED_DIR)) {
    if (json) {
      console.log(JSON.stringify({ issues: [], summary: { errors: 0, warnings: 0, articles: 0 } }));
    } else {
      console.log("[memory-lint] no compiled directory — nothing to lint");
    }
    process.exit(0);
  }

  const articles = loadCompiledArticles();

  if (articles.length === 0) {
    if (json) {
      console.log(JSON.stringify({ issues: [], summary: { errors: 0, warnings: 0, articles: 0 } }));
    } else {
      console.log("[memory-lint] no compiled articles found");
    }
    process.exit(0);
  }

  const knownEntityIds = loadKnownEntityIds();
  const knownFilePaths = loadKnownFilePaths();

  const allIssues = [];

  // Per-article checks
  for (const article of articles) {
    allIssues.push(...checkMissingProvenance(article));
    allIssues.push(...checkOrphaned(article, knownEntityIds, knownFilePaths));
    allIssues.push(...checkStale(article));
  }

  // Cross-article checks
  allIssues.push(...checkDuplicates(articles));
  allIssues.push(...checkContradictions(articles));

  const errors = allIssues.filter((i) => i.severity === "error");
  const warnings = allIssues.filter((i) => i.severity === "warn");

  if (json) {
    console.log(JSON.stringify({
      issues: allIssues,
      summary: { errors: errors.length, warnings: warnings.length, articles: articles.length }
    }, null, 2));
    process.exit(errors.length > 0 ? 1 : 0);
  }

  console.log(`[memory-lint] linting ${articles.length} compiled article(s)`);
  console.log("");

  if (allIssues.length === 0) {
    console.log("[memory-lint] no issues found");
    process.exit(0);
  }

  // Group issues by file for readable output
  const byFile = new Map();
  for (const issue of allIssues) {
    const list = byFile.get(issue.file) ?? [];
    list.push(issue);
    byFile.set(issue.file, list);
  }

  for (const [file, issues] of byFile) {
    console.log(`  ${file}:`);
    for (const issue of issues) {
      const prefix = issue.severity === "error" ? "ERROR" : "WARN";
      console.log(`    ${prefix}: ${issue.message}`);
    }
    if (verbose) console.log("");
  }

  console.log("");
  console.log(`[memory-lint] summary:`);
  console.log(`  articles: ${articles.length}`);
  console.log(`  errors: ${errors.length}`);
  console.log(`  warnings: ${warnings.length}`);

  process.exit(errors.length > 0 ? 1 : 0);
}

run();
