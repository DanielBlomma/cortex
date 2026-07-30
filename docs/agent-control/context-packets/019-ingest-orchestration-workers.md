# Ingest Orchestration and Workers

## Objective

Implement WO-029 by extracting parser composition, worker
scheduling/protocol, streaming result consumption, and explicit ingest pipeline
stages from the canonical packaged implementation without changing output,
ordering, fallback, trace, or memory behavior.

## Durable Starting State

- Branch: `refactor/cli-ingest-modularization`.
- Release baseline: `v2.4.1`,
  `5ae3b00948bad26af2e5eaea60ce0b52567db352`.
- WO-028 is accepted locally: both ingest entrypoints are thin executable
  wrappers over `scaffold/scripts/lib/ingest/main.mjs`; pure responsibilities
  live in ten sibling canonical modules.
- WO-028 architecture, hashes, validation, package evidence, and the exact
  WO-029 boundary are recorded in
  `docs/agent-control/wo-028-canonical-ingest-baseline.md`.
- WO-026 memory and observable-behavior baselines remain in
  `docs/agent-control/wo-026-characterization-baseline.md`.
- The detailed program sequence remains
  `docs/superpowers/plans/2026-07-28-cli-ingest-modularization.md`.

## Work Profile

New contract/design — observable ingest behavior is frozen, while worker and
pipeline module boundaries become architectural contracts.

## Owned Scope

- `scaffold/scripts/lib/ingest/main.mjs`
- New canonical parser/worker/pipeline modules under
  `scaffold/scripts/lib/ingest/`
- `scaffold/scripts/ingest-parsers.mjs` and
  `scaffold/scripts/ingest-worker.mjs` only where composition requires it
- Root and packaged ingest wrappers only if imports must be adjusted
- Ingest, worker, trace, timeout, and memory tests/fixtures under `tests/`
- Comparable ignored benchmark results and committed agent-control evidence
- `package.json` only if test or package inclusion requires it

## Out Of Scope

- Pure helper redesign already accepted in WO-028
- CLI changes under `bin/`
- Managed-scaffold ownership or obsolete-file cleanup reserved for WO-030
- Query, ranking, graph, embedding, daemon, hook, or Enterprise changes
- Parser output, output/trace schema, worker-count behavior, or package version
- New framework dependencies or class-based pipeline abstractions

## Required Contract Anchors

- `tests/ingest-characterization.test.mjs`
  - full/changed normalized JSONL and TSV hashes
  - both-wrapper canonical equivalence
  - unavailable-parser behavior
- `tests/ingest-parallel.test.mjs`
  - sequential/parallel byte identity
  - worker count and released-result behavior
- `tests/ingest-worker-crash.test.mjs`
  - missing, invalid, skipped, partial-death, and all-death fallback
  - worker-pool settlement and full-pipeline byte equivalence
- `tests/ingest-memory-trace.test.mjs`
  - opt-in records, ordered labels, fields, counts, and released content
- `tests/context-regressions.test.mjs`
  - incremental structured-target relations, windows, metadata, module exports,
    and import/call attribution
- `docs/agent-control/wo-026-characterization-baseline.md`
  - three-run Cortex/Angular memory medians and run configuration

## Implementation Sequence

1. Extract parser loading and dispatch composition without changing registry
   order, availability checks, C# batch selection, or inline parse behavior.
2. Extract worker-count resolution and the existing streaming worker protocol.
   Preserve the 50-task threshold, default caps, environment override,
   no-worker lane, message shape, settlement accounting, and termination.
3. Keep result consumption in sorted file-record order. Do not introduce a
   retained whole-result map or copy task/file content collections.
4. Express the existing main pipeline as bounded stages for scan/hydration,
   parse, materialization, token matching, cache writes, DB writes, and
   manifest completion.
5. Pass the existing state objects through stages in the current order. Avoid
   cloning file, chunk, relation, or content collections.
6. Keep both wrappers thin and keep every new module inside
   `scaffold/scripts/lib/ingest/`.
7. Run the focused matrix after every meaningful worker or pipeline move.
8. Rerun three comparable Cortex/Angular memory measurements. Investigate
   median peak RSS movement above five percent before acceptance.

Do not combine this extraction with WO-030 managed-scaffold cleanup.

## Constraints

- `scaffold/scripts/lib/ingest/` remains the only ingest implementation.
- Preserve every WO-026 and WO-028 normalized digest.
- Preserve deterministic ordering and sequential/parallel byte identity.
- Preserve worker creation/count resolution, skip/unavailable results, crash
  fallback, and inline fallback exactly.
- Preserve trace label names, order, field names, and count semantics.
- Preserve parser dispatch, C# batch behavior, chunk/relation types, status,
  source-of-truth, and incremental deletion behavior.
- Keep result-retention and released-content counts at or below the WO-028
  contract.
- Keep `scaffold/scripts/ingest.mjs` executable and ship every new nested
  module in the npm artifact.
- Do not bump the package version.

## Known Failure Modes

- A stage iterates maps/sets in a different order and changes persisted bytes.
- Worker settlement moves after result consumption and hangs on a dead worker.
- A supposedly cleaner stage interface clones large arrays or file content.
- Worker URLs resolve relative to the new module instead of
  `.context/scripts/ingest-worker.mjs`.
- Parser availability or C# batch caches initialize in a different order.
- A trace checkpoint crosses a mutation boundary and changes counts.
- Copied-script fixtures omit a newly extracted module.
- New nested modules are omitted from `npm pack`.

## Required Reviewers

- Code Quality Reviewer
- Contract Reviewer
- Security and Privacy Reviewer
- Integration Reviewer
- Validation Reviewer

Reviewers cannot be the implementer.

## Validation

- `node --check` for both wrappers and every canonical `.mjs` module
- `node --test tests/ingest-units.test.mjs
  tests/ingest-characterization.test.mjs tests/ingest-parallel.test.mjs
  tests/ingest-worker-crash.test.mjs tests/ingest-memory-trace.test.mjs`
- `node tests/context-regressions.test.mjs`
- Compare every recorded WO-026 full/changed JSONL and TSV digest
- Verify sequential/parallel and worker-failure pipeline byte equivalence
- Assert worker timeout/settlement and trace/released-content counts
- Full root `npm test`
- Full `npm --prefix scaffold/mcp test`
- Three comparable memory runs using the WO-026 pinned SHAs/configuration
- `npm pack --dry-run --json` and inspection for every canonical module
- `cortex pattern-evidence <changed-file> --json`
- `cortex update`, `cortex doctor`, and `cortex watch status`
- Independent required-reviewer closure with no blocker/major findings

## Acceptance

- Parser, worker, and pipeline responsibilities are cohesive canonical modules.
- The canonical main reads as bounded stage composition rather than one
  monolithic pipeline.
- All frozen hashes, byte equivalence, worker fallback, trace, and incremental
  contracts remain unchanged.
- Worker result retention and released-content counts do not regress.
- Three-run median peak RSS stays within five percent or is investigated and
  explicitly resolved.
- Every new module ships in the executable npm scaffold.
- Focused and full suites pass.
- Control documents provide a fresh WO-030 session with zero chat history.

## Fresh-Session Start

Start WO-029 in a new session with no chat history and this prompt:

> Implement WO-029 from
> `docs/agent-control/context-packets/019-ingest-orchestration-workers.md`.
> Read that packet completely, then read only its direct references. Use Cortex
> search/rules/impact before code decisions. Stay on
> `refactor/cli-ingest-modularization`. Stop after parser/worker/pipeline
> extraction, equivalence and repeated-memory validation, independent review,
> and a fresh WO-030 packet.
