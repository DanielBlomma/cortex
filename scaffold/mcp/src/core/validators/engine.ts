export type ValidatorContext = {
  contextDir: string;
  projectRoot: string;
  changedFiles?: string[];
};

export type ValidatorResult = {
  pass: boolean;
  severity: "error" | "warning" | "info";
  message: string;
  detail?: string;
};

export type ValidatorDef = {
  policyId: string;
  check: (ctx: ValidatorContext, options: Record<string, unknown>) => Promise<ValidatorResult>;
};

// Generic evaluators are keyed by `type`, not by policyId. One evaluator
// can execute many policies (e.g. a single RegexEvaluator runs every
// custom regex rule the user defines in cortex-web). Used when a policy
// declares `type` + `config`; name-based validators are the fallback for
// predefined rules that ship with the plugin.
export type GenericEvaluatorDef = {
  type: string;
  check: (ctx: ValidatorContext, config: Record<string, unknown>) => Promise<ValidatorResult>;
};

// An enforced policy as passed to runValidators. `type` + `config` are
// optional — predefined rules leave them null and fall back to the
// name-based validator registry.
export type EnforcedPolicy = {
  id: string;
  type?: string | null;
  config?: Record<string, unknown> | null;
  severity?: "info" | "warning" | "error" | "block" | null;
};

const registry = new Map<string, ValidatorDef>();
const genericRegistry = new Map<string, GenericEvaluatorDef>();

export function registerValidator(def: ValidatorDef): void {
  registry.set(def.policyId, def);
}

export function getValidator(policyId: string): ValidatorDef | undefined {
  return registry.get(policyId);
}

export function getRegisteredPolicyIds(): string[] {
  return [...registry.keys()];
}

export function registerGenericEvaluator(def: GenericEvaluatorDef): void {
  genericRegistry.set(def.type, def);
}

export function getGenericEvaluator(type: string): GenericEvaluatorDef | undefined {
  return genericRegistry.get(type);
}

export function getRegisteredEvaluatorTypes(): string[] {
  return [...genericRegistry.keys()];
}

export type ReviewResult = {
  policy_id: string;
  pass: boolean;
  severity: "error" | "warning" | "info";
  message: string;
  detail?: string;
};

export type ReviewSummary = {
  total: number;
  passed: number;
  failed: number;
  warnings: number;
};

export type ReviewOutput = {
  results: ReviewResult[];
  summary: ReviewSummary;
};

function resolvePolicySeverity(
  policy: EnforcedPolicy,
  fallback: ReviewResult["severity"],
): ReviewResult["severity"] {
  if (!policy.severity) return fallback;
  return policy.severity === "block" ? "error" : policy.severity;
}

/**
 * Run validators for every enforced policy. Dispatch order per policy:
 *   1. If the policy has a `type`, look it up in the generic evaluator
 *      registry (cortex-web custom rules use this path).
 *   2. Otherwise, look up a name-based validator by policy id
 *      (predefined rules shipped with the plugin use this path).
 *   3. If neither path yields an implementation, emit a warning so the
 *      gap is visible instead of silent.
 *
 * Accepts either `Set<string>` (legacy id-only callers) or an array of
 * `EnforcedPolicy` objects carrying `type` + `config` from the
 * cortex-web policy sync. Set inputs are normalized to entries with
 * null type/config, so they always route to the name-based registry.
 */
export async function runValidators(
  enforced: Set<string> | EnforcedPolicy[],
  ctx: ValidatorContext,
  validatorConfigs: Record<string, Record<string, unknown>>,
): Promise<ReviewOutput> {
  const policies: EnforcedPolicy[] =
    enforced instanceof Set
      ? [...enforced].map((id) => ({ id }))
      : enforced;

  const results: ReviewResult[] = [];

  for (const policy of policies) {
    if (policy.type) {
      const evaluator = genericRegistry.get(policy.type);
      if (!evaluator) {
        results.push({
          policy_id: policy.id,
          pass: false,
          severity: "warning",
          message: `No evaluator registered for type "${policy.type}"`,
          detail:
            "This policy declares a generic evaluator type that is not " +
            "implemented in this version of the enterprise plugin. " +
            "Upgrade the plugin or change the rule type.",
        });
        continue;
      }
      try {
        const result = await evaluator.check(ctx, policy.config ?? {});
        results.push({
          policy_id: policy.id,
          pass: result.pass,
          severity: resolvePolicySeverity(policy, result.severity),
          message: result.message,
          detail: result.detail,
        });
      } catch (err) {
        results.push({
          policy_id: policy.id,
          pass: false,
          severity: "error",
          message: `Evaluator error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      continue;
    }

    const def = registry.get(policy.id);
    if (!def) {
      results.push({
        policy_id: policy.id,
        pass: false,
        severity: "warning",
        message: "No validator implementation registered for this policy",
        detail:
          "This policy is enforced but the server-side check is missing. " +
          "Either install an enterprise plugin that provides it, or disable " +
          "enforcement in the policy dashboard.",
      });
      continue;
    }

    const options = validatorConfigs[policy.id] ?? {};
    try {
      const result = await def.check(ctx, options);
      results.push({
        policy_id: policy.id,
        pass: result.pass,
        severity: resolvePolicySeverity(policy, result.severity),
        message: result.message,
        detail: result.detail,
      });
    } catch (err) {
      results.push({
        policy_id: policy.id,
        pass: false,
        severity: "error",
        message: `Validator error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const summary: ReviewSummary = {
    total: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass && r.severity === "error").length,
    warnings: results.filter((r) => !r.pass && r.severity === "warning").length,
  };

  return { results, summary };
}
