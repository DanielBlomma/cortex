/**
 * Compile a TurboQuant index from embedded vectors. Runs at the tail of the
 * embed step. Small corpora are skipped: below the threshold the exact scan is
 * already sub-millisecond and quantization's recall risk is not worth it.
 */
import fs from "node:fs";
import { PATHS } from "./paths.js";
import { encodeTurboQuant, fitTurboQuant } from "./turboquant.js";
import { writeTurboQuantIndex } from "./turboquantIndex.js";

const DEFAULT_MIN_QUANTIZE_SIZE = 4096;

export interface VectorRecord {
  id: string;
  vector: Float32Array | ArrayLike<number>;
}

export interface CompileResult {
  written: boolean;
  reason?: string;
  size?: number;
  bits?: number;
}

// Fingerprint (mtime:size) of the embeddings file the artifact is built from,
// stamped into the index so the loader can detect staleness against the
// current entities.jsonl. Matches the scheme loadEmbeddingIndex keys on.
export function embeddingsFingerprint(filePath: string = PATHS.embeddingsEntities): string {
  try {
    const stats = fs.statSync(filePath);
    return `${Math.round(stats.mtimeMs)}:${stats.size}`;
  } catch {
    return "none";
  }
}

function minQuantizeSize(): number {
  const raw = Number(process.env.CORTEX_VECTOR_QUANTIZE_MIN);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_MIN_QUANTIZE_SIZE;
}

function quantizeBits(): number {
  const raw = Number(process.env.CORTEX_VECTOR_QUANTIZE_BITS);
  return raw === 2 ? 2 : 4;
}

export function compileTurboQuantIndex(
  records: VectorRecord[],
  model: string | null,
  filePath: string = PATHS.embeddingsTurboQuant,
  source: string | null = embeddingsFingerprint()
): CompileResult {
  // Any path that does not write a fresh artifact must drop the previous one:
  // a leftover .tqz no longer matches the current embeddings, and the freshness
  // check should never have a chance to accept it.
  const dropStale = (reason: string): CompileResult => {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
    return { written: false, reason };
  };

  const threshold = minQuantizeSize();
  if (records.length < threshold) {
    return dropStale(`corpus ${records.length} < threshold ${threshold}`);
  }

  let dim = 0;
  for (const record of records) {
    if (record.vector.length > 0) {
      dim = record.vector.length;
      break;
    }
  }
  if (dim === 0) {
    return dropStale("no non-empty vectors");
  }

  const vectors: Float32Array[] = [];
  const ids: string[] = [];
  for (const record of records) {
    if (record.vector.length !== dim) {
      continue;
    }
    vectors.push(record.vector instanceof Float32Array ? record.vector : Float32Array.from(record.vector));
    ids.push(record.id);
  }
  if (vectors.length < threshold) {
    return dropStale(`usable vectors ${vectors.length} < threshold ${threshold}`);
  }

  const bits = quantizeBits();
  const params = fitTurboQuant(vectors, dim, { bits });
  const codes = encodeTurboQuant(vectors, params);
  writeTurboQuantIndex(filePath, params, codes, ids, model, source);
  return { written: true, size: vectors.length, bits };
}
