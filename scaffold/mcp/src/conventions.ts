import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { loadContextData } from "./graph.js";
import { CACHE_DIR, REPO_ROOT } from "./paths.js";
import type {
  AdrRecord,
  ChunkRecord,
  ContextData,
  ConventionsParams,
  DocumentRecord,
  RelationRecord,
  RuleRecord,
  ToolPayload,
} from "./types.js";

export const CONVENTION_SCHEMA_VERSION = 1;
export const CONVENTION_GENERATOR_VERSION = "repo-conventions-v1";
export const CONVENTION_LIMITS = Object.freeze({
  max_profile_bytes: 2_000_000,
  max_profile_count: 256,
  max_aggregate_profile_bytes: 8_000_000,
  max_manifest_bytes: 1_000_000,
  max_repository_control_bytes: 1_000_000,
  max_response_bytes: 4_000_000,
  max_reusable_symbols: 100,
  max_reusable_relations: 20,
  max_evidence_per_fact: 10,
  max_representative_callers: 5,
  max_related_subsystems: 20,
  max_conflicts: 50,
  max_identifier_chars: 1000,
  max_path_chars: 1024,
  max_name_chars: 256,
  max_signature_chars: 2000,
});

type ConventionSubsystem = {
  id: string;
  type: "module" | "project" | "path";
  path: string;
  evidence: Array<{
    entity_id: string;
    relation: "CONTAINS" | "INCLUDES_FILE" | "PATH_SCOPE";
  }>;
};

type ConventionEvidence = {
  entity_id: string;
  path?: string;
  start_line?: number;
  end_line?: number;
  relation?: {
    from: string;
    to: string;
    type: string;
  };
};

type AuthoritativeEvidence = {
  entity_id: string;
  entity_type: "Rule" | "ADR";
  title: string;
  status: string;
  priority: number;
  scope: "repository" | "subsystem";
  observed_count: number;
  evidence: ConventionEvidence[];
};

type ConventionClaim = {
  key: string;
  value: string;
  source_id: string;
  source_type: "Rule" | "ADR";
  priority: number;
  evidence: ConventionEvidence;
};

export type ConventionConflict = {
  key: string;
  enforcement: "deterministic";
  governing_priority: number;
  message: string;
  claims: ConventionClaim[];
};

type StructuralFact = {
  id: string;
  category: "exported_symbol_kind" | "test_layout" | "graph_connection";
  statement: string;
  value: string;
  observed_count: number;
  confidence: "structural" | "heuristic";
  normative: false;
  enforcement: "informational";
  evidence: ConventionEvidence[];
};

type ReusableRole =
  | "shared_library"
  | "base_class"
  | "interface"
  | "factory"
  | "adapter"
  | "error_type"
  | "logging"
  | "configuration"
  | "test_helper"
  | "reusable_export";

type ReusableSymbol = {
  entity_id: string;
  path: string;
  name: string;
  kind: string;
  signature: string;
  language: string;
  role: ReusableRole;
  confidence: "structural" | "heuristic";
  subsystem_id: string;
  relations: Array<{
    direction: "incoming" | "outgoing";
    relation: string;
    entity_id: string;
  }>;
  representative_callers_observed_count: number;
  representative_callers: ConventionEvidence[];
  representative_tests_observed_count: number;
  representative_tests: ConventionEvidence[];
  evidence: ConventionEvidence[];
};

export type ConventionProfile = {
  schema_version: 1;
  generator_version: string;
  profile_id: string;
  repository_id: string;
  language: string;
  subsystem: ConventionSubsystem;
  file_ids: string[];
  source_hash: string;
  profile_hash: string;
  limits: typeof CONVENTION_LIMITS;
  authoritative_evidence: AuthoritativeEvidence[];
  structural_facts: StructuralFact[];
  reusable_symbols: ReusableSymbol[];
  related_subsystems: Array<{
    subsystem_id: string;
    relation_types: string[];
    observed_count: number;
    evidence: ConventionEvidence[];
  }>;
  conflicts: ConventionConflict[];
  diagnostics: {
    authoritative_evidence_omitted: number;
    oversized_records_dropped: number;
    subsystem_evidence_omitted: number;
    reusable_symbols_omitted: number;
    reusable_relations_omitted: number;
    representative_callers_omitted: number;
    representative_tests_omitted: number;
    related_subsystem_evidence_omitted: number;
    related_subsystems_omitted: number;
    conflicts_omitted: number;
    unsupported_claims_emitted: 0;
  };
};

type ConventionManifestEntry = {
  profile_id: string;
  relative_path: string;
  repository_id: string;
  language: string;
  subsystem_id: string;
  source_hash: string;
  profile_hash: string;
};

type ConventionManifest = {
  schema_version: 1;
  generator_version: string;
  repository_id: string;
  index_hash: string;
  limits: typeof CONVENTION_LIMITS;
  profiles: ConventionManifestEntry[];
};

type FileScope = {
  file: DocumentRecord;
  subsystem: ConventionSubsystem;
  languages: string[];
};

const PROFILE_ROOT_KEYS = [
  "authoritative_evidence",
  "conflicts",
  "diagnostics",
  "file_ids",
  "generator_version",
  "language",
  "limits",
  "profile_hash",
  "profile_id",
  "related_subsystems",
  "repository_id",
  "reusable_symbols",
  "schema_version",
  "source_hash",
  "structural_facts",
  "subsystem",
] as const;
const MANIFEST_ROOT_KEYS = [
  "generator_version",
  "index_hash",
  "limits",
  "profiles",
  "repository_id",
  "schema_version",
] as const;
const MANIFEST_ENTRY_KEYS = [
  "language",
  "profile_hash",
  "profile_id",
  "relative_path",
  "repository_id",
  "source_hash",
  "subsystem_id",
] as const;
const LIMIT_KEYS = Object.keys(CONVENTION_LIMITS).sort(compareText);
const SUBSYSTEM_KEYS = ["evidence", "id", "path", "type"] as const;
const SUBSYSTEM_EVIDENCE_KEYS = ["entity_id", "relation"] as const;
const EVIDENCE_KEYS = ["end_line", "entity_id", "path", "relation", "start_line"] as const;
const EVIDENCE_RELATION_KEYS = ["from", "to", "type"] as const;
const AUTHORITATIVE_KEYS = ["entity_id", "entity_type", "evidence", "observed_count", "priority", "scope", "status", "title"] as const;
const FACT_KEYS = ["category", "confidence", "enforcement", "evidence", "id", "normative", "observed_count", "statement", "value"] as const;
const REUSABLE_KEYS = ["confidence", "entity_id", "evidence", "kind", "language", "name", "path", "relations", "representative_callers", "representative_callers_observed_count", "representative_tests", "representative_tests_observed_count", "role", "signature", "subsystem_id"] as const;
const REUSABLE_RELATION_KEYS = ["direction", "entity_id", "relation"] as const;
const RELATED_SUBSYSTEM_KEYS = ["evidence", "observed_count", "relation_types", "subsystem_id"] as const;
const CONFLICT_KEYS = ["claims", "enforcement", "governing_priority", "key", "message"] as const;
const CLAIM_KEYS = ["evidence", "key", "priority", "source_id", "source_type", "value"] as const;
const DIAGNOSTIC_KEYS = ["authoritative_evidence_omitted", "conflicts_omitted", "oversized_records_dropped", "related_subsystem_evidence_omitted", "related_subsystems_omitted", "representative_callers_omitted", "representative_tests_omitted", "reusable_relations_omitted", "reusable_symbols_omitted", "subsystem_evidence_omitted", "unsupported_claims_emitted"] as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const PROFILE_ID_PATTERN = /^convention:[a-f0-9]{32}$/u;
const REPOSITORY_ID_PATTERN = /^[A-Za-z0-9._-]{1,100}$/u;
const UNSAFE_VISIBLE_TEXT_PATTERN = /[\p{Cc}\p{Zl}\p{Zp}\p{Bidi_Control}]/u;

function isSafeVisibleText(value: string): boolean {
  return !UNSAFE_VISIBLE_TEXT_PATTERN.test(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCanonical(left: unknown, right: unknown): number {
  return compareText(canonicalKey(left), canonicalKey(right));
}

function compareEvidence(left: ConventionEvidence, right: ConventionEvidence): number {
  return compareText(left.entity_id, right.entity_id) ||
    compareText(left.path ?? "", right.path ?? "") ||
    (left.start_line ?? 0) - (right.start_line ?? 0) ||
    (left.end_line ?? 0) - (right.end_line ?? 0) ||
    compareCanonical(left.relation, right.relation);
}

function compareSubsystemEvidence(
  left: ConventionSubsystem["evidence"][number],
  right: ConventionSubsystem["evidence"][number],
): number {
  return compareText(left.relation, right.relation) || compareText(left.entity_id, right.entity_id);
}

function compareAuthoritativeEvidence(left: AuthoritativeEvidence, right: AuthoritativeEvidence): number {
  return right.priority - left.priority || compareText(left.entity_type, right.entity_type) || compareText(left.entity_id, right.entity_id);
}

function compareStructuralFact(left: StructuralFact, right: StructuralFact): number {
  return compareText(left.category, right.category) || compareText(left.value, right.value) || compareText(left.id, right.id);
}

function compareReusableSymbol(left: ReusableSymbol, right: ReusableSymbol): number {
  return compareText(left.role, right.role) || compareText(left.entity_id, right.entity_id);
}

function compareRelatedSubsystem(
  left: ConventionProfile["related_subsystems"][number],
  right: ConventionProfile["related_subsystems"][number],
): number {
  return compareText(left.subsystem_id, right.subsystem_id);
}

function compareClaim(left: ConventionClaim, right: ConventionClaim): number {
  return right.priority - left.priority || compareText(left.value, right.value) || compareText(left.source_type, right.source_type) || compareText(left.source_id, right.source_id);
}

function compareConflict(left: ConventionConflict, right: ConventionConflict): number {
  return compareText(left.key, right.key);
}

function sortUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareText);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort(compareText)) {
      const item = source[key];
      if (item !== undefined) output[key] = canonicalize(item);
    }
    return output;
  }
  return value;
}

export function canonicalConventionJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function hashValue(value: unknown): string {
  return crypto.createHash("sha256").update(canonicalConventionJson(value)).digest("hex");
}

function canonicalKey(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sortAndDeduplicate<T>(values: Iterable<T>, key: (value: T) => string = canonicalKey): T[] {
  const byKey = new Map<string, T>();
  for (const value of values) byKey.set(key(value), value);
  return [...byKey.entries()].sort(([left], [right]) => compareText(left, right)).map(([, value]) => value);
}

function sortAndDeduplicateWith<T>(
  values: Iterable<T>,
  compare: (left: T, right: T) => number,
  key: (value: T) => string = canonicalKey,
): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const value of [...values].sort(compare)) {
    const identity = key(value);
    if (seen.has(identity)) continue;
    seen.add(identity);
    output.push(value);
  }
  return output;
}

function stableUniqueEntitiesById<T extends { id: string }>(values: Iterable<T>): T[] {
  const byId = new Map<string, T>();
  for (const value of sortAndDeduplicate(values)) if (!byId.has(value.id)) byId.set(value.id, value);
  return [...byId.values()].sort((left, right) => compareText(left.id, right.id));
}

function canonicalProfileRelativePath(profileId: string): string {
  if (!PROFILE_ID_PATTERN.test(profileId)) throw new Error(`Invalid convention profile ID: ${profileId}`);
  return `profiles/${profileId.slice("convention:".length)}.json`;
}

function deriveProfileId(repositoryId: string, language: string, subsystemId: string): string {
  return `convention:${hashValue([repositoryId, language, subsystemId]).slice(0, 32)}`;
}

function normalizeRepoPath(value: string, allowRoot = false): string {
  if (
    typeof value !== "string" || value.length === 0 || value !== value.trim() ||
    value.length > CONVENTION_LIMITS.max_path_chars || !isSafeVisibleText(value) || value.includes("\\") ||
    value.startsWith("/") || /^[A-Za-z]:\//u.test(value) || value.endsWith("/") ||
    value.includes("//") || value.split("/").some((segment) => segment === "" || segment === ".." || segment === ".")
  ) {
    if (allowRoot && value === ".") return value;
    throw new Error("Invalid repository-relative convention target");
  }
  return value;
}

function normalizeRepoPathAlias(value: string, allowRoot = false): string {
  if (
    typeof value !== "string" || value.length === 0 || value !== value.trim() ||
    value.length > CONVENTION_LIMITS.max_path_chars || !isSafeVisibleText(value) ||
    value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value)
  ) throw new Error("Invalid repository-relative convention target");
  const portable = value.replace(/\\/g, "/");
  const segments = portable.split("/");
  const canonical: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") throw new Error("Invalid repository-relative convention target");
    canonical.push(segment);
  }
  const normalized = canonical.join("/") || ".";
  if (normalized === "." && !allowRoot) throw new Error("Invalid repository-relative convention target");
  return normalizeRepoPath(normalized, allowRoot);
}

function dirnameRepoPath(value: string): string {
  const separator = value.lastIndexOf("/");
  return separator === -1 ? "." : value.slice(0, separator) || ".";
}

function pathDepth(value: string): number {
  return value === "." ? 0 : value.split("/").filter(Boolean).length;
}

function boundedIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= CONVENTION_LIMITS.max_identifier_chars && isSafeVisibleText(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function assertString(value: unknown, label: string, max: number, pattern?: RegExp): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || !isSafeVisibleText(value) || (pattern && !pattern.test(value))) {
    throw new Error(`${label} must be a valid bounded string`);
  }
}

function assertSortedUniqueStrings(value: unknown, label: string, maxLength = CONVENTION_LIMITS.max_identifier_chars): asserts value is string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  for (const [index, item] of value.entries()) assertString(item, `${label}[${index}]`, maxLength);
  const sorted = sortUnique(value);
  if (sorted.length !== value.length || sorted.some((item, index) => item !== value[index])) {
    throw new Error(`${label} must be sorted and unique`);
  }
}

function isWindowChunk(chunk: ChunkRecord): boolean {
  return chunk.id.includes(":window:");
}

function safeChunk(chunk: ChunkRecord): boolean {
  const language = typeof chunk.language === "string" ? chunk.language.trim().toLowerCase() : "";
  let canonicalFilePath = "";
  try {
    if (!chunk.file_id.startsWith("file:")) return false;
    canonicalFilePath = normalizeRepoPath(chunk.file_id.slice("file:".length));
  } catch {
    return false;
  }
  return (
    chunk.status === "active" &&
    boundedIdentifier(chunk.id) &&
    boundedIdentifier(chunk.file_id) &&
    chunk.id.startsWith(`chunk:${canonicalFilePath}:`) &&
    chunk.name.length > 0 &&
    chunk.name.length <= CONVENTION_LIMITS.max_name_chars &&
    chunk.signature.length <= CONVENTION_LIMITS.max_signature_chars &&
    boundedIdentifier(language) &&
    chunk.start_line > 0 &&
    chunk.end_line >= chunk.start_line &&
    !isWindowChunk(chunk)
  );
}

function isActiveRecord(value: { status: string }): boolean {
  return value.status === "active";
}

function isAuthoritativePolicy(value: RuleRecord | AdrRecord): boolean {
  return isActiveRecord(value) && value.source_of_truth === true;
}

function eligibleConventionData(data: ContextData): ContextData {
  const documents = data.documents.filter(isActiveRecord);
  const chunks = data.chunks.filter(isActiveRecord);
  const modules = data.modules.filter(isActiveRecord);
  const projects = data.projects.filter(isActiveRecord);
  const rules = data.rules.filter(isAuthoritativePolicy);
  const adrs = data.adrs.filter(isAuthoritativePolicy);
  const eligibleIds = new Set([
    ...documents, ...chunks, ...modules, ...projects, ...rules, ...adrs,
  ].map((item) => item.id));
  const ineligibleIds = new Set([
    ...data.documents, ...data.chunks, ...data.modules, ...data.projects, ...data.rules, ...data.adrs,
  ].filter((item) => !eligibleIds.has(item.id)).map((item) => item.id));
  return {
    ...data,
    documents,
    chunks,
    modules,
    projects,
    rules,
    adrs,
    // Relation records have no eligibility field and never create authority
    // by themselves. They remain usable only when neither endpoint is a known
    // ineligible indexed entity; each consumer still validates exact endpoints.
    relations: data.relations.filter((relation) => !ineligibleIds.has(relation.from) && !ineligibleIds.has(relation.to)),
  };
}

function capEvidenceByRelationType(values: Iterable<ConventionEvidence>): ConventionEvidence[] {
  const canonical = sortAndDeduplicateWith(values, compareEvidence);
  if (canonical.length <= CONVENTION_LIMITS.max_evidence_per_fact) return canonical;
  const firstByType = new Map<string, ConventionEvidence>();
  for (const evidence of canonical) {
    const type = evidence.relation?.type ?? "";
    if (!firstByType.has(type)) firstByType.set(type, evidence);
  }
  const selected = [...firstByType.values()].sort(compareEvidence)
    .slice(0, CONVENTION_LIMITS.max_evidence_per_fact);
  const selectedKeys = new Set(selected.map(canonicalKey));
  for (const evidence of canonical) {
    if (selected.length >= CONVENTION_LIMITS.max_evidence_per_fact) break;
    if (selectedKeys.has(canonicalKey(evidence))) continue;
    selected.push(evidence);
  }
  return selected.sort(compareEvidence);
}

function readRepositoryId(repoRoot: string = REPO_ROOT): string {
  const root = assertSafeAbsoluteDirectory(repoRoot, false);
  const contextDir = path.join(root, ".context");
  const contextStats = lstatIfPresent(contextDir);
  if (contextStats === null) return "repository";
  if (contextStats.isSymbolicLink() || !contextStats.isDirectory()) {
    throw new Error("Convention repository control directory is unsafe");
  }
  const configPath = path.join(contextDir, "config.yaml");
  const before = lstatIfPresent(configPath);
  if (before === null) return "repository";
  try {
    assertSingleLinkRegularStats(before, "Convention repository control file");
  } catch {
    throw new Error("Convention repository control file is unsafe");
  }
  if (before.size > CONVENTION_LIMITS.max_repository_control_bytes) {
    throw new Error("Convention repository control file exceeds the version-1 byte limit");
  }
  let contents: string;
  try {
    contents = fs.readFileSync(configPath, "utf8");
  } catch {
    throw new Error("Convention repository control file could not be read safely");
  }
  const after = lstatIfPresent(configPath);
  if (after === null || !sameIdentity(before, after)) {
    throw new Error("Convention repository control file changed during read");
  }
  try {
    assertSingleLinkRegularStats(after, "Convention repository control file");
  } catch {
    throw new Error("Convention repository control file is unsafe");
  }
  if (
    after.size !== before.size || after.size > CONVENTION_LIMITS.max_repository_control_bytes ||
    Buffer.byteLength(contents) > CONVENTION_LIMITS.max_repository_control_bytes
  ) throw new Error("Convention repository control file exceeds the version-1 byte limit");
  try {
    const parsed = yaml.load(contents);
    if (parsed && typeof parsed === "object") {
      const value = (parsed as Record<string, unknown>).repo_id;
      if (typeof value === "string" && REPOSITORY_ID_PATTERN.test(value)) return value;
    }
  } catch {
    // Older or malformed controls retain the historical fallback identity.
  }
  return "repository";
}

function relationEvidence(relation: RelationRecord): ConventionEvidence {
  return {
    entity_id: relation.from,
    relation: {
      from: relation.from,
      to: relation.to,
      type: relation.relation,
    },
  };
}

function chunkEvidence(chunk: ChunkRecord, filePathById: Map<string, string>): ConventionEvidence {
  return {
    entity_id: chunk.id,
    path: filePathById.get(chunk.file_id),
    start_line: chunk.start_line,
    end_line: chunk.end_line,
  };
}

function deriveScopes(data: ContextData): FileScope[] {
  const moduleById = new Map<string, ContextData["modules"][number]>();
  const projectById = new Map<string, ContextData["projects"][number]>();
  for (const item of stableUniqueEntitiesById(data.modules)) moduleById.set(item.id, item);
  for (const item of stableUniqueEntitiesById(data.projects)) projectById.set(item.id, item);
  const modulesByFile = new Map<string, Array<{ id: string; path: string }>>();
  const projectsByFile = new Map<string, Array<{ id: string; path: string }>>();

  for (const relation of sortAndDeduplicate(data.relations)) {
    if (relation.relation === "CONTAINS" && moduleById.has(relation.from)) {
      const module = moduleById.get(relation.from)!;
      const list = modulesByFile.get(relation.to) ?? [];
      list.push({ id: module.id, path: normalizeRepoPath(module.path, true) });
      modulesByFile.set(relation.to, list);
    } else if (relation.relation === "INCLUDES_FILE" && projectById.has(relation.from)) {
      const project = projectById.get(relation.from)!;
      const list = projectsByFile.get(relation.to) ?? [];
      list.push({ id: project.id, path: normalizeRepoPath(project.path, true) });
      projectsByFile.set(relation.to, list);
    }
  }

  const languagesByFile = new Map<string, Set<string>>();
  for (const chunk of stableUniqueEntitiesById(data.chunks)) {
    if (!safeChunk(chunk)) continue;
    const languages = languagesByFile.get(chunk.file_id) ?? new Set<string>();
    languages.add(chunk.language.trim().toLowerCase() || "unknown");
    languagesByFile.set(chunk.file_id, languages);
  }

  return stableUniqueEntitiesById(data.documents)
    .filter((document) => document.kind === "CODE")
    .map((file) => {
      const filePath = normalizeRepoPath(file.path);
      const module = (modulesByFile.get(file.id) ?? [])
        .sort((left, right) => pathDepth(right.path) - pathDepth(left.path) || compareText(left.id, right.id))[0];
      const project = (projectsByFile.get(file.id) ?? [])
        .sort((left, right) => pathDepth(right.path) - pathDepth(left.path) || compareText(left.id, right.id))[0];
      const subsystem: ConventionSubsystem = module
        ? {
            id: module.id,
            type: "module",
            path: module.path,
            evidence: [{ entity_id: file.id, relation: "CONTAINS" }],
          }
        : project
          ? {
              id: project.id,
              type: "project",
              path: project.path,
              evidence: [{ entity_id: file.id, relation: "INCLUDES_FILE" }],
            }
          : {
              id: `path:${dirnameRepoPath(filePath)}`,
              type: "path",
              path: dirnameRepoPath(filePath),
              evidence: [{ entity_id: file.id, relation: "PATH_SCOPE" }],
            };
      return {
        file,
        subsystem,
        languages: sortUnique(languagesByFile.get(file.id) ?? ["unknown"]),
      };
    })
    .sort((left, right) => compareText(canonicalKey(left.file), canonicalKey(right.file)));
}

function reusableRole(chunk: ChunkRecord, filePath: string): { role: ReusableRole; confidence: "structural" | "heuristic" } {
  const signal = `${chunk.name} ${chunk.kind} ${chunk.signature} ${filePath}`.toLowerCase();
  const kind = chunk.kind.toLowerCase();
  if (/\b(interface|protocol|trait)\b/u.test(kind)) return { role: "interface", confidence: "structural" };
  if (/\b(abstract|base)\b/u.test(signal) && /\b(class|type)\b/u.test(kind)) return { role: "base_class", confidence: "structural" };
  if (/factory/u.test(signal)) return { role: "factory", confidence: "heuristic" };
  if (/adapter/u.test(signal)) return { role: "adapter", confidence: "heuristic" };
  if (/(?:error|exception)/u.test(signal)) return { role: "error_type", confidence: "heuristic" };
  if (/(?:logger|logging|log[-_ ]?sink)/u.test(signal)) return { role: "logging", confidence: "heuristic" };
  if (/(?:config|configuration|settings|options|environment)/u.test(signal)) return { role: "configuration", confidence: "heuristic" };
  if (/(?:^|\/)(?:test|tests|__tests__|spec)(?:\/|$)|(?:fixture|mock|testhelper|test_helper)/u.test(signal)) {
    return { role: "test_helper", confidence: "heuristic" };
  }
  if (/(?:library|client|service|repository|provider|manager)/u.test(signal)) {
    return { role: "shared_library", confidence: "heuristic" };
  }
  return { role: "reusable_export", confidence: "structural" };
}

function isTestPath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return /(?:^|\/)(?:test|tests|__tests__|spec)(?:\/|$)|(?:\.test|\.spec)\.[^/]+$/u.test(lower);
}

function explicitClaims(rules: RuleRecord[], adrs: AdrRecord[], authoritative: AuthoritativeEvidence[]): ConventionClaim[] {
  const claims: ConventionClaim[] = [];
  const authorityById = new Map(authoritative.map((item) => [item.entity_id, item]));
  const add = (
    entity: RuleRecord | AdrRecord,
    sourceType: "Rule" | "ADR",
    body: string,
    priority: number,
    evidence: ConventionEvidence,
  ): void => {
    const pattern = /^\s*convention:([a-z][a-z0-9_.-]{0,99})\s*=\s*([^\r\n]{1,200})\s*$/gimu;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
      claims.push({
        key: match[1].toLowerCase(),
        value: match[2].trim(),
        source_id: entity.id,
        source_type: sourceType,
        priority,
        evidence,
      });
    }
  };
  for (const rule of stableUniqueEntitiesById(rules)) {
    const authority = authorityById.get(rule.id);
    if (isAuthoritativePolicy(rule) && authority?.entity_type === "Rule" && authority.evidence[0]) {
      add(rule, "Rule", rule.body, rule.priority, authority.evidence[0]);
    }
  }
  for (const adr of stableUniqueEntitiesById(adrs)) {
    const authority = authorityById.get(adr.id);
    if (isAuthoritativePolicy(adr) && authority?.entity_type === "ADR" && authority.evidence[0]) {
      add(adr, "ADR", adr.body, 100, authority.evidence[0]);
    }
  }
  return claims.sort((left, right) =>
    compareText(left.key, right.key) ||
    right.priority - left.priority ||
    compareText(left.value, right.value) ||
    compareText(left.source_id, right.source_id)
  );
}

export function detectConventionConflicts(claims: ConventionClaim[]): ConventionConflict[] {
  const byKey = new Map<string, ConventionClaim[]>();
  for (const claim of claims) {
    const list = byKey.get(claim.key) ?? [];
    list.push(claim);
    byKey.set(claim.key, list);
  }
  const conflicts: ConventionConflict[] = [];
  for (const [key, values] of [...byKey.entries()].sort(([left], [right]) => compareText(left, right))) {
    const canonicalClaims = sortAndDeduplicateWith(values, compareClaim);
    if (new Set(canonicalClaims.map((claim) => claim.value)).size < 2) continue;
    const highestPriority = Math.max(...canonicalClaims.map((claim) => claim.priority));
    conflicts.push({
      key,
      enforcement: "deterministic",
      governing_priority: highestPriority,
      message: `Contradictory active convention evidence exists for ${key}; priority ${highestPriority} establishes precedence without hiding lower-priority claims.`,
      claims: canonicalClaims,
    });
  }
  return conflicts.sort(compareConflict);
}

function buildAuthoritativeEvidence(input: {
  data: ContextData;
  fileIds: Set<string>;
  subsystem: ConventionSubsystem;
}): { evidence: AuthoritativeEvidence[]; applicableIds: Set<string>; evidenceOmitted: number } {
  const scopeEntityIds = new Set([...input.fileIds, input.subsystem.id]);
  const canonicalApplicabilityRelations = (entityId: string): RelationRecord[] => sortAndDeduplicate(
    input.data.relations.filter((relation) =>
      (relation.relation === "CONSTRAINS" && relation.from === entityId) ||
      (relation.relation === "IMPLEMENTS" && relation.to === entityId)
    ),
  );
  const applicabilityRelations = (entityId: string): RelationRecord[] => canonicalApplicabilityRelations(entityId)
    .filter((relation) => scopeEntityIds.has(relation.relation === "CONSTRAINS" ? relation.to : relation.from));
  const applicabilitySet = (entityId: string): string[] => sortUnique(
    canonicalApplicabilityRelations(entityId).map((relation) => relation.relation === "CONSTRAINS" ? relation.to : relation.from),
  );
  const ruleIds = new Set<string>();
  for (const rule of stableUniqueEntitiesById(input.data.rules)) {
    if (isAuthoritativePolicy(rule) && rule.scope === "global") ruleIds.add(rule.id);
  }
  for (const rule of stableUniqueEntitiesById(input.data.rules)) if (isAuthoritativePolicy(rule) && applicabilityRelations(rule.id).length > 0) ruleIds.add(rule.id);

  const applicableActiveAdrIds = new Set<string>();
  for (const adr of stableUniqueEntitiesById(input.data.adrs)) {
    if (isAuthoritativePolicy(adr) && applicabilityRelations(adr.id).length > 0) applicableActiveAdrIds.add(adr.id);
  }
  const supersededAdrs = new Set<string>();
  const supersessionEdges = new Map<string, string[]>();
  for (const relation of sortAndDeduplicate(input.data.relations)) {
    if (relation.relation !== "SUPERSEDES") continue;
    const supersederApplicability = applicabilitySet(relation.from);
    const supersededApplicability = applicabilitySet(relation.to);
    if (
      applicableActiveAdrIds.has(relation.from) &&
      applicableActiveAdrIds.has(relation.to) &&
      supersederApplicability.length === supersededApplicability.length &&
      supersederApplicability.every((entityId, index) => entityId === supersededApplicability[index])
    ) {
      const targets = supersessionEdges.get(relation.from) ?? [];
      targets.push(relation.to);
      supersessionEdges.set(relation.from, sortUnique(targets));
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (adrId: string): void => {
    if (visiting.has(adrId)) throw new Error("Active ADR supersession cycle detected for an exact applicability set");
    if (visited.has(adrId)) return;
    visiting.add(adrId);
    for (const target of supersessionEdges.get(adrId) ?? []) visit(target);
    visiting.delete(adrId);
    visited.add(adrId);
  };
  for (const adrId of [...supersessionEdges.keys()].sort(compareText)) visit(adrId);
  for (const targets of supersessionEdges.values()) {
    for (const target of targets) supersededAdrs.add(target);
  }
  const adrIds = new Set([...applicableActiveAdrIds].filter((id) => !supersededAdrs.has(id)));

  const evidence: AuthoritativeEvidence[] = [];
  let evidenceOmitted = 0;
  for (const rule of stableUniqueEntitiesById(input.data.rules)) {
    if (!ruleIds.has(rule.id) || !isAuthoritativePolicy(rule)) continue;
    const candidates = rule.scope === "global"
      ? [{ entity_id: rule.id }]
      : sortAndDeduplicateWith(applicabilityRelations(rule.id).map((relation) => ({
          entity_id: rule.id,
          relation: { from: relation.from, to: relation.to, type: relation.relation },
        })), compareEvidence);
    const retained = capEvidenceByRelationType(candidates);
    evidenceOmitted += candidates.length - retained.length;
    evidence.push({
      entity_id: rule.id,
      entity_type: "Rule",
      title: rule.title || rule.id,
      status: rule.status,
      priority: rule.priority,
      scope: rule.scope === "global" ? "repository" : "subsystem",
      observed_count: candidates.length,
      evidence: retained,
    });
  }
  for (const adr of stableUniqueEntitiesById(input.data.adrs)) {
    if (!adrIds.has(adr.id) || !isAuthoritativePolicy(adr)) continue;
    const candidates = sortAndDeduplicateWith(applicabilityRelations(adr.id).map((relation) => ({
      entity_id: adr.id,
      path: normalizeRepoPath(adr.path),
      relation: { from: relation.from, to: relation.to, type: relation.relation },
    })), compareEvidence);
    const retained = capEvidenceByRelationType(candidates);
    evidenceOmitted += candidates.length - retained.length;
    evidence.push({
      entity_id: adr.id,
      entity_type: "ADR",
      title: adr.title || adr.id,
      status: adr.status,
      priority: 100,
      scope: "subsystem",
      observed_count: candidates.length,
      evidence: retained,
    });
  }
  evidence.sort(compareAuthoritativeEvidence);
  return { evidence, applicableIds: new Set([...ruleIds, ...adrIds]), evidenceOmitted };
}

function buildProfile(input: {
  data: ContextData;
  repositoryId: string;
  language: string;
  subsystem: ConventionSubsystem;
  subsystemEvidenceOmitted: number;
  files: DocumentRecord[];
  subsystemByFileId: Map<string, ConventionSubsystem>;
}): ConventionProfile {
  const fileIds = new Set(input.files.map((file) => file.id));
  const filePathById = new Map<string, string>();
  const chunkById = new Map<string, ChunkRecord>();
  for (const file of stableUniqueEntitiesById(input.data.documents)) filePathById.set(file.id, normalizeRepoPath(file.path));
  for (const chunk of stableUniqueEntitiesById(input.data.chunks)) chunkById.set(chunk.id, chunk);
  const relevantChunks = stableUniqueEntitiesById(input.data.chunks)
    .filter((chunk) => fileIds.has(chunk.file_id) && chunk.language.trim().toLowerCase() === input.language && !isWindowChunk(chunk))
    .sort((left, right) => compareText(canonicalKey(left), canonicalKey(right)));
  let oversizedRecordsDropped = relevantChunks.filter((chunk) => !safeChunk(chunk)).length;
  const safeChunks = relevantChunks.filter(safeChunk);
  const exportedChunkIds = new Set(
    sortAndDeduplicate(input.data.relations)
      .filter((relation) => relation.relation === "EXPORTS" && relation.from === input.subsystem.id)
      .map((relation) => relation.to),
  );
  const exports = safeChunks.filter((chunk) => chunk.exported || exportedChunkIds.has(chunk.id));

  const authoritative = buildAuthoritativeEvidence({ data: input.data, fileIds, subsystem: input.subsystem });
  const detectedConflicts = detectConventionConflicts(
    explicitClaims(input.data.rules, input.data.adrs, authoritative.evidence),
  );
  const conflicts = detectedConflicts.slice(0, CONVENTION_LIMITS.max_conflicts);
  const conflictsOmitted = Math.max(0, detectedConflicts.length - conflicts.length);

  const facts: StructuralFact[] = [];
  const exportsByKind = new Map<string, ChunkRecord[]>();
  for (const chunk of exports) {
    const kind = chunk.kind.trim().toLowerCase() || "symbol";
    const list = exportsByKind.get(kind) ?? [];
    list.push(chunk);
    exportsByKind.set(kind, list);
  }
  for (const [kind, chunks] of [...exportsByKind.entries()].sort(([left], [right]) => compareText(left, right))) {
    facts.push({
      id: `fact:${hashValue([input.subsystem.id, input.language, "exported_symbol_kind", kind]).slice(0, 20)}`,
      category: "exported_symbol_kind",
      statement: `The indexed ${input.subsystem.id} subsystem exposes ${chunks.length} ${input.language} ${kind} export${chunks.length === 1 ? "" : "s"}.`,
      value: kind,
      observed_count: chunks.length,
      confidence: "structural",
      normative: false,
      enforcement: "informational",
      evidence: sortAndDeduplicateWith(chunks.map((chunk) => chunkEvidence(chunk, filePathById)), compareEvidence)
        .slice(0, CONVENTION_LIMITS.max_evidence_per_fact),
    });
  }

  const testFiles = input.files.filter((file) => isTestPath(file.path));
  if (testFiles.length > 0) {
    const value = testFiles.every((file) => dirnameRepoPath(file.path) === input.subsystem.path)
      ? "subsystem_local"
      : "separate_test_tree";
    facts.push({
      id: `fact:${hashValue([input.subsystem.id, input.language, "test_layout", value]).slice(0, 20)}`,
      category: "test_layout",
      statement: `${testFiles.length} indexed test file${testFiles.length === 1 ? " is" : "s are"} observed for this subsystem profile.`,
      value,
      observed_count: testFiles.length,
      confidence: "heuristic",
      normative: false,
      enforcement: "informational",
      evidence: sortAndDeduplicateWith(testFiles.map((file) => ({ entity_id: file.id, path: file.path })), compareEvidence)
        .slice(0, CONVENTION_LIMITS.max_evidence_per_fact),
    });
  }

  const relationsByEntity = new Map<string, RelationRecord[]>();
  for (const relation of sortAndDeduplicate(input.data.relations)) {
    for (const entityId of [relation.from, relation.to]) {
      const list = relationsByEntity.get(entityId) ?? [];
      list.push(relation);
      relationsByEntity.set(entityId, list);
    }
  }

  const reusable: ReusableSymbol[] = [];
  const reusableRelationOmissions = new Map<string, number>();
  for (const chunk of exports) {
    const filePath = filePathById.get(chunk.file_id);
    if (!filePath) {
      oversizedRecordsDropped += 1;
      continue;
    }
    const role = reusableRole(chunk, filePath);
    const connected = sortAndDeduplicate(
      (relationsByEntity.get(chunk.id) ?? [])
        .filter((relation) => ["CALLS", "IMPORTS", "EXPORTS", "DEFINES"].includes(relation.relation)),
    );
    const callers = connected.flatMap((relation): ConventionEvidence[] => {
      if (relation.relation === "CALLS" && relation.to === chunk.id) {
        const caller = chunkById.get(relation.from);
        return caller && safeChunk(caller) ? [chunkEvidence(caller, filePathById)] : [];
      }
      if (relation.relation === "IMPORTS" && relation.to === chunk.id) {
        const caller = chunkById.get(relation.from);
        return caller && safeChunk(caller) ? [chunkEvidence(caller, filePathById)] : [];
      }
      return [];
    });
    const uniqueCallers = sortAndDeduplicateWith(callers, compareEvidence)
      .filter((item, index, values) => index === values.findIndex((candidate) => candidate.entity_id === item.entity_id));
    const uniqueTests = uniqueCallers.filter((item) => item.path && isTestPath(item.path));
    const relationRecords = sortAndDeduplicate(connected.map((relation) => ({
      direction: relation.to === chunk.id ? "incoming" as const : "outgoing" as const,
      relation: relation.relation,
      entity_id: relation.to === chunk.id ? relation.from : relation.to,
    })));
    reusableRelationOmissions.set(chunk.id, Math.max(0, relationRecords.length - CONVENTION_LIMITS.max_reusable_relations));
    reusable.push({
      entity_id: chunk.id,
      path: filePath,
      name: chunk.name,
      kind: chunk.kind,
      signature: chunk.signature,
      language: input.language,
      role: role.role,
      confidence: role.confidence,
      subsystem_id: input.subsystem.id,
      relations: relationRecords.slice(0, CONVENTION_LIMITS.max_reusable_relations),
      representative_callers_observed_count: uniqueCallers.length,
      representative_callers: uniqueCallers.slice(0, CONVENTION_LIMITS.max_representative_callers),
      representative_tests_observed_count: uniqueTests.length,
      representative_tests: uniqueTests.slice(0, CONVENTION_LIMITS.max_representative_callers),
      evidence: [chunkEvidence(chunk, filePathById)],
    });
  }
  reusable.sort(compareReusableSymbol);
  const reusableSymbolsOmitted = Math.max(0, reusable.length - CONVENTION_LIMITS.max_reusable_symbols);
  const retainedReusable = reusable.slice(0, CONVENTION_LIMITS.max_reusable_symbols);
  const reusableRelationsOmitted = retainedReusable.reduce(
    (total, symbol) => total + (reusableRelationOmissions.get(symbol.entity_id) ?? 0),
    0,
  );
  const representativeCallersOmitted = retainedReusable.reduce(
    (total, symbol) => total + symbol.representative_callers_observed_count - symbol.representative_callers.length,
    0,
  );
  const representativeTestsOmitted = retainedReusable.reduce(
    (total, symbol) => total + symbol.representative_tests_observed_count - symbol.representative_tests.length,
    0,
  );

  const relatedBySubsystem = new Map<string, { relationTypes: Set<string>; evidence: ConventionEvidence[] }>();
  const entityOwnerFile = (entityId: string): string | undefined => {
    if (filePathById.has(entityId)) return entityId;
    return chunkById.get(entityId)?.file_id;
  };
  for (const relation of sortAndDeduplicate(input.data.relations)) {
    if (!["CALLS", "IMPORTS", "REFERENCES_PROJECT", "USES_CONFIG", "USES_RESOURCE", "USES_SETTING"].includes(relation.relation)) continue;
    const fromFile = entityOwnerFile(relation.from);
    const toFile = entityOwnerFile(relation.to);
    if (!fromFile || !toFile || fromFile === toFile) continue;
    const fromScope = input.subsystemByFileId.get(fromFile);
    const toScope = input.subsystemByFileId.get(toFile);
    if (!fromScope || !toScope || fromScope.id === toScope.id) continue;
    let other: ConventionSubsystem | undefined;
    if (fromScope.id === input.subsystem.id) other = toScope;
    if (toScope.id === input.subsystem.id) other = fromScope;
    if (!other) continue;
    const entry = relatedBySubsystem.get(other.id) ?? { relationTypes: new Set<string>(), evidence: [] };
    entry.relationTypes.add(relation.relation);
    entry.evidence.push(relationEvidence(relation));
    relatedBySubsystem.set(other.id, entry);
  }
  const sortedRelatedSubsystems = [...relatedBySubsystem.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([subsystemId, entry]) => {
      const candidates = sortAndDeduplicateWith(entry.evidence, compareEvidence);
      const evidence = capEvidenceByRelationType(candidates);
      return {
        subsystem_id: subsystemId,
        relation_types: sortUnique(evidence.map((item) => item.relation!.type)),
        observed_count: candidates.length,
        evidence,
      };
    });
  const relatedSubsystems = sortedRelatedSubsystems.slice(0, CONVENTION_LIMITS.max_related_subsystems);
  const relatedSubsystemsOmitted = Math.max(0, sortedRelatedSubsystems.length - CONVENTION_LIMITS.max_related_subsystems);
  const relatedSubsystemEvidenceOmitted = relatedSubsystems.reduce(
    (total, related) => total + related.observed_count - related.evidence.length,
    0,
  );
  for (const related of relatedSubsystems) {
    facts.push({
      id: `fact:${hashValue([input.subsystem.id, input.language, "graph_connection", related.subsystem_id]).slice(0, 20)}`,
      category: "graph_connection",
      statement: `Indexed graph relations connect this subsystem to ${related.subsystem_id}.`,
      value: related.subsystem_id,
      observed_count: related.observed_count,
      confidence: "structural",
      normative: false,
      enforcement: "informational",
      evidence: related.evidence,
    });
  }
  facts.sort(compareStructuralFact);

  const diagnostics = {
    authoritative_evidence_omitted: authoritative.evidenceOmitted,
    oversized_records_dropped: oversizedRecordsDropped,
    subsystem_evidence_omitted: input.subsystemEvidenceOmitted,
    reusable_symbols_omitted: reusableSymbolsOmitted,
    reusable_relations_omitted: reusableRelationsOmitted,
    representative_callers_omitted: representativeCallersOmitted,
    representative_tests_omitted: representativeTestsOmitted,
    related_subsystem_evidence_omitted: relatedSubsystemEvidenceOmitted,
    related_subsystems_omitted: relatedSubsystemsOmitted,
    conflicts_omitted: conflictsOmitted,
    unsupported_claims_emitted: 0 as const,
  };

  const dependencyIds = new Set<string>([
    ...fileIds,
    input.subsystem.id,
    ...authoritative.evidence.map((item) => item.entity_id),
    ...facts.flatMap((item) => item.evidence.flatMap((evidence) => [
      evidence.entity_id,
      evidence.relation?.from,
      evidence.relation?.to,
    ].filter((value): value is string => value !== undefined))),
    ...retainedReusable.flatMap((symbol) => [
      symbol.entity_id,
      ...symbol.relations.map((relation) => relation.entity_id),
      ...symbol.evidence.map((evidence) => evidence.entity_id),
      ...symbol.representative_callers.map((evidence) => evidence.entity_id),
      ...symbol.representative_tests.map((evidence) => evidence.entity_id),
    ]),
    ...relatedSubsystems.flatMap((item) => [
      item.subsystem_id,
      ...item.evidence.flatMap((evidence) => [
        evidence.entity_id,
        evidence.relation?.from,
        evidence.relation?.to,
      ].filter((value): value is string => value !== undefined)),
    ]),
    ...conflicts.flatMap((item) => item.claims.map((claim) => claim.source_id)),
  ]);
  const dependencyChunks = stableUniqueEntitiesById(input.data.chunks)
    .filter((item) => dependencyIds.has(item.id));
  for (const item of dependencyChunks) dependencyIds.add(item.file_id);
  const dependencyRecords = [
    ...stableUniqueEntitiesById(input.data.documents)
      .filter((item) => dependencyIds.has(item.id))
      .map((item) => ({ record_type: "document", record: { ...item, updated_at: undefined } })),
    ...dependencyChunks.map((item) => ({ record_type: "chunk", record: { ...item, updated_at: undefined } })),
    ...stableUniqueEntitiesById(input.data.modules)
      .filter((item) => dependencyIds.has(item.id))
      .map((item) => ({ record_type: "module", record: { ...item, updated_at: undefined } })),
    ...stableUniqueEntitiesById(input.data.projects)
      .filter((item) => dependencyIds.has(item.id))
      .map((item) => ({ record_type: "project", record: { ...item, updated_at: undefined } })),
    ...stableUniqueEntitiesById(input.data.rules)
      .filter((item) => dependencyIds.has(item.id))
      .map((item) => ({ record_type: "rule", record: { ...item, updated_at: undefined } })),
    ...stableUniqueEntitiesById(input.data.adrs)
      .filter((item) => dependencyIds.has(item.id))
      .map((item) => ({ record_type: "adr", record: { ...item, decision_date: undefined } })),
  ].sort(compareCanonical);
  const sourceInput = {
    repository_id: input.repositoryId,
    language: input.language,
    subsystem: input.subsystem,
    files: sortAndDeduplicate(input.files.map((file) => ({ id: file.id, path: file.path, kind: file.kind, content: file.content, status: file.status, source_of_truth: file.source_of_truth }))),
    chunks: sortAndDeduplicate(relevantChunks.map((chunk) => ({ ...chunk, updated_at: undefined }))),
    dependency_records: dependencyRecords,
    output_dependencies: {
      authoritative_evidence: authoritative.evidence,
      structural_facts: facts,
      reusable_symbols: retainedReusable,
      related_subsystems: relatedSubsystems,
      conflicts,
      diagnostics,
    },
    rules: sortAndDeduplicate(input.data.rules
      .filter((rule) => authoritative.applicableIds.has(rule.id) && rule.status === "active")
      .map((rule) => ({ ...rule, updated_at: undefined }))),
    adrs: sortAndDeduplicate(input.data.adrs
      .filter((adr) => authoritative.applicableIds.has(adr.id) && adr.status === "active")
      .map((adr) => ({ ...adr, decision_date: undefined }))),
  };
  const sourceHash = hashValue(sourceInput);
  const profileId = deriveProfileId(input.repositoryId, input.language, input.subsystem.id);
  const withoutHash = {
    schema_version: CONVENTION_SCHEMA_VERSION as 1,
    generator_version: CONVENTION_GENERATOR_VERSION,
    profile_id: profileId,
    repository_id: input.repositoryId,
    language: input.language,
    subsystem: input.subsystem,
    file_ids: sortUnique(fileIds),
    source_hash: sourceHash,
    limits: CONVENTION_LIMITS,
    authoritative_evidence: authoritative.evidence,
    structural_facts: facts,
    reusable_symbols: retainedReusable,
    related_subsystems: relatedSubsystems,
    conflicts,
    diagnostics,
  };
  const profileHash = hashValue(withoutHash);
  return { ...withoutHash, profile_hash: profileHash };
}

function resolveRepositoryId(options: { repository_id?: string; repo_root?: string }): string {
  const repositoryId = options.repository_id ?? readRepositoryId(options.repo_root ?? REPO_ROOT);
  if (!REPOSITORY_ID_PATTERN.test(repositoryId)) {
    throw new Error("Invalid repository identity for convention profiles");
  }
  return repositoryId;
}

type ConventionValidationTraversal = "static" | "context" | "backing";

function buildConventionProfilesInternal(
  data: ContextData,
  repositoryId: string,
  onValidationTraversal?: (kind: ConventionValidationTraversal) => void,
): ConventionProfile[] {
  onValidationTraversal?.("context");
  const eligibleData = eligibleConventionData(data);
  const scopes = deriveScopes(eligibleData);
  const subsystemByFileId = new Map(scopes.map((scope) => [scope.file.id, scope.subsystem]));
  const groups = new Map<string, { language: string; subsystem: ConventionSubsystem; files: DocumentRecord[] }>();
  for (const scope of scopes) {
    for (const language of scope.languages) {
      const key = `${language}\0${scope.subsystem.id}`;
      const group = groups.get(key) ?? { language, subsystem: scope.subsystem, files: [] };
      group.subsystem = {
        ...group.subsystem,
        evidence: [...new Map(
          [...group.subsystem.evidence, ...scope.subsystem.evidence]
            .map((item) => [`${item.relation}:${item.entity_id}`, item]),
        ).values()].sort(compareSubsystemEvidence),
      };
      group.files.push(scope.file);
      groups.set(key, group);
      if (groups.size > CONVENTION_LIMITS.max_profile_count) {
        throw new Error("Convention profile count exceeds the version-1 aggregate limit");
      }
    }
  }
  const profiles = [...groups.values()]
    .sort((left, right) => compareText(left.subsystem.id, right.subsystem.id) || compareText(left.language, right.language))
    .map((group) => {
      const subsystemEvidenceOmitted = Math.max(
        0,
        group.subsystem.evidence.length - CONVENTION_LIMITS.max_evidence_per_fact,
      );
      return buildProfile({
        data: eligibleData,
        repositoryId,
        language: group.language,
        subsystem: {
          ...group.subsystem,
          evidence: group.subsystem.evidence.slice(0, CONVENTION_LIMITS.max_evidence_per_fact),
        },
        subsystemEvidenceOmitted,
        files: group.files.sort((left, right) => compareText(left.id, right.id)),
        subsystemByFileId,
      });
    });
  onValidationTraversal?.("static");
  for (const profile of profiles) validateConventionProfile(profile);
  assertProfileCollectionBounds(profiles);
  return profiles;
}

type CanonicalConventionCollection = {
  repositoryId: string;
  profiles: ConventionProfile[];
  expectedById: Map<string, ConventionProfile>;
};

function buildCanonicalConventionCollection(
  data: ContextData,
  repositoryId: string,
  onBuild?: () => void,
  onValidationTraversal?: (kind: ConventionValidationTraversal) => void,
): CanonicalConventionCollection {
  onBuild?.();
  const profiles = buildConventionProfilesInternal(data, repositoryId, onValidationTraversal);
  return {
    repositoryId,
    profiles,
    expectedById: new Map(profiles.map((profile) => [profile.profile_id, profile])),
  };
}

function validateProfilesAgainstCanonical(
  profiles: ConventionProfile[],
  canonical: CanonicalConventionCollection,
): void {
  for (const profile of profiles) {
    validateConventionProfile(profile);
    const expected = canonical.expectedById.get(profile.profile_id);
    if (!expected || canonicalConventionJson(expected) !== canonicalConventionJson(profile)) {
      throw new Error("Convention profile does not match canonical indexed-context semantics");
    }
  }
}

export function buildConventionProfiles(
  data: ContextData,
  options: { repository_id?: string; repo_root?: string } = {},
): ConventionProfile[] {
  const repositoryId = resolveRepositoryId(options);
  return buildCanonicalConventionCollection(data, repositoryId).profiles;
}

export function validateConventionProfilesAgainstContext(
  profiles: ConventionProfile[],
  data: ContextData,
  options: { repository_id?: string; repo_root?: string } = {},
): void {
  const repositoryId = options.repository_id ?? profiles[0]?.repository_id ?? resolveRepositoryId(options);
  if (!REPOSITORY_ID_PATTERN.test(repositoryId)) throw new Error("Invalid repository identity for convention profiles");
  validateProfilesAgainstCanonical(profiles, buildCanonicalConventionCollection(data, repositoryId));
}

function assertExactKeys(value: unknown, expected: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value as Record<string, unknown>).sort(compareText);
  const wanted = [...expected].sort(compareText);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} has unknown or missing schema keys`);
  }
}

function assertAllowedKeys(value: unknown, allowed: readonly string[], required: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value as Record<string, unknown>);
  if (actual.some((key) => !allowed.includes(key)) || required.some((key) => !actual.includes(key))) {
    throw new Error(`${label} has unknown or missing schema keys`);
  }
}

function assertEnum(value: unknown, allowed: readonly string[], label: string): asserts value is string {
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`${label} has an invalid value`);
}

function assertCanonicalPath(value: unknown, label: string, allowRoot = false): asserts value is string {
  assertString(value, label, CONVENTION_LIMITS.max_path_chars);
  if (normalizeRepoPath(value, allowRoot) !== value) throw new Error(`${label} must be a canonical repository-relative path`);
}

function assertArray(value: unknown, label: string, max?: number): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  if (max !== undefined && value.length > max) throw new Error(`${label} exceeds its version-1 limit`);
}

function assertUniqueBy<T>(values: T[], key: (value: T) => string, label: string): void {
  const keys = values.map(key);
  if (new Set(keys).size !== keys.length) throw new Error(`${label} must contain unique records`);
}

function assertCanonicalArray<T>(
  values: T[],
  compare: (left: T, right: T) => number,
  key: (value: T) => string,
  label: string,
): void {
  for (let index = 1; index < values.length; index += 1) {
    if (compare(values[index - 1], values[index]) >= 0) {
      throw new Error(`${label} must use canonical builder ordering and uniqueness`);
    }
  }
  assertUniqueBy(values, key, label);
}

function validateLimits(value: unknown, label: string): asserts value is typeof CONVENTION_LIMITS {
  assertExactKeys(value, LIMIT_KEYS, label);
  for (const [key, expected] of Object.entries(CONVENTION_LIMITS)) {
    if (value[key] !== expected) throw new Error(`${label}.${key} must equal the version-1 limit`);
  }
}

function validateEvidence(value: unknown, label: string): asserts value is ConventionEvidence {
  assertAllowedKeys(value, EVIDENCE_KEYS, ["entity_id"], label);
  assertString(value.entity_id, `${label}.entity_id`, CONVENTION_LIMITS.max_identifier_chars);
  if (value.path !== undefined) assertCanonicalPath(value.path, `${label}.path`);
  const hasStart = value.start_line !== undefined;
  const hasEnd = value.end_line !== undefined;
  if (hasStart !== hasEnd || (hasStart && (!isPositiveInteger(value.start_line) || !isPositiveInteger(value.end_line) || Number(value.end_line) < Number(value.start_line)))) {
    throw new Error(`${label} line bounds are invalid`);
  }
  if (value.relation !== undefined) {
    assertExactKeys(value.relation, EVIDENCE_RELATION_KEYS, `${label}.relation`);
    assertString(value.relation.from, `${label}.relation.from`, CONVENTION_LIMITS.max_identifier_chars);
    assertString(value.relation.to, `${label}.relation.to`, CONVENTION_LIMITS.max_identifier_chars);
    assertString(value.relation.type, `${label}.relation.type`, CONVENTION_LIMITS.max_identifier_chars);
  }
}

function validateEvidenceArray(value: unknown, label: string, max: number = CONVENTION_LIMITS.max_evidence_per_fact): asserts value is ConventionEvidence[] {
  assertArray(value, label, max);
  value.forEach((item, index) => validateEvidence(item, `${label}[${index}]`));
  assertCanonicalArray(value as ConventionEvidence[], compareEvidence, canonicalKey, label);
}

function validateSubsystem(value: unknown, label: string): asserts value is ConventionSubsystem {
  assertExactKeys(value, SUBSYSTEM_KEYS, label);
  assertString(value.id, `${label}.id`, CONVENTION_LIMITS.max_identifier_chars);
  assertEnum(value.type, ["module", "project", "path"], `${label}.type`);
  assertCanonicalPath(value.path, `${label}.path`, true);
  assertArray(value.evidence, `${label}.evidence`, CONVENTION_LIMITS.max_evidence_per_fact);
  for (const [index, item] of value.evidence.entries()) {
    assertExactKeys(item, SUBSYSTEM_EVIDENCE_KEYS, `${label}.evidence[${index}]`);
    assertString(item.entity_id, `${label}.evidence[${index}].entity_id`, CONVENTION_LIMITS.max_identifier_chars);
    assertEnum(item.relation, ["CONTAINS", "INCLUDES_FILE", "PATH_SCOPE"], `${label}.evidence[${index}].relation`);
  }
  assertCanonicalArray(value.evidence as ConventionSubsystem["evidence"], compareSubsystemEvidence, canonicalKey, `${label}.evidence`);
  const expectedId = value.type === "module"
    ? `module:${value.path}`
    : value.type === "project"
      ? `project:${value.path}`
      : `path:${value.path}`;
  if (value.id !== expectedId) throw new Error(`${label}.id must encode its canonical path`);
}

function validateAuthoritativeEvidence(value: unknown, label: string): asserts value is AuthoritativeEvidence {
  assertExactKeys(value, AUTHORITATIVE_KEYS, label);
  assertString(value.entity_id, `${label}.entity_id`, CONVENTION_LIMITS.max_identifier_chars);
  assertEnum(value.entity_type, ["Rule", "ADR"], `${label}.entity_type`);
  assertString(value.title, `${label}.title`, CONVENTION_LIMITS.max_identifier_chars);
  if (value.status !== "active") throw new Error(`${label}.status must be active`);
  if (!isNonNegativeInteger(value.priority) || Number(value.priority) > 1000) throw new Error(`${label}.priority is invalid`);
  assertEnum(value.scope, ["repository", "subsystem"], `${label}.scope`);
  if (!isPositiveInteger(value.observed_count)) throw new Error(`${label}.observed_count is invalid`);
  validateEvidenceArray(value.evidence, `${label}.evidence`);
  if (value.evidence.length === 0 || value.observed_count < value.evidence.length) throw new Error(`${label}.evidence count is invalid`);
  for (const evidence of value.evidence) {
    if (evidence.entity_id !== value.entity_id) throw new Error(`${label}.evidence must identify the authoritative record`);
  }
  const typedPrefix = value.entity_type === "Rule" ? /^rule[.:]/u : /^adr[.:]/u;
  if (!typedPrefix.test(value.entity_id)) throw new Error(`${label}.entity_id must agree with entity_type`);
  if (value.entity_type === "ADR" && (value.priority !== 100 || value.scope !== "subsystem")) {
    throw new Error(`${label} ADR authority semantics are invalid`);
  }
}

function validateStructuralFact(value: unknown, label: string): asserts value is StructuralFact {
  assertExactKeys(value, FACT_KEYS, label);
  assertString(value.id, `${label}.id`, CONVENTION_LIMITS.max_identifier_chars);
  assertEnum(value.category, ["exported_symbol_kind", "test_layout", "graph_connection"], `${label}.category`);
  assertString(value.statement, `${label}.statement`, 4096);
  assertString(value.value, `${label}.value`, CONVENTION_LIMITS.max_identifier_chars);
  if (!isNonNegativeInteger(value.observed_count)) throw new Error(`${label}.observed_count is invalid`);
  assertEnum(value.confidence, ["structural", "heuristic"], `${label}.confidence`);
  if (value.normative !== false || value.enforcement !== "informational") throw new Error(`${label} has invalid normative enforcement`);
  validateEvidenceArray(value.evidence, `${label}.evidence`);
  if (value.observed_count === 0 || value.evidence.length === 0) throw new Error(`${label} must cite a positive structural observation`);
  if (value.category === "test_layout") {
    if (value.confidence !== "heuristic" || !["subsystem_local", "separate_test_tree"].includes(value.value)) {
      throw new Error(`${label} test-layout semantics are invalid`);
    }
    for (const evidence of value.evidence) {
      if (!evidence.path || !isTestPath(evidence.path) || !evidence.entity_id.startsWith("file:") || evidence.relation || evidence.start_line) {
        throw new Error(`${label} test-layout evidence is invalid`);
      }
    }
  } else if (value.category === "exported_symbol_kind") {
    if (value.confidence !== "structural") throw new Error(`${label} exported-symbol semantics are invalid`);
    for (const evidence of value.evidence) {
      if (!evidence.path || !evidence.entity_id.startsWith("chunk:") || !evidence.start_line || evidence.relation) {
        throw new Error(`${label} exported-symbol evidence is invalid`);
      }
    }
  } else {
    if (value.confidence !== "structural" || value.observed_count < value.evidence.length) {
      throw new Error(`${label} graph-connection semantics are invalid`);
    }
    for (const evidence of value.evidence) {
      if (!evidence.relation || evidence.relation.type.length === 0) throw new Error(`${label} graph-connection evidence is invalid`);
    }
  }
}

function validateReusableSymbol(value: unknown, label: string, profile: Record<string, unknown>): asserts value is ReusableSymbol {
  assertExactKeys(value, REUSABLE_KEYS, label);
  assertString(value.entity_id, `${label}.entity_id`, CONVENTION_LIMITS.max_identifier_chars);
  assertCanonicalPath(value.path, `${label}.path`);
  assertString(value.name, `${label}.name`, CONVENTION_LIMITS.max_name_chars);
  assertString(value.kind, `${label}.kind`, CONVENTION_LIMITS.max_identifier_chars);
  if (typeof value.signature !== "string" || value.signature.length > CONVENTION_LIMITS.max_signature_chars || !isSafeVisibleText(value.signature)) throw new Error(`${label}.signature is invalid`);
  assertString(value.language, `${label}.language`, CONVENTION_LIMITS.max_identifier_chars);
  if (value.language !== profile.language) throw new Error(`${label}.language must match the profile`);
  assertEnum(value.role, ["shared_library", "base_class", "interface", "factory", "adapter", "error_type", "logging", "configuration", "test_helper", "reusable_export"], `${label}.role`);
  assertEnum(value.confidence, ["structural", "heuristic"], `${label}.confidence`);
  assertString(value.subsystem_id, `${label}.subsystem_id`, CONVENTION_LIMITS.max_identifier_chars);
  const subsystem = profile.subsystem as Record<string, unknown>;
  if (value.subsystem_id !== subsystem.id) throw new Error(`${label}.subsystem_id must match the profile`);
  assertArray(value.relations, `${label}.relations`, CONVENTION_LIMITS.max_reusable_relations);
  for (const [index, relation] of value.relations.entries()) {
    assertExactKeys(relation, REUSABLE_RELATION_KEYS, `${label}.relations[${index}]`);
    assertEnum(relation.direction, ["incoming", "outgoing"], `${label}.relations[${index}].direction`);
    assertString(relation.relation, `${label}.relations[${index}].relation`, CONVENTION_LIMITS.max_identifier_chars);
    assertString(relation.entity_id, `${label}.relations[${index}].entity_id`, CONVENTION_LIMITS.max_identifier_chars);
  }
  assertUniqueBy(value.relations, canonicalKey, `${label}.relations`);
  if (!isNonNegativeInteger(value.representative_callers_observed_count)) {
    throw new Error(`${label}.representative_callers_observed_count is invalid`);
  }
  validateEvidenceArray(value.representative_callers, `${label}.representative_callers`, CONVENTION_LIMITS.max_representative_callers);
  if (
    value.representative_callers_observed_count < value.representative_callers.length ||
    (value.representative_callers_observed_count > value.representative_callers.length &&
      value.representative_callers.length !== CONVENTION_LIMITS.max_representative_callers)
  ) throw new Error(`${label}.representative_callers omission accounting is inconsistent`);
  if (!isNonNegativeInteger(value.representative_tests_observed_count)) {
    throw new Error(`${label}.representative_tests_observed_count is invalid`);
  }
  validateEvidenceArray(value.representative_tests, `${label}.representative_tests`, CONVENTION_LIMITS.max_representative_callers);
  if (
    value.representative_tests_observed_count < value.representative_tests.length ||
    (value.representative_tests_observed_count > value.representative_tests.length &&
      value.representative_tests.length !== CONVENTION_LIMITS.max_representative_callers)
  ) throw new Error(`${label}.representative_tests omission accounting is inconsistent`);
  validateEvidenceArray(value.evidence, `${label}.evidence`);
  if (
    value.evidence.length !== 1 ||
    value.evidence[0].entity_id !== value.entity_id ||
    value.evidence[0].path !== value.path ||
    !value.evidence[0].start_line
  ) throw new Error(`${label}.evidence must identify the same symbol and path`);
  for (const caller of value.representative_callers) {
    if (!caller.entity_id.startsWith("chunk:") || !caller.path || !caller.start_line) {
      throw new Error(`${label}.representative_callers must identify indexed caller chunks and paths`);
    }
  }
  for (const caller of value.representative_tests) {
    if (!caller.entity_id.startsWith("chunk:") || !caller.path || !caller.start_line || !isTestPath(caller.path)) {
      throw new Error(`${label}.representative_tests must be test-path caller evidence`);
    }
  }
}

function validateConflict(value: unknown, label: string): asserts value is ConventionConflict {
  assertExactKeys(value, CONFLICT_KEYS, label);
  assertString(value.key, `${label}.key`, 100, /^[a-z][a-z0-9_.-]{0,99}$/u);
  if (value.enforcement !== "deterministic") throw new Error(`${label}.enforcement is invalid`);
  if (!isNonNegativeInteger(value.governing_priority) || Number(value.governing_priority) > 1000) {
    throw new Error(`${label}.governing_priority is invalid`);
  }
  assertString(value.message, `${label}.message`, 4096);
  assertArray(value.claims, `${label}.claims`);
  if (value.claims.length < 2) throw new Error(`${label}.claims must contain conflicting values`);
  for (const [index, claim] of value.claims.entries()) {
    assertExactKeys(claim, CLAIM_KEYS, `${label}.claims[${index}]`);
    if (claim.key !== value.key) throw new Error(`${label}.claims[${index}].key must match the conflict`);
    assertString(claim.value, `${label}.claims[${index}].value`, 200);
    assertString(claim.source_id, `${label}.claims[${index}].source_id`, CONVENTION_LIMITS.max_identifier_chars);
    assertEnum(claim.source_type, ["Rule", "ADR"], `${label}.claims[${index}].source_type`);
    if (!isNonNegativeInteger(claim.priority) || Number(claim.priority) > 1000) throw new Error(`${label}.claims[${index}].priority is invalid`);
    validateEvidence(claim.evidence, `${label}.claims[${index}].evidence`);
    if (claim.evidence.entity_id !== claim.source_id) throw new Error(`${label}.claims[${index}].evidence must identify its source`);
    const typedPrefix = claim.source_type === "Rule" ? /^rule[.:]/u : /^adr[.:]/u;
    if (!typedPrefix.test(claim.source_id)) throw new Error(`${label}.claims[${index}].source_id must agree with source_type`);
  }
  if (new Set((value.claims as ConventionClaim[]).map((claim) => claim.value)).size < 2) throw new Error(`${label}.claims must disagree`);
  if (value.governing_priority !== Math.max(...(value.claims as ConventionClaim[]).map((claim) => claim.priority))) {
    throw new Error(`${label}.governing_priority must equal the highest active claim priority`);
  }
  assertCanonicalArray(value.claims as ConventionClaim[], compareClaim, canonicalKey, `${label}.claims`);
}

function assertProfileCollectionBounds(profiles: ConventionProfile[]): void {
  if (profiles.length > CONVENTION_LIMITS.max_profile_count) throw new Error("Convention profile count exceeds the version-1 aggregate limit");
  const total = profiles.reduce((bytes, profile) => bytes + Buffer.byteLength(canonicalConventionJson(profile)), 0);
  if (total > CONVENTION_LIMITS.max_aggregate_profile_bytes) throw new Error("Convention profiles exceed the version-1 aggregate byte limit");
}

export function validateConventionProfile(value: unknown): asserts value is ConventionProfile {
  assertExactKeys(value, PROFILE_ROOT_KEYS, "Convention profile");
  if (value.schema_version !== CONVENTION_SCHEMA_VERSION) throw new Error("Unsupported convention profile schema version");
  if (value.generator_version !== CONVENTION_GENERATOR_VERSION) throw new Error("Unsupported convention profile generator version");
  assertString(value.profile_id, "Convention profile.profile_id", 43, PROFILE_ID_PATTERN);
  assertString(value.repository_id, "Convention profile.repository_id", 100, REPOSITORY_ID_PATTERN);
  assertString(value.language, "Convention profile.language", CONVENTION_LIMITS.max_identifier_chars);
  validateSubsystem(value.subsystem, "Convention profile.subsystem");
  const expectedProfileId = deriveProfileId(value.repository_id, value.language, value.subsystem.id);
  if (value.profile_id !== expectedProfileId) throw new Error("Convention profile ID is inconsistent with its scope");
  assertSortedUniqueStrings(value.file_ids, "Convention profile.file_ids");
  const backedPaths = new Set<string>();
  for (const [index, fileId] of value.file_ids.entries()) {
    if (!fileId.startsWith("file:")) throw new Error(`Convention profile.file_ids[${index}] must encode a backed file path`);
    const backedPath = fileId.slice("file:".length);
    assertCanonicalPath(backedPath, `Convention profile.file_ids[${index}] backed path`);
    if (fileId !== `file:${backedPath}`) throw new Error(`Convention profile.file_ids[${index}] must encode a canonical backed file path`);
    backedPaths.add(backedPath);
  }
  if (value.file_ids.length === 0) throw new Error("Convention profile.file_ids must not be empty");
  const subsystemRelation = value.subsystem.type === "module"
    ? "CONTAINS"
    : value.subsystem.type === "project"
      ? "INCLUDES_FILE"
      : "PATH_SCOPE";
  if (value.subsystem.evidence.length === 0) throw new Error("Convention profile.subsystem.evidence must not be empty");
  for (const evidence of value.subsystem.evidence) {
    if (!value.file_ids.includes(evidence.entity_id) || evidence.relation !== subsystemRelation) {
      throw new Error("Convention profile.subsystem.evidence must reference the claimed scope files");
    }
  }
  assertString(value.source_hash, "Convention profile.source_hash", 64, SHA256_PATTERN);
  assertString(value.profile_hash, "Convention profile.profile_hash", 64, SHA256_PATTERN);
  validateLimits(value.limits, "Convention profile.limits");
  assertArray(value.authoritative_evidence, "Convention profile.authoritative_evidence");
  value.authoritative_evidence.forEach((item, index) => validateAuthoritativeEvidence(item, `Convention profile.authoritative_evidence[${index}]`));
  assertCanonicalArray(value.authoritative_evidence as AuthoritativeEvidence[], compareAuthoritativeEvidence, (item) => item.entity_id, "Convention profile.authoritative_evidence");
  assertArray(value.structural_facts, "Convention profile.structural_facts");
  value.structural_facts.forEach((item, index) => validateStructuralFact(item, `Convention profile.structural_facts[${index}]`));
  assertCanonicalArray(value.structural_facts as StructuralFact[], compareStructuralFact, (item) => item.id, "Convention profile.structural_facts");
  assertArray(value.reusable_symbols, "Convention profile.reusable_symbols", CONVENTION_LIMITS.max_reusable_symbols);
  value.reusable_symbols.forEach((item, index) => validateReusableSymbol(item, `Convention profile.reusable_symbols[${index}]`, value));
  assertCanonicalArray(value.reusable_symbols as ReusableSymbol[], compareReusableSymbol, (item) => item.entity_id, "Convention profile.reusable_symbols");
  for (const symbol of value.reusable_symbols as ReusableSymbol[]) {
    if (!backedPaths.has(symbol.path)) throw new Error("Convention profile reusable-symbol paths must belong to the profile");
    assertCanonicalArray(symbol.relations, compareCanonical, canonicalKey, `Convention reusable symbol ${symbol.entity_id}.relations`);
  }
  assertArray(value.related_subsystems, "Convention profile.related_subsystems", CONVENTION_LIMITS.max_related_subsystems);
  for (const [index, related] of value.related_subsystems.entries()) {
    assertExactKeys(related, RELATED_SUBSYSTEM_KEYS, `Convention profile.related_subsystems[${index}]`);
    assertString(related.subsystem_id, `Convention profile.related_subsystems[${index}].subsystem_id`, CONVENTION_LIMITS.max_identifier_chars);
    assertSortedUniqueStrings(related.relation_types, `Convention profile.related_subsystems[${index}].relation_types`);
    if (!isPositiveInteger(related.observed_count)) throw new Error(`Convention profile.related_subsystems[${index}].observed_count is invalid`);
    validateEvidenceArray(related.evidence, `Convention profile.related_subsystems[${index}].evidence`);
    if (related.relation_types.length === 0 || related.evidence.length === 0 || related.observed_count < related.evidence.length) {
      throw new Error(`Convention profile.related_subsystems[${index}] must cite graph connections`);
    }
    for (const evidence of related.evidence as ConventionEvidence[]) {
      if (!evidence.relation || !(related.relation_types as string[]).includes(evidence.relation.type)) {
        throw new Error(`Convention profile.related_subsystems[${index}] relation evidence is inconsistent`);
      }
    }
    if (canonicalKey(related.relation_types) !== canonicalKey(sortUnique(
      (related.evidence as ConventionEvidence[]).map((evidence) => evidence.relation!.type),
    ))) throw new Error(`Convention profile.related_subsystems[${index}] relation types must derive from retained evidence`);
  }
  assertCanonicalArray(value.related_subsystems as ConventionProfile["related_subsystems"], compareRelatedSubsystem, (item) => item.subsystem_id, "Convention profile.related_subsystems");
  const graphFacts = (value.structural_facts as StructuralFact[]).filter((fact) => fact.category === "graph_connection");
  if (graphFacts.length !== value.related_subsystems.length) throw new Error("Convention profile graph facts must match related subsystems");
  for (const related of value.related_subsystems as ConventionProfile["related_subsystems"]) {
    const matches = graphFacts.filter((fact) =>
      fact.value === related.subsystem_id && fact.observed_count === related.observed_count &&
      canonicalKey(fact.evidence) === canonicalKey(related.evidence)
    );
    if (matches.length !== 1) throw new Error("Convention profile related-subsystem evidence must match one graph fact");
  }
  assertArray(value.conflicts, "Convention profile.conflicts", CONVENTION_LIMITS.max_conflicts);
  value.conflicts.forEach((item, index) => validateConflict(item, `Convention profile.conflicts[${index}]`));
  assertCanonicalArray(value.conflicts as ConventionConflict[], compareConflict, (item) => item.key, "Convention profile.conflicts");
  assertExactKeys(value.diagnostics, DIAGNOSTIC_KEYS, "Convention profile.diagnostics");
  for (const key of DIAGNOSTIC_KEYS) if (!isNonNegativeInteger(value.diagnostics[key])) throw new Error(`Convention profile.diagnostics.${key} is invalid`);
  if (value.diagnostics.unsupported_claims_emitted !== 0) throw new Error("Convention profile emitted unsupported claims");
  const diagnostics = value.diagnostics as ConventionProfile["diagnostics"];
  const authority = value.authoritative_evidence as AuthoritativeEvidence[];
  const authoritativeEvidenceOmitted = authority.reduce(
    (total, item) => total + item.observed_count - item.evidence.length,
    0,
  );
  if (diagnostics.authoritative_evidence_omitted !== authoritativeEvidenceOmitted) {
    throw new Error("Convention authoritative-evidence omission diagnostics are inconsistent");
  }
  if (
    diagnostics.subsystem_evidence_omitted > 0 &&
    value.subsystem.evidence.length !== CONVENTION_LIMITS.max_evidence_per_fact
  ) throw new Error("Convention subsystem-evidence omission diagnostics require saturated retained evidence");
  const relatedEvidenceOmitted = (value.related_subsystems as ConventionProfile["related_subsystems"]).reduce(
    (total, item) => total + item.observed_count - item.evidence.length,
    0,
  );
  if (diagnostics.related_subsystem_evidence_omitted !== relatedEvidenceOmitted) {
    throw new Error("Convention related-subsystem evidence omission diagnostics are inconsistent");
  }
  for (const conflict of value.conflicts as ConventionConflict[]) {
    for (const claim of conflict.claims) {
      const matches = authority.filter((item) =>
        item.entity_id === claim.source_id &&
        item.entity_type === claim.source_type &&
        item.priority === claim.priority &&
        item.evidence.some((evidence) => canonicalKey(evidence) === canonicalKey(claim.evidence))
      );
      if (matches.length !== 1) throw new Error("Convention conflict claims must match one authoritative record and evidence citation");
    }
  }
  if (diagnostics.reusable_symbols_omitted > 0 && value.reusable_symbols.length !== CONVENTION_LIMITS.max_reusable_symbols) {
    throw new Error("Convention reusable-symbol omission diagnostics require a saturated returned array");
  }
  if (diagnostics.related_subsystems_omitted > 0 && value.related_subsystems.length !== CONVENTION_LIMITS.max_related_subsystems) {
    throw new Error("Convention related-subsystem omission diagnostics require a saturated returned array");
  }
  if (diagnostics.conflicts_omitted > 0 && value.conflicts.length !== CONVENTION_LIMITS.max_conflicts) {
    throw new Error("Convention conflict omission diagnostics require a saturated returned array");
  }
  if (
    diagnostics.reusable_relations_omitted > 0 &&
    !(value.reusable_symbols as ReusableSymbol[]).some((symbol) => symbol.relations.length === CONVENTION_LIMITS.max_reusable_relations)
  ) throw new Error("Convention relation omission diagnostics require a saturated returned array");
  const representativeCallersOmitted = (value.reusable_symbols as ReusableSymbol[]).reduce(
    (total, symbol) => total + symbol.representative_callers_observed_count - symbol.representative_callers.length,
    0,
  );
  if (diagnostics.representative_callers_omitted !== representativeCallersOmitted) {
    throw new Error("Convention representative-caller omission diagnostics are inconsistent");
  }
  const representativeTestsOmitted = (value.reusable_symbols as ReusableSymbol[]).reduce(
    (total, symbol) => total + symbol.representative_tests_observed_count - symbol.representative_tests.length,
    0,
  );
  if (diagnostics.representative_tests_omitted !== representativeTestsOmitted) {
    throw new Error("Convention representative-test omission diagnostics are inconsistent");
  }
  const copy = { ...value } as Record<string, unknown>;
  delete copy.profile_hash;
  if (hashValue(copy) !== value.profile_hash) throw new Error("Convention profile hash mismatch");
  if (Buffer.byteLength(canonicalConventionJson(value)) > CONVENTION_LIMITS.max_profile_bytes) {
    throw new Error("Convention profile exceeds the maximum persisted record size");
  }
}

export function readConventionProfile(filePath: string): ConventionProfile {
  const contents = readStableRegularText(
    filePath,
    CONVENTION_LIMITS.max_profile_bytes,
    "Convention profile",
    "Convention profile exceeds the maximum persisted record size",
  );
  const parsed: unknown = JSON.parse(contents);
  validateConventionProfile(parsed);
  return parsed;
}

function validateManifest(value: unknown): asserts value is ConventionManifest {
  assertExactKeys(value, MANIFEST_ROOT_KEYS, "Convention manifest");
  if (value.schema_version !== CONVENTION_SCHEMA_VERSION) throw new Error("Unsupported convention manifest schema version");
  if (value.generator_version !== CONVENTION_GENERATOR_VERSION) throw new Error("Unsupported convention manifest generator version");
  assertString(value.repository_id, "Convention manifest.repository_id", 100, REPOSITORY_ID_PATTERN);
  assertString(value.index_hash, "Convention manifest.index_hash", 64, SHA256_PATTERN);
  validateLimits(value.limits, "Convention manifest.limits");
  assertArray(value.profiles, "Convention manifest.profiles", CONVENTION_LIMITS.max_profile_count);
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  let previousId = "";
  for (const [index, entry] of value.profiles.entries()) {
    const label = `Convention manifest.profiles[${index}]`;
    assertExactKeys(entry, MANIFEST_ENTRY_KEYS, label);
    assertString(entry.profile_id, `${label}.profile_id`, 43, PROFILE_ID_PATTERN);
    if (entry.profile_id <= previousId) throw new Error("Convention manifest profiles must be sorted and unique");
    previousId = entry.profile_id;
    assertString(entry.relative_path, `${label}.relative_path`, CONVENTION_LIMITS.max_path_chars);
    if (entry.relative_path !== canonicalProfileRelativePath(entry.profile_id)) throw new Error(`${label}.relative_path is not canonical for its profile ID`);
    assertString(entry.repository_id, `${label}.repository_id`, 100, REPOSITORY_ID_PATTERN);
    if (entry.repository_id !== value.repository_id) throw new Error(`${label}.repository_id must match the manifest`);
    assertString(entry.language, `${label}.language`, CONVENTION_LIMITS.max_identifier_chars);
    assertString(entry.subsystem_id, `${label}.subsystem_id`, CONVENTION_LIMITS.max_identifier_chars);
    if (entry.profile_id !== deriveProfileId(entry.repository_id, entry.language, entry.subsystem_id)) {
      throw new Error(`${label}.profile_id is inconsistent with its repository and scope`);
    }
    assertString(entry.source_hash, `${label}.source_hash`, 64, SHA256_PATTERN);
    assertString(entry.profile_hash, `${label}.profile_hash`, 64, SHA256_PATTERN);
    if (seenIds.has(entry.profile_id) || seenPaths.has(entry.relative_path)) throw new Error("Convention manifest profile IDs and paths must be unique");
    seenIds.add(entry.profile_id);
    seenPaths.add(entry.relative_path);
  }
  const expectedIndexHash = hashValue((value.profiles as ConventionManifestEntry[]).map((entry) => [entry.profile_id, entry.source_hash, entry.profile_hash]));
  if (value.index_hash !== expectedIndexHash) throw new Error("Convention manifest index hash mismatch");
}

function lstatIfPresent(filePath: string): fs.Stats | null {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function assertSingleLinkRegularStats(stats: fs.Stats, label: string): void {
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
    throw new Error(`${label} must be a single-link regular file`);
  }
}

function assertSafeAbsoluteDirectory(targetDir: string, create: boolean): string {
  const target = path.resolve(targetDir);
  const parsed = path.parse(target);
  let current = parsed.root;
  const rootStats = fs.lstatSync(current);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) throw new Error("Convention state ancestry must contain only real directories");
  for (const segment of path.relative(parsed.root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stats = lstatIfPresent(current);
    if (stats === null) {
      if (!create) throw new Error("Convention state directory is missing");
      fs.mkdirSync(current, { mode: 0o700 });
      stats = fs.lstatSync(current);
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error("Convention state path contains a symlink or non-directory component");
    }
  }
  return target;
}

function normalizeStateRelativePath(value: string, label: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value.includes("\\") || value.includes("\0") ||
    path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^[A-Za-z]:/u.test(value)
  ) throw new Error(`${label} must be a canonical state-relative path`);
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`${label} must be a canonical state-relative path`);
  }
  return normalized;
}

function inspectStateEntry(
  stateRoot: string,
  relativePath: string,
  options: { expected: "file" | "directory"; allowMissingLeaf?: boolean },
): { absolute: string; stats: fs.Stats | null } {
  const root = assertSafeAbsoluteDirectory(stateRoot, false);
  const portable = normalizeStateRelativePath(relativePath, "Convention state path");
  const segments = portable.split("/");
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const stats = lstatIfPresent(current);
    const final = index === segments.length - 1;
    if (stats === null) {
      if (final && options.allowMissingLeaf) return { absolute: current, stats: null };
      throw new Error("Convention state path is missing");
    }
    if (stats.isSymbolicLink()) throw new Error("Convention state path contains a symlink component");
    if (!final && !stats.isDirectory()) throw new Error("Convention state path contains a non-directory component");
    if (final) {
      if (options.expected === "directory" && !stats.isDirectory()) throw new Error("Convention state path must be a directory");
      if (options.expected === "file") assertSingleLinkRegularStats(stats, "Convention state file");
      return { absolute: current, stats };
    }
  }
  throw new Error("Convention state path could not be inspected");
}

function ensureStateDirectory(stateRoot: string, relativePath: string): string {
  const root = assertSafeAbsoluteDirectory(stateRoot, false);
  const portable = normalizeStateRelativePath(relativePath, "Convention state directory");
  let current = root;
  for (const segment of portable.split("/")) {
    current = path.join(current, segment);
    let stats = lstatIfPresent(current);
    if (stats === null) {
      fs.mkdirSync(current, { mode: 0o700 });
      stats = fs.lstatSync(current);
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("Convention state path contains a symlink or non-directory component");
  }
  return current;
}

function sameIdentity(left: fs.Stats | null, right: fs.Stats | null): boolean {
  if (left === null || right === null) return left === right;
  return left.dev === right.dev && left.ino === right.ino;
}

function readStableRegularText(filePath: string, maxBytes: number, label: string, sizeError: string): string {
  const absolute = path.resolve(filePath);
  const parent = assertSafeAbsoluteDirectory(path.dirname(absolute), false);
  const parentBefore = fs.lstatSync(parent);
  const before = lstatIfPresent(absolute);
  if (before === null) throw new Error(`${label} state file is missing`);
  assertSingleLinkRegularStats(before, `${label} state file`);
  if (before.size > maxBytes) throw new Error(sizeError);
  let bytes: Buffer;
  try {
    const read = fs.readFileSync(absolute);
    if (!Buffer.isBuffer(read)) throw new Error("unexpected non-buffer read");
    bytes = read;
  } catch {
    throw new Error(`${label} could not be read safely`);
  }
  const checkedParent = assertSafeAbsoluteDirectory(parent, false);
  const parentAfter = fs.lstatSync(checkedParent);
  const after = lstatIfPresent(absolute);
  if (!sameIdentity(parentBefore, parentAfter) || !sameIdentity(before, after)) {
    throw new Error(`${label} state identity changed during read`);
  }
  if (after === null) throw new Error(`${label} state file disappeared during read`);
  assertSingleLinkRegularStats(after, `${label} state file`);
  if (after.size !== before.size || after.size > maxBytes || bytes.byteLength !== before.size) {
    if (after.size > maxBytes || bytes.byteLength > maxBytes) throw new Error(sizeError);
    throw new Error(`${label} state size changed during read`);
  }
  const contents = bytes.toString("utf8");
  if (Buffer.byteLength(contents) !== bytes.byteLength) {
    throw new Error(`${label} state byte length changed during read`);
  }
  return contents;
}

function atomicWrite(stateRoot: string, relativePath: string, contents: string): void {
  const portable = normalizeStateRelativePath(relativePath, "Convention state write path");
  const parentRelative = path.posix.dirname(portable);
  if (parentRelative !== ".") ensureStateDirectory(stateRoot, parentRelative);
  const parent = parentRelative === "."
    ? { absolute: assertSafeAbsoluteDirectory(stateRoot, false), stats: fs.lstatSync(path.resolve(stateRoot)) }
    : inspectStateEntry(stateRoot, parentRelative, { expected: "directory" });
  const initialDestination = inspectStateEntry(stateRoot, portable, { expected: "file", allowMissingLeaf: true });
  const temporaryRelative = `${portable}.tmp-${process.pid}-${crypto.randomBytes(8).toString("hex")}`;
  const temporary = path.join(path.resolve(stateRoot), ...temporaryRelative.split("/"));
  try {
    fs.writeFileSync(temporary, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
    const checkedParent = parentRelative === "."
      ? { stats: fs.lstatSync(path.resolve(stateRoot)) }
      : inspectStateEntry(stateRoot, parentRelative, { expected: "directory" });
    const checkedDestination = inspectStateEntry(stateRoot, portable, { expected: "file", allowMissingLeaf: true });
    const checkedTemporary = inspectStateEntry(stateRoot, temporaryRelative, { expected: "file" });
    if (!sameIdentity(parent.stats, checkedParent.stats) || !sameIdentity(initialDestination.stats, checkedDestination.stats)) {
      throw new Error("Convention state path changed during atomic write");
    }
    if (checkedTemporary.stats === null) throw new Error("Convention temporary state file disappeared");
    fs.renameSync(checkedTemporary.absolute, initialDestination.absolute);
  } finally {
    try {
      const leftover = inspectStateEntry(stateRoot, temporaryRelative, { expected: "file", allowMissingLeaf: true });
      if (leftover.stats !== null) fs.unlinkSync(leftover.absolute);
    } catch {
      // Best effort only; a concurrent mutator may have changed the path.
    }
  }
}

function readManifest(stateRoot: string): { manifest: ConventionManifest; contents: string } | null {
  const manifest = inspectStateEntry(stateRoot, "manifest.json", { expected: "file", allowMissingLeaf: true });
  if (manifest.stats === null) return null;
  const contents = readStableRegularText(
    manifest.absolute,
    CONVENTION_LIMITS.max_manifest_bytes,
    "Convention manifest",
    "Convention manifest exceeds the maximum persisted manifest size",
  );
  const parsed: unknown = JSON.parse(contents);
  try {
    validateManifest(parsed);
  } catch (error) {
    const legacyLimits = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).limits
      : undefined;
    const legacyLimitKeys = legacyLimits && typeof legacyLimits === "object" && !Array.isArray(legacyLimits)
      ? Object.keys(legacyLimits as Record<string, unknown>).sort(compareText)
      : [];
    const expectedLegacyKeys = LIMIT_KEYS.filter((key) => key !== "max_repository_control_bytes");
    const isExactLegacyLimitSet =
      legacyLimitKeys.length === expectedLegacyKeys.length &&
      legacyLimitKeys.every((key, index) => key === expectedLegacyKeys[index]) &&
      expectedLegacyKeys.every((key) => (legacyLimits as Record<string, unknown>)[key] === CONVENTION_LIMITS[key as keyof typeof CONVENTION_LIMITS]);
    if (!isExactLegacyLimitSet) throw error;
    // The only admitted legacy form is the complete current schema with the
    // one newly introduced limit restored in memory. Running the full current
    // validator here prevents unrelated schema, identity, ordering, hash, or
    // path failures from being misclassified as migration compatibility.
    const migrated = {
      ...(parsed as Record<string, unknown>),
      limits: {
        ...(legacyLimits as Record<string, unknown>),
        max_repository_control_bytes: CONVENTION_LIMITS.max_repository_control_bytes,
      },
    };
    validateManifest(migrated);
    return { manifest: migrated, contents };
  }
  return { manifest: parsed, contents };
}

function persistConventionProfilesValidatedCanonical(
  profiles: ConventionProfile[],
  options: { data: ContextData; state_dir?: string; repository_id?: string; repo_root?: string },
  canonical: CanonicalConventionCollection,
): { manifest: ConventionManifest; changed_profile_ids: string[]; unchanged_profile_ids: string[]; removed_profile_ids: string[] } {
  const requestedRepositoryId = options.repository_id ?? profiles[0]?.repository_id ?? resolveRepositoryId({ repo_root: options.repo_root });
  if (requestedRepositoryId !== undefined && !REPOSITORY_ID_PATTERN.test(requestedRepositoryId)) {
    throw new Error("Invalid repository identity for convention persistence");
  }
  if (canonical.repositoryId !== requestedRepositoryId) throw new Error("Convention canonical collection repository identity mismatch");
  const expectedProfileIds = canonical.profiles.map((profile) => profile.profile_id).sort(compareText);
  const actualProfileIds = profiles.map((profile) => profile.profile_id).sort(compareText);
  if (canonicalKey(expectedProfileIds) !== canonicalKey(actualProfileIds)) {
    throw new Error("Convention persistence requires the complete canonical indexed profile set");
  }
  const stateDir = path.resolve(options.state_dir ?? path.join(CACHE_DIR, "conventions", `v${CONVENTION_SCHEMA_VERSION}`));
  if (options.state_dir) {
    assertSafeAbsoluteDirectory(stateDir, true);
  } else {
    const repoRoot = assertSafeAbsoluteDirectory(REPO_ROOT, false);
    const relative = path.relative(repoRoot, stateDir);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("Convention state directory escapes its trusted local root");
    }
    ensureStateDirectory(repoRoot, relative.split(path.sep).join("/"));
  }
  assertSafeAbsoluteDirectory(stateDir, false);
  ensureStateDirectory(stateDir, "profiles");
  const previousRecord = readManifest(stateDir);
  const previous = previousRecord?.manifest ?? null;
  const previousById = new Map((previous?.profiles ?? []).map((entry) => [entry.profile_id, entry]));
  const sortedProfiles = [...profiles].sort((left, right) => compareText(left.profile_id, right.profile_id));
  if (new Set(sortedProfiles.map((profile) => profile.profile_id)).size !== sortedProfiles.length) {
    throw new Error("Convention profiles must have unique profile IDs");
  }
  const repositoryIds = sortUnique(sortedProfiles.map((profile) => profile.repository_id));
  if (repositoryIds.length > 1) throw new Error("Convention profiles from multiple repositories cannot share one manifest");
  if (requestedRepositoryId !== undefined && repositoryIds.length === 1 && repositoryIds[0] !== requestedRepositoryId) {
    throw new Error("Convention persistence repository identity does not match its profiles");
  }

  const entries: ConventionManifestEntry[] = sortedProfiles
    .map((profile) => ({
      profile_id: profile.profile_id,
      relative_path: canonicalProfileRelativePath(profile.profile_id),
      repository_id: profile.repository_id,
      language: profile.language,
      subsystem_id: profile.subsystem.id,
      source_hash: profile.source_hash,
      profile_hash: profile.profile_hash,
    }));
  const changedProfileIds: string[] = [];
  const unchangedProfileIds: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const profile = sortedProfiles[index];
    const destination = inspectStateEntry(stateDir, entry.relative_path, { expected: "file", allowMissingLeaf: true });
    const previousEntry = previousById.get(entry.profile_id);
    if (
      previousEntry?.profile_hash === entry.profile_hash &&
      previousEntry.source_hash === entry.source_hash &&
      destination.stats !== null
    ) {
      const persisted = readConventionProfile(destination.absolute);
      if (
        persisted.profile_hash !== profile.profile_hash ||
        persisted.profile_id !== entry.profile_id ||
        persisted.repository_id !== entry.repository_id ||
        persisted.language !== entry.language ||
        persisted.subsystem.id !== entry.subsystem_id ||
        persisted.source_hash !== entry.source_hash
      ) {
        throw new Error(`Persisted convention profile does not match its manifest: ${entry.profile_id}`);
      }
      unchangedProfileIds.push(entry.profile_id);
      continue;
    }
    const contents = canonicalConventionJson(profile);
    if (Buffer.byteLength(contents) > CONVENTION_LIMITS.max_profile_bytes) {
      throw new Error(`Convention profile exceeds persisted size limit: ${profile.profile_id}`);
    }
    atomicWrite(stateDir, entry.relative_path, contents);
    changedProfileIds.push(entry.profile_id);
  }

  const currentIds = new Set(entries.map((entry) => entry.profile_id));
  const removedProfileIds: string[] = [];
  for (const entry of previous?.profiles ?? []) {
    if (currentIds.has(entry.profile_id)) continue;
    const canonicalPath = canonicalProfileRelativePath(entry.profile_id);
    if (entry.relative_path !== canonicalPath) throw new Error("Convention manifest profile path is not canonical");
    const target = inspectStateEntry(stateDir, canonicalPath, { expected: "file", allowMissingLeaf: true });
    if (target.stats === null) continue;
    const checked = inspectStateEntry(stateDir, canonicalPath, { expected: "file" });
    if (!sameIdentity(target.stats, checked.stats)) throw new Error("Convention state path changed during stale-profile cleanup");
    fs.unlinkSync(checked.absolute);
    removedProfileIds.push(entry.profile_id);
  }

  const manifest: ConventionManifest = {
    schema_version: CONVENTION_SCHEMA_VERSION,
    generator_version: CONVENTION_GENERATOR_VERSION,
    repository_id: repositoryIds[0] ?? requestedRepositoryId ?? previous?.repository_id ?? readRepositoryId(options.repo_root ?? REPO_ROOT),
    index_hash: hashValue(entries.map((entry) => [entry.profile_id, entry.source_hash, entry.profile_hash])),
    limits: CONVENTION_LIMITS,
    profiles: entries,
  };
  validateManifest(manifest);
  const manifestContents = canonicalConventionJson(manifest);
  if (Buffer.byteLength(manifestContents) > CONVENTION_LIMITS.max_manifest_bytes) {
    throw new Error("Convention manifest exceeds the maximum persisted manifest size");
  }
  if (previousRecord === null || previousRecord.contents !== manifestContents) {
    atomicWrite(stateDir, "manifest.json", manifestContents);
  }
  return {
    manifest,
    changed_profile_ids: changedProfileIds,
    unchanged_profile_ids: unchangedProfileIds,
    removed_profile_ids: removedProfileIds.sort(compareText),
  };
}

export function persistConventionProfiles(
  profiles: ConventionProfile[],
  options: { data: ContextData; state_dir?: string; repository_id?: string; repo_root?: string },
): ReturnType<typeof persistConventionProfilesValidatedCanonical> {
  const repositoryId = options.repository_id ?? profiles[0]?.repository_id ?? resolveRepositoryId({ repo_root: options.repo_root });
  const canonical = buildCanonicalConventionCollection(options.data, repositoryId);
  validateProfilesAgainstCanonical(profiles, canonical);
  validateProfileBackingDocuments(profiles, options.data, options.repo_root ?? REPO_ROOT);
  return persistConventionProfilesValidatedCanonical(profiles, options, canonical);
}

export async function buildAndPersistConventionProfiles(
  options: { data?: ContextData; repository_id?: string; state_dir?: string; repo_root?: string; on_canonical_build?: () => void; on_validation_traversal?: (kind: ConventionValidationTraversal) => void } = {},
): Promise<ReturnType<typeof persistConventionProfiles>> {
  const data = options.data ?? await loadContextData();
  const repoRoot = options.repo_root ?? REPO_ROOT;
  const repositoryId = resolveRepositoryId({ repository_id: options.repository_id, repo_root: repoRoot });
  const canonical = buildCanonicalConventionCollection(data, repositoryId, options.on_canonical_build, options.on_validation_traversal);
  validateProfileBackingDocuments(canonical.profiles, data, repoRoot, options.on_validation_traversal);
  return persistConventionProfilesValidatedCanonical(canonical.profiles, {
    state_dir: options.state_dir,
    data,
    repository_id: repositoryId,
    repo_root: repoRoot,
  }, canonical);
}

function validateTargetFilesystemPath(
  repoRoot: string,
  repoPath: string,
  expected: "file" | "directory",
  allowInputAliases = false,
): string {
  const root = path.resolve(repoRoot);
  try {
    assertSafeAbsoluteDirectory(root, false);
  } catch {
    throw new Error("Convention repository root and its ancestors must be real directories");
  }
  const normalized = allowInputAliases
    ? normalizeRepoPathAlias(repoPath, expected === "directory")
    : normalizeRepoPath(repoPath, expected === "directory");
  const absolute = normalized === "." ? root : path.resolve(root, ...normalized.split("/"));
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) throw new Error("Convention target escapes the repository root");
  if (absolute === root) {
    if (expected !== "directory") throw new Error(`Convention target backing path has the wrong type: ${normalized}`);
    return normalized;
  }
  let current = root;
  const segments = path.relative(root, absolute).split(path.sep).filter(Boolean);
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const stats = lstatIfPresent(current);
    const final = index === segments.length - 1;
    if (stats === null) throw new Error(`Convention target backing path is missing or stale: ${normalized}`);
    if (stats.isSymbolicLink()) throw new Error(`Convention target contains a symbolic-link component: ${normalized}`);
    if (!final && !stats.isDirectory()) throw new Error(`Convention target contains a non-directory ancestor: ${normalized}`);
    if (final && expected === "file") {
      try {
        assertSingleLinkRegularStats(stats, "Convention cited backing file");
      } catch {
        throw new Error(`Convention target backing path has an unsafe file type or identity: ${normalized}`);
      }
    } else if (final && !stats.isDirectory()) {
      throw new Error(`Convention target backing path has the wrong type: ${normalized}`);
    }
  }
  return normalized;
}

function optionalUniqueEntityById<T extends { id: string }>(values: T[], entityId: string, label: string): T | undefined {
  const matches = values.filter((item) => item.id === entityId);
  if (matches.length > 1) throw new Error(`${label} has duplicate indexed records`);
  return matches[0];
}

function uniqueEntityById<T extends { id: string }>(values: T[], entityId: string, label: string): T {
  const matches = values.filter((item) => item.id === entityId);
  if (matches.length !== 1) throw new Error(`${label} must have one unique indexed backing record`);
  return matches[0];
}

function validateDocumentCitation(data: ContextData, repoRoot: string, fileId: string, expectedPath?: string): DocumentRecord {
  const document = uniqueEntityById(data.documents, fileId, "Convention cited document");
  if (!isActiveRecord(document) || document.kind !== "CODE" || !boundedIdentifier(document.id)) throw new Error("Convention cited document is stale or malformed");
  const backedPath = normalizeRepoPath(document.path);
  if (document.id !== `file:${backedPath}` || (expectedPath !== undefined && backedPath !== expectedPath)) {
    throw new Error("Convention cited document identity does not match its path");
  }
  validateTargetFilesystemPath(repoRoot, backedPath, "file");
  return document;
}

function validateChunkCitation(data: ContextData, repoRoot: string, chunkId: string, expectedPath?: string): ChunkRecord {
  const chunk = uniqueEntityById(data.chunks, chunkId, "Convention cited chunk");
  if (!safeChunk(chunk)) throw new Error("Convention cited chunk is stale or malformed");
  validateDocumentCitation(data, repoRoot, chunk.file_id, expectedPath);
  return chunk;
}

function validateRelationEndpoint(data: ContextData, repoRoot: string, entityId: string): void {
  if (entityId.startsWith("file:")) {
    validateDocumentCitation(data, repoRoot, entityId);
    return;
  }
  if (entityId.startsWith("chunk:")) {
    validateChunkCitation(data, repoRoot, entityId);
    return;
  }
  if (entityId.startsWith("module:")) {
    const module = uniqueEntityById(data.modules, entityId, "Convention cited module");
    if (!isActiveRecord(module)) throw new Error("Convention cited module is inactive or deprecated");
    const modulePath = normalizeRepoPath(module.path, true);
    if (module.id !== `module:${modulePath}`) throw new Error("Convention cited module identity does not match its path");
    validateTargetFilesystemPath(repoRoot, modulePath, "directory");
    return;
  }
  if (entityId.startsWith("project:")) {
    const project = uniqueEntityById(data.projects, entityId, "Convention cited project");
    if (!isActiveRecord(project)) throw new Error("Convention cited project is inactive or deprecated");
    const projectPath = normalizeRepoPath(project.path, true);
    if (project.id !== `project:${projectPath}`) throw new Error("Convention cited project identity does not match its path");
    validateTargetFilesystemPath(repoRoot, projectPath, "directory");
    return;
  }
  if (/^adr[.:]/u.test(entityId)) {
    const adr = uniqueEntityById(data.adrs, entityId, "Convention cited ADR");
    if (!isAuthoritativePolicy(adr)) throw new Error("Convention cited ADR is not eligible authority");
    validateTargetFilesystemPath(repoRoot, normalizeRepoPath(adr.path), "file");
    return;
  }
  if (/^rule[.:]/u.test(entityId)) {
    const rule = uniqueEntityById(data.rules, entityId, "Convention cited rule");
    if (!isAuthoritativePolicy(rule)) throw new Error("Convention cited rule is not eligible authority");
    return;
  }
  throw new Error("Convention relation endpoint shape is unsupported");
}

function validateExactRelationAndEndpoints(
  data: ContextData,
  repoRoot: string,
  from: string,
  to: string,
  relation: string,
): void {
  const matches = data.relations.filter((item) => item.from === from && item.to === to && item.relation === relation);
  if (matches.length !== 1) throw new Error("Convention relation citation must match one unique indexed graph record");
  validateRelationEndpoint(data, repoRoot, from);
  validateRelationEndpoint(data, repoRoot, to);
}

function validateRelationCitation(data: ContextData, repoRoot: string, evidence: ConventionEvidence): void {
  if (!evidence.relation) return;
  const relation = evidence.relation;
  if (evidence.entity_id !== relation.from && evidence.entity_id !== relation.to) {
    throw new Error("Convention relation citation must match one unique indexed graph record");
  }
  validateExactRelationAndEndpoints(data, repoRoot, relation.from, relation.to, relation.type);
}

function validateEvidenceCitation(data: ContextData, repoRoot: string, evidence: ConventionEvidence): void {
  if (evidence.entity_id.startsWith("chunk:")) {
    const chunk = validateChunkCitation(data, repoRoot, evidence.entity_id, evidence.path);
    if (evidence.start_line !== undefined && (evidence.start_line !== chunk.start_line || evidence.end_line !== chunk.end_line)) {
      throw new Error("Convention chunk citation line identity is stale or inconsistent");
    }
  } else if (evidence.entity_id.startsWith("file:")) {
    validateDocumentCitation(data, repoRoot, evidence.entity_id, evidence.path);
  } else if (/^adr[.:]/u.test(evidence.entity_id)) {
    const adr = uniqueEntityById(data.adrs, evidence.entity_id, "Convention cited ADR");
    if (!isAuthoritativePolicy(adr)) throw new Error("Convention cited ADR is not eligible authority");
    const adrPath = normalizeRepoPath(adr.path);
    if (evidence.path !== undefined && evidence.path !== adrPath) throw new Error("Convention ADR citation identity does not match its path");
    validateTargetFilesystemPath(repoRoot, adrPath, "file");
  } else if (/^rule[.:]/u.test(evidence.entity_id)) {
    const rule = uniqueEntityById(data.rules, evidence.entity_id, "Convention cited rule");
    if (!isAuthoritativePolicy(rule)) throw new Error("Convention cited rule is not eligible authority");
    if (evidence.path !== undefined) throw new Error("Convention rule citation must not invent a path");
  }
  validateRelationCitation(data, repoRoot, evidence);
}

function validateProfileBackingDocuments(
  profiles: ConventionProfile[],
  data: ContextData,
  repoRoot: string,
  onValidationTraversal?: (kind: ConventionValidationTraversal) => void,
): void {
  onValidationTraversal?.("backing");
  for (const profile of profiles) {
    for (const fileId of profile.file_ids) {
      const backedPath = fileId.slice("file:".length);
      validateDocumentCitation(data, repoRoot, fileId, backedPath);
    }
    if (profile.subsystem.type === "module") {
      const module = uniqueEntityById(data.modules, profile.subsystem.id, "Convention profile subsystem");
      if (!isActiveRecord(module) || normalizeRepoPath(module.path, true) !== profile.subsystem.path) throw new Error("Convention subsystem identity and path are inconsistent");
      validateRelationEndpoint(data, repoRoot, module.id);
    } else if (profile.subsystem.type === "project") {
      const project = uniqueEntityById(data.projects, profile.subsystem.id, "Convention profile subsystem");
      if (!isActiveRecord(project) || normalizeRepoPath(project.path, true) !== profile.subsystem.path) throw new Error("Convention subsystem identity and path are inconsistent");
      validateRelationEndpoint(data, repoRoot, project.id);
    } else {
      if (profile.subsystem.id !== `path:${profile.subsystem.path}`) throw new Error("Convention path subsystem identity is inconsistent");
      validateTargetFilesystemPath(repoRoot, profile.subsystem.path, "directory");
    }
    for (const subsystemEvidence of profile.subsystem.evidence) {
      const document = validateDocumentCitation(data, repoRoot, subsystemEvidence.entity_id);
      if (
        (profile.subsystem.type === "path" && dirnameRepoPath(document.path) !== profile.subsystem.path) ||
        (profile.subsystem.type !== "path" && data.relations.filter((relation) =>
          relation.from === profile.subsystem.id && relation.to === document.id && relation.relation === subsystemEvidence.relation
        ).length !== 1)
      ) throw new Error("Convention subsystem evidence does not match one unique indexed scope relation");
    }
    for (const authority of profile.authoritative_evidence) {
      if (authority.entity_type === "Rule") {
        const rule = uniqueEntityById(data.rules, authority.entity_id, "Convention authoritative citation");
        if (!isAuthoritativePolicy(rule)) throw new Error("Convention authoritative rule is inactive, deprecated, or not source of truth");
      } else {
        const adr = uniqueEntityById(data.adrs, authority.entity_id, "Convention authoritative citation");
        if (!isAuthoritativePolicy(adr)) throw new Error("Convention authoritative ADR is inactive, deprecated, or not source of truth");
      }
      for (const evidence of authority.evidence) validateEvidenceCitation(data, repoRoot, evidence);
    }
    for (const fact of profile.structural_facts) {
      for (const evidence of fact.evidence) validateEvidenceCitation(data, repoRoot, evidence);
    }
    for (const symbol of profile.reusable_symbols) {
      validateChunkCitation(data, repoRoot, symbol.entity_id, symbol.path);
      for (const evidence of [...symbol.evidence, ...symbol.representative_callers, ...symbol.representative_tests]) {
        validateEvidenceCitation(data, repoRoot, evidence);
      }
      for (const relation of symbol.relations) {
        const from = relation.direction === "incoming" ? relation.entity_id : symbol.entity_id;
        const to = relation.direction === "incoming" ? symbol.entity_id : relation.entity_id;
        validateExactRelationAndEndpoints(data, repoRoot, from, to, relation.relation);
      }
    }
    for (const related of profile.related_subsystems) {
      for (const evidence of related.evidence) validateEvidenceCitation(data, repoRoot, evidence);
    }
    for (const conflict of profile.conflicts) {
      for (const claim of conflict.claims) validateEvidenceCitation(data, repoRoot, claim.evidence);
    }
  }
}

export function validateConventionProfilesWithContext(
  profiles: ConventionProfile[],
  data: ContextData,
  options: { repository_id?: string; repo_root?: string } = {},
): void {
  const repoRoot = options.repo_root ?? REPO_ROOT;
  const repositoryId = options.repository_id ?? profiles[0]?.repository_id ?? resolveRepositoryId(options);
  const canonical = buildCanonicalConventionCollection(data, repositoryId);
  validateProfilesAgainstCanonical(profiles, canonical);
  validateProfileBackingDocuments(profiles, data, repoRoot);
}

function resolveTargetProfiles(
  data: ContextData,
  profiles: ConventionProfile[],
  targetInput: string,
  repoRoot: string,
): { target: ToolPayload; profiles: ConventionProfile[] } {
  const validateDocument = (document: DocumentRecord): string => {
    if (!isActiveRecord(document) || document.kind !== "CODE" || !boundedIdentifier(document.id)) throw new Error("Convention target is stale or malformed");
    const canonicalPath = normalizeRepoPath(document.path);
    if (document.id !== `file:${canonicalPath}`) throw new Error("Convention target identity does not match its canonical path");
    return validateTargetFilesystemPath(repoRoot, document.path, "file");
  };
  const chunk = optionalUniqueEntityById(data.chunks, targetInput, "Convention target");
  if (chunk) {
    if (!safeChunk(chunk)) throw new Error("Convention target is stale or malformed");
    const backingDocument = optionalUniqueEntityById(data.documents, chunk.file_id, "Convention target backing file");
    if (!backingDocument) throw new Error("Convention target backing file is missing from the index");
    const backingPath = validateDocument(backingDocument);
    const matched = profiles.filter((profile) => profile.language === chunk.language.toLowerCase() && profile.file_ids.includes(chunk.file_id));
    if (matched.length === 0) throw new Error("No convention profile exists for the indexed entity");
    return {
      target: { input: targetInput, entity_id: chunk.id, entity_type: "Chunk", path: backingPath },
      profiles: matched,
    };
  }
  const document = optionalUniqueEntityById(data.documents, targetInput, "Convention target");
  if (document) {
    const backingPath = validateDocument(document);
    const matched = profiles.filter((profile) => profile.file_ids.includes(document.id));
    if (matched.length === 0) throw new Error("No convention profile exists for the indexed entity");
    return { target: { input: targetInput, entity_id: document.id, entity_type: "File", path: backingPath }, profiles: matched };
  }
  const module = optionalUniqueEntityById(data.modules, targetInput, "Convention target");
  if (module) {
    if (!isActiveRecord(module)) throw new Error("Convention target is inactive or deprecated");
    const backingPath = validateTargetFilesystemPath(repoRoot, module.path, "directory");
    if (module.id !== `module:${backingPath}`) throw new Error("Convention target identity does not match its canonical path");
    const matched = profiles.filter((profile) => profile.subsystem.id === module.id);
    if (matched.length === 0) throw new Error("No convention profile exists for the indexed entity");
    return { target: { input: targetInput, entity_id: module.id, entity_type: "Module", path: backingPath }, profiles: matched };
  }
  const project = optionalUniqueEntityById(data.projects, targetInput, "Convention target");
  if (project) {
    if (!isActiveRecord(project)) throw new Error("Convention target is inactive or deprecated");
    const backingPath = validateTargetFilesystemPath(repoRoot, project.path, "directory");
    if (project.id !== `project:${backingPath}`) throw new Error("Convention target identity does not match its canonical path");
    const matched = profiles.filter((profile) => profile.subsystem.id === project.id);
    if (matched.length === 0) throw new Error("No convention profile exists for the indexed entity");
    return { target: { input: targetInput, entity_id: project.id, entity_type: "Project", path: backingPath }, profiles: matched };
  }
  if (/^(?:rule|adr)[.:]/u.test(targetInput)) {
    throw new Error("Convention target is not code-backed");
  }

  const targetPath = normalizeRepoPathAlias(targetInput);
  validateTargetFilesystemPath(repoRoot, targetPath, "file");
  const targetDocument = sortAndDeduplicate(data.documents)
    .filter(isActiveRecord)
    .find((item) => normalizeRepoPath(item.path) === targetPath);
  if (!targetDocument) throw new Error("Convention target was not found in indexed context");
  validateDocument(targetDocument);
  const matched = profiles.filter((profile) => profile.file_ids.includes(targetDocument.id));
  if (matched.length === 0) throw new Error("No convention profile exists for the indexed target");
  return { target: { input: targetInput, entity_id: targetDocument.id, entity_type: "File", path: targetPath }, profiles: matched };
}

export function validateConventionTargetInput(value: unknown): string {
  const max = typeof value === "string" && /^(?:(?:file|chunk|module|project):|(?:rule|adr)[.:])/u.test(value)
    ? CONVENTION_LIMITS.max_identifier_chars
    : CONVENTION_LIMITS.max_path_chars;
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > max ||
    value !== value.trim() || !isSafeVisibleText(value)
  ) throw new Error("Convention target must be a nonempty bounded path or entity identifier");
  return value;
}

export function sanitizeConventionPublicInput(value: unknown): ConventionsParams {
  const target = value && typeof value === "object" ? (value as Record<string, unknown>).target : undefined;
  try {
    return { target: validateConventionTargetInput(target) };
  } catch {
    return { target: "[rejected]" };
  }
}

export function sanitizeConventionPublicError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw.replace(/[\u0000-\u001f\u007f]+/gu, " ").trim();
  const publicMessages = new Set([
    "Convention target must be a nonempty bounded path or entity identifier",
    "Convention target exceeds the version-1 input limit",
    "Invalid repository-relative convention target",
    "Convention target is not code-backed",
    "Convention inspection public response exceeds the version-1 aggregate byte limit",
  ]);
  return publicMessages.has(normalized) ? normalized : "Convention inspection failed safely";
}

function serializeConventionPublicEnvelope(value: unknown): string {
  assertConventionPublicVisibleTree(value);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > CONVENTION_LIMITS.max_response_bytes) {
    throw new Error("Convention inspection public response exceeds the version-1 aggregate byte limit");
  }
  return serialized;
}

function assertConventionPublicVisibleTree(value: unknown, seen = new Set<object>()): void {
  if (typeof value === "string") {
    if (!isSafeVisibleText(value)) throw new Error("Convention public output contains unsafe visible text");
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertConventionPublicVisibleTree(item, seen);
    return;
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    assertConventionPublicVisibleTree(item, seen);
  }
}

export function serializeConventionPublicResponse(input: ConventionsParams, data: ToolPayload): string {
  const { warning: _untrustedWarning, ...safeData } = data;
  return serializeConventionPublicEnvelope({
    ok: true,
    command: "conventions",
    input,
    context_source: data.context_source,
    data: safeData,
  });
}

export function serializeConventionPublicError(input: unknown, error: unknown): string {
  return serializeConventionPublicEnvelope({
    ok: false,
    command: "conventions",
    input: sanitizeConventionPublicInput(input),
    error: {
      code: "INVALID_ARGS",
      message: sanitizeConventionPublicError(error),
    },
  });
}

export function formatConventionPublicText(data: ToolPayload): string {
  const profiles = Array.isArray(data.profiles) ? data.profiles : [];
  assertConventionPublicVisibleTree({ profiles });
  const lines = [`conventions: profiles=${profiles.length}`];
  for (const value of profiles) {
    if (!value || typeof value !== "object") continue;
    const profile = value as Record<string, unknown>;
    const subsystem = profile.subsystem && typeof profile.subsystem === "object"
      ? profile.subsystem as Record<string, unknown>
      : {};
    const symbols = Array.isArray(profile.reusable_symbols) ? profile.reusable_symbols.length : 0;
    lines.push(`- ${String(profile.language ?? "unknown")} ${String(subsystem.id ?? "")} reusable_symbols=${symbols}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function runConventions(
  parsed: ConventionsParams,
  options: { data?: ContextData; repository_id?: string; state_dir?: string; repo_root?: string; persist?: boolean; on_canonical_build?: () => void; on_validation_traversal?: (kind: ConventionValidationTraversal) => void } = {},
): Promise<ToolPayload> {
  const target = validateConventionTargetInput(parsed?.target);
  const data = options.data ?? await loadContextData();
  const repoRoot = options.repo_root ?? REPO_ROOT;
  const repositoryId = resolveRepositoryId({ repository_id: options.repository_id, repo_root: repoRoot });
  const input = { target };
  const canonical = buildCanonicalConventionCollection(data, repositoryId, options.on_canonical_build, options.on_validation_traversal);
  const profiles = canonical.profiles;
  const resolved = resolveTargetProfiles(data, profiles, target, repoRoot);
  const selectedProfiles = [...resolved.profiles].sort((left, right) => compareText(left.language, right.language) || compareText(left.profile_id, right.profile_id));
  const previewPersistence = options.persist === false ? null : {
    manifest_schema_version: CONVENTION_SCHEMA_VERSION,
    index_hash: "0".repeat(64),
    profile_count: profiles.length,
  };
  const preview = {
    schema_version: CONVENTION_SCHEMA_VERSION,
    generator_version: CONVENTION_GENERATOR_VERSION,
    target: resolved.target,
    limits: CONVENTION_LIMITS,
    profile_count: selectedProfiles.length,
    profiles: selectedProfiles,
    persistence: previewPersistence,
    context_source: data.source,
  };
  serializeConventionPublicResponse(input, preview);
  validateProfileBackingDocuments(
    options.persist === false ? selectedProfiles : profiles,
    data,
    repoRoot,
    options.on_validation_traversal,
  );
  const persistence = options.persist === false ? null : persistConventionProfilesValidatedCanonical(profiles, {
    state_dir: options.state_dir,
    data,
    repository_id: repositoryId,
    repo_root: repoRoot,
  }, canonical);
  const result = {
    ...preview,
    persistence: persistence ? {
      manifest_schema_version: persistence.manifest.schema_version,
      index_hash: persistence.manifest.index_hash,
      profile_count: persistence.manifest.profiles.length,
    } : null,
  };
  serializeConventionPublicResponse(input, result);
  return result;
}
