import { loadContextData } from "./graph.js";
import { iterateSearchEntities } from "./contextEntities.js";
import { embedQuery, loadEmbeddingIndex } from "./embeddings.js";
import { runContextSearch } from "./search.js";
import type { ChunkRecord, ContextData, PatternEvidenceParams, ToolPayload } from "./types.js";

type SearchResult = Record<string, unknown>;

type PatternTarget = {
  input: string;
  entity_id: string;
  entity_type: "File" | "Chunk" | "ADR";
  path: string;
};

type PatternEvidence = {
  id: string;
  entity_type: string;
  kind: string;
  title: string;
  path: string;
  start_line?: number;
  end_line?: number;
  excerpt: string;
  score?: number;
  matched_rules?: unknown[];
};

export type PatternEvidenceTierName =
  | "same_file"
  | "same_module"
  | "same_feature_area"
  | "repo_wide";

type PatternEvidenceTier = {
  name: PatternEvidenceTierName;
  scope: string;
  evidence: PatternEvidence[];
};

const EVIDENCE_TIERS: Array<{ name: PatternEvidenceTierName; scope: string }> = [
  { name: "same_file", scope: "Same file as the review target." },
  { name: "same_module", scope: "Same directory or module as the review target." },
  { name: "same_feature_area", scope: "Same parent feature area as the review target." },
  { name: "repo_wide", scope: "Repository-wide fallback evidence." },
];

export function normalizeRepoPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  return normalized.replace(/\/{2,}/g, "/").replace(/\/$/, "");
}

function dirnameRepoPath(value: string): string {
  const normalized = normalizeRepoPath(value);
  const separator = normalized.lastIndexOf("/");
  return separator === -1 ? "." : normalized.slice(0, separator) || ".";
}

function parentRepoPath(value: string): string | null {
  const normalized = normalizeRepoPath(value);
  if (!normalized || normalized === ".") {
    return null;
  }
  const separator = normalized.lastIndexOf("/");
  return separator === -1 ? "." : normalized.slice(0, separator) || ".";
}

function isWithinPath(candidate: string, directory: string | null): boolean {
  if (!directory || directory === ".") {
    return false;
  }
  return candidate === directory || candidate.startsWith(`${directory}/`);
}

function resolvePatternTarget(data: ContextData, input: string): PatternTarget {
  const normalizedInput = normalizeRepoPath(input);
  const document = data.documents.find(
    (entry) => entry.id === input || normalizeRepoPath(entry.path) === normalizedInput,
  );
  if (document) {
    return {
      input,
      entity_id: document.id,
      entity_type: document.kind === "ADR" ? "ADR" : "File",
      path: normalizeRepoPath(document.path),
    };
  }

  const chunk = data.chunks.find((entry) => entry.id === input);
  if (chunk) {
    const owner = data.documents.find((entry) => entry.id === chunk.file_id);
    if (!owner) {
      throw new Error(`Pattern target chunk has no indexed owner file: ${input}`);
    }
    return {
      input,
      entity_id: chunk.id,
      entity_type: "Chunk",
      path: normalizeRepoPath(owner.path),
    };
  }

  const adr = data.adrs.find((entry) => entry.id === input);
  if (adr?.path) {
    return {
      input,
      entity_id: adr.id,
      entity_type: "ADR",
      path: normalizeRepoPath(adr.path),
    };
  }

  const knownEntity = [
    ...data.rules.map((entry) => entry.id),
    ...data.modules.map((entry) => entry.id),
    ...data.projects.map((entry) => entry.id),
  ].includes(input);
  if (knownEntity) {
    throw new Error(`Pattern target is not file-backed: ${input}`);
  }
  throw new Error(`Pattern target was not found in indexed context: ${input}`);
}

function derivePatternQuery(data: ContextData, target: PatternTarget): string {
  if (target.entity_type === "Chunk") {
    const chunk = data.chunks.find((entry) => entry.id === target.entity_id);
    if (chunk) {
      return [chunk.name, chunk.kind, chunk.signature].filter(Boolean).join(" ");
    }
  }

  const document = data.documents.find((entry) => entry.id === target.entity_id);
  const chunkSignals = data.chunks
    .filter((entry) => entry.file_id === target.entity_id && !entry.id.includes(":window:"))
    .slice(0, 12)
    .flatMap((entry) => [entry.name, entry.kind])
    .filter(Boolean);
  const basename = target.path.split("/").at(-1)?.replace(/\.[^.]+$/, "") ?? target.path;
  return [basename, ...chunkSignals, document?.excerpt ?? ""].filter(Boolean).join(" ").slice(0, 1000);
}

function tierForPath(targetPath: string, candidatePath: string): PatternEvidenceTierName {
  const normalizedTarget = normalizeRepoPath(targetPath);
  const normalizedCandidate = normalizeRepoPath(candidatePath);
  if (normalizedCandidate === normalizedTarget) {
    return "same_file";
  }

  const targetModule = dirnameRepoPath(normalizedTarget);
  if (dirnameRepoPath(normalizedCandidate) === targetModule) {
    return "same_module";
  }

  const featureArea = parentRepoPath(targetModule);
  if (isWithinPath(normalizedCandidate, featureArea)) {
    return "same_feature_area";
  }
  return "repo_wide";
}

function toPatternEvidence(result: SearchResult, chunksById: Map<string, ChunkRecord>): PatternEvidence | null {
  const id = typeof result.id === "string" ? result.id : "";
  const candidatePath = typeof result.path === "string" ? normalizeRepoPath(result.path) : "";
  if (!id || !candidatePath) {
    return null;
  }

  const chunk = chunksById.get(id);
  const entityType = typeof result.entity_type === "string" ? result.entity_type : "";
  if (entityType === "Chunk" && (!chunk || chunk.start_line <= 0 || chunk.end_line < chunk.start_line)) {
    return null;
  }
  const evidence: PatternEvidence = {
    id,
    entity_type: entityType,
    kind: typeof result.kind === "string" ? result.kind : "",
    title: typeof result.title === "string" ? result.title : id,
    path: candidatePath,
    excerpt: typeof result.excerpt === "string" ? result.excerpt : "",
  };
  if (chunk) {
    evidence.start_line = chunk.start_line;
    evidence.end_line = chunk.end_line;
  }
  if (typeof result.score === "number") {
    evidence.score = result.score;
  }
  if (Array.isArray(result.matched_rules)) {
    evidence.matched_rules = [...new Set(result.matched_rules)];
  }
  return evidence;
}

const referenceTimeCache = new WeakMap<ContextData, number>();

export function contextReferenceTimeMs(data: ContextData): number {
  const cached = referenceTimeCache.get(data);
  if (cached !== undefined) {
    return cached;
  }
  let latest = 0;
  const consider = (value: string): void => {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp) && timestamp > latest) {
      latest = timestamp;
    }
  };
  for (const entry of data.documents) consider(entry.updated_at);
  for (const entry of data.rules) consider(entry.updated_at);
  for (const entry of data.adrs) consider(entry.decision_date);
  for (const entry of data.chunks) consider(entry.updated_at);
  for (const entry of data.modules) consider(entry.updated_at);
  for (const entry of data.projects) consider(entry.updated_at);
  referenceTimeCache.set(data, latest);
  return latest;
}

export function classifyPatternEvidence(input: {
  target: PatternTarget;
  results: SearchResult[];
  chunks: ChunkRecord[];
  topK: number;
}): { tiers: PatternEvidenceTier[]; localPatternFound: boolean; fallbackUsed: boolean } {
  const chunksById = new Map(input.chunks.map((chunk) => [chunk.id, chunk]));
  const evidenceByTier = new Map<PatternEvidenceTierName, PatternEvidence[]>(
    EVIDENCE_TIERS.map((tier) => [tier.name, []]),
  );
  const seen = new Set<string>();

  for (const result of input.results) {
    if (result.id === input.target.entity_id) {
      continue;
    }
    const evidence = toPatternEvidence(result, chunksById);
    if (!evidence || seen.has(evidence.id)) {
      continue;
    }
    seen.add(evidence.id);
    const tierName = tierForPath(input.target.path, evidence.path);
    const tierEvidence = evidenceByTier.get(tierName);
    if (tierEvidence && tierEvidence.length < input.topK) {
      tierEvidence.push(evidence);
    }
  }

  const tiers = EVIDENCE_TIERS.map((tier) => ({
    ...tier,
    evidence: evidenceByTier.get(tier.name) ?? [],
  }));
  const localPatternFound = tiers.slice(0, 3).some((tier) => tier.evidence.length > 0);
  const fallbackUsed = !localPatternFound && tiers[3].evidence.length > 0;
  return { tiers, localPatternFound, fallbackUsed };
}

export async function runPatternEvidence(
  parsed: PatternEvidenceParams,
  options: { data?: ContextData; use_embeddings?: boolean } = {}
): Promise<ToolPayload> {
  const data = options.data ?? await loadContextData();
  const target = resolvePatternTarget(data, parsed.target);
  const explicitQuery = parsed.query?.trim();
  const query = explicitQuery || derivePatternQuery(data, target);
  if (!query) {
    throw new Error(`Could not derive a pattern query for target: ${parsed.target}`);
  }

  const referenceTimeMs = contextReferenceTimeMs(data);
  const embeddingIndex = options.use_embeddings === false
    ? { model: null, vectors: new Map<string, Float32Array>() }
    : loadEmbeddingIndex();
  const queryVector = embeddingIndex.model && embeddingIndex.vectors.size > 0
    ? await embedQuery(query, embeddingIndex.model)
    : null;
  const tierByEntityId = new Map<string, PatternEvidenceTierName>();
  for (const entity of iterateSearchEntities(data, false)) {
    if (
      entity.id !== target.entity_id &&
      entity.path &&
      (entity.entity_type === "File" || entity.entity_type === "Chunk" || entity.entity_type === "ADR")
    ) {
      tierByEntityId.set(entity.id, tierForPath(target.path, entity.path));
    }
  }

  const searchResults: SearchResult[] = [];
  const warningParts: string[] = [];
  let contextSource: unknown = data.source;
  let semanticEngine: unknown;
  for (const tier of EVIDENCE_TIERS) {
    const search = await runContextSearch(
      {
        query,
        top_k: parsed.top_k,
        include_deprecated: parsed.include_deprecated ?? false,
        response_preset: "full",
        include_scores: true,
        include_matched_rules: true,
      },
      {
        data,
        reference_time_ms: referenceTimeMs,
        embedding_index: embeddingIndex,
        query_vector: queryVector,
        candidate_filter: (entity) => tierByEntityId.get(entity.id) === tier.name,
      },
    );
    if (Array.isArray(search.results)) {
      searchResults.push(...search.results as SearchResult[]);
    }
    if (typeof search.warning === "string" && !warningParts.includes(search.warning)) {
      warningParts.push(search.warning);
    }
    contextSource = search.context_source ?? contextSource;
    semanticEngine = search.semantic_engine ?? semanticEngine;
  }
  const classified = classifyPatternEvidence({
    target,
    results: searchResults,
    chunks: data.chunks,
    topK: parsed.top_k,
  });
  if (!classified.localPatternFound) {
    warningParts.push("No applicable file-local, module-local, or feature-local pattern evidence was found.");
  }

  return {
    target,
    query,
    query_source: explicitQuery ? "explicit" : "derived_from_target",
    evidence_order: EVIDENCE_TIERS.map((tier) => tier.name),
    top_k_per_tier: parsed.top_k,
    ranking_reference_time: referenceTimeMs > 0 ? new Date(referenceTimeMs).toISOString() : null,
    local_pattern_found: classified.localPatternFound,
    fallback_used: classified.fallbackUsed,
    tiers: classified.tiers,
    context_source: contextSource,
    semantic_engine: semanticEngine,
    warning: warningParts.length > 0 ? warningParts.join(" | ") : undefined,
  };
}

export async function runLocalPatternEvidence(
  parsed: PatternEvidenceParams,
  options: { data?: ContextData } = {}
): Promise<ToolPayload> {
  return runPatternEvidence(parsed, { ...options, use_embeddings: false });
}
