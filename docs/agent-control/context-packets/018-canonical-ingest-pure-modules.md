# Canonical Ingest Source and Pure Modules

## Objective

Implement WO-028 by making the packaged scaffold the single ingest source of
truth and extracting pure ingest responsibilities into cohesive modules without
changing any behavior frozen by WO-026.

## Durable Starting State

- Branch: `refactor/cli-ingest-modularization`.
- Release baseline: `v2.4.1`,
  `5ae3b00948bad26af2e5eaea60ce0b52567db352`.
- WO-026 froze full/changed ingest output hashes, sequential/parallel
  equivalence, worker fallback, memory trace, package, and repeated memory
  behavior in `docs/agent-control/wo-026-characterization-baseline.md`.
- WO-027 is accepted locally: `bin/cortex.mjs` is a 34-line executable
  boundary backed by cohesive modules under `bin/cli/`; focused 58/58, root
  81/81 + 293/293, MCP 413/413, and the 398-entry package dry-run pass.
- The detailed program sequence remains
  `docs/superpowers/plans/2026-07-28-cli-ingest-modularization.md`.

## Work Profile

New contract/design — observable ingest behavior is frozen, while canonical
source ownership and pure-module boundaries are architectural contracts.

## Owned Scope

- `scripts/ingest.mjs`
- `scaffold/scripts/ingest.mjs`
- New canonical modules under `scaffold/scripts/lib/ingest/`
- Root ingest tests and fixtures under `tests/`
- `package.json` only if test or package inclusion requires it
- Agent-control documents needed for WO-028 handoff and review

## Out Of Scope

- CLI changes under `bin/`
- Worker scheduling, worker protocol, incremental pipeline orchestration, or
  memory-retention redesign reserved for WO-029
- Managed-scaffold obsolete-file cleanup reserved for WO-030
- Query ranking, graph, embedding, daemon, hook, or Enterprise changes
- Output schema, trace schema, parser behavior, worker-count behavior, or
  package-version changes

## Required Contract Anchors

- `tests/ingest-characterization.test.mjs`
  - multilingual full and changed/deleted output
  - normalized JSONL/TSV hashes from WO-026
  - unavailable-parser behavior
- `tests/ingest-parallel.test.mjs`
  - sequential and parallel byte equivalence
  - worker count and released-result behavior
- `tests/ingest-worker-crash.test.mjs`
  - missing, invalid, skipped, partial-death, and all-death fallback
  - full pipeline byte equivalence after worker failure
- `tests/ingest-memory-trace.test.mjs`
  - opt-in trace records, ordered labels, required fields, and counts
- `tests/ingest-units.test.mjs`
  - parser dispatch, IDs, descriptions, windows, modules, projects, resources,
    config, SQL, and relation helpers

## Implementation Sequence

1. Declare `scaffold/scripts/lib/ingest/` as the canonical implementation
   location and make tests import pure helpers there.
2. Extract arguments, environment parsing, and constants without changing
   defaults or invalid-input behavior.
3. Extract path normalization, Git change discovery, candidate collection, and
   skip policy.
4. Extract JSONL/TSV readers and streaming writers without changing byte order.
5. Extract chunk IDs, descriptions, overlap windows, and module generation.
6. Extract config, resource, SQL, project, and solution relation builders.
7. Extract incremental-state hydration and removal helpers while retaining the
   current orchestration order.
8. Reduce both ingest entrypoints to thin wrappers over the packaged canonical
   implementation.

Run the focused ingest set after each independently meaningful extraction. Do
not combine pure extraction with the WO-029 worker/pipeline redesign.

## Constraints

- The packaged scaffold implementation is canonical; do not create a second
  library tree under root `scripts/`.
- Preserve every WO-026 normalized full/changed JSONL and TSV digest.
- Preserve deterministic ordering and sequential/parallel byte identity.
- Preserve worker creation, worker-count resolution, skip/unavailable results,
  crash fallback, and inline fallback exactly; their redesign belongs to
  WO-029.
- Preserve trace labels, order, field names, and count semantics.
- Preserve all parser dispatch, chunk IDs, relation types, status,
  source-of-truth, and incremental deletion behavior.
- Keep `scaffold/scripts/ingest.mjs` executable in the npm artifact.
- Every new `scaffold/scripts/lib/ingest/` module must be present in
  `npm pack`.
- Do not add a framework dependency or convert functional code into classes.
- Do not bump the package version.

## Known Failure Modes

- Root and packaged wrappers resolve different files or environment roots.
- Moving a sort or normalization step changes JSONL/TSV byte order.
- A helper extraction clones arrays or retained content and raises peak RSS.
- Direct unit imports continue targeting the old root implementation.
- Worker fallback changes accidentally while moving supposedly pure helpers.
- New nested modules are omitted from the npm artifact.

## Required Reviewers

- Code Quality Reviewer
- Contract Reviewer
- Security and Privacy Reviewer
- Integration Reviewer
- Validation Reviewer

Reviewers cannot be the implementer.

## Validation

- `node --check` for both ingest entrypoints and every new `.mjs` module
- `node --test tests/ingest-units.test.mjs
  tests/ingest-characterization.test.mjs tests/ingest-parallel.test.mjs
  tests/ingest-worker-crash.test.mjs tests/ingest-memory-trace.test.mjs`
- Compare every recorded WO-026 full/changed JSONL and TSV digest
- Verify sequential/parallel and worker-failure pipeline byte equivalence
- Full root `npm test`
- Full `npm --prefix scaffold/mcp test`
- `npm pack --dry-run --json` and inspection for every canonical ingest module
- `cortex pattern-evidence <changed-file> --json`
- `cortex update`, `cortex doctor`, and `cortex watch status`
- Independent required-reviewer closure with no blocker/major findings

## Acceptance

- `scaffold/scripts/lib/ingest/` is the only ingest implementation.
- Root and packaged ingest entrypoints are thin wrappers over that canonical
  implementation.
- WO-026 full/changed output hashes and sequential/parallel byte equivalence
  remain unchanged.
- Worker fallback and memory-trace contracts remain unchanged.
- Every new canonical module ships in the npm artifact.
- Focused and full suites pass.
- Control documents provide a fresh WO-029 session with zero chat history.

## Fresh-Session Start

Start WO-028 in a new session with no chat history and this prompt:

> Implement WO-028 from
> `docs/agent-control/context-packets/018-canonical-ingest-pure-modules.md`.
> Read that packet completely, then read only its direct references. Use Cortex
> search/rules/impact before code decisions. Stay on
> `refactor/cli-ingest-modularization`. Stop after canonical ingest/pure-module
> extraction, validation, independent review, and a fresh WO-029 packet.
