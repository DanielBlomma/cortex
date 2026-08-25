import crypto from "node:crypto";
import { loadContextData } from "./graph.js";
import { REPO_ROOT } from "./paths.js";
import {
  CONVENTION_LIMITS,
  runConventions,
} from "./conventions.js";
import type { ConventionConflict, ConventionProfile } from "./conventions.js";
import type { ContextData, GuidanceParams } from "./types.js";

type ConventionClaim = ConventionConflict["claims"][number];
type ConventionEvidence = ConventionProfile["authoritative_evidence"][number]["evidence"][number];
type ReusableSymbol = ConventionProfile["reusable_symbols"][number];
type StructuralFact = ConventionProfile["structural_facts"][number];

export const GUIDANCE_SCHEMA_VERSION = 1;
export const GUIDANCE_GENERATOR_VERSION = "repo-guidance-v1";
export const GUIDANCE_TASK_GRAMMAR_VERSION = "unicode-letters-numbers-underscore-v1";
export const GUIDANCE_STOP_WORD_SET_VERSION = "repo-guidance-stop-words-v1";
export const GUIDANCE_LIMITS = Object.freeze({
  max_task_scalars: 4_096,
  max_task_utf8_bytes: 16_384,
  max_response_bytes: 65_536,
  max_active_governing_rules: 8,
  max_reusable_symbols: 12,
  max_concrete_examples: 6,
  max_conflicts: 10,
  max_evidence_per_item: CONVENTION_LIMITS.max_evidence_per_fact,
  max_task_terms: 32,
});

const STOP_WORDS = new Set(["a", "an", "and", "as", "at", "be", "before", "by", "do", "for", "from", "in", "into", "is", "it", "of", "on", "or", "the", "this", "to", "with"]);
const UNSAFE_VISIBLE_TEXT_PATTERN = /[\p{Cc}\p{Zl}\p{Zp}\p{Bidi_Control}]/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const PROFILE_ID_PATTERN = /^convention:[a-f0-9]{32}$/u;
const RELATION_TYPES = new Set(["CONSTRAINS", "IMPLEMENTS", "SUPERSEDES", "DEFINES", "CALLS", "IMPORTS", "CALLS_SQL", "USES_CONFIG_KEY", "USES_RESOURCE_KEY", "USES_SETTING_KEY", "PART_OF", "CONTAINS", "CONTAINS_MODULE", "EXPORTS", "INCLUDES_FILE", "REFERENCES_PROJECT", "USES_RESOURCE", "USES_SETTING", "USES_CONFIG", "TRANSFORMS_CONFIG"]);
const ENTITY_TYPES = ["File", "Chunk", "Module", "Project", "Rule", "ADR"] as const;
type GuidanceEntityType = typeof ENTITY_TYPES[number];

type Relevance = {
  reason: "task_lexical_match" | "governing_applicable" | "closest_profile_fallback";
  matched_terms: string[];
  score: number;
  score_components: { exact_term_matches: number; prefix_term_matches: number; matched_fields: number; governing_applicable: number };
};
type CountedSection<T> = { observed_count: number; omitted_count: number; items: T[] };
type ProfileSelection = { profile_id: string; language: string; subsystem_id: string; subsystem_path: string; evidence_tier: "closest_profile" | "repository_fallback" };
type EvidenceFields = { evidence_observed_count: number; evidence_omitted: number; evidence: ConventionEvidence[] };
type GuidanceRule = EvidenceFields & { entity_id: string; entity_type: "Rule" | "ADR"; title: string; priority: number; scope: "repository" | "subsystem"; relevance: Relevance };
type GuidanceSymbol = EvidenceFields & { entity_id: string; profile_id: string; name: string; kind: string; signature: string; role: string; path: string; relevance: Relevance };
type GuidanceExample = EvidenceFields & { entity_id: string; entity_type: GuidanceEntityType; profile_id: string; reusable_symbol_id: string | null; kind: "profile_fact" | "reusable_symbol" | "representative_caller" | "representative_test"; label: string; relevance: Relevance };
type GuidanceConflict = { key: string; governing_priority: number; claim_observed_count: number; claims_omitted: number; claims: Array<EvidenceFields & { source_id: string; source_type: "Rule" | "ADR"; priority: number; value: string }> };

export type GuidanceData = {
  schema_version: 1;
  generator_version: string;
  guidance_hash: string;
  task_hash: string;
  target: { entity_id: string; entity_type: GuidanceEntityType; path: string };
  limits: typeof GUIDANCE_LIMITS;
  task_projection: { grammar_version: string; stop_word_set_version: string; normalized_term_observed_count: number; normalized_terms_omitted: number; matched_terms: string[] };
  profile_selection: ProfileSelection[];
  active_governing_rules: CountedSection<GuidanceRule>;
  reusable_symbols: CountedSection<GuidanceSymbol>;
  concrete_examples: CountedSection<GuidanceExample>;
  conflicts: CountedSection<GuidanceConflict>;
  fallback_mode: "task_match" | "closest_profile_fallback";
  context_source: "cache" | "ryu";
};

function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort(compareText)) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) output[key] = canonicalize(item);
    }
    return output;
  }
  return value;
}
export function canonicalGuidanceJson(value: unknown): string { return `${JSON.stringify(canonicalize(value), null, 2)}\n`; }
function canonicalKey(value: unknown): string { return JSON.stringify(canonicalize(value)); }
function hashBytes(value: string): string { return crypto.createHash("sha256").update(value, "utf8").digest("hex"); }
function guidanceHash(value: Omit<GuidanceData, "guidance_hash">): string { return hashBytes(canonicalGuidanceJson(value)); }
function isSafeVisibleText(value: string): boolean { return !UNSAFE_VISIBLE_TEXT_PATTERN.test(value); }

function unicodeScalarCount(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error("Guidance task contains invalid Unicode scalar data");
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new Error("Guidance task contains invalid Unicode scalar data");
    count += 1;
  }
  return count;
}

export function validateGuidanceTaskInput(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim() || !isSafeVisibleText(value)) throw new Error("Guidance task must be nonempty safe visible text");
  if (unicodeScalarCount(value) > GUIDANCE_LIMITS.max_task_scalars || Buffer.byteLength(value, "utf8") > GUIDANCE_LIMITS.max_task_utf8_bytes) throw new Error("Guidance task exceeds the version-1 input limit");
  return value;
}
export function hashGuidanceTask(value: string): string { return hashBytes(validateGuidanceTaskInput(value)); }

export type GuidanceTargetSyntax = {
  value: string;
  kind: "path" | "file" | "chunk" | "module" | "project" | "rule" | "adr";
  path?: string;
  start_line?: number;
  end_line?: number;
};

const GUIDANCE_POLICY_ID_PATTERN = /^(rule|adr)([.:])([A-Za-z0-9](?:[A-Za-z0-9_-]|\.(?=[A-Za-z0-9]))*)$/u;

function normalizeGuidancePath(value: string, allowRoot = false): string {
  if (
    typeof value !== "string" || value.length === 0 || value !== value.trim() ||
    value.length > CONVENTION_LIMITS.max_path_chars || !isSafeVisibleText(value) ||
    value.includes("\\") || value.includes(":") || value.startsWith("/") ||
    /^[A-Za-z]:\//u.test(value) || value.endsWith("/") || value.includes("//") ||
    value.split("/").some((segment) => segment === "" || segment === ".." || segment === ".")
  ) {
    if (allowRoot && value === ".") return value;
    throw new Error("Invalid repository-relative convention target");
  }
  return value;
}

export function classifyGuidanceTargetSyntax(value: unknown): GuidanceTargetSyntax {
  if (
    typeof value !== "string" || value.length === 0 || value !== value.trim() ||
    value.length > CONVENTION_LIMITS.max_identifier_chars || !isSafeVisibleText(value)
  ) throw new Error("Convention target must be a nonempty bounded path or entity identifier");
  const policy = GUIDANCE_POLICY_ID_PATTERN.exec(value);
  if (policy) return { value, kind: policy[1] as "rule" | "adr" };
  if (/^(?:rule|adr)[.:]/u.test(value)) throw new Error("Invalid convention entity target");
  for (const kind of ["file", "module", "project"] as const) {
    const prefix = `${kind}:`;
    if (!value.startsWith(prefix)) continue;
    const path = normalizeGuidancePath(value.slice(prefix.length), kind !== "file");
    if (value !== `${prefix}${path}`) throw new Error("Invalid convention entity target");
    return { value, kind, path };
  }
  if (value.startsWith("chunk:")) {
    const body = value.slice("chunk:".length);
    const rangeSeparator = body.lastIndexOf(":");
    const nameSeparator = rangeSeparator < 0 ? -1 : body.lastIndexOf(":", rangeSeparator - 1);
    if (nameSeparator <= 0 || rangeSeparator <= nameSeparator + 1) throw new Error("Invalid convention entity target");
    const path = normalizeGuidancePath(body.slice(0, nameSeparator));
    const name = body.slice(nameSeparator + 1, rangeSeparator);
    const range = /^([1-9][0-9]*)-([1-9][0-9]*)$/u.exec(body.slice(rangeSeparator + 1));
    if (!range || name.length > CONVENTION_LIMITS.max_name_chars || !isSafeVisibleText(name) || /[/:\\]/u.test(name)) throw new Error("Invalid convention entity target");
    const startLine = Number(range[1]);
    const endLine = Number(range[2]);
    if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || endLine < startLine) throw new Error("Invalid convention entity target");
    if (value !== `chunk:${path}:${name}:${startLine}-${endLine}`) throw new Error("Invalid convention entity target");
    return { value, kind: "chunk", path, start_line: startLine, end_line: endLine };
  }
  if (/^[A-Za-z][A-Za-z0-9_-]*:/u.test(value)) throw new Error("Invalid convention entity target");
  return { value, kind: "path", path: normalizeGuidancePath(value) };
}

export function validateGuidanceTargetSyntax(value: unknown): string {
  return classifyGuidanceTargetSyntax(value).value;
}

function tokenizeTask(task: string): { observed: number; omitted: number; retained: string[] } {
  const terms = [...new Set(task.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])].filter((term) => !STOP_WORDS.has(term)).sort(compareText);
  return { observed: terms.length, omitted: Math.max(0, terms.length - GUIDANCE_LIMITS.max_task_terms), retained: terms.slice(0, GUIDANCE_LIMITS.max_task_terms) };
}
function fieldTokens(value: string): string[] { return [...new Set(value.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])].sort(compareText); }
function relevanceFor(terms: string[], fields: string[], governing = false): Relevance {
  const exact = new Set<string>();
  const prefix = new Set<string>();
  let matchedFields = 0;
  for (const field of fields) {
    const tokens = fieldTokens(field);
    let matched = false;
    for (const term of terms) {
      if (tokens.includes(term)) { exact.add(term); matched = true; }
      else if (term.length >= 3 && tokens.some((token) => token.startsWith(term) || term.startsWith(token))) { prefix.add(term); matched = true; }
    }
    if (matched) matchedFields += 1;
  }
  for (const term of exact) prefix.delete(term);
  const matchedTerms = [...new Set([...exact, ...prefix])].sort(compareText);
  const components = { exact_term_matches: exact.size, prefix_term_matches: prefix.size, matched_fields: matchedFields, governing_applicable: governing ? 1 : 0 };
  return {
    reason: matchedTerms.length > 0 ? "task_lexical_match" : governing ? "governing_applicable" : "closest_profile_fallback",
    matched_terms: matchedTerms,
    score: exact.size * 100 + prefix.size * 25 + matchedFields * 10 + (governing ? 1_000 : 0),
    score_components: components,
  };
}

function ruleRelevanceFields(item: Pick<GuidanceRule, "entity_id" | "title">): string[] {
  return [item.title, item.entity_id];
}
function symbolRelevanceFields(item: Pick<GuidanceSymbol, "name" | "kind" | "role" | "signature" | "path">): string[] {
  return [item.name, item.kind, item.role, item.signature, item.path];
}
function exampleRelevanceFields(item: Pick<GuidanceExample, "entity_id" | "kind" | "label" | "reusable_symbol_id">): string[] {
  return [item.label, item.entity_id, item.kind, item.reusable_symbol_id ?? ""];
}

function compareEvidence(left: ConventionEvidence, right: ConventionEvidence): number {
  return compareText(left.entity_id, right.entity_id) || compareText(left.path ?? "", right.path ?? "") || (left.start_line ?? 0) - (right.start_line ?? 0) || (left.end_line ?? 0) - (right.end_line ?? 0) || compareText(canonicalKey(left.relation ?? null), canonicalKey(right.relation ?? null));
}
function retainEvidence(values: ConventionEvidence[], observedCount: number): EvidenceFields {
  const seen = new Set<string>();
  const canonical = [...values].sort(compareEvidence).filter((item) => { const key = canonicalKey(item); if (seen.has(key)) return false; seen.add(key); return true; });
  const firstByRelation = new Map<string, ConventionEvidence>();
  for (const evidence of canonical) if (!firstByRelation.has(evidence.relation?.type ?? "")) firstByRelation.set(evidence.relation?.type ?? "", evidence);
  const retained = [...firstByRelation.values()].sort(compareEvidence).slice(0, GUIDANCE_LIMITS.max_evidence_per_item);
  const retainedKeys = new Set(retained.map(canonicalKey));
  for (const evidence of canonical) {
    if (retained.length >= GUIDANCE_LIMITS.max_evidence_per_item) break;
    if (!retainedKeys.has(canonicalKey(evidence))) { retained.push(evidence); retainedKeys.add(canonicalKey(evidence)); }
  }
  retained.sort(compareEvidence);
  const observed = Math.max(observedCount, canonical.length);
  return { evidence_observed_count: observed, evidence_omitted: observed - retained.length, evidence: retained };
}
function counted<T>(items: T[], cap: number): CountedSection<T> { return { observed_count: items.length, omitted_count: Math.max(0, items.length - cap), items: items.slice(0, cap) }; }
function deduplicateBy<T>(items: T[], key: (item: T) => string): T[] { const seen = new Set<string>(); return items.filter((item) => { const id = key(item); if (seen.has(id)) return false; seen.add(id); return true; }); }
function entityTypeForId(entityId: string): GuidanceEntityType {
  const kind = classifyGuidanceTargetSyntax(entityId).kind;
  const value = `${kind.slice(0, 1).toUpperCase()}${kind.slice(1)}` as GuidanceEntityType;
  if (!ENTITY_TYPES.includes(value)) throw new Error("Guidance evidence has an unsupported entity type");
  return value;
}

function evidenceForSymbol(symbol: ReusableSymbol, data: ContextData): ConventionEvidence[] {
  const identity = symbol.evidence[0];
  const accepted = new Set(symbol.relations.map((relation) => canonicalKey({
    from: relation.direction === "incoming" ? relation.entity_id : symbol.entity_id,
    to: relation.direction === "incoming" ? symbol.entity_id : relation.entity_id,
    type: relation.relation,
  })));
  const relations = data.relations
    .filter((relation) => accepted.has(canonicalKey({ from: relation.from, to: relation.to, type: relation.relation })))
    .map((relation): ConventionEvidence => ({
      entity_id: symbol.entity_id,
      ...(identity?.path ? { path: identity.path } : {}),
      ...(identity?.start_line ? { start_line: identity.start_line, end_line: identity.end_line } : {}),
      relation: { from: relation.from, to: relation.to, type: relation.relation },
    }));
  return [...symbol.evidence, ...relations];
}

function callerEvidenceForSymbol(citation: ConventionEvidence, symbol: ReusableSymbol, data: ContextData): ConventionEvidence[] {
  const relations = data.relations
    .filter((relation) => relation.from === citation.entity_id && relation.to === symbol.entity_id && ["CALLS", "IMPORTS"].includes(relation.relation))
    .map((relation): ConventionEvidence => ({ ...citation, relation: { from: relation.from, to: relation.to, type: relation.relation } }));
  if (relations.length === 0) throw new Error("Guidance representative example lacks accepted caller-to-symbol provenance");
  return relations;
}

function buildRules(profiles: ConventionProfile[], terms: string[]): GuidanceRule[] {
  const rows = profiles.flatMap((profile) => profile.authoritative_evidence.map((authority): GuidanceRule => {
    const item = { entity_id: authority.entity_id, title: authority.title };
    return {
      ...item, entity_type: authority.entity_type, priority: authority.priority, scope: authority.scope,
      relevance: relevanceFor(terms, ruleRelevanceFields(item), true), ...retainEvidence(authority.evidence, authority.observed_count),
    };
  }));
  return deduplicateBy(rows.sort((a, b) => b.priority - a.priority || compareText(a.entity_type, b.entity_type) || compareText(a.entity_id, b.entity_id)), (item) => item.entity_id);
}
function buildSymbols(profiles: ConventionProfile[], terms: string[], data: ContextData): GuidanceSymbol[] {
  const rows = profiles.flatMap((profile) => profile.reusable_symbols.map((symbol): GuidanceSymbol => {
    const evidence = evidenceForSymbol(symbol, data);
    const item = {
      entity_id: symbol.entity_id, profile_id: profile.profile_id, name: symbol.name, kind: symbol.kind, signature: symbol.signature, role: symbol.role, path: symbol.path,
    };
    return { ...item, relevance: relevanceFor(terms, symbolRelevanceFields(item)), ...retainEvidence(evidence, evidence.length) };
  }));
  const canonical = deduplicateBy(rows.sort((a, b) => b.relevance.score - a.relevance.score || compareText(a.profile_id, b.profile_id) || compareText(a.entity_id, b.entity_id)), (item) => item.entity_id);
  const matching = canonical.filter((item) => item.relevance.matched_terms.length > 0);
  return matching.length > 0 ? matching : canonical;
}
function exampleFromFact(profile: ConventionProfile, fact: StructuralFact, terms: string[]): GuidanceExample | null {
  if (fact.evidence.length === 0) return null;
  const item = { entity_id: fact.evidence[0].entity_id, reusable_symbol_id: null, kind: "profile_fact" as const, label: fact.statement };
  return { ...item, entity_type: entityTypeForId(item.entity_id), profile_id: profile.profile_id, relevance: relevanceFor(terms, exampleRelevanceFields(item)), ...retainEvidence(fact.evidence, fact.observed_count) };
}
function examplesFromSymbol(profile: ConventionProfile, symbol: ReusableSymbol, terms: string[], data: ContextData): GuidanceExample[] {
  const rows: GuidanceExample[] = [];
  const symbolEvidence = evidenceForSymbol(symbol, data);
  if (symbolEvidence.length > 0) {
    const item = { entity_id: symbol.entity_id, reusable_symbol_id: symbol.entity_id, kind: "reusable_symbol" as const, label: symbol.name };
    rows.push({ ...item, entity_type: "Chunk", profile_id: profile.profile_id, relevance: relevanceFor(terms, exampleRelevanceFields(item)), ...retainEvidence(symbolEvidence, symbolEvidence.length) });
  }
  for (const [kind, values] of [["representative_caller", symbol.representative_callers], ["representative_test", symbol.representative_tests]] as const) {
    for (const evidence of values) {
      const acceptedEvidence = callerEvidenceForSymbol(evidence, symbol, data);
      const item = { entity_id: evidence.entity_id, reusable_symbol_id: symbol.entity_id, kind, label: evidence.entity_id };
      rows.push({ ...item, entity_type: entityTypeForId(evidence.entity_id), profile_id: profile.profile_id, relevance: relevanceFor(terms, exampleRelevanceFields(item)), ...retainEvidence(acceptedEvidence, acceptedEvidence.length) });
    }
  }
  return rows;
}
function buildExamples(profiles: ConventionProfile[], terms: string[], data: ContextData): GuidanceExample[] {
  const rows = profiles.flatMap((profile) => [...profile.structural_facts.map((fact) => exampleFromFact(profile, fact, terms)).filter((item): item is GuidanceExample => item !== null), ...profile.reusable_symbols.flatMap((symbol) => examplesFromSymbol(profile, symbol, terms, data))]);
  const canonical = deduplicateBy(rows.sort((a, b) => b.relevance.score - a.relevance.score || compareText(a.kind, b.kind) || compareText(a.profile_id, b.profile_id) || compareText(a.entity_id, b.entity_id)), (item) => `${item.kind}\u0000${item.entity_id}`);
  const matching = canonical.filter((item) => item.relevance.matched_terms.length > 0);
  return matching.length > 0 ? matching : canonical;
}
function retainConflictClaims(claims: ConventionClaim[]): ConventionClaim[] {
  const canonical = [...claims].sort((a, b) => b.priority - a.priority || compareText(a.value, b.value) || compareText(a.source_id, b.source_id));
  const retained: ConventionClaim[] = [];
  const values = new Set<string>();
  for (const claim of canonical) { if (!values.has(claim.value)) { retained.push(claim); values.add(claim.value); } if (retained.length === GUIDANCE_LIMITS.max_evidence_per_item) break; }
  const ids = new Set(retained.map((claim) => `${claim.source_id}\u0000${claim.value}`));
  for (const claim of canonical) { if (retained.length === GUIDANCE_LIMITS.max_evidence_per_item) break; const id = `${claim.source_id}\u0000${claim.value}`; if (!ids.has(id)) { retained.push(claim); ids.add(id); } }
  return retained.sort((a, b) => b.priority - a.priority || compareText(a.value, b.value) || compareText(a.source_id, b.source_id));
}
function buildConflicts(profiles: ConventionProfile[]): GuidanceConflict[] {
  const rows = profiles.flatMap((profile) => profile.conflicts.map((conflict): GuidanceConflict => {
    const claims = retainConflictClaims(conflict.claims);
    return { key: conflict.key, governing_priority: conflict.governing_priority, claim_observed_count: conflict.claims.length, claims_omitted: conflict.claims.length - claims.length,
      claims: claims.map((claim) => {
        const authority = profile.authoritative_evidence.find((item) => item.entity_id === claim.source_id && item.entity_type === claim.source_type);
        if (!authority) throw new Error("Guidance conflict claim lacks accepted authoritative evidence");
        return { source_id: claim.source_id, source_type: claim.source_type, priority: claim.priority, value: claim.value, ...retainEvidence(authority.evidence, authority.observed_count) };
      }) };
  }));
  return deduplicateBy(rows.sort((a, b) => b.governing_priority - a.governing_priority || compareText(a.key, b.key) || compareText(canonicalKey(a.claims), canonicalKey(b.claims))), (item) => `${item.key}\u0000${canonicalKey(item.claims)}`);
}

function selectedProfiles(raw: unknown): ConventionProfile[] { if (!Array.isArray(raw)) throw new Error("Guidance profile projection is unavailable"); return raw as ConventionProfile[]; }
function profileTier(profile: ConventionProfile): ProfileSelection["evidence_tier"] { return profile.subsystem.type === "path" && profile.subsystem.path === "." ? "repository_fallback" : "closest_profile"; }
function matchedTermsFrom(data: Omit<GuidanceData, "guidance_hash">): string[] {
  const terms = new Set<string>();
  for (const section of [data.active_governing_rules, data.reusable_symbols, data.concrete_examples]) for (const item of section.items) for (const term of item.relevance.matched_terms) terms.add(term);
  return [...terms].sort(compareText);
}
function assertSafeVisibleTree(value: unknown, seen = new Set<object>()): void {
  if (typeof value === "string") { if (!isSafeVisibleText(value)) throw new Error("Guidance public output contains unsafe visible text"); unicodeScalarCount(value); return; }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const item of Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)) assertSafeVisibleTree(item, seen);
}
function assertExactKeys(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value as Record<string, unknown>).sort(compareText);
  const expected = [...keys].sort(compareText);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label} has unknown or missing schema keys`);
}
function assertBoundedString(value: unknown, label: string, max: number, allowEmpty = false): asserts value is string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || !isSafeVisibleText(value) || unicodeScalarCount(value) > max || Buffer.byteLength(value, "utf8") > max * 4) throw new Error(`${label} is invalid`);
}
function assertSafeInteger(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): asserts value is number { if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`${label} is invalid`); }
function assertCanonicalPath(value: unknown, label: string, allowRoot = false): asserts value is string {
  if (allowRoot && value === ".") return;
  assertBoundedString(value, label, CONVENTION_LIMITS.max_path_chars);
  if (classifyGuidanceTargetSyntax(value).kind !== "path") throw new Error(`${label} is not canonical`);
}
function assertSortedUniqueStrings(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length > GUIDANCE_LIMITS.max_task_terms) throw new Error(`${label} is invalid`);
  value.forEach((item, index) => assertBoundedString(item, `${label}[${index}]`, GUIDANCE_LIMITS.max_task_scalars));
  if (new Set(value).size !== value.length || [...value].sort(compareText).some((item, index) => item !== value[index])) throw new Error(`${label} is not canonical`);
}
function validateEvidence(value: unknown, label: string): asserts value is ConventionEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const row = value as Record<string, unknown>;
  const allowed = ["end_line", "entity_id", "path", "relation", "start_line"];
  if (Object.keys(row).some((key) => !allowed.includes(key)) || !Object.hasOwn(row, "entity_id")) throw new Error(`${label} has unknown or missing schema keys`);
  assertBoundedString(row.entity_id, `${label}.entity_id`, CONVENTION_LIMITS.max_identifier_chars);
  const syntax = classifyGuidanceTargetSyntax(row.entity_id);
  if (row.path !== undefined) assertCanonicalPath(row.path, `${label}.path`);
  const hasStart = row.start_line !== undefined;
  const hasEnd = row.end_line !== undefined;
  if (hasStart !== hasEnd) throw new Error(`${label} line bounds are invalid`);
  if (hasStart) {
    assertSafeInteger(row.start_line, `${label}.start_line`, 1); assertSafeInteger(row.end_line, `${label}.end_line`, Number(row.start_line));
    if (syntax.kind !== "chunk" || syntax.start_line !== row.start_line || syntax.end_line !== row.end_line || syntax.path !== row.path) throw new Error(`${label} line identity is inconsistent`);
  }
  if (row.relation !== undefined) {
    assertExactKeys(row.relation, ["from", "to", "type"], `${label}.relation`);
    assertBoundedString(row.relation.from, `${label}.relation.from`, CONVENTION_LIMITS.max_identifier_chars); assertBoundedString(row.relation.to, `${label}.relation.to`, CONVENTION_LIMITS.max_identifier_chars);
    classifyGuidanceTargetSyntax(row.relation.from); classifyGuidanceTargetSyntax(row.relation.to);
    if (typeof row.relation.type !== "string" || !RELATION_TYPES.has(row.relation.type) || (row.entity_id !== row.relation.from && row.entity_id !== row.relation.to)) throw new Error(`${label}.relation is invalid`);
  }
}
function validateEvidenceFields(value: Record<string, unknown>, label: string): void {
  assertSafeInteger(value.evidence_observed_count, `${label}.evidence_observed_count`); assertSafeInteger(value.evidence_omitted, `${label}.evidence_omitted`);
  if (!Array.isArray(value.evidence) || value.evidence.length > GUIDANCE_LIMITS.max_evidence_per_item) throw new Error(`${label}.evidence exceeds its cap`);
  value.evidence.forEach((item, index) => validateEvidence(item, `${label}.evidence[${index}]`));
  const evidence = value.evidence as ConventionEvidence[];
  if (new Set(evidence.map(canonicalKey)).size !== evidence.length) throw new Error(`${label}.evidence contains duplicates`);
  for (let index = 1; index < evidence.length; index += 1) if (compareEvidence(evidence[index - 1], evidence[index]) >= 0) throw new Error(`${label}.evidence is not canonical`);
  if (value.evidence_observed_count - evidence.length !== value.evidence_omitted || evidence.length !== Math.min(Number(value.evidence_observed_count), GUIDANCE_LIMITS.max_evidence_per_item)) throw new Error(`${label}.evidence counts are inconsistent`);
}
function assertCountedSection(value: unknown, cap: number, label: string): asserts value is CountedSection<unknown> {
  assertExactKeys(value, ["items", "observed_count", "omitted_count"], label);
  if (!Array.isArray(value.items) || value.items.length > cap) throw new Error(`${label}.items exceeds its cap`);
  assertSafeInteger(value.observed_count, `${label}.observed_count`); assertSafeInteger(value.omitted_count, `${label}.omitted_count`);
  if (value.observed_count - value.items.length !== value.omitted_count || value.items.length !== Math.min(Number(value.observed_count), cap)) throw new Error(`${label} has inconsistent counts`);
}
function assertRelevance(value: unknown, label: string, governing: boolean, taskTerms: Set<string>): void {
  assertExactKeys(value, ["matched_terms", "reason", "score", "score_components"], label); assertSortedUniqueStrings(value.matched_terms, `${label}.matched_terms`);
  const matched = value.matched_terms as string[];
  if (matched.some((term) => !taskTerms.has(term))) throw new Error(`${label}.matched_terms lacks task provenance`);
  assertExactKeys(value.score_components, ["exact_term_matches", "governing_applicable", "matched_fields", "prefix_term_matches"], `${label}.score_components`);
  const c = value.score_components;
  assertSafeInteger(c.exact_term_matches, `${label}.exact`, 0, 32); assertSafeInteger(c.prefix_term_matches, `${label}.prefix`, 0, 32); assertSafeInteger(c.matched_fields, `${label}.fields`, 0, 5); assertSafeInteger(c.governing_applicable, `${label}.governing`, governing ? 1 : 0, governing ? 1 : 0);
  if (Number(c.exact_term_matches) + Number(c.prefix_term_matches) !== matched.length || ((matched.length === 0) !== (Number(c.matched_fields) === 0))) throw new Error(`${label} provenance is inconsistent`);
  const score = Number(c.exact_term_matches) * 100 + Number(c.prefix_term_matches) * 25 + Number(c.matched_fields) * 10 + Number(c.governing_applicable) * 1000;
  if (!Number.isSafeInteger(value.score) || value.score !== score) throw new Error(`${label}.score is invalid`);
  const reason = matched.length ? "task_lexical_match" : governing ? "governing_applicable" : "closest_profile_fallback";
  if (value.reason !== reason) throw new Error(`${label}.reason is invalid`);
}
function assertCanonicalItems<T>(items: T[], compare: (a: T, b: T) => number, key: (item: T) => string, label: string): void {
  if (new Set(items.map(key)).size !== items.length) throw new Error(`${label} contains duplicate items`);
  for (let index = 1; index < items.length; index += 1) if (compare(items[index - 1], items[index]) >= 0) throw new Error(`${label} is not canonically ordered`);
}

export function validateGuidanceData(value: unknown): asserts value is GuidanceData {
  assertExactKeys(value, ["active_governing_rules", "concrete_examples", "conflicts", "context_source", "fallback_mode", "generator_version", "guidance_hash", "limits", "profile_selection", "reusable_symbols", "schema_version", "target", "task_hash", "task_projection"], "Guidance data");
  if (value.schema_version !== 1 || value.generator_version !== GUIDANCE_GENERATOR_VERSION || typeof value.guidance_hash !== "string" || !SHA256_PATTERN.test(value.guidance_hash) || typeof value.task_hash !== "string" || !SHA256_PATTERN.test(value.task_hash)) throw new Error("Guidance data has invalid version or hashes");
  assertExactKeys(value.limits, Object.keys(GUIDANCE_LIMITS), "Guidance data.limits"); for (const [key, expected] of Object.entries(GUIDANCE_LIMITS)) if (value.limits[key] !== expected) throw new Error(`Guidance data.limits.${key} is invalid`);
  assertExactKeys(value.target, ["entity_id", "entity_type", "path"], "Guidance data.target"); assertBoundedString(value.target.entity_id, "Guidance data.target.entity_id", 1000); assertCanonicalPath(value.target.path, "Guidance data.target.path");
  if (!ENTITY_TYPES.includes(value.target.entity_type as GuidanceEntityType) || entityTypeForId(String(value.target.entity_id)) !== value.target.entity_type || classifyGuidanceTargetSyntax(value.target.entity_id).path !== value.target.path) throw new Error("Guidance data.target identity is invalid");
  assertExactKeys(value.task_projection, ["grammar_version", "matched_terms", "normalized_term_observed_count", "normalized_terms_omitted", "stop_word_set_version"], "Guidance data.task_projection");
  if (value.task_projection.grammar_version !== GUIDANCE_TASK_GRAMMAR_VERSION || value.task_projection.stop_word_set_version !== GUIDANCE_STOP_WORD_SET_VERSION) throw new Error("Guidance data task projection version is invalid");
  assertSafeInteger(value.task_projection.normalized_term_observed_count, "Guidance data.task_projection.observed", 0, GUIDANCE_LIMITS.max_task_scalars); assertSafeInteger(value.task_projection.normalized_terms_omitted, "Guidance data.task_projection.omitted", 0, GUIDANCE_LIMITS.max_task_scalars);
  if (value.task_projection.normalized_terms_omitted !== Math.max(0, value.task_projection.normalized_term_observed_count - 32)) throw new Error("Guidance data task counts are invalid");
  assertSortedUniqueStrings(value.task_projection.matched_terms, "Guidance data.task_projection.matched_terms"); const taskTerms = new Set(value.task_projection.matched_terms as string[]);
  if (taskTerms.size > Math.min(Number(value.task_projection.normalized_term_observed_count), GUIDANCE_LIMITS.max_task_terms)) throw new Error("Guidance data matched terms exceed observed retained task terms");
  if (!Array.isArray(value.profile_selection) || value.profile_selection.length > 256) throw new Error("Guidance data.profile_selection is invalid");
  for (const [index, profile] of value.profile_selection.entries()) {
    const label = `Guidance data.profile_selection[${index}]`; assertExactKeys(profile, ["evidence_tier", "language", "profile_id", "subsystem_id", "subsystem_path"], label);
    if (typeof profile.profile_id !== "string" || !PROFILE_ID_PATTERN.test(profile.profile_id)) throw new Error(`${label}.profile_id is invalid`); assertBoundedString(profile.language, `${label}.language`, 1000); assertBoundedString(profile.subsystem_id, `${label}.subsystem_id`, 1000); assertCanonicalPath(profile.subsystem_path, `${label}.subsystem_path`, true);
    if (!["closest_profile", "repository_fallback"].includes(String(profile.evidence_tier)) || (profile.evidence_tier === "repository_fallback" && (profile.subsystem_path !== "." || profile.subsystem_id !== "path:."))) throw new Error(`${label}.evidence_tier is invalid`);
  }
  assertCountedSection(value.active_governing_rules, 8, "Guidance data.active_governing_rules"); assertCountedSection(value.reusable_symbols, 12, "Guidance data.reusable_symbols"); assertCountedSection(value.concrete_examples, 6, "Guidance data.concrete_examples"); assertCountedSection(value.conflicts, 10, "Guidance data.conflicts");
  const profileIds = new Set((value.profile_selection as ProfileSelection[]).map((item) => item.profile_id));
  for (const [index, item] of value.active_governing_rules.items.entries()) {
    const label = `Guidance data.active_governing_rules.items[${index}]`; assertExactKeys(item, ["entity_id", "entity_type", "evidence", "evidence_observed_count", "evidence_omitted", "priority", "relevance", "scope", "title"], label);
    assertBoundedString(item.entity_id, `${label}.entity_id`, 1000); assertBoundedString(item.title, `${label}.title`, 1000); assertSafeInteger(item.priority, `${label}.priority`, 0, 1000);
    if (!["Rule", "ADR"].includes(String(item.entity_type)) || entityTypeForId(String(item.entity_id)) !== item.entity_type || !["repository", "subsystem"].includes(String(item.scope))) throw new Error(`${label} identity is invalid`);
    validateEvidenceFields(item, label); if ((item.evidence as ConventionEvidence[]).some((e) => e.entity_id !== item.entity_id)) throw new Error(`${label}.evidence identity is invalid`); assertRelevance(item.relevance, `${label}.relevance`, true, taskTerms);
  }
  for (const [index, item] of value.reusable_symbols.items.entries()) {
    const label = `Guidance data.reusable_symbols.items[${index}]`; assertExactKeys(item, ["entity_id", "evidence", "evidence_observed_count", "evidence_omitted", "kind", "name", "path", "profile_id", "relevance", "role", "signature"], label);
    assertBoundedString(item.entity_id, `${label}.entity_id`, 1000); assertCanonicalPath(item.path, `${label}.path`); assertBoundedString(item.profile_id, `${label}.profile_id`, 43); assertBoundedString(item.name, `${label}.name`, 256); assertBoundedString(item.kind, `${label}.kind`, 1000); assertBoundedString(item.signature, `${label}.signature`, 2000, true); assertBoundedString(item.role, `${label}.role`, 1000);
    if (entityTypeForId(String(item.entity_id)) !== "Chunk" || classifyGuidanceTargetSyntax(item.entity_id).path !== item.path || !profileIds.has(String(item.profile_id))) throw new Error(`${label} identity is invalid`);
    validateEvidenceFields(item, label); if (!(item.evidence as ConventionEvidence[]).some((e) => e.entity_id === item.entity_id && e.path === item.path)) throw new Error(`${label}.evidence identity is invalid`); assertRelevance(item.relevance, `${label}.relevance`, false, taskTerms);
  }
  for (const [index, item] of value.concrete_examples.items.entries()) {
    const label = `Guidance data.concrete_examples.items[${index}]`; assertExactKeys(item, ["entity_id", "entity_type", "evidence", "evidence_observed_count", "evidence_omitted", "kind", "label", "profile_id", "relevance", "reusable_symbol_id"], label);
    assertBoundedString(item.entity_id, `${label}.entity_id`, 1000); assertBoundedString(item.label, `${label}.label`, 4096); assertBoundedString(item.profile_id, `${label}.profile_id`, 43);
    if (!ENTITY_TYPES.includes(item.entity_type as GuidanceEntityType) || entityTypeForId(String(item.entity_id)) !== item.entity_type || !["profile_fact", "reusable_symbol", "representative_caller", "representative_test"].includes(String(item.kind)) || !profileIds.has(String(item.profile_id))) throw new Error(`${label} identity is invalid`);
    if (item.kind === "profile_fact") {
      if (item.reusable_symbol_id !== null) throw new Error(`${label}.reusable_symbol_id is invalid`);
    } else {
      assertBoundedString(item.reusable_symbol_id, `${label}.reusable_symbol_id`, 1000);
      if (entityTypeForId(String(item.reusable_symbol_id)) !== "Chunk") throw new Error(`${label}.reusable_symbol_id is invalid`);
      if (item.kind === "reusable_symbol" && item.reusable_symbol_id !== item.entity_id) throw new Error(`${label}.reusable_symbol_id is invalid`);
    }
    validateEvidenceFields(item, label); if (!(item.evidence as ConventionEvidence[]).some((e) => e.entity_id === item.entity_id)) throw new Error(`${label}.evidence identity is invalid`); assertRelevance(item.relevance, `${label}.relevance`, false, taskTerms);
    if (["representative_caller", "representative_test"].includes(String(item.kind)) && !(item.evidence as ConventionEvidence[]).some((e) => e.relation && ["CALLS", "IMPORTS"].includes(e.relation.type) && e.relation.from === item.entity_id && e.relation.to === item.reusable_symbol_id)) throw new Error(`${label}.evidence lacks caller-to-symbol graph provenance`);
  }
  for (const [index, conflict] of value.conflicts.items.entries()) {
    const label = `Guidance data.conflicts.items[${index}]`; assertExactKeys(conflict, ["claim_observed_count", "claims", "claims_omitted", "governing_priority", "key"], label); assertBoundedString(conflict.key, `${label}.key`, 100); assertSafeInteger(conflict.governing_priority, `${label}.priority`, 0, 1000); assertSafeInteger(conflict.claim_observed_count, `${label}.observed`, 2); assertSafeInteger(conflict.claims_omitted, `${label}.omitted`);
    if (!Array.isArray(conflict.claims) || conflict.claims.length > 10 || conflict.claim_observed_count - conflict.claims.length !== conflict.claims_omitted || conflict.claims.length !== Math.min(conflict.claim_observed_count, 10)) throw new Error(`${label} counts are invalid`);
    for (const [claimIndex, claim] of conflict.claims.entries()) {
      const cl = `${label}.claims[${claimIndex}]`; assertExactKeys(claim, ["evidence", "evidence_observed_count", "evidence_omitted", "priority", "source_id", "source_type", "value"], cl); assertBoundedString(claim.source_id, `${cl}.source_id`, 1000); assertBoundedString(claim.value, `${cl}.value`, 200); assertSafeInteger(claim.priority, `${cl}.priority`, 0, 1000);
      if (!["Rule", "ADR"].includes(String(claim.source_type)) || entityTypeForId(String(claim.source_id)) !== claim.source_type) throw new Error(`${cl} identity is invalid`); validateEvidenceFields(claim, cl); if ((claim.evidence as ConventionEvidence[]).some((e) => e.entity_id !== claim.source_id)) throw new Error(`${cl}.evidence identity is invalid`);
    }
    const claims = conflict.claims as GuidanceConflict["claims"]; assertCanonicalItems(claims, (a, b) => b.priority - a.priority || compareText(a.value, b.value) || compareText(a.source_id, b.source_id), (item) => `${item.source_id}\u0000${item.value}`, `${label}.claims`);
    if (new Set(claims.map((claim) => claim.value)).size < 2 || conflict.governing_priority !== Math.max(...claims.map((claim) => claim.priority))) throw new Error(`${label} contradiction is invalid`);
  }
  assertCanonicalItems(value.profile_selection as ProfileSelection[], (a, b) => compareText(a.language, b.language) || compareText(a.profile_id, b.profile_id), (item) => item.profile_id, "Guidance data.profile_selection");
  assertCanonicalItems(value.active_governing_rules.items as GuidanceRule[], (a, b) => b.priority - a.priority || compareText(a.entity_type, b.entity_type) || compareText(a.entity_id, b.entity_id), (item) => item.entity_id, "Guidance rules");
  assertCanonicalItems(value.reusable_symbols.items as GuidanceSymbol[], (a, b) => b.relevance.score - a.relevance.score || compareText(a.profile_id, b.profile_id) || compareText(a.entity_id, b.entity_id), (item) => item.entity_id, "Guidance symbols");
  assertCanonicalItems(value.concrete_examples.items as GuidanceExample[], (a, b) => b.relevance.score - a.relevance.score || compareText(a.kind, b.kind) || compareText(a.profile_id, b.profile_id) || compareText(a.entity_id, b.entity_id), (item) => `${item.kind}\u0000${item.entity_id}`, "Guidance examples");
  assertCanonicalItems(value.conflicts.items as GuidanceConflict[], (a, b) => b.governing_priority - a.governing_priority || compareText(a.key, b.key) || compareText(canonicalKey(a.claims), canonicalKey(b.claims)), (item) => `${item.key}\u0000${canonicalKey(item.claims)}`, "Guidance conflicts");
  const union = matchedTermsFrom(value as Omit<GuidanceData, "guidance_hash">); if (union.length !== taskTerms.size || union.some((term) => !taskTerms.has(term))) throw new Error("Guidance matched terms are inconsistent");
  const matched = [...value.reusable_symbols.items as GuidanceSymbol[], ...value.concrete_examples.items as GuidanceExample[]].some((item) => item.relevance.matched_terms.length > 0); if (value.fallback_mode !== (matched ? "task_match" : "closest_profile_fallback")) throw new Error("Guidance fallback is invalid");
  if (!["cache", "ryu"].includes(String(value.context_source))) throw new Error("Guidance context source is invalid");
  const copy = structuredClone(value) as Record<string, unknown>; delete copy.guidance_hash; if (guidanceHash(copy as Omit<GuidanceData, "guidance_hash">) !== value.guidance_hash) throw new Error("Guidance data hash mismatch"); assertSafeVisibleTree(value);
}

function serializeGuidanceEnvelope(value: unknown): string {
  assertSafeVisibleTree(value);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > GUIDANCE_LIMITS.max_response_bytes) throw new Error("Guidance public response exceeds the version-1 byte limit");
  return serialized;
}
export function sanitizeGuidancePublicInput(value: unknown): { target: string; task_hash: string } {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  let target = "[rejected]"; let taskHash = "[rejected]";
  try { target = validateGuidanceTargetSyntax(row.target); } catch { /* rejected */ }
  try { taskHash = hashGuidanceTask(String(row.task ?? "")); } catch { /* rejected */ }
  return { target, task_hash: taskHash };
}
export function sanitizeGuidancePublicError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const allowed = new Set(["Guidance requires exactly one target and one --task value", "Guidance arguments contain an unknown or repeated flag", "Guidance argument flag is missing its value", "Guidance task must be nonempty safe visible text", "Guidance task contains invalid Unicode scalar data", "Guidance task exceeds the version-1 input limit", "Convention target must be a nonempty bounded path or entity identifier", "Invalid repository-relative convention target", "Invalid convention entity target", "Guidance public response exceeds the version-1 byte limit"]);
  return allowed.has(raw) ? raw : "Guidance failed safely";
}

export function validateGuidanceDataAgainstTask(value: unknown, rawTask: unknown): asserts value is GuidanceData {
  validateGuidanceData(value);
  const task = validateGuidanceTaskInput(rawTask);
  const data = value as GuidanceData;
  const terms = tokenizeTask(task);
  if (data.task_hash !== hashBytes(task)) throw new Error("Guidance task hash does not match the raw task");
  if (
    data.task_projection.normalized_term_observed_count !== terms.observed ||
    data.task_projection.normalized_terms_omitted !== terms.omitted
  ) throw new Error("Guidance task projection does not match the raw task");
  for (const item of data.active_governing_rules.items) {
    if (canonicalKey(item.relevance) !== canonicalKey(relevanceFor(terms.retained, ruleRelevanceFields(item), true))) {
      throw new Error("Guidance rule relevance does not match the raw task and public fields");
    }
  }
  for (const item of data.reusable_symbols.items) {
    if (canonicalKey(item.relevance) !== canonicalKey(relevanceFor(terms.retained, symbolRelevanceFields(item)))) {
      throw new Error("Guidance symbol relevance does not match the raw task and public fields");
    }
  }
  for (const item of data.concrete_examples.items) {
    if (canonicalKey(item.relevance) !== canonicalKey(relevanceFor(terms.retained, exampleRelevanceFields(item)))) {
      throw new Error("Guidance example relevance does not match the raw task and public fields");
    }
  }
  const matchedTerms = matchedTermsFrom(data);
  if (canonicalKey(data.task_projection.matched_terms) !== canonicalKey(matchedTerms)) {
    throw new Error("Guidance matched terms do not match recomputed item relevance");
  }
  const fallback = data.reusable_symbols.items.some((item) => item.relevance.matched_terms.length > 0) || data.concrete_examples.items.some((item) => item.relevance.matched_terms.length > 0)
    ? "task_match"
    : "closest_profile_fallback";
  if (data.fallback_mode !== fallback) throw new Error("Guidance fallback does not match recomputed item relevance");
}

export function serializeGuidancePublicResponse(input: GuidanceParams, data: GuidanceData): string {
  validateGuidanceDataAgainstTask(data, input?.task);
  const safeInput = sanitizeGuidancePublicInput(input);
  if (safeInput.target !== input.target || safeInput.task_hash !== data.task_hash) throw new Error("Guidance public input does not match validated data");
  return serializeGuidanceEnvelope({ ok: true, command: "guidance", schema_version: 1, generator_version: GUIDANCE_GENERATOR_VERSION, input: safeInput, context_source: data.context_source, data });
}
export function serializeGuidancePublicError(input: unknown, error: unknown): string {
  return serializeGuidanceEnvelope({ ok: false, command: "guidance", schema_version: 1, generator_version: GUIDANCE_GENERATOR_VERSION, input: sanitizeGuidancePublicInput(input), error: { code: "INVALID_ARGS", message: sanitizeGuidancePublicError(error) } });
}
export function formatGuidancePublicText(data: GuidanceData): string {
  validateGuidanceData(data);
  const lines = [
    `guidance: schema=1 target=${data.target.entity_id} task_hash=${data.task_hash}`,
    `profiles=${data.profile_selection.length} fallback=${data.fallback_mode}`,
    `rules=${data.active_governing_rules.items.length}/${data.active_governing_rules.observed_count} symbols=${data.reusable_symbols.items.length}/${data.reusable_symbols.observed_count} examples=${data.concrete_examples.items.length}/${data.concrete_examples.observed_count} conflicts=${data.conflicts.items.length}/${data.conflicts.observed_count}`,
  ];
  for (const rule of data.active_governing_rules.items) lines.push(`rule ${rule.entity_id} priority=${rule.priority} evidence=${rule.evidence.length}/${rule.evidence_observed_count}`);
  for (const symbol of data.reusable_symbols.items) lines.push(`symbol ${symbol.entity_id} role=${symbol.role} evidence=${symbol.evidence.length}/${symbol.evidence_observed_count}`);
  for (const conflict of data.conflicts.items) lines.push(`conflict ${conflict.key} claims=${conflict.claims.length}/${conflict.claim_observed_count}`);
  assertSafeVisibleTree(lines);
  const text = `${lines.join("\n")}\n`;
  if (Buffer.byteLength(text, "utf8") > GUIDANCE_LIMITS.max_response_bytes) throw new Error("Guidance public response exceeds the version-1 byte limit");
  return text;
}

type GuidanceOptions = { data?: ContextData; repository_id?: string; repo_root?: string };
async function buildCanonicalGuidance(parsed: GuidanceParams, options: GuidanceOptions): Promise<{ result: GuidanceData; data: ContextData; repoRoot: string }> {
  const target = validateGuidanceTargetSyntax(parsed?.target);
  const task = validateGuidanceTaskInput(parsed?.task);
  const terms = tokenizeTask(task);
  const data = options.data ?? await loadContextData();
  const repoRoot = options.repo_root ?? REPO_ROOT;
  const projection = await runConventions({ target }, { data, repository_id: options.repository_id, repo_root: repoRoot, persist: false });
  const profiles = selectedProfiles(projection.profiles);
  const resolvedTarget = projection.target as Record<string, unknown>;
  const profileSelection = profiles.map((profile): ProfileSelection => ({ profile_id: profile.profile_id, language: profile.language, subsystem_id: profile.subsystem.id, subsystem_path: profile.subsystem.path, evidence_tier: profileTier(profile) })).sort((a, b) => compareText(a.language, b.language) || compareText(a.profile_id, b.profile_id));
  const rules = counted(buildRules(profiles, terms.retained), 8);
  const symbols = counted(buildSymbols(profiles, terms.retained, data), 12);
  const examples = counted(buildExamples(profiles, terms.retained, data), 6);
  const conflicts = counted(buildConflicts(profiles), 10);
  const fallbackMode = symbols.items.some((item) => item.relevance.matched_terms.length) || examples.items.some((item) => item.relevance.matched_terms.length) ? "task_match" as const : "closest_profile_fallback" as const;
  const withoutHash: Omit<GuidanceData, "guidance_hash"> = {
    schema_version: 1, generator_version: GUIDANCE_GENERATOR_VERSION, task_hash: hashBytes(task),
    target: { entity_id: String(resolvedTarget.entity_id ?? ""), entity_type: String(resolvedTarget.entity_type ?? "") as GuidanceEntityType, path: String(resolvedTarget.path ?? "") },
    limits: GUIDANCE_LIMITS,
    task_projection: { grammar_version: GUIDANCE_TASK_GRAMMAR_VERSION, stop_word_set_version: GUIDANCE_STOP_WORD_SET_VERSION, normalized_term_observed_count: terms.observed, normalized_terms_omitted: terms.omitted, matched_terms: [] },
    profile_selection: profileSelection, active_governing_rules: rules, reusable_symbols: symbols, concrete_examples: examples, conflicts, fallback_mode: fallbackMode, context_source: data.source,
  };
  withoutHash.task_projection.matched_terms = matchedTermsFrom(withoutHash);
  const result: GuidanceData = { ...withoutHash, guidance_hash: guidanceHash(withoutHash) };
  validateGuidanceData(result);
  return { result, data, repoRoot };
}
export async function validateGuidanceDataWithContext(value: unknown, parsed: GuidanceParams, options: GuidanceOptions = {}): Promise<void> {
  validateGuidanceDataAgainstTask(value, parsed?.task);
  const canonical = await buildCanonicalGuidance(parsed, options);
  if (canonicalGuidanceJson(value) !== canonicalGuidanceJson(canonical.result)) throw new Error("Guidance data does not match canonical current context");
}
export async function runGuidance(parsed: GuidanceParams, options: GuidanceOptions = {}): Promise<GuidanceData> {
  const canonical = await buildCanonicalGuidance(parsed, options);
  await validateGuidanceDataWithContext(canonical.result, parsed, { ...options, data: canonical.data, repo_root: canonical.repoRoot });
  serializeGuidancePublicResponse(parsed, canonical.result);
  return canonical.result;
}
