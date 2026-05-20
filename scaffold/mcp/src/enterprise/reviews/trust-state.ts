import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setWorkflowReviewTrust } from "../workflow/state.js";
import { resolveWorkflowDefinition, type WorkflowSource } from "../../core/workflow/resolution.js";

export type ReviewDeliveryStatus =
  | "never_attempted"
  | "queued"
  | "pushed"
  | "accepted"
  | "failed";

export type ReviewTrustWarning = {
  code:
    | "workflow-source-unverified"
    | "workflow-unresolved"
    | "review-delivery-pending"
    | "review-delivery-failed"
    | "policy-not-enforceable";
  message: string;
};

export type ReviewSkippedPolicy = {
  policy_id: string;
  kind: string | null;
  type: string | null;
  reason: string;
};

export type ReviewTrustState = {
  version: 1;
  repo: string | null;
  instance_id: string | null;
  session_id: string | null;
  workflow: {
    id: string | null;
    source: WorkflowSource | "unknown";
    task_id: string | null;
  };
  last_review_at: string | null;
  review_summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
    skipped: number;
  } | null;
  skipped_policies: ReviewSkippedPolicy[];
  delivery: {
    status: ReviewDeliveryStatus;
    review_count: number;
    queued_at: string | null;
    last_attempted_at: string | null;
    last_pushed_at: string | null;
    last_accepted_at: string | null;
    last_error: string | null;
  };
  trust_warnings: ReviewTrustWarning[];
};

type TrustContext = {
  contextDir: string;
  projectRoot: string;
  repo?: string;
  instance_id?: string;
  session_id?: string;
  task_id?: string;
};

type ReviewSummaryInput = {
  total: number;
  passed: number;
  failed: number;
  warnings: number;
  skipped: number;
};

type WorkflowInference = {
  id: string | null;
  source: WorkflowSource | "unknown";
  task_id: string | null;
};

function trustStatePath(contextDir: string): string {
  return join(contextDir, "review-trust.json");
}

function nowIso(): string {
  return new Date().toISOString();
}

function initialTrustState(): ReviewTrustState {
  return {
    version: 1,
    repo: null,
    instance_id: null,
    session_id: null,
    workflow: {
      id: null,
      source: "unknown",
      task_id: null,
    },
    last_review_at: null,
    review_summary: null,
    skipped_policies: [],
    delivery: {
      status: "never_attempted",
      review_count: 0,
      queued_at: null,
      last_attempted_at: null,
      last_pushed_at: null,
      last_accepted_at: null,
      last_error: null,
    },
    trust_warnings: [],
  };
}

function ensureContextDir(contextDir: string): void {
  mkdirSync(contextDir, { recursive: true });
}

function inferWorkflow(projectRoot: string, taskId?: string): WorkflowInference {
  const normalizedTaskId = taskId?.trim();
  if (!normalizedTaskId) {
    return { id: null, source: "unknown", task_id: null };
  }

  const statePath = join(projectRoot, ".agents", normalizedTaskId, "state.json");
  if (!existsSync(statePath)) {
    return { id: null, source: "unknown", task_id: normalizedTaskId };
  }

  try {
    const raw = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
    const workflowId =
      typeof raw.workflow_id === "string" ? raw.workflow_id : null;
    if (!workflowId) {
      return { id: null, source: "unknown", task_id: normalizedTaskId };
    }
    const resolved = resolveWorkflowDefinition(workflowId);
    return {
      id: workflowId,
      source: resolved.source,
      task_id: normalizedTaskId,
    };
  } catch {
    return {
      id: null,
      source: "unknown",
      task_id: normalizedTaskId,
    };
  }
}

function computeWarnings(state: ReviewTrustState): ReviewTrustWarning[] {
  const warnings: ReviewTrustWarning[] = [];

  if (!state.workflow.id) {
    warnings.push({
      code: "workflow-unresolved",
      message:
        "No active local workflow could be resolved for this review session, so workflow/review correlation is unproven.",
    });
  } else if (state.workflow.source !== "synced") {
    warnings.push({
      code: "workflow-source-unverified",
      message:
        `Workflow "${state.workflow.id}" is not proven to come from the synced org registry for this session.`,
    });
  }

  if (state.delivery.status === "queued" || state.delivery.status === "pushed") {
    warnings.push({
      code: "review-delivery-pending",
      message:
        "Local review results exist for this session, but Cortex has not yet confirmed acceptance by the control plane.",
    });
  }

  if (state.delivery.status === "failed") {
    warnings.push({
      code: "review-delivery-failed",
      message:
        `Review delivery failed${state.delivery.last_error ? `: ${state.delivery.last_error}` : ""}`,
    });
  }

  if (state.skipped_policies.length > 0) {
    warnings.push({
      code: "policy-not-enforceable",
      message:
        `${state.skipped_policies.length} configured policy` +
        `${state.skipped_policies.length === 1 ? " was" : "ies were"} not enforceable locally.`,
    });
  }

  return warnings;
}

export function loadReviewTrustState(contextDir: string): ReviewTrustState {
  ensureContextDir(contextDir);
  const filePath = trustStatePath(contextDir);
  if (!existsSync(filePath)) {
    const initial = initialTrustState();
    writeReviewTrustState(contextDir, initial);
    return initial;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as ReviewTrustState;
    parsed.trust_warnings = computeWarnings(parsed);
    return parsed;
  } catch {
    const initial = initialTrustState();
    writeReviewTrustState(contextDir, initial);
    return initial;
  }
}

export function writeReviewTrustState(
  contextDir: string,
  state: ReviewTrustState,
): ReviewTrustState {
  ensureContextDir(contextDir);
  state.trust_warnings = computeWarnings(state);
  writeFileSync(trustStatePath(contextDir), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  setWorkflowReviewTrust(contextDir, state);
  return state;
}

export function recordQueuedReviewTrustState(
  context: TrustContext,
  input: {
    reviewedAt: string;
    summary: ReviewSummaryInput;
    skippedPolicies: ReviewSkippedPolicy[];
  },
): ReviewTrustState {
  const state = loadReviewTrustState(context.contextDir);
  const workflow = inferWorkflow(context.projectRoot, context.task_id);
  state.repo = context.repo ?? state.repo;
  state.instance_id = context.instance_id ?? state.instance_id;
  state.session_id = context.session_id ?? state.session_id;
  state.workflow = workflow;
  state.last_review_at = input.reviewedAt;
  state.review_summary = {
    total: input.summary.total,
    passed: input.summary.passed,
    failed: input.summary.failed,
    warnings: input.summary.warnings,
    skipped: input.summary.skipped,
  };
  state.skipped_policies = input.skippedPolicies;
  const hasQueuedReviews = input.summary.total > 0;
  state.delivery = {
    status: hasQueuedReviews ? "queued" : "never_attempted",
    review_count: input.summary.total,
    queued_at: hasQueuedReviews ? input.reviewedAt : null,
    last_attempted_at: null,
    last_pushed_at: null,
    last_accepted_at: null,
    last_error: null,
  };
  return writeReviewTrustState(context.contextDir, state);
}

export function recordReviewDeliveryStatus(
  contextDir: string,
  status: ReviewDeliveryStatus,
  input: {
    reviewCount?: number;
    error?: string;
    attemptedAt?: string;
  } = {},
): ReviewTrustState {
  const state = loadReviewTrustState(contextDir);
  const at = input.attemptedAt ?? nowIso();
  state.delivery.review_count = input.reviewCount ?? state.delivery.review_count;
  state.delivery.last_attempted_at = at;

  if (status === "pushed") {
    state.delivery.status = "pushed";
    state.delivery.last_pushed_at = at;
    state.delivery.last_error = null;
  } else if (status === "accepted") {
    state.delivery.status = "accepted";
    state.delivery.last_pushed_at = at;
    state.delivery.last_accepted_at = at;
    state.delivery.last_error = null;
  } else if (status === "failed") {
    state.delivery.status = "failed";
    state.delivery.last_pushed_at = at;
    state.delivery.last_error = input.error ?? "unknown error";
  } else {
    state.delivery.status = status;
  }

  return writeReviewTrustState(contextDir, state);
}
