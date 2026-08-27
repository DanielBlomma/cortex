#!/usr/bin/env node
/**
 * Conditional VB.NET parser bridge for Cortex.
 *
 * Uses a Roslyn sidecar via a pre-published DLL when a .NET SDK is available.
 * On first use the sidecar is published to bin/Release/<tfm>/publish/ and the
 * DLL path is cached; subsequent invocations skip the msbuild cycle and run
 * `dotnet <dll>` directly — roughly 10× faster per call than `dotnet run`.
 *
 * If no runtime/SDK exists, callers should skip structured chunk extraction
 * and fall back to plain file-level indexing.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  DIALECT_LIMITS,
  canonicalDialectLanguageSpecificShape,
  canonicalDialectNormalizedShape,
  canonicalRepositoryPath,
  canonicalizeDialectObservations,
  createDialectObservationTransport,
  dialectFamilyForMode,
  exactKeys,
  stableDialectObservationId
} from "../lib/dialect-observation-contract.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DOTNET_COMMAND = "dotnet";
const DEFAULT_PROJECT_PATH = path.join(__dirname, "dotnet", "VbNetParser", "VbNetParser.csproj");
const DEFAULT_TARGET_FRAMEWORK = "net8.0";

let runtimeCache = null;
let publishCache = null;

function getDotnetCommand() {
  const override = process.env.CORTEX_DOTNET_CMD;
  return override && override.trim().length > 0 ? override.trim() : DEFAULT_DOTNET_COMMAND;
}

function getProjectPath() {
  const override = process.env.CORTEX_VBNET_PARSER_PROJECT;
  return override && override.trim().length > 0 ? override.trim() : DEFAULT_PROJECT_PATH;
}

function getTargetFramework() {
  const override = process.env.CORTEX_VBNET_PARSER_TFM;
  return override && override.trim().length > 0 ? override.trim() : DEFAULT_TARGET_FRAMEWORK;
}

function getPublishDir() {
  const override = process.env.CORTEX_VBNET_PUBLISH_DIR;
  if (override && override.trim().length > 0) return override.trim();
  const projectDir = path.dirname(getProjectPath());
  return path.join(projectDir, "bin", "Release", getTargetFramework(), "publish");
}

function getDllPath() {
  return path.join(getPublishDir(), "VbNetParser.dll");
}

function getMaxSourceMtime() {
  const projectDir = path.dirname(getProjectPath());
  const sources = [getProjectPath(), path.join(projectDir, "Program.cs")];
  let max = 0;
  for (const src of sources) {
    try {
      const mtime = fs.statSync(src).mtimeMs;
      if (mtime > max) max = mtime;
    } catch {
      // missing source — treated as stale below
    }
  }
  return max;
}

function needsPublish() {
  const dll = getDllPath();
  let dllMtime;
  try {
    dllMtime = fs.statSync(dll).mtimeMs;
  } catch {
    return true;
  }
  return getMaxSourceMtime() > dllMtime;
}

export function resetVbNetParserRuntimeCache() {
  runtimeCache = null;
  publishCache = null;
}

export function getVbNetParserRuntime() {
  if (runtimeCache) {
    return runtimeCache;
  }

  const command = getDotnetCommand();
  const versionProbe = spawnSync(command, ["--version"], {
    encoding: "utf8",
    timeout: 5000
  });

  if (versionProbe.error || versionProbe.status !== 0) {
    runtimeCache = {
      available: false,
      command,
      projectPath: getProjectPath(),
      reason:
        versionProbe.error?.message ||
        versionProbe.stderr?.trim() ||
        "dotnet runtime not available"
    };
    return runtimeCache;
  }

  runtimeCache = {
    available: true,
    command,
    projectPath: getProjectPath(),
    version: versionProbe.stdout.trim()
  };
  return runtimeCache;
}

export function isVbNetParserAvailable() {
  return getVbNetParserRuntime().available;
}

export function ensureVbNetParserPublished() {
  if (publishCache) return publishCache;

  const runtime = getVbNetParserRuntime();
  if (!runtime.available) {
    publishCache = { ok: false, reason: runtime.reason };
    return publishCache;
  }

  const dllPath = getDllPath();
  if (!needsPublish()) {
    publishCache = { ok: true, dllPath };
    return publishCache;
  }

  if (!process.env.CORTEX_QUIET) {
    process.stderr.write("[cortex] Publishing Roslyn VB.NET parser (one-time, ~15s)...\n");
  }

  const result = spawnSync(
    runtime.command,
    [
      "publish",
      runtime.projectPath,
      "-c", "Release",
      "-o", getPublishDir(),
      "--nologo",
      "-v", "quiet",
      "/p:UseAppHost=false"
    ],
    { encoding: "utf8", timeout: 180000 }
  );

  if (result.error || result.status !== 0) {
    publishCache = {
      ok: false,
      reason:
        result.error?.message ||
        result.stderr?.trim() ||
        `dotnet publish failed with exit code ${result.status ?? "unknown"}`
    };
    return publishCache;
  }

  publishCache = { ok: true, dllPath };
  return publishCache;
}

export function parseCode(code, filePath, language = "vbnet") {
  return runVbNetParser(code, filePath, language).parserResult;
}

export function parseCodeWithDialectObservations(code, repositoryPath, language = "vbnet") {
  const metadata = prepareDialectInput(code, repositoryPath, language);
  const run = runVbNetParser(code, repositoryPath, language, true, !metadata.oversized);
  if (metadata.oversized) {
    return createRoslynTransport(
      run.parserResult,
      statusEnvelope("oversized", "source exceeds dialect observation byte cap")
    );
  }
  if (!run.parsed) {
    return createRoslynTransport(
      run.parserResult,
      statusEnvelope("unavailable", run.observationFailure)
    );
  }

  let dialectPayload;
  try {
    dialectPayload = validateRoslynPayload(run.parsed);
  } catch {
    return createRoslynTransport(
      run.parserResult,
      statusEnvelope("unavailable", "Roslyn parser returned invalid dialect observation data")
    );
  }

  if (run.parserResult.errors.length > 0) {
    return createRoslynTransport(
      run.parserResult,
      statusEnvelope("malformed", "native parser reported syntax errors")
    );
  }

  try {
    return createRoslynTransport(
      run.parserResult,
      roslynObservationEnvelope(code, repositoryPath, metadata, dialectPayload)
    );
  } catch {
    return createRoslynTransport(
      run.parserResult,
      statusEnvelope("unavailable", "Roslyn parser returned invalid dialect observation data")
    );
  }
}

function runVbNetParser(code, filePath, language, boundedFailures = false, includeDialect = false) {
  const runtime = getVbNetParserRuntime();
  if (!runtime.available) {
    return {
      parserResult: { chunks: [], errors: [] },
      parsed: null,
      observationFailure: "selected Roslyn backend is unavailable"
    };
  }

  const published = ensureVbNetParserPublished();
  if (!published.ok) {
    return {
      parserResult: {
        chunks: [],
        errors: [{ message: parserFailureMessage(`VB.NET parser publish failed: ${published.reason}`, boundedFailures) }]
      },
      parsed: null,
      observationFailure: "Roslyn parser publish failed"
    };
  }

  const args = [
    published.dllPath,
    "--stdin",
    "--file",
    filePath,
    "--language",
    language
  ];
  if (includeDialect) args.push("--dialect");

  const result = spawnSync(runtime.command, args, {
    input: code,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024
  });

  if (result.error || result.status !== 0) {
    return {
      parserResult: {
        chunks: [],
        errors: [
          {
            message: parserFailureMessage(
              result.error?.message ||
              result.stderr?.trim() ||
              `VB.NET parser failed with exit code ${result.status ?? "unknown"}`,
              boundedFailures
            )
          }
        ]
      },
      parsed: null,
      observationFailure: "Roslyn parser subprocess failed"
    };
  }

  try {
    const parsed = JSON.parse(result.stdout);
    const parserResult = boundedSuccessfulParserResult({
      chunks: Array.isArray(parsed.chunks) ? parsed.chunks : [],
      errors: Array.isArray(parsed.errors) ? parsed.errors : []
    }, boundedFailures);
    return {
      parserResult,
      parsed,
      observationFailure: null
    };
  } catch (error) {
    return {
      parserResult: {
        chunks: [],
        errors: [
          {
            message: parserFailureMessage(
              `VB.NET parser returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
              boundedFailures
            )
          }
        ]
      },
      parsed: null,
      observationFailure: "Roslyn parser returned invalid JSON"
    };
  }
}

function parserFailureMessage(message, bounded) {
  if (!bounded) return message;
  return [...String(message)].slice(0, DIALECT_LIMITS.max_diagnostic_chars).join("");
}

function boundedSuccessfulParserResult(parserResult, bounded) {
  if (!bounded) return parserResult;
  return {
    chunks: parserResult.chunks,
    errors: parserResult.errors.map((error) => {
      if (!error || typeof error !== "object" || Array.isArray(error) ||
          typeof error.message !== "string") return error;
      return { ...error, message: parserFailureMessage(error.message, true) };
    })
  };
}

function createRoslynTransport(parserResult, envelope) {
  try {
    return createDialectObservationTransport(parserResult, envelope);
  } catch {
    return createDialectObservationTransport(
      { chunks: [], errors: [{ message: "Roslyn parser result exceeded composite transport contract" }] },
      statusEnvelope("unavailable", "Roslyn parser returned invalid composite transport data")
    );
  }
}

function prepareDialectInput(code, repositoryPath, language) {
  if (typeof code !== "string") throw new TypeError("Dialect adapter: code must be a string");
  canonicalRepositoryPath(repositoryPath);
  if (typeof language !== "string") throw new TypeError("Dialect adapter: language must be a string");
  const separator = repositoryPath.lastIndexOf("/");
  const dot = repositoryPath.lastIndexOf(".");
  const syntaxMode = dot > separator ? repositoryPath.slice(dot) : "";
  const family = dialectFamilyForMode(syntaxMode);
  const mode = family?.modes.find((entry) => entry.extension === syntaxMode);
  if (!family || family.family !== "vbnet" || mode?.registry_language !== language) {
    throw new TypeError(`Dialect adapter: unsupported parser mode ${language}/${syntaxMode || "<none>"}`);
  }
  return {
    family: family.family,
    syntaxMode,
    parserBackend: "roslyn",
    oversized: Buffer.byteLength(code) > DIALECT_LIMITS.max_source_bytes
  };
}

function validateRoslynPayload(parsed) {
  exactKeys(parsed, ["chunks", "dialect", "errors"], "Roslyn parser response");
  if (!Array.isArray(parsed.chunks) || !Array.isArray(parsed.errors)) {
    throw new TypeError("Roslyn parser response arrays are invalid");
  }
  exactKeys(parsed.dialect, ["candidates", "observedCount"], "Roslyn dialect payload");
  if (!Array.isArray(parsed.dialect.candidates) ||
      !Number.isSafeInteger(parsed.dialect.observedCount) ||
      parsed.dialect.observedCount < 0 ||
      parsed.dialect.observedCount > DIALECT_LIMITS.max_omission_count ||
      parsed.dialect.candidates.length > DIALECT_LIMITS.max_observations_per_file + 1 ||
      parsed.dialect.candidates.length > parsed.dialect.observedCount) {
    throw new TypeError("Roslyn dialect payload is invalid");
  }
  if (parsed.dialect.observedCount <= DIALECT_LIMITS.max_observations_per_file &&
      parsed.dialect.candidates.length !== parsed.dialect.observedCount) {
    throw new TypeError("Roslyn dialect payload is incomplete");
  }
  for (const candidate of parsed.dialect.candidates) {
    exactKeys(candidate, [
      "category", "endOffset", "form", "kind", "ordinal", "startOffset", "syntaxKind"
    ], "Roslyn dialect candidate");
    if (!Number.isSafeInteger(candidate.startOffset) ||
        !Number.isSafeInteger(candidate.endOffset) ||
        candidate.startOffset < 0 || candidate.endOffset <= candidate.startOffset ||
        typeof candidate.category !== "string" || typeof candidate.kind !== "string" ||
        typeof candidate.form !== "string" || typeof candidate.syntaxKind !== "string" ||
        (candidate.ordinal !== null &&
          (!Number.isSafeInteger(candidate.ordinal) || candidate.ordinal < 0))) {
      throw new TypeError("Roslyn dialect candidate is invalid");
    }
  }
  return parsed.dialect;
}

function roslynObservationEnvelope(code, repositoryPath, metadata, dialectPayload) {
  if (dialectPayload.observedCount > DIALECT_LIMITS.max_observations_per_file) {
    return statusEnvelope(
      "truncated",
      "dialect observation file cap exceeded",
      dialectPayload.observedCount,
      dialectPayload.observedCount
    );
  }
  const lineStarts = sourceLineStarts(code);
  const observations = dialectPayload.candidates.map((candidate) => {
    if (candidate.endOffset > code.length) {
      throw new TypeError("Roslyn dialect candidate span exceeds source");
    }
    const start = sourcePosition(lineStarts, candidate.startOffset);
    const end = sourcePosition(lineStarts, candidate.endOffset - 1);
    const observation = {
      schema_version: 1,
      family: metadata.family,
      syntax_mode: metadata.syntaxMode,
      parser_backend: metadata.parserBackend,
      repository_path: repositoryPath,
      containing_chunk_id: null,
      start_line: start.line,
      start_column: start.column,
      end_line: end.line,
      end_column: end.column,
      category: candidate.category,
      normalized_shape: canonicalDialectNormalizedShape(candidate.category, candidate.kind),
      language_specific_shape: canonicalDialectLanguageSpecificShape(
        candidate.form,
        candidate.syntaxKind
      ),
      ordinal: candidate.ordinal,
      observation_id: ""
    };
    observation.observation_id = stableDialectObservationId(observation);
    return observation;
  });
  return statusEnvelope("ok", null, observations.length, 0, observations);
}

function sourceLineStarts(code) {
  const starts = [0];
  for (let index = 0; index < code.length; index += 1) {
    if (code.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function sourcePosition(lineStarts, offset) {
  let low = 0;
  let high = lineStarts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle] <= offset) low = middle;
    else high = middle;
  }
  return { line: low + 1, column: offset - lineStarts[low] };
}

function statusEnvelope(status, message, observedCount = 0, omittedCount = 0, observations = []) {
  return {
    schema_version: 1,
    status,
    observations: status === "ok" ? canonicalizeDialectObservations(observations) : [],
    diagnostics: {
      message: status === "ok" ? null : message,
      observed_count: observedCount,
      omitted_count: omittedCount
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error("Usage: vbnet.mjs <file.vb>");
    process.exit(1);
  }

  const code = fs.readFileSync(filePath, "utf8");
  const result = parseCode(code, filePath, "vbnet");
  console.log(JSON.stringify(result, null, 2));
}
