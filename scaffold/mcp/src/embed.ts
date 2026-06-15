import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { env, pipeline } from "@huggingface/transformers";
import { readJsonl, asString, asNumber, asBoolean } from "./jsonl.js";
import { CACHE_DIR, PATHS } from "./paths.js";
import {
  createTokenCounter,
  DEFAULT_SCHEDULER_OPTIONS,
  groupDuplicates,
  packWorkUnits,
  resolveInFlightTokens,
  resolveMemoryHeadroom,
  resolveModelMaxTokens,
  resolvePoolConfig,
  runWorkUnits,
  type EmbedExtractor,
  type MeasuredText,
  type PendingText
} from "./embedScheduler.js";
import type { JsonObject, JsonValue } from "./types.js";

const EMBEDDINGS_PATH = PATHS.embeddingsEntities;
const EMBEDDINGS_MANIFEST_PATH = PATHS.embeddingsManifest;
const MODEL_CACHE_DIR = PATHS.embeddingsModelCache;
const EMBEDDINGS_DIR = path.dirname(EMBEDDINGS_PATH);

export const DEFAULT_MODEL_ID = "jinaai/jina-embeddings-v2-base-code";

// Cap the characters fed to the embedder per entity. Transformer self-attention
// is O(seq^2), so an uncapped long input (e.g. a large file at jina's 8k-token
// max) needs ~14GB for a single forward and OOMs constrained machines; ~7k
// chars (~1.75k tokens) bounds a forward to ~4GB with no accumulation. Chunk
// entities still embed function/class bodies in full, so a truncated
// file-level document loses little. Override with CORTEX_EMBED_MAX_CHARS.
export const DEFAULT_MAX_TEXT_CHARS = 7000;

export function resolveModelId(): string {
  return (process.env.CORTEX_EMBED_MODEL ?? DEFAULT_MODEL_ID).trim() || DEFAULT_MODEL_ID;
}

export function resolveMaxTextChars(): number {
  const raw = Number(process.env.CORTEX_EMBED_MAX_CHARS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_TEXT_CHARS;
}

type FileEntity = {
  id: string;
  type: "File";
  kind: string;
  label: string;
  path: string;
  status: string;
  source_of_truth: boolean;
  trust_level: number;
  updated_at: string;
  text: string;
  signature: string;
};

type RuleEntity = {
  id: string;
  type: "Rule";
  kind: "RULE";
  label: string;
  path: string;
  status: string;
  source_of_truth: boolean;
  trust_level: number;
  updated_at: string;
  text: string;
  signature: string;
};

type AdrEntity = {
  id: string;
  type: "ADR";
  kind: "ADR";
  label: string;
  path: string;
  status: string;
  source_of_truth: boolean;
  trust_level: number;
  updated_at: string;
  text: string;
  signature: string;
};

// Embedding-specific entity types — intentionally different from types.ts records
// because they carry `text` and `signature` fields used for embedding generation.
type ModuleEntity = {
  id: string;
  type: "Module";
  kind: "MODULE";
  label: string;
  path: string;
  status: string;
  source_of_truth: boolean;
  trust_level: number;
  updated_at: string;
  text: string;
  signature: string;
};

type ProjectEntity = {
  id: string;
  type: "Project";
  kind: string;
  label: string;
  path: string;
  status: string;
  source_of_truth: boolean;
  trust_level: number;
  updated_at: string;
  text: string;
  signature: string;
};

type ChunkEntity = {
  id: string;
  type: "Chunk";
  kind: string;
  label: string;
  path: string;
  status: string;
  source_of_truth: boolean;
  trust_level: number;
  updated_at: string;
  text: string;
  signature: string;
};

type SearchEntity = FileEntity | RuleEntity | AdrEntity | ModuleEntity | ProjectEntity | ChunkEntity;

type EmbeddingRecord = {
  id: string;
  entity_type: string;
  kind: string;
  label: string;
  path: string;
  status: string;
  source_of_truth: boolean;
  trust_level: number;
  updated_at: string;
  signature: string;
  model: string;
  dimensions: number;
  vector: number[];
};

function parseArgs(argv: string[]): { mode: "full" | "changed" } {
  const args = new Set(argv.slice(2));
  return {
    mode: args.has("--changed") ? "changed" : "full"
  };
}

function hashText(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function writeJsonl(filePath: string, records: EmbeddingRecord[]): void {
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  fs.writeFileSync(filePath, body ? `${body}\n` : "", "utf8");
}

function ensureRequiredFiles(): void {
  const required = [
    path.join(CACHE_DIR, "documents.jsonl"),
    path.join(CACHE_DIR, "entities.rule.jsonl"),
    path.join(CACHE_DIR, "entities.adr.jsonl")
  ];

  for (const filePath of required) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing required cache file: ${filePath}`);
    }
  }
}

export function parseFileEntities(raw: JsonObject[]): FileEntity[] {
  return raw
    .map((item) => {
      const id = asString(item.id);
      const filePath = asString(item.path);
      if (!id || !filePath) {
        return null;
      }

      const content = asString(item.content);
      const excerpt = asString(item.excerpt);
      const updatedAt = asString(item.updated_at);
      const checksum = asString(item.checksum, hashText(content));
      const text = `${filePath}\n${excerpt}\n${content}`;

      return {
        id,
        type: "File" as const,
        kind: asString(item.kind, "DOC"),
        label: filePath,
        path: filePath,
        status: asString(item.status, "active"),
        source_of_truth: asBoolean(item.source_of_truth, false),
        trust_level: asNumber(item.trust_level, 50),
        updated_at: updatedAt,
        text,
        signature: hashText(`file|${checksum}|${updatedAt}|${hashText(text)}`)
      };
    })
    .filter((value): value is FileEntity => value !== null);
}

function parseRuleEntities(raw: JsonObject[]): RuleEntity[] {
  return raw
    .map((item) => {
      const id = asString(item.id);
      if (!id) {
        return null;
      }

      const title = asString(item.title, id);
      const body = asString(item.body);
      const updatedAt = asString(item.updated_at, "");
      const text = `${title}\n${body}`;

      return {
        id,
        type: "Rule" as const,
        kind: "RULE" as const,
        label: title,
        path: "",
        status: asString(item.status, "active"),
        source_of_truth: asBoolean(item.source_of_truth, true),
        trust_level: asNumber(item.trust_level, 95),
        updated_at: updatedAt,
        text,
        signature: hashText(`rule|${id}|${updatedAt}|${hashText(text)}`)
      };
    })
    .filter((value): value is RuleEntity => value !== null);
}

function parseAdrEntities(raw: JsonObject[]): AdrEntity[] {
  return raw
    .map((item) => {
      const id = asString(item.id);
      if (!id) {
        return null;
      }

      const title = asString(item.title, id);
      const body = asString(item.body);
      const adrPath = asString(item.path);
      const decisionDate = asString(item.decision_date, "");
      const text = `${adrPath}\n${title}\n${body}`;

      return {
        id,
        type: "ADR" as const,
        kind: "ADR" as const,
        label: title,
        path: adrPath,
        status: asString(item.status, "active"),
        source_of_truth: asBoolean(item.source_of_truth, true),
        trust_level: asNumber(item.trust_level, 95),
        updated_at: decisionDate,
        text,
        signature: hashText(`adr|${id}|${decisionDate}|${hashText(text)}`)
      };
    })
    .filter((value): value is AdrEntity => value !== null);
}

function parseModuleEntities(raw: JsonObject[]): ModuleEntity[] {
  return raw
    .map((item) => {
      const id = asString(item.id);
      if (!id) {
        return null;
      }

      const modulePath = asString(item.path);
      const name = asString(item.name);
      const summary = asString(item.summary);
      const exportedSymbols = asString(item.exported_symbols);
      const updatedAt = asString(item.updated_at);
      const text = `${modulePath}\n${name}\n${summary}\n${exportedSymbols}`;

      return {
        id,
        type: "Module" as const,
        kind: "MODULE" as const,
        label: name || modulePath,
        path: modulePath,
        status: asString(item.status, "active"),
        source_of_truth: asBoolean(item.source_of_truth, false),
        trust_level: asNumber(item.trust_level, 75),
        updated_at: updatedAt,
        text,
        signature: hashText(`module|${id}|${updatedAt}|${hashText(text)}`)
      };
    })
    .filter((value): value is ModuleEntity => value !== null);
}

export function parseChunkEntities(raw: JsonObject[], filePathById: Map<string, string>): ChunkEntity[] {
  return raw
    .map((item) => {
      const id = asString(item.id);
      if (!id) {
        return null;
      }

      const fileId = asString(item.file_id);
      const filePath = filePathById.get(fileId) ?? "";
      const name = asString(item.name);
      const sig = asString(item.signature);
      const description = asString(item.description);
      const body = asString(item.body);
      const updatedAt = asString(item.updated_at);
      const checksum = asString(item.checksum, hashText(body));
      const text = `${filePath}\n${name}\n${sig}\n${description}\n${body}`;

      return {
        id,
        type: "Chunk" as const,
        kind: asString(item.kind, "chunk"),
        label: name || id,
        path: filePath,
        status: asString(item.status, "active"),
        source_of_truth: asBoolean(item.source_of_truth, false),
        trust_level: asNumber(item.trust_level, 60),
        updated_at: updatedAt,
        text,
        signature: hashText(`chunk|${checksum}|${updatedAt}|${hashText(text)}`)
      };
    })
    .filter((value): value is ChunkEntity => value !== null);
}

function parseProjectEntities(raw: JsonObject[]): ProjectEntity[] {
  return raw
    .map((item) => {
      const id = asString(item.id);
      if (!id) {
        return null;
      }

      const projectPath = asString(item.path);
      const name = asString(item.name);
      const kind = asString(item.kind, "project");
      const language = asString(item.language, "dotnet");
      const targetFramework = asString(item.target_framework);
      const summary = asString(item.summary);
      const updatedAt = asString(item.updated_at);
      const text = `${projectPath}\n${name}\n${kind}\n${language}\n${targetFramework}\n${summary}`;

      return {
        id,
        type: "Project" as const,
        kind: kind.toUpperCase() || "PROJECT",
        label: name || projectPath,
        path: projectPath,
        status: asString(item.status, "active"),
        source_of_truth: asBoolean(item.source_of_truth, false),
        trust_level: asNumber(item.trust_level, 80),
        updated_at: updatedAt,
        text,
        signature: hashText(`project|${id}|${updatedAt}|${hashText(text)}`)
      };
    })
    .filter((value): value is ProjectEntity => value !== null);
}

function parseExistingEmbeddings(raw: JsonObject[], modelId: string): Map<string, EmbeddingRecord> {
  const index = new Map<string, EmbeddingRecord>();

  for (const item of raw) {
    const id = asString(item.id);
    if (!id) continue;

    const vectorRaw = item.vector;
    if (!Array.isArray(vectorRaw)) continue;

    const vector = vectorRaw
      .map((value) => (typeof value === "number" && Number.isFinite(value) ? value : null))
      .filter((value): value is number => value !== null);

    if (vector.length === 0) continue;
    const model = asString(item.model);
    if (model && model !== modelId) continue;

    index.set(id, {
      id,
      entity_type: asString(item.entity_type, "Unknown"),
      kind: asString(item.kind, "DOC"),
      label: asString(item.label, id),
      path: asString(item.path),
      status: asString(item.status, "active"),
      source_of_truth: asBoolean(item.source_of_truth, false),
      trust_level: asNumber(item.trust_level, 50),
      updated_at: asString(item.updated_at),
      signature: asString(item.signature),
      model: modelId,
      dimensions: asNumber(item.dimensions, vector.length),
      vector
    });
  }

  return index;
}

function roundVector(values: number[]): number[] {
  return values.map((value) => Number(value.toFixed(6)));
}

async function main(): Promise<void> {
  const { mode } = parseArgs(process.argv);
  ensureRequiredFiles();

  fs.mkdirSync(EMBEDDINGS_DIR, { recursive: true });
  fs.mkdirSync(MODEL_CACHE_DIR, { recursive: true });

  const modelId = resolveModelId();

  const documents = parseFileEntities(readJsonl(path.join(CACHE_DIR, "documents.jsonl")));
  const rules = parseRuleEntities(readJsonl(path.join(CACHE_DIR, "entities.rule.jsonl")));
  const adrs = parseAdrEntities(readJsonl(path.join(CACHE_DIR, "entities.adr.jsonl")));
  const modules = parseModuleEntities(readJsonl(path.join(CACHE_DIR, "entities.module.jsonl")));
  const projects = parseProjectEntities(readJsonl(path.join(CACHE_DIR, "entities.project.jsonl")));

  // Build file path lookup for chunk embedding text (reuse already-parsed documents)
  const filePathById = new Map<string, string>();
  for (const doc of documents) {
    filePathById.set(doc.id, doc.path);
  }
  const chunks = parseChunkEntities(readJsonl(path.join(CACHE_DIR, "entities.chunk.jsonl")), filePathById);

  const entities: SearchEntity[] = [...documents, ...rules, ...adrs, ...modules, ...projects, ...chunks].sort((a, b) => a.id.localeCompare(b.id));

  const existing = parseExistingEmbeddings(readJsonl(EMBEDDINGS_PATH), modelId);

  env.cacheDir = MODEL_CACHE_DIR;
  const maxTextChars = resolveMaxTextChars();
  // Total thread budget for embedding. CORTEX_EMBED_THREADS caps it so
  // co-located embedders (parallel CI jobs, eval containers) do not
  // oversubscribe shared cores; unset = all cores.
  const threadsRaw = Number(process.env.CORTEX_EMBED_THREADS);
  const threadBudget =
    Number.isFinite(threadsRaw) && threadsRaw >= 1 ? Math.floor(threadsRaw) : os.cpus().length;

  let reused = 0;
  // Slot per entity keeps output in entity order; failed slots stay null.
  const slots: Array<EmbeddingRecord | null> = entities.map(() => null);
  const pending: PendingText[] = [];
  let dimensions = 0;

  entities.forEach((entity, index) => {
    const previous = existing.get(entity.id);
    if (previous && previous.signature === entity.signature && previous.vector.length > 0) {
      reused += 1;
      dimensions = dimensions || previous.vector.length;
      slots[index] = {
        ...previous,
        entity_type: entity.type,
        kind: entity.kind,
        label: entity.label,
        path: entity.path,
        status: entity.status,
        source_of_truth: entity.source_of_truth,
        trust_level: entity.trust_level,
        updated_at: entity.updated_at,
        signature: entity.signature,
        model: modelId,
        dimensions: previous.vector.length
      };
      return;
    }
    pending.push({ index, text: normalizeText(entity.text).slice(0, maxTextChars) });
  });

  // Deduplicate identical texts (lossless: identical input -> identical
  // vector), then measure token lengths for routing and batch packing.
  const unique = groupDuplicates(pending);
  // Memory headroom drives pool size and the concurrency gate; everything
  // adapts to the machine so no tuning is expected from users. Container
  // limits (cgroups) and platforms that under-report free memory are both
  // handled inside resolveMemoryHeadroom.
  const readHeadroom = () =>
    resolveMemoryHeadroom({
      freeMemory: os.freemem(),
      totalMemory: os.totalmem(),
      constrainedMemory: process.constrainedMemory?.() ?? null,
      availableMemory: process.availableMemory?.() ?? null
    });
  const memoryHeadroom = readHeadroom();
  const poolConfig = resolvePoolConfig({
    threadBudget,
    poolOverride: Number(process.env.CORTEX_EMBED_POOL) || null,
    uniqueCount: unique.length,
    memoryBytes: memoryHeadroom
  });

  const batchSizeRaw = Number(process.env.CORTEX_EMBED_BATCH_SIZE);
  const batchTokensRaw = Number(process.env.CORTEX_EMBED_BATCH_TOKENS);
  const shortTokensRaw = Number(process.env.CORTEX_EMBED_SHORT_TOKENS);
  const schedulerOptions = {
    ...DEFAULT_SCHEDULER_OPTIONS,
    // 0 (or any value below 1) disables micro-batching rather than silently
    // meaning "use the default".
    ...(Number.isFinite(batchSizeRaw) && batchSizeRaw >= 0
      ? { batchMaxItems: Math.max(1, Math.floor(batchSizeRaw)) }
      : {}),
    ...(Number.isFinite(batchTokensRaw) && batchTokensRaw >= 16
      ? { batchTokenBudget: Math.floor(batchTokensRaw) }
      : {}),
    ...(Number.isFinite(shortTokensRaw) && shortTokensRaw >= 1
      ? { shortMaxTokens: Math.floor(shortTokensRaw) }
      : {})
  };

  // Fully warm cache: nothing to embed, so skip model loading entirely —
  // this is the common repeat-bootstrap / small-update path.
  let result: { vectors: Map<number, number[]>; failures: Array<{ index: number; message: string }> } = {
    vectors: new Map(),
    failures: []
  };

  if (unique.length > 0) {
    const makeExtractor = async (threads: number) =>
      (await pipeline("feature-extraction", modelId, {
        session_options: { intraOpNumThreads: threads, interOpNumThreads: 1 }
      } as Parameters<typeof pipeline>[2])) as unknown as EmbedExtractor & {
        tokenizer?: ((text: string) => { input_ids?: { dims?: number[] } }) & {
          model_max_length?: number;
        };
      };

    // First session loads (and caches) the model; the rest load in parallel.
    // Extra sessions failing (e.g. memory pressure) degrades the pool instead
    // of aborting the run — one session can always finish the work.
    const first = await makeExtractor(poolConfig.threadsPerSession);
    const extraSessions = await Promise.allSettled(
      Array.from({ length: poolConfig.sessions - 1 }, () =>
        makeExtractor(poolConfig.threadsPerSession)
      )
    );
    const extractors: EmbedExtractor[] = [
      first,
      ...extraSessions
        .filter(
          (settled): settled is PromiseFulfilledResult<Awaited<ReturnType<typeof makeExtractor>>> =>
            settled.status === "fulfilled"
        )
        .map((settled) => settled.value)
    ];
    const failedSessions = extraSessions.length + 1 - extractors.length;
    if (failedSessions > 0) {
      const firstFailure = extraSessions.find(
        (settled): settled is PromiseRejectedResult => settled.status === "rejected"
      );
      const reason =
        firstFailure?.reason instanceof Error ? firstFailure.reason.message : String(firstFailure?.reason ?? "unknown");
      console.warn(
        `[embed] ${failedSessions} pool session(s) failed to load (${reason}); continuing with ${extractors.length}`
      );
    }

    // Inference truncates at the model max; token counts must too, or one
    // giant file inflates scheduling cost and gate mass far beyond reality.
    const modelMaxTokens = resolveModelMaxTokens(first.tokenizer?.model_max_length);
    const countTokens = createTokenCounter(first.tokenizer, modelMaxTokens);

    const measured: MeasuredText[] = unique.map((item) => ({ ...item, tokens: countTokens(item.text) }));
    const units = packWorkUnits(measured, schedulerOptions);
    // Recompute headroom after the model copies are resident so the gate
    // reflects what is actually left for inference activations.
    const inFlightRaw = Number(process.env.CORTEX_EMBED_INFLIGHT_TOKENS);
    const maxInFlightTokens =
      Number.isFinite(inFlightRaw) && inFlightRaw >= 1024
        ? Math.floor(inFlightRaw)
        : resolveInFlightTokens({ memoryBytes: readHeadroom(), modelMaxTokens });
    result = await runWorkUnits(units, extractors, { maxInFlightTokens });
  }

  let embedded = 0;
  for (const [index, rawVector] of result.vectors) {
    const entity = entities[index];
    const vector = roundVector(rawVector);
    embedded += 1;
    dimensions = dimensions || vector.length;
    slots[index] = {
      id: entity.id,
      entity_type: entity.type,
      kind: entity.kind,
      label: entity.label,
      path: entity.path,
      status: entity.status,
      source_of_truth: entity.source_of_truth,
      trust_level: entity.trust_level,
      updated_at: entity.updated_at,
      signature: entity.signature,
      model: modelId,
      dimensions: vector.length,
      vector
    };
  }

  const failures = result.failures.map(
    (failure) => `${entities[failure.index].id}: ${failure.message}`
  );
  const failed = result.failures.length;

  const output = slots.filter((record): record is EmbeddingRecord => record !== null);
  writeJsonl(EMBEDDINGS_PATH, output);

  const manifest = {
    generated_at: new Date().toISOString(),
    mode,
    model: modelId,
    dimensions,
    counts: {
      entities: entities.length,
      output: output.length,
      embedded,
      reused,
      failed
    },
    failures: failures.slice(0, 50)
  };

  fs.writeFileSync(EMBEDDINGS_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(
    `[embed] mode=${mode} model=${modelId} dim=${dimensions} pool=${poolConfig.sessions}x${poolConfig.threadsPerSession} batch<=${schedulerOptions.batchMaxItems}`
  );
  console.log(
    `[embed] entities=${entities.length} embedded=${embedded} reused=${reused} failed=${failed}`
  );
  console.log(`[embed] wrote ${EMBEDDINGS_PATH}`);
  console.log(`[embed] manifest ${EMBEDDINGS_MANIFEST_PATH}`);
}

const isMain = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false;
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Embedding error"}\n`);
    process.exit(1);
  });
}
