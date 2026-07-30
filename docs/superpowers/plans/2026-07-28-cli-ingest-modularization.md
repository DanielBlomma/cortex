# Cortex CLI and Ingest Modularization Plan

## Goal

Split the large CLI and ingest entry points into cohesive modules, establish
one packaged ingest source of truth, and make scaffold upgrades remove obsolete
Cortex-managed files safely. Preserve all observable behavior.

## Baseline

- Version: `2.4.1`
- Commit: `5ae3b00948bad26af2e5eaea60ce0b52567db352`
- Branch: `refactor/cli-ingest-modularization`
- Program packet:
  `docs/agent-control/context-packets/016-cli-ingest-modularization.md`

## Program Rules

- One work order per fresh session.
- Write the next context packet and handoff state before ending each work
  order.
- Extract code without redesigning behavior.
- Keep each commit independently testable.
- Run focused tests during extraction and the full matrix at acceptance.
- Do not bump the package version until integrated validation is accepted.

## WO-026 — Characterization and Baseline

### CLI contract

- [x] Inventory every command, alias, option, default, and passthrough.
- [x] Add a subprocess-based command matrix that records exit status and
  stdout/stderr ownership.
- [x] Cover `help`, `version`, unknown commands, malformed flags, query shims,
  daemon status outside a project, init/connect behavior, and missing-runtime
  diagnostics.
- [x] Assert JSON envelope structure semantically rather than snapshotting
  unstable timestamps or local paths.
- [x] Retain direct-import tests for `slugifyRepoId`,
  `detectInitialSourcePaths`, `buildInitialConfig`, and
  `isScaffoldOutOfDate`.

### Enterprise contract

- [x] Keep the existing positional-secret, stdin-only, no-echo, trusted
  runtime, identity-ordering, config-permission, and verified-daemon tests.
- [x] Add any missing CLI-stream or exit-status assertions needed to detect
  extraction regressions.

### Ingest contract

- [x] Build a compact multilingual fixture covering code, Markdown, config,
  resources, SQL, project metadata, rules, and incremental deletion.
- [x] Record canonical full-ingest JSONL/TSV output hashes after normalizing
  intentionally variable timestamps.
- [x] Compare sequential and parallel output byte-for-byte.
- [x] Cover changed ingest, deleted paths, unavailable parsers, zero workers,
  crashed workers, and deterministic ordering.
- [x] Record the existing memory-trace labels and required fields.

### Baseline evidence

- [x] Run focused tests and both full suites.
- [x] Run three comparable Cortex/Angular memory measurements and record the
  median peak RSS and duration by phase.
- [x] Inspect a `2.4.1` package dry run and clean temporary install.
- [x] Update handoff/risk/acceptance state and create a focused WO-027 context
  packet.

## WO-027 — CLI Modularization

### Pure helpers

- [x] Extract help rendering and argument parsing.
- [x] Extract process execution/result helpers.
- [x] Extract scaffold path/config helpers.
- [x] Re-export compatibility helpers from `bin/cortex.mjs`.
- [x] Run CLI characterization tests after each extraction commit.

### Command handlers

- [x] Extract context query and passthrough handling.
- [x] Extract connect/init/scaffold handling.
- [x] Extract daemon handling without changing handshake or PID behavior.
- [x] Extract hooks and telemetry handling.
- [x] Extract Enterprise handling last, keeping trusted package resolution
  physically separate from project runtime resolution.
- [x] Compose handlers in a small router with explicit command ownership.

### Acceptance

- [x] `bin/cortex.mjs` is a thin executable boundary.
- [x] CLI and Enterprise focused tests pass.
- [x] Root and MCP full suites pass.
- [x] Package dry run includes every `bin/cli/` module.
- [x] Review findings are resolved and WO-028 receives a fresh packet.

## WO-028 — Canonical Ingest Source and Pure Modules

### Source ownership

- [x] Declare `scaffold/scripts/lib/ingest/` as the canonical implementation.
- [x] Make `scaffold/scripts/ingest.mjs` a thin packaged entry.
- [x] Make root `scripts/ingest.mjs` a thin development entry using the same
  canonical implementation.
- [x] Update tests so unit behavior targets canonical modules and entrypoint
  tests cover both wrappers.

### Pure extraction order

- [x] Arguments, environment parsing, and constants.
- [x] File/path normalization, Git changes, candidate collection, and skip
  policy.
- [x] JSONL/TSV readers and streaming writers.
- [x] Chunk IDs, chunk descriptions, windows, and module generation.
- [x] Config/resource/SQL relation builders.
- [x] Project and solution relation builders.
- [x] Incremental-state hydration and removal helpers.

### Acceptance

- [x] No duplicated ingest implementation remains.
- [x] Full and changed fixture outputs match the WO-026 baseline.
- [x] Sequential/parallel equivalence remains byte-identical.
- [x] Focused and full suites pass.
- [x] Package dry run contains all nested ingest modules.
- [x] Review findings are resolved and WO-029 receives a fresh packet.

## WO-029 — Ingest Orchestration and Workers

- [x] Extract parser loading/dispatch composition.
- [x] Extract worker-count resolution and worker protocol handling.
- [x] Extract streaming worker result consumption.
- [x] Preserve sorted file-record merge order.
- [x] Preserve inline fallback for missing, invalid, crashed, and disabled
  workers.
- [x] Extract the main pipeline into explicit stages without copying whole
  record collections between stages.
- [x] Keep trace checkpoint names and count fields stable.
- [x] Run output-equivalence, worker-crash, timeout, memory-trace, and full
  tests.
- [x] Rerun comparable memory measurements and investigate median peak-RSS
  movement above five percent.
- [x] Resolve reviews and create a fresh WO-030 packet.

## WO-030 — Managed Scaffold Upgrade Hygiene

- [x] Define a versioned manifest of files owned by Cortex scaffolding.
- [x] Persist enough prior-manifest state to identify obsolete managed files.
- [x] Remove only manifest-owned paths inside the expected managed root.
- [x] Reject traversal and symlink escapes.
- [x] Preserve config, rules, ontology edits where applicable, Enterprise
  secrets, and agent instructions.
- [x] Preserve unknown user-created files.
- [x] Add upgrade fixtures for removed, renamed, modified, unknown, symlinked,
  and secret-bearing files.
- [x] Prove `init --force` repairs Enterprise config mode to `0600`.
- [x] Prove a stale generated source cannot survive and break bootstrap.
- [x] Resolve reviews and create a fresh WO-031 packet.

## WO-031 — Integrated Validation and Release Readiness

- [x] Run syntax checks for all entrypoints and extracted modules.
- [x] Run focused CLI, init, migration, Enterprise, ingest, worker, memory, and
  context-regression suites.
- [x] Run complete root and MCP suites.
- [x] Run dependency audits and version-sync checks.
- [x] Pack the npm artifact and inspect its file list.
- [x] Install the packed artifact into a clean temporary global prefix.
- [x] Run `init --bootstrap`, `doctor`, `search --json`, update, and forced
  upgrade smokes in temporary repositories.
- [x] Confirm no local source upload or unexpected network path was added.
- [x] Compare final repeated memory evidence with WO-026.
- [x] Complete Code Quality, Contract, Security, Integration, Validation, and
  Ops/Release review.
- [x] Bump to `2.4.2` only after all acceptance gates pass.

## Final Definition of Done

- Public behavior is unchanged except that forced upgrades safely remove
  obsolete Cortex-managed generated files.
- CLI and ingest entrypoints are thin and readable.
- Development and packaged ingestion use one implementation.
- Enterprise remains fail-closed and package-trusted.
- Ingest output stays deterministic and byte-identical for fixed inputs.
- Memory does not materially regress.
- The packed release bootstraps and searches successfully from a clean
  installation.
