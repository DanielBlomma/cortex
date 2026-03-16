#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { parseCode as parseJavaScriptCode } from "./parsers/javascript.mjs";
import {
  isVbNetParserAvailable,
  parseCode as parseVbNetCode
} from "./parsers/vbnet.mjs";
import {
  isCppParserAvailable,
  parseCode as parseCppCode
} from "./parsers/cpp.mjs";
import { parseCode as parseConfigCode } from "./parsers/config.mjs";
import { parseCode as parseResourcesCode } from "./parsers/resources.mjs";
import { parseCode as parseSqlCode } from "./parsers/sql.mjs";

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
  ".vb",
  ".sln",
  ".vbproj",
  ".csproj",
  ".fsproj",
  ".props",
  ".targets",
  ".config",
  ".resx",
  ".settings",
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

const LEGACY_DOTNET_METADATA_EXTENSIONS = new Set([
  ".sln",
  ".vbproj",
  ".csproj",
  ".fsproj",
  ".props",
  ".targets",
  ".config",
  ".resx",
  ".settings"
]);

const PROJECT_DEFINITION_EXTENSIONS = new Set([".sln", ".vbproj", ".csproj", ".fsproj"]);
const STRUCTURED_NON_CODE_CHUNK_EXTENSIONS = new Set([".config", ".resx", ".settings"]);

const CODE_FILE_EXTENSIONS = new Set([
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
  ".vb",
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

const SQL_REFERENCE_SOURCE_EXTENSIONS = new Set([
  ".vb",
  ".cs",
  ".config",
  ".resx",
  ".settings"
]);
const NAMED_RESOURCE_REFERENCE_SOURCE_EXTENSIONS = new Set([".vb", ".cs"]);

const SQL_OBJECT_REFERENCE_PATTERNS = [
  /\b(?:SqlCommand|OleDbCommand|OdbcCommand)\s*\(\s*"([^"\r\n]{2,200})"/gi,
  /\bCommandText\s*=\s*"([^"\r\n]{2,500})"/gi,
  /\bCommandType\s*=\s*(?:CommandType\.)?StoredProcedure[\s\S]{0,240}?"([^"\r\n]{2,200})"/gi,
  /"([^"\r\n]{2,200})"[\s\S]{0,240}?\bCommandType\s*=\s*(?:CommandType\.)?StoredProcedure/gi
];

const SQL_STRING_REFERENCE_PATTERNS = [
  /\bexec(?:ute)?\s+([#@]?[A-Za-z0-9_[\].]+)/gi,
  /\bfrom\s+([#@]?[A-Za-z0-9_[\].]+)/gi,
  /\bjoin\s+([#@]?[A-Za-z0-9_[\].]+)/gi,
  /\bupdate\s+([#@]?[A-Za-z0-9_[\].]+)/gi,
  /\binsert\s+into\s+([#@]?[A-Za-z0-9_[\].]+)/gi,
  /\bdelete\s+from\s+([#@]?[A-Za-z0-9_[\].]+)/gi,
  /\bmerge\s+into\s+([#@]?[A-Za-z0-9_[\].]+)/gi
];

const SQL_RESOURCE_KEY_PATTERNS = [
  /\bMy\.Resources\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /\bResources\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /\bMy\.Settings\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /\b(?:[A-Za-z_][A-Za-z0-9_]*\.)?Settings\.Default\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /\bGetString\(\s*"([^"\r\n]+)"/g,
  /\bGetObject\(\s*"([^"\r\n]+)"/g
];
const CONFIG_KEY_REFERENCE_PATTERNS = [
  /\bConfigurationManager\.ConnectionStrings\s*\[\s*"([^"\r\n]+)"\s*\]/g,
  /\bConfigurationManager\.ConnectionStrings\s*\(\s*"([^"\r\n]+)"\s*\)/g,
  /\bConfigurationManager\.AppSettings\s*\[\s*"([^"\r\n]+)"\s*\]/g,
  /\bConfigurationManager\.AppSettings\s*\(\s*"([^"\r\n]+)"\s*\)/g,
  /\bGetConnectionString\(\s*"([^"\r\n]+)"\s*\)/g,
  /\bGetAppSetting\(\s*"([^"\r\n]+)"\s*\)/g
];

const CHUNK_PARSERS = new Map([
  [
    ".js",
    {
      language: "javascript",
      parse: parseJavaScriptCode
    }
  ],
  [
    ".mjs",
    {
      language: "javascript",
      parse: parseJavaScriptCode
    }
  ],
  [
    ".cjs",
    {
      language: "javascript",
      parse: parseJavaScriptCode
    }
  ],
  [
    ".ts",
    {
      language: "typescript",
      parse: parseJavaScriptCode
    }
  ],
  [
    ".vb",
    {
      language: "vbnet",
      parse: parseVbNetCode,
      isAvailable: isVbNetParserAvailable
    }
  ],
  [
    ".sql",
    {
      language: "sql",
      parse: parseSqlCode
    }
  ],
  [
    ".config",
    {
      language: "config",
      parse: parseConfigCode
    }
  ],
  [
    ".resx",
    {
      language: "resource",
      parse: parseResourcesCode
    }
  ],
  [
    ".settings",
    {
      language: "settings",
      parse: parseResourcesCode
    }
  ],
  [
    ".c",
    {
      language: "c",
      parse: parseCppCode,
      isAvailable: isCppParserAvailable
    }
  ],
  [
    ".h",
    {
      language: "c",
      parse: parseCppCode,
      isAvailable: isCppParserAvailable
    }
  ],
  [
    ".cpp",
    {
      language: "cpp",
      parse: parseCppCode,
      isAvailable: isCppParserAvailable
    }
  ],
  [
    ".cc",
    {
      language: "cpp",
      parse: parseCppCode,
      isAvailable: isCppParserAvailable
    }
  ],
  [
    ".hpp",
    {
      language: "cpp",
      parse: parseCppCode,
      isAvailable: isCppParserAvailable
    }
  ],
  [
    ".hh",
    {
      language: "cpp",
      parse: parseCppCode,
      isAvailable: isCppParserAvailable
    }
  ]
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
const IMPORT_RESOLUTION_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];
const IMPORT_RUNTIME_JS_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs"]);
const IMPORT_RUNTIME_JS_RESOLUTION_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const CPP_IMPORT_RESOLUTION_EXTENSIONS = [".h", ".hh", ".hpp", ".c", ".cc", ".cpp"];

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

function pushImportResolutionCandidate(candidates, seenCandidates, candidatePath) {
  if (!seenCandidates.has(candidatePath)) {
    seenCandidates.add(candidatePath);
    candidates.push(candidatePath);
  }
}

function isCppLikeFilePath(filePath) {
  return [".c", ".h", ".cc", ".cpp", ".hh", ".hpp"].includes(path.posix.extname(filePath).toLowerCase());
}

function resolveRelativeImportTargetId(filePath, importPath, indexedFileIds) {
  const isCppLike = isCppLikeFilePath(filePath);
  const isRelativeImport = importPath.startsWith(".");
  const isLocalCppInclude =
    isCppLike && !path.posix.isAbsolute(importPath) && !/^[A-Za-z]:[\\/]/.test(importPath);

  if (!isRelativeImport && !isLocalCppInclude) {
    return null;
  }

  const basePath = path.posix.normalize(path.posix.join(path.posix.dirname(filePath), importPath));
  const candidates = [];
  const seenCandidates = new Set();
  pushImportResolutionCandidate(candidates, seenCandidates, basePath);

  if (path.posix.extname(basePath) === "") {
    const extensions = isCppLike ? CPP_IMPORT_RESOLUTION_EXTENSIONS : IMPORT_RESOLUTION_EXTENSIONS;
    for (const extension of extensions) {
      pushImportResolutionCandidate(candidates, seenCandidates, `${basePath}${extension}`);
    }
    if (!isCppLike) {
      for (const extension of IMPORT_RESOLUTION_EXTENSIONS) {
        pushImportResolutionCandidate(candidates, seenCandidates, path.posix.join(basePath, `index${extension}`));
      }
    }
  } else if (IMPORT_RUNTIME_JS_EXTENSIONS.has(path.posix.extname(basePath))) {
    const extension = path.posix.extname(basePath);
    const stemPath = basePath.slice(0, -extension.length);
    for (const candidateExtension of IMPORT_RUNTIME_JS_RESOLUTION_EXTENSIONS) {
      pushImportResolutionCandidate(candidates, seenCandidates, `${stemPath}${candidateExtension}`);
    }
  }

  for (const candidate of candidates) {
    const targetFileId = `file:${candidate}`;
    if (indexedFileIds.has(targetFileId)) {
      return targetFileId;
    }
  }

  return null;
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

  if (LEGACY_DOTNET_METADATA_EXTENSIONS.has(ext) || !CODE_FILE_EXTENSIONS.has(ext)) {
    return "DOC";
  }

  return "CODE";
}

function getChunkParserForExtension(ext) {
  return CHUNK_PARSERS.get(ext) ?? null;
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

function relationKey(...parts) {
  return parts.map((part) => String(part ?? "")).join("|");
}

function uniqueRelations(relations) {
  const deduped = new Map();
  for (const relation of relations) {
    const key = relationKey(relation.from, relation.to, relation.note);
    if (!deduped.has(key)) {
      deduped.set(key, relation);
    }
  }
  return [...deduped.values()].sort((a, b) =>
    relationKey(a.from, a.to, a.note).localeCompare(relationKey(b.from, b.to, b.note))
  );
}

function normalizeSqlName(value) {
  if (!value) {
    return "";
  }

  return String(value)
    .trim()
    .replace(/[;"`]/g, "")
    .replace(/\[(.+?)\]/g, "$1")
    .replace(/\s+/g, "")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.\.+/g, ".")
    .toLowerCase();
}

function sqlChunkAliases(name) {
  const normalized = normalizeSqlName(name);
  if (!normalized) {
    return [];
  }

  const aliases = new Set([normalized]);
  const parts = normalized.split(".").filter(Boolean);
  if (parts.length > 1) {
    aliases.add(parts[parts.length - 1]);
  }
  return [...aliases];
}

function configChunkAliases(chunk) {
  const aliases = new Set();
  const rawKey = String(chunk?.configKey ?? chunk?.name ?? "");
  const normalizedKey = normalizeToken(rawKey);
  if (normalizedKey) {
    aliases.add(normalizedKey);
  }
  const chunkName = String(chunk?.name ?? "");
  const tail = chunkName.split(".").pop() ?? "";
  const normalizedTail = normalizeToken(tail);
  if (normalizedTail) {
    aliases.add(normalizedTail);
  }
  return [...aliases];
}

function namedEntryChunkAliases(chunk) {
  const aliases = new Set();
  const rawKey = String(chunk?.resourceKey ?? chunk?.configKey ?? chunk?.name ?? "");
  const normalizedKey = normalizeToken(rawKey);
  if (normalizedKey) {
    aliases.add(normalizedKey);
  }
  const chunkName = String(chunk?.name ?? "");
  const tail = chunkName.split(".").pop() ?? "";
  const normalizedTail = normalizeToken(tail);
  if (normalizedTail) {
    aliases.add(normalizedTail);
  }
  return [...aliases];
}

function extractSqlReferenceNamesFromString(text) {
  const refs = new Set();

  const normalizedName = normalizeSqlName(text);
  if (/^[a-z0-9_.]+$/i.test(normalizedName) && normalizedName.includes(".")) {
    refs.add(normalizedName);
  }

  for (const pattern of SQL_STRING_REFERENCE_PATTERNS) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const name = normalizeSqlName(match[1]);
      if (!name || name.startsWith("@") || name.startsWith("#")) {
        continue;
      }
      refs.add(name);
    }
  }

  return [...refs];
}

function parseResxSqlReferenceMap(content) {
  const refsByKey = new Map();
  const dataPattern = /<data\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/data>/gi;
  let match;

  while ((match = dataPattern.exec(content)) !== null) {
    const key = normalizeToken(decodeXmlEntities(match[1]));
    if (!key) {
      continue;
    }

    const valueMatch = match[2].match(/<value>([\s\S]*?)<\/value>/i);
    if (!valueMatch) {
      continue;
    }

    const value = decodeXmlEntities(valueMatch[1]).trim();
    const refs = extractSqlReferenceNamesFromString(value);
    if (refs.length === 0) {
      continue;
    }

    const existing = refsByKey.get(key) ?? [];
    refsByKey.set(key, uniqueSorted([...existing, ...refs]));
  }

  return refsByKey;
}

function parseResxKeyMap(content) {
  const fileKeys = new Map();
  const dataPattern = /<data\b[^>]*\bname="([^"]+)"[^>]*>/gi;
  let match;

  while ((match = dataPattern.exec(content)) !== null) {
    const key = normalizeToken(decodeXmlEntities(match[1]));
    if (!key) {
      continue;
    }
    fileKeys.set(key, true);
  }

  return fileKeys;
}

function parseSettingsSqlReferenceMap(content) {
  const refsByKey = new Map();
  const settingPattern = /<Setting\b[^>]*\bName="([^"]+)"[^>]*>([\s\S]*?)<\/Setting>/gi;
  let match;

  while ((match = settingPattern.exec(content)) !== null) {
    const key = normalizeToken(decodeXmlEntities(match[1]));
    if (!key) {
      continue;
    }

    const valueMatch = match[2].match(/<Value(?:\s[^>]*)?>([\s\S]*?)<\/Value>/i);
    if (!valueMatch) {
      continue;
    }

    const value = decodeXmlEntities(valueMatch[1]).trim();
    const refs = extractSqlReferenceNamesFromString(value);
    if (refs.length === 0) {
      continue;
    }

    const existing = refsByKey.get(key) ?? [];
    refsByKey.set(key, uniqueSorted([...existing, ...refs]));
  }

  return refsByKey;
}

function parseSettingsKeyMap(content) {
  const fileKeys = new Map();
  const settingPattern = /<Setting\b[^>]*\bName="([^"]+)"[^>]*>/gi;
  let match;

  while ((match = settingPattern.exec(content)) !== null) {
    const key = normalizeToken(decodeXmlEntities(match[1]));
    if (!key) {
      continue;
    }
    fileKeys.set(key, true);
  }

  return fileKeys;
}

function parseConfigKeyMap(content) {
  const fileKeys = new Map();
  const addPattern = /<add\b([^>]+?)\/?>/gi;
  let match;

  while ((match = addPattern.exec(content)) !== null) {
    const attributes = match[1];
    const nameMatch = attributes.match(/\bname="([^"]+)"/i);
    const keyMatch = attributes.match(/\bkey="([^"]+)"/i);
    const normalized = normalizeToken(decodeXmlEntities(nameMatch?.[1] ?? keyMatch?.[1] ?? ""));
    if (!normalized) {
      continue;
    }
    fileKeys.set(normalized, true);
  }

  return fileKeys;
}

function buildSqlResourceReferenceMap(fileRecords) {
  const refsByKey = new Map();

  for (const fileRecord of fileRecords) {
    const ext = path.extname(fileRecord.path).toLowerCase();
    let fileRefs = null;
    if (ext === ".resx") {
      fileRefs = parseResxSqlReferenceMap(fileRecord.content);
    } else if (ext === ".settings") {
      fileRefs = parseSettingsSqlReferenceMap(fileRecord.content);
    }

    if (!fileRefs) {
      continue;
    }

    for (const [key, refs] of fileRefs.entries()) {
      const existing = refsByKey.get(key) ?? [];
      refsByKey.set(key, uniqueSorted([...existing, ...refs]));
    }
  }

  return refsByKey;
}

function buildNamedResourceFileMaps(fileRecords) {
  const resourceFilesByKey = new Map();
  const settingFilesByKey = new Map();
  const configFilesByKey = new Map();

  for (const fileRecord of fileRecords) {
    const ext = path.extname(fileRecord.path).toLowerCase();
    const keyMap =
      ext === ".resx"
        ? parseResxKeyMap(fileRecord.content)
        : ext === ".settings"
          ? parseSettingsKeyMap(fileRecord.content)
          : ext === ".config"
            ? parseConfigKeyMap(fileRecord.content)
          : null;

    if (!keyMap) {
      continue;
    }

    for (const key of keyMap.keys()) {
      const targetMap =
        ext === ".resx" ? resourceFilesByKey : ext === ".settings" ? settingFilesByKey : configFilesByKey;
      const list = targetMap.get(key) ?? [];
      list.push(fileRecord.id);
      targetMap.set(key, uniqueSorted(list));
    }
  }

  return { resourceFilesByKey, settingFilesByKey, configFilesByKey };
}

function extractSqlResourceKeyReferences(content) {
  const keys = new Set();

  for (const pattern of SQL_RESOURCE_KEY_PATTERNS) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const key = normalizeToken(match[1]);
      if (key) {
        keys.add(key);
      }
    }
  }

  return [...keys];
}

function extractConfigKeyReferences(content) {
  const keys = new Set();

  for (const pattern of CONFIG_KEY_REFERENCE_PATTERNS) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const key = normalizeToken(match[1]);
      if (key) {
        keys.add(key);
      }
    }
  }

  return [...keys];
}

function shouldExtractNamedResourceReferences(filePath) {
  return NAMED_RESOURCE_REFERENCE_SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function generateNamedResourceRelations(fileRecords) {
  const { resourceFilesByKey, settingFilesByKey, configFilesByKey } = buildNamedResourceFileMaps(fileRecords);
  const usesResourceRelations = [];
  const usesSettingRelations = [];
  const usesConfigRelations = [];
  const resourceSeen = new Set();
  const settingSeen = new Set();
  const configSeen = new Set();

  for (const fileRecord of fileRecords) {
    if (!shouldExtractNamedResourceReferences(fileRecord.path)) {
      continue;
    }

    for (const key of extractSqlResourceKeyReferences(fileRecord.content)) {
      for (const targetFileId of resourceFilesByKey.get(key) ?? []) {
        const relKey = relationKey(fileRecord.id, targetFileId, key);
        if (!resourceSeen.has(relKey) && fileRecord.id !== targetFileId) {
          resourceSeen.add(relKey);
          usesResourceRelations.push({
            from: fileRecord.id,
            to: targetFileId,
            note: key
          });
        }
      }

      for (const targetFileId of settingFilesByKey.get(key) ?? []) {
        const relKey = relationKey(fileRecord.id, targetFileId, key);
        if (!settingSeen.has(relKey) && fileRecord.id !== targetFileId) {
          settingSeen.add(relKey);
          usesSettingRelations.push({
            from: fileRecord.id,
            to: targetFileId,
            note: key
          });
        }
      }
    }

    for (const key of extractConfigKeyReferences(fileRecord.content)) {
      for (const targetFileId of configFilesByKey.get(key) ?? []) {
        const relKey = relationKey(fileRecord.id, targetFileId, key);
        if (!configSeen.has(relKey) && fileRecord.id !== targetFileId) {
          configSeen.add(relKey);
          usesConfigRelations.push({
            from: fileRecord.id,
            to: targetFileId,
            note: key
          });
        }
      }
    }
  }

  usesResourceRelations.sort((a, b) =>
    relationKey(a.from, a.to, a.note).localeCompare(relationKey(b.from, b.to, b.note))
  );
  usesSettingRelations.sort((a, b) =>
    relationKey(a.from, a.to, a.note).localeCompare(relationKey(b.from, b.to, b.note))
  );
  usesConfigRelations.sort((a, b) =>
    relationKey(a.from, a.to, a.note).localeCompare(relationKey(b.from, b.to, b.note))
  );

  return { usesResourceRelations, usesSettingRelations, usesConfigRelations };
}

function parseConfigIncludeTargets(fileRecord) {
  const relPath = toPosixPath(String(fileRecord?.path ?? "").trim());
  const lowerPath = relPath.toLowerCase();
  if (!lowerPath.endsWith(".config")) {
    return [];
  }

  const content = String(fileRecord?.content ?? "");
  const dir = path.posix.dirname(relPath);
  const includes = [];
  const sectionPattern =
    /<([A-Za-z_][A-Za-z0-9_.:-]*)\b([^>]*?)\b(configSource|file)="([^"]+)"([^>]*)>/gi;
  let match;

  while ((match = sectionPattern.exec(content)) !== null) {
    const sectionName = String(match[1] ?? "").trim().toLowerCase();
    const attributeName = String(match[3] ?? "").trim().toLowerCase();
    const includePath = decodeXmlEntities(match[4] ?? "").trim().replace(/\\/g, "/");
    if (!sectionName || !attributeName || !includePath) {
      continue;
    }
    if (includePath.startsWith("/") || includePath.startsWith("~")) {
      continue;
    }

    const resolvedPath = path.posix.normalize(dir === "." ? includePath : `${dir}/${includePath}`);
    if (!resolvedPath || resolvedPath.startsWith("../")) {
      continue;
    }

    includes.push({
      targetPath: resolvedPath,
      note: `${sectionName}:${attributeName}`
    });
  }

  return includes;
}

function generateConfigIncludeRelations(fileRecords) {
  const fileIdByPath = new Map(fileRecords.map((record) => [toPosixPath(record.path), record.id]));
  const relations = [];
  const seen = new Set();

  for (const fileRecord of fileRecords) {
    for (const include of parseConfigIncludeTargets(fileRecord)) {
      const targetFileId = fileIdByPath.get(include.targetPath);
      if (!targetFileId || targetFileId === fileRecord.id) {
        continue;
      }
      const key = relationKey(fileRecord.id, targetFileId, include.note);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      relations.push({
        from: fileRecord.id,
        to: targetFileId,
        note: include.note
      });
    }
  }

  relations.sort((a, b) => relationKey(a.from, a.to, a.note).localeCompare(relationKey(b.from, b.to, b.note)));
  return relations;
}

function parseSectionHandlerDeclarations(content) {
  const declarations = [];
  const sectionPattern = /<section\b([^>]*?)\/?>/gi;
  let match;

  while ((match = sectionPattern.exec(String(content ?? ""))) !== null) {
    const attrs = match[1] ?? "";
    const nameMatch = attrs.match(/\bname="([^"]+)"/i);
    const typeMatch = attrs.match(/\btype="([^"]+)"/i);
    const sectionName = normalizeToken(decodeXmlEntities(nameMatch?.[1] ?? ""));
    const typeValue = decodeXmlEntities(typeMatch?.[1] ?? "").trim();
    if (!sectionName || !typeValue) {
      continue;
    }

    const typeParts = typeValue.split(",").map((part) => part.trim()).filter(Boolean);
    const fullTypeName = typeParts[0] ?? "";
    const assemblyName = typeParts[1] ?? "";
    const shortTypeName = fullTypeName.split(".").pop()?.split("+").pop() ?? "";
    const normalizedTypeName = normalizeToken(shortTypeName);
    const normalizedAssemblyName = normalizeToken(assemblyName);
    if (!normalizedTypeName && !normalizedAssemblyName) {
      continue;
    }

    declarations.push({
      sectionName,
      normalizedTypeName,
      normalizedAssemblyName
    });
  }

  return declarations;
}

function buildProjectAssemblyFileMap(fileRecords) {
  const aliasMap = new Map();

  for (const fileRecord of fileRecords) {
    const ext = path.extname(fileRecord.path).toLowerCase();
    if (!PROJECT_DEFINITION_EXTENSIONS.has(ext) || ext === ".sln") {
      continue;
    }

    const aliases = uniqueSorted([
      normalizeToken(extractXmlTagValue(fileRecord.content, "AssemblyName")),
      normalizeToken(extractXmlTagValue(fileRecord.content, "RootNamespace")),
      normalizeToken(path.basename(fileRecord.path, ext))
    ].filter(Boolean));

    for (const alias of aliases) {
      const existing = aliasMap.get(alias) ?? [];
      aliasMap.set(alias, uniqueSorted([...existing, fileRecord.id]));
    }
  }

  return aliasMap;
}

function extractDeclaredTypeNames(fileRecord) {
  const ext = path.extname(fileRecord.path).toLowerCase();
  const pattern =
    ext === ".vb"
      ? /\b(?:Public|Friend|Private|Protected|Partial|MustInherit|NotInheritable|Shadows|Default|Overridable|Overrides|Shared|\s)*(?:Class|Module|Structure|Interface|Enum)\s+([A-Za-z_][A-Za-z0-9_]*)/gi
      : ext === ".cs"
        ? /\b(?:public|internal|private|protected|abstract|sealed|static|partial|\s)*(?:class|struct|interface|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/gi
        : null;

  if (!pattern) {
    return [];
  }

  const typeNames = new Set();
  let match;
  while ((match = pattern.exec(String(fileRecord.content ?? ""))) !== null) {
    const normalized = normalizeToken(match[1] ?? "");
    if (normalized) {
      typeNames.add(normalized);
    }
  }

  return [...typeNames];
}

function buildCodeTypeFileMap(fileRecords) {
  const typeMap = new Map();

  for (const fileRecord of fileRecords) {
    if (fileRecord.kind !== "CODE") {
      continue;
    }
    for (const typeName of extractDeclaredTypeNames(fileRecord)) {
      const existing = typeMap.get(typeName) ?? [];
      typeMap.set(typeName, uniqueSorted([...existing, fileRecord.id]));
    }
  }

  return typeMap;
}

function longestCommonPathPrefixLength(pathA, pathB) {
  const partsA = toPosixPath(pathA).split("/").filter(Boolean);
  const partsB = toPosixPath(pathB).split("/").filter(Boolean);
  const limit = Math.min(partsA.length, partsB.length);
  let count = 0;
  while (count < limit && partsA[count] === partsB[count]) {
    count += 1;
  }
  return count;
}

function generateMachineConfigRelations(fileRecords) {
  const machineConfigs = fileRecords.filter(
    (record) => path.basename(record.path).toLowerCase() === "machine.config"
  );
  if (machineConfigs.length === 0) {
    return [];
  }

  const relations = [];
  const seen = new Set();

  for (const fileRecord of fileRecords) {
    const lowerPath = fileRecord.path.toLowerCase();
    if (
      !lowerPath.endsWith(".config") ||
      path.basename(lowerPath) === "machine.config" ||
      !/<configuration\b/i.test(String(fileRecord.content ?? "")) ||
      parseConfigTransformTarget(fileRecord)
    ) {
      continue;
    }

    const rankedTargets = machineConfigs
      .filter((candidate) => candidate.id !== fileRecord.id)
      .map((candidate) => ({
        id: candidate.id,
        score: longestCommonPathPrefixLength(fileRecord.path, candidate.path)
      }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

    const target = rankedTargets[0];
    if (!target) {
      continue;
    }

    const key = relationKey(fileRecord.id, target.id, "inherits:machine");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    relations.push({
      from: fileRecord.id,
      to: target.id,
      note: "inherits:machine"
    });
  }

  return uniqueRelations(relations);
}

function generateSectionHandlerRelations(fileRecords) {
  const projectAssemblyFileMap = buildProjectAssemblyFileMap(fileRecords);
  const codeTypeFileMap = buildCodeTypeFileMap(fileRecords);
  const relations = [];

  for (const fileRecord of fileRecords) {
    if (!fileRecord.path.toLowerCase().endsWith(".config")) {
      continue;
    }

    for (const declaration of parseSectionHandlerDeclarations(fileRecord.content)) {
      const note = `section_handler:${declaration.sectionName}`;

      for (const targetFileId of projectAssemblyFileMap.get(declaration.normalizedAssemblyName) ?? []) {
        relations.push({
          from: fileRecord.id,
          to: targetFileId,
          note
        });
      }

      for (const targetFileId of codeTypeFileMap.get(declaration.normalizedTypeName) ?? []) {
        relations.push({
          from: fileRecord.id,
          to: targetFileId,
          note
        });
      }
    }
  }

  return uniqueRelations(relations.filter((relation) => relation.from !== relation.to));
}

function generateConfigTransformKeyRelations(fileRecords, chunkRecords) {
  const fileIdByPath = new Map(fileRecords.map((record) => [toPosixPath(record.path), record.id]));
  const chunkFileIdById = new Map(chunkRecords.map((chunk) => [chunk.id, chunk.file_id]));
  const configChunkIdsByAlias = new Map();

  for (const chunk of chunkRecords) {
    if (isWindowChunkId(chunk.id) || String(chunk.language ?? "").toLowerCase() !== "config") {
      continue;
    }
    for (const alias of configChunkAliases(chunk)) {
      const existing = configChunkIdsByAlias.get(alias) ?? [];
      configChunkIdsByAlias.set(alias, [...existing, chunk.id]);
    }
  }

  const relations = [];
  for (const fileRecord of fileRecords) {
    const transform = parseConfigTransformTarget(fileRecord);
    if (!transform) {
      continue;
    }

    const targetFileId = fileIdByPath.get(transform.targetPath);
    if (!targetFileId) {
      continue;
    }

    for (const key of parseConfigKeyMap(fileRecord.content).keys()) {
      for (const targetChunkId of configChunkIdsByAlias.get(key) ?? []) {
        if (chunkFileIdById.get(targetChunkId) !== targetFileId) {
          continue;
        }
        relations.push({
          from: fileRecord.id,
          to: targetChunkId,
          note: `${key}:${transform.environment}`
        });
      }
    }
  }

  return uniqueRelations(relations);
}

function parseConfigTransformTarget(fileRecord) {
  const relPath = toPosixPath(String(fileRecord?.path ?? "").trim());
  const lowerPath = relPath.toLowerCase();
  if (!lowerPath.endsWith(".config")) {
    return null;
  }

  const content = String(fileRecord?.content ?? "");
  if (!/\bxdt:(?:transform|locator)\b/i.test(content) && !/\bxmlns:xdt=/i.test(content)) {
    return null;
  }

  const dir = path.posix.dirname(relPath);
  const baseName = path.posix.basename(relPath, ".config");
  const match = baseName.match(/^(.+)\.([^.]+)$/);
  if (!match) {
    return null;
  }

  const baseStem = match[1]?.trim();
  const environment = match[2]?.trim();
  if (!baseStem || !environment) {
    return null;
  }

  const targetPath = dir === "." ? `${baseStem}.config` : `${dir}/${baseStem}.config`;
  return {
    targetPath,
    environment: normalizeToken(environment)
  };
}

function generateConfigTransformRelations(fileRecords) {
  const fileIdByPath = new Map(fileRecords.map((record) => [toPosixPath(record.path), record.id]));
  const relations = [];
  const seen = new Set();

  for (const fileRecord of fileRecords) {
    const transform = parseConfigTransformTarget(fileRecord);
    if (!transform) {
      continue;
    }

    const targetFileId = fileIdByPath.get(transform.targetPath);
    if (!targetFileId || targetFileId === fileRecord.id) {
      continue;
    }

    const key = relationKey(fileRecord.id, targetFileId, transform.environment);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    relations.push({
      from: fileRecord.id,
      to: targetFileId,
      note: transform.environment
    });
  }

  relations.sort((a, b) => relationKey(a.from, a.to, a.note).localeCompare(relationKey(b.from, b.to, b.note)));
  return relations;
}

function shouldExtractSqlReferences(filePath) {
  return SQL_REFERENCE_SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function extractSqlObjectReferencesFromContent(content, filePath = "", sqlResourceReferenceMap = new Map()) {
  const refs = new Set();
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".resx") {
    for (const values of parseResxSqlReferenceMap(content).values()) {
      for (const ref of values) {
        refs.add(ref);
      }
    }
  } else if (ext === ".settings") {
    for (const values of parseSettingsSqlReferenceMap(content).values()) {
      for (const ref of values) {
        refs.add(ref);
      }
    }
  }

  for (const pattern of SQL_OBJECT_REFERENCE_PATTERNS) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      for (const ref of extractSqlReferenceNamesFromString(match[1])) {
        refs.add(ref);
      }
    }
  }

  if (sqlResourceReferenceMap.size > 0) {
    for (const key of extractSqlResourceKeyReferences(content)) {
      for (const ref of sqlResourceReferenceMap.get(key) ?? []) {
        refs.add(ref);
      }
    }
  }

  return uniqueSorted([...refs]);
}

function decodeXmlEntities(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function projectIdFor(filePath) {
  return `project:${filePath}`;
}

function isProjectDefinitionFile(filePath) {
  return PROJECT_DEFINITION_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function resolveProjectRelativePath(baseFilePath, includePath) {
  if (!includePath) {
    return null;
  }

  const normalizedInclude = toPosixPath(decodeXmlEntities(includePath).trim().replace(/\\/g, "/"));
  if (!normalizedInclude) {
    return null;
  }

  const resolved = path.resolve(REPO_ROOT, path.dirname(baseFilePath), normalizedInclude);
  const relPath = toPosixPath(path.relative(REPO_ROOT, resolved));
  if (!relPath || relPath.startsWith("../")) {
    return null;
  }

  return relPath;
}

function projectLanguageForExtension(ext) {
  switch (ext) {
    case ".vbproj":
      return "vbnet";
    case ".csproj":
      return "csharp";
    case ".fsproj":
      return "fsharp";
    case ".sln":
      return "solution";
    default:
      return "dotnet";
  }
}

function extractXmlTagValue(content, tagName) {
  const match = content.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? decodeXmlEntities(match[1]).trim() : "";
}

function collectXmlIncludeValues(content, elementNames) {
  const values = [];
  const pattern = new RegExp(
    `<(?:${elementNames.join("|")})\\b[^>]*\\bInclude="([^"]+)"[^>]*\\/?>`,
    "gi"
  );
  let match;
  while ((match = pattern.exec(content)) !== null) {
    values.push(decodeXmlEntities(match[1]).trim());
  }
  return values;
}

function parseSolutionProject(fileRecord, indexedFileIds) {
  const declaredMembers = [];
  const referencesProjectRelations = [];
  const includesFileRelations = [];
  const fileRelationKeys = new Set();
  const ext = path.extname(fileRecord.path).toLowerCase();
  const fallbackName = path.basename(fileRecord.path, ext);
  const projectPattern =
    /^Project\([^)]*\)\s*=\s*"([^"]+)",\s*"([^"]+\.(?:vbproj|csproj|fsproj))",\s*"\{[^"]+\}"$/gim;

  let match;
  while ((match = projectPattern.exec(fileRecord.content)) !== null) {
    const memberName = match[1].trim();
    const memberPath = resolveProjectRelativePath(fileRecord.path, match[2]);
    if (!memberPath) {
      continue;
    }
    declaredMembers.push({ name: memberName, path: memberPath });
    const targetId = projectIdFor(memberPath);
    if (indexedFileIds.has(`file:${memberPath}`)) {
      referencesProjectRelations.push({
        from: projectIdFor(fileRecord.path),
        to: targetId,
        note: `solution_member:${memberName}`
      });
    }
  }

  for (const fileId of [`file:${fileRecord.path}`]) {
    if (indexedFileIds.has(fileId) && !fileRelationKeys.has(fileId)) {
      fileRelationKeys.add(fileId);
      includesFileRelations.push({ from: projectIdFor(fileRecord.path), to: fileId });
    }
  }

  const summaryParts = [`Solution ${fallbackName}`];
  if (declaredMembers.length > 0) {
    summaryParts.push(`Contains ${declaredMembers.length} project references`);
  }

  return {
    project: {
      id: projectIdFor(fileRecord.path),
      path: fileRecord.path,
      name: fallbackName,
      kind: "solution",
      language: projectLanguageForExtension(ext),
      target_framework: "",
      summary: `${summaryParts.join(". ")}.`,
      file_count: includesFileRelations.length,
      updated_at: fileRecord.updated_at,
      source_of_truth: false,
      trust_level: 78,
      status: "active"
    },
    includesFileRelations,
    referencesProjectRelations
  };
}

function parseDotNetProject(fileRecord, indexedFileIds) {
  const ext = path.extname(fileRecord.path).toLowerCase();
  const fallbackName = path.basename(fileRecord.path, ext);
  const assemblyName = extractXmlTagValue(fileRecord.content, "AssemblyName");
  const rootNamespace = extractXmlTagValue(fileRecord.content, "RootNamespace");
  const targetFrameworkRaw =
    extractXmlTagValue(fileRecord.content, "TargetFramework") ||
    extractXmlTagValue(fileRecord.content, "TargetFrameworkVersion") ||
    extractXmlTagValue(fileRecord.content, "TargetFrameworks");
  const targetFramework = targetFrameworkRaw.split(";")[0].trim();
  const includeCandidates = collectXmlIncludeValues(fileRecord.content, [
    "Compile",
    "Content",
    "EmbeddedResource",
    "None",
    "Page",
    "ApplicationDefinition"
  ]);
  const projectReferenceCandidates = collectXmlIncludeValues(fileRecord.content, ["ProjectReference"]);
  const includesFileRelations = [];
  const referencesProjectRelations = [];
  const fileRelationKeys = new Set();

  const addFileRelation = (relPath) => {
    const fileId = `file:${relPath}`;
    if (!indexedFileIds.has(fileId) || fileRelationKeys.has(fileId)) {
      return;
    }
    fileRelationKeys.add(fileId);
    includesFileRelations.push({
      from: projectIdFor(fileRecord.path),
      to: fileId
    });
  };

  addFileRelation(fileRecord.path);

  for (const includePath of includeCandidates) {
    const relPath = resolveProjectRelativePath(fileRecord.path, includePath);
    if (!relPath) {
      continue;
    }
    addFileRelation(relPath);
  }

  for (const includePath of projectReferenceCandidates) {
    const relPath = resolveProjectRelativePath(fileRecord.path, includePath);
    if (!relPath) {
      continue;
    }
    const targetFileId = `file:${relPath}`;
    if (!indexedFileIds.has(targetFileId)) {
      continue;
    }
    referencesProjectRelations.push({
      from: projectIdFor(fileRecord.path),
      to: projectIdFor(relPath),
      note: includePath
    });
  }

  const summaryParts = [
    `${projectLanguageForExtension(ext).toUpperCase()} project ${assemblyName || rootNamespace || fallbackName}`
  ];
  if (targetFramework) {
    summaryParts.push(`Target framework ${targetFramework}`);
  }
  if (includesFileRelations.length > 1) {
    summaryParts.push(`Includes ${includesFileRelations.length - 1} indexed project files`);
  }
  if (referencesProjectRelations.length > 0) {
    summaryParts.push(`References ${referencesProjectRelations.length} projects`);
  }

  return {
    project: {
      id: projectIdFor(fileRecord.path),
      path: fileRecord.path,
      name: assemblyName || rootNamespace || fallbackName,
      kind: "project",
      language: projectLanguageForExtension(ext),
      target_framework: targetFramework,
      summary: `${summaryParts.join(". ")}.`,
      file_count: includesFileRelations.length,
      updated_at: fileRecord.updated_at,
      source_of_truth: false,
      trust_level: 80,
      status: "active"
    },
    includesFileRelations,
    referencesProjectRelations
  };
}

function generateProjects(fileRecords) {
  const indexedFileIds = new Set(fileRecords.map((record) => record.id));
  const projectRecords = [];
  const includesFileRelations = [];
  const referencesProjectRelations = [];
  const includeKeys = new Set();
  const referenceKeys = new Set();

  for (const fileRecord of fileRecords) {
    if (!isProjectDefinitionFile(fileRecord.path)) {
      continue;
    }

    const ext = path.extname(fileRecord.path).toLowerCase();
    const parsed =
      ext === ".sln"
        ? parseSolutionProject(fileRecord, indexedFileIds)
        : parseDotNetProject(fileRecord, indexedFileIds);

    projectRecords.push(parsed.project);

    for (const relation of parsed.includesFileRelations) {
      const key = relationKey(relation.from, relation.to);
      if (includeKeys.has(key)) {
        continue;
      }
      includeKeys.add(key);
      includesFileRelations.push(relation);
    }

    for (const relation of parsed.referencesProjectRelations) {
      const key = relationKey(relation.from, relation.to, relation.note);
      if (referenceKeys.has(key)) {
        continue;
      }
      referenceKeys.add(key);
      referencesProjectRelations.push(relation);
    }
  }

  projectRecords.sort((a, b) => a.path.localeCompare(b.path));
  includesFileRelations.sort((a, b) => relationKey(a.from, a.to).localeCompare(relationKey(b.from, b.to)));
  referencesProjectRelations.sort((a, b) =>
    relationKey(a.from, a.to, a.note).localeCompare(relationKey(b.from, b.to, b.note))
  );

  return {
    projects: projectRecords,
    includesFileRelations,
    referencesProjectRelations
  };
}

function removeChunkStateForFile(fileId, chunkRecordMap, definesRelationMap, callsRelationMap, importsRelationMap, callsSqlRelationMap) {
  const removedChunkIds = new Set();

  for (const [chunkId, chunkRecord] of chunkRecordMap.entries()) {
    if (chunkRecord.file_id === fileId) {
      removedChunkIds.add(chunkId);
      chunkRecordMap.delete(chunkId);
    }
  }

  if (removedChunkIds.size === 0) {
    return;
  }

  for (const [key, relation] of definesRelationMap.entries()) {
    if (relation.from === fileId || removedChunkIds.has(relation.to)) {
      definesRelationMap.delete(key);
    }
  }

  for (const [key, relation] of callsRelationMap.entries()) {
    if (removedChunkIds.has(relation.from) || removedChunkIds.has(relation.to)) {
      callsRelationMap.delete(key);
    }
  }

  for (const [key, relation] of importsRelationMap.entries()) {
    if (removedChunkIds.has(relation.from)) {
      importsRelationMap.delete(key);
    }
  }

  for (const [key, relation] of callsSqlRelationMap.entries()) {
    if (relation.from === fileId || removedChunkIds.has(relation.to)) {
      callsSqlRelationMap.delete(key);
    }
  }
}

function hydrateIncrementalChunkState(fileRecords) {
  const fileIdSet = new Set(fileRecords.map((record) => record.id));
  const chunkRecordMap = new Map();
  const definesRelationMap = new Map();
  const callsRelationMap = new Map();
  const importsRelationMap = new Map();
  const callsSqlRelationMap = new Map();

  for (const record of readJsonlSafe(path.join(CACHE_DIR, "entities.chunk.jsonl"))) {
    if (!record || typeof record !== "object") continue;
    const chunkId = String(record.id ?? "");
    const fileId = String(record.file_id ?? "");
    if (!chunkId || !fileIdSet.has(fileId)) {
      continue;
    }
    chunkRecordMap.set(chunkId, {
      ...record,
      id: chunkId,
      file_id: fileId
    });
  }

  const chunkIdSet = new Set(chunkRecordMap.keys());

  for (const record of readJsonlSafe(path.join(CACHE_DIR, "relations.defines.jsonl"))) {
    if (!record || typeof record !== "object") continue;
    const from = String(record.from ?? "");
    const to = String(record.to ?? "");
    if (!fileIdSet.has(from) || !chunkIdSet.has(to)) {
      continue;
    }
    definesRelationMap.set(relationKey(from, to), { from, to });
  }

  for (const record of readJsonlSafe(path.join(CACHE_DIR, "relations.calls.jsonl"))) {
    if (!record || typeof record !== "object") continue;
    const from = String(record.from ?? "");
    const to = String(record.to ?? "");
    const callType = String(record.call_type ?? "direct");
    if (!chunkIdSet.has(from) || !chunkIdSet.has(to)) {
      continue;
    }
    callsRelationMap.set(relationKey(from, to, callType), {
      from,
      to,
      call_type: callType
    });
  }

  for (const record of readJsonlSafe(path.join(CACHE_DIR, "relations.imports.jsonl"))) {
    if (!record || typeof record !== "object") continue;
    const from = String(record.from ?? "");
    const to = String(record.to ?? "");
    const importName = String(record.import_name ?? "");
    if (!chunkIdSet.has(from) || !fileIdSet.has(to)) {
      continue;
    }
    importsRelationMap.set(relationKey(from, to, importName), {
      from,
      to,
      import_name: importName
    });
  }

  for (const record of readJsonlSafe(path.join(CACHE_DIR, "relations.calls_sql.jsonl"))) {
    if (!record || typeof record !== "object") continue;
    const from = String(record.from ?? "");
    const to = String(record.to ?? "");
    const note = String(record.note ?? "");
    if (!fileIdSet.has(from) || !chunkIdSet.has(to)) {
      continue;
    }
    callsSqlRelationMap.set(relationKey(from, to, note), {
      from,
      to,
      note
    });
  }

  return {
    chunkRecordMap,
    definesRelationMap,
    callsRelationMap,
    importsRelationMap,
    callsSqlRelationMap
  };
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

function generateChunkDescription(chunk) {
  const parts = [chunk.kind];
  if (chunk.exported) parts.push("exported");
  if (chunk.async) parts.push("async");
  parts.push(chunk.signature);

  if (typeof chunk.description === "string" && chunk.description.trim().length > 10) {
    parts.push(normalizeWhitespace(chunk.description).slice(0, 200));
  }

  // Extract leading JSDoc/comment from body
  // Match leading JSDoc (/** */), block (/* */) and line (//) comments
  const commentMatch = chunk.body.match(/^(?:\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*)[\s\n]*)+/);
  if (commentMatch) {
    const cleaned = commentMatch[0]
      .replace(/\/\*\*|\*\/|\*|\/\//g, "")
      .replace(/\s+/g, " ").trim()
      .slice(0, 200);
    if (cleaned.length > 10) parts.push(cleaned);
  }

  return parts.join(". ") + ".";
}

function generateModuleSummary(dir, files, exportNames, repoRoot = REPO_ROOT) {
  // Check for README.md in directory
  const readmePath = path.join(repoRoot, dir, "README.md");
  if (fs.existsSync(readmePath)) {
    try {
      const content = fs.readFileSync(readmePath, "utf8");
      // Skip first heading line, take first 300 chars
      const lines = content.split(/\r?\n/);
      const startIdx = lines.findIndex(l => !l.startsWith("#") && l.trim().length > 0);
      if (startIdx >= 0) {
        const excerpt = lines.slice(startIdx).join(" ").trim().slice(0, 300);
        if (excerpt.length > 20) return excerpt;
      }
    } catch {
      // fall through to auto-generated summary
    }
  }

  const name = path.basename(dir);
  const codeFiles = files.filter(f => f.kind === "CODE");
  const docFiles = files.filter(f => f.kind !== "CODE");

  const parts = [`Module ${name}`];
  parts.push(`Contains ${files.length} files (${codeFiles.length} code, ${docFiles.length} docs)`);

  // Detect common file extension pattern
  const exts = new Set(codeFiles.map(f => path.extname(f.path).toLowerCase()));
  if (exts.size === 1) {
    const ext = [...exts][0];
    const extNames = { ".ts": "TypeScript", ".js": "JavaScript", ".mjs": "JavaScript (ESM)", ".tsx": "TypeScript React" };
    if (extNames[ext]) parts.push(`${extNames[ext]} source files`);
  }

  if (exportNames.length > 0) {
    parts.push(`Key exports: ${exportNames.slice(0, 5).join(", ")}`);
  }

  return parts.join(". ") + ".";
}

function generateModules(fileRecords, chunkRecords) {
  const dirFiles = new Map();
  const dirChunks = new Map();
  const fileById = new Map(fileRecords.map(f => [f.id, f]));

  for (const file of fileRecords) {
    const dir = path.dirname(file.path);
    if (!dirFiles.has(dir)) dirFiles.set(dir, []);
    dirFiles.get(dir).push(file);
  }

  for (const chunk of chunkRecords) {
    if (!chunk.exported || isWindowChunkId(chunk.id)) continue;
    const file = fileById.get(chunk.file_id);
    if (!file) continue;
    const dir = path.dirname(file.path);
    if (!dirChunks.has(dir)) dirChunks.set(dir, []);
    dirChunks.get(dir).push(chunk);
  }

  const modules = [];
  const containsRelations = [];
  const containsModuleRelations = [];
  const exportsRelations = [];

  const MIN_MODULE_FILES = 2;

  for (const [dir, files] of dirFiles) {
    if (files.length < MIN_MODULE_FILES) continue;

    const exports = dirChunks.get(dir) || [];
    const exportNames = [...new Set(exports.slice(0, 20).map(c => c.name))];
    const moduleId = `module:${dir}`;

    modules.push({
      id: moduleId,
      path: dir,
      name: path.basename(dir),
      summary: generateModuleSummary(dir, files, exportNames),
      file_count: files.length,
      exported_symbols: exportNames.join(", "),
      updated_at: files.reduce((latest, f) => f.updated_at > latest ? f.updated_at : latest, ""),
      source_of_truth: false,
      trust_level: 75,
      status: "active"
    });

    // CONTAINS: Module -> File
    for (const file of files) {
      containsRelations.push({ from: moduleId, to: file.id });
    }

    // EXPORTS: Module -> Chunk
    for (const chunk of exports) {
      exportsRelations.push({ from: moduleId, to: chunk.id });
    }
  }

  // CONTAINS_MODULE: parent Module -> child Module
  const moduleDirs = new Set(modules.map(m => m.path));
  for (const dir of moduleDirs) {
    const parent = path.dirname(dir);
    if (parent !== dir && moduleDirs.has(parent)) {
      containsModuleRelations.push({
        from: `module:${parent}`,
        to: `module:${dir}`
      });
    }
  }

  return { modules, containsRelations, containsModuleRelations, exportsRelations };
}

function isWindowChunkId(chunkId) {
  return typeof chunkId === "string" && chunkId.includes(":window:");
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
      description: chunkRecord.description || "",
      start_line: windowStartLine,
      end_line: windowEndLine,
      language: chunkRecord.language,
      exported: chunkRecord.exported || false,
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
  const indexedFileIds = new Set(fileRecords.map((record) => record.id));
  const changedFileIds = new Set(
    [...candidates].map((absolutePath) => `file:${toPosixPath(path.relative(REPO_ROOT, absolutePath))}`)
  );

  const {
    chunkRecordMap,
    definesRelationMap,
    callsRelationMap,
    importsRelationMap,
    callsSqlRelationMap
  } = incrementalMode
    ? hydrateIncrementalChunkState(fileRecords)
    : {
        chunkRecordMap: new Map(),
        definesRelationMap: new Map(),
        callsRelationMap: new Map(),
        importsRelationMap: new Map(),
        callsSqlRelationMap: new Map()
      };

  const cachedChunkFileIds = new Set(
    [...chunkRecordMap.values()].map((record) => String(record.file_id ?? "")).filter(Boolean)
  );
  const cachedSqlReferenceFileIds = new Set(
    [...callsSqlRelationMap.values()].map((record) => String(record.from ?? "")).filter(Boolean)
  );
  const usesConfigKeyRelationMap = new Map();
  const usesResourceKeyRelationMap = new Map();
  const usesSettingKeyRelationMap = new Map();

  // Extract chunks from changed or uncached code files
  let windowedChunkCount = 0;
  const sqlChunkIdsByAlias = new Map();
  const configChunkIdsByAlias = new Map();
  const resourceChunkIdsByAlias = new Map();
  const settingChunkIdsByAlias = new Map();
  const deferredSqlCallEdges = [];

  for (const fileRecord of fileRecords) {
    const ext = path.extname(fileRecord.path).toLowerCase();
    const parser = getChunkParserForExtension(ext);
    const isStructuredNonCodeChunk = STRUCTURED_NON_CODE_CHUNK_EXTENSIONS.has(ext);
    if (fileRecord.kind !== "CODE" && !isStructuredNonCodeChunk) continue;
    if (!parser) continue;
    if (typeof parser.isAvailable === "function" && !parser.isAvailable()) continue;

    const shouldParseFile =
      !incrementalMode || changedFileIds.has(fileRecord.id) || !cachedChunkFileIds.has(fileRecord.id);
    if (!shouldParseFile) {
      continue;
    }

    removeChunkStateForFile(
      fileRecord.id,
      chunkRecordMap,
      definesRelationMap,
      callsRelationMap,
      importsRelationMap,
      callsSqlRelationMap
    );

    try {
      const parseResult = parser.parse(fileRecord.content, fileRecord.path, parser.language);

      if (parseResult.errors.length > 0 && verbose) {
        console.log(`[ingest] parse errors in ${fileRecord.path}:`, parseResult.errors[0].message);
      }

      const parsedChunks = [];
      const chunkIdsByName = new Map();

      for (const chunk of parseResult.chunks) {
        const chunkId = chunkIdFor(fileRecord.path, chunk);
        parsedChunks.push({ chunk, chunkId });
        if (!chunkIdsByName.has(chunk.name)) {
          chunkIdsByName.set(chunk.name, []);
        }
        chunkIdsByName.get(chunk.name).push(chunkId);
        if (parser.language === "sql") {
          for (const alias of sqlChunkAliases(chunk.name)) {
            if (!sqlChunkIdsByAlias.has(alias)) {
              sqlChunkIdsByAlias.set(alias, []);
            }
            sqlChunkIdsByAlias.get(alias).push(chunkId);
          }
          deferredSqlCallEdges.push({
            chunkId,
            calls: Array.isArray(chunk.calls) ? chunk.calls : []
          });
        } else if (parser.language === "config") {
          for (const alias of configChunkAliases(chunk)) {
            if (!configChunkIdsByAlias.has(alias)) {
              configChunkIdsByAlias.set(alias, []);
            }
            configChunkIdsByAlias.get(alias).push(chunkId);
          }
          deferredSqlCallEdges.push({
            chunkId,
            calls: Array.isArray(chunk.calls) ? chunk.calls : []
          });
        } else if (parser.language === "resource") {
          for (const alias of namedEntryChunkAliases(chunk)) {
            if (!resourceChunkIdsByAlias.has(alias)) {
              resourceChunkIdsByAlias.set(alias, []);
            }
            resourceChunkIdsByAlias.get(alias).push(chunkId);
          }
          deferredSqlCallEdges.push({
            chunkId,
            calls: Array.isArray(chunk.calls) ? chunk.calls : []
          });
        } else if (parser.language === "settings") {
          for (const alias of namedEntryChunkAliases(chunk)) {
            if (!settingChunkIdsByAlias.has(alias)) {
              settingChunkIdsByAlias.set(alias, []);
            }
            settingChunkIdsByAlias.get(alias).push(chunkId);
          }
          deferredSqlCallEdges.push({
            chunkId,
            calls: Array.isArray(chunk.calls) ? chunk.calls : []
          });
        }

        const chunkRecord = {
          id: chunkId,
          file_id: fileRecord.id,
          name: chunk.name,
          kind: chunk.kind,
          signature: chunk.signature,
          body: chunk.body.slice(0, MAX_BODY_CHARS), // Limit chunk body size
          description: generateChunkDescription(chunk),
          start_line: chunk.startLine,
          end_line: chunk.endLine,
          language: chunk.language,
          exported: Boolean(chunk.exported),
          checksum: checksum(Buffer.from(chunk.body)),
          updated_at: fileRecord.updated_at,
          trust_level: fileRecord.trust_level,
          status:
            typeof fileRecord.status === "string" && fileRecord.status.trim().length > 0
              ? fileRecord.status
              : "active",
          source_of_truth: Boolean(fileRecord.source_of_truth)
        };
        chunkRecordMap.set(chunkId, chunkRecord);

        // DEFINES relation: File -> Chunk
        definesRelationMap.set(relationKey(fileRecord.id, chunkId), {
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
          for (const windowChunk of windows) {
            chunkRecordMap.set(windowChunk.id, windowChunk);
            definesRelationMap.set(relationKey(fileRecord.id, windowChunk.id), {
              from: fileRecord.id,
              to: windowChunk.id
            });
          }
        }

        // IMPORTS relations: Chunk -> File
        for (const importPath of chunk.imports || []) {
          const targetFileId = resolveRelativeImportTargetId(fileRecord.path, importPath, indexedFileIds);
          if (!targetFileId) {
            continue;
          }

          importsRelationMap.set(relationKey(chunkId, targetFileId, importPath), {
            from: chunkId,
            to: targetFileId,
            import_name: importPath
          });
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
            callsRelationMap.set(relationKey(chunkId, targetChunkId, "direct"), {
              from: chunkId,
              to: targetChunkId,
              call_type: "direct"
            });
          }
        }
      }
    } catch (error) {
      if (verbose) {
        console.log(`[ingest] failed to parse ${fileRecord.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const chunkRecords = [...chunkRecordMap.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));

  // Filter CALLS relations to only valid targets (chunks that actually exist)
  const chunkIdSet = new Set(chunkRecords.map(c => c.id));
  const validDefinesRelations = [...definesRelationMap.values()].filter(
    (rel) => indexedFileIds.has(rel.from) && chunkIdSet.has(rel.to)
  );
  const totalCallsRelations = callsRelationMap.size;
  for (const edge of deferredSqlCallEdges) {
    for (const calledName of edge.calls) {
      for (const alias of sqlChunkAliases(calledName)) {
        const targetChunkIds = sqlChunkIdsByAlias.get(alias) || [];
        for (const targetChunkId of targetChunkIds) {
          if (targetChunkId === edge.chunkId) {
            continue;
          }
          callsRelationMap.set(relationKey(edge.chunkId, targetChunkId, "sql_reference"), {
            from: edge.chunkId,
            to: targetChunkId,
            call_type: "sql_reference"
          });
        }
      }
    }
  }
  const validCallsRelations = [...callsRelationMap.values()].filter(
    (rel) => chunkIdSet.has(rel.from) && chunkIdSet.has(rel.to)
  );
  const validImportsRelations = [...importsRelationMap.values()].filter(
    (rel) => chunkIdSet.has(rel.from) && indexedFileIds.has(rel.to)
  );
  const sqlDefinitionsChanged =
    incrementalMode &&
    fileRecords.some(
      (fileRecord) =>
        changedFileIds.has(fileRecord.id) && path.extname(fileRecord.path).toLowerCase() === ".sql"
    );
  const sqlResourceReferenceMap = buildSqlResourceReferenceMap(fileRecords);
  for (const fileRecord of fileRecords) {
    if (!shouldExtractSqlReferences(fileRecord.path)) {
      continue;
    }

    const shouldAnalyzeFile =
      !incrementalMode ||
      sqlDefinitionsChanged ||
      changedFileIds.has(fileRecord.id) ||
      !cachedSqlReferenceFileIds.has(fileRecord.id);
    if (!shouldAnalyzeFile) {
      continue;
    }

    for (const [key, relation] of callsSqlRelationMap.entries()) {
      if (relation.from === fileRecord.id) {
        callsSqlRelationMap.delete(key);
      }
    }

    for (const refName of extractSqlObjectReferencesFromContent(
      fileRecord.content,
      fileRecord.path,
      sqlResourceReferenceMap
    )) {
      for (const alias of sqlChunkAliases(refName)) {
        const targetChunkIds = sqlChunkIdsByAlias.get(alias) || [];
        for (const targetChunkId of targetChunkIds) {
          callsSqlRelationMap.set(relationKey(fileRecord.id, targetChunkId, refName), {
            from: fileRecord.id,
            to: targetChunkId,
            note: refName
          });
        }
      }
    }
  }
  const validCallsSqlRelations = [...callsSqlRelationMap.values()].filter(
    (rel) => indexedFileIds.has(rel.from) && chunkIdSet.has(rel.to)
  );
  for (const fileRecord of fileRecords) {
    if (!shouldExtractNamedResourceReferences(fileRecord.path)) {
      continue;
    }

    for (const key of extractSqlResourceKeyReferences(fileRecord.content)) {
      for (const targetChunkId of resourceChunkIdsByAlias.get(key) ?? []) {
        usesResourceKeyRelationMap.set(relationKey(fileRecord.id, targetChunkId, key), {
          from: fileRecord.id,
          to: targetChunkId,
          note: key
        });
      }
      for (const targetChunkId of settingChunkIdsByAlias.get(key) ?? []) {
        usesSettingKeyRelationMap.set(relationKey(fileRecord.id, targetChunkId, key), {
          from: fileRecord.id,
          to: targetChunkId,
          note: key
        });
      }
    }

    for (const key of extractConfigKeyReferences(fileRecord.content)) {
      for (const targetChunkId of configChunkIdsByAlias.get(key) ?? []) {
        usesConfigKeyRelationMap.set(relationKey(fileRecord.id, targetChunkId, key), {
          from: fileRecord.id,
          to: targetChunkId,
          note: key
        });
      }
    }
  }
  for (const relation of generateConfigTransformKeyRelations(fileRecords, chunkRecords)) {
    usesConfigKeyRelationMap.set(relationKey(relation.from, relation.to, relation.note), relation);
  }
  const validUsesConfigKeyRelations = [...usesConfigKeyRelationMap.values()].filter(
    (rel) => indexedFileIds.has(rel.from) && chunkIdSet.has(rel.to)
  );
  const validUsesResourceKeyRelations = [...usesResourceKeyRelationMap.values()].filter(
    (rel) => indexedFileIds.has(rel.from) && chunkIdSet.has(rel.to)
  );
  const validUsesSettingKeyRelations = [...usesSettingKeyRelationMap.values()].filter(
    (rel) => indexedFileIds.has(rel.from) && chunkIdSet.has(rel.to)
  );

  if (verbose && chunkRecords.length > 0) {
    console.log(`[ingest] extracted ${chunkRecords.length} chunks from ${fileRecords.filter(f => f.kind === "CODE").length} code files`);
    if (windowedChunkCount > 0) {
      console.log(
        `[ingest] overlap windows added=${windowedChunkCount} (window_lines=${chunkWindowLines}, overlap_lines=${chunkOverlapLines}, max_windows=${chunkMaxWindows})`
      );
    }
    console.log(`[ingest] ${validCallsRelations.length} call relations (${totalCallsRelations - validCallsRelations.length} filtered)`);
    if (validCallsSqlRelations.length > 0) {
      console.log(`[ingest] sql call links=${validCallsSqlRelations.length}`);
    }
    if (validUsesConfigKeyRelations.length > 0) {
      console.log(`[ingest] uses_config_key=${validUsesConfigKeyRelations.length}`);
    }
    if (validUsesResourceKeyRelations.length > 0 || validUsesSettingKeyRelations.length > 0) {
      console.log(
        `[ingest] uses_resource_key=${validUsesResourceKeyRelations.length} uses_setting_key=${validUsesSettingKeyRelations.length}`
      );
    }
  }

  // Generate Module entities and relations
  const moduleResult = generateModules(fileRecords, chunkRecords);
  const moduleRecords = moduleResult.modules;
  const moduleContainsRelations = moduleResult.containsRelations;
  const moduleContainsModuleRelations = moduleResult.containsModuleRelations;
  const moduleExportsRelations = moduleResult.exportsRelations;
  const projectResult = generateProjects(fileRecords);
  const projectRecords = projectResult.projects;
  const projectIncludesFileRelations = projectResult.includesFileRelations;
  const projectReferencesProjectRelations = projectResult.referencesProjectRelations;
  const namedResourceRelationResult = generateNamedResourceRelations(fileRecords);
  const usesResourceRelations = namedResourceRelationResult.usesResourceRelations;
  const usesSettingRelations = namedResourceRelationResult.usesSettingRelations;
  const configIncludeRelations = generateConfigIncludeRelations(fileRecords);
  const machineConfigRelations = generateMachineConfigRelations(fileRecords);
  const sectionHandlerRelations = generateSectionHandlerRelations(fileRecords);
  const usesConfigRelations = uniqueRelations([
    ...namedResourceRelationResult.usesConfigRelations,
    ...configIncludeRelations,
    ...machineConfigRelations,
    ...sectionHandlerRelations
  ]);
  const configTransformRelations = generateConfigTransformRelations(fileRecords);

  if (verbose && moduleRecords.length > 0) {
    console.log(`[ingest] modules=${moduleRecords.length} contains=${moduleContainsRelations.length} contains_module=${moduleContainsModuleRelations.length} exports=${moduleExportsRelations.length}`);
  }
  if (verbose && projectRecords.length > 0) {
    console.log(
      `[ingest] projects=${projectRecords.length} includes_file=${projectIncludesFileRelations.length} references_project=${projectReferencesProjectRelations.length}`
    );
  }
  if (
    verbose &&
    (
      usesResourceRelations.length > 0 ||
      usesSettingRelations.length > 0 ||
      usesConfigRelations.length > 0 ||
      configTransformRelations.length > 0
    )
  ) {
    console.log(
      `[ingest] uses_resource=${usesResourceRelations.length} uses_setting=${usesSettingRelations.length} uses_config=${usesConfigRelations.length} transforms_config=${configTransformRelations.length}`
    );
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
  writeJsonl(path.join(CACHE_DIR, "relations.defines.jsonl"), validDefinesRelations);
  writeJsonl(path.join(CACHE_DIR, "relations.calls.jsonl"), validCallsRelations);
  writeJsonl(path.join(CACHE_DIR, "relations.imports.jsonl"), validImportsRelations);
  writeJsonl(path.join(CACHE_DIR, "relations.calls_sql.jsonl"), validCallsSqlRelations);
  writeJsonl(path.join(CACHE_DIR, "relations.uses_config_key.jsonl"), validUsesConfigKeyRelations);
  writeJsonl(path.join(CACHE_DIR, "relations.uses_resource_key.jsonl"), validUsesResourceKeyRelations);
  writeJsonl(path.join(CACHE_DIR, "relations.uses_setting_key.jsonl"), validUsesSettingKeyRelations);
  writeJsonl(path.join(CACHE_DIR, "entities.module.jsonl"), moduleRecords);
  writeJsonl(path.join(CACHE_DIR, "relations.contains.jsonl"), moduleContainsRelations);
  writeJsonl(path.join(CACHE_DIR, "relations.contains_module.jsonl"), moduleContainsModuleRelations);
  writeJsonl(path.join(CACHE_DIR, "relations.exports.jsonl"), moduleExportsRelations);
  writeJsonl(path.join(CACHE_DIR, "entities.project.jsonl"), projectRecords);
  writeJsonl(path.join(CACHE_DIR, "relations.includes_file.jsonl"), projectIncludesFileRelations);
  writeJsonl(path.join(CACHE_DIR, "relations.uses_resource.jsonl"), usesResourceRelations);
  writeJsonl(path.join(CACHE_DIR, "relations.uses_setting.jsonl"), usesSettingRelations);
  writeJsonl(path.join(CACHE_DIR, "relations.uses_config.jsonl"), usesConfigRelations);
  writeJsonl(path.join(CACHE_DIR, "relations.transforms_config.jsonl"), configTransformRelations);
  writeJsonl(
    path.join(CACHE_DIR, "relations.references_project.jsonl"),
    projectReferencesProjectRelations
  );

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
    validDefinesRelations.map((record) => [record.from, record.to])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "calls_rel.tsv"),
    ["from", "to", "call_type"],
    validCallsRelations.map((record) => [record.from, record.to, record.call_type])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "imports_rel.tsv"),
    ["from", "to", "import_name"],
    validImportsRelations.map((record) => [record.from, record.to, record.import_name])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "calls_sql_rel.tsv"),
    ["from", "to", "note"],
    validCallsSqlRelations.map((record) => [record.from, record.to, record.note])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "uses_config_key_rel.tsv"),
    ["from", "to", "note"],
    validUsesConfigKeyRelations.map((record) => [record.from, record.to, record.note])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "uses_resource_key_rel.tsv"),
    ["from", "to", "note"],
    validUsesResourceKeyRelations.map((record) => [record.from, record.to, record.note])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "uses_setting_key_rel.tsv"),
    ["from", "to", "note"],
    validUsesSettingKeyRelations.map((record) => [record.from, record.to, record.note])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "project_nodes.tsv"),
    [
      "id",
      "path",
      "name",
      "kind",
      "language",
      "target_framework",
      "summary",
      "file_count",
      "updated_at",
      "source_of_truth",
      "trust_level",
      "status"
    ],
    projectRecords.map((record) => [
      record.id,
      record.path,
      record.name,
      record.kind,
      record.language,
      record.target_framework,
      record.summary,
      record.file_count,
      record.updated_at,
      record.source_of_truth,
      record.trust_level,
      record.status
    ])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "includes_file_rel.tsv"),
    ["from", "to"],
    projectIncludesFileRelations.map((record) => [record.from, record.to])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "references_project_rel.tsv"),
    ["from", "to", "note"],
    projectReferencesProjectRelations.map((record) => [record.from, record.to, record.note])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "uses_resource_rel.tsv"),
    ["from", "to", "note"],
    usesResourceRelations.map((record) => [record.from, record.to, record.note])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "uses_setting_rel.tsv"),
    ["from", "to", "note"],
    usesSettingRelations.map((record) => [record.from, record.to, record.note])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "uses_config_rel.tsv"),
    ["from", "to", "note"],
    usesConfigRelations.map((record) => [record.from, record.to, record.note])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "transforms_config_rel.tsv"),
    ["from", "to", "note"],
    configTransformRelations.map((record) => [record.from, record.to, record.note])
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
      relations_defines: validDefinesRelations.length,
      relations_calls: validCallsRelations.length,
      relations_imports: validImportsRelations.length,
      relations_calls_sql: validCallsSqlRelations.length,
      relations_uses_config_key: validUsesConfigKeyRelations.length,
      relations_uses_resource_key: validUsesResourceKeyRelations.length,
      relations_uses_setting_key: validUsesSettingKeyRelations.length,
      modules: moduleRecords.length,
      relations_contains: moduleContainsRelations.length,
      relations_contains_module: moduleContainsModuleRelations.length,
      relations_exports: moduleExportsRelations.length,
      projects: projectRecords.length,
      relations_includes_file: projectIncludesFileRelations.length,
      relations_references_project: projectReferencesProjectRelations.length,
      relations_uses_resource: usesResourceRelations.length,
      relations_uses_setting: usesSettingRelations.length,
      relations_uses_config: usesConfigRelations.length,
      relations_transforms_config: configTransformRelations.length
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
    `[ingest] rels defines=${manifest.counts.relations_defines} calls=${manifest.counts.relations_calls} imports=${manifest.counts.relations_imports} calls_sql=${manifest.counts.relations_calls_sql} uses_config_key=${manifest.counts.relations_uses_config_key} uses_resource_key=${manifest.counts.relations_uses_resource_key} uses_setting_key=${manifest.counts.relations_uses_setting_key}`
  );
  console.log(
    `[ingest] rels contains=${manifest.counts.relations_contains} contains_module=${manifest.counts.relations_contains_module} exports=${manifest.counts.relations_exports} includes_file=${manifest.counts.relations_includes_file} references_project=${manifest.counts.relations_references_project} uses_resource=${manifest.counts.relations_uses_resource} uses_setting=${manifest.counts.relations_uses_setting} uses_config=${manifest.counts.relations_uses_config} transforms_config=${manifest.counts.relations_transforms_config}`
  );
  console.log(
    `[ingest] skipped unsupported=${skipped.unsupported} too_large=${skipped.tooLarge} binary=${skipped.binary}`
  );
  console.log(`[ingest] wrote cache + db import files under .context/`);
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMainModule) {
  main();
}

export {
  buildSqlResourceReferenceMap,
  detectKind,
  extractSqlObjectReferencesFromContent,
  generateChunkDescription,
  generateConfigIncludeRelations,
  generateConfigTransformKeyRelations,
  generateMachineConfigRelations,
  generateConfigTransformRelations,
  generateModuleSummary,
  generateModules,
  generateNamedResourceRelations,
  generateProjects,
  generateSectionHandlerRelations,
  getChunkParserForExtension,
  resolveRelativeImportTargetId
};
