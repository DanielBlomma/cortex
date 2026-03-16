import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env, pipeline } from "@xenova/transformers";
import { readJsonl, asString, asNumber, asBoolean } from "./jsonl.js";
import type { JsonObject, JsonValue } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const CONTEXT_DIR = path.join(REPO_ROOT, ".context");
const CACHE_DIR = path.join(CONTEXT_DIR, "cache");
const EMBEDDINGS_DIR = path.join(CONTEXT_DIR, "embeddings");
const EMBEDDINGS_PATH = path.join(EMBEDDINGS_DIR, "entities.jsonl");
const EMBEDDINGS_MANIFEST_PATH = path.join(EMBEDDINGS_DIR, "manifest.json");
const MODEL_CACHE_DIR = path.join(EMBEDDINGS_DIR, "models");

const DEFAULT_MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const DEFAULT_MAX_TEXT_CHARS = 7000;
const CHUNK_BODY_PREVIEW_CHARS = 2000;

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

function clampText(value: string, maxChars: number): string {
  return value.slice(0, maxChars);
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

function parseFileEntities(raw: JsonObject[], maxChars: number): FileEntity[] {
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
      const text = clampText(`${filePath}\n${excerpt}\n${content}`, maxChars);

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

function parseRuleEntities(raw: JsonObject[], maxChars: number): RuleEntity[] {
  return raw
    .map((item) => {
      const id = asString(item.id);
      if (!id) {
        return null;
      }

      const title = asString(item.title, id);
      const body = asString(item.body);
      const updatedAt = asString(item.updated_at, "");
      const text = clampText(`${title}\n${body}`, maxChars);

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

function parseAdrEntities(raw: JsonObject[], maxChars: number): AdrEntity[] {
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
      const text = clampText(`${adrPath}\n${title}\n${body}`, maxChars);

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

function parseModuleEntities(raw: JsonObject[], maxChars: number): ModuleEntity[] {
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
      const text = clampText(`${modulePath}\n${name}\n${summary}\n${exportedSymbols}`, maxChars);

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

function parseChunkEntities(raw: JsonObject[], filePathById: Map<string, string>, maxChars: number): ChunkEntity[] {
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
      const text = clampText(`${filePath}\n${name}\n${sig}\n${description}\n${body.slice(0, CHUNK_BODY_PREVIEW_CHARS)}`, maxChars);

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

function parseProjectEntities(raw: JsonObject[], maxChars: number): ProjectEntity[] {
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
      const text = clampText(
        `${projectPath}\n${name}\n${kind}\n${language}\n${targetFramework}\n${summary}`,
        maxChars
      );

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

function toEmbeddingVector(output: unknown): number[] {
  if (!output || typeof output !== "object") {
    throw new Error("Invalid embedding output type");
  }

  const data = (output as { data?: unknown }).data;
  if (!data || typeof (data as ArrayLike<number>).length !== "number") {
    throw new Error("Missing embedding data");
  }

  return Array.from(data as ArrayLike<number>).map((value) => Number(value));
}

function roundVector(values: number[]): number[] {
  return values.map((value) => Number(value.toFixed(6)));
}

async function main(): Promise<void> {
  const { mode } = parseArgs(process.argv);
  ensureRequiredFiles();

  fs.mkdirSync(EMBEDDINGS_DIR, { recursive: true });
  fs.mkdirSync(MODEL_CACHE_DIR, { recursive: true });

  const modelId = (process.env.CORTEX_EMBED_MODEL ?? DEFAULT_MODEL_ID).trim() || DEFAULT_MODEL_ID;
  const maxChars = Number(process.env.CORTEX_EMBED_MAX_CHARS ?? DEFAULT_MAX_TEXT_CHARS);
  const maxTextChars = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : DEFAULT_MAX_TEXT_CHARS;

  const documents = parseFileEntities(readJsonl(path.join(CACHE_DIR, "documents.jsonl")), maxTextChars);
  const rules = parseRuleEntities(readJsonl(path.join(CACHE_DIR, "entities.rule.jsonl")), maxTextChars);
  const adrs = parseAdrEntities(readJsonl(path.join(CACHE_DIR, "entities.adr.jsonl")), maxTextChars);
  const modules = parseModuleEntities(readJsonl(path.join(CACHE_DIR, "entities.module.jsonl")), maxTextChars);
  const projects = parseProjectEntities(readJsonl(path.join(CACHE_DIR, "entities.project.jsonl")), maxTextChars);

  // Build file path lookup for chunk embedding text (reuse already-parsed documents)
  const filePathById = new Map<string, string>();
  for (const doc of documents) {
    filePathById.set(doc.id, doc.path);
  }
  const chunks = parseChunkEntities(readJsonl(path.join(CACHE_DIR, "entities.chunk.jsonl")), filePathById, maxTextChars);

  const entities: SearchEntity[] = [...documents, ...rules, ...adrs, ...modules, ...projects, ...chunks].sort((a, b) => a.id.localeCompare(b.id));

  const existing = parseExistingEmbeddings(readJsonl(EMBEDDINGS_PATH), modelId);

  env.cacheDir = MODEL_CACHE_DIR;
  const extractor = await pipeline("feature-extraction", modelId);

  let reused = 0;
  let embedded = 0;
  let failed = 0;
  const failures: string[] = [];
  const output: EmbeddingRecord[] = [];
  let dimensions = 0;

  for (const entity of entities) {
    const previous = existing.get(entity.id);
    if (previous && previous.signature === entity.signature && previous.vector.length > 0) {
      reused += 1;
      dimensions = dimensions || previous.vector.length;
      output.push({
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
      });
      continue;
    }

    try {
      const embeddingOutput = await extractor(normalizeText(entity.text), {
        pooling: "mean",
        normalize: true
      });
      const vector = roundVector(toEmbeddingVector(embeddingOutput));
      if (vector.length === 0) {
        throw new Error("Empty embedding vector");
      }

      embedded += 1;
      dimensions = dimensions || vector.length;
      output.push({
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
      });
    } catch (error) {
      failed += 1;
      failures.push(
        `${entity.id}: ${error instanceof Error ? error.message : "embedding generation failed"}`
      );
    }
  }

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

  console.log(`[embed] mode=${mode} model=${modelId} dim=${dimensions}`);
  console.log(
    `[embed] entities=${entities.length} embedded=${embedded} reused=${reused} failed=${failed}`
  );
  console.log(`[embed] wrote ${EMBEDDINGS_PATH}`);
  console.log(`[embed] manifest ${EMBEDDINGS_MANIFEST_PATH}`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Embedding error"}\n`);
  process.exit(1);
});
