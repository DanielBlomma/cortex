import test from "node:test";
import assert from "node:assert/strict";

import { partitionReviewPolicies } from "../dist/enterprise/reviews/policy-selection.js";
import { DEFERRED_CODE_REVIEW_REASON } from "../dist/enterprise/reviews/policy-selection.js";
import "../dist/core/validators/builtins.js";

test("partitionReviewPolicies: defers require-code-review with explicit evidence", () => {
  const result = partitionReviewPolicies([
    {
      id: "require-code-review",
      description: "Code review is required",
      priority: 10,
      scope: "global",
      enforce: true,
      source: "org",
      kind: "predefined",
      type: null,
      config: null,
      severity: "block",
      status: "active",
      title: "Require code review",
    },
  ]);

  assert.deepEqual(result.enforced, []);
  assert.deepEqual(result.skipped, [
    {
      policy_id: "require-code-review",
      kind: "predefined",
      type: null,
      reason: DEFERRED_CODE_REVIEW_REASON,
    },
  ]);
});

test("partitionReviewPolicies: keeps executable validators enforced and skips missing evaluators", () => {
  const result = partitionReviewPolicies([
    {
      id: "no-secrets-in-code",
      description: "Block secrets",
      priority: 10,
      scope: "global",
      enforce: true,
      source: "org",
      kind: "predefined",
      type: null,
      config: null,
      severity: "block",
      status: "active",
      title: "No secrets",
    },
    {
      id: "custom.missing",
      description: "Missing evaluator",
      priority: 20,
      scope: "global",
      enforce: true,
      source: "org",
      kind: "custom",
      type: "regex-custom",
      config: { pattern: "secret" },
      severity: "warning",
      status: "active",
      title: "Missing custom evaluator",
    },
  ]);

  assert.deepEqual(result.enforced, [
    {
      id: "no-secrets-in-code",
      type: null,
      config: null,
      severity: "block",
    },
  ]);
  assert.deepEqual(result.skipped, [
    {
      policy_id: "custom.missing",
      kind: "custom",
      type: "regex-custom",
      reason: 'No evaluator registered for type "regex-custom"',
    },
  ]);
});
