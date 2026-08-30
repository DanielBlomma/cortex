# WO-056 Maintained Analysis State — Benchmark-Only Spike

## Objective

Implement Stage 0 of the accepted maintained-analysis-state plan: a pure,
local, benchmark-only evaluator that turns source-anchored observations into
deterministic current facts, complete proof paths, retractions, contradictions,
and bounded `why`/`why_not`/`changes_since` answers.

Use the existing WO-055 evidence as a sanitized hash-only fixture. Prove that
SQL-002 and TypeScript-002 are individually viable bindings while the whole
WO-055A input set, trusted receipt state, review readiness, and acceptance are
not derivable. Do not resume WO-055, repair Packet 069, or add product runtime.

## Starting State

- Branch `feature/wo056-maintained-analysis-state-spike`.
- Worktree `/Users/danielnilsson/GIT/cortex-wo056-maintained-analysis-state`.
- Start after the Packet 070 control commit is HEAD.
- Fresh packet-only session. Read repository `AGENTS.md`, this packet, the
  complete plan, and only the direct references below. Run Cortex
  search/rules/impact before conclusions.
- Packets 062-069 and all accepted/rejected outside-Git roots remain immutable
  audit history. Do not open private task bundles or task text.

## Work Profile And Review

Benchmark-only contract spike. One fresh combined Contract/Validation reviewer
after implementation. Add Security review only if the implementation expands
beyond reading the tracked frozen fixture or gains filesystem/execution
authority not explicitly listed here.

## Exact Owned Scope

Only these four tracked files:

1. `benchmark/bootstrapbench/maintained-analysis-state.mjs`
2. `benchmark/bootstrapbench/fixtures/maintained-analysis-state/wo055-v1.json`
3. `tests/bootstrapbench-maintained-analysis-state.test.mjs`
4. `docs/agent-control/maintained-analysis-state-spike-report.md`

No production, parser, package, dependency, lockfile, ownership, workflow,
graph schema, CLI, MCP, control-policy, candidate generator, task, private
artifact, or outside-Git mutation. No network, model/provider, planner,
telemetry, solution, gold, treatment, recurrence, score, or reveal access.

## Direct References

1. `docs/superpowers/plans/2026-08-30-maintained-analysis-state.md` — complete
   Stage 0 contract, non-goals, rules, gates, and stop conditions.
2. `scaffold/mcp/src/core/workflow/` — future integration seam, read-only.
3. `scaffold/mcp/src/enterprise/workflow/state.ts` — existing blocker-derived
   approval prior art, read-only.
4. `scaffold/scripts/lib/ingest/incremental-state.mjs` — existing dependent
   relation invalidation prior art, read-only.
5. `scaffold/mcp/src/rules.ts`, `scaffold/mcp/src/graph.ts`, and
   `scaffold/mcp/src/loadGraph.ts` — current rule/conflict/supersedes context,
   read-only.
6. `docs/agent-control/context-packets/067-wo055a-sql-bridge-fail-closed-closure.md`
   through Packet 069 plus the 2026-08-30 manager/handoff rows — sanitized
   evidence authority. Do not chase private paths from them.

## Frozen Non-Private Evidence

### SQL-002

- Task ID `wo055a-sql-002`; task SHA-256
  `40732b420c0015f3fbb443011faa6b29437f0c1497e439ae291821ff7f1ad336`.
- Repository base `5c00293a2de843a571b35fbad5808f84d1f1ac74`, tree
  `4363f0e401e612bda286bd89042f5614d3143d60`.
- Accepted ingest: 2 documents, 62 chunks, 64 relations, 21 graph inputs.
- Index SHA-256
  `6e823be2a3d88e96e494e1555282c922be08e64f6cde0fe2f3e21b7cd1f9c240`.
- Two distinct semantic owners and zero selected collisions are established by
  Packet 067. SQL-002 remains a viable task binding.

### TypeScript-002

- Task ID `wo055a-typescript-002`; task SHA-256
  `06a227c99135fd8406da48660f76f989f73eb54aad49cacabcbdece5c17c04a5`.
- Repository base `972968eba6c796e00d59c455243e5f958c3ba052`, tree
  `541df519ff7a14fe1b4889b929764c259a01c116`.
- Source catalog SHA-256
  `f232498158bb3e2fc9299e24e21a59d97401abd5ea610bff63e1d903a44256f6`.
- Accepted ingest twice: 1 document, 23 chunks, 26 relations, 21 graph inputs,
  zero parse errors.
- Index SHA-256
  `628948a48fe1cdfe234f5ef592589417bb455cc6fefb27bd7e5bb013e0dc6ab3`;
  correct replay SHA-256
  `f2f09aec63932a12784a62b302e7082f04b47385bb00b3efafc2919928f6e6d2`.
- Semantic owners
  `owner-v4:cf44fee89e26fe3313dfbe1c6264367992daa48ad01931da96f570d7b2da6e0c`
  and
  `owner-v4:afa858d77518cc8ab5fab63174a22d39c1f1a883e2c22f3e3056f543732ca619`.
- TypeScript-002 remains a viable task binding with zero selected collisions.

### Active limitations and blockers

- Packet 067 stopped before VB6 and VB.NET. Therefore
  `work_order_inputs_viable(WO-055A)` is not derivable from current evidence.
- Packet 069 froze a malformed 63-character replay digest; reviewers observed
  the correct 64-character digest above. Preserve both observations and mark
  the malformed control value superseded; do not rewrite Packet 069.
- All three independent Packet 069 reviews returned NO-GO. Active blocker
  observations cover:
  1. canonically rehashed forged request, denial, negative, runtime, and open
     receipt evidence accepted by the validator;
  2. creation receipt fields constructed before the claimed final execution;
  3. synthetic family denial codes that do not bind actual helper subresults;
  4. open receipt/output schemas and malformed SHA-labelled fields.
- Generator compatibility remains `false`.
- No human approval exists.

## Closed Observation Contract

Implement the plan's `Observation`, `DerivedFact`, and `AnalysisSnapshot`
schemas exactly. The spike may use plain JavaScript and Node built-ins only.

- Register all predicates, authorities, operations, rule IDs, tuple shapes,
  and allowed tracked source paths as code-owned closed sets.
- Observation IDs, fact IDs, proof IDs, ruleset hash, observation-head hash,
  and snapshot hash are derived from canonical JSON bytes.
- `retract` targets an exact active observation ID. `supersedes` closes an
  exact prior observation and retains history.
- Security/trust facts require positive evidence. Absence never means pass.
- Multiple proof paths are retained and sorted. Removing one support does not
  retract a fact with another live support.
- Unknown keys/shapes/predicates/authorities/rules/hashes/paths fail closed.
- Identical logical inputs produce byte-identical output regardless of input
  order or process. Wall-clock generation time is excluded from hashed state.
- No arbitrary rule parser or user-supplied executable rule.

## Minimum Rule Set

Implement generic rules for:

- `task_binding_viable(Task)` from exact binding, deterministic replay,
  distinct semantic owners, and clear contamination;
- `work_order_inputs_viable(WO)` only from an exact required-binding set and
  every required binding viable;
- `evidence_trusted(WO)` only from closed receipt schema, external anchors, and
  observed negative probes;
- `required_reviews_go(WO)` only from the exact required review set and every
  required review GO;
- `review_ready(WO)` from the three preceding work-order facts; and
- `accepted(WO)` only from review readiness plus human approval.

Active blocker observations positively derive `blocked(WO, Finding)`.
Contradictions surface both active sources and block dependent acceptance.

## Required Queries

- `query(subject, predicate)` returns active matching base/derived facts.
- `why(fact_id)` returns all cycle-safe proof paths to source observations.
- `why_not(subject, predicate)` returns missing premises, active blockers, and
  contradictions without claiming logical completeness beyond registered
  rules.
- `changes_since(epoch)` returns deterministically sorted added/retracted facts.

All renderers are bounded and never include private task text.

## Required Gates

1. Basic multi-step derivation.
2. One-support retraction cascade with zero stale dependents.
3. Multiple support paths: first removal retains, final removal retracts.
4. Supersession closes prior validity while history remains queryable.
5. Contradictory active facts retain both provenances and block acceptance.
6. Unknown schema/predicate/rule/authority/key/hash/path and cyclic proof input
   fail closed.
7. Multiple shuffled input orders and two fresh processes produce identical
   facts, proofs, changes, and snapshot bytes.
8. WO-055 fixture derives exactly the two viable task bindings; does not derive
   whole-work-order input viability, trusted evidence, review readiness, or
   acceptance; and explains every absence/blocker.
9. Synthetic resolution of one blocker changes only its transitive dependents;
   restoring original input reproduces original bytes.
10. Source scan proves zero task text/private fields and zero forbidden access
    paths/capabilities.
11. Focused test, direct CLI smoke if supplied, syntax, canonical JSON,
    `git diff --check`, exact four-file scope, and Cortex pattern evidence or
    exact new-file N/A.

## Stop And Return

Stop NO-GO if the fixture requires WO-specific branches rather than generic
predicates/rules, any derived fact lacks full provenance, retraction leaves
stale state, security relies on absence, or the spike needs private data,
network/model calls, production changes, or another dependency.

Return exact files/hashes, observation/rule/fact/proof/epoch counts, expected
WO-055 current state, every gate total, status, and N/A. Do not commit before
the fresh combined Contract/Validation review returns GO.
