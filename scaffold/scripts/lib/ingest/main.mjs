#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import {
  loadParsers,
  getChunkParserForExtension,
  parseCSharpProject,
  hasCSharpProjectParser,
  isCSharpParserAvailable,
  getCSharpParserRuntime,
  PARALLEL_SAFE_LANGUAGES
} from "../../ingest-parsers.mjs";
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
  MAX_FILE_BYTES,
  STRUCTURED_NON_CODE_CHUNK_EXTENSIONS
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
  generateModuleSummary,
  isWindowChunkId,
  splitChunkIntoWindows
} from "./chunks.mjs";
import {
  adrTokens,
  checksum,
  collectCandidateFiles,
  detectKind,
  ensureDirectory,
  extractTitle,
  findSupersedesReferences,
  hasSourcePrefix,
  isBinaryBuffer,
  isTextFile,
  normalizeToken,
  normalizeWhitespace,
  parseDecisionDate,
  resolveRelativeImportTargetId,
  toPosixPath,
  trustLevelForKind
} from "./files.mjs";
import {
  countFileContentRecords,
  mapRows,
  readJsonlSafe,
  stageJsonl,
  writeJsonl,
  writeTsv
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
import {
  CACHE_DIR,
  CONTEXT_DIR,
  DB_IMPORT_DIR,
  REPO_ROOT
} from "./runtime-paths.mjs";

function resolveIngestWorkerCount(taskCount) {
  const raw = process.env.CORTEX_INGEST_WORKERS;
  const configured = raw !== undefined ? Number.parseInt(raw, 10) : Number.NaN;
  const cpuBudget = Math.max(1, (os.availableParallelism?.() ?? os.cpus().length) - 1);
  const defaultWorkerLimit = taskCount >= 1000 ? 4 : 8;
  const desired = Number.isFinite(configured) && configured >= 0 ? configured : Math.min(cpuBudget, defaultWorkerLimit);
  if (desired <= 1) return 1;
  // Worker spin-up plus per-worker WASM grammar init dominates on small or
  // incremental runs; stay sequential until there is enough work to amortize.
  if (taskCount < 50) return 1;
  return Math.min(desired, taskCount);
}

function createEmptyWorkerParseStream(tasks, workerCount) {
  const stats = () => ({
    worker_tasks: tasks.length,
    worker_count: Number.isFinite(workerCount) ? workerCount : 0,
    worker_tasks_assigned: 0,
    worker_tasks_settled: 0,
    worker_tasks_unsettled_fallback: tasks.length,
    worker_results: 0,
    worker_results_consumed: 0,
    worker_results_retained: 0,
    worker_results_retained_peak: 0,
    worker_results_pending: 0,
    worker_results_missing: tasks.length,
    worker_waiters: 0
  });
  return {
    hasTask: () => false,
    stats,
    take: async () => undefined,
    drain: async () => stats()
  };
}

function startWorkerParseStream(tasks, { workerCount, verbose, workerUrl } = {}) {
  if (tasks.length === 0) {
    return createEmptyWorkerParseStream(tasks, workerCount);
  }

  const resolvedWorkerUrl = workerUrl ?? new URL("../../ingest-worker.mjs", import.meta.url);
  const poolSize = Math.min(workerCount, tasks.length);
  // Defensive: an undefined/0/negative/NaN workerCount yields poolSize < 1, in
  // which case no workers are ever spawned and the pool would never resolve.
  // Return empty so the caller parses everything inline. (Math.min(undefined, n)
  // is NaN, which is why this is `!(>= 1)` rather than `< 1`.)
  if (!(poolSize >= 1)) {
    return createEmptyWorkerParseStream(tasks, workerCount);
  }

  const taskIds = new Set(tasks.map((task) => task.id));
  const results = new Map();
  const missingResults = new Set();
  const waiters = new Map();
  const workers = [];
  const inflight = new Map(); // worker -> taskId being parsed, or null when idle
  let nextTask = 0;
  let alive = poolSize;
  let finished = false;
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const state = {
    assigned: 0,
    settled: 0,
    successful: 0,
    consumed: 0,
    retainedPeak: 0
  };

  const stats = () => ({
    worker_tasks: tasks.length,
    worker_count: poolSize,
    worker_tasks_assigned: state.assigned,
    worker_tasks_settled: state.settled,
    worker_tasks_unsettled_fallback: finished ? Math.max(0, tasks.length - state.settled) : 0,
    worker_results: state.successful,
    worker_results_consumed: state.consumed,
    worker_results_retained: results.size,
    worker_results_retained_peak: state.retainedPeak,
    worker_results_pending: finished ? 0 : Math.max(0, tasks.length - state.settled),
    worker_results_missing: tasks.length - state.successful,
    worker_waiters: waiters.size
  });

  const finish = () => {
    if (finished) return;
    finished = true;
    for (const resolve of waiters.values()) {
      resolve(undefined);
    }
    waiters.clear();
    resolveDone();
  };

  // A task is "settled" once it has a result, was skipped, or its worker
  // died holding it. Finish when every task is settled, or when no worker is
  // left alive to make progress (any still-queued tasks then parse inline).
  const maybeFinish = () => {
    if (state.settled >= tasks.length || alive <= 0) {
      finish();
    }
  };

  const resolveWaiter = (taskId, result) => {
    const resolve = waiters.get(taskId);
    if (!resolve) {
      return false;
    }
    waiters.delete(taskId);
    if (result !== undefined) {
      state.consumed += 1;
    }
    resolve(result);
    return true;
  };

  const settleTask = (taskId, result) => {
    state.settled += 1;
    if (result !== undefined) {
      state.successful += 1;
      if (!resolveWaiter(taskId, result)) {
        results.set(taskId, result);
        state.retainedPeak = Math.max(state.retainedPeak, results.size);
      }
    } else {
      missingResults.add(taskId);
      resolveWaiter(taskId, undefined);
    }
    maybeFinish();
  };

  const assign = (worker) => {
    if (nextTask >= tasks.length) {
      inflight.set(worker, null);
      worker.postMessage({ type: "shutdown" });
      return;
    }
    const task = tasks[nextTask++];
    state.assigned += 1;
    inflight.set(worker, task.id);
    worker.postMessage({
      taskId: task.id,
      ext: task.ext,
      content: task.content,
      absolutePath: task.absolutePath,
      contentLimit: task.contentLimit,
      filePath: task.path
    });
  };

  const onMessage = (worker, message) => {
    if (finished) return;
    inflight.set(worker, null);
    if (message.ok) {
      settleTask(message.taskId, message.result);
    } else {
      if (verbose) {
        console.log(`[ingest] worker skipped ${message.taskId}: ${message.reason}`);
      }
      settleTask(message.taskId, undefined);
    }
    if (!finished) {
      assign(worker);
    }
  };

  const onExit = (worker) => {
    if (finished) return;
    alive -= 1;
    const taskId = inflight.get(worker);
    if (taskId != null) {
      // Worker exited mid-parse without posting a result (OOM, native abort,
      // process.exit) and without an 'error' event. Count its in-flight task
      // as settled so it falls back to inline parsing rather than leaving the
      // pool waiting on a dead worker forever.
      if (verbose) {
        console.log(`[ingest] worker exited mid-task ${taskId}; will parse inline`);
      }
      inflight.set(worker, null);
      settleTask(taskId, undefined);
      return;
    }
    maybeFinish();
  };

  for (let i = 0; i < poolSize; i += 1) {
    const worker = new Worker(resolvedWorkerUrl);
    workers.push(worker);
    worker.on("message", (message) => onMessage(worker, message));
    worker.on("error", (error) => {
      // Uncaught exception in the worker. The 'exit' event that always
      // follows does the task accounting (idempotent via inflight), so we
      // only log here to avoid double-counting.
      if (verbose) {
        console.log(`[ingest] worker error: ${error.message}`);
      }
    });
    worker.on("exit", () => onExit(worker));
  }

  for (const worker of workers) {
    assign(worker);
  }

  return {
    hasTask(taskId) {
      return taskIds.has(taskId);
    },
    stats,
    async take(taskId) {
      if (!taskIds.has(taskId)) {
        return undefined;
      }
      if (results.has(taskId)) {
        const result = results.get(taskId);
        results.delete(taskId);
        state.consumed += 1;
        return result;
      }
      if (missingResults.has(taskId) || finished) {
        return undefined;
      }
      return new Promise((resolve) => {
        waiters.set(taskId, resolve);
      });
    },
    async drain() {
      await done;
      await Promise.all(workers.map((worker) => worker.terminate().catch(() => {})));
      return stats();
    }
  };
}

// Parse files in a worker pool, returning Map<fileId, parseResult> for the
// tasks that completed. Any task not present (worker miss, skip, or a fatal
// worker error) is left to the caller's inline parse — the same parse
// function on the same content, so output is identical either way. Never
// rejects: a fatal worker error resolves with the partial results collected
// so far.
async function parseFilesInWorkers(tasks, options = {}) {
  const stream = startWorkerParseStream(tasks, options);
  const results = new Map();
  for (const task of tasks) {
    const result = await stream.take(task.id);
    if (result) {
      results.set(task.id, result);
    }
  }

  await stream.drain();
  return results;
}

async function main() {
  await loadParsers();
  const { mode, verbose } = parseArgs(process.argv);
  const memoryTrace = createIngestMemoryTrace();
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
  memoryTrace.checkpoint("scan:start", {
    mode,
    source_paths: sourcePaths.length,
    rules: rules.length
  });
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
  const csharpFileCount = fileRecords.filter((record) => path.extname(record.path).toLowerCase() === ".cs").length;
  const csharpRuntime = csharpFileCount > 0 ? getCSharpParserRuntime() : null;
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
  memoryTrace.checkpoint("hydration:complete", {
    incremental_mode: incrementalMode,
    cached_chunks: chunkRecordMap.size,
    cached_defines_relations: definesRelationMap.size,
    cached_calls_relations: callsRelationMap.size,
    cached_imports_relations: importsRelationMap.size,
    cached_calls_sql_relations: callsSqlRelationMap.size
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

  // C# project-wide batch parse: when Roslyn is available and batching
  // isn't disabled, compile all .cs files together via CSharpCompilation
  // to enable SemanticModel-resolved calls (e.g. "System.IO.File.ReadAllText"
  // instead of bare "ReadAllText"). Falls back silently to per-file parse
  // if batch isn't usable.
  const csharpBatchCache = new Map();
  if (
    hasCSharpProjectParser() &&
    isCSharpParserAvailable() &&
    process.env.CORTEX_CSHARP_BATCH !== "never"
  ) {
    const csharpFilesForBatch = fileRecords.filter((r) => {
      if (r.kind !== "CODE") return false;
      if (path.extname(r.path).toLowerCase() !== ".cs") return false;
      return !incrementalMode || changedFileIds.has(r.id) || !cachedChunkFileIds.has(r.id);
    });
    if (csharpFilesForBatch.length > 0) {
      const allCsharpInputs = fileRecords
        .filter((r) => r.kind === "CODE" && path.extname(r.path).toLowerCase() === ".cs")
        .map((r) => ({ path: r.path, content: r.content }));
      try {
        const batchResult = parseCSharpProject(allCsharpInputs);
        for (const [filePath, result] of batchResult) {
          csharpBatchCache.set(filePath, result);
        }
      } catch (error) {
        if (verbose) {
          console.log(`[ingest] C# batch parse failed, falling back per-file: ${error.message}`);
        }
      }
    }
  }

  // Determine which files need parsing (single pass over the gates, shared by
  // the worker dispatch and the merge loop below so the two cannot diverge).
  const parseEligible = new Map();
  for (const fileRecord of fileRecords) {
    const ext = path.extname(fileRecord.path).toLowerCase();
    const parser = getChunkParserForExtension(ext);
    const isStructuredNonCodeChunk = STRUCTURED_NON_CODE_CHUNK_EXTENSIONS.has(ext);
    if (fileRecord.kind !== "CODE" && !isStructuredNonCodeChunk) continue;
    if (!parser) continue;
    if (typeof parser.isAvailable === "function" && !(await parser.isAvailable())) continue;

    const shouldParseFile =
      !incrementalMode || changedFileIds.has(fileRecord.id) || !cachedChunkFileIds.has(fileRecord.id);
    if (!shouldParseFile) {
      continue;
    }
    parseEligible.set(fileRecord.id, { parser, ext });
  }
  memoryTrace.checkpoint("parse:eligible", {
    files: fileRecords.length,
    parse_eligible: parseEligible.size,
    csharp_batch_cached: csharpBatchCache.size
  });

  // Parse parallel-safe files (tree-sitter/JS, no subprocess, no cross-file
  // state) in a worker pool. C# batch-cached files and any worker miss fall
  // through to inline parsing in the loop, so the result is byte-identical to
  // the sequential path regardless of where a file actually parsed.
  const workerTasks = fileRecords
    .filter((fileRecord) => {
      const eligible = parseEligible.get(fileRecord.id);
      if (!eligible) return false;
      if (!PARALLEL_SAFE_LANGUAGES.has(eligible.parser.language)) return false;
      if (eligible.parser.language === "csharp" && csharpBatchCache.has(fileRecord.path)) return false;
      return true;
    })
    .map((fileRecord) => ({
      id: fileRecord.id,
      ext: parseEligible.get(fileRecord.id).ext,
      absolutePath: path.resolve(REPO_ROOT, fileRecord.path),
      contentLimit: MAX_CONTENT_CHARS,
      path: fileRecord.path
    }));
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

    removeChunkStateForFile(
      fileRecord.id,
      chunkRecordMap,
      definesRelationMap,
      callsRelationMap,
      importsRelationMap,
      callsSqlRelationMap
    );

    try {
      let parseResult;
      if (parser.language === "csharp" && csharpBatchCache.has(fileRecord.path)) {
        parseResult = csharpBatchCache.get(fileRecord.path);
      } else if (workerStream?.hasTask(fileRecord.id)) {
        parseResult = await workerStream.take(fileRecord.id);
        if (!parseResult) {
          parseResult = await parser.parse(fileRecord.content, fileRecord.path, parser.language);
        }
      } else {
        parseResult = await parser.parse(fileRecord.content, fileRecord.path, parser.language);
      }

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

  const constrainsRelations = [];
  const implementsRelations = [];
  const stagedDocumentCache = stageJsonl(path.join(CACHE_DIR, "documents.jsonl"), fileRecords);
  const stagedFileEntityCache = stageJsonl(path.join(CACHE_DIR, "entities.file.jsonl"), fileRecords);
  memoryTrace.checkpoint("writes:file_cache_staged", {
    files: fileRecords.length,
    file_content_records: countFileContentRecords(fileRecords)
  });
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

  memoryTrace.checkpoint("writes:cache_start", {
    files: fileRecords.length,
    adrs: adrRecords.length,
    rules: ruleRecords.length,
    chunks: chunkRecords.length
  });
  stagedDocumentCache.commit();
  stagedFileEntityCache.commit();
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
  memoryTrace.checkpoint("writes:cache_complete", {
    jsonl_files: 26,
    files: fileRecords.length,
    chunks: chunkRecords.length
  });

  memoryTrace.checkpoint("writes:db_start", {
    tsv_files: 21
  });
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

  writeTsv(
    path.join(DB_IMPORT_DIR, "constrains_rel.tsv"),
    ["from", "to", "note"],
    mapRows(constrainsRelations, (record) => [record.from, record.to, record.note])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "implements_rel.tsv"),
    ["from", "to", "note"],
    mapRows(implementsRelations, (record) => [record.from, record.to, record.note])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "supersedes_rel.tsv"),
    ["from", "to", "reason"],
    mapRows(supersedesRelations, (record) => [record.from, record.to, record.reason])
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

  writeTsv(
    path.join(DB_IMPORT_DIR, "defines_rel.tsv"),
    ["from", "to"],
    mapRows(validDefinesRelations, (record) => [record.from, record.to])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "calls_rel.tsv"),
    ["from", "to", "call_type"],
    mapRows(validCallsRelations, (record) => [record.from, record.to, record.call_type])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "imports_rel.tsv"),
    ["from", "to", "import_name"],
    mapRows(validImportsRelations, (record) => [record.from, record.to, record.import_name])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "calls_sql_rel.tsv"),
    ["from", "to", "note"],
    mapRows(validCallsSqlRelations, (record) => [record.from, record.to, record.note])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "uses_config_key_rel.tsv"),
    ["from", "to", "note"],
    mapRows(validUsesConfigKeyRelations, (record) => [record.from, record.to, record.note])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "uses_resource_key_rel.tsv"),
    ["from", "to", "note"],
    mapRows(validUsesResourceKeyRelations, (record) => [record.from, record.to, record.note])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "uses_setting_key_rel.tsv"),
    ["from", "to", "note"],
    mapRows(validUsesSettingKeyRelations, (record) => [record.from, record.to, record.note])
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

  writeTsv(
    path.join(DB_IMPORT_DIR, "includes_file_rel.tsv"),
    ["from", "to"],
    mapRows(projectIncludesFileRelations, (record) => [record.from, record.to])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "references_project_rel.tsv"),
    ["from", "to", "note"],
    mapRows(projectReferencesProjectRelations, (record) => [record.from, record.to, record.note])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "uses_resource_rel.tsv"),
    ["from", "to", "note"],
    mapRows(usesResourceRelations, (record) => [record.from, record.to, record.note])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "uses_setting_rel.tsv"),
    ["from", "to", "note"],
    mapRows(usesSettingRelations, (record) => [record.from, record.to, record.note])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "uses_config_rel.tsv"),
    ["from", "to", "note"],
    mapRows(usesConfigRelations, (record) => [record.from, record.to, record.note])
  );

  writeTsv(
    path.join(DB_IMPORT_DIR, "transforms_config_rel.tsv"),
    ["from", "to", "note"],
    mapRows(configTransformRelations, (record) => [record.from, record.to, record.note])
  );
  memoryTrace.checkpoint("writes:db_complete", {
    tsv_files: 21
  });

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
    parser_health: parserHealth,
    incremental_mode: incrementalMode,
    changed_candidates: candidates.size,
    deleted_paths: deletedRelPaths.length
  };

  fs.writeFileSync(path.join(CACHE_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
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
}

export {
  buildChunkAliasIndexes,
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
  main,
  parseFilesInWorkers,
  resolveIngestWorkerCount,
  resolveRelativeImportTargetId
};
