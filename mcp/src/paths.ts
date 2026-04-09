import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RankingWeights } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function normalizeForWsl(rawPath: string): string {
  const winMatch = rawPath.match(/^([A-Za-z]):[/\\](.*)/);
  if (!winMatch) return rawPath;
  try {
    const version = fs.readFileSync("/proc/version", "utf8");
    if (!/microsoft|wsl/i.test(version)) return rawPath;
  } catch {
    return rawPath;
  }
  const drive = winMatch[1].toLowerCase();
  const rest = winMatch[2].replace(/\\/g, "/").replace(/\/+$/, "");
  return `/mnt/${drive}/${rest}`;
}

const PROJECT_ROOT_OVERRIDE = process.env.CORTEX_PROJECT_ROOT?.trim();
export const REPO_ROOT = PROJECT_ROOT_OVERRIDE
  ? path.resolve(normalizeForWsl(PROJECT_ROOT_OVERRIDE))
  : path.resolve(__dirname, "../..");
export const CONTEXT_DIR = path.join(REPO_ROOT, ".context");
export const CACHE_DIR = path.join(CONTEXT_DIR, "cache");
export const DB_PATH = path.join(CONTEXT_DIR, "db", "graph.ryu");

export const EMBEDDINGS_DIR = path.join(CONTEXT_DIR, "embeddings");
export const ONTOLOGY_PATH = path.join(CONTEXT_DIR, "ontology.cypher");
export const MEMORY_DIR = path.join(CONTEXT_DIR, "memory");

export const PATHS = {
  config: path.join(CONTEXT_DIR, "config.yaml"),
  rulesYaml: path.join(CONTEXT_DIR, "rules.yaml"),
  graphManifest: path.join(CACHE_DIR, "graph-manifest.json"),
  embeddingsManifest: path.join(EMBEDDINGS_DIR, "manifest.json"),
  embeddingsEntities: path.join(EMBEDDINGS_DIR, "entities.jsonl"),
  embeddingsModelCache: path.join(EMBEDDINGS_DIR, "models"),
  documents: path.join(CACHE_DIR, "documents.jsonl"),
  adrEntities: path.join(CACHE_DIR, "entities.adr.jsonl"),
  ruleEntities: path.join(CACHE_DIR, "entities.rule.jsonl"),
  chunkEntities: path.join(CACHE_DIR, "entities.chunk.jsonl"),
  constrainsRelations: path.join(CACHE_DIR, "relations.constrains.jsonl"),
  implementsRelations: path.join(CACHE_DIR, "relations.implements.jsonl"),
  supersedesRelations: path.join(CACHE_DIR, "relations.supersedes.jsonl"),
  definesRelations: path.join(CACHE_DIR, "relations.defines.jsonl"),
  callsRelations: path.join(CACHE_DIR, "relations.calls.jsonl"),
  importsRelations: path.join(CACHE_DIR, "relations.imports.jsonl"),
  memoryRawDir: path.join(MEMORY_DIR, "raw"),
  memoryCompiledDir: path.join(MEMORY_DIR, "compiled")
};

export const DEFAULT_RANKING: RankingWeights = {
  semantic: 0.4,
  graph: 0.25,
  trust: 0.2,
  recency: 0.15
};
