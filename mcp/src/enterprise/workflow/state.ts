import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type {
  ReviewOutput,
  ReviewResult,
  ReviewSummary,
} from "../../core/validators/engine.js";

export type WorkflowPhase =
  | "planning"
  | "plan_review"
  | "implementation_pending"
  | "implementation"
  | "iterating"
  | "reviewed"
  | "approved";

export type WorkflowPlanStatus =
  | "missing"
  | "pending_review"
  | "changes_requested"
  | "approved";

export type WorkflowReviewStatus = "not_run" | "failed" | "passed";
export type WorkflowApprovalStatus = "blocked" | "ready" | "approved";

export type WorkflowBlocker = {
  code:
    | "plan_missing"
    | "plan_not_approved"
    | "implementation_not_started"
    | "code_review_required"
    | "review_failed";
  message: string;
};

export type WorkflowPlan = {
  title: string | null;
  summary: string | null;
  tasks: string[];
  status: WorkflowPlanStatus;
  updated_at: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
};

export type WorkflowReviewSnapshot = {
  status: WorkflowReviewStatus;
  scope: "all" | "changed" | null;
  reviewed_at: string | null;
  artifact_path: string | null;
  summary: ReviewSummary | null;
  failed_policies: string[];
  warning_policies: string[];
  reviewed_files: WorkflowReviewedFileSnapshot[] | null;
};

export type WorkflowApproval = {
  status: WorkflowApprovalStatus;
  approved_at: string | null;
  notes: string | null;
};

export type WorkflowNote = {
  id: number;
  title: string;
  details: string;
  created_at: string;
};

export type WorkflowTodo = {
  id: number;
  title: string;
  details: string;
  status: "open" | "done";
  created_at: string;
  updated_at: string;
};

export type WorkflowHistoryEntry = {
  at: string;
  event:
    | "plan_set"
    | "plan_reviewed"
    | "implementation_started"
    | "review_recorded"
    | "workflow_updated"
    | "workflow_approved"
    | "note_added"
    | "todo_added"
    | "todo_completed";
  details?: Record<string, unknown>;
};

export type WorkflowState = {
  version: 1;
  created_at: string;
  updated_at: string;
  phase: WorkflowPhase;
  blocked_reasons: WorkflowBlocker[];
  plan: WorkflowPlan;
  last_review: WorkflowReviewSnapshot;
  approval: WorkflowApproval;
  next_note_id: number;
  next_todo_id: number;
  notes: WorkflowNote[];
  todos: WorkflowTodo[];
  history: WorkflowHistoryEntry[];
};

export type WorkflowMutationResult = {
  ok: boolean;
  state: WorkflowState;
  error?: string;
};

type WorkflowReviewArtifact = {
  recorded_at: string;
  scope: "all" | "changed";
  summary: ReviewSummary;
  results: ReviewResult[];
  reviewed_files: WorkflowReviewedFileSnapshot[] | null;
};

export type WorkflowReviewedFileSnapshot = {
  path: string;
  exists: boolean;
  hash: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function workflowDir(contextDir: string): string {
  return join(contextDir, "workflow");
}

function workflowStatePath(contextDir: string): string {
  return join(workflowDir(contextDir), "state.json");
}

function workflowReviewsDir(contextDir: string): string {
  return join(workflowDir(contextDir), "reviews");
}

function initialState(): WorkflowState {
  const now = nowIso();
  return {
    version: 1,
    created_at: now,
    updated_at: now,
    phase: "planning",
    blocked_reasons: [
      {
        code: "plan_missing",
        message: "A plan must be created before implementation can begin.",
      },
      {
        code: "code_review_required",
        message: "A passing code review is required before approval.",
      },
    ],
    plan: {
      title: null,
      summary: null,
      tasks: [],
      status: "missing",
      updated_at: null,
      reviewed_at: null,
      review_notes: null,
    },
    last_review: {
      status: "not_run",
      scope: null,
      reviewed_at: null,
      artifact_path: null,
      summary: null,
      failed_policies: [],
      warning_policies: [],
      reviewed_files: null,
    },
    approval: {
      status: "blocked",
      approved_at: null,
      notes: null,
    },
    next_note_id: 1,
    next_todo_id: 1,
    notes: [],
    todos: [],
    history: [],
  };
}

function ensureWorkflowDirs(contextDir: string): void {
  mkdirSync(workflowReviewsDir(contextDir), { recursive: true });
}

function clampHistory(history: WorkflowHistoryEntry[]): WorkflowHistoryEntry[] {
  return history.slice(-100);
}

function blockersFor(state: WorkflowState): WorkflowBlocker[] {
  const blockers: WorkflowBlocker[] = [];

  if (!state.plan.title || state.plan.status === "missing") {
    blockers.push({
      code: "plan_missing",
      message: "A plan must be created before implementation can begin.",
    });
  }

  if (state.plan.status !== "approved") {
    blockers.push({
      code: "plan_not_approved",
      message: "The plan must be reviewed and approved before approval.",
    });
  }

  if (!state.history.some((entry) => entry.event === "implementation_started")) {
    blockers.push({
      code: "implementation_not_started",
      message: "Implementation has not started yet.",
    });
  }

  if (state.last_review.status === "not_run") {
    blockers.push({
      code: "code_review_required",
      message: "A passing code review is required before approval.",
    });
  }

  if (state.last_review.status === "failed") {
    blockers.push({
      code: "review_failed",
      message: "The latest code review failed and must be resolved before approval.",
    });
  }

  return blockers;
}

function withRecalculatedApproval(
  state: WorkflowState,
  preserveApproved = false
): WorkflowState {
  const blockers = blockersFor(state);
  state.blocked_reasons = blockers;

  if (blockers.length > 0) {
    state.approval = {
      status: "blocked",
      approved_at: null,
      notes: null,
    };
    return state;
  }

  if (preserveApproved && state.approval.status === "approved") {
    state.approval.status = "approved";
    return state;
  }

  state.approval = {
    status: "ready",
    approved_at: null,
    notes: null,
  };
  return state;
}

function writeState(
  contextDir: string,
  state: WorkflowState,
  touchUpdatedAt = true
): WorkflowState {
  ensureWorkflowDirs(contextDir);
  if (touchUpdatedAt) {
    state.updated_at = nowIso();
  }
  state.history = clampHistory(state.history);
  writeFileSync(workflowStatePath(contextDir), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return state;
}

export function loadWorkflowState(contextDir: string): WorkflowState {
  ensureWorkflowDirs(contextDir);
  const statePath = workflowStatePath(contextDir);
  if (!existsSync(statePath)) {
    return writeState(contextDir, initialState());
  }

  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8")) as WorkflowState;
    return withRecalculatedApproval(parsed, true);
  } catch {
    return writeState(contextDir, initialState());
  }
}

function addHistory(
  state: WorkflowState,
  event: WorkflowHistoryEntry["event"],
  details?: Record<string, unknown>
): void {
  state.history.push({
    at: nowIso(),
    event,
    details,
  });
}

export function setWorkflowPlan(
  contextDir: string,
  input: { title: string; summary: string; tasks?: string[] }
): WorkflowState {
  const state = loadWorkflowState(contextDir);
  state.phase = "plan_review";
  state.plan = {
    title: input.title,
    summary: input.summary,
    tasks: input.tasks?.filter(Boolean) ?? [],
    status: "pending_review",
    updated_at: nowIso(),
    reviewed_at: null,
    review_notes: null,
  };
  state.last_review = {
    status: "not_run",
    scope: null,
    reviewed_at: null,
    artifact_path: null,
    summary: null,
    failed_policies: [],
    warning_policies: [],
    reviewed_files: null,
  };
  addHistory(state, "plan_set", {
    title: input.title,
    task_count: state.plan.tasks.length,
  });
  return writeState(contextDir, withRecalculatedApproval(state));
}

export function reviewWorkflowPlan(
  contextDir: string,
  input: { approved: boolean; notes?: string }
): WorkflowMutationResult {
  const state = loadWorkflowState(contextDir);
  if (!state.plan.title) {
    return { ok: false, state, error: "No plan exists to review" };
  }

  state.plan.status = input.approved ? "approved" : "changes_requested";
  state.plan.reviewed_at = nowIso();
  state.plan.review_notes = input.notes?.trim() || null;
  state.phase = input.approved ? "implementation_pending" : "planning";
  addHistory(state, "plan_reviewed", {
    approved: input.approved,
  });
  return { ok: true, state: writeState(contextDir, withRecalculatedApproval(state)) };
}

export function startWorkflowImplementation(
  contextDir: string
): WorkflowMutationResult {
  const state = loadWorkflowState(contextDir);
  if (state.plan.status !== "approved") {
    return {
      ok: false,
      state,
      error: "Plan must be approved before implementation can start",
    };
  }

  state.phase = "implementation";
  addHistory(state, "implementation_started");
  return { ok: true, state: writeState(contextDir, withRecalculatedApproval(state)) };
}

export function recordWorkflowReview(
  contextDir: string,
  input: {
    scope: "all" | "changed";
    output: ReviewOutput;
    reviewed_files?: WorkflowReviewedFileSnapshot[] | null;
  }
): WorkflowState {
  const state = loadWorkflowState(contextDir);
  const recordedAt = nowIso();
  const blockingFailures = input.output.results.filter(
    (result) => !result.pass && result.severity === "error"
  );
  const warningFailures = input.output.results.filter(
    (result) => !result.pass && result.severity === "warning"
  );
  const hasBlockingFailures = blockingFailures.length > 0;
  const fileName = `review-${recordedAt.replace(/[:.]/g, "-")}.json`;
  const relativeArtifactPath = `.context/workflow/reviews/${fileName}`;
  const artifact: WorkflowReviewArtifact = {
    recorded_at: recordedAt,
    scope: input.scope,
    summary: input.output.summary,
    results: input.output.results,
    reviewed_files: input.reviewed_files ?? null,
  };

  ensureWorkflowDirs(contextDir);
  writeFileSync(
    join(workflowReviewsDir(contextDir), fileName),
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8"
  );

  state.last_review = {
    status: hasBlockingFailures ? "failed" : "passed",
    scope: input.scope,
    reviewed_at: recordedAt,
    artifact_path: relativeArtifactPath,
    summary: input.output.summary,
    failed_policies: blockingFailures.map((result) => result.policy_id),
    warning_policies: warningFailures.map((result) => result.policy_id),
    reviewed_files: input.reviewed_files ?? null,
  };
  state.phase = hasBlockingFailures ? "iterating" : "reviewed";
  addHistory(state, "review_recorded", {
    scope: input.scope,
    total: input.output.summary.total,
    failed: blockingFailures.length,
    warnings: warningFailures.length,
  });
  return writeState(contextDir, withRecalculatedApproval(state));
}

export function recordWorkflowUpdate(
  contextDir: string,
  input: { summary: string; phase?: "implementation" | "iterating" | "plan_review" }
): WorkflowState {
  const state = loadWorkflowState(contextDir);
  if (input.phase) {
    state.phase = input.phase;
  }
  addHistory(state, "workflow_updated", {
    summary: input.summary,
    phase: input.phase ?? state.phase,
  });
  return writeState(
    contextDir,
    withRecalculatedApproval(state, input.phase === undefined)
  );
}

export function addWorkflowNote(
  contextDir: string,
  input: { title: string; details: string }
): WorkflowState {
  const state = loadWorkflowState(contextDir);
  const note: WorkflowNote = {
    id: state.next_note_id++,
    title: input.title,
    details: input.details,
    created_at: nowIso(),
  };
  state.notes.push(note);
  addHistory(state, "note_added", { note_id: note.id, title: note.title });
  return writeState(contextDir, withRecalculatedApproval(state, true));
}

export function addWorkflowTodo(
  contextDir: string,
  input: { title: string; details?: string }
): WorkflowState {
  const state = loadWorkflowState(contextDir);
  const now = nowIso();
  const todo: WorkflowTodo = {
    id: state.next_todo_id++,
    title: input.title,
    details: input.details?.trim() || "",
    status: "open",
    created_at: now,
    updated_at: now,
  };
  state.todos.push(todo);
  addHistory(state, "todo_added", { todo_id: todo.id, title: todo.title });
  return writeState(contextDir, withRecalculatedApproval(state, true));
}

export function completeWorkflowTodo(
  contextDir: string,
  todoId: number
): WorkflowMutationResult {
  const state = loadWorkflowState(contextDir);
  const todo = state.todos.find((item) => item.id === todoId);
  if (!todo) {
    return { ok: false, state, error: `Todo ${todoId} was not found` };
  }

  todo.status = "done";
  todo.updated_at = nowIso();
  addHistory(state, "todo_completed", { todo_id: todo.id });
  return { ok: true, state: writeState(contextDir, withRecalculatedApproval(state, true)) };
}

export function approveWorkflow(
  contextDir: string,
  notes?: string
): WorkflowMutationResult {
  const state = loadWorkflowState(contextDir);
  const blockers = blockersFor(state);
  if (blockers.length > 0) {
    const refreshed = writeState(contextDir, withRecalculatedApproval(state));
    return {
      ok: false,
      state: refreshed,
      error: blockers.map((blocker) => blocker.message).join(" "),
    };
  }

  state.phase = "approved";
  state.blocked_reasons = [];
  state.approval = {
    status: "approved",
    approved_at: nowIso(),
    notes: notes?.trim() || null,
  };
  addHistory(state, "workflow_approved");
  return { ok: true, state: writeState(contextDir, state) };
}
