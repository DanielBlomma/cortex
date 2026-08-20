#!/usr/bin/env node
import {
  createIngestPipelineState,
  ensureIngestOutputDirectories,
  runCacheWriteStage,
  runDatabaseWriteStage,
  runFileCacheStagingStage,
  runManifestCompletionStage,
  runMaterializationStage,
  runParseStage,
  runScanHydrationStage,
  runTokenMatchingStage
} from "./pipeline-stages.mjs";
import {
  buildChunkAliasIndexes,
  buildSqlResourceReferenceMap,
  extractSqlObjectReferencesFromContent,
  generateConfigIncludeRelations,
  generateConfigTransformKeyRelations,
  generateMachineConfigRelations,
  generateConfigTransformRelations,
  generateNamedResourceRelations,
  generateSectionHandlerRelations
} from "./relations.mjs";
import {
  detectKind,
  resolveRelativeImportTargetId
} from "./files.mjs";
import {
  generateChunkDescription,
  generateModuleSummary,
  generateModules
} from "./chunks.mjs";
import { generateProjects } from "./projects.mjs";
import {
  getChunkParserForExtension,
  initializeParserComposition
} from "./parser-composition.mjs";
import {
  parseFilesInWorkers,
  resolveIngestWorkerCount
} from "./workers.mjs";

async function main() {
  const state = createIngestPipelineState();
  await initializeParserComposition();
  runScanHydrationStage(state);
  await runParseStage(state);
  runMaterializationStage(state);
  try {
    ensureIngestOutputDirectories(state);
    runFileCacheStagingStage(state);
    runTokenMatchingStage(state);
    runCacheWriteStage(state);
    runDatabaseWriteStage(state);
    runManifestCompletionStage(state);
  } finally {
    state.outputSet?.discard();
  }
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
