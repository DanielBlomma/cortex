import path from "node:path";
import { readJsonlSafe } from "./io.mjs";
import { relationKey } from "./relations.mjs";
import { CACHE_DIR } from "./runtime-paths.mjs";

export function removeChunkStateForFile(fileId, chunkRecordMap, definesRelationMap, callsRelationMap, importsRelationMap, callsSqlRelationMap) {
  const removedChunkIds = new Set();

  for (const [chunkId, chunkRecord] of chunkRecordMap.entries()) {
    if (chunkRecord.file_id === fileId) {
      removedChunkIds.add(chunkId);
      chunkRecordMap.delete(chunkId);
    }
  }

  if (removedChunkIds.size === 0) {
    return;
  }

  for (const [key, relation] of definesRelationMap.entries()) {
    if (relation.from === fileId || removedChunkIds.has(relation.to)) {
      definesRelationMap.delete(key);
    }
  }

  for (const [key, relation] of callsRelationMap.entries()) {
    if (removedChunkIds.has(relation.from) || removedChunkIds.has(relation.to)) {
      callsRelationMap.delete(key);
    }
  }

  for (const [key, relation] of importsRelationMap.entries()) {
    if (removedChunkIds.has(relation.from)) {
      importsRelationMap.delete(key);
    }
  }

  for (const [key, relation] of callsSqlRelationMap.entries()) {
    if (relation.from === fileId || removedChunkIds.has(relation.to)) {
      callsSqlRelationMap.delete(key);
    }
  }
}

export function hydrateIncrementalChunkState(fileRecords) {
  const fileIdSet = new Set(fileRecords.map((record) => record.id));
  const chunkRecordMap = new Map();
  const definesRelationMap = new Map();
  const callsRelationMap = new Map();
  const importsRelationMap = new Map();
  const callsSqlRelationMap = new Map();

  for (const record of readJsonlSafe(path.join(CACHE_DIR, "entities.chunk.jsonl"))) {
    if (!record || typeof record !== "object") continue;
    const chunkId = String(record.id ?? "");
    const fileId = String(record.file_id ?? "");
    if (!chunkId || !fileIdSet.has(fileId)) {
      continue;
    }
    chunkRecordMap.set(chunkId, {
      ...record,
      id: chunkId,
      file_id: fileId
    });
  }

  const chunkIdSet = new Set(chunkRecordMap.keys());

  for (const record of readJsonlSafe(path.join(CACHE_DIR, "relations.defines.jsonl"))) {
    if (!record || typeof record !== "object") continue;
    const from = String(record.from ?? "");
    const to = String(record.to ?? "");
    if (!fileIdSet.has(from) || !chunkIdSet.has(to)) {
      continue;
    }
    definesRelationMap.set(relationKey(from, to), { from, to });
  }

  for (const record of readJsonlSafe(path.join(CACHE_DIR, "relations.calls.jsonl"))) {
    if (!record || typeof record !== "object") continue;
    const from = String(record.from ?? "");
    const to = String(record.to ?? "");
    const callType = String(record.call_type ?? "direct");
    if (!chunkIdSet.has(from) || !chunkIdSet.has(to)) {
      continue;
    }
    callsRelationMap.set(relationKey(from, to, callType), {
      from,
      to,
      call_type: callType
    });
  }

  for (const record of readJsonlSafe(path.join(CACHE_DIR, "relations.imports.jsonl"))) {
    if (!record || typeof record !== "object") continue;
    const from = String(record.from ?? "");
    const to = String(record.to ?? "");
    const importName = String(record.import_name ?? "");
    if (!chunkIdSet.has(from) || !fileIdSet.has(to)) {
      continue;
    }
    importsRelationMap.set(relationKey(from, to, importName), {
      from,
      to,
      import_name: importName
    });
  }

  for (const record of readJsonlSafe(path.join(CACHE_DIR, "relations.calls_sql.jsonl"))) {
    if (!record || typeof record !== "object") continue;
    const from = String(record.from ?? "");
    const to = String(record.to ?? "");
    const note = String(record.note ?? "");
    if (!fileIdSet.has(from) || !chunkIdSet.has(to)) {
      continue;
    }
    callsSqlRelationMap.set(relationKey(from, to, note), {
      from,
      to,
      note
    });
  }

  return {
    chunkRecordMap,
    definesRelationMap,
    callsRelationMap,
    importsRelationMap,
    callsSqlRelationMap
  };
}
