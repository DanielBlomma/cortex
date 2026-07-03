# Review Iteration Protocol

Every work order must go through a review iteration before manager acceptance.
The first implementation pass is not considered complete until review findings
are logged, triaged, and either fixed or explicitly deferred by the manager.

## Required Loop

1. Assignment: manager creates context packet and handoff entry.
2. First pass: implementation or contract agent returns files, tests, risks, and decisions.
3. Review pass: at least one reviewer agent inspects the output against its gate.
4. Triage: manager records findings as fix-now, defer, or reject.
5. Iteration: owning agent fixes accepted findings.
6. Validation: validation agent reruns focused tests for the iterated scope;
   the full matrix runs once at acceptance (CI is the authoritative full run).
7. Acceptance: manager updates handoff ledger, risk register, acceptance matrix, and PR body.

## Reviewer Roles

| Reviewer | Required For | Focus |
|---|---|---|
| Code Quality Reviewer | Runtime, CLI, frontend, parser, and test changes | Local patterns, maintainability, naming, useful comments, minimal abstraction, meaningful tests |
| Security and Privacy Reviewer | MCP tools, daemon/hooks, dependency changes, workflows, release paths | Local-only behavior, source upload risk, secrets, permissions, unexpected network calls, supply-chain exposure |
| Validation Reviewer | Every implementation work order before acceptance | Correct focused command set, coverage gaps, missing negative cases, audit/build failures, live smoke evidence |
| Contract Reviewer | MCP schemas, CLI flags, config formats, parser output, benchmark JSON, release metadata | Backward compatibility, migration order, source-of-truth conflicts, documented contracts |
| Integration Reviewer | Stacked PRs, shared files, generated data, cross-package changes | Merge order, conflict risk, package boundary behavior, lockfile/generated artifact consistency |
| Frontend/Product Reviewer | Website, benchmark pages, docs that drive user workflows | Usability, responsive layout, data clarity, broken links, Pages behavior |
| Ops/Release Reviewer | GitHub Actions, npm/plugin release, Pages deploy, benchmark publish | Workflow permissions, deploy readiness, rollback path, version sync, tag/publish safety |

## Minimum Review Requirements

| Work Order Type | Required Reviewers |
|---|---|
| Core MCP/runtime | Code Quality Reviewer, Contract Reviewer, Security and Privacy Reviewer, Validation Reviewer |
| CLI/scaffold/parser | Code Quality Reviewer, Contract Reviewer, Validation Reviewer |
| Frontend/benchmark site | Frontend/Product Reviewer, Validation Reviewer; add Ops/Release Reviewer when Pages or workflow behavior changes |
| Benchmark harness/data | Contract Reviewer, Integration Reviewer, Validation Reviewer |
| Dependency update | Security and Privacy Reviewer, Validation Reviewer; add Ops/Release Reviewer for build-tool or Node engine changes |
| Release/distribution | Ops/Release Reviewer, Security and Privacy Reviewer, Validation Reviewer, Control Manager |
| Docs/process only | Code Quality Reviewer; add Security and Privacy Reviewer when docs change agent policy or release/security instructions |

## Work Profiles

Every work order is classified into exactly one profile in its context
packet, with a one-line motivation. The profile decides the reviewer panel,
the validation level, and the pipeline weight. Do not maintain a second
classification anywhere else.

| Profile | When | Reviewer panel |
|---|---|---|
| Pattern work | Repeats an already accepted pattern; the packet must name the reference work order | Security and Privacy Reviewer + Validation Reviewer |
| New contract/design | New policy, API/entity contract, or architecture | Full panel per the Minimum Review Requirements table |
| Docs/process | No runtime code affected | One reviewer + security scan |
| Infra/deploy/security-sensitive | Workflows, deploy scripts, infrastructure, auth surfaces | Security Reviewer + Ops/Release Reviewer + Validation Reviewer |

Profile rules:

- Escalation is free: any implementer or reviewer may escalate a work order
  to a heavier profile at any time, with one logged sentence. De-escalation
  requires a logged manager decision.
- Evidence-based pruning: a reviewer role that has produced no accepted
  findings across recent work orders is dropped from default panels (it stays
  available on request). Pruning decisions are recorded in `manager-log.md`
  with the handoff-ledger evidence that motivated them.

## Finding Format

Review findings must use this shape:

- Severity: `blocker`, `major`, `minor`, or `note`.
- Area: policy, security, validation, data, integration, product.
- Finding: concise issue.
- Evidence: file, route, matrix row, test, or staging observation.
- Required action: fix, defer with rationale, or manager decision.

## Manager Rules

- Review Assignment Gate: required reviewers must be named before work starts,
  and reviewers cannot be the same agent/team that produced the first pass.
- First-Pass Quality Gate: implementation agents must submit readable,
  maintainable code with relevant tests and concise documentation before review.
- Review Intake Gate: review cannot start until changed files/entities, tests,
  risks, and open decisions are logged.
- Triage Gate: blocker and major findings are classified as fix-now, reject, or
  defer with a risk-register entry.
- Iteration Closure Gate: accepted findings require evidence, rerun validation,
  and reviewer sign-off before manager acceptance.
- Dependency Release Gate: dependent work orders cannot start from an upstream
  contract until review is accepted or deferrals are explicitly carried forward.
- Blocker findings must be fixed before acceptance.
- Major findings require either a fix or explicit manager deferral in the risk register.
- Minor findings can be batched if they do not affect staging readiness.
- Notes do not block acceptance but should inform the next context packet.
- Review and iteration status must be visible in the handoff ledger.

## Manual Review And Auto-Advance

The canonical auto-advance rule, including parallel work orders and branching,
lives in `workflow-playbook.md`. Review-specific rules:

- After each work order reaches manager acceptance, the manager must leave the PR
  and handoff ledger in a review-ready state with changed files, validation,
  reviewer outcomes, known gaps, and stack position recorded.
- While the user is manually reviewing, implementation agents must not mutate the
  reviewed branch unless the user asks for an iteration or a blocker must be fixed.
- If manual review later reports findings on an earlier PR, the manager must pause
  downstream work only when the finding changes a contract, invalidates dependent
  work, or is marked blocker/major.
- The manager must log every auto-advance decision, selected next work order,
  skipped blocked work order, and context packet refresh in `manager-log.md`.

## Code Quality Baseline

Implementation agents are expected to meet this baseline before reviewer handoff:

- Code follows existing local patterns and avoids unnecessary abstraction.
- Names describe domain behavior instead of implementation trivia.
- Comments explain non-obvious policy, security, or transaction choices only.
- Tests cover meaningful behavior and negative cases, not only happy paths.
- Tests avoid brittle formatting assertions when observable behavior is enough.
- Documentation names residual gaps honestly instead of implying full coverage.
