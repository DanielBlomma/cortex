/**
 * Shared I/O, CLI and process helpers for the bootstrapbench harness.
 * Mirrors the conventions used elsewhere in benchmark/ (flag parsing,
 * usage errors, promise-based child processes).
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";

export function usageError(message) {
  const error = new Error(message);
  error.isUsageError = true;
  return error;
}

export function hasFlag(args, flag) {
  return args.includes(flag);
}

export function parseFlag(args, flag, fallback = null) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return fallback;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw usageError(`Flag ${flag} expects a value`);
  }
  return value;
}

export function ensureDir(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

export function loadJson(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`Cannot read JSON file ${filePath}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

export function loadJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return loadJson(filePath);
}

export function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  // Write-then-rename so readers never observe a truncated document, even if
  // the process is killed mid-write (e.g. container timeout).
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

/** True for https:// URLs only — the sole transport the harness accepts. */
export function isHttpsUrl(value) {
  if (typeof value !== "string") {
    return false;
  }
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Streams a JSONL file line by line, yielding the result of mapLine for each
 * non-empty line. mapLine receives the raw line and may JSON.parse it or use a
 * cheaper extraction; returning undefined skips the line. Lines that fail to
 * parse are counted and reported via the onError callback instead of aborting.
 */
export async function streamJsonl(filePath, mapLine, { onError } = {}) {
  const results = [];
  if (!fs.existsSync(filePath)) {
    return results;
  }
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const mapped = mapLine(trimmed);
      if (mapped !== undefined) {
        results.push(mapped);
      }
    } catch (error) {
      if (onError) {
        onError({ file: filePath, line: lineNumber, error });
      }
    }
  }
  return results;
}

/**
 * Spawns a child process and resolves with `{ ok, code, stdout, stderr }`.
 * Never rejects for non-zero exits; rejects only on spawn failures unless
 * `onLine` throws. An optional timeout kills the process group.
 */
export function runCommand({ command, args = [], cwd, env, timeoutMs = null, onLine = null }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timer = null;

    if (timeoutMs && Number.isFinite(timeoutMs)) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
    }

    const handleChunk = (target) => (chunk) => {
      const text = chunk.toString();
      if (target === "stdout") {
        stdout += text;
      } else {
        stderr += text;
      }
      if (onLine) {
        for (const line of text.split("\n")) {
          if (line.length > 0) {
            onLine(line, target);
          }
        }
      }
    };

    child.stdout.on("data", handleChunk("stdout"));
    child.stderr.on("data", handleChunk("stderr"));

    child.on("error", (error) => {
      if (timer) {
        clearTimeout(timer);
      }
      resolve({ ok: false, code: null, stdout, stderr, error: error.message, timedOut });
    });

    child.on("close", (code) => {
      if (timer) {
        clearTimeout(timer);
      }
      resolve({ ok: code === 0 && !timedOut, code, stdout, stderr, timedOut });
    });
  });
}

export function nowIso() {
  return new Date().toISOString();
}

/** owner/name -> filesystem- and URL-safe key, stable across platforms. */
export function repoKey(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "__")
    .replace(/^_+|_+$/g, "");
}

/** Embedding model id -> short slug usable in directory names. */
export function modelSlug(modelId) {
  return String(modelId)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Minimal YAML list extraction for `source_paths:` blocks in config.yaml.
 * Matches the parser ingest.mjs uses; avoids a YAML dependency.
 */
export function parseSourcePathsFromYaml(yamlText) {
  const sourcePaths = [];
  let inBlock = false;
  for (const rawLine of String(yamlText).split("\n")) {
    const line = rawLine.trimEnd();
    if (!inBlock && /^source_paths:\s*$/.test(line.trim())) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      const match = line.match(/^\s+-\s+(.*)$/);
      if (!match) {
        break;
      }
      const value = match[1].trim().replace(/^['"]|['"]$/g, "");
      if (value) {
        sourcePaths.push(value);
      }
    }
  }
  return sourcePaths;
}

/**
 * Parses `npm view <pkg>@<spec> version --json` output into one exact
 * version: a JSON string for exact specs, a JSON array for ranges (newest
 * entry wins, npm returns them sorted ascending), or bare text from older
 * npm versions. Returns null when the output names no version.
 */
export function parseNpmViewVersion(stdout) {
  const raw = String(stdout ?? "").trim();
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string" && parsed.trim()) {
      return parsed.trim();
    }
    if (Array.isArray(parsed) && parsed.length > 0) {
      const last = parsed[parsed.length - 1];
      return typeof last === "string" && last.trim() ? last.trim() : null;
    }
    return null;
  } catch {
    return /^[0-9a-zA-Z][0-9a-zA-Z._-]*$/.test(raw) ? raw : null;
  }
}
