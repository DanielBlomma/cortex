# WO-RV-001: Reliability Baseline Reconciliation

Original plan alias: WO-050 (old branch only). Current-main IDs already overlap;
use the qualified namespace and [baseline report](../wo-rv-001-baseline-reconciliation.md).
Main `b7d466fa474dfa97fb77a931a674080801e6fa77` (2.7.0), not the old dirty
checkout, is the selected future implementation baseline. This packet's tasks
below describe the original reconciliation scope; recovered artifacts and
historical acceptance are now recorded in the report. The next packets are
[rv-002](rv-002-freshness.md), [rv-003](rv-003-dependencies.md), and
[rv-004](rv-004-pr-checks.md).

Status: WO-RV-001 accepted locally after independent review, documentation only. Continue in a fresh session with rv-002-freshness.md.
Work profile: Docs/process — establish provenance and a runnable handoff before
changing runtime behavior. Owner: Control Manager + Validation. Required review:
independent Code Quality reviewer and Security/Privacy review of control changes.
Assignment recorded before implementation on 2026-09-08: owner
`/root/wo050_owner`; independent Code Quality and Security/Privacy reviewer
`/root/wo050_review`; independent Validation reviewer `/root`. Implementation
worktree: `/private/tmp/cortex-wo050.YaeMq8/repo`. The original checkout is
read-only evidence; copied pre-existing control edits are not WO-050 changes.

## Objective

Make the current checkout, installed runtime, and control records reconcilable
without losing existing edits or inventing missing experiment evidence.

## Read first

- [Program plan](../2026-09-08-reliability-and-agent-value-plan.md).
- [Workflow](../workflow-playbook.md) and [review protocol](../review-iteration-protocol.md).
- [Work orders](../agent-work-orders.md), [manager log](../manager-log.md),
  [handoff ledger](../handoff-ledger.md), [acceptance matrix](../acceptance-matrix.md),
  and [risk register](../risk-register.md).
- Direct source: `package.json`, `bin/cli/project-runtime.mjs`,
  `scaffold/scripts/doctor.sh`, `scaffold/scripts/status.sh`, and
  `scaffold/scripts/lib/ingest/filesystem-boundary.mjs`.

## Tasks

1. Run Cortex search/rules and read-only Git inventory. Record HEAD, branch,
   tracked/untracked changes, executable path/version, package/runtime identity,
   and ingest/graph/embedding generation metadata. Record dates as observations.
2. Map existing edits to WO-034/035, WO-036 through WO-049, or unknown ownership.
   Produce a proposed integration sequence; do not stage, discard, commit, move,
   or overwrite unknown edits. Use an isolated worktree for implementation.
3. Locate missing `036-two-pass-subsystem-retrieval.md`,
   `wo047-quick-five-treatment-results.md`, and `wo048-quick-four-treatment-results.md`
   through repository history and direct referenced artifact locations. Restore
   only from verified evidence, or mark references unavailable and summaries
   unverified. The existing differently named packet 036 is not interchangeable.
4. Reconcile active WO-045/047/048 states against the manager log. Preserve the
   terminal WO-045 disposition and separate historical approval from new authority.
5. Establish whether WO-034's local output-containment changes are complete and
   reviewed, and list precisely what WO-035 acceptance still needs. Do not close
   R16 from source inspection alone.
6. Write a concise baseline/handoff report and focused WO-RV-002/003/004 packets
   with exact owned surfaces, required reviewers, and validation commands.

## Acceptance

- Active references resolve or explicitly disclose missing evidence.
- A new session can identify the intended baseline, existing-edit ownership,
  outstanding containment gates, and next bounded task without conversation history.
- Installed versus checkout versions and stale/mixed indexes remain explicit.
- New relative links and work-order/requirement/risk IDs validate; diff is clean
  of whitespace errors; independent review findings are addressed.

No model calls, publication, default changes, or broad index rebuild is needed
for this reconciliation. Runtime fixes belong to subsequent fresh work orders.
