#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { parseCode } from "./parsers/javascript.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const CONTEXT_DIR = path.join(REPO_ROOT, ".context");
const CACHE_DIR = path.join(CONTEXT_DIR, "cache");
const DB_IMPORT_DIR = path.join(CONTEXT_DIR, "db", "import");

const SUPPORTED_TEXT_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".adoc",
  ".rst",
  ".yaml",
  ".yml",
  ".json",
  ".toml",
  ".csv",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".java",
  ".cs",
  ".rb",
  ".rs",
  ".php",
  ".swift",
  ".kt",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cc",
  ".hh"
]);

const SKIP_DIRECTORIES = new Set([
  ".git",
  ".idea",
  ".vscode",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
  ".context"
]);

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_CONTENT_CHARS = 60000;
const MAX_BODY_CHARS = 12000;
const RULE_KEYWORD_LIMIT = 20;
const DEFAULT_CHUNK_WINDOW_LINES = 80;
const DEFAULT_CHUNK_OVERLAP_LINES = 16;
const DEFAULT_CHUNK_SPLIT_MIN_LINES = 120;
const DEFAULT_CHUNK_MAX_WINDOWS = 8;

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "must",
  "when",
  "where",
  "into",
  "used",
  "using",
  "only",
  "true",
  "false",
  "unless",
  "should",
  "global",
  "active",
  "rule",
  "rules",
  "data",
  "file",
  "files",
  "code",
  "docs",
  "context",
  "och",
  "det",
  "att",
  "som",
  "med",
  "för",
  "utan",
  "eller",
  "inte",
  "ska",
  "skall",
  "måste",
  "kan",
  "vid",
  "alla"
]);

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  if (args.has("--help") || args.has("-h")) {
    printHelp();
    process.exit(0);
  }

  return {
    mode: args.has("--changed") ? "changed" : "full",
    verbose: args.has("--verbose")
  };
}

function printHelp() {
  console.log("Usage: ./scripts/ingest.sh [--changed] [--verbose]");
  console.log("");
  console.log("Options:");
  console.log("  --changed   Ingest only changed/untracked files when git is available.");
  console.log("  --verbose   Print skipped files and additional diagnostics.");
  console.log("  -h, --help  Show this help message.");
}

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function isTextFile(relPath) {
  const ext = path.extname(relPath).toLowerCase();
  const base = path.basename(relPath).toLowerCase();
  if (SUPPORTED_TEXT_EXTENSIONS.has(ext)) {
    return true;
  }

  return base === "readme" || base.startsWith("readme.");
}

function isBinaryBuffer(buffer) {
  const scanLength = Math.min(buffer.length, 4000);
  for (let index = 0; index < scanLength; index += 1) {
    if (buffer[index] === 0) {
      return true;
    }
  }

  return false;
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function normalizeToken(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function tokenizeKeywords(value) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function parsePositiveIntegerEnv(name, fallback) {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
}

function parseNonNegativeIntegerEnv(name, fallback) {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function parseSourcePaths(configText) {
  const sourcePaths = [];
  const lines = configText.split(/\r?\n/);
  let inSourcePaths = false;

  for (const line of lines) {
    if (!inSourcePaths && /^source_paths:\s*$/.test(line.trim())) {
      inSourcePaths = true;
      continue;
    }

    if (!inSourcePaths) {
      continue;
    }

    const entryMatch = line.match(/^\s*-\s*(.+?)\s*$/);
    if (entryMatch) {
      const unquoted = entryMatch[1].replace(/^['"]|['"]$/g, "");
      sourcePaths.push(unquoted);
      continue;
    }

    if (line.trim() !== "" && !/^\s/.test(line)) {
      break;
    }
  }

  return sourcePaths;
}

function parseRules(rulesText) {
  const lines = rulesText.split(/\r?\n/);
  const rules = [];
  let current = null;

  const pushCurrent = () => {
    if (!current || !current.id) {
      return;
    }
    rules.push({
      id: current.id,
      description: current.description ?? "",
      priority: Number.isFinite(current.priority) ? current.priority : 0,
      enforce: current.enforce === true
    });
  };

  for (const line of lines) {
    const idMatch = line.match(/^\s*-\s*id:\s*(.+?)\s*$/);
    if (idMatch) {
      pushCurrent();
      current = { id: idMatch[1].replace(/^['"]|['"]$/g, "") };
      continue;
    }

    if (!current) {
      continue;
    }

    const descriptionMatch = line.match(/^\s*description:\s*(.+?)\s*$/);
    if (descriptionMatch) {
      current.description = descriptionMatch[1].replace(/^['"]|['"]$/g, "");
      continue;
    }

    const priorityMatch = line.match(/^\s*priority:\s*(\d+)\s*$/);
    if (priorityMatch) {
      current.priority = Number(priorityMatch[1]);
      continue;
    }

    const enforceMatch = line.match(/^\s*enforce:\s*(true|false)\s*$/i);
    if (enforceMatch) {
      current.enforce = enforceMatch[1].toLowerCase() === "true";
    }
  }

  pushCurrent();
  return rules;
}

function walkDirectory(directoryPath, files) {
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      walkDirectory(absolutePath, files);
      continue;
    }

    if (entry.isFile()) {
      files.add(absolutePath);
    }
  }
}

function hasSourcePrefix(relPath, sourcePaths) {
  return sourcePaths.some((sourcePath) => {
    const source = toPosixPath(sourcePath).replace(/\/+$/, "");
    return relPath === source || relPath.startsWith(`${source}/`);
  });
}

function getGitChanges() {
  try {
    const output = execSync("git status --porcelain", {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8"
    });

    const changed = new Set();
    const deleted = new Set();

    for (const line of output.split(/\r?\n/)) {
      if (!line) continue;
      const status = line.slice(0, 2);
      const payload = line.slice(3).trim();
      if (!payload) continue;

      if (payload.includes(" -> ")) {
        const [fromPath, toPath] = payload.split(" -> ");
        deleted.add(path.resolve(REPO_ROOT, fromPath));
        changed.add(path.resolve(REPO_ROOT, toPath));
        continue;
      }

      const absolutePath = path.resolve(REPO_ROOT, payload);
      if (status.includes("D")) {
        deleted.add(absolutePath);
      } else {
        changed.add(absolutePath);
      }
    }

    return {
      changed: [...changed],
      deleted: [...deleted]
    };
  } catch {
    return {
      changed: [],
      deleted: []
    };
  }
}

function collectCandidateFiles(sourcePaths, mode) {
  const candidates = new Set();
  const deletedRelPaths = new Set();

  if (mode === "changed") {
    const gitChanges = getGitChanges();
    if (gitChanges.changed.length > 0 || gitChanges.deleted.length > 0) {
      for (const absolutePath of gitChanges.changed) {
        if (!fs.existsSync(absolutePath)) {
          continue;
        }

        const stats = fs.statSync(absolutePath);
        if (stats.isFile()) {
          const relPath = toPosixPath(path.relative(REPO_ROOT, absolutePath));
          if (hasSourcePrefix(relPath, sourcePaths)) {
            candidates.add(absolutePath);
          }
          continue;
        }

        if (stats.isDirectory()) {
          const nestedFiles = new Set();
          walkDirectory(absolutePath, nestedFiles);
          for (const nestedPath of nestedFiles) {
            const nestedRelPath = toPosixPath(path.relative(REPO_ROOT, nestedPath));
            if (hasSourcePrefix(nestedRelPath, sourcePaths)) {
              candidates.add(nestedPath);
            }
          }
        }
      }

      for (const deletedPath of gitChanges.deleted) {
        const relPath = toPosixPath(path.relative(REPO_ROOT, deletedPath));
        if (hasSourcePrefix(relPath, sourcePaths)) {
          deletedRelPaths.add(relPath);
        }
      }

      return {
        candidates,
        incrementalMode: true,
        deletedRelPaths: [...deletedRelPaths]
      };
    }
  }

  for (const sourcePath of sourcePaths) {
    const absoluteSourcePath = path.resolve(REPO_ROOT, sourcePath);
    if (!fs.existsSync(absoluteSourcePath)) {
      continue;
    }

    const stats = fs.statSync(absoluteSourcePath);
    if (stats.isFile()) {
      candidates.add(absoluteSourcePath);
      continue;
    }

    if (stats.isDirectory()) {
      walkDirectory(absoluteSourcePath, candidates);
    }
  }

  return {
    candidates,
    incrementalMode: false,
    deletedRelPaths: []
  };
}

function detectKind(relPath) {
  const lower = relPath.toLowerCase();
  const ext = path.extname(lower);
  const isAdrPath =
    /(^|\/)(adr|adrs|decisions)(\/|$)/.test(lower) ||
    /(^|\/)adr[-_ ]?\d+/.test(path.basename(lower));

  if (isAdrPath) {
    return "ADR";
  }

  if (
    lower.startsWith("docs/") ||
    ext === ".md" ||
    ext === ".mdx" ||
    ext === ".txt" ||
    ext === ".adoc" ||
    ext === ".rst"
  ) {
    return "DOC";
  }

  return "CODE";
}

function trustLevelForKind(kind) {
  if (kind === "ADR") return 95;
  if (kind === "CODE") return 80;
  return 70;
}

function checksum(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function extractTitle(content, fallbackTitle) {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^#\s+(.+)\s*$/);
    if (match) return match[1].trim();
  }

  return fallbackTitle;
}

function parseDecisionDate(content, fallbackDate) {
  const datePatterns = [
    /^\s*date:\s*["']?(\d{4}-\d{2}-\d{2})["']?\s*$/im,
    /^\s*decision[_\s-]*date:\s*["']?(\d{4}-\d{2}-\d{2})["']?\s*$/im
  ];

  for (const pattern of datePatterns) {
    const match = content.match(pattern);
    if (match && !Number.isNaN(Date.parse(match[1]))) {
      return match[1];
    }
  }

  return fallbackDate.slice(0, 10);
}

function adrTokens(adrRecord) {
  const fileBase = path.basename(adrRecord.path).replace(path.extname(adrRecord.path), "");
  const tokens = new Set([
    normalizeToken(adrRecord.id),
    normalizeToken(fileBase),
    normalizeToken(adrRecord.title)
  ]);

  const numberMatch = fileBase.match(/(\d+)/);
  if (numberMatch) {
    tokens.add(normalizeToken(`adr-${numberMatch[1]}`));
    tokens.add(normalizeToken(numberMatch[1]));
  }

  return [...tokens].filter(Boolean);
}

function findSupersedesReferences(content) {
  const refs = new Set();
  const pattern = /(?:supersedes|ersätter)\s*[:\-]?\s*([A-Za-z0-9._/-]+)/gi;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    refs.add(match[1]);
  }

  return [...refs];
}

function writeJsonl(filePath, records) {
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  fs.writeFileSync(filePath, body ? `${body}\n` : "", "utf8");
}

function sanitizeTsvCell(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

function writeTsv(filePath, headers, rows) {
  const lines = [headers.join("\t")];
  for (const row of rows) {
    lines.push(row.map((value) => sanitizeTsvCell(value)).join("\t"));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function readJsonlSafe(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((record) => record !== null);
}

function normalizeRuleTokens(ruleRecord) {
  const idParts = ruleRecord.id.split(/[._-]+/g);
  const descriptionTokens = tokenizeKeywords(ruleRecord.body);
  const rawKeywords = [...idParts, ...descriptionTokens];
  const normalized = rawKeywords
    .map((token) => token.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));

  return uniqueSorted(normalized).slice(0, RULE_KEYWORD_LIMIT);
}

function fileTokenSet(fileRecord) {
  const tokenSource = `${fileRecord.path}\n${fileRecord.content.slice(0, 12000)}`;
  return new Set(tokenizeKeywords(tokenSource));
}

function chunkIdFor(filePath, chunk) {
  const startLine = Number.isFinite(chunk.startLine) ? chunk.startLine : 0;
  const endLine = Number.isFinite(chunk.endLine) ? chunk.endLine : startLine;
  return `chunk:${filePath}:${chunk.name}:${startLine}-${endLine}`;
}

function splitChunkIntoWindows(chunkRecord, options) {
  const { windowLines, overlapLines, splitMinLines, maxWindows, chunkBody } = options;
  const sourceBody = typeof chunkBody === "string" ? chunkBody : chunkRecord.body;
  const lines = sourceBody.split(/\r?\n/);
  const totalLines = lines.length;
  if (totalLines < splitMinLines || totalLines <= windowLines) {
    return [];
  }

  const windows = [];
  const safeOverlap = Math.max(0, Math.min(overlapLines, windowLines - 1));
  let start = 0;
  let windowIndex = 1;

  while (start < totalLines && windows.length < maxWindows) {
    const isLastAllowedWindow = windows.length + 1 >= maxWindows;
    const end = isLastAllowedWindow ? totalLines : Math.min(totalLines, start + windowLines);
    const windowStartLine = chunkRecord.start_line + start;
    const windowEndLine = chunkRecord.start_line + Math.max(0, end - 1);
    const windowBody = lines.slice(start, end).join("\n");
    const persistedBody = isLastAllowedWindow ? windowBody : windowBody.slice(0, MAX_BODY_CHARS);
    windows.push({
      id: `${chunkRecord.id}:window:${windowIndex}:${windowStartLine}-${windowEndLine}`,
      file_id: chunkRecord.file_id,
      name: `${chunkRecord.name}#window${windowIndex}`,
      kind: chunkRecord.kind,
      signature: `${chunkRecord.signature} [window ${windowIndex}]`,
      body: persistedBody,
      start_line: windowStartLine,
      end_line: windowEndLine,
      language: chunkRecord.language,
      checksum: checksum(Buffer.from(windowBody)),
      updated_at: chunkRecord.updated_at,
      trust_level: chunkRecord.trust_level,
      status: chunkRecord.status,
      source_of_truth: chunkRecord.source_of_truth
    });

    if (end >= totalLines) {
      break;
    }

    start = end - safeOverlap;
    windowIndex += 1;
  }

  return windows;
}

function main() {
  const { mode, verbose } = parseArgs(process.argv);
  const configPath = path.join(CONTEXT_DIR, "config.yaml");
  const rulesPath = path.join(CONTEXT_DIR, "rules.yaml");

  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing config: ${configPath}`);
  }
  if (!fs.existsSync(rulesPath)) {
    throw new Error(`Missing rules: ${rulesPath}`);
  }

  ensureDirectory(CACHE_DIR);
  ensureDirectory(DB_IMPORT_DIR);

  const configText = fs.readFileSync(configPath, "utf8");
  const sourcePaths = parseSourcePaths(configText);
  if (sourcePaths.length === 0) {
    throw new Error("No source_paths found in .context/config.yaml");
  }

  const rules = parseRules(fs.readFileSync(rulesPath, "utf8"));
  const { candidates, incrementalMode, deletedRelPaths } = collectCandidateFiles(sourcePaths, mode);
  const chunkWindowLines = parsePositiveIntegerEnv(
    "CORTEX_CHUNK_WINDOW_LINES",
    DEFAULT_CHUNK_WINDOW_LINES
  );
  const chunkOverlapLines = Math.max(
    0,
    Math.min(
      chunkWindowLines - 1,
      parseNonNegativeIntegerEnv("CORTEX_CHUNK_OVERLAP_LINES", DEFAULT_CHUNK_OVERLAP_LINES)
    )
  );
  const chunkSplitMinLines = Math.max(
    chunkWindowLines + 1,
    parsePositiveIntegerEnv("CORTEX_CHUNK_SPLIT_MIN_LINES", DEFAULT_CHUNK_SPLIT_MIN_LINES)
  );
  const chunkMaxWindows = parsePositiveIntegerEnv(
    "CORTEX_CHUNK_MAX_WINDOWS",
    DEFAULT_CHUNK_MAX_WINDOWS
  );

  const fileRecordMap = new Map();
  const adrRecordMap = new Map();
  const skipped = {
    unsupported: 0,
    tooLarge: 0,
    binary: 0
  };

  if (incrementalMode) {
    const existingFiles = readJsonlSafe(path.join(CACHE_DIR, "entities.file.jsonl"));
    for (const record of existingFiles) {
      if (!record || typeof record !== "object") continue;
      const filePath = toPosixPath(String(record.path ?? ""));
      if (!filePath || !hasSourcePrefix(filePath, sourcePaths)) {
        continue;
      }
      const absolutePath = path.resolve(REPO_ROOT, filePath);
      if (!fs.existsSync(absolutePath)) {
        continue;
      }
      fileRecordMap.set(String(record.id ?? `file:${filePath}`), {
        ...record,
        id: String(record.id ?? `file:${filePath}`),
        path: filePath,
        kind: String(record.kind ?? detectKind(filePath)),
        content: String(record.content ?? "")
      });
    }

    const existingAdrs = readJsonlSafe(path.join(CACHE_DIR, "entities.adr.jsonl"));
    for (const adr of existingAdrs) {
      if (!adr || typeof adr !== "object") continue;
      const adrPath = toPosixPath(String(adr.path ?? ""));
      if (!adrPath || !hasSourcePrefix(adrPath, sourcePaths)) {
        continue;
      }
      if (!fs.existsSync(path.resolve(REPO_ROOT, adrPath))) {
        continue;
      }
      adrRecordMap.set(String(adr.id ?? ""), {
        ...adr,
        id: String(adr.id ?? ""),
        path: adrPath
      });
    }
  }

  for (const relPath of deletedRelPaths) {
    fileRecordMap.delete(`file:${relPath}`);
    const relPrefix = relPath.endsWith("/") ? relPath : `${relPath}/`;
    for (const [fileId, fileRecord] of fileRecordMap.entries()) {
      if (String(fileRecord.path ?? "").startsWith(relPrefix)) {
        fileRecordMap.delete(fileId);
      }
    }

    for (const [adrId, adrRecord] of adrRecordMap.entries()) {
      if (adrRecord.path === relPath || String(adrRecord.path ?? "").startsWith(relPrefix)) {
        adrRecordMap.delete(adrId);
      }
    }
  }

  for (const absolutePath of [...candidates].sort()) {
    const relPath = toPosixPath(path.relative(REPO_ROOT, absolutePath));
    if (!isTextFile(relPath)) {
      skipped.unsupported += 1;
      if (verbose) console.log(`[ingest] skip unsupported: ${relPath}`);
      continue;
    }

    const stats = fs.statSync(absolutePath);
    if (stats.size > MAX_FILE_BYTES) {
      skipped.tooLarge += 1;
      if (verbose) console.log(`[ingest] skip large: ${relPath}`);
      continue;
    }

    const buffer = fs.readFileSync(absolutePath);
    if (isBinaryBuffer(buffer)) {
      skipped.binary += 1;
      if (verbose) console.log(`[ingest] skip binary: ${relPath}`);
      continue;
    }

    const content = buffer.toString("utf8");
    const kind = detectKind(relPath);
    const id = `file:${relPath}`;
    const updatedAt = stats.mtime.toISOString();
    const sourceOfTruth = kind === "ADR";
    const trustLevel = trustLevelForKind(kind);

    const fileRecord = {
      id,
      path: relPath,
      kind,
      checksum: checksum(buffer),
      updated_at: updatedAt,
      source_of_truth: sourceOfTruth,
      trust_level: trustLevel,
      status: "active",
      size_bytes: stats.size,
      excerpt: normalizeWhitespace(content).slice(0, 500),
      content: content.slice(0, MAX_CONTENT_CHARS)
    };
    fileRecordMap.set(fileRecord.id, fileRecord);

    if (kind === "ADR") {
      const title = extractTitle(content, path.basename(relPath, path.extname(relPath)));
      const adrRecord = {
        id: `adr:${path.basename(relPath, path.extname(relPath)).toLowerCase()}`,
        path: relPath,
        title,
        body: content.slice(0, MAX_BODY_CHARS),
        decision_date: parseDecisionDate(content, updatedAt),
        supersedes_id: "",
        source_of_truth: true,
        trust_level: 95,
        status: "active"
      };
      adrRecordMap.set(adrRecord.id, adrRecord);
    } else {
      for (const [adrId, adrRecord] of adrRecordMap.entries()) {
        if (adrRecord.path === relPath) {
          adrRecordMap.delete(adrId);
        }
      }
    }
  }

  const fileRecords = [...fileRecordMap.values()].sort((a, b) => a.path.localeCompare(b.path));
  const adrRecords = [...adrRecordMap.values()].sort((a, b) => a.path.localeCompare(b.path));

  // Extract chunks from code files
  const chunkRecords = [];
  const definesRelations = [];
  const callsRelations = [];
  const importsRelations = [];
  let windowedChunkCount = 0;

  for (const fileRecord of fileRecords) {
    if (fileRecord.kind !== "CODE") continue;

    const ext = path.extname(fileRecord.path).toLowerCase();
    const supportedForChunking = [".js", ".mjs", ".cjs", ".ts"].includes(ext);
    if (!supportedForChunking) continue;

    try {
      const language = ext === ".ts" ? "typescript" : "javascript";
      const parseResult = parseCode(fileRecord.content, fileRecord.path, language);

      if (parseResult.errors.length > 0 && verbose) {
        console.log(`[ingest] parse errors in ${fileRecord.path}:`, parseResult.errors[0].message);
      }

      const parsedChunks = [];
      const chunkIdsByName = new Map();
      const windowChunkIdsByBaseId = new Map();

      for (const chunk of parseResult.chunks) {
        const chunkId = chunkIdFor(fileRecord.path, chunk);
        parsedChunks.push({ chunk, chunkId });
        if (!chunkIdsByName.has(chunk.name)) {
          chunkIdsByName.set(chunk.name, []);
        }
        chunkIdsByName.get(chunk.name).push(chunkId);

        const chunkRecord = {
          id: chunkId,
          file_id: fileRecord.id,
          name: chunk.name,
          kind: chunk.kind,
          signature: chunk.signature,
          body: chunk.body.slice(0, MAX_BODY_CHARS), // Limit chunk body size
          start_line: chunk.startLine,
          end_line: chunk.endLine,
          language: chunk.language,
          checksum: checksum(Buffer.from(chunk.body)),
          updated_at: fileRecord.updated_at,
          trust_level: fileRecord.trust_level,
          status:
            typeof fileRecord.status === "string" && fileRecord.status.trim().length > 0
              ? fileRecord.status
              : "active",
          source_of_truth: Boolean(fileRecord.source_of_truth)
        };
        chunkRecords.push(chunkRecord);

        // DEFINES relation: File -> Chunk
        definesRelations.push({
          from: fileRecord.id,
          to: chunkId
        });

        const windows = splitChunkIntoWindows(chunkRecord, {
          windowLines: chunkWindowLines,
          overlapLines: chunkOverlapLines,
          splitMinLines: chunkSplitMinLines,
          maxWindows: chunkMaxWindows,
          chunkBody: chunk.body
        });
        if (windows.length > 0) {
          windowedChunkCount += windows.length;
          windowChunkIdsByBaseId.set(
            chunkId,
            windows.map((windowChunk) => windowChunk.id)
          );
          for (const windowChunk of windows) {
            chunkRecords.push(windowChunk);
            definesRelations.push({
              from: fileRecord.id,
              to: windowChunk.id
            });
          }
        }

        // IMPORTS relations: Chunk -> File
        const sourceChunkIds = [chunkId, ...(windowChunkIdsByBaseId.get(chunkId) ?? [])];
        for (const importPath of chunk.imports || []) {
          // Normalize relative imports to absolute paths
          if (importPath.startsWith(".")) {
            const dirName = path.dirname(fileRecord.path);
            const resolvedImport = path.posix.normalize(path.posix.join(dirName, importPath));
            const targetFileId = `file:${resolvedImport}`;
            for (const sourceChunkId of sourceChunkIds) {
              importsRelations.push({
                from: sourceChunkId,
                to: targetFileId,
                import_name: importPath
              });
            }
          }
        }
      }

      const seenCallEdges = new Set();
      for (const { chunk, chunkId } of parsedChunks) {
        // CALLS relations: Chunk -> Chunk (within same file)
        for (const calledName of chunk.calls || []) {
          const targetChunkIds = chunkIdsByName.get(calledName) || [];
          for (const targetChunkId of targetChunkIds) {
            const callKey = `${chunkId}|${targetChunkId}|direct`;
            if (seenCallEdges.has(callKey)) {
              continue;
            }
            seenCallEdges.add(callKey);
            callsRelations.push({
              from: chunkId,
              to: targetChunkId,
              call_type: "direct"
            });

            const windowChunkIds = windowChunkIdsByBaseId.get(chunkId) ?? [];
            for (const windowChunkId of windowChunkIds) {
              const windowCallKey = `${windowChunkId}|${targetChunkId}|direct`;
              if (seenCallEdges.has(windowCallKey)) {
                continue;
              }
              seenCallEdges.add(windowCallKey);
              callsRelations.push({
                from: windowChunkId,
                to: targetChunkId,
                call_type: "direct"
              });
            }
          }
        }
      }
    } catch (error) {
      if (verbose) {
        console.log(`[ingest] failed to parse ${fileRecord.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // Filter CALLS relations to only valid targets (chunks that actually exist)
  const chunkIdSet = new Set(chunkRecords.map(c => c.id));
  const validCallsRelations = callsRelations.filter(rel => chunkIdSet.has(rel.to));

  if (verbose && chunkRecords.length > 0) {
    console.log(`[ingest] extracted ${chunkRecords.length} chunks from ${fileRecords.filter(f => f.kind === "CODE").length} code files`);
    if (windowedChunkCount > 0) {
      console.log(
        `[ingest] overlap windows added=${windowedChunkCount} (window_lines=${chunkWindowLines}, overlap_lines=${chunkOverlapLines}, max_windows=${chunkMaxWindows})`
      );
    }
    console.log(`[ingest] ${validCallsRelations.length} call relations (${callsRelations.length - validCallsRelations.length} filtered)`);
  }

  const ruleRecords = rules.map((rule) => ({
    id: rule.id,
    title: rule.id,
    body: rule.description,
    scope: "global",
    updated_at: new Date().toISOString(),
    source_of_truth: true,
    trust_level: 95,
    status: rule.enforce ? "active" : "draft",
    priority: rule.priority
  }));

  const adrTokenIndex = new Map();
  for (const adrRecord of adrRecords) {
    for (const token of adrTokens(adrRecord)) {
      if (!adrTokenIndex.has(token)) {
        adrTokenIndex.set(token, adrRecord.id);
      }
    }
  }

  const supersedesRelations = [];
  for (const adrRecord of adrRecords) {
    const refs = findSupersedesReferences(adrRecord.body);
    for (const ref of refs) {
      const target = adrTokenIndex.get(normalizeToken(ref));
      if (!target || target === adrRecord.id) {
        continue;
      }
      adrRecord.supersedes_id = target;
      supersedesRelations.push({
        from: adrRecord.id,
        to: target,
        reason: `Supersedes ${ref}`
      });
    }
  }

  const constrainsRelations = [];
  const implementsRelations = [];
  const constrainsSeen = new Set();
  const implementsSeen = new Set();
  const lowerContentByFileId = new Map(
    fileRecords.map((fileRecord) => [fileRecord.id, fileRecord.content.toLowerCase()])
  );
  const tokenByFileId = new Map(fileRecords.map((fileRecord) => [fileRecord.id, fileTokenSet(fileRecord)]));

  for (const ruleRecord of ruleRecords) {
    const needle = ruleRecord.id.toLowerCase();
    const ruleKeywords = normalizeRuleTokens(ruleRecord);

    for (const fileRecord of fileRecords) {
      const lower = lowerContentByFileId.get(fileRecord.id) ?? "";
      const explicitMention = lower.includes(needle);
      const tokens = tokenByFileId.get(fileRecord.id) ?? new Set();
      const matchedKeywords = ruleKeywords.filter((keyword) => tokens.has(keyword));
      const minimumMatches = fileRecord.kind === "CODE" ? 1 : 2;
      const keywordMatch = matchedKeywords.length >= Math.min(minimumMatches, Math.max(1, ruleKeywords.length));

      if (!explicitMention && !keywordMatch) {
        continue;
      }

      const constrainsKey = `${ruleRecord.id}|${fileRecord.id}`;
      if (!constrainsSeen.has(constrainsKey)) {
        constrainsSeen.add(constrainsKey);
        constrainsRelations.push({
          from: ruleRecord.id,
          to: fileRecord.id,
          note: explicitMention
            ? `Mentions ${ruleRecord.id}`
            : `Keyword match ${matchedKeywords.slice(0, 5).join(", ")}`
        });
      }

      if (fileRecord.kind === "CODE") {
        const implementsKey = `${fileRecord.id}|${ruleRecord.id}`;
        if (!implementsSeen.has(implementsKey)) {
          implementsSeen.add(implementsKey);
          implementsRelations.push({
            from: fileRecord.id,
            to: ruleRecord.id,
            note: explicitMention
              ? `Code references ${ruleRecord.id}`
              : `Code keywords ${matchedKeywords.slice(0, 5).join(", ")}`
          });
        }
      }
    }
  }

  writeJsonl(path.join(CACHE_DIR, "documents.jsonl"), fileRecords);
  writeJsonl(path.join(CACHE_DIR, "entities.file.jsonl"), fileRecords);
  writeJsonl(path.join(CACHE_DIR, "entities.adr.jsonl"), adrRecords);
  writeJsonl(path.join(CACHE_DIR, "entities.rule.jsonl"), ruleRecords);
  writeJsonl(path.join(CACHE_DIR, "entities.chunk.jsonl"), chunkRecords);
  writeJsonl(path.join(CACHE_DIR, "relations.supersedes.jsonl"), supersedesRelations);
  writeJsonl(path.join(CACHE_DIR, "relations.constrains.jsonl"), constrainsRelations);
  writeJsonl(path.join(CACHE_DIR, "relations.implements.jsonl"), implementsRelations);
  writeJsonl(path.join(CACHE_DIR, "relations.defines.jsonl"), definesRelations);
  writeJsonl(path.join(CACHE_DIR, "relations.calls.jsonl"), validCallsRelations);
  writeJsonl(path.join(CACHE_DIR, "relations.imports.jsonl"), importsRelations);

  writeTsv(
    path.join(DB_IMPORT_DIR, "file_nodes.tsv"),
    [
      "id",
      "path",
      "kind",
      "excerpt",
      "checksum",
      "updated_at",
      "source_of_truth",
      "trust_level",
      "status"
    ],
    fileRecords.map((record) => [
      record.id,
      record.path,
      record.kind,
      record.excerpt,
      record.checksum,
      record.updated_at,
      record.source_of_truth,
      record.trust_level,
      record.status
    ])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "rule_nodes.tsv"),
    [
      "id",
      "title",
      "body",
      "scope",
      "priority",
      "updated_at",
      "source_of_truth",
      "trust_level",
      "status"
    ],
    ruleRecords.map((record) => [
      record.id,
      record.title,
      record.body,
      record.scope,
      record.priority,
      record.updated_at,
      record.source_of_truth,
      record.trust_level,
      record.status
    ])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "adr_nodes.tsv"),
    [
      "id",
      "path",
      "title",
      "body",
      "decision_date",
      "supersedes_id",
      "source_of_truth",
      "trust_level",
      "status"
    ],
    adrRecords.map((record) => [
      record.id,
      record.path,
      record.title,
      record.body,
      record.decision_date,
      record.supersedes_id,
      record.source_of_truth,
      record.trust_level,
      record.status
    ])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "constrains_rel.tsv"),
    ["from", "to", "note"],
    constrainsRelations.map((record) => [record.from, record.to, record.note])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "implements_rel.tsv"),
    ["from", "to", "note"],
    implementsRelations.map((record) => [record.from, record.to, record.note])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "supersedes_rel.tsv"),
    ["from", "to", "reason"],
    supersedesRelations.map((record) => [record.from, record.to, record.reason])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "chunk_nodes.tsv"),
    [
      "id",
      "file_id",
      "name",
      "kind",
      "signature",
      "body",
      "start_line",
      "end_line",
      "language",
      "checksum",
      "updated_at",
      "trust_level"
    ],
    chunkRecords.map((record) => [
      record.id,
      record.file_id,
      record.name,
      record.kind,
      record.signature,
      record.body,
      record.start_line,
      record.end_line,
      record.language,
      record.checksum,
      record.updated_at,
      record.trust_level
    ])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "defines_rel.tsv"),
    ["from", "to"],
    definesRelations.map((record) => [record.from, record.to])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "calls_rel.tsv"),
    ["from", "to", "call_type"],
    validCallsRelations.map((record) => [record.from, record.to, record.call_type])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "imports_rel.tsv"),
    ["from", "to", "import_name"],
    importsRelations.map((record) => [record.from, record.to, record.import_name])
  );

  const manifest = {
    generated_at: new Date().toISOString(),
    mode,
    source_paths: sourcePaths,
    counts: {
      files: fileRecords.length,
      adrs: adrRecords.length,
      rules: ruleRecords.length,
      chunks: chunkRecords.length,
      relations_constrains: constrainsRelations.length,
      relations_implements: implementsRelations.length,
      relations_supersedes: supersedesRelations.length,
      relations_defines: definesRelations.length,
      relations_calls: validCallsRelations.length,
      relations_imports: importsRelations.length
    },
    skipped,
    incremental_mode: incrementalMode,
    changed_candidates: candidates.size,
    deleted_paths: deletedRelPaths.length
  };

  fs.writeFileSync(path.join(CACHE_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`[ingest] mode=${mode}`);
  if (incrementalMode) {
    console.log(
      `[ingest] incremental changed_candidates=${manifest.changed_candidates} deleted_paths=${manifest.deleted_paths}`
    );
  } else if (mode === "changed") {
    console.log("[ingest] incremental diff unavailable; processed full source set");
  }
  console.log(`[ingest] files=${manifest.counts.files} adrs=${manifest.counts.adrs} rules=${manifest.counts.rules} chunks=${manifest.counts.chunks}`);
  console.log(
    `[ingest] rels constrains=${manifest.counts.relations_constrains} implements=${manifest.counts.relations_implements} supersedes=${manifest.counts.relations_supersedes}`
  );
  console.log(
    `[ingest] rels defines=${manifest.counts.relations_defines} calls=${manifest.counts.relations_calls} imports=${manifest.counts.relations_imports}`
  );
  console.log(
    `[ingest] skipped unsupported=${skipped.unsupported} too_large=${skipped.tooLarge} binary=${skipped.binary}`
  );
  console.log(`[ingest] wrote cache + db import files under .context/`);
}

main();
