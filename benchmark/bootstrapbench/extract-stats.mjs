#!/usr/bin/env node
/**
 * Extracts bootstrap statistics from a cortex-initialized project.
 *
 * Reads the artifacts `cortex bootstrap` leaves under .context/ (ingest cache
 * JSONL, graph manifest, embeddings manifest) and emits one stats JSON
 * document. Runs inside the eval container after bootstrap, but also works on
 * any host project for ad-hoc inspection.
 *
 * Usage:
 *   node extract-stats.mjs --project <path> --out <stats.json> \
 *     [--meta <meta.json>] [--timings <timings.json>] \
 *     [--status-override error] [--error "message"]
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  loadJsonIfExists,
  nowIso,
  parseFlag,
  parseSourcePathsFromYaml,
  streamJsonl,
  usageError,
  writeJson
} from "./lib.mjs";
import { computeChunkStats, computeCoverageDiagnostics, computeGraphStats, isTextSupportedPath } from "./stats.mjs";

const SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 1024 * 1024;
const SKIP_DIRECTORIES = new Set([
  ".git",
  ".idea",
  ".vscode",
  "node_modules",
  "bin",
  "obj",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
  ".context"
]);

function relationTypeFromFilename(fileName) {
  const match = fileName.match(/^relations\.([a-z0-9_]+)\.jsonl$/);
  return match ? match[1].toUpperCase() : null;
}

function mapChunkLine(line) {
  const record = JSON.parse(line);
  return {
    id: record.id,
    file_id: record.file_id,
    kind: record.kind,
    language: record.language,
    start_line: record.start_line,
    end_line: record.end_line,
    exported: record.exported,
    body_chars: typeof record.body === "string" ? record.body.length : null
  };
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
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

function isInsideProject(projectRoot, absolutePath) {
  return absolutePath === projectRoot || absolutePath.startsWith(projectRoot + path.sep);
}

export function collectWorkspaceCandidates(projectRoot, sourcePaths) {
  const candidates = [];
  const visitedAbsolutePaths = new Set();
  const visitFile = (absolutePath) => {
    if (!isInsideProject(projectRoot, absolutePath)) {
      return;
    }
    if (visitedAbsolutePaths.has(absolutePath)) {
      return;
    }
    visitedAbsolutePaths.add(absolutePath);
    const relPath = toPosixPath(path.relative(projectRoot, absolutePath));
    const stats = fs.statSync(absolutePath);
    const candidate = {
      path: relPath,
      size_bytes: stats.size,
      too_large: false,
      binary: false
    };
    if (isTextSupportedPath(relPath)) {
      candidate.too_large = stats.size > MAX_FILE_BYTES;
      if (!candidate.too_large) {
        try {
          const handle = fs.openSync(absolutePath, "r");
          try {
            const buffer = Buffer.alloc(Math.min(stats.size, 4000));
            const bytesRead = fs.readSync(handle, buffer, 0, buffer.length, 0);
            candidate.binary = isBinaryBuffer(buffer.subarray(0, bytesRead));
          } finally {
            fs.closeSync(handle);
          }
        } catch {
          // Keep diagnostics best-effort; unreadable files remain non-binary.
        }
      }
    }
    candidates.push(candidate);
  };

  const walk = (directoryPath) => {
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const absolutePath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
      } else if (entry.isFile()) {
        visitFile(absolutePath);
      }
    }
  };

  for (const sourcePath of sourcePaths ?? []) {
    const absolutePath = path.resolve(projectRoot, sourcePath);
    if (!isInsideProject(projectRoot, absolutePath) || !fs.existsSync(absolutePath)) {
      continue;
    }
    const stats = fs.statSync(absolutePath);
    if (stats.isFile()) {
      visitFile(absolutePath);
    } else if (stats.isDirectory()) {
      walk(absolutePath);
    }
  }

  return candidates.sort((left, right) => left.path.localeCompare(right.path));
}

const ENTITY_TYPE_PATTERN = /"entity_type"\s*:\s*"([A-Za-z]+)"/;

function mapEmbeddingLine(line) {
  // Embedding lines carry full vectors; a regex probe avoids parsing them.
  const match = line.match(ENTITY_TYPE_PATTERN);
  if (match) {
    return match[1];
  }
  const record = JSON.parse(line);
  return typeof record.entity_type === "string" ? record.entity_type : undefined;
}

async function collectRelationStats(cacheDir, parseErrors) {
  const relationCounts = {};
  let callEdges = [];
  const entries = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : [];
  for (const entry of entries) {
    const type = relationTypeFromFilename(entry);
    if (!type) {
      continue;
    }
    const filePath = path.join(cacheDir, entry);
    if (type === "CALLS") {
      callEdges = await streamJsonl(
        filePath,
        (line) => {
          const record = JSON.parse(line);
          return { from: record.from, to: record.to };
        },
        { onError: (failure) => parseErrors.push(failure) }
      );
      relationCounts[type] = callEdges.length;
      continue;
    }
    const rows = await streamJsonl(filePath, () => 1, {
      onError: (failure) => parseErrors.push(failure)
    });
    relationCounts[type] = rows.length;
  }
  return { relationCounts, callEdges };
}

function computeEmbeddingSection(embeddingsManifest, byEntityType, embedMs) {
  if (!embeddingsManifest) {
    return null;
  }
  const counts = embeddingsManifest.counts ?? {};
  const embedded = Number(counts.embedded ?? 0) + Number(counts.reused ?? 0);
  const throughput =
    Number.isFinite(embedMs) && embedMs > 0 && embedded > 0
      ? Math.round((embedded / (embedMs / 1000)) * 100) / 100
      : null;
  return {
    model: embeddingsManifest.model ?? null,
    dimensions: embeddingsManifest.dimensions ?? null,
    mode: embeddingsManifest.mode ?? null,
    counts: {
      entities: counts.entities ?? null,
      output: counts.output ?? null,
      embedded: counts.embedded ?? null,
      reused: counts.reused ?? null,
      failed: counts.failed ?? null
    },
    by_entity_type: byEntityType,
    throughput_per_s: throughput
  };
}

function deriveStatus(overrideStatus, embeddings) {
  if (overrideStatus) {
    return overrideStatus;
  }
  if (!embeddings || (embeddings.counts.output ?? 0) === 0) {
    return "embed_failed";
  }
  // A model that failed every entity (e.g. runtime download failure for a
  // non-prewarmed model) must not masquerade as a healthy run.
  const embedded = (embeddings.counts.embedded ?? 0) + (embeddings.counts.reused ?? 0);
  if ((embeddings.counts.failed ?? 0) > 0 && embedded === 0) {
    return "embed_failed";
  }
  return "ok";
}

async function main() {
  const args = process.argv.slice(2);
  const projectDir = parseFlag(args, "--project");
  const outPath = parseFlag(args, "--out");
  if (!projectDir || !outPath) {
    throw usageError("extract-stats.mjs requires --project <path> and --out <file>");
  }

  const metaPath = parseFlag(args, "--meta");
  const timingsPath = parseFlag(args, "--timings");
  const statusOverride = parseFlag(args, "--status-override");
  const errorMessage = parseFlag(args, "--error");

  const contextDir = path.join(path.resolve(projectDir), ".context");
  const cacheDir = path.join(contextDir, "cache");
  const embeddingsDir = path.join(contextDir, "embeddings");

  const meta = metaPath ? loadJsonIfExists(metaPath) ?? {} : {};
  const timings = timingsPath ? loadJsonIfExists(timingsPath) ?? {} : {};
  const parseErrors = [];

  const ingestManifest = loadJsonIfExists(path.join(cacheDir, "manifest.json"));
  const graphManifest = loadJsonIfExists(path.join(cacheDir, "graph-manifest.json"));
  const embeddingsManifest = loadJsonIfExists(path.join(embeddingsDir, "manifest.json"));

  const configYamlPath = path.join(contextDir, "config.yaml");
  const detectedSourcePaths = fs.existsSync(configYamlPath)
    ? parseSourcePathsFromYaml(fs.readFileSync(configYamlPath, "utf8"))
    : [];

  const chunkRecords = await streamJsonl(path.join(cacheDir, "entities.chunk.jsonl"), mapChunkLine, {
    onError: (failure) => parseErrors.push(failure)
  });

  const documents = await streamJsonl(
    path.join(cacheDir, "documents.jsonl"),
    (line) => {
      const record = JSON.parse(line);
      const pathValue = String(record.path ?? "");
      return { id: String(record.id ?? `file:${pathValue}`), kind: String(record.kind ?? "unknown"), path: pathValue };
    },
    { onError: (failure) => parseErrors.push(failure) }
  );
  const filesByKind = {};
  for (const doc of documents) {
    filesByKind[doc.kind] = (filesByKind[doc.kind] ?? 0) + 1;
  }

  // Lines of code cortex actually ingested: newline count of exactly the
  // files listed in documents.jsonl, read from the live workspace (document
  // `content` is truncated for large files, so it cannot be used here).
  // This is the denominator for per-LOC intensity metrics and, together with
  // workspace.tracked_lines, the cortex-coverage ratio.
  let indexedLines = 0;
  const projectRoot = path.resolve(projectDir);
  const workspaceCandidates = collectWorkspaceCandidates(projectRoot, detectedSourcePaths);
  for (const doc of documents) {
    if (!doc.path) {
      continue;
    }
    const absolute = path.resolve(projectRoot, doc.path);
    if (!isInsideProject(projectRoot, absolute)) {
      continue; // defensive: never follow paths escaping the workspace
    }
    try {
      const content = fs.readFileSync(absolute);
      let lines = 0;
      for (let i = 0; i < content.length; i += 1) {
        if (content[i] === 10) {
          lines += 1;
        }
      }
      indexedLines += lines;
    } catch {
      // File listed in the cache but unreadable on disk: skip silently; the
      // count stays a lower bound.
    }
  }

  const { relationCounts, callEdges } = await collectRelationStats(cacheDir, parseErrors);

  const embeddingTypes = await streamJsonl(path.join(embeddingsDir, "entities.jsonl"), mapEmbeddingLine, {
    onError: (failure) => parseErrors.push(failure)
  });
  const byEntityType = {};
  for (const type of embeddingTypes) {
    byEntityType[type] = (byEntityType[type] ?? 0) + 1;
  }

  const chunkStats = computeChunkStats(chunkRecords);
  const graphStats = computeGraphStats({
    nodeCounts: {
      files: graphManifest?.counts?.files ?? documents.length,
      chunks: graphManifest?.counts?.chunks ?? chunkRecords.length,
      rules: graphManifest?.counts?.rules ?? null,
      adrs: graphManifest?.counts?.adrs ?? null,
      modules: graphManifest?.counts?.modules ?? null,
      projects: graphManifest?.counts?.projects ?? null
    },
    relationCounts,
    callEdges,
    chunkIds: chunkRecords.map((chunk) => chunk.id).filter(Boolean)
  });

  const embeddings = computeEmbeddingSection(embeddingsManifest, byEntityType, timings.embed ?? null);
  const coverageDiagnostics = computeCoverageDiagnostics({
    candidateFiles: workspaceCandidates,
    indexedDocuments: documents,
    chunkRecords,
    ingestSkipped: ingestManifest?.skipped ?? null
  });

  const stats = {
    schema_version: SCHEMA_VERSION,
    repo: meta.repo ?? null,
    run: {
      ...(meta.run ?? {}),
      status: deriveStatus(statusOverride, embeddings),
      error: errorMessage ?? null,
      extracted_at: nowIso()
    },
    workspace: {
      ...(meta.workspace ?? {}),
      detected_source_paths: detectedSourcePaths
    },
    timings_ms: {
      deps: timings.deps ?? null,
      ingest: timings.ingest ?? null,
      embed: timings.embed ?? null,
      graph_load: timings.graph_load ?? null,
      status: timings.status ?? null,
      total: timings.total ?? null
    },
    memory: timings.memory ?? null,
    ingest: ingestManifest
      ? {
          mode: ingestManifest.mode ?? null,
          counts: ingestManifest.counts ?? null,
          skipped: ingestManifest.skipped ?? null,
          parser_health: ingestManifest.parser_health ?? null
        }
      : null,
    files: { total: documents.length, by_kind: filesByKind, indexed_lines: indexedLines },
    chunks: chunkStats,
    embeddings,
    graph: graphStats,
    diagnostics: {
      coverage: coverageDiagnostics
    },
    parse_errors: parseErrors.length
  };

  writeJson(outPath, stats);
  console.log(
    `[extract-stats] wrote ${outPath} (chunks=${chunkStats.total}, edges=${graphStats.edges.total}, status=${stats.run.status})`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[extract-stats] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(error?.isUsageError ? 2 : 1);
  });
}
