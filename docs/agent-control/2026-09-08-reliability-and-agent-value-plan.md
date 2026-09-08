# Cortex Reliability and Agent Value Plan

Date: 2026-09-08
Status: WO-RV-001 reconciliation accepted locally after independent review; runtime implementation and live evaluation have not started.

2026-09-08 correction: the initial assessment below measured an old dirty 2.4.2
branch, not current main. [Reconciliation](wo-rv-001-baseline-reconciliation.md)
supersedes its baseline assumptions and maps the original branch-local
WO-050..057 aliases to qualified WO-RV-001..008 IDs. All future implementation
starts at fetched main `b7d466fa474dfa97fb77a931a674080801e6fa77` (2.7.0).
Main already contains reviewed containment, progressive indexing, released
Harness, dialect and maintained-analysis work. Historical pauses below do not
roll back shipped capabilities or supersede main's later control registry.
Refresh main-specific gates from the next packets; the old test/audit totals
are not current-main acceptance.

## Objective and scope

Make Cortex dependable enough to trust, then measure whether it helps the same
agent finish real tasks better than its native tools alone. The outcome is a
decision to invest in full retrieval, focus on lexical/graph retrieval, or
reduce the product scope if neither earns its operating cost.

This plan responds to the user's three priorities: reliability fixes, explicit
graph uncertainty and resource limits, and a held-out three-arm comparison.
Planning does not launch provider calls, publish packages, change defaults, or
activate unrelated backlog items. WO-049 was paused in the old branch's lineage;
main's released Harness implementation is part of the selected baseline.

## Evidence and starting state

The 2026-09-08 assessment observed the following; refresh these facts at the
first implementation handoff rather than treating them as permanent results:

- Installed CLI 2.4.1; checkout package 2.4.2; 49 modified tracked files and
  42 untracked entries. Preserve the existing work and establish its provenance.
- Doctor reported 100% freshness while status reported 87% with 90 changed
  paths. Doctor does not normalize repository-root source scope `.`.
- Root 365 tests plus 81 regression checks, runtime 433 tests, and an eight-file
  supplemental selection of 110 tests passed. The root test script omits 18
  test files. Checked-in workflows have no pull-request core test trigger.
- Lockfile audits found frontend 2 high and runtime 4 high/2 moderate
  vulnerabilities; both parser trees passed. These are audit findings, not
  demonstrated Cortex exploits.
- Call edges use same-file name matching. Keyword matches can produce
  IMPLEMENTS rule edges; neither should imply verified semantic correctness.
- WO-046's scoped MiniLM Angular prototype reached search readiness in 9.753 s
  below 0.76 GiB peak RSS, but full semantic coverage returned 21/42 expected
  hits versus lexical+graph's 25/42. The manager log separately records Jina
  updates peaking at 21.2 GB; these are different model conditions.
- WO-043/044 provide small, conflicting paired results. The manager log reports
  WO-047 2/5 and WO-048 4/4 treatment mechanisms without an issue-only control.
  Their referenced files were missing at assessment time. WO-RV-001 recovered
  exact Git bytes and verified saved patch hashes; see the reconciliation's
  recovered links. Neither treatment-only smoke establishes retrieval uplift.

Direct references: [doctor](../../scaffold/scripts/doctor.sh),
[status](../../scaffold/scripts/status.sh),
[ingest](../../scaffold/scripts/lib/ingest/pipeline-stages.mjs),
[test/audit entrypoints](../../package.json),
[release workflow](../../.github/workflows/release-publish.yml),
[WO-046 results](wo046-progressive-background-indexing-results.md),
[manager log](manager-log.md), and [risk register](risk-register.md).
Cortex context consulted includes `file:docs/agent-control/agent-work-orders.md`
and `file:scaffold/mcp/src/embeddings.ts`; direct files resolve index ambiguity.

## Work orders and sequence

Each row is one future work order in a fresh session and isolated branch or
worktree. Prepare its focused packet and name independent reviewers before
implementation. The initial planning turn only authored this plan; WO-RV-001 now reconciles its
baseline and namespace before independent acceptance.
The original reconciliation is now accepted locally. Its numbered packet alias
038 is published as `rv-001-baseline-reconciliation.md`; use the qualified
packet and work-order names for new work, without renumbering historical main IDs.

| Order | Owner | Scope and affected surfaces | Acceptance gate | Dependencies |
|---|---|---|---|---|
| WO-RV-001 | Control Manager + Validation | Reconcile worktree, installed/package/runtime versions, missing WO-047/048 artifacts, obsolete work-order statuses, and WO-034/035 containment evidence. Produce a source-backed baseline and proposed patch ownership map. | Every active handoff reference resolves or is explicitly unavailable; unrecovered results stay unverified; exact executable/source/index identities and next packet are recorded; no existing edits lost. | First; packet rv-001 |
| WO-RV-002 | CLI and Runtime | Unify freshness semantics across doctor/status/dashboard/query responses and ingest/graph/embedding manifests. Include root-scope normalization and content/generation identity. | Accurate fresh/stale/partial/unavailable states across dirty edits, already-indexed dirty files, commits with a clean tree, branch switches, deletions/renames, untracked files, Git failure, and mixed generations. Age and working-tree cleanliness alone never establish freshness. | WO-RV-001 |
| WO-RV-003 | Security and Privacy + Release | Refresh dependency findings and apply minimal compatible manifest/lockfile fixes across frontend, runtime, and parser trees. | Every tree passes the existing low-or-higher audit gate; clean installs, runtime/native dependency smokes, frontend build, relevant tests, package/version checks. No blanket major upgrades or security-gate relaxation. | WO-RV-001 |
| WO-RV-004 | Release and Distribution + Validation | Add PR core checks, explicit fast/integration test lanes, and test-file inventory enforcement in package scripts and workflows. | Root/runtime checks run on ordinary PRs; a new test cannot silently escape all lanes; optional tooling and slow fixtures have named jobs and visible skip reasons; failure propagates; untrusted PRs require no secrets. Document/check repository branch protection separately from workflow presence. | WO-RV-001; final green acceptance after WO-RV-003 |
| WO-RV-005 | Parsers and Ingest + Core Runtime | Expose graph edge provenance, resolution status, and ambiguity consistently through related/impact and retrieval evidence. Separate inferred rule relevance from verified compliance. | Same-name, alias, shadowing, cross-file, unresolved, and keyword-rule fixtures never present an inference as a verified call or compliance fact; legacy graphs have explicit unknown provenance; additive schema/migration compatibility tested. | WO-RV-002; coordinate existing WO-002 |
| WO-RV-006 | CLI and Runtime + Validation | Extend WO-046 into measured foreground/background resource behavior for the default Jina model, including native allocations, process-tree limits, interruption/resume, and partial search. | Numeric resource contract frozen before performance validation; default-model cold/incremental/resume cases satisfy it or explicitly fall back/fail; complete/partial states and model-specific quality deltas disclosed; no automatic model/default switch. | WO-RV-002; coordinate WO-005/008/020/046 and WO-034/035 containment |
| WO-RV-007 | Frontend and Benchmarks + Validation | Freeze three-arm evaluation contract, held-out selection, scoring, native-tool parity, installed artifact, and a minimal reusable harness. Validate offline with fake agents and synthetic outputs. | Deterministic task/arm dispatch, identical shared budgets, no gold leakage, complete accounting of failures/tokens/time/index cost, verified test oracle, reproducible source identities, and a concrete model/run/cost proposal. | Contract preparation after WO-RV-001; final freeze after WO-RV-002 through WO-RV-006 |
| WO-RV-008 | Validation + Control Manager | Execute the frozen comparison and write the product decision, with per-task outcomes and uncertainty. | All planned attempts accounted for, no selective retries or post-result tuning, primary metrics and regressions reported, recommendation matches the predeclared decision rules. | Accepted WO-RV-007; explicit live-run/model/cost authorization |

WO-RV-001 creates the next focused packets: [freshness](context-packets/rv-002-freshness.md),
[dependencies](context-packets/rv-003-dependencies.md), and
[PR checks](context-packets/rv-004-pr-checks.md). WO-RV-002/003/004 can proceed independently
after it when scopes are disjoint. Shared package/workflow files require a
recorded integration order. WO-RV-005 and WO-RV-006 may overlap only after checking
shared graph/types/manifest/test ownership. No broad refactor is needed to start.

Existing WO-002 remains the owner of improved call resolution; WO-RV-005 first
makes its current limits truthful. WO-034/035 remain the owners of filesystem
containment and packed-artifact acceptance. Main includes their reviewed historical acceptance. Preserve the older local
candidate as evidence; do not recreate or overlay its incomplete fixes. Any still-open release-blocking containment finding
must close before release or live evaluation using affected paths.

## Gate 1: trustworthy operation

WO-RV-001 through WO-RV-004 establish a reproducible baseline, truthful health signals,
current dependency remediation, and repeatable PR checks. A clean Git tree is
not itself a correctness condition: source fingerprints and generation links
must tell whether uncommitted content has already been indexed.

Do not upgrade or refresh the installed user runtime merely to hide version
drift. Validate the intended package in an isolated project first. Shared
freshness logic should preserve existing CLI/JSON contracts where possible.

## Gate 2: dependable context and bounded operation

Graph output must distinguish resolved, inferred/ambiguous, and unresolved
relationships with supporting source spans or an explicit absence of evidence.
Do not invent numeric confidence probabilities without calibration. Impact
results explain which relations support their traversal and what is unknown.

WO-RV-006 must set numeric budgets in its focused packet before measuring the
candidate: total indexing process-tree RSS including native inference, worker
and thread concurrency, index disk retention, readiness latency, and query
latency while indexing. An initial proposed interactive target is 4 GiB RSS,
at most four inference threads, and at most two ingest workers on a 16 GiB
machine. Validate hardware fit and default-model feasibility before adopting
these as acceptance limits; report every revision before candidate results.

Separate enforced OS memory limits from a monitored stop threshold with possible
overshoot. If a platform cannot provide a hard cap, expose that limitation and
the measured bound. A budget breach must preserve the last usable generation,
surface an explicit reason, and allow recovery. Node heap limits alone do not
bound native inference memory. Foreground update and Git/watch-triggered work
must not silently bypass the chosen resource policy.

Use a small repo, a pinned large TypeScript repo, and a mixed-language repo for
resource validation; these are development fixtures, not the held-out task set.
Record model, scope, hardware, cold/warm cache, throughput, failure count,
peak RSS, disk growth, and retrieval quality separately. The MiniLM prototype
does not establish a default-Jina budget or a universal semantic quality gain.

## Gate 3: held-out agent value

The proposed evaluation is deliberately small enough to execute, but large
enough to move beyond three-task anecdotes. Final selection and statistical
precision are reviewed in WO-RV-007 before looking at treatment outcomes.

| Arm | Available tools and context |
|---|---|
| A: native | The chosen agent's standard repository tools and common project instructions. No Cortex tools, index access, injected retrieval, or Cortex-specific search mandate. |
| B: lexical + graph | All A capabilities plus the frozen Cortex CLI in lexical/graph mode; query-time embedding and embedding retrieval disabled and verified. |
| C: full Cortex | All A capabilities plus the same Cortex interface/usage instructions as B with the frozen default embedding model enabled. Experimental enrichment remains off unless separately selected before freezing. |

Use tool-driven retrieval for B and C. Keep native tools available in every arm;
do not force treatments into static packets or limit only their file exploration.
Retain identical task-relevant repository rules in every arm. Normalize only
Cortex-specific agent instructions, using a recorded diff, so A is a legitimate
native-agent baseline and B/C differ only in retrieval mode.

Proposed sample: 30 new tasks across at least three repositories and three
language ecosystems, stratified across bug fixes, small features, and multi-file
changes. Two independent attempts per task per arm gives 180 solution invocations.
Each attempt starts from the same pinned task commit in a fresh isolated workspace.
This is a proposal, not a spending authorization or an assertion of statistical
power. A separate six-task, one-attempt, three-arm calibration pilot would add
18 invocations; those tasks are permanently excluded from the held-out set.
The final request must list both counts, rather than hiding the pilot overhead.

Select tasks by predeclared eligibility and coverage criteria before retrieving
candidate results. Historical WO-040 through WO-048 tasks and ranking query packs
are excluded from held-out scoring. Public issue selection prevents local tuning
leakage but cannot prove absence from a model's training data; disclose that limit.
Freeze the task list, source commits, agent/model identity, reasoning level,
tool configuration, attempt/time/token budgets, model files, retrieval settings,
evaluation environment, and test commands. Keep gold patches and hidden tests
outside agent and index access. Shared resources and randomized/interleaved arm
order prevent cache or machine contention from favoring one arm.

Primary quality metric: task resolution by the frozen executable oracle,
including required regression tests. Mechanism rubrics are secondary and judged
without arm labels; inability to run the oracle is not a pass. Report unresolved,
timed-out, invalid, infrastructure-failed, and cancelled attempts explicitly.
Predeclare symmetric infrastructure invalidation/replacement rules; never drop
one unfavorable arm or retry only failures. Repeated attempts remain paired by
task and are not treated as independent new tasks.

Record these costs for every task/attempt:

- Completed tasks and regressions, per task and repository.
- Agent elapsed time and end-to-end time including indexing and retrieval.
- Input/output/cached tokens separately, tool calls, retrieval latency, and
  source bytes exposed through Cortex.
- Initial and incremental index wall time, process-tree peak RSS, disk footprint,
  and model download/cache conditions; separate cold and warm measurements.
- Actual charge when available; distinguish subscription usage from a marginal
  API-price estimate. Show index-cost amortization at 1, 5, and 20 tasks per repo.

Report B versus A, C versus A, and C versus B with task-paired uncertainty
intervals, per-repository breakdowns, and regression lists. Predeclare the
resampling/comparison method and account for multiple primary comparisons.

Proposed decision thresholds, frozen before held-out execution:

- Expand investment if an arm improves resolution by at least 10 percentage
  points and the paired 95% interval excludes zero, without critical regressions.
- An efficiency case can also justify investment: at least 20% lower median
  end-to-end time, with the paired quality interval excluding a drop worse than
  5 percentage points, no critical regressions, and transparent token/index cost.
- Prefer lexical/graph as the product focus if it passes a value gate and full
  retrieval has no supported incremental benefit. Do not silently change defaults.
- If intervals cannot distinguish these outcomes, label the result inconclusive;
  propose one independently justified follow-up with a new budget. Do not tune
  against this holdout and reuse it as evidence of general improvement.
- If neither arm meets a value gate and costs/regressions dominate, narrow Cortex
  to demonstrated navigation/rule use cases or maintenance rather than adding
  further integrations. Public claims remain limited to measured conditions.

## Review, validation, and handoff

Use the existing [review protocol](review-iteration-protocol.md); assign actual
independent reviewers in each fresh packet. Planning rows are not acceptance.
Apply focused tests during work and the required full matrix once at acceptance;
the PR workflow becomes authoritative after WO-RV-004. Preserve package ownership,
CLI compatibility, local-data boundaries, and R16 until its own closure evidence.

Reuse existing benchmark infrastructure where it fits. Do not restart terminal
WO-045 attempts or rebuild its entire experimental harness as a prerequisite.
Proportionate, runnable isolation and oracle checks take priority over elaborate
freeze machinery that has no bearing on the declared comparison.

First executable handoff: [packet rv-001](context-packets/rv-001-baseline-reconciliation.md).
After each acceptance, update the work orders, requirement coverage, risk register,
and handoff ledger so a new session needs no chat history. Refresh Cortex after
substantial runtime changes under the validated resource policy; do not treat a
stale index or a green doctor check as evidence that source review is unnecessary.
