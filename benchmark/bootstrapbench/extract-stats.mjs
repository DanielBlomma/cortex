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
import {
  loadJsonIfExists,
  nowIso,
  parseFlag,
  parseSourcePathsFromYaml,
  streamJsonl,
  usageError,
  writeJson
} from "./lib.mjs";
import { computeChunkStats, computeGraphStats } from "./stats.mjs";

const SCHEMA_VERSION = 1;

function relationTypeFromFilename(fileName) {
  const match = fileName.match(/^relations\.([a-z0-9_]+)\.jsonl$/);
  return match ? match[1].toUpperCase() : null;
}

function mapChunkLine(line) {
  const record = JSON.parse(line);
  return {
    id: record.id,
    kind: record.kind,
    language: record.language,
    start_line: record.start_line,
    end_line: record.end_line,
    exported: record.exported,
    body_chars: typeof record.body === "string" ? record.body.length : null
  };
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

  const fileKinds = await streamJsonl(
    path.join(cacheDir, "documents.jsonl"),
    (line) => {
      const record = JSON.parse(line);
      return String(record.kind ?? "unknown");
    },
    { onError: (failure) => parseErrors.push(failure) }
  );
  const filesByKind = {};
  for (const kind of fileKinds) {
    filesByKind[kind] = (filesByKind[kind] ?? 0) + 1;
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
      files: graphManifest?.counts?.files ?? fileKinds.length,
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
    ingest: ingestManifest
      ? {
          mode: ingestManifest.mode ?? null,
          counts: ingestManifest.counts ?? null,
          skipped: ingestManifest.skipped ?? null,
          parser_health: ingestManifest.parser_health ?? null
        }
      : null,
    files: { total: fileKinds.length, by_kind: filesByKind },
    chunks: chunkStats,
    embeddings,
    graph: graphStats,
    parse_errors: parseErrors.length
  };

  writeJson(outPath, stats);
  console.log(
    `[extract-stats] wrote ${outPath} (chunks=${chunkStats.total}, edges=${graphStats.edges.total}, status=${stats.run.status})`
  );
}

main().catch((error) => {
  console.error(`[extract-stats] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(error?.isUsageError ? 2 : 1);
});
