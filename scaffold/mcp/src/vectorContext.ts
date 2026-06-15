/**
 * Builds and caches the vector scoring backend for a search.
 *
 * The backend is the contiguous slot-array index (ExactVectorBackend): vectors
 * are embedded normalized, so cosine collapses to a cache-local dot product
 * over a single Float32Array with precomputed inverse norms. Results are
 * identical to the previous Map-based path; the layout is more compact and the
 * scan is friendlier to the JIT.
 *
 * Building the backend copies every vector into the slot array, so the result
 * is memoized and rebuilt only when the embeddings file changes.
 */
import fs from "node:fs";
import { readEmbeddingIndexUncached } from "./embeddings.js";
import { PATHS } from "./paths.js";
import { ExactVectorBackend, type VectorBackend } from "./vectorBackend.js";

export interface VectorContext {
  model: string | null;
  backend: VectorBackend | null;
  engine: string;
  warning?: string;
}

// Stat fingerprint (mtime:size) used to invalidate the cached backend when the
// embeddings file changes — the same scheme loadEmbeddingIndex keys on.
function fileVersion(filePath: string): string {
  try {
    const stats = fs.statSync(filePath);
    return `${Math.round(stats.mtimeMs)}:${stats.size}`;
  } catch {
    return "none";
  }
}

let cacheKey = "";
let cachedContext: VectorContext | null = null;

function buildContext(): VectorContext {
  // Uncached read: the transient Map is consumed into the slot array and then
  // GC'd, so steady-state memory is one slot array — never a Map plus a copy.
  const index = readEmbeddingIndexUncached();
  const backend = index.vectors.size > 0 ? ExactVectorBackend.fromVectors(index.vectors) : null;
  return {
    model: index.model,
    backend,
    engine: backend ? backend.engine : "none",
    warning: index.warning
  };
}

export function loadVectorContext(): VectorContext {
  const key = `${fileVersion(PATHS.embeddingsManifest)}|${fileVersion(PATHS.embeddingsEntities)}`;
  if (cachedContext && cacheKey === key) {
    return cachedContext;
  }
  cachedContext = buildContext();
  cacheKey = key;
  return cachedContext;
}
