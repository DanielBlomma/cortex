# WO-057 Maintained Analysis State — Stage 1 Report

## Result

**GO for Stage 1 acceptance. Stage 2 and WO-055 remain stopped.**

WO-057 first made the accepted WO-047 proportional baseline hermetic, then
promoted the accepted Stage 0 evaluator into a local, default-off production
capability. No CLI, MCP operation, database, model, network, provider, planner,
telemetry call, private WO-055 data, or new dependency was added.

## Phase A — Hermetic Baseline

The three canonical ignored artifacts were copied byte-for-byte into
`benchmark/bootstrapbench/fixtures/wo047-two-pass-stage1/`:

- `frozen-fixture-v1.json` —
  `af51a243ec396869f3348645de1faea59310e5eaac2547817480b769dac3148d`;
- `retrieval-packets-v1.json` —
  `22ca32e453aeecdc9e3c4d58c897fe01b4f923882b6cdfba505473abb9312856`;
- `offline-score-v1.json` —
  `4940dfc3180818014954bbd85408c985507be901d4c7fd65e388d3aea4e6f349`.

Default paths now resolve only to tracked fixtures. The clean-worktree
BootstrapBench selection passed 99/99; the packet's prior 98 count increased
by the new hermetic-path assertion. No skip, fallback checkout, regeneration,
or payload normalization was introduced.

## Phase B — Core Persistence

- `schemas.ts`, `engine.ts`, and `queries.ts` expose the accepted registered
  observation/fact/proof/contradiction/blocker semantics. The evaluator is a
  mechanical Stage 0 promotion with a caller-supplied, closed source-authority
  registry instead of WO-specific source policy.
- `store.ts` owns exactly
  `.agents/<task-id>/analysis/{observations.jsonl,snapshot.json,changes.jsonl,manifest.json}`.
  Observation records are append-only and hash-chained; derived publications
  are atomic and manifest-last.
- Reads and recovery bind repository, task, observation chain, snapshot,
  changes, ruleset, claim manifest, and source-authority registry. File sizes
  and record counts are bounded before parsing.
- Traversal, symlink, hard-link, special-file, mode, extra-entry, identity,
  stale-writer, concurrent-writer, authority-drift, ruleset-drift, partial
  publication, and tamper cases fail closed.
- Recovery alone may reclaim a strictly validated lock whose recorded PID is
  no longer alive. It atomically quarantines that lock and removes only exact
  private atomic-staging files owned by the exited PID. Ordinary publication
  never reclaims a lock.
- The workflow adapter is explicitly enabled and default-off. It checks the
  proposed `RunState.outcome` before artifact or state writes, returns proof
  provenance on agreement, and blocks contradictory completion.

## Semantic And Validation Evidence

- Accepted Stage 0 semantic suite: 19/19 against the benchmark oracle and the
  same 19/19 cases against the native engine, including fresh-process replay.
- Native parity/authority tests: 3/3.
- Store tests: 8/8, including every publication boundary, second-generation
  recovery, exited-writer lock recovery, bounds, containment, and tamper.
- Workflow adapter plus proportional workflow selection: 39/39 before the
  final full run.
- Full MCP suite after final security corrections: 607/607, zero skipped.
- Root gate: 81/81 context regressions and 400/400 Node tests.
- Ownership gate: 17/17.
- Package gate: 446 entries, 425 mode `0644`, 21 mode `0755`, 409 managed
  paths, and byte-stable clean/prebuilt inventory SHA-256
  `97cf713768a6fe344785c577dffd87d8928386a681bfc4fb9a7651faee1439a9`.
- Packed filesystem cases: 42/42; packed characterization: 3/3; development
  and packed dashboard cases: 4/4 each; forced upgrade verifies 94 changed
  managed files and 29 additions from `v2.4.2`.
- TypeScript build and `git diff --check`: pass.
- `cortex update`: pass; 1,780/1,780 embedded entities, graph rebuilt, 100%
  semantic coverage. The status command reports the uncommitted report itself
  as the sole remaining changed candidate until this acceptance commit.

The repository's configured Cortex `source_paths` are `bin`, `scripts`,
`docs`, and `README.md`. Consequently `cortex pattern-evidence` returned the
exact documented N/A, “target was not found in indexed context”, for the new
`scaffold/mcp`, ownership, and root-test files. Cortex search and rules did
resolve Packet 071 and the maintained-state plan. The local diff-review tool
reported zero findings and zero conflicts but also no applicable profiles for
these excluded paths, so it was supporting evidence rather than the review
authority.

## Combined Core/Contract/Security/Validation Review

**GO.** One combined review covered both phases.

- Core: Stage 0 behavior is exercised by the same 19-case suite and exact
  snapshot/query/explanation parity; workflow behavior is unchanged when the
  optional gate is absent.
- Contract: the four-file store layout, default-off adapter, no Stage 2 public
  surface, and ownership v3's exact 13-file delta match Packet 071.
- Security: all persisted inputs are bounded before parse, policy and claims
  are independently bound, derived facts are replay-only, locks are exclusive,
  and crash leftovers are reclaimed only under a dead, validated owner.
- Validation: focused, full MCP, root, ownership, package, Cortex, and diff
  gates are green with no skips.

The production evaluator retains `@ts-nocheck` to remain mechanically
comparable with the accepted Stage 0 oracle. This is a bounded maintainability
risk, not an unchecked external-input boundary: public shapes are declared in
`schemas.ts`, all runtime inputs are closed and bounded, TypeScript consumers
are checked, and semantic drift is guarded by the shared 19-case conformance
suite plus byte-exact parity.
