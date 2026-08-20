import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { env, pipeline } from "@huggingface/transformers";
import {
  readJsonl as readJsonlUnchecked,
  readJsonlRecords as readJsonlRecordsUnchecked,
  asString,
  asNumber,
  asBoolean
} from "./jsonl.js";
import { CACHE_DIR, CONTEXT_DIR, PATHS, REPO_ROOT } from "./paths.js";
import {
  acquireIndexingLock,
  atomicWriteJson,
  atomicWriteJsonl,
  assertSecureManagedFile,
  coveragePercent,
  ensureSecureManagedDirectory,
  releaseIndexingLock,
  readIndexingLock,
  readIndexingState,
  removeOldProgressSnapshots,
  resolvePublishedEmbeddingsPath,
  writeProgressiveFailureIfOwned,
  writeIndexingState,
  type IndexingState
} from "./progressiveIndexing.js";
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
const INDEXING_STATE_PATH = path.join(EMBEDDINGS_DIR, "indexing-state.json");
const INDEXING_CONTROL_PATH = path.join(EMBEDDINGS_DIR, "indexing-control.json");
const INDEXING_LOCK_DIR = path.join(CONTEXT_DIR, "indexing.lock");
const INGEST_MANIFEST_PATH = path.join(CACHE_DIR, "manifest.json");
const GRAPH_MANIFEST_PATH = path.join(CACHE_DIR, "graph-manifest.json");

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

type EmbedArgs = {
  mode: "full" | "changed";
  progressive: boolean;
  profile: string;
  runId: string;
};

function parseArgs(argv: string[]): EmbedArgs {
  const values = argv.slice(2);
  const args = new Set(values);
  const profileIndex = values.indexOf("--profile");
  const runIdIndex = values.indexOf("--run-id");
  const profile = profileIndex >= 0 ? values[profileIndex + 1] : process.env.CORTEX_INDEXING_PROFILE;
  const runId = runIdIndex >= 0 ? values[runIdIndex + 1] : process.env.CORTEX_INDEXING_RUN_ID;
  const progressive = args.has("--progressive") || process.env.CORTEX_INDEXING_PROGRESSIVE === "1";
  if (progressive && profile !== "interactive") {
    throw new Error(`Progressive indexing requires --profile interactive (received ${JSON.stringify(profile ?? "")})`);
  }
  return {
    mode: args.has("--changed") ? "changed" : "full",
    progressive,
    profile: profile || "foreground",
    runId: runId || crypto.randomUUID()
  };
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  try {
    assertSecureManagedFile(REPO_ROOT, filePath);
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function readJsonl(filePath: string): JsonObject[] {
  try {
    assertSecureManagedFile(REPO_ROOT, filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return readJsonlUnchecked(filePath);
}

function readJsonlRecords(filePath: string): Iterable<JsonObject> {
  try {
    assertSecureManagedFile(REPO_ROOT, filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return readJsonlRecordsUnchecked(filePath);
}

function requiredGeneration(value: Record<string, unknown> | null, field: string, label: string): string {
  const generation = value?.[field];
  if (typeof generation === "string" && generation) return generation;
  if (field === "generation_id" && typeof value?.generated_at === "string" && value.generated_at) {
    return `legacy:${value.generated_at}`;
  }
  throw new Error(`${label} is missing ${field}; run cortex ingest and cortex graph-load with the current CLI`);
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
    try {
      assertSecureManagedFile(REPO_ROOT, filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
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

async function runEmbedding(args: EmbedArgs, lockToken: string): Promise<void> {
  const { mode, progressive, profile, runId } = args;
  ensureSecureManagedDirectory(REPO_ROOT, CACHE_DIR);
  ensureRequiredFiles();

  ensureSecureManagedDirectory(REPO_ROOT, EMBEDDINGS_DIR);
  ensureSecureManagedDirectory(REPO_ROOT, MODEL_CACHE_DIR);

  const ingestManifest = readJsonObject(INGEST_MANIFEST_PATH);
  const ingestGeneration = requiredGeneration(ingestManifest, "generation_id", "Ingest manifest");
  const graphManifest = readJsonObject(GRAPH_MANIFEST_PATH);
  const graphGeneration = progressive
    ? requiredGeneration(graphManifest, "generation_id", "Graph manifest")
    : typeof graphManifest?.generation_id === "string" ? graphManifest.generation_id : "";
  if (progressive && graphManifest?.ingest_generation !== ingestGeneration) {
    throw new Error("Graph manifest does not match the current ingest generation");
  }
  const resources = {
    ingest_workers: progressive ? 2 : 0,
    embedding_sessions: progressive ? 1 : 0,
    embedding_threads: progressive ? 4 : 0,
    logical_cpus: os.cpus().length,
    total_memory_bytes: os.totalmem(),
    platform: os.platform(),
    arch: os.arch()
  };

  const assertMutationOwnership = (): void => {
    const owner = readIndexingLock(INDEXING_LOCK_DIR, REPO_ROOT);
    if (
      owner?.run_id !== runId ||
      owner.lock_token !== lockToken ||
      (progressive && (owner.pid !== process.pid || owner.mode !== "progressive"))
    ) {
      throw new Error("Embedding worker lost lock ownership; refusing index mutation");
    }
  };

  const assertInputGeneration = (): void => {
    const currentIngest = readJsonObject(INGEST_MANIFEST_PATH);
    let currentIngestGeneration = "";
    try {
      currentIngestGeneration = requiredGeneration(currentIngest, "generation_id", "Ingest manifest");
    } catch {
      // The error below deliberately avoids publishing against unreadable inputs.
    }
    if (currentIngestGeneration !== ingestGeneration) {
      throw new Error("Ingest generation changed while embeddings were running; refusing stale publication");
    }
    if (progressive) {
      const currentGraph = readJsonObject(GRAPH_MANIFEST_PATH);
      if (
        requiredGeneration(currentGraph, "generation_id", "Graph manifest") !== graphGeneration ||
        currentGraph?.ingest_generation !== ingestGeneration
      ) {
        throw new Error("Graph generation changed while embeddings were running; refusing stale publication");
      }
    }
  };

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

  const previousIndexingState = readIndexingState(INDEXING_STATE_PATH, REPO_ROOT);
  const startedAt =
    progressive && previousIndexingState && previousIndexingState.state !== "complete"
      ? previousIndexingState.started_at
      : new Date().toISOString();
  let checkpointSequence = progressive ? previousIndexingState?.checkpoint_sequence ?? 0 : 0;
  let lastCheckpointCount = progressive ? previousIndexingState?.completed_entities ?? 0 : 0;
  let lastSnapshotFile = progressive ? previousIndexingState?.snapshot_file ?? null : null;

  const writeProgressState = (
    values: Partial<IndexingState> & Pick<IndexingState, "state">
  ): void => {
    if (!progressive) return;
    const current = readIndexingState(INDEXING_STATE_PATH, REPO_ROOT);
    const owner = readIndexingLock(INDEXING_LOCK_DIR, REPO_ROOT);
    if (
      current?.run_id !== runId ||
      owner?.run_id !== runId ||
      owner.lock_token !== lockToken ||
      owner.pid !== process.pid ||
      owner.mode !== "progressive"
    ) {
      throw new Error("Progressive worker lost run ownership; refusing state publication");
    }
    const control = readJsonObject(INDEXING_CONTROL_PATH);
    const completed = values.completed_entities ?? current?.completed_entities ?? 0;
    const now = new Date().toISOString();
    writeIndexingState(INDEXING_STATE_PATH, {
      schema_version: 1,
      state: values.state,
      desired_state:
        values.desired_state ??
        (control?.run_id === runId && control.desired_state === "paused" ? "paused" : "running"),
      active_profile: profile,
      pid: process.pid,
      model: modelId,
      search_ready: "lexical+graph",
      total_entities: entities.length,
      completed_entities: completed,
      semantic_coverage_percent: coveragePercent(completed, entities.length),
      embedded: values.embedded ?? current?.embedded ?? 0,
      reused: values.reused ?? current?.reused ?? 0,
      failed: values.failed ?? current?.failed ?? 0,
      started_at: startedAt,
      updated_at: now,
      last_checkpoint_at: values.last_checkpoint_at ?? current?.last_checkpoint_at ?? null,
      checkpoint_sequence: values.checkpoint_sequence ?? current?.checkpoint_sequence ?? checkpointSequence,
      snapshot_file: values.snapshot_file ?? current?.snapshot_file ?? lastSnapshotFile,
      run_id: runId,
      ingest_generation: ingestGeneration,
      graph_generation: graphGeneration,
      heartbeat_at: now,
      resources,
      ...(values.error ? { error: values.error } : {})
    }, REPO_ROOT);
  };

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

  const publishedEmbeddingsPath = resolvePublishedEmbeddingsPath(
    EMBEDDINGS_DIR,
    EMBEDDINGS_PATH,
    readJsonObject(EMBEDDINGS_MANIFEST_PATH)
  );
  const existing = parseExistingEmbeddings(readJsonlRecords(publishedEmbeddingsPath), modelId);

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

  const checkpointEveryRaw = Number(process.env.CORTEX_EMBED_CHECKPOINT_EVERY);
  const checkpointEvery =
    Number.isFinite(checkpointEveryRaw) && checkpointEveryRaw >= 1
      ? Math.floor(checkpointEveryRaw)
      : Math.max(250, Math.ceil(entities.length * 0.05));
  const milestoneCounts = new Set(
    [0.1, 0.25, 0.5, 0.75].map((ratio) => Math.ceil(entities.length * ratio))
  );
  const pauseWait = new Int32Array(new SharedArrayBuffer(4));

  const buildManifest = ({
    generatedAt,
    outputCount,
    failedCount,
    failures,
    snapshotFile,
    snapshotBytes,
    snapshotSha256,
    final
  }: {
    generatedAt: string;
    outputCount: number;
    failedCount: number;
    failures: string[];
    snapshotFile: string;
    snapshotBytes: number;
    snapshotSha256: string;
    final: boolean;
  }) => ({
    schema_version: 2,
    generated_at: generatedAt,
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
    progressive,
    run_id: runId,
    ingest_generation: ingestGeneration,
    graph_generation: graphGeneration || null,
    readiness: final && failedCount === 0 && outputCount === entities.length ? "full" : "partial",
    active_profile: profile,
    semantic_coverage_percent: coveragePercent(outputCount, entities.length),
    snapshot_file: snapshotFile,
    snapshot_bytes: snapshotBytes,
    snapshot_sha256: snapshotSha256,
    checkpoint_sequence: checkpointSequence,
    counts: {
      entities: entities.length,
      output: outputCount,
      embedded,
      reused,
      failed: failedCount
    },
    failures: failures.slice(0, 50)
  });

  const publishSnapshot = (
    reason: string,
    { final = false, failedCount = 0, failures = [] as string[] } = {}
  ): number => {
    assertMutationOwnership();
    assertInputGeneration();
    checkpointSequence += 1;
    const generatedAt = new Date().toISOString();
    const snapshotFile = final
      ? path.basename(EMBEDDINGS_PATH)
      : `entities.progress-${Date.now()}-${checkpointSequence}.jsonl`;
    const snapshotPath = path.join(EMBEDDINGS_DIR, snapshotFile);
    const snapshot = atomicWriteJsonl(snapshotPath, presentEmbeddingRecords(slots), REPO_ROOT);
    const manifest = buildManifest({
      generatedAt,
      outputCount: snapshot.count,
      failedCount,
      failures,
      snapshotFile,
      snapshotBytes: snapshot.bytes,
      snapshotSha256: snapshot.sha256,
      final
    });
    atomicWriteJson(EMBEDDINGS_MANIFEST_PATH, manifest, REPO_ROOT);

    const previousSnapshot = lastSnapshotFile;
    lastSnapshotFile = snapshotFile;
    lastCheckpointCount = snapshot.count;
    if (progressive) {
      writeProgressState({
        state: final
          ? failedCount > 0 || snapshot.count !== entities.length
            ? "complete_with_failures"
            : "complete"
          : "running",
        completed_entities: snapshot.count,
        embedded,
        reused,
        failed: failedCount,
        last_checkpoint_at: generatedAt,
        checkpoint_sequence: checkpointSequence,
        snapshot_file: snapshotFile
      });
      removeOldProgressSnapshots(
        EMBEDDINGS_DIR,
        final ? [previousSnapshot ?? ""] : [snapshotFile, previousSnapshot ?? ""],
        REPO_ROOT
      );
      console.log(
        `[embed] checkpoint=${checkpointSequence} reason=${reason} completed=${snapshot.count}/${entities.length} coverage=${coveragePercent(snapshot.count, entities.length)}%`
      );
    }
    return snapshot.count;
  };

  const shouldCheckpoint = (completed: number): boolean =>
    progressive &&
    completed < entities.length &&
    (
      completed - lastCheckpointCount >= checkpointEvery ||
      Array.from(milestoneCounts).some(
        (milestone) => milestone > lastCheckpointCount && completed >= milestone
      ));

  const waitWhilePaused = (): void => {
    if (!progressive) return;
    let control = readJsonObject(INDEXING_CONTROL_PATH);
    if (control?.run_id !== runId || control.desired_state !== "paused") return;

    if (reused + embedded > lastCheckpointCount) {
      publishSnapshot("pause");
    }
    writeProgressState({
      state: "paused",
      completed_entities: lastCheckpointCount,
      embedded,
      reused,
      failed: 0
    });
    while (true) {
      control = readJsonObject(INDEXING_CONTROL_PATH);
      if (control?.run_id !== runId || control.desired_state !== "paused") break;
      Atomics.wait(pauseWait, 0, 0, 250);
    }
    writeProgressState({
      state: "running",
      completed_entities: lastCheckpointCount,
      embedded,
      reused,
      failed: 0
    });
  };

  if (progressive) {
    publishSnapshot(previousIndexingState?.snapshot_file ? "resume" : "initial");
    waitWhilePaused();
  }

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
        waitWhilePaused();
        const completed = reused + embedded;
        if (shouldCheckpoint(completed)) {
          publishSnapshot("progress");
        }
      }
    });
  }

  const failures = result.failures.map(
    (failure) => `${entities[failure.index].id}: ${failure.message}`
  );
  const failed = result.failures.length;

  const outputCount = publishSnapshot("complete", { final: true, failedCount: failed, failures });

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

export async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.progressive && process.env.CORTEX_INDEXING_HANDSHAKE_FD) {
    const fd = Number(process.env.CORTEX_INDEXING_HANDSHAKE_FD);
    if (!Number.isInteger(fd) || fd < 3) throw new Error("Invalid progressive launcher handshake descriptor");
    const handshake = fs.readFileSync(fd, "utf8").trim();
    if (handshake !== args.runId) throw new Error("Progressive launcher handshake did not match run identity");
  }
  ensureSecureManagedDirectory(REPO_ROOT, CONTEXT_DIR);
  const existingLock = readIndexingLock(INDEXING_LOCK_DIR, REPO_ROOT);
  const inheritedLockToken = process.env.CORTEX_INDEXING_LOCK_TOKEN || "";
  const nestedForeground =
    !args.progressive &&
    existingLock?.run_id === args.runId &&
    existingLock.lock_token === inheritedLockToken &&
    existingLock.mode === "foreground";
  const ownedLock = nestedForeground
    ? existingLock!
    : acquireIndexingLock(INDEXING_LOCK_DIR, {
      schema_version: 1,
      run_id: args.runId,
      pid: process.pid,
      mode: args.progressive ? "progressive" : "foreground",
      action: args.progressive ? "progressive-embed" : "embed",
      created_at: new Date().toISOString(),
      ...(inheritedLockToken ? { lock_token: inheritedLockToken } : {})
    });
  if (args.progressive) {
    const ackPath = path.join(EMBEDDINGS_DIR, `.indexing-start-${args.runId}.ack.json`);
    atomicWriteJson(ackPath, {
      schema_version: 1,
      run_id: args.runId,
      pid: process.pid,
      acknowledged_at: new Date().toISOString()
    }, REPO_ROOT);
  }
  try {
    await runEmbedding(args, ownedLock.lock_token);
    if (!args.progressive) {
      for (const managedPath of [INDEXING_STATE_PATH, INDEXING_CONTROL_PATH]) {
        try {
          const stat = fs.lstatSync(managedPath);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) {
            throw new Error(`Refusing to remove unsafe progressive state: ${managedPath}`);
          }
          fs.rmSync(managedPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    }
  } catch (error) {
    if (args.progressive) {
      writeProgressiveFailureIfOwned(
        INDEXING_STATE_PATH,
        INDEXING_LOCK_DIR,
        args.runId,
        process.pid,
        ownedLock.lock_token,
        error instanceof Error ? error.message : "Embedding error",
        REPO_ROOT
      );
    }
    throw error;
  } finally {
    if (!nestedForeground) {
      releaseIndexingLock(INDEXING_LOCK_DIR, args.runId, ownedLock.lock_token);
    }
  }
}

const isMain = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false;
if (isMain) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Embedding error";
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
