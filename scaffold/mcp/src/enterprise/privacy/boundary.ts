import type { AuditEntry } from "../../core/audit/writer.js";
import type { TelemetryMetrics } from "../../core/telemetry/collector.js";
import type { RepoIdentity } from "../../core/telemetry/repo-identity.js";

const REPO_IDENTITY_METADATA = [
  "repo",
  "instance_id",
  "session_id",
  "repo_remote_hash",
  "repo_branch",
  "repo_head_sha",
  "repo_dirty",
] as const;

export const OUTBOUND_DATA_BOUNDARY = {
  version: 2,
  excludes: [
    "source_code",
    "raw_prompts",
    "raw_queries",
    "embeddings",
    "graph_data",
    "full_file_contents",
  ],
  telemetry: {
    retention_days: 30,
    payload_type: "counts_and_metadata_only",
    allowed_fields: [
      "period_start",
      "period_end",
      "total_tool_calls",
      "successful_tool_calls",
      "failed_tool_calls",
      "total_duration_ms",
      "session_starts",
      "session_ends",
      "session_duration_ms_total",
      "searches",
      "related_lookups",
      "caller_lookups",
      "trace_lookups",
      "impact_analyses",
      "rule_lookups",
      "reloads",
      "total_results_returned",
      "estimated_tokens_saved",
      "estimated_tokens_total",
      "client_version",
      "instance_id",
      "session_id",
      "tool_metrics",
      "repo_remote_hash",
      "repo_branch",
      "repo_head_sha",
      "repo_dirty",
    ],
  },
  audit: {
    required_retention_days: 365,
    diagnostic_retention_days: 30,
    redaction: "string values are summarized to counts/lengths before outbound push",
    metadata_fields: REPO_IDENTITY_METADATA,
  },
  reviews: {
    metadata_fields: REPO_IDENTITY_METADATA,
  },
  violations: {
    metadata_fields: REPO_IDENTITY_METADATA,
  },
  workflow: {
    metadata_fields: REPO_IDENTITY_METADATA,
  },
} as const;

// Always-present, possibly-null shape for repo identity in outbound JSON.
// Used by every push channel so the server-side schema is consistent.
export function buildRepoIdentityPayload(identity: RepoIdentity | undefined) {
  return {
    repo_remote_hash: identity?.repo_remote_hash ?? null,
    repo_branch: identity?.repo_branch ?? null,
    repo_head_sha: identity?.repo_head_sha ?? null,
    repo_dirty: identity?.repo_dirty ?? null,
  };
}

type TelemetryPushContext = {
  session_id?: string;
  repo_identity?: RepoIdentity;
};

const MAX_OBJECT_KEYS = 12;
const MAX_ARRAY_ITEMS = 12;
const SENSITIVE_KEY_RE =
  /^(?:query|prompt|content|code|diff|patch|body|text|embedding|embeddings|graph|raw_query|raw_prompt|raw_code|raw_content)$/i;

function summarizeString(value: string) {
  return {
    type: "string",
    length: value.length,
    redacted: true,
  };
}

function summarizeArray(value: unknown[], depth: number): Record<string, unknown> {
  if (depth >= 2) {
    return {
      type: "array",
      count: value.length,
      redacted: true,
    };
  }

  return {
    type: "array",
    count: value.length,
    sample: value.slice(0, MAX_ARRAY_ITEMS).map((item) => summarizeValue(item, depth + 1)),
  };
}

function summarizeObject(
  value: Record<string, unknown>,
  depth: number,
): Record<string, unknown> {
  const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
  if (depth >= 2) {
    return {
      type: "object",
      keys: entries.map(([key]) => key),
      key_count: Object.keys(value).length,
      redacted: true,
    };
  }

  return Object.fromEntries(
    entries.map(([key, item]) => [
      key,
      SENSITIVE_KEY_RE.test(key)
        ? summarizeSensitiveValue(item)
        : summarizeValue(item, depth + 1),
    ]),
  );
}

function summarizeSensitiveValue(value: unknown): Record<string, unknown> {
  if (typeof value === "string") return summarizeString(value);
  if (Array.isArray(value)) {
    return {
      type: "array",
      count: value.length,
      redacted: true,
    };
  }
  if (value && typeof value === "object") {
    return {
      type: "object",
      key_count: Object.keys(value as Record<string, unknown>).length,
      redacted: true,
    };
  }
  return {
    type: typeof value,
    redacted: true,
  };
}

function summarizeValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return summarizeString(value);
  }
  if (Array.isArray(value)) {
    return summarizeArray(value, depth);
  }
  if (value && typeof value === "object") {
    return summarizeObject(value as Record<string, unknown>, depth);
  }
  return {
    type: typeof value,
    redacted: true,
  };
}

export function sanitizeOutboundRecord(
  record: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!record) return {};
  return summarizeObject(record, 0);
}

export function sanitizeAuditEntryForPush(entry: AuditEntry): AuditEntry {
  return {
    ...entry,
    input: sanitizeOutboundRecord(entry.input),
    error: entry.error ? `[redacted:${entry.error.length}]` : undefined,
    metadata: entry.metadata ? sanitizeOutboundRecord(entry.metadata) : undefined,
  };
}

export function buildTelemetryPushPayload(
  metrics: TelemetryMetrics,
  context: TelemetryPushContext = {},
) {
  return {
    period_start: metrics.period_start,
    period_end: metrics.period_end,
    total_tool_calls: metrics.total_tool_calls,
    successful_tool_calls: metrics.successful_tool_calls,
    failed_tool_calls: metrics.failed_tool_calls,
    total_duration_ms: metrics.total_duration_ms,
    session_starts: metrics.session_starts,
    session_ends: metrics.session_ends,
    session_duration_ms_total: metrics.session_duration_ms_total,
    searches: metrics.searches,
    related_lookups: metrics.related_lookups,
    caller_lookups: metrics.caller_lookups,
    trace_lookups: metrics.trace_lookups,
    impact_analyses: metrics.impact_analyses,
    rule_lookups: metrics.rule_lookups,
    reloads: metrics.reloads,
    total_results_returned: metrics.total_results_returned,
    estimated_tokens_saved: metrics.estimated_tokens_saved,
    estimated_tokens_total: metrics.estimated_tokens_total,
    client_version: metrics.client_version,
    instance_id: metrics.instance_id,
    session_id: context.session_id,
    tool_metrics: metrics.tool_metrics,
    ...buildRepoIdentityPayload(context.repo_identity),
  };
}
