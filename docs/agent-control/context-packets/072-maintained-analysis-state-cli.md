# WO-058 Maintained Analysis State — Opt-In CLI Read Surface

## Objective

Implement the first ordered part of Stage 2: a local, explicitly invoked CLI
read surface over the accepted WO-057 maintained-analysis store. Freeze and
accept the CLI JSON contracts before any MCP operation or dogfood writer is
started.

The user's “go on” after WO-057 acceptance authorizes this Stage 2A work order.
It does not resume WO-055, authorize an MCP surface, generate manager prose,
or authorize product observation ingestion.

## Starting State

- Accepted feature implementation: `180b122`.
- Accepted control integration: `609639b`, `9d9df80`, and `c22d75d`.
- Branch: `feature/wo058-analysis-state-cli`.
- Worktree: `/Users/danielnilsson/GIT/cortex-wo058-analysis-state-cli`.
- Start in a fresh session using only this packet and the direct references
  below.

## Product Decision And Ordering

Stage 2 is split deliberately:

1. WO-058 freezes the opt-in CLI reader and its JSON envelopes.
2. A later work order may expose the accepted contract through MCP.
3. Only after the read contract is accepted may a separate non-blind dogfood
   work order add a validated authority/observation writer and generated
   Current State view.

Do not combine these gates. One combined CLI/Contract/Security/Validation
review is sufficient for WO-058.

## Required CLI Surface

Add exactly these explicitly invoked operations:

- `cortex workflow state <task-id> [--json]`
- `cortex workflow why <task-id> <fact-id> [--json]`
- `cortex workflow why-not <task-id> <predicate> [--json]`
- `cortex workflow changes <task-id> --since <epoch> [--json]`

`why-not` uses the authority bundle's exact `primary_subject`; it must not
assume the lowercase storage task ID is the semantic subject. Unknown
subcommands, duplicate flags, extra positionals, unsafe visible text,
non-canonical task/fact/predicate IDs, negative or non-integer epochs, and
oversized inputs fail before project-runtime import.

The root shim and runtime parser independently enforce the same closed grammar.
JSON success and failure envelopes are versioned, bounded, deterministic, and
byte-stable. Text output is a bounded rendering of the same data and cannot
carry extra authority.

## Independent Query Authority

The CLI may not trust `snapshot.json`, path/hash metadata, or the observation
log as self-attesting semantic authority. Reading requires exactly one
separately stored file:

`.agents/<task-id>/analysis-authority.json`

It is outside the accepted four-entry `analysis/` directory and therefore does
not weaken that store contract. The exact version-1 object contains only:

- `schema_version` = `1`;
- `repository`;
- `task_id`;
- `primary_subject`;
- `authority_manifest` in the accepted Stage 1 shape;
- `source_authorities` in the accepted closed registry shape; and
- `bundle_sha256`, computed over every preceding field using accepted canonical
  JSON.

The reader validates byte caps before parse, exact keys, canonical identities,
closed authorities, normalized registry entries, the bundle hash, mode `0600`,
regular-file/single-link identity, and project-root containment. It then calls
the accepted `readAnalysisState` replay path with the independently supplied
manifest and registry. It never repairs, writes, recovers, or falls back to an
unverified snapshot.

Missing state returns a closed `STATE_NOT_FOUND`; missing or invalid authority
returns a closed `AUTHORITY_INVALID`; tamper/drift/containment failures return a
closed `STATE_UNTRUSTED`. Public errors must not disclose absolute paths,
observation contents, or raw parser/runtime messages.

WO-058 owns the reader and validation contract only. Tests may construct the
bundle directly. No production bundle writer is authorized.

## Owned Production Surface

- `bin/cli/router.mjs`
- `bin/cli/help.mjs`
- new `bin/cli/workflow-command.mjs`
- new `scaffold/mcp/src/cli/workflow-analysis.ts`
- the smallest required authority-bundle reader under
  `scaffold/mcp/src/core/analysis-state/`
- exact focused root and MCP tests
- scaffold ownership `current.json` plus one new immutable version only if the
  packed managed inventory changes
- one short WO-058 result report under `docs/agent-control/`

Existing Stage 1 files are read-only unless a focused test proves that a
minimal additive export is required. No semantic rule, persistence layout,
publication, recovery, or workflow-adapter behavior may change.

## Direct References

1. `docs/agent-control/maintained-analysis-state-stage1-report.md` — accepted
   behavior, gates, and bounded `@ts-nocheck` risk.
2. `scaffold/mcp/src/core/analysis-state/schemas.ts`, `store.ts`, and
   `queries.ts` — sole semantic and read authorities.
3. `bin/cli/router.mjs`, `query-command.mjs`, `project-runtime.mjs`, and
   `help.mjs` — root routing, preflight, runtime loading, and help patterns.
4. `scaffold/mcp/src/cli/query.ts` — runtime parser, JSON envelope, and bounded
   public-error pattern.
5. `tests/review-cli-shim.test.mjs` plus the corresponding MCP query tests —
   fail-closed dual-parser precedent.
6. `docs/superpowers/plans/2026-08-30-maintained-analysis-state.md`, Stage 2 —
   product ordering; this packet closes the subject/authority ambiguity for
   Stage 2A.

## Required Validation

- Every operation passes byte-identically in two fresh processes and from a
  linked worktree.
- Oracle/native Stage 0 semantic parity remains 19/19 each.
- Existing Stage 1 store and workflow tests remain green.
- Focused CLI tests cover success, missing state, missing/invalid authority,
  subject selection, bounds, duplicate/extra args, traversal, symlink,
  hard-link, special file, wrong mode, identity drift, bundle/manifest/registry
  tamper, hash-chain/snapshot tamper, and concurrent replacement.
- Reads are byte-, identity-, link-, mode-, mtime-, and directory-entry-neutral
  across repeated commands.
- Root CLI contract, full MCP, full root, package, ownership, TypeScript,
  filesystem-containment, `git diff --check`, Cortex update, and pattern
  evidence pass proportionally, with full package gates at acceptance.
- One combined CLI/Contract/Security/Validation review returns GO.

## Explicit Non-Goals

- No MCP tool or operation.
- No observation, authority-bundle, manager-log, handoff, or Current State
  writer.
- No automatic command invocation, workflow gating change, or default-on mode.
- No WO-055 task, private evidence, gold, treatment, score, or blind phase.
- No model, network, provider, planner, telemetry, database, rule language,
  dependency, version, release, publish, or deployment change.
- No general Datalog, temporal language, aliases, aggregation, `what_if`,
  Lemmalog integration, or Rust engine.

## Stop Conditions

Stop NO-GO if a query must trust a self-derived registry, bypass Stage 1 replay,
relax the accepted four-file store, write during reads, expose raw paths/errors,
change disabled workflow behavior, add MCP or ingestion authority, or require a
new dependency.

## Return

Return the exact feature commit, JSON schema/version, command examples, focused
and full gate totals, package/ownership delta, combined review result, remaining
risk, and explicit confirmation that MCP, dogfood writing, and WO-055 remain
stopped.
