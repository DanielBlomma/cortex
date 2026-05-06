import type { WorkflowDefinition } from "./schemas.js";

/**
 * The default secure-build workflow that ships with Cortex. Organizations
 * can override this from cortex-web later (Phase 2 of the harness rollout);
 * until then this is the workflow every project gets out of the box.
 */
export const SECURE_BUILD_WORKFLOW: WorkflowDefinition = {
  id: "secure-build",
  description:
    "Plan → Review → Build → Review → Mutation Tests → Security Review → Human Approval. " +
    "The default Cortex Harness workflow for AI-driven development on production code.",
  version: 1,
  stages: [
    {
      name: "plan",
      artifact: "plan.md",
      reads: [],
      required_fields: ["files_targeted", "constraints"],
      validators: [],
      capability: "planner",
      description:
        "Produce a step-by-step implementation plan grounded in the repo's rules and memory.",
    },
    {
      name: "plan-review",
      artifact: "plan-review.md",
      reads: ["plan"],
      required_fields: ["approved", "blocking_comments"],
      validators: [],
      capability: "reviewer",
      description:
        "Review the plan for architectural fit and rule compliance before any code is written.",
    },
    {
      name: "build",
      artifact: "changes.md",
      reads: ["plan", "plan-review"],
      required_fields: ["files_changed"],
      validators: [
        {
          id: "build-passes",
          description:
            "The project's build / typecheck command must succeed on the produced diff.",
        },
        {
          id: "tests-pass",
          description:
            "The project's existing test suite must pass on the produced diff.",
        },
      ],
      capability: "builder",
      description:
        "Implement the approved plan. Produces the diff manifest used by the downstream reviewers.",
    },
    {
      name: "build-review",
      artifact: "build-review.md",
      reads: ["plan", "changes"],
      required_fields: ["approved", "blocking_comments"],
      validators: [],
      capability: "reviewer",
      description:
        "Review the implementation against the plan and the project's rules.",
    },
    {
      name: "mutation",
      artifact: "mutation-report.md",
      reads: ["changes"],
      required_fields: ["score", "survived"],
      validators: [
        {
          id: "mutation-score",
          description:
            "Mutation testing tool of the agent's choice (e.g. stryker, mutmut) must run and report a score against the changed files.",
        },
      ],
      capability: "tester",
      description:
        "Run mutation tests on the changed files. Report score + surviving mutants.",
    },
    {
      name: "security",
      artifact: "security-report.md",
      reads: ["changes"],
      required_fields: ["findings", "severity_summary"],
      validators: [
        {
          id: "secret-scan",
          description:
            "Scan the diff for newly committed secrets (API keys, tokens, credentials).",
        },
        {
          id: "dependency-audit",
          description:
            "Audit any added or upgraded dependencies for known vulnerabilities.",
        },
      ],
      capability: "security-reviewer",
      description:
        "Security review focused on the diff: injection, authn/authz, secrets, dependency risk.",
    },
    {
      name: "approval",
      artifact: "approval.md",
      reads: ["plan", "changes", "build-review", "mutation", "security"],
      required_fields: ["approved", "approver"],
      validators: [],
      capability: "human",
      description:
        "Human sign-off. Pulls every prior artifact for the approver to read; the approver writes the artifact.",
    },
  ],
};

export const DEFAULT_WORKFLOWS: Record<string, WorkflowDefinition> = {
  [SECURE_BUILD_WORKFLOW.id]: SECURE_BUILD_WORKFLOW,
};
