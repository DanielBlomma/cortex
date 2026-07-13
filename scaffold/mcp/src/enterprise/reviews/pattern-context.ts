import { loadContextData } from "../../graph.js";
import { normalizeRepoPath, runLocalPatternEvidence } from "../../patternEvidence.js";
import { compareText } from "../../searchResults.js";
import type { ContextData, PatternEvidenceParams, ToolPayload } from "../../types.js";

type PatternEvidenceRunner = (input: PatternEvidenceParams) => Promise<ToolPayload>;

// Loads context data lazily on first use and shares it across all targets in
// one review, instead of re-reading the index from disk per target. Load
// failures surface per target, matching the per-file error handling below.
export function createLocalPatternRunner(
  loadData: () => Promise<ContextData> = loadContextData,
): PatternEvidenceRunner {
  let shared: Promise<ContextData> | undefined;
  return async (params) => {
    shared ??= loadData();
    return runLocalPatternEvidence(params, { data: await shared });
  };
}

export const PATTERN_REVIEW_QUESTION =
  "Does this change follow the established pattern for this kind of problem in this repository, or does it introduce a second way to solve something that already has a local convention?";

const PATTERN_EVIDENCE_ORDER = ["same_file", "same_module", "same_feature_area", "repo_wide"] as const;

// Canonicalizes like the pattern evidence engine, then rejects paths that
// must never appear in review citations (absolute, drive-letter, or
// parent-escaping paths).
function normalizeReviewPath(value: string): string | null {
  const normalized = normalizeRepoPath(value);
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").includes("..")
  ) {
    return null;
  }
  return normalized;
}

function safeIdentifier(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 1000) return null;
  if (/(?:^|:)\/|[A-Za-z]:[\\/]|(?:^|[:/])\.\.(?:[:/]|$)/u.test(value)) return null;
  return value;
}

function emptyTiers(): ToolPayload[] {
  return PATTERN_EVIDENCE_ORDER.map((name) => ({ name, evidence: [] }));
}

function sanitizeEvidenceTiers(value: unknown): { tiers: ToolPayload[]; dropped: number } {
  const inputTiers = Array.isArray(value) ? value : [];
  let dropped = 0;
  const tiers = PATTERN_EVIDENCE_ORDER.map((name) => {
    const source = inputTiers.find((candidate) =>
      candidate && typeof candidate === "object" && (candidate as Record<string, unknown>).name === name
    ) as Record<string, unknown> | undefined;
    const rawEvidence = Array.isArray(source?.evidence) ? source.evidence : [];
    const evidence: ToolPayload[] = [];
    for (const candidate of rawEvidence) {
      if (!candidate || typeof candidate !== "object") {
        dropped += 1;
        continue;
      }
      const row = candidate as Record<string, unknown>;
      const citationPath = typeof row.path === "string" ? normalizeReviewPath(row.path) : null;
      const id = safeIdentifier(row.id);
      if (!citationPath || !id) {
        dropped += 1;
        continue;
      }
      evidence.push({
        id,
        entity_type: typeof row.entity_type === "string" ? row.entity_type.slice(0, 100) : "",
        kind: typeof row.kind === "string" ? row.kind.slice(0, 100) : "",
        title: typeof row.title === "string" ? row.title.slice(0, 500) : id,
        path: citationPath,
        start_line: Number.isInteger(row.start_line) ? row.start_line : null,
        end_line: Number.isInteger(row.end_line) ? row.end_line : null,
        excerpt: typeof row.excerpt === "string" ? row.excerpt.slice(0, 1000) : "",
        score: typeof row.score === "number" && Number.isFinite(row.score) ? row.score : null,
        matched_rules: Array.isArray(row.matched_rules)
          ? row.matched_rules.filter((item): item is string => typeof item === "string").slice(0, 50)
          : [],
      });
    }
    return { name, evidence };
  });
  return { tiers, dropped };
}

function emptyTarget(file: string, status: "not_indexed" | "error", query?: string): ToolPayload {
  return {
    path: file,
    status,
    review_question: PATTERN_REVIEW_QUESTION,
    query: query ?? null,
    query_source: query ? "explicit" : null,
    local_pattern_found: false,
    fallback_used: false,
    evidence_order: [...PATTERN_EVIDENCE_ORDER],
    tiers: emptyTiers(),
    warning: null,
    message: status === "not_indexed"
      ? "Target is not present as a file-backed entity in the current Cortex index. Run cortex update before reviewing it."
      : "Pattern evidence could not be produced for this target.",
    citations_dropped: 0,
  };
}

function disabledPatternReview(requested: number, limit: number, topK: number): ToolPayload {
  return {
    enabled: false,
    non_blocking: true,
    affects_policy_summary: false,
    review_question: PATTERN_REVIEW_QUESTION,
    limit,
    top_k_per_tier: topK,
    targets: [],
    summary: {
      requested,
      eligible: 0,
      analyzed: 0,
      local_evidence: 0,
      repo_fallback: 0,
      no_evidence: 0,
      not_indexed: 0,
      errors: 0,
      omitted: 0,
      invalid_paths: 0,
    },
  };
}

export async function buildPatternReviewContext(input: {
  files: string[];
  enabled: boolean;
  query?: string;
  topK: number;
  limit: number;
  runner?: PatternEvidenceRunner;
}): Promise<ToolPayload> {
  if (!input.enabled) {
    return disabledPatternReview(input.files.length, input.limit, input.topK);
  }

  const normalized = input.files.map(normalizeReviewPath);
  const invalidPaths = normalized.filter((value) => value === null).length;
  const eligible = [...new Set(normalized.filter((value): value is string => value !== null))]
    .sort(compareText);
  const selected = eligible.slice(0, input.limit);
  const runner = input.runner ?? createLocalPatternRunner();
  const targets: ToolPayload[] = [];
  const counts = {
    local_evidence: 0,
    repo_fallback: 0,
    no_evidence: 0,
    not_indexed: 0,
    errors: 0,
  };

  for (const file of selected) {
    try {
      const evidence = await runner({
        target: file,
        query: input.query,
        top_k: input.topK,
        include_deprecated: false,
      });
      const sanitized = sanitizeEvidenceTiers(evidence.tiers);
      const localPatternFound = sanitized.tiers.slice(0, 3).some((tier) =>
        Array.isArray(tier.evidence) && tier.evidence.length > 0
      );
      const repoEvidence = sanitized.tiers[3].evidence;
      const fallbackUsed = !localPatternFound && Array.isArray(repoEvidence) && repoEvidence.length > 0;
      const status = localPatternFound
        ? "local_evidence"
        : fallbackUsed
          ? "repo_fallback"
          : "no_evidence";
      counts[status] += 1;
      const warning = status === "local_evidence"
        ? typeof evidence.warning === "string" ? "Pattern evidence completed with local runtime warnings." : null
        : status === "repo_fallback"
          ? "No applicable local pattern evidence was found; repository-wide fallback evidence is provided."
          : "No applicable local pattern evidence was found.";
      targets.push({
        path: file,
        status,
        review_question: PATTERN_REVIEW_QUESTION,
        query: typeof evidence.query === "string" ? evidence.query.slice(0, 1000) : input.query ?? null,
        query_source: evidence.query_source === "explicit" || evidence.query_source === "derived_from_target"
          ? evidence.query_source
          : input.query ? "explicit" : null,
        local_pattern_found: localPatternFound,
        fallback_used: fallbackUsed,
        evidence_order: [...PATTERN_EVIDENCE_ORDER],
        tiers: sanitized.tiers,
        warning,
        message: null,
        citations_dropped: sanitized.dropped,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const notIndexed = /not found in indexed context|not file-backed/u.test(message);
      const status = notIndexed ? "not_indexed" : "error";
      counts[notIndexed ? "not_indexed" : "errors"] += 1;
      targets.push(emptyTarget(file, status, input.query));
    }
  }

  return {
    enabled: true,
    non_blocking: true,
    affects_policy_summary: false,
    review_question: PATTERN_REVIEW_QUESTION,
    query: input.query ?? null,
    limit: input.limit,
    top_k_per_tier: input.topK,
    targets,
    summary: {
      requested: input.files.length,
      eligible: eligible.length,
      analyzed: selected.length,
      ...counts,
      omitted: Math.max(0, eligible.length - selected.length),
      invalid_paths: invalidPaths,
    },
  };
}
