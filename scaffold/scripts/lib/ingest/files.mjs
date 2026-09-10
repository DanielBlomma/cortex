import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  CODE_FILE_EXTENSIONS,
  CPP_IMPORT_RESOLUTION_EXTENSIONS,
  IMPORT_RESOLUTION_EXTENSIONS,
  IMPORT_RUNTIME_JS_EXTENSIONS,
  IMPORT_RUNTIME_JS_RESOLUTION_EXTENSIONS,
  LEGACY_DOTNET_METADATA_EXTENSIONS,
  SKIP_DIRECTORIES,
  STOP_WORDS,
  SUPPORTED_TEXT_EXTENSIONS
} from "./constants.mjs";

export function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

export function isTextFile(relPath) {
  const ext = path.extname(relPath).toLowerCase();
  const base = path.basename(relPath).toLowerCase();
  if (SUPPORTED_TEXT_EXTENSIONS.has(ext)) {
    return true;
  }

  return base === "readme" || base.startsWith("readme.");
}

export function isBinaryBuffer(buffer) {
  const scanLength = Math.min(buffer.length, 4000);
  for (let index = 0; index < scanLength; index += 1) {
    if (buffer[index] === 0) {
      return true;
    }
  }

  return false;
}

export function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

export function normalizeToken(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function tokenizeKeywords(value) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

export function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

export function walkDirectory(boundary, directoryIdentity, files, isIgnored = () => false) {
  const { entries } = boundary.readRepositoryDirectory(directoryIdentity, "discovery");
  for (const entry of entries) {
    const identity = boundary.childIdentity(directoryIdentity, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (isIgnored(identity)) continue;
    if (entry.isDirectory() && shouldSkipDirectory(identity, entry.name)) {
      continue;
    }

    if (entry.isDirectory()) {
      boundary.inspectRepositoryPath(identity, { phase: "discovery", expected: "directory" });
      walkDirectory(boundary, identity, files, isIgnored);
      continue;
    }

    if (entry.isFile()) {
      boundary.inspectRepositoryPath(identity, { phase: "discovery", expected: "file" });
      files.add(identity);
    }
  }
}

export function shouldSkipDirectory(identity, entryName) {
  if (entryName === "bin" && !normalizeRelativePath(identity).includes("/")) {
    return false;
  }
  return SKIP_DIRECTORIES.has(entryName);
}

export function normalizeSourcePrefix(sourcePath) {
  const source = toPosixPath(sourcePath)
    .split("/")
    .filter((part) => part !== "" && part !== ".")
    .join("/");
  return source;
}

export function normalizeRelativePath(relPath) {
  return toPosixPath(relPath)
    .split("/")
    .filter((part) => part !== "" && part !== ".")
    .join("/");
}

export function hasSkippedDirectorySegment(relPath) {
  const parts = normalizeRelativePath(relPath).split("/").filter(Boolean);
  return parts.some((part, index) => {
    if (part === "bin" && index === 0) {
      return false;
    }
    return SKIP_DIRECTORIES.has(part);
  });
}

export function hasSourcePrefix(relPath, sourcePaths) {
  const normalizedRelPath = normalizeRelativePath(relPath);
  if (!normalizedRelPath || hasSkippedDirectorySegment(normalizedRelPath)) {
    return false;
  }
  return sourcePaths.some((sourcePath) => {
    const source = normalizeSourcePrefix(sourcePath);
    return source === "" || normalizedRelPath === source || normalizedRelPath.startsWith(`${source}/`);
  });
}

export function pushImportResolutionCandidate(candidates, seenCandidates, candidatePath) {
  if (!seenCandidates.has(candidatePath)) {
    seenCandidates.add(candidatePath);
    candidates.push(candidatePath);
  }
}

export function isCppLikeFilePath(filePath) {
  return [".c", ".h", ".cc", ".cpp", ".hh", ".hpp"].includes(path.posix.extname(filePath).toLowerCase());
}

export function resolveRelativeImportTargetId(filePath, importPath, indexedFileIds) {
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

export function parseGitStatusPorcelain(output, boundary, prefix = "") {
  const changed = new Set();
  const deleted = new Set();
  const records = output.split("\0");
  if (output && !output.endsWith("\0")) throw gitDiscoveryError("malformed_output");
  const relativePath = (value) => {
    if (prefix && !validGitPath(value)) throw gitDiscoveryError("malformed_output");
    if (!value.startsWith(prefix)) return null;
    return value.slice(prefix.length);
  };
  const inspect = (value) => {
    const relative = relativePath(value);
    return relative === null ? null : boundary.inspectRepositoryPath(relative, {
      phase: "discovery", allowMissing: true, expected: "any"
    }).identity;
  };

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) {
      if (index === records.length - 1) continue;
      throw gitDiscoveryError("malformed_output");
    }
    if (record.length < 4 || record[2] !== " " || !/^[ MADRCUT?!]{2}$/.test(record.slice(0, 2)) || record.startsWith("  ")) {
      boundary.inspectRepositoryPath("", { phase: "discovery" });
    }
    const status = record.slice(0, 2);
    const first = inspect(record.slice(3));
    const isRename = status.includes("R") || status.includes("C");
    if (isRename) {
      const secondPath = records[index + 1];
      if (typeof secondPath !== "string" || secondPath.length === 0) {
        boundary.inspectRepositoryPath("", { phase: "discovery" });
      }
      index += 1;
      const second = inspect(secondPath);
      if (first !== null) changed.add(first);
      if (second !== null && status.includes("R")) deleted.add(second);
      continue;
    }

    if (first === null) continue;
    if (status.includes("D")) deleted.add(first);
    else changed.add(first);
  }
  return { changed: [...changed], deleted: [...deleted] };
}

function gitDiscoveryError(reason) {
  const error = new Error(`Git source discovery failed (${reason}); previous index was not replaced.`);
  error.code = "CORTEX_GIT_DISCOVERY";
  error.reason = reason;
  return error;
}

function runDiscoveryGit(boundary, args) {
  const assertAnchor = () => boundary.assertProjectAnchor({
      code: "CORTEX_FS_SOURCE",
      phase: "discovery",
      subject_kind: "repository_path",
      subject: ".",
      reason: "path_replaced"
    });
  // Ambient Git repository/index/config overrides must not redirect discovery.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  Object.assign(env, { LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" });
  assertAnchor();
  const result = spawnSync("git", ["-c", "core.fsmonitor=false", ...args], {
    cwd: boundary.root,
    stdio: ["ignore", "pipe", "pipe"],
    env,
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
    killSignal: "SIGKILL"
  });
  assertAnchor();
  if (result.error || result.signal) {
    const reason = result.error?.code === "ETIMEDOUT" ? "timeout"
      : result.error?.code === "ENOBUFS" ? "output_limit" : "process_failure";
    throw gitDiscoveryError(reason);
  }
  return result;
}

function gitOutput(result) {
  if (result.status !== 0) throw gitDiscoveryError("command_failure");
  try {
    // Git emits path bytes, so a leading BOM is part of the filename.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(result.stdout);
  } catch {
    throw gitDiscoveryError("malformed_output");
  }
}

function gitPrefix(boundary) {
  const result = runDiscoveryGit(boundary, ["rev-parse", "--show-prefix", "--is-inside-work-tree"]);
  if (result.status === 128 && /^fatal: not a git repository(?: \(or any of the parent directories\))?:/m.test(String(result.stderr))) {
    // A broken repository marker is a failure, not permission to ignore Git policy.
    for (let directory = boundary.root; ; directory = path.dirname(directory)) {
      try {
        fs.lstatSync(path.join(directory, ".git"));
        throw gitDiscoveryError("command_failure");
      } catch (error) {
        if (error.code !== "ENOENT") throw gitDiscoveryError("command_failure");
      }
      if (directory === path.dirname(directory)) return null;
    }
  }
  const output = gitOutput(result);
  if (!output.endsWith("\ntrue\n")) throw gitDiscoveryError("malformed_output");
  const prefix = output.slice(0, -6);
  if (prefix && (!prefix.endsWith("/") || !validGitPath(prefix.slice(0, -1)))) {
    throw gitDiscoveryError("malformed_output");
  }
  return prefix;
}

function validGitPath(identity) {
  return identity.length > 0 && !path.isAbsolute(identity) && !identity.includes("\0") &&
    !(process.platform === "win32" && (identity.includes("\\") || /^[A-Za-z]:/.test(identity))) &&
    identity.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

export function getGitChanges(boundary, prefix = gitPrefix(boundary)) {
  if (prefix === null) return { changed: [], deleted: [] };
  const output = gitOutput(runDiscoveryGit(boundary, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]));
  return parseGitStatusPorcelain(output, boundary, prefix);
}

function collectGitIgnoredPaths(boundary, prefix) {
  const ignored = new Set();
  if (prefix === null) return ignored;
  const output = gitOutput(runDiscoveryGit(boundary, [
    "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z", "--", "."
  ]));
  if (output && !output.endsWith("\0")) throw gitDiscoveryError("malformed_output");
  for (const record of output ? output.slice(0, -1).split("\0") : []) {
    const identity = record.endsWith("/") ? record.slice(0, -1) : record;
    if (!validGitPath(identity)) throw gitDiscoveryError("malformed_output");
    ignored.add(identity);
    // Git can precompose Unicode names on macOS. Keep both Git's spelling
    // (which may be in retained cache records) and the physical spelling
    // without changing Git's tracked-file or ignore-rule interpretation.
    const inspected = boundary.inspectRepositoryPath(identity, {
      phase: "discovery", allowMissing: true, allowFinalSymlink: true, expected: "any"
    });
    if (!inspected.exists || inspected.kind === "symlink") continue;
    let physicalPath;
    try {
      physicalPath = fs.realpathSync.native(inspected.absolutePath);
    } catch {
      throw gitDiscoveryError("path_replaced");
    }
    const physicalIdentity = path.relative(boundary.root, physicalPath).split(path.sep).join("/");
    ignored.add(boundary.inspectRepositoryPath(physicalIdentity, {
      phase: "discovery", expected: inspected.kind
    }).identity);
  }
  return ignored;
}

export function collectCandidateFiles(boundary, sourcePaths, sourceRecords, mode) {
  const candidates = new Set();
  const deletedRelPaths = new Set();
  const rootScope = sourceRecords.some((source) => source.normalized === "");
  const prefix = rootScope || mode === "changed" ? gitPrefix(boundary) : null;
  const ignored = rootScope || mode === "changed" ? collectGitIgnoredPaths(boundary, prefix) : new Set();
  const explicitSources = sourcePaths.filter((source) => normalizeSourcePrefix(source) !== "");
  const matchesIgnored = (identity) => {
    for (let end = identity.length; end > 0; end = identity.lastIndexOf("/", end - 1)) {
      if (ignored.has(identity.slice(0, end))) return true;
    }
    return false;
  };
  const isIgnored = (identity) => rootScope && matchesIgnored(identity) &&
    !(explicitSources.length > 0 && hasSourcePrefix(identity, explicitSources));

  if (mode === "changed") {
    const gitChanges = getGitChanges(boundary, prefix);
    if (gitChanges.changed.length > 0 || gitChanges.deleted.length > 0) {
      for (const identity of gitChanges.changed) {
        const inspected = boundary.inspectRepositoryPath(identity, {
          phase: "discovery",
          allowMissing: true,
          expected: "any"
        });
        if (!inspected.exists) continue;
        if (inspected.kind === "file") {
          if (hasSourcePrefix(inspected.identity, sourcePaths) && !isIgnored(inspected.identity)) {
            candidates.add(inspected.identity);
          }
          continue;
        }

        if (inspected.kind === "directory") {
          const nestedFiles = new Set();
          walkDirectory(boundary, inspected.identity, nestedFiles, isIgnored);
          for (const nestedIdentity of nestedFiles) {
            if (hasSourcePrefix(nestedIdentity, sourcePaths)) {
              candidates.add(nestedIdentity);
            }
          }
        }
      }

      for (const identity of gitChanges.deleted) {
        const inspected = boundary.inspectRepositoryPath(identity, {
          phase: "discovery",
          allowMissing: true,
          expected: "any"
        });
        if (hasSourcePrefix(inspected.identity, sourcePaths)) {
          deletedRelPaths.add(inspected.identity);
        }
      }

      // Git status omits ignored files even when explicitly selected by the caller.
      const explicitIgnored = new Set([...ignored].filter((identity) => hasSourcePrefix(identity, explicitSources)));
      for (const source of sourceRecords) {
        if (source.normalized && matchesIgnored(source.identity) && hasSourcePrefix(source.identity, explicitSources)) {
          explicitIgnored.add(source.identity);
        }
      }
      for (const identity of explicitIgnored) {
        const inspected = boundary.inspectRepositoryPath(identity, {
          phase: "discovery", allowMissing: true, allowFinalSymlink: true, expected: "any"
        });
        if (inspected.kind === "file") candidates.add(inspected.identity);
        else if (inspected.kind === "directory") walkDirectory(boundary, inspected.identity, candidates);
      }

      return {
        candidates,
        isIgnored,
        incrementalMode: true,
        deletedRelPaths: [...deletedRelPaths]
      };
    }
  }

  for (const source of sourceRecords) {
    if (hasSkippedDirectorySegment(source.normalized)) {
      continue;
    }
    if (!source.exists) continue;
    if (source.kind === "file") {
      candidates.add(source.identity);
      continue;
    }

    if (source.kind === "directory") {
      walkDirectory(boundary, source.identity, candidates, source.normalized === "" ? isIgnored : undefined);
    }
  }

  return {
    candidates,
    isIgnored,
    incrementalMode: false,
    deletedRelPaths: []
  };
}

export function detectKind(relPath) {
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

export function trustLevelForKind(kind) {
  if (kind === "ADR") return 95;
  if (kind === "CODE") return 80;
  return 70;
}

export function checksum(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

export function extractTitle(content, fallbackTitle) {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^#\s+(.+)\s*$/);
    if (match) return match[1].trim();
  }

  return fallbackTitle;
}

export function parseDecisionDate(content, fallbackDate) {
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

export function adrTokens(adrRecord) {
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

export function findSupersedesReferences(content) {
  const refs = new Set();
  const pattern = /(?:supersedes|ersätter)\s*[:\-]?\s*([A-Za-z0-9._/-]+)/gi;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    refs.add(match[1]);
  }

  return [...refs];
}
