import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { env, pipeline } from "@huggingface/transformers";
import { LruCache } from "./lruCache.js";
import { PATHS, REPO_ROOT } from "./paths.js";
import {
  assertSecureManagedDirectory,
  assertSecureManagedFile,
  ensureSecureManagedDirectory,
  resolvePublishedEmbeddingsPath
} from "./progressiveIndexing.js";
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
  try {
    assertSecureManagedFile(REPO_ROOT, filePath);
    const stats = fs.statSync(filePath);
    return `${Math.round(stats.mtimeMs)}:${stats.size}`;
  } catch {
    return "none";
  }
}

type EmbeddingManifest = {
  schema_version?: unknown;
  progressive?: unknown;
  model?: unknown;
  dimensions?: unknown;
  readiness?: unknown;
  semantic_coverage_percent?: unknown;
  snapshot_file?: unknown;
  snapshot_bytes?: unknown;
  snapshot_sha256?: unknown;
  ingest_generation?: unknown;
  graph_generation?: unknown;
  counts?: { entities?: unknown; output?: unknown };
};

type ManifestRead = {
  manifest: EmbeddingManifest | null;
  version: string;
  error?: string;
};

type GenerationRead = {
  generation: string | null;
  version: string;
  error?: string;
};

function readCurrentIngestGeneration(): GenerationRead {
  try {
    assertSecureManagedFile(REPO_ROOT, PATHS.ingestManifest);
    const raw = fs.readFileSync(PATHS.ingestManifest, "utf8");
    const version = crypto.createHash("sha256").update(raw).digest("hex");
    const manifest = JSON.parse(raw) as { schema_version?: unknown; generation_id?: unknown };
    if (manifest?.schema_version !== 2 || typeof manifest.generation_id !== "string" || !manifest.generation_id) {
      return { generation: null, version, error: "Current ingest manifest has no valid generation identity" };
    }
    return { generation: manifest.generation_id, version };
  } catch (error) {
    return {
      generation: null,
      version: (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "invalid",
      error: "Current ingest manifest is missing, unreadable, or malformed"
    };
  }
}

function readCurrentGraphGeneration(): GenerationRead {
  try {
    assertSecureManagedFile(REPO_ROOT, PATHS.graphManifest);
    const raw = fs.readFileSync(PATHS.graphManifest, "utf8");
    const version = crypto.createHash("sha256").update(raw).digest("hex");
    const manifest = JSON.parse(raw) as { schema_version?: unknown; generation_id?: unknown };
    if (manifest?.schema_version !== 2 || typeof manifest.generation_id !== "string" || !manifest.generation_id) {
      return { generation: null, version, error: "Current graph manifest has no valid generation identity" };
    }
    return { generation: manifest.generation_id, version };
  } catch (error) {
    return {
      generation: null,
      version: (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "invalid",
      error: "Current graph manifest is missing, unreadable, malformed, or unsafe"
    };
  }
}

function readEmbeddingManifest(): ManifestRead {
  try {
    assertSecureManagedFile(REPO_ROOT, PATHS.embeddingsManifest);
    const raw = fs.readFileSync(PATHS.embeddingsManifest, "utf8");
    const manifest = JSON.parse(raw) as EmbeddingManifest;
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      return { manifest: null, version: "invalid", error: "Embedding manifest is not an object" };
    }
    const version = crypto.createHash("sha256").update(raw).digest("hex");
    const schemaVersion = Number(manifest.schema_version);
    if (schemaVersion !== 2) {
      return { manifest: null, version, error: "Unsupported or missing embedding manifest schema" };
    }
    const model = asString(manifest.model);
    const dimensions = Number(manifest.dimensions);
    const entities = Number(manifest.counts?.entities);
    const output = Number(manifest.counts?.output);
    if (
      !model ||
      !Number.isInteger(dimensions) || dimensions <= 0 ||
      !Number.isInteger(entities) || entities < 0 ||
      !Number.isInteger(output) || output < 0 || output > entities
    ) {
      return { manifest: null, version, error: "Embedding manifest has invalid model, dimensions, or counts" };
    }
    const snapshotFile = manifest.snapshot_file;
    const snapshotBytes = Number(manifest.snapshot_bytes);
    const snapshotSha256 = asString(manifest.snapshot_sha256);
    if (
      typeof snapshotFile !== "string" || !snapshotFile ||
      path.basename(snapshotFile) !== snapshotFile ||
      !/^entities(?:\.progress-[A-Za-z0-9-]+)?\.jsonl$/.test(snapshotFile) ||
      !Number.isInteger(snapshotBytes) || snapshotBytes < 0 ||
      !/^[a-f0-9]{64}$/.test(snapshotSha256) ||
      !asString(manifest.ingest_generation)
    ) {
      return { manifest: null, version, error: "Embedding manifest has invalid snapshot integrity metadata" };
    }
    return { manifest, version };
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return {
      manifest: null,
      version: missing ? "missing" : "invalid",
      error: missing ? "Embedding manifest missing" : "Embedding manifest is unreadable or malformed",
    };
  }
}

function* parseJsonlBuffer(buffer: Buffer): Generator<JsonObject> {
  let start = 0;
  for (let index = 0; index <= buffer.length; index += 1) {
    if (index !== buffer.length && buffer[index] !== 0x0a) continue;
    const line = buffer.subarray(start, index).toString("utf8").trim();
    start = index + 1;
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) yield parsed as JsonObject;
    } catch {
      // Malformed lines are ignored consistently with the JSONL helper.
    }
  }
}

function readStableSnapshot(filePath: string): { bytes: Buffer; version: string } {
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.nlink > 1) throw new Error("Snapshot is not a private regular file");
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || bytes.length !== after.size) {
      throw new Error("Snapshot changed while it was being read");
    }
    return { bytes, version: `${Math.round(after.mtimeMs)}:${after.size}:${after.dev}:${after.ino}` };
  } finally {
    fs.closeSync(fd);
  }
}

function parseEmbeddingIndex(
  raw: Iterable<JsonObject>,
  manifest: EmbeddingManifest | null
): EmbeddingIndex {
  const vectors = new Map<string, Float32Array>();
  let model: string | null = null;
  const expectedModel = asString(manifest?.model);
  const expectedDimensions = Number(manifest?.dimensions);
  let invalidReason = "";

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
    if (expectedModel && nextModel !== expectedModel) {
      invalidReason = `Embedding snapshot model mismatch (${nextModel || "missing"} != ${expectedModel})`;
      break;
    }
    if (model && nextModel && model !== nextModel) {
      invalidReason = `Embedding snapshot contains mixed models (${model}, ${nextModel})`;
      break;
    }
    if (Number.isFinite(expectedDimensions) && expectedDimensions > 0 && vector.length !== expectedDimensions) {
      invalidReason = `Embedding snapshot dimension mismatch (${vector.length} != ${expectedDimensions})`;
      break;
    }
    if (nextModel && !model) {
      model = nextModel;
    }
  }

  const expectedOutput = Number(manifest?.counts?.output);
  if (!invalidReason && Number.isFinite(expectedOutput) && expectedOutput >= 0 && vectors.size !== expectedOutput) {
    invalidReason = `Embedding snapshot count mismatch (${vectors.size} != ${expectedOutput})`;
  }
  if (invalidReason) {
    return { model: null, vectors: new Map(), warning: `${invalidReason}; using lexical fallback.` };
  }

  const total = Number(manifest?.counts?.entities);
  const coverage = Number(manifest?.semantic_coverage_percent);
  const stale = manifest?.readiness === "stale";
  const partial = (typeof manifest?.readiness === "string" && manifest.readiness !== "full") ||
    (Number.isFinite(total) && total > 0 && vectors.size < total);
  return {
    model,
    vectors,
    ...(partial
      ? {
          warning: stale
            ? "Semantic coverage is being refreshed; the published embedding snapshot may be stale. Lexical+graph remains available."
            : `Semantic coverage incomplete: ${vectors.size}/${Number.isFinite(total) ? total : "?"} (${Number.isFinite(coverage) ? coverage.toFixed(1) : "?"}%); lexical+graph remains available.`
        }
      : {})
  };
}

export function loadEmbeddingIndex(): EmbeddingIndex {
  try {
    assertSecureManagedDirectory(REPO_ROOT, path.dirname(PATHS.ingestManifest));
    assertSecureManagedDirectory(REPO_ROOT, path.dirname(PATHS.embeddingsManifest));
  } catch (error) {
    return {
      model: null,
      vectors: new Map(),
      warning: `${error instanceof Error ? error.message : "Managed index path is unsafe"}; using lexical fallback.`
    };
  }
  const ingestRead = readCurrentIngestGeneration();
  const graphRead = readCurrentGraphGeneration();
  const manifestRead = readEmbeddingManifest();
  const manifest = manifestRead.manifest;
  const progressive = manifest?.progressive === true;
  const graphCompatible = !progressive || (
    Boolean(graphRead.generation) && manifest?.graph_generation === graphRead.generation
  );
  if (!manifest || !ingestRead.generation || manifest.ingest_generation !== ingestRead.generation || !graphCompatible) {
    const compatibilityError = manifest && ingestRead.generation && manifest.ingest_generation !== ingestRead.generation
      ? "Embedding manifest does not match the current ingest generation"
      : progressive && !graphCompatible
        ? graphRead.error ?? "Progressive embedding manifest does not match the current graph generation"
        : undefined;
    const key = `${manifestRead.version}|${ingestRead.version}|${graphRead.version}`;
    if (embeddingsCacheKey !== key) {
      embeddingsCacheKey = key;
      embeddingsCache = {
        model: null,
        vectors: new Map(),
        warning: `${manifestRead.error ?? ingestRead.error ?? compatibilityError ?? "Embedding manifest is incompatible with the current index generation"}; using lexical fallback.`
      };
    }
    return embeddingsCache;
  }
  const embeddingsPath = resolvePublishedEmbeddingsPath(
    path.dirname(PATHS.embeddingsEntities),
    PATHS.embeddingsEntities,
    manifest
  );
  const pathVersion = readFileVersion(embeddingsPath);
  const key = `${manifestRead.version}|${ingestRead.version}|${graphRead.version}|${embeddingsPath}|${pathVersion}`;
  if (embeddingsCacheKey === key) {
    return embeddingsCache;
  }

  try {
    assertSecureManagedFile(REPO_ROOT, embeddingsPath);
  } catch (error) {
    embeddingsCacheKey = key;
    embeddingsCache = {
      model: null,
      vectors: new Map(),
      warning: (error as NodeJS.ErrnoException).code === "ENOENT" && manifest?.snapshot_file
        ? "Published embedding snapshot missing; using lexical fallback. Run: cortex indexing resume"
        : `${error instanceof Error ? error.message : "Embedding index is unsafe"}; using lexical fallback.`
    };
    return embeddingsCache;
  }

  const snapshotStat = fs.lstatSync(embeddingsPath);
  if (!snapshotStat.isFile() || snapshotStat.isSymbolicLink() || snapshotStat.nlink > 1) {
    embeddingsCacheKey = key;
    embeddingsCache = {
      model: null,
      vectors: new Map(),
      warning: "Published embedding snapshot is not a private regular file; using lexical fallback."
    };
    return embeddingsCache;
  }

  const expectedBytes = Number(manifest?.snapshot_bytes);
  if (Number.isFinite(expectedBytes) && expectedBytes >= 0 && fs.statSync(embeddingsPath).size !== expectedBytes) {
    embeddingsCacheKey = key;
    embeddingsCache = {
      model: null,
      vectors: new Map(),
      warning: "Published embedding snapshot size mismatch; using lexical fallback."
    };
    return embeddingsCache;
  }

  let stableSnapshot;
  try {
    stableSnapshot = readStableSnapshot(embeddingsPath);
  } catch (error) {
    embeddingsCacheKey = key;
    embeddingsCache = { model: null, vectors: new Map(), warning: `${error instanceof Error ? error.message : "Snapshot read failed"}; using lexical fallback.` };
    return embeddingsCache;
  }
  const expectedSha256 = asString(manifest.snapshot_sha256);
  if (crypto.createHash("sha256").update(stableSnapshot.bytes).digest("hex") !== expectedSha256) {
    embeddingsCacheKey = key;
    embeddingsCache = {
      model: null,
      vectors: new Map(),
      warning: "Published embedding snapshot hash mismatch; using lexical fallback."
    };
    return embeddingsCache;
  }

  const parsed = parseEmbeddingIndex(parseJsonlBuffer(stableSnapshot.bytes), manifest);
  const ingestAfter = readCurrentIngestGeneration();
  const graphAfter = readCurrentGraphGeneration();
  if (
    ingestAfter.version !== ingestRead.version ||
    graphAfter.version !== graphRead.version ||
    readFileVersion(embeddingsPath) !== pathVersion
  ) {
    return { model: null, vectors: new Map(), warning: "Index generation changed while embeddings were loading; using lexical fallback." };
  }
  embeddingsCacheKey = key;
  embeddingsCache =
    parsed.vectors.size === 0
      ? { ...parsed, warning: parsed.warning ?? "Embedding index is empty; using lexical fallback." }
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
      ensureSecureManagedDirectory(REPO_ROOT, PATHS.embeddingsModelCache);
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
