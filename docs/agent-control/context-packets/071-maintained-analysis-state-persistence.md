# WO-057 Maintained Analysis State — Hermetic Baseline And Core Persistence

## Objective

First make the accepted WO-056 proportional gate hermetic by promoting the
three immutable WO-047 Stage-1 artifacts from ignored local results into
tracked benchmark fixtures. Then implement Stage 1 of the maintained-analysis-
state plan as a local, default-off core capability below
`.agents/<task-id>/analysis/`.

The user explicitly authorized both actions with “fixa och gå vidare” after
WO-056 Stage 0 acceptance. Do not start Stage 2 CLI/MCP exposure or resume
WO-055.

## Starting State

- Control base: manager commit containing Packet 071.
- Accepted Stage 0 feature commit: `667fb56`.
- Create branch `feature/wo057-maintained-analysis-persistence` in a separate
  worktree, then bring `667fb56` onto the control base without modifying either
  accepted source branch.
- Work from this packet, the complete maintained-state plan, and only the
  direct references below. Run Cortex search/rules/impact before conclusions.
- Do not open private WO-055 task bundles or solution/gold/treatment output.

## Work Profile And Review

This is one production-boundary work order with two ordered gates:

1. Hermetic baseline closure. No production edit may start until the exact
   proportional bootstrapbench selection passes 98/98 in the clean worktree.
2. Core local persistence and bounded workflow adapter.

Run one combined Core/Contract/Security/Validation review after both gates.
Do not create separate review panels for fixture corrections.

## Phase A — Hermetic WO-047 Fixtures

Promote these exact existing ignored files, byte-for-byte, from the canonical
primary checkout into a tracked directory:

- `benchmark/bootstrapbench/fixtures/wo047-two-pass-stage1/frozen-fixture-v1.json`
  SHA-256 `af51a243ec396869f3348645de1faea59310e5eaac2547817480b769dac3148d`.
- `benchmark/bootstrapbench/fixtures/wo047-two-pass-stage1/retrieval-packets-v1.json`
  SHA-256 `22ca32e453aeecdc9e3c4d58c897fe01b4f923882b6cdfba505473abb9312856`.
- `benchmark/bootstrapbench/fixtures/wo047-two-pass-stage1/offline-score-v1.json`
  SHA-256 `4940dfc3180818014954bbd85408c985507be901d4c7fd65e388d3aea4e6f349`.

Update only the frozen contract/default path bindings and focused assertions
needed to use this tracked directory. All file and canonical payload hashes,
task identities, scores, packets, renderer identities, and frozen retrieval
semantics remain byte-exact. Do not regenerate, normalize, or edit artifact
content. Add a clean-worktree assertion that default paths are tracked fixture
paths and exist.

Phase A gate:

- the previously proportional 98-test selection passes 98/98 in this new
  worktree with no ignored result directory;
- both WO-047 focused files pass;
- hashes above reproduce exactly; and
- no test skips or fallback to another checkout is introduced.

## Phase B — Core Local Persistence

Implement the accepted Stage 0 semantics as native TypeScript under:

- `scaffold/mcp/src/core/analysis-state/schemas.ts`
- `scaffold/mcp/src/core/analysis-state/engine.ts`
- `scaffold/mcp/src/core/analysis-state/store.ts`
- `scaffold/mcp/src/core/analysis-state/queries.ts`

Add the smallest adapter seam under `scaffold/mcp/src/core/workflow/` and
focused tests under `scaffold/mcp/tests/analysis-state*.test.mjs`. Update the
managed scaffold ownership manifest only as mechanically required for new
packaged files. A short Stage-1 result report under `docs/agent-control/` is
owned.

### Semantic authority

- Port the accepted generic Stage 0 observation, fact, proof, contradiction,
  blocker, retraction, supersession, deterministic snapshot, `query`, `why`,
  `why_not`, and `changes_since` behavior without importing benchmark code.
- Derived facts are rebuild-only output and can never be appended as base
  truth.
- Admission still requires code-owned predicate/rule/authority policy plus a
  separately supplied exact claim-bound authority manifest. Path/hash alone
  never proves source meaning.
- No WO/task-specific branch, private data, arbitrary rule parser, database,
  model/network/provider/planner/telemetry call, or new dependency.

### Store contract

Use exactly:

```text
.agents/<task-id>/analysis/
  observations.jsonl
  snapshot.json
  changes.jsonl
  manifest.json
```

- Task IDs are validated closed path components; repository and task identity
  are bound into every file.
- Observations are append-only and hash-chained.
- A single writer uses exclusive contained staging/lock state; concurrent or
  stale writers fail closed.
- Snapshot/change publication is atomic and manifest-last. Files are fsynced
  before manifest publication.
- Reads reject traversal, symlinks, hard links, special files, wrong modes,
  unexpected entries, identity mismatch, hash-chain tamper, stale manifests,
  partial publication, and derived-state drift.
- Recovery replays the observation log. It either reproduces the exact
  snapshot and changes or returns a closed error; it never trusts a stale
  snapshot over replay.
- Existing workflow behavior is unchanged when analysis state is absent or
  explicitly disabled.

### Workflow adapter

- Stage/review completion may emit observations only through an explicitly
  enabled validated adapter.
- `RunState.outcome` remains the compatibility field. If enabled maintained
  state contradicts it, advancement is blocked and both provenances are
  returned.
- No CLI or MCP operation is added in WO-057.

## Direct References

1. `docs/superpowers/plans/2026-08-30-maintained-analysis-state.md` — complete
   product contract and Stage 1 acceptance.
2. Packet 070 and accepted Stage 0 commit `667fb56` — semantic oracle.
3. `scaffold/mcp/src/core/workflow/artifact-io.ts`, `run-lifecycle.ts`, and
   `schemas.ts` — compatibility and adapter seams.
4. `scaffold/mcp/src/enterprise/workflow/state.ts` — prior approval/blocker
   behavior, read-only unless an exact adapter need is proven.
5. Accepted filesystem containment and ownership implementations plus their
   focused tests — path, publication, and packaging patterns.
6. The three ignored canonical WO-047 files in the primary checkout — copy
   source for Phase A only.

## Required Validation

- Phase A 98/98 and both WO-047 focused suites.
- Stage 0 semantic suite passes unchanged and an equivalent TypeScript
  semantic suite covers its contract.
- Store tests cover atomic publish, crash at every publication boundary,
  replay, tamper, stale snapshot, concurrent writer, traversal, symlink,
  hard-link, special-file, mode, identity, and unexpected-entry negatives.
- Workflow adapter tests cover disabled/absent compatibility, validated
  emission, agreement, contradiction blocking, and exact provenance.
- Existing core workflow, Enterprise workflow, filesystem-boundary,
  ownership, root, MCP, package, and version gates pass proportionally to the
  changed surface, with the full MCP/root/package set at final acceptance.
- `git diff --check`, TypeScript build, package inventory, Cortex update, and
  pattern evidence pass or have an exact documented N/A.
- One combined Core/Contract/Security/Validation reviewer returns GO.

## Stop Conditions

Stop NO-GO if exact WO-047 bytes are unavailable or changed; Stage 0 semantics
cannot be ported without task-specific branches; a retraction leaves stale
state; security relies on fact absence; a path/hash is treated as semantic
proof; containment requires weakening accepted boundaries; existing workflow
changes while disabled; or Stage 1 needs Stage 2 CLI/MCP, private data, a
model/network call, or a new dependency.

## Return

Return exact commits, file hashes, fixture and semantic counts, all focused and
full gate totals, package/ownership deltas, review result, remaining risk, and
explicit confirmation that Stage 2 and WO-055 remain stopped.
