# CLI and Ingest Modularization

## Objective

Refactor the large Cortex CLI and ingest entry points into small, cohesive
modules without changing public CLI behavior, JSON response contracts,
Enterprise trust boundaries, ingest output, deterministic ordering, or memory
characteristics.

The detailed implementation sequence is stored in
`docs/superpowers/plans/2026-07-28-cli-ingest-modularization.md`.

## Background

- Release `v2.4.1` is the baseline at commit
  `5ae3b00948bad26af2e5eaea60ce0b52567db352`.
- Work starts on `refactor/cli-ingest-modularization`, based on
  `origin/main`.
- `bin/cortex.mjs` is approximately 1,860 lines and combines argument parsing,
  scaffold installation, process execution, client connection, routing,
  daemon control, hooks, telemetry, and Enterprise control.
- The packaged `scaffold/scripts/ingest.mjs` is several thousand lines and
  combines discovery, parsing, worker scheduling, entity construction,
  relation generation, incremental state, and persistence.
- Root `scripts/ingest.mjs` and packaged `scaffold/scripts/ingest.mjs` have
  drifted. The packaged scaffold must become the single implementation source
  of truth; the root script should become a development entry shim.
- The `v2.4.1` local upgrade exposed another boundary problem: `cortex init
  --force` overlays managed runtime files but does not remove obsolete managed
  files. A stale generated TypeScript source survived the upgrade and broke the
  first bootstrap until it was removed.
- Prior CLI-first behavior is defined by context packet 008. Do not remove MCP
  compatibility or rename `.context/mcp`.
- Prior ingest worker determinism and memory constraints are defined by context
  packets 006 and 007.
- Repo-local pattern evidence requirements are defined by context packet 010.

## Work Profile

New contract/design — the public behavior is intended to remain stable, but the
module ownership model and managed-scaffold cleanup contract are new and touch
CLI, packaging, Enterprise security, and ingest integration boundaries.

## Work Order Sequence

1. **WO-026 — Characterization and baseline**
   - Lock down CLI exit codes, stdout/stderr, JSON envelopes, init preservation,
     Enterprise denial paths, ingest byte output, worker fallback, and current
     memory evidence.
2. **WO-027 — CLI modularization**
   - Extract pure helpers and command handlers behind a thin executable while
     preserving compatibility exports and trusted Enterprise resolution.
3. **WO-028 — Canonical ingest source and pure modules**
   - Make the scaffold implementation canonical; extract arguments, config,
     file discovery, writers, chunking, and relation builders.
4. **WO-029 — Ingest orchestration and worker modules**
   - Extract worker scheduling, incremental state, and the pipeline
     orchestrator while retaining sorted merge order and bounded retention.
5. **WO-030 — Managed scaffold upgrade hygiene**
   - Introduce an explicit managed-file manifest and safe obsolete-file
     cleanup, preserving user-owned and secret-bearing files.
6. **WO-031 — Integrated validation and patch release readiness**
   - Run clean-package installation, bootstrap/search smokes, full suites,
     package inspection, security review, and repeated memory validation.

Each work order after WO-026 receives a new, smaller context packet before its
implementation starts.

## Owned Scope

- `bin/cortex.mjs`
- New modules under `bin/cli/`
- `scripts/ingest.mjs`
- `scaffold/scripts/ingest.mjs`
- New modules under `scaffold/scripts/lib/ingest/`
- CLI, scaffold, ingest, worker, package, and migration tests under `tests/`
- `package.json` package contents only when new packaged modules require it
- Agent-control documents needed for work-order, risk, validation, and handoff
  traceability
- Patch-version release metadata only after integrated acceptance

## Out Of Scope

- Removing or renaming MCP compatibility surfaces
- Changing search ranking, parser semantics, graph schemas, embedding models,
  token budgets, or default source paths
- Adding a command framework dependency
- Rewriting working functional code into classes
- Frontend linting, formatting, or test infrastructure
- New telemetry, source upload, remote services, or Enterprise features
- Memory optimization beyond preventing a refactor regression

## Target Structure

```text
bin/
  cortex.mjs
  cli/
    args.mjs
    help.mjs
    process.mjs
    router.mjs
    scaffold.mjs
    commands/
      connect.mjs
      context.mjs
      daemon.mjs
      enterprise.mjs
      hooks.mjs
      telemetry.mjs

scaffold/scripts/
  ingest.mjs
  lib/ingest/
    args.mjs
    chunking.mjs
    config.mjs
    files.mjs
    pipeline.mjs
    state.mjs
    workers.mjs
    writers.mjs
    relations/
      config.mjs
      projects.mjs
      resources.mjs
      sql.mjs

scripts/ingest.mjs
```

The target is a guide, not a requirement to create empty or artificial
modules. Combine neighboring responsibilities when the extracted API would
otherwise add indirection without reducing coupling.

## Constraints

- Preserve every documented CLI command, option, default, exit code, JSON
  envelope, and concise human-readable output.
- `bin/cortex.mjs` remains the npm executable and preserves currently imported
  compatibility exports.
- Enterprise control commands may import only the trusted installed-package
  runtime. Project-controlled `.context` code must never enter that path.
- Enterprise API keys remain stdin-only, never echoed, and stored with mode
  `0600`.
- Full and incremental ingest outputs remain byte-identical for fixed inputs.
- Parallel results merge in deterministic sorted file order.
- Missing, invalid, or crashed worker results continue to fall back safely.
- Existing ingest memory trace labels and fields remain parseable.
- Refactoring must not add whole-repository copies, unbounded queues, or
  retained worker-result maps.
- `config.yaml`, `rules.yaml`, `enterprise.yml`, `enterprise.yaml`,
  `AGENTS.md`, and `CLAUDE.md` remain preserved during scaffold upgrades.
- Obsolete generated files may be removed only when they are listed as
  Cortex-managed and resolve inside the managed root. Unknown files are
  preserved.
- The npm artifact must include every new runtime module.
- Keep commits and PRs scoped by work order. Do not combine all phases into one
  unreviewable rewrite.

## Known Failure Modes Checklist

- CLI handlers accidentally change which stream receives output.
- A moved error is caught at a different layer and changes the exit status or
  JSON error envelope.
- Enterprise command extraction resolves a project runtime instead of the
  package-owned trusted runtime.
- Compatibility exports used by root tests disappear.
- Root and scaffold ingest entry points execute different implementations.
- Worker completion order leaks into persisted record order.
- Refactoring reintroduces full worker-result retention or duplicate content
  maps.
- New nested scaffold modules are absent from `npm pack`.
- Managed-file cleanup follows a symlink or deletes an unknown/user-owned file.
- `init --force` overwrites configuration, agent instructions, or Enterprise
  secrets.
- Tests assert only formatting and miss observable behavior, denial paths, or
  fallback behavior.

## Required Reviewers

- Code Quality Reviewer
- Contract Reviewer
- Security and Privacy Reviewer
- Integration Reviewer
- Validation Reviewer
- Ops/Release Reviewer for WO-031

Reviewers must be assigned before each implementation work order begins and
cannot be the implementer for that work order.

## Validation Gates

- Focused CLI contract, query-shim, init, migration, and Enterprise security
  tests after each CLI extraction.
- `node --check` for every changed `.mjs` entry and module.
- Focused ingest unit, parallel, worker-crash, memory-trace, and context
  regression tests after each ingest extraction.
- Byte comparison of full and incremental fixture outputs across sequential
  and parallel execution.
- Full root and `scaffold/mcp` suites once at each work-order acceptance.
- `npm run release:check-version-sync` when release metadata changes.
- `npm pack --dry-run --json`, followed by an extracted-package
  `init -> bootstrap -> search` smoke.
- At least three comparable memory runs before and after ingest
  modularization. Use the median and investigate a peak-RSS regression above
  five percent.
- `cortex update`, `cortex doctor`, and `cortex watch status` before final
  acceptance.

## Required Output

- Thin CLI and ingest entry points with cohesive implementation modules.
- One canonical ingest implementation used by development and packaged
  execution.
- Characterization and negative tests covering public and security contracts.
- A safe managed-scaffold cleanup contract with tests.
- Benchmark and package-smoke evidence.
- Updated handoff, risk, acceptance, and release traceability.

## Acceptance

- `bin/cortex.mjs` contains executable setup, top-level error formatting,
  routing composition, and compatibility re-exports only.
- Both ingest entry points are thin wrappers around the same canonical
  implementation.
- CLI behavior and JSON contracts are unchanged.
- Enterprise boundary tests demonstrate fail-closed trusted-runtime behavior.
- Full and incremental ingest fixture output is byte-identical to the baseline.
- Parallel ingest remains deterministic and worker failure remains bounded.
- Median peak RSS does not regress materially; any result above five percent is
  investigated and explicitly accepted or fixed.
- Forced scaffold upgrades remove obsolete managed files without deleting or
  overwriting user-owned configuration.
- Clean npm package installation, bootstrap, doctor, and semantic search pass.
- All required reviewers have no open blocker or major findings.

## Fresh-Session Start

Start WO-026 in a new session with no chat history and this prompt:

> Implement WO-026 from
> `docs/agent-control/context-packets/016-cli-ingest-modularization.md`.
> Read that packet completely, then read only its direct references. Use Cortex
> search/rules/impact before code decisions. Stay on
> `refactor/cli-ingest-modularization`. Stop after WO-026 characterization and
> baseline evidence; update the control documents for a fresh WO-027 session.

Current durable state: the branch exists at the `v2.4.1` baseline and only the
planning/control-document changes for this program should be present before
WO-026 begins.
