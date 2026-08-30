# Maintained Analysis State — WO-055 Vertical Slice Plan

**Status:** Stage 0 and Stage 1 accepted; Stage 2A CLI reader assigned under Packet 072

**Date:** 2026-08-30

**Initial proving ground:** WO-055 control and review state

**Product posture:** benchmark-first, local-only, default-off

## Outcome

Cortex stops asking each new agent to reconstruct current truth from an
append-only stack of packets, logs, receipts, and review prose. Instead it
maintains a small analysis state in which:

- observations are source-anchored base facts;
- deterministic rules derive current conclusions;
- every derived conclusion retains all supporting proof paths;
- retractions and supersessions invalidate only affected conclusions;
- `why`, `why_not`, and `changes_since` explain current state without replaying
  the full work-order history; and
- semantic retrieval remains available for source text and nuance.

The first vertical slice proves this on the already-known WO-055 evidence. It
does not resume the blind benchmark, repair Packet 069, add a model call,
change a parser, or expose a public API.

## Management Decision

1. Stop the Packet 070 receipt-repair direction. Preserve Packet 062-069 and
   every accepted/rejected outside-Git root as audit history, but do not treat
   another narrative packet as the solution.
2. Preserve the valid technical evidence: SQL-002, TypeScript-002, accepted
   parser/ingest replays, semantic owners, contamination results, reviewer
   findings, and their hashes.
3. Treat the findings from all three Packet 069 NO-GO reviews as active
   observations. They prevent `review_ready(WO-055A)` from being derived.
4. Build the maintained-state capability as a separate, bounded experiment.
   Do not modify the WO-055 candidate generator or private task artifacts.
5. Do not add Lemmalog, Rust, a Datalog parser, or another database dependency
   in the first slice. Revisit build-versus-integrate only after the contract
   is proven with Cortex's own data.

## Existing Cortex Seams To Reuse

- `scaffold/mcp/src/core/workflow/` already owns tracked per-task workflow
  state below `.agents/<task-id>/` and is the eventual integration point.
- `scaffold/mcp/src/enterprise/workflow/state.ts` already recalculates approval
  from blockers. It is useful prior art, not the new storage authority.
- `scaffold/scripts/lib/ingest/incremental-state.mjs` already removes changed
  file facts and dependent relations before hydration.
- Cortex graph ingestion already represents `SUPERSEDES`, and active rules
  already prioritize sources of truth, filter deprecated facts, and surface
  conflicts rather than guessing.
- Existing search, related, impact, graph ranking, and embeddings remain the
  episodic/retrieval half. The new engine answers the different question:
  "what is currently supported, and why?"

## Non-Goals

- General natural-language memory extraction.
- Arbitrary user-authored or remotely supplied executable rules.
- Full Datalog, stratified negation, temporal query language, aggregation,
  entity reconciliation, embeddings, or hypothetical execution in V1.
- Replacing RyuGraph, Cortex search, or the existing workflow stage engine.
- Automatically accepting a work order or bypassing human approval.
- Migrating every historic manager document.
- Deleting or rewriting audit history.

## Core Contract

### Base observation

Every admitted observation has a closed schema:

```text
Observation {
  schema_version: 1
  id: stable content-derived ID
  subject: canonical scoped entity ID
  predicate: registered predicate ID
  object: canonical JSON scalar or tuple
  operation: assert | retract
  target_observation_id: required only for retract
  observed_at: RFC 3339 timestamp
  authority: tool | test | reviewer | manager | artifact
  source: { path, sha256, selector? }
  scope: { repository, work_order, phase }
  supersedes: observation IDs[]
  payload_sha256: canonical payload hash
}
```

Rules:

- Source hashes and selectors are evidence anchors, not self-declared proof
  that the source is trustworthy.
- Retraction targets a concrete prior observation. Security decisions never
  use absence of a fact as proof that a gate passed.
- Unknown predicates, keys, authorities, operations, hash shapes, and unsafe
  paths fail closed.
- Task text, source bodies, credentials, and private bundle contents are not
  observations. Only non-private identities, counts, hashes, and outcomes are
  admitted for the WO-055 fixture.

### Derived fact

```text
DerivedFact {
  id: stable content-derived ID
  subject, predicate, object
  epoch: input generation
  rule_id: versioned code-owned rule
  supports: sorted proof-path IDs[]
  payload_sha256
}
```

A fact with two independent derivations stays active while either derivation
remains. It retracts only when all support paths are invalid. Proof paths are
cycle-safe and terminate at source-anchored base observations.

### Snapshot

```text
AnalysisSnapshot {
  schema_version: 1
  epoch
  ruleset_sha256
  observation_head_sha256
  active_observation_count
  derived_facts[]
  contradictions[]
  blockers[]
  snapshot_sha256
}
```

Canonical state excludes wall-clock generation time from its digest. Identical
observations and rules produce byte-identical snapshots regardless of input
order or process.

## V1 Rule Set

The spike uses a small code-owned Horn-style rule registry, not an arbitrary
rule parser.

```text
task_binding_viable(Task) :-
  binding_exact(Task),
  replay_deterministic(Task),
  distinct_semantic_owners(Task),
  contamination_clear(Task).

work_order_inputs_viable(WO) :-
  required_binding_set_exact(WO),
  every_required_binding_viable(WO).

evidence_trusted(WO) :-
  receipt_schema_closed(WO),
  receipt_externally_anchored(WO),
  negative_probes_observed(WO).

required_reviews_go(WO) :-
  required_review_set_exact(WO),
  every_required_review_go(WO).

review_ready(WO) :-
  work_order_inputs_viable(WO),
  evidence_trusted(WO),
  required_reviews_go(WO).

accepted(WO) :-
  review_ready(WO),
  human_approval(WO).
```

Active blocker findings positively derive `blocked(WO, Finding)`. They do not
depend on negation-as-absence. Contradictory active facts are returned together
with their provenance and block acceptance until explicitly resolved.

## Stage 0 — Benchmark-Only Contract Spike

### Owned files

- `benchmark/bootstrapbench/maintained-analysis-state.mjs`
- `benchmark/bootstrapbench/fixtures/maintained-analysis-state/wo055-v1.json`
- `tests/bootstrapbench-maintained-analysis-state.test.mjs`
- `docs/agent-control/maintained-analysis-state-spike-report.md`

No production, parser, package, workflow, graph schema, CLI, MCP, ownership, or
private-artifact change.

### Work

1. Implement a pure in-memory evaluator with registered predicates and rules.
2. Load a sanitized, hash-only WO-055 observation fixture.
3. Derive `task_binding_viable(wo055a-sql-002)` and
   `task_binding_viable(wo055a-typescript-002)` from their valid
   binding/replay/owner facts. Do not derive whole-work-order input viability:
   Packet 067 did not reach VB6 or VB.NET.
4. Derive the three active review blockers and prove that
   `review_ready(WO-055A)` and `accepted(WO-055A)` are absent with explicit
   missing/contradicting support.
5. Implement:
   - `query(subject, predicate)`;
   - `why(fact_id)` proof tree;
   - `why_not(subject, predicate)` missing/blocked premises;
   - `changes_since(epoch)` added/retracted facts.
6. Apply a synthetic correction observation for one blocker and prove only its
   dependent closure changes.
7. Restore the original input and prove byte-identical state.

### Required tests

- Basic derivation.
- One-support retraction cascade.
- Multiple supports: first removal retains the fact; final removal retracts it.
- Supersession closes the prior validity interval.
- Contradictory active observations block acceptance and retain both sources.
- Unknown schema/predicate/rule/authority/key/hash/path rejection.
- Shuffled input order produces identical facts, proofs, and snapshot bytes.
- Cyclic proof input fails closed without recursion overflow.
- Current WO-055 fixture returns the expected two viable task bindings,
  incomplete whole-work-order input state, and blocked-review state without
  task text.
- Zero network, model, provider, planner, telemetry, solution, or private-bundle
  access.

### Stage 0 acceptance

- Every derived fact has at least one complete proof path to base observations.
- Retraction tests leave zero stale derived facts.
- No acceptance fact is derivable while any Packet 069 blocker is active.
- Fixture replay is byte-identical across two processes and multiple shuffled
  input orders.
- `why` and `why_not` fit a bounded rendered envelope and cite observation IDs
  plus source hashes rather than prose history.
- Existing benchmark-focused tests and `git diff --check` pass.
- One independent Contract/Validation review is sufficient for this
  benchmark-only spike. Security review is added only if the implementation
  acquires filesystem or execution authority beyond reading the frozen fixture.

Stage 0 is the immediate next work order. Stop here for a product decision; do
not auto-advance into persistence.

## Stage 1 — Core Local Persistence

Start only after Stage 0 acceptance and explicit manager authorization.

### Proposed production surfaces

- `scaffold/mcp/src/core/analysis-state/schemas.ts`
- `scaffold/mcp/src/core/analysis-state/engine.ts`
- `scaffold/mcp/src/core/analysis-state/store.ts`
- `scaffold/mcp/src/core/analysis-state/queries.ts`
- bounded adapter changes in `scaffold/mcp/src/core/workflow/`
- focused tests under `scaffold/mcp/tests/analysis-state*.test.mjs`

### Storage

```text
.agents/<task-id>/analysis/
  observations.jsonl
  snapshot.json
  changes.jsonl
```

- Observations are append-only and hash-chained.
- Snapshot publication is atomic and manifest-last.
- Derived facts are rebuilt from active base observations and the exact
  code-owned ruleset; they are never accepted as independent input truth.
- The store is project-root contained and rejects traversal, symlinks,
  hard-link surprises, special files, wrong modes, stale snapshots, and
  project/task identity mismatch.
- Crash recovery replays the observation log and either reproduces the
  snapshot exactly or reports a closed error.

### Workflow adapter

- Existing stage artifacts remain episodic source material.
- Stage/review completion emits observations only through validated adapters.
- `RunState.outcome` remains the public compatibility field initially, but is
  checked against the derived analysis state. A disagreement blocks advancement
  and surfaces both provenances.
- Existing workflow behavior remains unchanged when analysis state is absent or
  explicitly disabled.

### Stage 1 acceptance

- All Stage 0 semantic tests pass unchanged against the persistent engine.
- Atomicity, crash recovery, containment, hash-chain tamper, stale snapshot,
  concurrent writer, and replay tests pass.
- Existing core workflow, Enterprise workflow, CLI, MCP, package, ownership,
  and filesystem-boundary suites do not regress.
- No new network or model call.
- Full Core/Contract/Security/Validation review runs once at this production
  boundary, not once per fixture correction.

## Stage 2 — Opt-In Query And Dogfood

Start only after Stage 1 acceptance.

- Add internal/opt-in CLI operations:
  - `cortex workflow state <task-id>`
  - `cortex workflow why <fact-id>`
  - `cortex workflow why-not <task-id> <predicate>`
  - `cortex workflow changes <task-id> --since <epoch>`
- Add MCP exposure only after CLI JSON contracts and containment are accepted.
- Generate the short "Current State" section of manager/handoff views from the
  snapshot. Keep narrative logs as history; stop treating repeated prose status
  as the current source of truth.
- Dogfood on one new, non-blind work order. Do not reopen WO-055 blind phases as
  the first production experiment.
- Compare fresh-agent context size, stale-conclusion rate, and time-to-correct-
  status against the current packet-only workflow.

Stage 2 remains default-off unless dogfood proves no workflow regression and a
fresh agent can answer current status plus provenance without reading the full
manager history.

## Later Candidates — Explicitly Deferred

Only after the vertical slice is useful:

- general declarative rule parsing and stratification;
- temporal `valid_from`/`valid_to` queries;
- entity reconciliation and aliases;
- aggregation and demand-driven evaluation;
- hybrid retrieval that renders derived state beside episodic snippets;
- hypothetical `what_if` queries; and
- direct Lemmalog integration or a Rust engine.

These are separate product decisions. The first slice must not accidentally
become a general Datalog implementation.

## Migration Of Current WO-055 Evidence

Stage 0 imports only non-private observations:

- SQL-002 and TypeScript-002 binding identities and accepted replay hashes;
- two distinct semantic-owner identities per selected task;
- exact 13+1 preservation and contamination outcomes;
- findings from all three Packet 069 NO-GO reviews;
- the corrected 64-character replay SHA-256 as reviewer-observed evidence,
  while the malformed Packet 069 value remains a superseded control defect;
- compatibility `false` as an active fact that blocks integration; and
- no human approval.

Expected current derivation:

```text
task_binding_viable(wo055a-sql-002)
task_binding_viable(wo055a-typescript-002)
not_derivable(work_order_inputs_viable(WO-055A))
blocked(WO-055A, malformed_control_hash)
blocked(WO-055A, forged_receipt_accepted)
blocked(WO-055A, receipt_not_observed_execution)
blocked(WO-055A, synthetic_negative_results)
not_derivable(review_ready(WO-055A))
not_derivable(accepted(WO-055A))
```

No old artifact is rewritten to manufacture consistency. New observations
supersede or retract old conclusions with explicit provenance.

## Stop Conditions

Stop before product integration if any of these occur:

- WO-055 requires task-specific hard-coded branching rather than registered
  domain predicates and generic rules.
- A derived fact cannot explain every active support path.
- Retraction leaves a stale conclusion or removes a conclusion that still has
  independent support.
- Security status relies on absence of evidence.
- The snapshot trusts its own rehashed claims without an external observation
  anchor.
- The spike needs private task text, a solution, network access, a model call,
  parser changes, or another database/runtime dependency.
- The new state is larger or harder for a fresh agent to interpret than the
  bounded current-state plus proof output it replaces.

## Implementation Sequence

1. Freeze and review the Stage 0 observation/rule schemas.
2. Implement the pure evaluator and proof graph.
3. Add retraction, multiple-support, contradiction, and deterministic snapshot
   tests before loading WO-055 evidence.
4. Build the sanitized WO-055 fixture from current artifact hashes and reviewer
   findings.
5. Run the two-process replay and fresh-agent `state`/`why`/`why_not` smoke.
6. Write the spike report with measured context size and unresolved risks.
7. Hold for a product decision: stop, revise the contract, integrate the small
   native engine, or evaluate Lemmalog as an external engine.

## Sources

- Cortex core workflow:
  `scaffold/mcp/src/core/workflow/`
- Existing blocker-derived approval:
  `scaffold/mcp/src/enterprise/workflow/state.ts`
- Existing incremental relation invalidation:
  `scaffold/scripts/lib/ingest/incremental-state.mjs`
- Cortex graph/rules:
  `scaffold/mcp/src/graph.ts`, `scaffold/mcp/src/loadGraph.ts`,
  `scaffold/mcp/src/rules.ts`
- Agent control contract:
  `docs/agent-control/workflow-playbook.md`,
  `docs/agent-control/review-iteration-protocol.md`
- Design inspiration:
  <https://pwning.systems/posts/llm-memory-program-analysis/>
- Lemmalog implementation reference:
  <https://github.com/JordyZomer/lemmalog>
