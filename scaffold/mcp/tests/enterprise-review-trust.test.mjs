import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadReviewTrustState,
  recordQueuedReviewTrustState,
} from "../dist/enterprise/reviews/trust-state.js";
import {
  pendingCount,
  pushReviewResults,
  queueReviewResult,
  setReviewPushContext,
} from "../dist/enterprise/reviews/push.js";

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-review-trust-"));
  const contextDir = path.join(root, ".context");
  fs.mkdirSync(contextDir, { recursive: true });
  return { root, contextDir };
}

function writeTaskState(root, taskId, workflowId = "secure-build") {
  const taskDir = path.join(root, ".agents", taskId);
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(
    path.join(taskDir, "state.json"),
    JSON.stringify(
      {
        workflow_id: workflowId,
        outcome: "in_progress",
      },
      null,
      2,
    ),
    "utf8",
  );
}

function queueOneReview(reviewedAt = "2026-05-17T10:00:00.000Z") {
  queueReviewResult({
    policy_id: "no-secrets-in-code",
    pass: true,
    severity: "info",
    message: "No new secrets found",
    reviewed_at: reviewedAt,
  });
}

test.afterEach(async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  try {
    while (pendingCount() > 0) {
      await pushReviewResults("https://example.com", "ent_test");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("review trust state persists queued review evidence", () => {
  const { root, contextDir } = makeProject();
  const state = recordQueuedReviewTrustState(
    {
      contextDir,
      projectRoot: root,
      repo: "demo-repo",
      instance_id: "abc123",
      session_id: "session-1",
    },
    {
      reviewedAt: "2026-05-17T10:00:00.000Z",
      summary: {
        total: 2,
        passed: 1,
        failed: 1,
        warnings: 0,
        skipped: 1,
      },
      skippedPolicies: [
        {
          policy_id: "require-code-review",
          kind: "predefined",
          type: null,
          reason: "validate this policy from workflow state on the next run.",
        },
      ],
    },
  );

  assert.equal(state.delivery.status, "queued");
  assert.equal(state.review_summary.total, 2);
  assert.equal(state.skipped_policies.length, 1);
  assert.ok(fs.existsSync(path.join(contextDir, "review-trust.json")));
  assert.match(
    state.trust_warnings.map((warning) => warning.code).join(","),
    /workflow-unresolved/,
  );
});

test("review trust state writes workflow state even when no workflow file exists yet", () => {
  const { contextDir } = makeProject();
  const state = loadReviewTrustState(contextDir);

  assert.equal(state.delivery.status, "never_attempted");
  assert.ok(fs.existsSync(path.join(contextDir, "workflow", "state.json")));
});

test("review trust uses the explicit active task instead of guessing from the newest agent run", () => {
  const { root, contextDir } = makeProject();
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-review-home-"));
  process.env.HOME = fakeHome;
  try {
    writeTaskState(root, "task-a");
    writeTaskState(root, "task-b", "shadow-workflow");
    const state = recordQueuedReviewTrustState(
      {
        contextDir,
        projectRoot: root,
        repo: "demo-repo",
        instance_id: "abc123",
        session_id: "session-1",
        task_id: "task-a",
      },
      {
        reviewedAt: "2026-05-17T10:00:00.000Z",
        summary: {
          total: 1,
          passed: 1,
          failed: 0,
          warnings: 0,
          skipped: 0,
        },
        skippedPolicies: [],
      },
    );

    assert.equal(state.workflow.task_id, "task-a");
    assert.equal(state.workflow.id, "secure-build");
  } finally {
    delete process.env.HOME;
  }
});

test("review push marks delivery accepted on successful ingestion", async () => {
  const { contextDir } = makeProject();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200 });

  setReviewPushContext({
    repo: "demo-repo",
    instance_id: "abc123",
    session_id: "session-accepted",
    context_dir: contextDir,
  });
  queueOneReview();

  try {
    const result = await pushReviewResults("https://example.com", "ent_test");
    assert.equal(result.success, true);
    assert.equal(result.delivery_status, "accepted");
  } finally {
    globalThis.fetch = originalFetch;
  }

  const state = loadReviewTrustState(contextDir);
  assert.equal(state.delivery.status, "accepted");
});

test("review push marks delivery failed on HTTP errors", async () => {
  const { contextDir } = makeProject();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 502 });

  setReviewPushContext({
    repo: "demo-repo",
    instance_id: "abc123",
    session_id: "session-http-fail",
    context_dir: contextDir,
  });
  queueOneReview();

  try {
    const result = await pushReviewResults("https://example.com", "ent_test");
    assert.equal(result.success, false);
    assert.equal(result.delivery_status, "failed");
  } finally {
    globalThis.fetch = originalFetch;
  }

  const state = loadReviewTrustState(contextDir);
  assert.equal(state.delivery.status, "failed");
  assert.equal(state.delivery.last_error, "HTTP 502");
});

test("review push marks delivery failed on network errors", async () => {
  const { contextDir } = makeProject();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network down");
  };

  setReviewPushContext({
    repo: "demo-repo",
    instance_id: "abc123",
    session_id: "session-network-fail",
    context_dir: contextDir,
  });
  queueOneReview();

  try {
    const result = await pushReviewResults("https://example.com", "ent_test");
    assert.equal(result.success, false);
    assert.equal(result.delivery_status, "failed");
  } finally {
    globalThis.fetch = originalFetch;
  }

  const state = loadReviewTrustState(contextDir);
  assert.equal(state.delivery.status, "failed");
  assert.equal(state.delivery.last_error, "network down");
});

test("queuing a new review resets prior accepted delivery markers", async () => {
  const { root, contextDir } = makeProject();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200 });

  setReviewPushContext({
    repo: "demo-repo",
    instance_id: "abc123",
    session_id: "session-accepted",
    context_dir: contextDir,
  });
  queueOneReview("2026-05-17T10:00:00.000Z");

  try {
    const result = await pushReviewResults("https://example.com", "ent_test");
    assert.equal(result.success, true);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const accepted = loadReviewTrustState(contextDir);
  assert.equal(accepted.delivery.status, "accepted");
  assert.ok(accepted.delivery.last_accepted_at);

  const queued = recordQueuedReviewTrustState(
    {
      contextDir,
      projectRoot: root,
      repo: "demo-repo",
      instance_id: "abc123",
      session_id: "session-next",
    },
    {
      reviewedAt: "2026-05-17T11:00:00.000Z",
      summary: {
        total: 1,
        passed: 1,
        failed: 0,
        warnings: 0,
        skipped: 0,
      },
      skippedPolicies: [],
    },
  );

  assert.equal(queued.delivery.status, "queued");
  assert.equal(queued.delivery.last_attempted_at, null);
  assert.equal(queued.delivery.last_pushed_at, null);
  assert.equal(queued.delivery.last_accepted_at, null);
});

test("zero-result reviews stay never_attempted instead of looking queued", () => {
  const { root, contextDir } = makeProject();
  const state = recordQueuedReviewTrustState(
    {
      contextDir,
      projectRoot: root,
      repo: "demo-repo",
      instance_id: "abc123",
      session_id: "session-empty",
    },
    {
      reviewedAt: "2026-05-17T11:00:00.000Z",
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        warnings: 0,
        skipped: 2,
      },
      skippedPolicies: [
        {
          policy_id: "require-code-review",
          kind: "predefined",
          type: null,
          reason: "validate this policy from workflow state on the next run.",
        },
        {
          policy_id: "custom.missing",
          kind: "custom",
          type: "regex-custom",
          reason: 'No evaluator registered for type "regex-custom"',
        },
      ],
    },
  );

  assert.equal(state.delivery.status, "never_attempted");
  assert.equal(state.delivery.review_count, 0);
  assert.equal(state.delivery.queued_at, null);
  assert.equal(state.delivery.last_attempted_at, null);
});
