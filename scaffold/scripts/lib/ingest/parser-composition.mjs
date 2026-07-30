import path from "node:path";
import {
  getChunkParserForExtension,
  getCSharpParserRuntime,
  hasCSharpProjectParser,
  isCSharpParserAvailable,
  loadParsers,
  parseCSharpProject,
  PARALLEL_SAFE_LANGUAGES
} from "./parser-registry.mjs";
import {
  MAX_CONTENT_CHARS,
  STRUCTURED_NON_CODE_CHUNK_EXTENSIONS
} from "./constants.mjs";
import { REPO_ROOT } from "./runtime-paths.mjs";

async function initializeParserComposition() {
  await loadParsers();
}

function inspectCSharpParser(fileRecords) {
  const fileCount = fileRecords.filter(
    (record) => path.extname(record.path).toLowerCase() === ".cs"
  ).length;
  return {
    fileCount,
    runtime: fileCount > 0 ? getCSharpParserRuntime() : null
  };
}

function createCSharpBatchCache({
  fileRecords,
  incrementalMode,
  changedFileIds,
  cachedChunkFileIds,
  verbose
}) {
  const batchCache = new Map();
  if (
    hasCSharpProjectParser() &&
    isCSharpParserAvailable() &&
    process.env.CORTEX_CSHARP_BATCH !== "never"
  ) {
    const csharpFilesForBatch = fileRecords.filter((record) => {
      if (record.kind !== "CODE") return false;
      if (path.extname(record.path).toLowerCase() !== ".cs") return false;
      return (
        !incrementalMode ||
        changedFileIds.has(record.id) ||
        !cachedChunkFileIds.has(record.id)
      );
    });
    if (csharpFilesForBatch.length > 0) {
      const allCsharpInputs = fileRecords
        .filter(
          (record) =>
            record.kind === "CODE" &&
            path.extname(record.path).toLowerCase() === ".cs"
        )
        .map((record) => ({ path: record.path, content: record.content }));
      try {
        const batchResult = parseCSharpProject(allCsharpInputs);
        for (const [filePath, result] of batchResult) {
          batchCache.set(filePath, result);
        }
      } catch (error) {
        if (verbose) {
          console.log(
            `[ingest] C# batch parse failed, falling back per-file: ${error.message}`
          );
        }
      }
    }
  }
  return batchCache;
}

async function collectParseEligibleFiles({
  fileRecords,
  incrementalMode,
  changedFileIds,
  cachedChunkFileIds
}) {
  const parseEligible = new Map();
  for (const fileRecord of fileRecords) {
    const ext = path.extname(fileRecord.path).toLowerCase();
    const parser = getChunkParserForExtension(ext);
    const isStructuredNonCodeChunk = STRUCTURED_NON_CODE_CHUNK_EXTENSIONS.has(ext);
    if (fileRecord.kind !== "CODE" && !isStructuredNonCodeChunk) continue;
    if (!parser) continue;
    if (
      typeof parser.isAvailable === "function" &&
      !(await parser.isAvailable())
    ) {
      continue;
    }

    const shouldParseFile =
      !incrementalMode ||
      changedFileIds.has(fileRecord.id) ||
      !cachedChunkFileIds.has(fileRecord.id);
    if (!shouldParseFile) {
      continue;
    }
    parseEligible.set(fileRecord.id, { parser, ext });
  }
  return parseEligible;
}

function createWorkerTasks(fileRecords, parseEligible, csharpBatchCache) {
  return fileRecords
    .filter((fileRecord) => {
      const eligible = parseEligible.get(fileRecord.id);
      if (!eligible) return false;
      if (!PARALLEL_SAFE_LANGUAGES.has(eligible.parser.language)) return false;
      if (
        eligible.parser.language === "csharp" &&
        csharpBatchCache.has(fileRecord.path)
      ) {
        return false;
      }
      return true;
    })
    .map((fileRecord) => ({
      id: fileRecord.id,
      ext: parseEligible.get(fileRecord.id).ext,
      absolutePath: path.resolve(REPO_ROOT, fileRecord.path),
      contentLimit: MAX_CONTENT_CHARS,
      path: fileRecord.path
    }));
}

export {
  collectParseEligibleFiles,
  createCSharpBatchCache,
  createWorkerTasks,
  getChunkParserForExtension,
  initializeParserComposition,
  inspectCSharpParser
};
