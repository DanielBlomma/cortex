import fs from "node:fs";
import { env, pipeline } from "@huggingface/transformers";
import { readJsonlRecords } from "./jsonl.js";
import { LruCache } from "./lruCache.js";
import { PATHS } from "./paths.js";
import type { EmbeddingIndex, JsonObject } from "./types.js";

const EMBEDDING_INIT_RETRY_INTERVAL_MS = 5000;

let embeddingsCacheKey = "";
let embeddingsCache: EmbeddingIndex = { model: null, vectors: new Map() };
let embeddingExtractorModel: string | null = null;
let embeddingExtractorPromise: Promise<unknown | null> | null = null;
let embeddingLastInitAttemptAt = 0;
let embeddingRuntimeWarning: string | null = null;

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toVector(output: unknown): Float32Array | null {
  if (!output || typeof output !== "object") {
    return null;
  }

  const data = (output as { data?: unknown }).data;
  if (!data || typeof (data as ArrayLike<number>).length !== "number") {
    return null;
  }

  const finite = Array.from(data as ArrayLike<number>)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  return Float32Array.from(finite);
}

function readFileVersion(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    return "none";
  }
  try {
    const stats = fs.statSync(filePath);
    return `${Math.round(stats.mtimeMs)}:${stats.size}`;
  } catch {
    return "none";
  }
}

function parseEmbeddingIndex(raw: Iterable<JsonObject>): EmbeddingIndex {
  const vectors = new Map<string, Float32Array>();
  let model: string | null = null;

  for (const item of raw) {
    const id = asString(item.id);
    if (!id) continue;

    const vectorRaw = item.vector;
    if (!Array.isArray(vectorRaw)) continue;

    const vector: number[] = [];
    for (const value of vectorRaw) {
      if (typeof value === "number" && Number.isFinite(value)) {
        vector.push(value);
      }
    }

    if (vector.length === 0) continue;
    // The boxed number[] is transient — only the Float32Array is retained,
    // so peak memory is one line's vector, not the whole index in float64.
    vectors.set(id, Float32Array.from(vector));

    const nextModel = asString(item.model);
    if (nextModel && !model) {
      model = nextModel;
    }
  }

  return { model, vectors };
}

export function loadEmbeddingIndex(): EmbeddingIndex {
  const key = `${readFileVersion(PATHS.embeddingsManifest)}|${readFileVersion(PATHS.embeddingsEntities)}`;
  if (embeddingsCacheKey === key) {
    return embeddingsCache;
  }

  if (!fs.existsSync(PATHS.embeddingsEntities)) {
    embeddingsCacheKey = key;
    embeddingsCache = {
      model: null,
      vectors: new Map(),
      warning: "Embedding index missing (run: cortex embed)"
    };
    return embeddingsCache;
  }

  const parsed = parseEmbeddingIndex(readJsonlRecords(PATHS.embeddingsEntities));
  embeddingsCacheKey = key;
  embeddingsCache =
    parsed.vectors.size === 0
      ? { ...parsed, warning: "Embedding index is empty; using lexical fallback." }
      : parsed;
  return embeddingsCache;
}

async function getEmbeddingExtractor(modelId: string): Promise<unknown | null> {
  if (!modelId) {
    return null;
  }

  if (embeddingExtractorModel !== modelId) {
    embeddingExtractorModel = modelId;
    embeddingExtractorPromise = null;
    embeddingLastInitAttemptAt = 0;
  }

  if (embeddingExtractorPromise) {
    const existing = await embeddingExtractorPromise;
    if (existing) {
      return existing;
    }

    if (Date.now() - embeddingLastInitAttemptAt < EMBEDDING_INIT_RETRY_INTERVAL_MS) {
      return null;
    }

    // Previous init failed; allow a fresh retry after cooldown.
    embeddingExtractorPromise = null;
  }

  if (Date.now() - embeddingLastInitAttemptAt < EMBEDDING_INIT_RETRY_INTERVAL_MS) {
    return null;
  }

  embeddingLastInitAttemptAt = Date.now();
  embeddingExtractorPromise = (async () => {
    try {
      fs.mkdirSync(PATHS.embeddingsModelCache, { recursive: true });
      env.cacheDir = PATHS.embeddingsModelCache;
      const extractor = await pipeline("feature-extraction", modelId);
      embeddingRuntimeWarning = null;
      return extractor;
    } catch (error) {
      embeddingRuntimeWarning =
        error instanceof Error ? error.message : "Failed to load embedding model";
      return null;
    }
  })();

  return embeddingExtractorPromise;
}

// Agents repeat queries verbatim within a session; the model pipeline is
// cached but each call still pays full inference. A small LRU keyed on
// (model, query) makes repeats free. Cached vectors are treated as
// immutable by all callers.
const queryEmbeddingCache = new LruCache<string, Float32Array>(256);

export async function embedQuery(query: string, modelId: string): Promise<Float32Array | null> {
  const cacheKey = `${modelId}\u0000${query}`;
  const cached = queryEmbeddingCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const extractor = await getEmbeddingExtractor(modelId);
  if (!extractor) {
    return null;
  }

  try {
    const output = await (extractor as (text: string, options: unknown) => Promise<unknown>)(query, {
      pooling: "mean",
      normalize: true
    });
    const vector = toVector(output);
    if (!vector || vector.length === 0) {
      embeddingRuntimeWarning = "Failed to embed query text";
      return null;
    }

    embeddingRuntimeWarning = null;
    queryEmbeddingCache.set(cacheKey, vector);
    return vector;
  } catch (error) {
    embeddingRuntimeWarning = error instanceof Error ? error.message : "Failed to embed query text";
    return null;
  }
}

export function getEmbeddingRuntimeWarning(): string | null {
  return embeddingRuntimeWarning;
}
