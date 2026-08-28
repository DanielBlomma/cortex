import fs from "node:fs";
import path from "node:path";
import { loadContextData } from "./graph.js";
import { iterateSearchEntities } from "./contextEntities.js";
import { embedQuery, loadEmbeddingIndex } from "./embeddings.js";
import { PATHS, REPO_ROOT } from "./paths.js";
import { runContextSearch } from "./search.js";
import type { ChunkRecord, ContextData, PatternEvidenceParams, SearchEntity, ToolPayload } from "./types.js";

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

type DialectTaskBinding = {
  base_commit: string;
  family: string;
  source_scope: string[];
  task_bytes: number;
  task_id: string;
  task_sha256: string;
};

type DialectSourceCatalogEntry = {
  bytes: number;
  line_count: number;
  path: string;
  source_sha256: string;
};

type DialectRecurrenceInput = {
  task_binding: DialectTaskBinding;
  task_bytes: string | Uint8Array;
  source_catalog: DialectSourceCatalogEntry[];
  ingest_manifest?: string | Record<string, unknown>;
  dialect_sidecar?: string;
};

type DialectRecurrenceOptions = {
  data?: ContextData;
  search?: typeof runContextSearch;
};

type DialectRuntimeContract = {
  DIALECT_CAPABILITY_MANIFEST: { families: Array<{ family: string }> };
  DIALECT_LIMITS: Record<string, number>;
  canonicalJson(value: unknown): string;
  canonicalRepositoryPath(value: unknown): string;
  dialectFamilyForMode(extension: string): { family: string } | null;
  exactKeys(value: unknown, keys: string[], label: string): void;
  hexSha256(value: unknown, label?: string): string;
  sha256(value: string | Uint8Array): string;
  visibleIdentifier(value: unknown, label: string): void;
};

type DialectSidecarRuntime = {
  DIALECT_MANIFEST_FIELD: string;
  parseDialectObservationSidecar(text: string): { records: Array<Record<string, any>>; text: string };
  summarizeDialectObservationSidecar(serialized: { records: Array<Record<string, any>>; text: string }): Record<string, unknown>;
};

const DIALECT_CONTRACT_URL = new URL(
  "../../scripts/lib/dialect-observation-contract.mjs",
  import.meta.url,
).href;
const DIALECT_SIDECAR_URL = new URL(
  "../../scripts/lib/ingest/pipeline-stages.mjs",
  import.meta.url,
).href;

function dialectDiagnostic(value: unknown, limit: number): string {
  const normalized = String(value instanceof Error ? value.message : value)
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, " ")
    .trim();
  return [...(normalized || "dialect recurrence input was rejected")].slice(0, limit).join("");
}

function readContainedCacheFile(filePath: string, maxBytes: number): string {
  const relative = path.relative(REPO_ROOT, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("dialect cache path escaped the repository root");
  }
  let current = REPO_ROOT;
  const componentSnapshots: Array<{ path: string; dev: bigint; ino: bigint; ctimeNs: bigint; directory: boolean }> = [];
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    const stats = fs.lstatSync(current, { bigint: true });
    if (stats.isSymbolicLink()) throw new Error("dialect cache path contains a symlink");
    const directory = current !== filePath;
    if (directory ? !stats.isDirectory() : !stats.isFile()) {
      throw new Error("dialect cache path has an unexpected file type");
    }
    componentSnapshots.push({
      path: current,
      dev: stats.dev,
      ino: stats.ino,
      ctimeNs: stats.ctimeNs,
      directory,
    });
  }
  const descriptor = fs.openSync(
    filePath,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(maxBytes)) {
      throw new Error("dialect cache file failed containment or size policy");
    }
    const leaf = componentSnapshots.at(-1);
    if (!leaf || leaf.dev !== before.dev || leaf.ino !== before.ino || leaf.ctimeNs !== before.ctimeNs) {
      throw new Error("dialect cache file changed before its contained read");
    }
    const text = fs.readFileSync(descriptor, "utf8");
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.ctimeNs !== after.ctimeNs ||
      before.size !== after.size
    ) {
      throw new Error("dialect cache file changed during validation");
    }
    for (const snapshot of componentSnapshots) {
      const currentStats = fs.lstatSync(snapshot.path, { bigint: true });
      if (
        currentStats.isSymbolicLink() ||
        (snapshot.directory ? !currentStats.isDirectory() : !currentStats.isFile()) ||
        snapshot.dev !== currentStats.dev ||
        snapshot.ino !== currentStats.ino ||
        snapshot.ctimeNs !== currentStats.ctimeNs
      ) {
        throw new Error("dialect cache path changed during its contained read");
      }
    }
    return text;
  } finally {
    fs.closeSync(descriptor);
  }
}

function pathIsScoped(repositoryPath: string, scopes: string[]): boolean {
  return scopes.some((scope) => repositoryPath === scope || repositoryPath.startsWith(`${scope}/`));
}

function sourceMode(repositoryPath: string): string {
  const extension = path.posix.extname(repositoryPath).toLowerCase();
  return extension;
}

function createDialectEvaluationOutput(
  taskId: string,
  renderedOutput: string,
  claims: Array<Record<string, unknown>>,
  diagnostics: string[],
  runtime: DialectRuntimeContract,
): Record<string, unknown> {
  return {
    task_id: taskId,
    rendered_output: renderedOutput,
    rendered_output_bytes: Buffer.byteLength(renderedOutput),
    rendered_output_sha256: runtime.sha256(renderedOutput),
    claims,
    diagnostics,
  };
}

/**
 * Explicit evaluator-only dialect path. It is intentionally not registered by
 * server.ts and performs exactly one lexical/graph search with embeddings
 * disabled before intersecting candidates with the frozen sidecar evidence.
 */
export async function runDialectPatternEvidence(
  input: DialectRecurrenceInput,
  options: DialectRecurrenceOptions = {},
): Promise<Record<string, unknown>> {
  const runtime = await import(DIALECT_CONTRACT_URL) as DialectRuntimeContract;
  const sidecarRuntime = await import(DIALECT_SIDECAR_URL) as DialectSidecarRuntime;
  const limits = runtime.DIALECT_LIMITS;
  let taskId = "invalid-task";
  const diagnostics: string[] = [];
  const diagnostic = (message: unknown): void => {
    if (diagnostics.length < limits.max_diagnostics_per_task) {
      diagnostics.push(dialectDiagnostic(message, limits.max_diagnostic_chars));
    }
  };
  const noClaims = (): Record<string, unknown> => createDialectEvaluationOutput(
    taskId,
    "No recurring dialect shape was established from the validated local evidence.",
    [],
    [...new Set(diagnostics)].sort(),
    runtime,
  );

  let taskText: string;
  let taskFamily: string;
  let sourceScopes: string[];
  let sourceCatalog: DialectSourceCatalogEntry[];
  let serializedSidecar: { records: Array<Record<string, any>>; text: string };
  let data: ContextData;
  try {
    runtime.exactKeys(input, [
      "dialect_sidecar",
      "ingest_manifest",
      "source_catalog",
      "task_binding",
      "task_bytes",
    ].filter((key) => Object.prototype.hasOwnProperty.call(input, key)), "dialect recurrence input");
    runtime.exactKeys(input.task_binding, [
      "base_commit", "family", "source_scope", "task_bytes", "task_id", "task_sha256",
    ], "dialect task binding");
    const binding = input.task_binding;
    runtime.visibleIdentifier(binding.task_id, "task id");
    taskId = binding.task_id;
    if (!/^[a-f0-9]{40,64}$/.test(binding.base_commit)) throw new Error("invalid immutable base commit");
    runtime.hexSha256(binding.task_sha256, "task hash");
    if (!runtime.DIALECT_CAPABILITY_MANIFEST.families.some((entry) => entry.family === binding.family)) {
      throw new Error("unsupported dialect task family");
    }
    if (!Array.isArray(binding.source_scope) || binding.source_scope.length === 0) {
      throw new Error("dialect task source scope is empty");
    }
    const scopes = binding.source_scope.map((scope) => runtime.canonicalRepositoryPath(scope));
    if (
      new Set(scopes).size !== scopes.length ||
      runtime.canonicalJson(scopes) !== runtime.canonicalJson([...scopes].sort())
    ) {
      throw new Error("dialect task source scope is not unique and sorted");
    }
    sourceScopes = [...scopes];
    taskFamily = binding.family;
    const exactTaskBytes = typeof input.task_bytes === "string"
      ? Buffer.from(input.task_bytes, "utf8")
      : Buffer.from(input.task_bytes);
    if (
      exactTaskBytes.length < 1 ||
      exactTaskBytes.length > limits.max_task_bytes ||
      binding.task_bytes !== exactTaskBytes.length ||
      binding.task_sha256 !== runtime.sha256(exactTaskBytes)
    ) {
      throw new Error("dialect task bytes do not match the frozen task binding");
    }
    taskText = new TextDecoder("utf-8", { fatal: true }).decode(exactTaskBytes);

    if (!Array.isArray(input.source_catalog) || input.source_catalog.length === 0 ||
        input.source_catalog.length > limits.max_source_catalog_files) {
      throw new Error("invalid frozen source catalog size");
    }
    sourceCatalog = input.source_catalog.map((source) => ({ ...source }));
    let aggregateBytes = 0;
    let previousPath = "";
    for (const source of sourceCatalog) {
      runtime.exactKeys(source, ["bytes", "line_count", "path", "source_sha256"], "source catalog entry");
      runtime.canonicalRepositoryPath(source.path);
      runtime.hexSha256(source.source_sha256, "catalog source hash");
      if (source.path <= previousPath) throw new Error("source catalog is not unique and sorted");
      previousPath = source.path;
      if (!pathIsScoped(source.path, scopes)) throw new Error("source catalog escaped task scope");
      if (!Number.isSafeInteger(source.bytes) || source.bytes < 0 || source.bytes > limits.max_source_bytes ||
          !Number.isSafeInteger(source.line_count) || source.line_count < 1) {
        throw new Error("source catalog contains invalid bounds");
      }
      aggregateBytes += source.bytes;
      if (!Number.isSafeInteger(aggregateBytes) || aggregateBytes > limits.max_source_catalog_bytes) {
        throw new Error("source catalog exceeds its aggregate byte cap");
      }
    }

    const manifestText = input.ingest_manifest === undefined
      ? readContainedCacheFile(PATHS.ingestManifest, limits.max_canonical_input_bytes)
      : typeof input.ingest_manifest === "string"
        ? input.ingest_manifest
        : runtime.canonicalJson(input.ingest_manifest);
    if (Buffer.byteLength(manifestText, "utf8") > limits.max_canonical_input_bytes) {
      throw new Error("dialect ingest manifest exceeds its canonical byte cap");
    }
    const sidecarText = input.dialect_sidecar === undefined
      ? readContainedCacheFile(PATHS.dialectObservations, limits.max_source_catalog_bytes)
      : input.dialect_sidecar;
    const manifest = JSON.parse(manifestText) as Record<string, unknown>;
    serializedSidecar = sidecarRuntime.parseDialectObservationSidecar(sidecarText);
    const summary = sidecarRuntime.summarizeDialectObservationSidecar(serializedSidecar);
    if (runtime.canonicalJson(manifest[sidecarRuntime.DIALECT_MANIFEST_FIELD]) !== runtime.canonicalJson(summary)) {
      throw new Error("dialect manifest and sidecar hash or diagnostics differ");
    }
    data = options.data ?? await loadContextData();
  } catch (error) {
    void error;
    diagnostic("Dialect recurrence unavailable: validated inputs or contained cache artifacts were unavailable.");
    return noClaims();
  }

  const catalogByPath = new Map(sourceCatalog.map((source) => [source.path, source]));
  const documentsById = new Map(data.documents.map((document) => [document.id, document]));
  const chunksById = new Map(data.chunks.map((chunk) => [chunk.id, chunk]));
  const selectedChunksByPath = new Map<string, Set<string>>();
  const candidateFilter = (entity: SearchEntity): boolean => {
    if (entity.entity_type !== "Chunk" || entity.id.includes(":window:")) return false;
    const chunk = chunksById.get(entity.id);
    const owner = chunk ? documentsById.get(chunk.file_id) : undefined;
    if (!chunk || !owner) return false;
    const repositoryPath = normalizeRepoPath(owner.path);
    const family = runtime.DIALECT_CAPABILITY_MANIFEST.families.find(
      (entry) => entry.family === taskFamily,
    );
    return Boolean(
      family &&
      catalogByPath.has(repositoryPath) &&
      pathIsScoped(repositoryPath, sourceScopes) &&
      runtime.dialectFamilyForMode(sourceMode(repositoryPath))?.family === taskFamily
    );
  };

  let results: SearchResult[] = [];
  try {
    const search = await (options.search ?? runContextSearch)(
      {
        query: taskText,
        top_k: 50,
        include_deprecated: false,
        response_preset: "minimal",
        include_scores: false,
        include_matched_rules: false,
        include_content: false,
      },
      {
        data,
        embedding_index: { model: null, vectors: new Map<string, Float32Array>() },
        query_vector: null,
        candidate_filter: candidateFilter,
      },
    );
    results = Array.isArray(search.results) ? search.results as SearchResult[] : [];
  } catch (error) {
    void error;
    diagnostic("Dialect recurrence search failed without retaining external error details.");
    return noClaims();
  }

  for (const result of results.slice(0, 50)) {
    const chunkId = typeof result.id === "string" ? result.id : "";
    const chunk = chunksById.get(chunkId);
    const owner = chunk ? documentsById.get(chunk.file_id) : undefined;
    if (!chunk || !owner || chunkId.includes(":window:")) continue;
    const repositoryPath = normalizeRepoPath(owner.path);
    if (!candidateFilter({ ...result, id: chunkId, entity_type: "Chunk" } as SearchEntity)) continue;
    const ids = selectedChunksByPath.get(repositoryPath) ?? new Set<string>();
    ids.add(chunkId);
    selectedChunksByPath.set(repositoryPath, ids);
  }
  if (selectedChunksByPath.size === 0) {
    diagnostic("No comparable non-window code chunk matched the frozen family and source scope.");
    return noClaims();
  }

  type GroupEvidence = { owner: string; citation: Record<string, unknown>; location: string };
  const groups = new Map<string, GroupEvidence[]>();
  for (const record of serializedSidecar.records) {
    const repositoryPath = String(record.repository_path ?? "");
    const source = catalogByPath.get(repositoryPath);
    const selectedChunkIds = selectedChunksByPath.get(repositoryPath);
    if (!source || !selectedChunkIds || record.source_sha256 !== source.source_sha256 || record.family !== taskFamily) {
      continue;
    }
    if (record.observation_envelope?.status !== "ok") continue;
    for (const observation of record.observation_envelope.observations as Array<Record<string, any>>) {
      if (observation.end_line > source.line_count) continue;
      const resolvedChunkOwner = typeof observation.containing_chunk_id === "string" &&
        selectedChunkIds.has(observation.containing_chunk_id)
        ? observation.containing_chunk_id
        : null;
      const owner = resolvedChunkOwner ?? repositoryPath;
      const citationPayload = {
        end_line: observation.end_line,
        path: repositoryPath,
        source_sha256: source.source_sha256,
        start_line: observation.start_line,
      };
      const citation = {
        citation_id: `dialect-citation-v1:${runtime.sha256(runtime.canonicalJson(citationPayload))}`,
        ...citationPayload,
      };
      const location = `${repositoryPath}:${observation.start_line}:${observation.end_line}:${source.source_sha256}`;
      const key = runtime.canonicalJson([
        observation.family,
        observation.category,
        observation.normalized_shape,
        observation.language_specific_shape,
      ]);
      const evidence = groups.get(key) ?? [];
      evidence.push({ owner, citation, location });
      groups.set(key, evidence);
    }
  }

  const claims: Array<Record<string, unknown>> = [];
  let oneOffGroups = 0;
  for (const [key, rawEvidence] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const uniqueByOwnerAndLocation = new Map<string, GroupEvidence>();
    for (const evidence of rawEvidence) {
      uniqueByOwnerAndLocation.set(`${evidence.owner}\u0000${evidence.location}`, evidence);
    }
    if (uniqueByOwnerAndLocation.size !== rawEvidence.length) {
      diagnostic("A recurring dialect shape contained duplicate owner/span evidence and was omitted.");
      continue;
    }
    const evidence = [...uniqueByOwnerAndLocation.values()].sort((left, right) =>
      left.owner.localeCompare(right.owner) || left.location.localeCompare(right.location));
    const owners = new Set(evidence.map((entry) => entry.owner));
    const locations = new Set(evidence.map((entry) => entry.location));
    if (owners.size < 2 || locations.size < 2) {
      oneOffGroups += 1;
      continue;
    }
    const firstByOwner = new Map<string, GroupEvidence>();
    for (const entry of evidence) if (!firstByOwner.has(entry.owner)) firstByOwner.set(entry.owner, entry);
    if (firstByOwner.size > limits.max_citations_per_claim) {
      diagnostic("A recurring dialect shape exceeded the frozen citation cap and was omitted.");
      continue;
    }
    const citations = [...firstByOwner.values()]
      .map((entry) => entry.citation)
      .sort((left, right) => String(left.citation_id).localeCompare(String(right.citation_id)));
    if (citations.length < 2) continue;
    const [, category] = JSON.parse(key) as [string, string, string, string | null];
    const statement = `A ${category} shape (${runtime.sha256(key)}) was observed recurring in comparable local ${taskFamily} implementations.`;
    if ([...statement].length > limits.max_shape_chars) {
      diagnostic("A recurring dialect shape exceeded the rendered statement cap and was omitted.");
      continue;
    }
    const claimPayload = { citations, statement };
    claims.push({
      claim_id: `dialect-claim-v1:${runtime.sha256(runtime.canonicalJson(claimPayload))}`,
      ...claimPayload,
    });
  }
  claims.sort((left, right) => String(left.claim_id).localeCompare(String(right.claim_id)));
  if (oneOffGroups > 0) diagnostic(`${oneOffGroups} dialect shape group(s) lacked two distinct comparable owners and spans.`);
  if (claims.length === 0) {
    diagnostic("No recurring dialect shape met the two-owner and two-span evidence threshold.");
    return noClaims();
  }
  if (claims.length > limits.max_claims_per_task) {
    diagnostic("Recurring dialect claims exceeded the frozen task cap.");
    return noClaims();
  }
  const renderedOutput = claims.map((claim) => String(claim.statement)).join("\n");
  if (Buffer.byteLength(renderedOutput) > limits.max_rendered_output_bytes) {
    diagnostic("Recurring dialect claims exceeded the frozen rendered-output byte cap.");
    return noClaims();
  }
  return createDialectEvaluationOutput(
    taskId,
    renderedOutput,
    claims,
    [...new Set(diagnostics)].sort().slice(0, limits.max_diagnostics_per_task),
    runtime,
  );
}
