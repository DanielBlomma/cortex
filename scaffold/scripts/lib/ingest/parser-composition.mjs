import path from "node:path";
import {
  getChunkParserForExtension,
  getCSharpParserRuntime,
  hasCSharpProjectDialectParser,
  hasCSharpProjectParser,
  isCSharpParserAvailable,
  loadParsers,
  parseCSharpProjectWithDialectObservations,
  PARALLEL_SAFE_LANGUAGES
} from "./parser-registry.mjs";
import {
  MAX_CONTENT_CHARS,
  STRUCTURED_NON_CODE_CHUNK_EXTENSIONS
} from "./constants.mjs";

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
  parseEligible,
  verbose
}) {
  const batchCache = new Map();
  if (
    hasCSharpProjectParser() &&
    hasCSharpProjectDialectParser() &&
    isCSharpParserAvailable() &&
    process.env.CORTEX_CSHARP_BATCH !== "never"
  ) {
    const csharpFilesForBatch = fileRecords.filter((record) =>
      path.extname(record.path).toLowerCase() === ".cs" &&
      parseEligible.get(record.id)?.useDialect === true
    );
    if (csharpFilesForBatch.length > 0) {
      const allCsharpInputs = fileRecords
        .filter(
          (record) =>
            record.kind === "CODE" &&
            path.extname(record.path).toLowerCase() === ".cs"
        )
        .map((record) => ({ path: record.path, content: record.content }));
      try {
        const batchResult = parseCSharpProjectWithDialectObservations(allCsharpInputs);
        for (const [filePath, result] of batchResult) {
          if (parseEligible.has(`file:${filePath}`)) batchCache.set(filePath, result);
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
  cachedChunkFileIds,
  cachedDialectPaths = new Set()
}) {
  const parseEligible = new Map();
  for (const fileRecord of fileRecords) {
    const ext = path.extname(fileRecord.path).toLowerCase();
    const parser = getChunkParserForExtension(ext);
    const isStructuredNonCodeChunk = STRUCTURED_NON_CODE_CHUNK_EXTENSIONS.has(ext);
    if (fileRecord.kind !== "CODE" && !isStructuredNonCodeChunk) continue;
    if (!parser) continue;
    const parserAvailable = !(
      typeof parser.isAvailable === "function" &&
      !(await parser.isAvailable())
    );
    const useDialect = fileRecord.kind === "CODE" &&
      typeof parser.parseWithDialect === "function";
    if (!parserAvailable && !useDialect) continue;

    const shouldParseLegacy = parserAvailable && (
      !incrementalMode ||
      changedFileIds.has(fileRecord.id) ||
      !cachedChunkFileIds.has(fileRecord.id)
    );
    const shouldParseDialect = useDialect && (
      !incrementalMode ||
      changedFileIds.has(fileRecord.id) ||
      !cachedDialectPaths.has(fileRecord.path)
    );
    if (!shouldParseLegacy && !shouldParseDialect) continue;
    parseEligible.set(fileRecord.id, {
      parser,
      ext,
      parserAvailable,
      shouldParseLegacy,
      useDialect
    });
  }
  return parseEligible;
}

function createWorkerTasks(fileRecords, parseEligible, csharpBatchCache, projectAnchor) {
  return fileRecords
    .filter((fileRecord) => {
      const eligible = parseEligible.get(fileRecord.id);
      if (!eligible) return false;
      if (!PARALLEL_SAFE_LANGUAGES.has(eligible.parser.language)) return false;
      if (!eligible.parserAvailable) return false;
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
      contentLimit: MAX_CONTENT_CHARS,
      dialect: Boolean(parseEligible.get(fileRecord.id).useDialect),
      projectAnchor,
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
