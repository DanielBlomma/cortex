/**
 * Selects the vector scoring backend for a search. Prefers the quantized
 * TurboQuant artifact when present and fresh, otherwise builds the exact
 * slot-array backend from the full-precision index. Any failure or staleness
 * silently falls back to exact — the quantized path is never load-bearing.
 *
 * Mode is controlled by CORTEX_VECTOR_INDEX:
 *   auto       (default) exact scan — see note below
 *   exact      always exact
 *   turboquant prefer the artifact, fall back to exact if missing/stale
 *
 * Why auto == exact: measured on representative corpora, the pure-JS quantized
 * scan does not beat V8's auto-vectorized Float32 dot product on latency, and
 * it trades a few percent of recall for a ~6x smaller resident index. That
 * memory win is worth opting into for very large indexes, but it should not
 * silently degrade recall by default. The artifact is still compiled at embed
 * time so `turboquant` mode (and a future SIMD kernel) can use it immediately.
 */
import fs from "node:fs";
import { readEmbeddingIndexUncached } from "./embeddings.js";
import { PATHS } from "./paths.js";
import { ExactVectorBackend, type VectorBackend } from "./vectorBackend.js";
import { QuantizedVectorBackend, readTurboQuantIndex } from "./turboquantIndex.js";

export interface VectorContext {
  model: string | null;
  backend: VectorBackend | null;
  engine: string;
  warning?: string;
}

type VectorMode = "auto" | "exact" | "turboquant";

function resolveMode(): VectorMode {
  const raw = (process.env.CORTEX_VECTOR_INDEX ?? "auto").trim().toLowerCase();
  return raw === "exact" || raw === "turboquant" ? raw : "auto";
}

// Stat fingerprint (mtime:size) used to invalidate the cached backend when any
// underlying file changes — the same scheme loadEmbeddingIndex keys on.
function fileVersion(filePath: string): string {
  try {
    const stats = fs.statSync(filePath);
    return `${Math.round(stats.mtimeMs)}:${stats.size}`;
  } catch {
    return "none";
  }
}

function readManifest(): { model?: string; output?: number } | null {
  try {
    if (!fs.existsSync(PATHS.embeddingsManifest)) {
      return null;
    }
    const parsed = JSON.parse(fs.readFileSync(PATHS.embeddingsManifest, "utf8")) as {
      model?: string;
      counts?: { output?: number };
    };
    return { model: parsed.model, output: parsed.counts?.output };
  } catch {
    return null;
  }
}

// Building a backend copies every vector into a slot array (exact) or reads the
// artifact from disk (quantized). Both are O(N) and must not run per query, so
// the result is memoized and only rebuilt when an input file changes.
let cacheKey = "";
let cachedContext: VectorContext | null = null;

function exactContext(): VectorContext {
  // Uncached read: the transient Map is consumed into the slot array and then
  // GC'd. The cached VectorContext (this result) is the only retained copy, so
  // steady-state memory is one slot array — never a Map plus a slot array.
  const index = readEmbeddingIndexUncached();
  const backend = index.vectors.size > 0 ? ExactVectorBackend.fromVectors(index.vectors) : null;
  return {
    model: index.model,
    backend,
    engine: backend ? backend.engine : "none",
    warning: index.warning
  };
}

function buildContext(mode: VectorMode): VectorContext {
  if (mode === "turboquant" && fs.existsSync(PATHS.embeddingsTurboQuant)) {
    try {
      const loaded = readTurboQuantIndex(PATHS.embeddingsTurboQuant);
      const manifest = readManifest();
      const sizeMismatch =
        manifest?.output !== undefined && manifest.output !== loaded.codes.size;
      const modelMismatch =
        Boolean(manifest?.model) && Boolean(loaded.model) && manifest?.model !== loaded.model;
      // Freshness is tied to the actual embeddings file: the artifact stores the
      // entities.jsonl fingerprint it was built from. A regenerated or
      // partially-written index no longer matches the live file. An artifact
      // with no source predates this guarantee and is treated as stale.
      const liveFingerprint = fileVersion(PATHS.embeddingsEntities);
      const sourceMismatch = !loaded.source || loaded.source !== liveFingerprint;
      if (!sizeMismatch && !modelMismatch && !sourceMismatch) {
        const backend = new QuantizedVectorBackend(loaded);
        return { model: loaded.model, backend, engine: backend.engine };
      }
      // Stale artifact: fall back to exact and surface why.
      return { ...exactContext(), warning: "Quantized vector index is stale; using exact scan." };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "failed to read quantized index";
      return { ...exactContext(), warning: `Quantized vector index unreadable (${reason}); using exact scan.` };
    }
  }
  return exactContext();
}

export function loadVectorContext(): VectorContext {
  const mode = resolveMode();
  const key = [
    mode,
    fileVersion(PATHS.embeddingsManifest),
    fileVersion(PATHS.embeddingsEntities),
    fileVersion(PATHS.embeddingsTurboQuant)
  ].join("|");
  if (cachedContext && cacheKey === key) {
    return cachedContext;
  }
  cachedContext = buildContext(mode);
  cacheKey = key;
  return cachedContext;
}
