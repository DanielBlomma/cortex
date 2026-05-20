import type { OrgPolicy } from "../../core/policy/store.js";
import {
  getGenericEvaluator,
  getValidator,
  type EnforcedPolicy,
} from "../../core/validators/engine.js";
import type { ReviewSkippedPolicy } from "./trust-state.js";

export const DEFERRED_CODE_REVIEW_REASON =
  "Current context.review invocation is the review being recorded; validate this policy from workflow state on the next run.";

export type PartitionedReviewPolicies = {
  enforced: EnforcedPolicy[];
  skipped: ReviewSkippedPolicy[];
};

export function partitionReviewPolicies(
  policies: OrgPolicy[],
): PartitionedReviewPolicies {
  const enforced: EnforcedPolicy[] = [];
  const skipped: ReviewSkippedPolicy[] = [];

  for (const policy of policies) {
    if (!policy.enforce) continue;

    if (policy.id === "require-code-review") {
      skipped.push({
        policy_id: policy.id,
        kind: policy.kind ?? null,
        type: policy.type ?? null,
        reason: DEFERRED_CODE_REVIEW_REASON,
      });
      continue;
    }

    if (policy.type) {
      if (!getGenericEvaluator(policy.type)) {
        skipped.push({
          policy_id: policy.id,
          kind: policy.kind ?? null,
          type: policy.type,
          reason: `No evaluator registered for type "${policy.type}"`,
        });
        continue;
      }
    } else if (!getValidator(policy.id)) {
      skipped.push({
        policy_id: policy.id,
        kind: policy.kind ?? null,
        type: null,
        reason: "No executable validator registered for this policy",
      });
      continue;
    }

    enforced.push({
      id: policy.id,
      type: policy.type ?? null,
      config: policy.config ?? null,
      severity: policy.severity ?? "block",
    });
  }

  return { enforced, skipped };
}
