import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SECURE_BUILD_WORKFLOW } from "../dist/core/workflow/default-workflows.js";
import {
  loadReviewTrustState,
  recordQueuedReviewTrustState,
  recordReviewDeliveryStatus,
} from "../dist/enterprise/reviews/trust-state.js";
import { syncedWorkflowsCachePath } from "../dist/core/workflow/synced-registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reviewFixture = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "./fixtures/review-trust-contract.json"),
    "utf8",
  ),
);

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-review-contract-"));
  const contextDir = path.join(root, ".context");
  fs.mkdirSync(contextDir, { recursive: true });
  const taskDir = path.join(root, ".agents", "task-1");
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(
    path.join(taskDir, "state.json"),
    JSON.stringify(
      {
        workflow_id: "secure-build",
        outcome: "in_progress",
      },
      null,
      2,
    ),
    "utf8",
  );
  return { root, contextDir };
}

function enableSyncedSecureBuild(homeDir) {
  const syncedDir = path.join(homeDir, ".cortex");
  fs.mkdirSync(syncedDir, { recursive: true });
  fs.writeFileSync(
    syncedWorkflowsCachePath(syncedDir),
    JSON.stringify(
      {
        workflows: {
          "secure-build": {
            workflow_id: "secure-build",
            version: 1,
            updated_at: "2026-05-19T09:30:00.000Z",
            definition: SECURE_BUILD_WORKFLOW,
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}

function normalizeContractShape(state) {
  return {
    workflow: {
      id: state.workflow.id,
      source: state.workflow.source,
    },
    last_review_at: state.last_review_at,
    skipped_policies: state.skipped_policies,
    delivery: {
      status: state.delivery.status,
      review_count: state.delivery.review_count,
      last_accepted_at: state.delivery.last_accepted_at,
      last_attempted_at: state.delivery.last_attempted_at,
      last_error: state.delivery.last_error,
    },
  };
}

test("review trust contract: accepted payload matches the shared cross-repo fixture", () => {
  const { root, contextDir } = makeProject();
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-review-home-"));
  process.env.HOME = fakeHome;
  enableSyncedSecureBuild(fakeHome);

  try {
    const accepted = reviewFixture.accepted.workflow_snapshot.snapshot.review_trust;
    recordQueuedReviewTrustState(
      {
        contextDir,
        projectRoot: root,
        repo: reviewFixture.accepted.workflow_snapshot.repo,
        instance_id: reviewFixture.accepted.workflow_snapshot.instanceId,
        session_id: reviewFixture.accepted.workflow_snapshot.sessionId,
        task_id: "task-1",
      },
      {
        reviewedAt: accepted.last_review_at,
        summary: {
          total: accepted.delivery.review_count,
          passed: 2,
          failed: 0,
          warnings: 0,
          skipped: accepted.skipped_policies.length,
        },
        skippedPolicies: accepted.skipped_policies,
      },
    );
    recordReviewDeliveryStatus(contextDir, "accepted", {
      reviewCount: accepted.delivery.review_count,
      attemptedAt: accepted.delivery.last_accepted_at,
    });

    const state = loadReviewTrustState(contextDir);
    assert.deepEqual(normalizeContractShape(state), accepted);
  } finally {
    delete process.env.HOME;
  }
});

test("review trust contract: failed payload matches the shared cross-repo fixture", () => {
  const { root, contextDir } = makeProject();
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-review-home-"));
  process.env.HOME = fakeHome;
  enableSyncedSecureBuild(fakeHome);

  try {
    const failed = reviewFixture.failed.workflow_snapshot.snapshot.review_trust;
    recordQueuedReviewTrustState(
      {
        contextDir,
        projectRoot: root,
        repo: reviewFixture.failed.workflow_snapshot.repo,
        instance_id: reviewFixture.failed.workflow_snapshot.instanceId,
        session_id: reviewFixture.failed.workflow_snapshot.sessionId,
        task_id: "task-1",
      },
      {
        reviewedAt: failed.last_review_at,
        summary: {
          total: failed.delivery.review_count,
          passed: 1,
          failed: 1,
          warnings: 0,
          skipped: 0,
        },
        skippedPolicies: [],
      },
    );
    recordReviewDeliveryStatus(contextDir, "failed", {
      reviewCount: failed.delivery.review_count,
      attemptedAt: failed.delivery.last_attempted_at,
      error: failed.delivery.last_error,
    });

    const state = loadReviewTrustState(contextDir);
    assert.deepEqual(normalizeContractShape(state), failed);
  } finally {
    delete process.env.HOME;
  }
});
