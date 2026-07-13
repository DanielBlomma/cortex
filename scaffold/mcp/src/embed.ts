import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { env, pipeline } from "@huggingface/transformers";
import { readJsonl, readJsonlRecords, writeJsonlRecords, asString, asNumber, asBoolean } from "./jsonl.js";
import { CACHE_DIR, PATHS } from "./paths.js";
import {
  createTokenCounter,
  DEFAULT_SCHEDULER_OPTIONS,
  groupDuplicates,
  packWorkUnits,
  resolveEffectiveTokenBudget,
  resolveInFlightTokens,
  resolveMemoryHeadroom,
  resolveModelMaxTokens,
  resolvePoolConfig,
  resolveTokenBudgetChoice,
  runWorkUnits,
  truncateTextToTokenBudget,
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
export const COMPACT_FILE_TEXT_STRATEGY = "compact_files_v1";
export const COMPACT_FILE_TEXT_THRESHOLD_CHARS = 32768;
export const COMPACT_FILE_TEXT_TARGET_CHARS = 16000;

const COMPACT_FILE_SIGNAL_BUDGET_CHARS = 4096;
const COMPACT_FILE_SIGNAL_MAX_LINE_CHARS = 512;
const COMPACT_FILE_MIN_HEAD_CHARS = 4096;
const COMPACT_FILE_MIN_TAIL_CHARS = 2048;

export type EmbedTextProfile = "full" | "compact-files";

type FileEmbeddingTextResult = {
  text: string;
  profile: EmbedTextProfile;
  compacted: boolean;
  original_chars: number;
  text_chars: number;
  omitted_chars: number;
};

type ParseFileEntitiesOptions = {
  textProfile?: EmbedTextProfile;
};

type SignatureEntityType = "File" | "Rule" | "ADR" | "Module" | "Project" | "Chunk";

export function resolveModelId(): string {
  return (process.env.CORTEX_EMBED_MODEL ?? DEFAULT_MODEL_ID).trim() || DEFAULT_MODEL_ID;
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
  text_profile: EmbedTextProfile;
  text_compacted: boolean;
  text_original_chars: number;
  text_chars: number;
  text_omitted_chars: number;
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

export function resolveEmbedTextProfile(raw = process.env.CORTEX_EMBED_TEXT_PROFILE): EmbedTextProfile {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value || value === "full") {
    return "full";
  }
  if (value === "compact-files") {
    return "compact-files";
  }
  throw new Error(
    `Unsupported CORTEX_EMBED_TEXT_PROFILE=${JSON.stringify(raw)}; expected "full" or "compact-files"`
  );
}

function isSignalLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  return (
    /^(import|export)\b/.test(trimmed) ||
    /^(abstract\s+|async\s+|public\s+|private\s+|protected\s+|static\s+|readonly\s+|override\s+)*(class|interface|type|enum|function)\b/.test(trimmed) ||
    /^(const|let|var)\s+[$A-Z_a-z][$\w]*\s*=/.test(trimmed) ||
    /^(describe|it|test)\s*\(/.test(trimmed) ||
    /^(@[A-Z_a-z][$\w]*|#[#\s])/.test(trimmed) ||
    /^```[A-Za-z0-9_-]+/.test(trimmed) ||
    /\b(route|router|endpoint|controller|handler|middleware|permission|auth|token|secret|security|todo|fixme)\b/i.test(trimmed)
  );
}

function collectSignalLines(content: string, budgetChars: number): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  let used = 0;

  for (const line of content.split(/\r?\n/)) {
    if (!isSignalLine(line)) {
      continue;
    }
    const normalized = line.trimEnd();
    const signalLine = normalized.length > COMPACT_FILE_SIGNAL_MAX_LINE_CHARS
      ? `${normalized.slice(0, COMPACT_FILE_SIGNAL_MAX_LINE_CHARS)} [cortex ${COMPACT_FILE_TEXT_STRATEGY} signal_line_truncated_chars=${normalized.length - COMPACT_FILE_SIGNAL_MAX_LINE_CHARS}]`
      : normalized;
    if (seen.has(signalLine)) {
      continue;
    }
    const next = used + signalLine.length + 1;
    if (next > budgetChars) {
      continue;
    }
    lines.push(signalLine);
    seen.add(signalLine);
    used = next;
  }

  return lines.join("\n");
}

export function buildFileEmbeddingText(
  filePath: string,
  excerpt: string,
  content: string,
  profile: EmbedTextProfile = "full"
): FileEmbeddingTextResult {
  const fullText = `${filePath}\n${excerpt}\n${content}`;
  if (profile === "full" || fullText.length <= COMPACT_FILE_TEXT_THRESHOLD_CHARS) {
    return {
      text: fullText,
      profile,
      compacted: false,
      original_chars: fullText.length,
      text_chars: fullText.length,
      omitted_chars: 0
    };
  }

  const signalText = collectSignalLines(content, COMPACT_FILE_SIGNAL_BUDGET_CHARS);
  const markerPrefix = `[cortex ${COMPACT_FILE_TEXT_STRATEGY} omitted_chars=`;
  const staticChars =
    filePath.length +
    excerpt.length +
    signalText.length +
    markerPrefix.length +
    64;
  const available = Math.max(
    COMPACT_FILE_MIN_HEAD_CHARS + COMPACT_FILE_MIN_TAIL_CHARS,
    COMPACT_FILE_TEXT_TARGET_CHARS - staticChars
  );
  const headChars = Math.max(COMPACT_FILE_MIN_HEAD_CHARS, Math.floor(available * 0.62));
  const tailChars = Math.max(COMPACT_FILE_MIN_TAIL_CHARS, available - headChars);
  const head = content.slice(0, headChars);
  const tail = content.slice(-tailChars);
  const omittedChars = Math.max(0, content.length - head.length - tail.length);
  const marker = `${markerPrefix}${omittedChars}]`;
  const compactText = [
    filePath,
    excerpt,
    head,
    marker,
    signalText ? `[cortex ${COMPACT_FILE_TEXT_STRATEGY} signal_lines]\n${signalText}` : "",
    tail
  ].filter((part) => part.length > 0).join("\n");

  if (compactText.length >= fullText.length) {
    return {
      text: fullText,
      profile,
      compacted: false,
      original_chars: fullText.length,
      text_chars: fullText.length,
      omitted_chars: 0
    };
  }

  return {
    text: compactText,
    profile,
    compacted: true,
    original_chars: fullText.length,
    text_chars: compactText.length,
    omitted_chars: fullText.length - compactText.length
  };
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

export function parseFileEntities(raw: JsonObject[], options: ParseFileEntitiesOptions = {}): FileEntity[] {
  const textProfile = options.textProfile ?? "full";
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
      const embeddingText = buildFileEmbeddingText(filePath, excerpt, content, textProfile);

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
        text: embeddingText.text,
        signature: hashText(`file|${checksum}|${updatedAt}|${hashText(embeddingText.text)}`),
        text_profile: embeddingText.profile,
        text_compacted: embeddingText.compacted,
        text_original_chars: embeddingText.original_chars,
        text_chars: embeddingText.text_chars,
        text_omitted_chars: embeddingText.omitted_chars
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

function parseExistingEmbeddings(raw: Iterable<JsonObject>, modelId: string): Map<string, EmbeddingRecord> {
  const index = new Map<string, EmbeddingRecord>();

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

export function resolveSignatureProfile(
  maxTokenCap: number | null,
  textProfile: EmbedTextProfile = "full",
  entityType?: SignatureEntityType
): string {
  const parts: string[] = [];
  if (maxTokenCap) {
    parts.push(`max_tokens=${maxTokenCap}`);
  }
  if (textProfile === "compact-files" && (entityType === undefined || entityType === "File")) {
    parts.push(
      "text_profile=compact-files",
      COMPACT_FILE_TEXT_STRATEGY,
      `threshold_chars=${COMPACT_FILE_TEXT_THRESHOLD_CHARS}`,
      `target_chars=${COMPACT_FILE_TEXT_TARGET_CHARS}`
    );
  }
  return parts.length ? `embed|${parts.join("|")}` : "";
}

function embeddingSignature(entitySignature: string, profile: string): string {
  return profile ? hashText(`${profile}|${entitySignature}`) : entitySignature;
}

function* presentEmbeddingRecords(
  slots: Array<EmbeddingRecord | null>
): Generator<EmbeddingRecord> {
  for (const record of slots) {
    if (record) {
      yield record;
    }
  }
}

async function main(): Promise<void> {
  const { mode } = parseArgs(process.argv);
  ensureRequiredFiles();

  fs.mkdirSync(EMBEDDINGS_DIR, { recursive: true });
  fs.mkdirSync(MODEL_CACHE_DIR, { recursive: true });

  const modelId = resolveModelId();
  const textProfile = resolveEmbedTextProfile();

  const documents = parseFileEntities(readJsonl(path.join(CACHE_DIR, "documents.jsonl")), { textProfile });
  const textProfileStats = {
    strategy: textProfile === "compact-files" ? COMPACT_FILE_TEXT_STRATEGY : null,
    threshold_chars: textProfile === "compact-files" ? COMPACT_FILE_TEXT_THRESHOLD_CHARS : null,
    target_chars: textProfile === "compact-files" ? COMPACT_FILE_TEXT_TARGET_CHARS : null,
    file_entities: documents.length,
    compacted_files: documents.filter((doc) => doc.text_compacted).length,
    original_chars: documents.reduce((total, doc) => total + doc.text_original_chars, 0),
    text_chars: documents.reduce((total, doc) => total + doc.text_chars, 0),
    saved_chars: documents.reduce((total, doc) => total + doc.text_omitted_chars, 0)
  };
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
  const uniqueSignatures = new Set<string>();
  for (const entity of entities) {
    uniqueSignatures.add(entity.signature);
  }
  const uniqueTextCount = uniqueSignatures.size;
  uniqueSignatures.clear();

  env.cacheDir = MODEL_CACHE_DIR;
  // Total thread budget for embedding. CORTEX_EMBED_THREADS caps it so
  // co-located embedders (parallel CI jobs, eval containers) do not
  // oversubscribe shared cores; unset = all cores.
  const threadsRaw = Number(process.env.CORTEX_EMBED_THREADS);
  const threadBudget =
    Number.isFinite(threadsRaw) && threadsRaw >= 1 ? Math.floor(threadsRaw) : os.cpus().length;
  const readHeadroom = () =>
    resolveMemoryHeadroom({
      freeMemory: os.freemem(),
      totalMemory: os.totalmem(),
      constrainedMemory: process.constrainedMemory?.() ?? null,
      availableMemory: process.availableMemory?.() ?? null
    });
  const memoryHeadroom = readHeadroom();
  const previewPoolConfig = resolvePoolConfig({
    threadBudget,
    uniqueCount: uniqueTextCount,
    memoryBytes: memoryHeadroom
  });
  const requestedTokenBudget = resolveTokenBudgetChoice(process.env.CORTEX_EMBED_MAX_TOKENS, uniqueTextCount);
  const tokenBudget = resolveEffectiveTokenBudget({
    choice: requestedTokenBudget,
    modelMaxTokens: resolveModelMaxTokens(undefined, requestedTokenBudget.cap ?? undefined),
    memoryBytes: memoryHeadroom,
    sessions: previewPoolConfig.sessions
  });
  const defaultSignatureProfile = resolveSignatureProfile(tokenBudget.cap, "full");
  const fileSignatureProfile = resolveSignatureProfile(tokenBudget.cap, textProfile, "File");
  const signatureProfileForEntity = (entity: SearchEntity) =>
    entity.type === "File" ? fileSignatureProfile : defaultSignatureProfile;

  const existing = parseExistingEmbeddings(readJsonlRecords(EMBEDDINGS_PATH), modelId);

  let reused = 0;
  // Slot per entity keeps output in entity order; failed slots stay null.
  const slots: Array<EmbeddingRecord | null> = entities.map(() => null);
  const pending: PendingText[] = [];
  let dimensions = 0;

  entities.forEach((entity, index) => {
    const signatureProfile = signatureProfileForEntity(entity);
    const signature = embeddingSignature(entity.signature, signatureProfile);
    const previous = existing.get(entity.id);
    if (previous && previous.signature === signature && previous.vector.length > 0) {
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
        signature,
        model: modelId,
        dimensions: previous.vector.length
      };
      return;
    }
    pending.push({ index, text: normalizeText(entity.text) });
  });

  // Deduplicate identical texts (lossless: identical input -> identical
  // vector), then measure token lengths for routing and batch packing.
  const unique = groupDuplicates(pending);
  // Memory headroom drives pool size and the concurrency gate; everything
  // adapts to the machine so no tuning is expected from users. Container
  // limits (cgroups) and platforms that under-report free memory are both
  // handled inside resolveMemoryHeadroom.
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
  let embedded = 0;
  let modelMaxTokensUsed = 0;
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
    const modelMaxTokens = resolveModelMaxTokens(
      first.tokenizer?.model_max_length,
      tokenBudget.cap ?? undefined
    );
    modelMaxTokensUsed = modelMaxTokens;
    const countTokens = createTokenCounter(first.tokenizer, modelMaxTokens);
    const countRawTokens = createTokenCounter(first.tokenizer, 131072);

    const measured: MeasuredText[] = unique.map((item) => {
      const text = truncateTextToTokenBudget(item.text, countRawTokens, modelMaxTokens);
      return { ...item, text, tokens: countTokens(text) };
    });
    const units = packWorkUnits(measured, schedulerOptions);
    console.log(
      `[embed] scheduler unique=${unique.length} units=${units.length} max_tokens<=${modelMaxTokens} token_budget=${tokenBudget.mode} reason=${tokenBudget.reason}`
    );
    // Recompute headroom after the model copies are resident so the gate
    // reflects what is actually left for inference activations.
    const inFlightRaw = Number(process.env.CORTEX_EMBED_INFLIGHT_TOKENS);
    const maxInFlightTokens =
      Number.isFinite(inFlightRaw) && inFlightRaw >= 1024
        ? Math.floor(inFlightRaw)
        : resolveInFlightTokens({ memoryBytes: readHeadroom(), modelMaxTokens });
    result = await runWorkUnits(units, extractors, {
      maxInFlightTokens,
      onVector(index, rawVector) {
        const entity = entities[index];
        const signatureProfile = signatureProfileForEntity(entity);
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
          signature: embeddingSignature(entity.signature, signatureProfile),
          model: modelId,
          dimensions: vector.length,
          vector
        };
      }
    });
  }

  const failures = result.failures.map(
    (failure) => `${entities[failure.index].id}: ${failure.message}`
  );
  const failed = result.failures.length;

  const outputCount = writeJsonlRecords(EMBEDDINGS_PATH, presentEmbeddingRecords(slots));

  const manifest = {
    generated_at: new Date().toISOString(),
    mode,
    model: modelId,
    dimensions,
    text_profile: textProfile,
    signature_profile: fileSignatureProfile === defaultSignatureProfile ? defaultSignatureProfile : "per_entity",
    signature_profiles: {
      default: defaultSignatureProfile,
      file: fileSignatureProfile
    },
    text_profile_stats: textProfileStats,
    counts: {
      entities: entities.length,
      output: outputCount,
      embedded,
      reused,
      failed
    },
    failures: failures.slice(0, 50)
  };

  fs.writeFileSync(EMBEDDINGS_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(
    `[embed] mode=${mode} model=${modelId} dim=${dimensions} pool=${poolConfig.sessions}x${poolConfig.threadsPerSession} batch<=${schedulerOptions.batchMaxItems} max_tokens<=${modelMaxTokensUsed || tokenBudget.cap || "model"} token_budget=${tokenBudget.mode} reason=${tokenBudget.reason} text_profile=${textProfile}`
  );
  console.log(
    `[embed] text_profile=${textProfile} compacted_files=${textProfileStats.compacted_files}/${textProfileStats.file_entities} saved_chars=${textProfileStats.saved_chars}`
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
