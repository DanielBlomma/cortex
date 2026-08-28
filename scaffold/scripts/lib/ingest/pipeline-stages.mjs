import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  DIALECT_LIMITS,
  canonicalJson,
  canonicalRepositoryPath,
  canonicalize,
  createDialectObservationTransport,
  dialectFamilyForMode,
  exactKeys,
  hexSha256,
  sha256,
  validateDialectObservationEnvelope,
  validateDialectObservationTransport
} from "../dialect-observation-contract.mjs";
import {
  collectParseEligibleFiles,
  createCSharpBatchCache,
  createWorkerTasks,
  inspectCSharpParser
} from "./parser-composition.mjs";
import {
  createIngestMemoryTrace,
  parseArgs,
  parseNonNegativeIntegerEnv,
  parsePositiveIntegerEnv
} from "./arguments.mjs";
import {
  DEFAULT_CHUNK_MAX_WINDOWS,
  DEFAULT_CHUNK_OVERLAP_LINES,
  DEFAULT_CHUNK_SPLIT_MIN_LINES,
  DEFAULT_CHUNK_WINDOW_LINES,
  MAX_BODY_CHARS,
  MAX_CONTENT_CHARS,
  MAX_FILE_BYTES
} from "./constants.mjs";
import {
  collectRuleKeywordMatch,
  fileTokenSet,
  normalizeRuleTokens,
  parseRules,
  parseSourcePaths
} from "./config.mjs";
import {
  chunkIdFor,
  generateChunkDescription,
  generateModules,
  isWindowChunkId,
  splitChunkIntoWindows
} from "./chunks.mjs";
import {
  adrTokens,
  checksum,
  collectCandidateFiles,
  detectKind,
  extractTitle,
  findSupersedesReferences,
  hasSourcePrefix,
  isBinaryBuffer,
  isTextFile,
  normalizeToken,
  normalizeWhitespace,
  parseDecisionDate,
  resolveRelativeImportTargetId,
  trustLevelForKind
} from "./files.mjs";
import {
  countFileContentRecords,
  mapRows,
  writeJsonlToDescriptor,
  writeTsvToDescriptor
} from "./io.mjs";
import {
  hydrateIncrementalChunkState,
  removeChunkStateForFile
} from "./incremental-state.mjs";
import { generateProjects } from "./projects.mjs";
import {
  buildChunkAliasIndexes,
  buildSqlResourceReferenceMap,
  configChunkAliases,
  extractConfigKeyReferences,
  extractSqlObjectReferencesFromContent,
  extractSqlResourceKeyReferences,
  generateConfigIncludeRelations,
  generateConfigTransformKeyRelations,
  generateConfigTransformRelations,
  generateMachineConfigRelations,
  generateNamedResourceRelations,
  generateSectionHandlerRelations,
  namedEntryChunkAliases,
  relationKey,
  shouldExtractNamedResourceReferences,
  shouldExtractSqlReferences,
  sqlChunkAliases,
  uniqueRelations
} from "./relations.mjs";
import { initializeRuntimePaths } from "./runtime-paths.mjs";
import {
  DIALECT_OBSERVATION_OUTPUT_IDENTITY,
  INGEST_MANIFEST_OUTPUT_IDENTITY,
  isFilesystemPolicyError
} from "./filesystem-boundary.mjs";
import {
  resolveIngestWorkerCount,
  startWorkerParseStream
} from "./workers.mjs";

const DIALECT_FILE_RECORD_TYPE = "dialect_observation_file";
const DIALECT_FILE_RECORD_ID_PREFIX = "dialect-observation-file-v1:";
const DIALECT_INDEX_ID = "cortex-dialect-observations-v1";
const DIALECT_MANIFEST_FIELD = "experimental_dialect_observations";
const DIALECT_STATUSES = Object.freeze([
  "ok",
  "unsupported",
  "malformed",
  "oversized",
  "unavailable",
  "truncated"
]);

function createDialectObservationFileRecord({
  repositoryPath,
  sourceSha256,
  family,
  syntaxMode,
  observationEnvelope
}) {
  const record = {
    family,
    observation_envelope: observationEnvelope,
    record_id: "",
    record_type: DIALECT_FILE_RECORD_TYPE,
    repository_path: repositoryPath,
    schema_version: 1,
    source_sha256: sourceSha256,
    syntax_mode: syntaxMode
  };
  const identityPayload = { ...record };
  delete identityPayload.record_id;
  record.record_id = `${DIALECT_FILE_RECORD_ID_PREFIX}${sha256(canonicalJson(identityPayload))}`;
  return validateDialectObservationFileRecord(record);
}

function validateDialectObservationFileRecord(record) {
  const canonical = canonicalize(record);
  exactKeys(canonical, [
    "family",
    "observation_envelope",
    "record_id",
    "record_type",
    "repository_path",
    "schema_version",
    "source_sha256",
    "syntax_mode"
  ], "dialect observation file record");
  if (canonical.schema_version !== 1 || canonical.record_type !== DIALECT_FILE_RECORD_TYPE) {
    throw new TypeError("Dialect sidecar: unsupported file record identity");
  }
  canonicalRepositoryPath(canonical.repository_path);
  if (path.posix.extname(canonical.repository_path).toLowerCase() !== canonical.syntax_mode) {
    throw new TypeError("Dialect sidecar: syntax mode does not match repository path extension");
  }
  hexSha256(canonical.source_sha256, "dialect source hash");
  const manifestFamily = dialectFamilyForMode(canonical.syntax_mode);
  if (!manifestFamily || manifestFamily.family !== canonical.family) {
    throw new TypeError("Dialect sidecar: family and syntax mode do not match");
  }
  validateDialectObservationEnvelope(canonical.observation_envelope);
  for (const observation of canonical.observation_envelope.observations) {
    if (observation.repository_path !== canonical.repository_path ||
        observation.family !== canonical.family ||
        observation.syntax_mode !== canonical.syntax_mode) {
      throw new TypeError("Dialect sidecar: observation escaped its file record");
    }
  }
  const identityPayload = { ...canonical };
  delete identityPayload.record_id;
  const expectedId = `${DIALECT_FILE_RECORD_ID_PREFIX}${sha256(canonicalJson(identityPayload))}`;
  if (canonical.record_id !== expectedId) {
    throw new TypeError("Dialect sidecar: file record identity mismatch");
  }
  return canonical;
}

function serializeDialectObservationSidecar(records) {
  if (!Array.isArray(records) || records.length > DIALECT_LIMITS.max_source_catalog_files) {
    throw new TypeError("Dialect sidecar: file record cap exceeded");
  }
  const canonicalRecords = records.map(validateDialectObservationFileRecord);
  canonicalRecords.sort((left, right) => left.repository_path.localeCompare(right.repository_path));
  const paths = new Set();
  const recordIds = new Set();
  const observationIds = new Set();
  for (const record of canonicalRecords) {
    if (paths.has(record.repository_path) || recordIds.has(record.record_id)) {
      throw new TypeError("Dialect sidecar: duplicate file record");
    }
    paths.add(record.repository_path);
    recordIds.add(record.record_id);
    for (const observation of record.observation_envelope.observations) {
      if (observationIds.has(observation.observation_id)) {
        throw new TypeError("Dialect sidecar: duplicate observation identity");
      }
      observationIds.add(observation.observation_id);
    }
  }
  const text = canonicalRecords.length > 0
    ? `${canonicalRecords.map((record) => canonicalJson(record)).join("\n")}\n`
    : "";
  if (Buffer.byteLength(text) > DIALECT_LIMITS.max_source_catalog_bytes) {
    throw new TypeError("Dialect sidecar: aggregate byte cap exceeded");
  }
  return { records: canonicalRecords, text };
}

function parseDialectObservationSidecar(text) {
  if (typeof text !== "string") throw new TypeError("Dialect sidecar: text is required");
  if (Buffer.byteLength(text) > DIALECT_LIMITS.max_source_catalog_bytes) {
    throw new TypeError("Dialect sidecar: aggregate byte cap exceeded");
  }
  if (text.length === 0) return serializeDialectObservationSidecar([]);
  if (!text.endsWith("\n")) throw new TypeError("Dialect sidecar: missing canonical newline");
  const records = text.slice(0, -1).split("\n").map((line) => {
    if (line.trim() !== line || line.length === 0) {
      throw new TypeError("Dialect sidecar: non-canonical JSONL line");
    }
    try {
      return JSON.parse(line);
    } catch {
      throw new TypeError("Dialect sidecar: malformed JSONL line");
    }
  });
  const serialized = serializeDialectObservationSidecar(records);
  if (serialized.text !== text) throw new TypeError("Dialect sidecar: non-canonical bytes");
  return serialized;
}

function summarizeDialectObservationSidecar(serialized) {
  const statusCounts = Object.fromEntries(DIALECT_STATUSES.map((status) => [status, 0]));
  let observations = 0;
  let observedCount = 0;
  let omittedCount = 0;
  for (const record of serialized.records) {
    const envelope = record.observation_envelope;
    statusCounts[envelope.status] += 1;
    observations += envelope.observations.length;
    observedCount += envelope.diagnostics.observed_count;
    omittedCount += envelope.diagnostics.omitted_count;
  }
  return canonicalize({
    file_records: serialized.records.length,
    index_id: DIALECT_INDEX_ID,
    observations,
    observed_count: observedCount,
    omitted_count: omittedCount,
    schema_version: 1,
    sha256: sha256(serialized.text),
    status_counts: statusCounts
  });
}

function parsedSourceSha256(fileRecord) {
  return sha256(String(fileRecord.content ?? ""));
}

function unavailableDialectTransport(message = "dialect composite parse failed") {
  return createDialectObservationTransport(
    { chunks: [], errors: [] },
    {
      diagnostics: { message, observed_count: 0, omitted_count: 0 },
      observations: [],
      schema_version: 1,
      status: "unavailable"
    }
  );
}

function fileRecordContentWasTruncated(fileRecord) {
  const sourceBytes = Number(fileRecord?.size_bytes);
  return Number.isSafeInteger(sourceBytes) && sourceBytes >= 0 &&
    sourceBytes > Buffer.byteLength(String(fileRecord?.content ?? ""), "utf8");
}

function truncatedDialectTransport(transport) {
  const observedCount = transport.observation_envelope.diagnostics.observed_count;
  return createDialectObservationTransport(
    transport.parser_result,
    {
      diagnostics: {
        message: "source was truncated before dialect observation parsing",
        observed_count: observedCount,
        omitted_count: observedCount
      },
      observations: [],
      schema_version: 1,
      status: "truncated"
    }
  );
}

function hydrateDialectObservationRecords(
  priorCache,
  fileRecords,
  incrementalMode,
  changedPaths = new Set(),
  deletedPaths = []
) {
  if (!incrementalMode || !priorCache) return new Map();
  try {
    const sidecarText = priorCache.readText(
      DIALECT_OBSERVATION_OUTPUT_IDENTITY,
      DIALECT_LIMITS.max_source_catalog_bytes
    );
    const manifestText = priorCache.readText(
      INGEST_MANIFEST_OUTPUT_IDENTITY,
      DIALECT_LIMITS.max_canonical_input_bytes
    );
    if (sidecarText === null || manifestText === null) return new Map();
    const manifest = JSON.parse(manifestText);
    const dialectManifest = manifest?.[DIALECT_MANIFEST_FIELD];
    exactKeys(dialectManifest, [
      "file_records",
      "index_id",
      "observations",
      "observed_count",
      "omitted_count",
      "schema_version",
      "sha256",
      "status_counts"
    ], "dialect ingest manifest field");
    const serialized = parseDialectObservationSidecar(sidecarText);
    const summary = summarizeDialectObservationSidecar(serialized);
    if (canonicalJson(summary) !== canonicalJson(dialectManifest)) return new Map();
    const filesByPath = new Map(fileRecords.map((record) => [record.path, record]));
    const priorByPath = new Map(serialized.records.map((record) => [record.repository_path, record]));
    const wasDeleted = (repositoryPath) => deletedPaths.some((deletedPath) => {
      const prefix = deletedPath.endsWith("/") ? deletedPath : `${deletedPath}/`;
      return repositoryPath === deletedPath || repositoryPath.startsWith(prefix);
    });

    // Validate the prior generation as a whole before retaining any record.
    // Expected changed/deleted paths may differ, but any other unknown, stale,
    // or hash-mismatched record invalidates the complete dialect cache.
    for (const record of serialized.records) {
      const fileRecord = filesByPath.get(record.repository_path);
      if (!fileRecord) {
        if (wasDeleted(record.repository_path)) continue;
        return new Map();
      }
      if (
        parsedSourceSha256(fileRecord) !== record.source_sha256 &&
        !changedPaths.has(record.repository_path)
      ) {
        return new Map();
      }
    }
    for (const fileRecord of fileRecords) {
      const syntaxMode = path.posix.extname(fileRecord.path).toLowerCase();
      if (!dialectFamilyForMode(syntaxMode) || changedPaths.has(fileRecord.path)) continue;
      const priorRecord = priorByPath.get(fileRecord.path);
      if (!priorRecord || parsedSourceSha256(fileRecord) !== priorRecord.source_sha256) {
        return new Map();
      }
    }

    return new Map(serialized.records
      .filter((record) => {
        const fileRecord = filesByPath.get(record.repository_path);
        return fileRecord &&
          !changedPaths.has(record.repository_path) &&
          parsedSourceSha256(fileRecord) === record.source_sha256;
      })
      .map((record) => [record.repository_path, record]));
  } catch (error) {
    if (isFilesystemPolicyError(error)) throw error;
    return new Map();
  }
}

function createIngestPipelineState() {
  const boundary = initializeRuntimePaths();
  const { mode, verbose } = parseArgs(process.argv);
  const memoryTrace = createIngestMemoryTrace();

  boundary.validateControl(".context/config.yaml");
  boundary.validateControl(".context/rules.yaml");
  const configText = boundary.readControl(".context/config.yaml");
  const sourcePaths = parseSourcePaths(configText);
  if (sourcePaths.length === 0) {
    throw new Error("No source_paths found in .context/config.yaml");
  }
  const sourceRecords = boundary.validateConfiguredSources(sourcePaths);

  const rules = parseRules(boundary.readControl(".context/rules.yaml"));
  memoryTrace.checkpoint("scan:start", {
    mode,
    source_paths: sourcePaths.length,
    rules: rules.length
  });
  const { candidates, incrementalMode, deletedRelPaths } = collectCandidateFiles(
    boundary,
    sourcePaths,
    sourceRecords,
    mode
  );
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

  return {
    mode,
    verbose,
    memoryTrace,
    boundary,
    sourcePaths,
    sourceRecords,
    rules,
    candidates,
    incrementalMode,
    deletedRelPaths,
    chunkWindowLines,
    chunkOverlapLines,
    chunkSplitMinLines,
    chunkMaxWindows
  };
}

function runScanHydrationStage(state) {
  const {
    verbose,
    memoryTrace,
    sourcePaths,
    candidates,
    incrementalMode,
    deletedRelPaths
  } = state;
  const { boundary } = state;
  const fileRecordMap = new Map();
  const adrRecordMap = new Map();
  const skipped = {
    unsupported: 0,
    tooLarge: 0,
    binary: 0
  };

  if (incrementalMode) {
    const priorCache = boundary.preflightPriorCache();
    state.priorCache = priorCache;
    const existingFiles = priorCache.read(".context/cache/entities.file.jsonl");
    for (const record of existingFiles) {
      if (!record || typeof record !== "object") continue;
      if (typeof record.path !== "string" || record.path.length === 0) continue;
      const inspected = boundary.inspectRepositoryPath(record.path, {
        phase: "discovery",
        allowMissing: true,
        expected: "file"
      });
      const filePath = inspected.identity;
      if (!hasSourcePrefix(filePath, sourcePaths)) {
        continue;
      }
      if (!inspected.exists) continue;
      const expectedId = `file:${filePath}`;
      if (record.id != null && String(record.id) !== expectedId) continue;
      fileRecordMap.set(expectedId, {
        ...record,
        id: expectedId,
        path: filePath,
        kind: String(record.kind ?? detectKind(filePath)),
        content: String(record.content ?? "")
      });
    }

    const existingAdrs = priorCache.read(".context/cache/entities.adr.jsonl");
    for (const adr of existingAdrs) {
      if (!adr || typeof adr !== "object") continue;
      if (typeof adr.path !== "string" || adr.path.length === 0) continue;
      const inspected = boundary.inspectRepositoryPath(adr.path, {
        phase: "discovery",
        allowMissing: true,
        expected: "file"
      });
      const adrPath = inspected.identity;
      if (!hasSourcePrefix(adrPath, sourcePaths)) {
        continue;
      }
      if (!inspected.exists) continue;
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

  for (const candidateIdentity of [...candidates].sort()) {
    const relPath = boundary.inspectRepositoryPath(candidateIdentity, {
      phase: "direct_read",
      expected: "file"
    }).identity;
    if (!isTextFile(relPath)) {
      skipped.unsupported += 1;
      if (verbose) console.log(`[ingest] skip unsupported: ${relPath}`);
      continue;
    }

    const { stats } = boundary.statRepositoryFile(relPath, "direct_read");
    if (stats.size > MAX_FILE_BYTES) {
      skipped.tooLarge += 1;
      if (verbose) console.log(`[ingest] skip large: ${relPath}`);
      continue;
    }

    const buffer = boundary.readRepositoryFile(relPath, "direct_read");
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
  const dialectRecordMap = hydrateDialectObservationRecords(
    state.priorCache,
    fileRecords,
    incrementalMode,
    candidates,
    deletedRelPaths
  );
  for (const candidateIdentity of candidates) dialectRecordMap.delete(candidateIdentity);
  for (const deletedPath of deletedRelPaths) {
    const prefix = deletedPath.endsWith("/") ? deletedPath : `${deletedPath}/`;
    for (const repositoryPath of dialectRecordMap.keys()) {
      if (repositoryPath === deletedPath || repositoryPath.startsWith(prefix)) {
        dialectRecordMap.delete(repositoryPath);
      }
    }
  }
  const cachedDialectPaths = new Set(dialectRecordMap.keys());
  memoryTrace.checkpoint("scan:file_records", {
    candidates: candidates.size,
    incremental_mode: incrementalMode,
    deleted_paths: deletedRelPaths.length,
    files: fileRecords.length,
    adrs: adrRecords.length,
    skipped_unsupported: skipped.unsupported,
    skipped_too_large: skipped.tooLarge,
    skipped_binary: skipped.binary
  });
  const {
    fileCount: csharpFileCount,
    runtime: csharpRuntime
  } = inspectCSharpParser(fileRecords);
  const indexedFileIds = new Set(fileRecords.map((record) => record.id));
  const changedFileIds = new Set(
    [...candidates].map((candidateIdentity) => `file:${candidateIdentity}`)
  );

  const {
    chunkRecordMap,
    definesRelationMap,
    callsRelationMap,
    importsRelationMap,
    callsSqlRelationMap
  } = incrementalMode
    ? hydrateIncrementalChunkState(fileRecords, state.priorCache)
    : {
        chunkRecordMap: new Map(),
        definesRelationMap: new Map(),
        callsRelationMap: new Map(),
        importsRelationMap: new Map(),
        callsSqlRelationMap: new Map()
      };
  memoryTrace.checkpoint("hydration:complete", {
    incremental_mode: incrementalMode,
    cached_chunks: chunkRecordMap.size,
    cached_defines_relations: definesRelationMap.size,
    cached_calls_relations: callsRelationMap.size,
    cached_imports_relations: importsRelationMap.size,
    cached_calls_sql_relations: callsSqlRelationMap.size,
    cached_dialect_files: dialectRecordMap.size
  });

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
  let {
    sqlChunkIdsByAlias,
    configChunkIdsByAlias,
    resourceChunkIdsByAlias,
    settingChunkIdsByAlias
  } = buildChunkAliasIndexes([...chunkRecordMap.values()]);
  const deferredSqlCallEdges = [];

  Object.assign(state, {
    fileRecords,
    adrRecords,
    skipped,
    csharpFileCount,
    csharpRuntime,
    indexedFileIds,
    changedFileIds,
    chunkRecordMap,
    definesRelationMap,
    callsRelationMap,
    importsRelationMap,
    callsSqlRelationMap,
    cachedChunkFileIds,
    cachedSqlReferenceFileIds,
    dialectRecordMap,
    cachedDialectPaths,
    usesConfigKeyRelationMap,
    usesResourceKeyRelationMap,
    usesSettingKeyRelationMap,
    windowedChunkCount,
    sqlChunkIdsByAlias,
    configChunkIdsByAlias,
    resourceChunkIdsByAlias,
    settingChunkIdsByAlias,
    deferredSqlCallEdges
  });
}

async function runParseStage(state) {
  const {
    verbose,
    memoryTrace,
    fileRecords,
    incrementalMode,
    changedFileIds,
    indexedFileIds,
    cachedChunkFileIds,
    cachedDialectPaths,
    dialectRecordMap,
    chunkRecordMap,
    definesRelationMap,
    callsRelationMap,
    importsRelationMap,
    callsSqlRelationMap,
    chunkWindowLines,
    chunkOverlapLines,
    chunkSplitMinLines,
    chunkMaxWindows,
    deferredSqlCallEdges
  } = state;
  let {
    windowedChunkCount,
    sqlChunkIdsByAlias,
    configChunkIdsByAlias,
    resourceChunkIdsByAlias,
    settingChunkIdsByAlias
  } = state;

  // Determine which files need parsing (single pass over the gates, shared by
  // the worker dispatch and the merge loop below so the two cannot diverge).
  const parseEligible = await collectParseEligibleFiles({
    fileRecords,
    incrementalMode,
    changedFileIds,
    cachedChunkFileIds,
    cachedDialectPaths
  });

  // C# project-wide batch parse retains SemanticModel-resolved calls while
  // collecting the detached dialect envelope in the same Roslyn invocation.
  const csharpBatchCache = createCSharpBatchCache({
    fileRecords,
    parseEligible,
    verbose
  });
  memoryTrace.checkpoint("parse:eligible", {
    files: fileRecords.length,
    parse_eligible: parseEligible.size,
    csharp_batch_cached: csharpBatchCache.size
  });

  // Parse parallel-safe files (tree-sitter/JS, no subprocess, no cross-file
  // state) in a worker pool. C# batch-cached files and any worker miss fall
  // through to inline parsing in the loop, so the result is byte-identical to
  // the sequential path regardless of where a file actually parsed.
  const workerTasks = createWorkerTasks(
    fileRecords,
    parseEligible,
    csharpBatchCache,
    state.boundary.anchor
  );
  const workerCount = resolveIngestWorkerCount(workerTasks.length);
  memoryTrace.checkpoint("parse:workers_start", {
    worker_tasks: workerTasks.length,
    worker_count: workerCount
  });
  const workerStream =
    workerCount > 1 ? startWorkerParseStream(workerTasks, { workerCount, verbose }) : null;
  if (!workerStream) {
    memoryTrace.checkpoint("parse:workers_complete", {
      worker_tasks: workerTasks.length,
      worker_count: workerCount,
      worker_results: 0,
      worker_results_consumed: 0,
      worker_results_retained: 0,
      worker_results_retained_peak: 0,
      worker_results_pending: 0,
      worker_results_missing: workerTasks.length
    });
  }

  for (const fileRecord of fileRecords) {
    const eligible = parseEligible.get(fileRecord.id);
    if (!eligible) continue;
    const { parser } = eligible;

    try {
      let parseResult;
      if (eligible.useDialect) {
        let transport;
        try {
          if (parser.language === "csharp" && csharpBatchCache.has(fileRecord.path)) {
            transport = csharpBatchCache.get(fileRecord.path);
          } else if (workerStream?.hasTask(fileRecord.id)) {
            transport = await workerStream.take(fileRecord.id);
            if (!transport) {
              transport = await parser.parseWithDialect(
                fileRecord.content,
                fileRecord.path,
                parser.language
              );
            }
          } else {
            transport = await parser.parseWithDialect(
              fileRecord.content,
              fileRecord.path,
              parser.language
            );
          }
          transport = validateDialectObservationTransport(transport);
          if (fileRecordContentWasTruncated(fileRecord)) {
            transport = truncatedDialectTransport(transport);
          }
        } catch (error) {
          if (isFilesystemPolicyError(error)) throw error;
          transport = unavailableDialectTransport();
        }
        const family = dialectFamilyForMode(eligible.ext);
        dialectRecordMap.set(fileRecord.path, createDialectObservationFileRecord({
          repositoryPath: fileRecord.path,
          sourceSha256: parsedSourceSha256(fileRecord),
          family: family.family,
          syntaxMode: eligible.ext,
          observationEnvelope: transport.observation_envelope
        }));
        if (!eligible.shouldParseLegacy) continue;
        parseResult = transport.parser_result;
      } else if (workerStream?.hasTask(fileRecord.id)) {
        parseResult = await workerStream.take(fileRecord.id);
        if (!parseResult) {
          parseResult = await parser.parse(fileRecord.content, fileRecord.path, parser.language);
        }
      } else {
        parseResult = await parser.parse(fileRecord.content, fileRecord.path, parser.language);
      }

      removeChunkStateForFile(
        fileRecord.id,
        chunkRecordMap,
        definesRelationMap,
        callsRelationMap,
        importsRelationMap,
        callsSqlRelationMap
      );

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
      if (isFilesystemPolicyError(error)) {
        if (workerStream) {
          await workerStream.drain().catch(() => {});
        }
        throw error;
      }
      if (verbose) {
        console.log(`[ingest] failed to parse ${fileRecord.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  const finalWorkerStats = workerStream ? await workerStream.drain() : null;
  if (finalWorkerStats) {
    memoryTrace.checkpoint("parse:workers_complete", finalWorkerStats);
    if (verbose) {
      console.log(
        `[ingest] parsed ${finalWorkerStats.worker_results}/${workerTasks.length} files across ${workerCount} workers`
      );
    }
  }
  memoryTrace.checkpoint("parse:merge_complete", {
    chunk_map: chunkRecordMap.size,
    defines_relations: definesRelationMap.size,
    calls_relations: callsRelationMap.size,
    imports_relations: importsRelationMap.size,
    calls_sql_relations: callsSqlRelationMap.size,
    deferred_sql_edges: deferredSqlCallEdges.length,
    windowed_chunks: windowedChunkCount,
    worker_results_retained: finalWorkerStats?.worker_results_retained ?? 0,
    worker_results_retained_peak: finalWorkerStats?.worker_results_retained_peak ?? 0,
    worker_results_pending: finalWorkerStats?.worker_results_pending ?? 0
  });

  Object.assign(state, {
    windowedChunkCount,
    sqlChunkIdsByAlias,
    configChunkIdsByAlias,
    resourceChunkIdsByAlias,
    settingChunkIdsByAlias
  });
}

function runMaterializationStage(state) {
  const {
    verbose,
    memoryTrace,
    rules,
    fileRecords,
    adrRecords,
    incrementalMode,
    changedFileIds,
    indexedFileIds,
    cachedSqlReferenceFileIds,
    csharpFileCount,
    csharpRuntime,
    chunkWindowLines,
    chunkOverlapLines,
    chunkMaxWindows,
    chunkRecordMap,
    definesRelationMap,
    callsRelationMap,
    importsRelationMap,
    callsSqlRelationMap,
    usesConfigKeyRelationMap,
    usesResourceKeyRelationMap,
    usesSettingKeyRelationMap,
    deferredSqlCallEdges,
    windowedChunkCount
  } = state;
  let {
    sqlChunkIdsByAlias,
    configChunkIdsByAlias,
    resourceChunkIdsByAlias,
    settingChunkIdsByAlias
  } = state;
  const chunkRecords = [...chunkRecordMap.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  ({
    sqlChunkIdsByAlias,
    configChunkIdsByAlias,
    resourceChunkIdsByAlias,
    settingChunkIdsByAlias
  } = buildChunkAliasIndexes(chunkRecords));

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
  memoryTrace.checkpoint("materialize:chunks_relations", {
    chunks: chunkRecords.length,
    chunk_ids: chunkIdSet.size,
    relations_defines: validDefinesRelations.length,
    relations_calls: validCallsRelations.length,
    relations_imports: validImportsRelations.length,
    relations_calls_sql: validCallsSqlRelations.length,
    relations_uses_config_key: validUsesConfigKeyRelations.length,
    relations_uses_resource_key: validUsesResourceKeyRelations.length,
    relations_uses_setting_key: validUsesSettingKeyRelations.length
  });

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

  const csharpChunkCount = chunkRecords.filter((record) => record.language === "csharp").length;
  const parserHealth = {};
  if (csharpFileCount > 0) {
    parserHealth.csharp = {
      files: csharpFileCount,
      available: Boolean(csharpRuntime?.available),
      reason: csharpRuntime?.available ? null : (csharpRuntime?.reason ?? "C# parser unavailable"),
      chunks: csharpChunkCount,
    };

    if (!csharpRuntime?.available) {
      console.log(`[ingest] warning csharp parser unavailable: ${parserHealth.csharp.reason}`);
    } else if (csharpChunkCount === 0) {
      console.log("[ingest] warning csharp parser produced 0 chunks across C# files");
    }
  }

  // Generate Module entities and relations
  const moduleResult = generateModules(fileRecords, chunkRecords, state.boundary);
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
  memoryTrace.checkpoint("materialize:modules_projects_relations", {
    modules: moduleRecords.length,
    projects: projectRecords.length,
    relations_contains: moduleContainsRelations.length,
    relations_contains_module: moduleContainsModuleRelations.length,
    relations_exports: moduleExportsRelations.length,
    relations_includes_file: projectIncludesFileRelations.length,
    relations_references_project: projectReferencesProjectRelations.length,
    relations_uses_resource: usesResourceRelations.length,
    relations_uses_setting: usesSettingRelations.length,
    relations_uses_config: usesConfigRelations.length,
    relations_transforms_config: configTransformRelations.length
  });

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

  Object.assign(state, {
    chunkRecords,
    validDefinesRelations,
    validCallsRelations,
    validImportsRelations,
    validCallsSqlRelations,
    validUsesConfigKeyRelations,
    validUsesResourceKeyRelations,
    validUsesSettingKeyRelations,
    parserHealth,
    moduleRecords,
    moduleContainsRelations,
    moduleContainsModuleRelations,
    moduleExportsRelations,
    projectRecords,
    projectIncludesFileRelations,
    projectReferencesProjectRelations,
    usesResourceRelations,
    usesSettingRelations,
    usesConfigRelations,
    configTransformRelations,
    ruleRecords,
    supersedesRelations
  });
}

function stageJsonlOutput(state, identity, records) {
  state.outputSet.stage(identity, (descriptor) => {
    writeJsonlToDescriptor(descriptor, records);
  });
}

function stageTsvOutput(state, identity, headers, rows) {
  state.outputSet.stage(identity, (descriptor) => {
    writeTsvToDescriptor(descriptor, headers, rows);
  });
}

function runFileCacheStagingStage(state) {
  const {
    memoryTrace,
    fileRecords
  } = state;
  const constrainsRelations = [];
  const implementsRelations = [];
  stageJsonlOutput(state, ".context/cache/documents.jsonl", fileRecords);
  stageJsonlOutput(state, ".context/cache/entities.file.jsonl", fileRecords);
  memoryTrace.checkpoint("writes:file_cache_staged", {
    files: fileRecords.length,
    file_content_records: countFileContentRecords(fileRecords)
  });

  Object.assign(state, {
    constrainsRelations,
    implementsRelations
  });
}

function ensureIngestOutputDirectories(state, options) {
  state.outputSet = state.boundary.prepareIngestOutputSet(options);
}

function runTokenMatchingStage(state) {
  const {
    memoryTrace,
    fileRecords,
    ruleRecords,
    constrainsRelations,
    implementsRelations,
    supersedesRelations
  } = state;
  memoryTrace.checkpoint("tokens:rule_matching_start", {
    files: fileRecords.length,
    rules: ruleRecords.length
  });

  const ruleMatchers = ruleRecords.map((ruleRecord) => ({
    ruleRecord,
    needle: ruleRecord.id.toLowerCase(),
    keywords: normalizeRuleTokens(ruleRecord)
  }));
  const constrainsByKey = new Map();
  const implementsByKey = new Map();
  let fileTokenSetsProcessed = 0;
  let fileContentRecordsReleased = 0;

  for (const fileRecord of fileRecords) {
    const lower = String(fileRecord.content ?? "").toLowerCase();
    const tokens = fileTokenSet(fileRecord);
    fileTokenSetsProcessed += 1;

    for (const { ruleRecord, needle, keywords } of ruleMatchers) {
      const explicitMention = lower.includes(needle);
      const minimumMatches = fileRecord.kind === "CODE" ? 1 : 2;
      const keywordResult = explicitMention
        ? { matched: false, sample: [] }
        : collectRuleKeywordMatch(keywords, tokens, minimumMatches);

      if (!explicitMention && !keywordResult.matched) {
        continue;
      }

      const constrainsKey = `${ruleRecord.id}|${fileRecord.id}`;
      if (!constrainsByKey.has(constrainsKey)) {
        constrainsByKey.set(constrainsKey, {
          from: ruleRecord.id,
          to: fileRecord.id,
          note: explicitMention
            ? `Mentions ${ruleRecord.id}`
            : `Keyword match ${keywordResult.sample.join(", ")}`
        });
      }

      if (fileRecord.kind === "CODE") {
        const implementsKey = `${fileRecord.id}|${ruleRecord.id}`;
        if (!implementsByKey.has(implementsKey)) {
          implementsByKey.set(implementsKey, {
            from: fileRecord.id,
            to: ruleRecord.id,
            note: explicitMention
              ? `Code references ${ruleRecord.id}`
              : `Code keywords ${keywordResult.sample.join(", ")}`
          });
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(fileRecord, "content")) {
      delete fileRecord.content;
      fileContentRecordsReleased += 1;
    }
  }

  for (const { ruleRecord } of ruleMatchers) {
    for (const fileRecord of fileRecords) {
      const constrainsKey = `${ruleRecord.id}|${fileRecord.id}`;
      const constrainsRelation = constrainsByKey.get(constrainsKey);
      if (constrainsRelation) {
        constrainsRelations.push(constrainsRelation);
        constrainsByKey.delete(constrainsKey);
      }
      if (fileRecord.kind === "CODE") {
        const implementsKey = `${fileRecord.id}|${ruleRecord.id}`;
        const implementsRelation = implementsByKey.get(implementsKey);
        if (implementsRelation) {
          implementsRelations.push(implementsRelation);
          implementsByKey.delete(implementsKey);
        }
      }
    }
  }

  memoryTrace.checkpoint("tokens:rule_matching_complete", {
    file_token_sets: fileTokenSetsProcessed,
    file_token_sets_retained: 0,
    file_content_records_released: fileContentRecordsReleased,
    file_content_records_retained: countFileContentRecords(fileRecords),
    rules: ruleRecords.length,
    relations_constrains: constrainsRelations.length,
    relations_implements: implementsRelations.length,
    relations_supersedes: supersedesRelations.length
  });
}

function runCacheWriteStage(state) {
  const {
    memoryTrace,
    fileRecords,
    adrRecords,
    ruleRecords,
    chunkRecords,
    supersedesRelations,
    constrainsRelations,
    implementsRelations,
    validDefinesRelations,
    validCallsRelations,
    validImportsRelations,
    validCallsSqlRelations,
    validUsesConfigKeyRelations,
    validUsesResourceKeyRelations,
    validUsesSettingKeyRelations,
    moduleRecords,
    moduleContainsRelations,
    moduleContainsModuleRelations,
    moduleExportsRelations,
    projectRecords,
    projectIncludesFileRelations,
    projectReferencesProjectRelations,
    usesResourceRelations,
    usesSettingRelations,
    usesConfigRelations,
    configTransformRelations,
    dialectRecordMap
  } = state;
  memoryTrace.checkpoint("writes:cache_start", {
    files: fileRecords.length,
    adrs: adrRecords.length,
    rules: ruleRecords.length,
    chunks: chunkRecords.length
  });
  stageJsonlOutput(state, ".context/cache/entities.adr.jsonl", adrRecords);
  stageJsonlOutput(state, ".context/cache/entities.rule.jsonl", ruleRecords);
  stageJsonlOutput(state, ".context/cache/entities.chunk.jsonl", chunkRecords);
  stageJsonlOutput(state, ".context/cache/entities.module.jsonl", moduleRecords);
  stageJsonlOutput(state, ".context/cache/entities.project.jsonl", projectRecords);
  stageJsonlOutput(state, ".context/cache/relations.supersedes.jsonl", supersedesRelations);
  stageJsonlOutput(state, ".context/cache/relations.constrains.jsonl", constrainsRelations);
  stageJsonlOutput(state, ".context/cache/relations.implements.jsonl", implementsRelations);
  stageJsonlOutput(state, ".context/cache/relations.defines.jsonl", validDefinesRelations);
  stageJsonlOutput(state, ".context/cache/relations.calls.jsonl", validCallsRelations);
  stageJsonlOutput(state, ".context/cache/relations.imports.jsonl", validImportsRelations);
  stageJsonlOutput(state, ".context/cache/relations.calls_sql.jsonl", validCallsSqlRelations);
  stageJsonlOutput(state, ".context/cache/relations.uses_config_key.jsonl", validUsesConfigKeyRelations);
  stageJsonlOutput(state, ".context/cache/relations.uses_resource_key.jsonl", validUsesResourceKeyRelations);
  stageJsonlOutput(state, ".context/cache/relations.uses_setting_key.jsonl", validUsesSettingKeyRelations);
  stageJsonlOutput(state, ".context/cache/relations.contains.jsonl", moduleContainsRelations);
  stageJsonlOutput(state, ".context/cache/relations.contains_module.jsonl", moduleContainsModuleRelations);
  stageJsonlOutput(state, ".context/cache/relations.exports.jsonl", moduleExportsRelations);
  stageJsonlOutput(state, ".context/cache/relations.includes_file.jsonl", projectIncludesFileRelations);
  stageJsonlOutput(state, ".context/cache/relations.uses_resource.jsonl", usesResourceRelations);
  stageJsonlOutput(state, ".context/cache/relations.uses_setting.jsonl", usesSettingRelations);
  stageJsonlOutput(state, ".context/cache/relations.uses_config.jsonl", usesConfigRelations);
  stageJsonlOutput(state, ".context/cache/relations.transforms_config.jsonl", configTransformRelations);
  stageJsonlOutput(state, ".context/cache/relations.references_project.jsonl", projectReferencesProjectRelations);
  const dialectSidecar = serializeDialectObservationSidecar([...dialectRecordMap.values()]);
  const dialectSummary = summarizeDialectObservationSidecar(dialectSidecar);
  state.outputSet.stage(DIALECT_OBSERVATION_OUTPUT_IDENTITY, (descriptor) => {
    fs.writeSync(descriptor, dialectSidecar.text, undefined, "utf8");
  });
  memoryTrace.checkpoint("writes:cache_complete", {
    jsonl_files: 27,
    files: fileRecords.length,
    chunks: chunkRecords.length,
    dialect_files: dialectSidecar.records.length,
    dialect_observations: dialectSummary.observations
  });
  Object.assign(state, { dialectSidecar, dialectSummary });
}

function runDatabaseWriteStage(state) {
  const {
    memoryTrace,
    fileRecords,
    adrRecords,
    ruleRecords,
    chunkRecords,
    supersedesRelations,
    constrainsRelations,
    implementsRelations,
    validDefinesRelations,
    validCallsRelations,
    validImportsRelations,
    validCallsSqlRelations,
    validUsesConfigKeyRelations,
    validUsesResourceKeyRelations,
    validUsesSettingKeyRelations,
    moduleRecords,
    moduleContainsRelations,
    moduleContainsModuleRelations,
    moduleExportsRelations,
    projectRecords,
    projectIncludesFileRelations,
    projectReferencesProjectRelations,
    usesResourceRelations,
    usesSettingRelations,
    usesConfigRelations,
    configTransformRelations
  } = state;
  memoryTrace.checkpoint("writes:db_start", {
    tsv_files: 21
  });
  stageTsvOutput(
    state,
    ".context/db/import/file_nodes.tsv",
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
    mapRows(fileRecords, (record) => [
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

  stageTsvOutput(
    state,
    ".context/db/import/rule_nodes.tsv",
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
    mapRows(ruleRecords, (record) => [
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

  stageTsvOutput(
    state,
    ".context/db/import/adr_nodes.tsv",
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
    mapRows(adrRecords, (record) => [
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

  stageTsvOutput(
    state,
    ".context/db/import/constrains_rel.tsv",
    ["from", "to", "note"],
    mapRows(constrainsRelations, (record) => [record.from, record.to, record.note])
  );

  stageTsvOutput(
    state,
    ".context/db/import/implements_rel.tsv",
    ["from", "to", "note"],
    mapRows(implementsRelations, (record) => [record.from, record.to, record.note])
  );

  stageTsvOutput(
    state,
    ".context/db/import/supersedes_rel.tsv",
    ["from", "to", "reason"],
    mapRows(supersedesRelations, (record) => [record.from, record.to, record.reason])
  );

  stageTsvOutput(
    state,
    ".context/db/import/chunk_nodes.tsv",
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
    mapRows(chunkRecords, (record) => [
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

  stageTsvOutput(
    state,
    ".context/db/import/defines_rel.tsv",
    ["from", "to"],
    mapRows(validDefinesRelations, (record) => [record.from, record.to])
  );

  stageTsvOutput(
    state,
    ".context/db/import/calls_rel.tsv",
    ["from", "to", "call_type"],
    mapRows(validCallsRelations, (record) => [record.from, record.to, record.call_type])
  );

  stageTsvOutput(
    state,
    ".context/db/import/imports_rel.tsv",
    ["from", "to", "import_name"],
    mapRows(validImportsRelations, (record) => [record.from, record.to, record.import_name])
  );

  stageTsvOutput(
    state,
    ".context/db/import/calls_sql_rel.tsv",
    ["from", "to", "note"],
    mapRows(validCallsSqlRelations, (record) => [record.from, record.to, record.note])
  );

  stageTsvOutput(
    state,
    ".context/db/import/uses_config_key_rel.tsv",
    ["from", "to", "note"],
    mapRows(validUsesConfigKeyRelations, (record) => [record.from, record.to, record.note])
  );

  stageTsvOutput(
    state,
    ".context/db/import/uses_resource_key_rel.tsv",
    ["from", "to", "note"],
    mapRows(validUsesResourceKeyRelations, (record) => [record.from, record.to, record.note])
  );

  stageTsvOutput(
    state,
    ".context/db/import/uses_setting_key_rel.tsv",
    ["from", "to", "note"],
    mapRows(validUsesSettingKeyRelations, (record) => [record.from, record.to, record.note])
  );

  stageTsvOutput(
    state,
    ".context/db/import/project_nodes.tsv",
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
    mapRows(projectRecords, (record) => [
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

  stageTsvOutput(
    state,
    ".context/db/import/includes_file_rel.tsv",
    ["from", "to"],
    mapRows(projectIncludesFileRelations, (record) => [record.from, record.to])
  );

  stageTsvOutput(
    state,
    ".context/db/import/references_project_rel.tsv",
    ["from", "to", "note"],
    mapRows(projectReferencesProjectRelations, (record) => [record.from, record.to, record.note])
  );

  stageTsvOutput(
    state,
    ".context/db/import/uses_resource_rel.tsv",
    ["from", "to", "note"],
    mapRows(usesResourceRelations, (record) => [record.from, record.to, record.note])
  );

  stageTsvOutput(
    state,
    ".context/db/import/uses_setting_rel.tsv",
    ["from", "to", "note"],
    mapRows(usesSettingRelations, (record) => [record.from, record.to, record.note])
  );

  stageTsvOutput(
    state,
    ".context/db/import/uses_config_rel.tsv",
    ["from", "to", "note"],
    mapRows(usesConfigRelations, (record) => [record.from, record.to, record.note])
  );

  stageTsvOutput(
    state,
    ".context/db/import/transforms_config_rel.tsv",
    ["from", "to", "note"],
    mapRows(configTransformRelations, (record) => [record.from, record.to, record.note])
  );
  memoryTrace.checkpoint("writes:db_complete", {
    tsv_files: 21
  });
}

function runManifestCompletionStage(state) {
  const {
    mode,
    memoryTrace,
    sourcePaths,
    candidates,
    incrementalMode,
    deletedRelPaths,
    fileRecords,
    adrRecords,
    ruleRecords,
    chunkRecords,
    constrainsRelations,
    implementsRelations,
    supersedesRelations,
    validDefinesRelations,
    validCallsRelations,
    validImportsRelations,
    validCallsSqlRelations,
    validUsesConfigKeyRelations,
    validUsesResourceKeyRelations,
    validUsesSettingKeyRelations,
    moduleRecords,
    moduleContainsRelations,
    moduleContainsModuleRelations,
    moduleExportsRelations,
    projectRecords,
    projectIncludesFileRelations,
    projectReferencesProjectRelations,
    usesResourceRelations,
    usesSettingRelations,
    usesConfigRelations,
    configTransformRelations,
    skipped,
    parserHealth,
    dialectSummary
  } = state;
  const manifest = {
    schema_version: 2,
    generation_id: crypto.randomUUID(),
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
    parser_health: parserHealth,
    incremental_mode: incrementalMode,
    changed_candidates: candidates.size,
    deleted_paths: deletedRelPaths.length,
    [DIALECT_MANIFEST_FIELD]: dialectSummary
  };

  state.outputSet.stage(INGEST_MANIFEST_OUTPUT_IDENTITY, (descriptor) => {
    fs.writeSync(descriptor, `${JSON.stringify(manifest, null, 2)}\n`, undefined, "utf8");
  });
  state.outputSet.commit();
  memoryTrace.checkpoint("writes:manifest_complete", {
    files: manifest.counts.files,
    chunks: manifest.counts.chunks,
    total_relations:
      manifest.counts.relations_constrains +
      manifest.counts.relations_implements +
      manifest.counts.relations_supersedes +
      manifest.counts.relations_defines +
      manifest.counts.relations_calls +
      manifest.counts.relations_imports +
      manifest.counts.relations_calls_sql +
      manifest.counts.relations_uses_config_key +
      manifest.counts.relations_uses_resource_key +
      manifest.counts.relations_uses_setting_key +
      manifest.counts.relations_contains +
      manifest.counts.relations_contains_module +
      manifest.counts.relations_exports +
      manifest.counts.relations_includes_file +
      manifest.counts.relations_references_project +
      manifest.counts.relations_uses_resource +
      manifest.counts.relations_uses_setting +
      manifest.counts.relations_uses_config +
      manifest.counts.relations_transforms_config
  });

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
  state.manifest = manifest;
}

export {
  DIALECT_FILE_RECORD_TYPE,
  DIALECT_INDEX_ID,
  DIALECT_MANIFEST_FIELD,
  createDialectObservationFileRecord,
  createIngestPipelineState,
  ensureIngestOutputDirectories,
  parseDialectObservationSidecar,
  runCacheWriteStage,
  runDatabaseWriteStage,
  runFileCacheStagingStage,
  runManifestCompletionStage,
  runMaterializationStage,
  runParseStage,
  runScanHydrationStage,
  runTokenMatchingStage,
  serializeDialectObservationSidecar,
  summarizeDialectObservationSidecar,
  validateDialectObservationFileRecord
};
