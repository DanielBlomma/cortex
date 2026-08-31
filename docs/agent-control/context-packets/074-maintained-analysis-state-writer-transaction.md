# WO-060 Maintained Analysis State — Trusted Append Transaction

## Objective

Implement the smallest production writer boundary that can append one validated
observation to an already provisioned and trusted maintained-analysis state.
Rotate the independent authority bundle and Stage 1 store through one
fail-closed, explicitly recoverable transaction. Do not expose the writer
through CLI or MCP and do not bootstrap authority from caller-supplied policy.

The user's “go on” after WO-059 acceptance authorizes this writer-transaction
gate only. It does not authorize dogfood, generated Current State/manager/
handoff prose, a fresh-task authority bootstrapper, automatic workflow writes,
or any WO-055 phase.

## Starting State

- Accepted WO-059 feature: `4235a36`.
- Accepted control integration: `9c4aa5e`.
- Branch: `feature/wo060-maintained-analysis-writer`.
- Worktree: `/Users/danielnilsson/GIT/cortex-wo060-maintained-analysis-writer`.
- Start in a fresh session using only this packet and the direct references
  below. Do not reuse the WO-059 implementation session.

## Product Decision And Ordering

WO-060 is the write-side contract gate between accepted read exposure and any
dogfood.

1. The existing state and `analysis-authority.json` must already be present and
   pass the accepted WO-058/059 trusted reader before a write begins.
2. The writer may extend that exact authority; it may not create initial
   authority, replace `primary_subject`, or change the source-authority
   registry.
3. Only an internal TypeScript API is added. CLI, MCP, workflow automation,
   generated views, and dogfood remain later work orders.
4. Reads remain non-repairing. An interrupted writer is recovered only through
   the explicit writer recovery path.

## Required Internal Contract

Expose one narrow API, with exact naming chosen by the implementation but this
semantic input:

```text
appendTrustedAnalysisObservation({
  enabled: true,
  cwd,
  taskId,
  repository,
  expectedGeneration,
  expectedAuthorityBundleSha256,
  observation: ObservationInput
})
```

Requirements:

- `enabled` must be the literal `true`; omission or any other value fails
  before filesystem mutation.
- `expectedGeneration` is a non-negative safe integer and both expected values
  are mandatory compare-and-swap bindings to the trusted pre-state.
- `ObservationInput` is validated only by the accepted native observation
  constructor. IDs and payload hashes remain content-derived, never input.
- `scope.repository` must equal the trusted repository and
  `scope.work_order` must equal the bundle's exact `primary_subject`.
- The observation's exact source path/hash must already exist in the trusted
  bundle's source-authority registry, and that registry must already authorize
  the observation authority. The writer accepts no registry, authority
  manifest, bundle, primary subject, store path, or alternate root through an
  external/public payload.
- Duplicate observation IDs, stale generation/bundle bindings, retractions of
  unknown observations, and non-append changes fail without modifying bytes.
- Success returns the exact new trusted read binding: generation, snapshot
  hash, observation head/count, authority bundle/manifest hashes, registry
  hash, and appended observation ID. Output is canonical, bounded, and contains
  no absolute paths or raw runtime errors.

## Single Authority And Semantic Path

- Begin every append with `readTrustedAnalysisState`; do not trust a snapshot,
  store manifest, or authority file independently.
- Reuse `createWorkflowAnalysisObservation`, `createAuthorityManifest`,
  `publishAnalysisState`, `recoverAnalysisState`, and the accepted authority
  bundle validation/canonicalization. Extract a smallest shared pure authority
  helper if required; do not copy the WO-058 validator.
- Preserve the exact old `repository`, `task_id`, `primary_subject`, and
  `source_authorities`. The new authority manifest is derived only from the
  trusted old observations plus the one validated new observation.
- The Stage 1 evaluator, rules, proof semantics, query envelopes, and persisted
  steady-state layout remain unchanged.

## Cross-File Transaction And Recovery

The store manifest and `analysis-authority.json` cannot be replaced atomically
as one filesystem object. Make that boundary explicit rather than pretending
it is atomic.

- Use one contained task-local coordinator lock plus one closed, hash-bound
  transaction intent. Both are mode `0600`, regular, single-link files beneath
  the exact task directory and are absent in steady state.
- The intent binds repository/task identity, expected old generation and
  authority hash, exact observation ID/payload hash, exact new authority bytes
  and hash, and the intended new authority-manifest/store bindings.
- Stage and fsync the intent/new authority before Stage 1 publication. Commit
  the new authority only after the store generation is durably published.
- During any incomplete transaction the ordinary trusted reader may fail
  closed. It must never repair, ignore transaction artifacts, or return a mixed
  generation.
- Provide an explicit internal recovery operation. Recovery validates every
  intent, lock, old/new authority, store, identity, mode, link, and hash binding
  before either completing exactly the intended append or removing an intent
  that provably made no store change.
- Injected failure before/after intent, observation append, derived-file
  publication, authority replacement, and intent cleanup must leave either the
  exact trusted old state or a state that only explicit recovery can complete
  to the exact trusted new generation.
- A stale/exited coordinator lock is reclaimable only under the accepted
  process-identity policy. Live, malformed, linked, redirected, or replaced
  locks/intents fail closed.
- Two concurrent writers for the same expected generation produce exactly one
  committed append. The loser reports stale state and cannot alter either
  transaction.

## Owned Production Surface

- Prefer one new module under
  `scaffold/mcp/src/core/analysis-state/` for append/recovery orchestration.
- Small additive exports/refactors in `query-reader.ts`, `store.ts`, or
  `analysis-state-adapter.ts` are allowed only to share the accepted authority,
  recovery, or observation path.
- Add one focused writer test file under `scaffold/mcp/tests/`.
- Add ownership `current.json` plus one immutable version only if the packed
  managed inventory gains files.
- Change package/containment expectations only by the measured inventory delta.
- Add one short WO-060 result report under `docs/agent-control/`.

The CLI root shim/runtime, MCP server registrations, enterprise Harness,
Stage 0 oracle/fixture, rules, query envelopes, manager/handoff rendering, and
WO-055 artifacts are read-only.

## Direct References

1. `docs/agent-control/maintained-analysis-state-mcp-report.md` — accepted
   WO-059 surface, gates, and residual writer risk.
2. `scaffold/mcp/src/core/analysis-state/query-reader.ts` — sole trusted
   pre-state and authority-bundle reader.
3. `scaffold/mcp/src/core/analysis-state/store.ts` — sole Stage 1
   publish/recovery and filesystem transaction authority.
4. `scaffold/mcp/src/core/analysis-state/engine.ts`, `schemas.ts`, and
   `queries.ts` — exact observation, authority-manifest, evaluation, and query
   semantics.
5. `scaffold/mcp/src/core/workflow/analysis-state-adapter.ts` — explicit
   observation-construction and workflow-gate seam.
6. `scaffold/mcp/tests/analysis-state-store.test.mjs` and
   `analysis-state-cli.test.mjs` — accepted crash, containment, authority, and
   read-neutrality precedents.
7. `docs/superpowers/plans/2026-08-30-maintained-analysis-state.md`, Stage 2 —
   ordering only. Do not edit its code-owned bytes merely to update status.

## Required Validation

- Happy append followed by fresh CLI and opt-in MCP reads returns the exact new
  observation, snapshot, changes, proofs, and authority/store bindings.
- Disabled, stale, duplicate, malformed, wrong-scope, unknown-source,
  unauthorized-authority, invalid-retraction, and bound-overflow inputs leave
  full byte/identity/mode/link/mtime/directory-entry snapshots unchanged.
- Failure injection covers every transaction boundary and proves exact old or
  explicitly recovered new trusted state across fresh processes.
- Symlink, hard-link, FIFO/socket where supported, directory, wrong-mode,
  ancestor redirection, validation-to-open replacement, intent/lock replay,
  concurrent replacement, live lock, exited lock, and two-writer races fail
  closed without external mutation.
- Default CLI help/grammar and community MCP inventory remain byte/structure
  identical. No write command or tool is listed even when the WO-059 read flag
  is enabled.
- Stage 0 oracle/native parity, Stage 1 store/workflow, WO-058 CLI, WO-059 MCP,
  enterprise workflow, instrumentation, and disabled behavior do not regress.
- TypeScript, focused writer/read, full MCP, full root, package, ownership,
  packed filesystem containment, `git diff --check`, Cortex update, pattern
  evidence, and one combined Core/Contract/Security/Validation review pass.
  Full package gates run at acceptance.

## Explicit Non-Goals

- No fresh-task/bootstrap authority creation and no caller-supplied authority
  bundle, source registry, primary subject, or trust policy.
- No CLI/MCP writer, default enablement, config/client mutation, workflow
  auto-emission, or enterprise Harness change.
- No dogfood state mutation and no generated Current State, manager, handoff,
  or other prose.
- No WO-055 task, private evidence, gold, treatment, score, blind phase, or
  acceptance inference.
- No network, model, provider, planner, telemetry product surface, database,
  dependency, release, publish, or deployment change.
- No rule/predicate/authority expansion, arbitrary rule language, `what_if`,
  Lemmalog integration, or Rust engine.

## Stop Conditions

Stop NO-GO if the trusted old state cannot be proved before mutation; authority
or registry policy must come from writer input; an interrupted transaction can
be mistaken for trusted current state; recovery requires ordinary reads to
repair; rollback rewrites committed observation history; external targets can
be mutated; concurrency can commit twice; a public writer must be added; or a
new dependency, dogfood mutation, generated prose, network/model call, or
WO-055 phase is required.

## Return

Return the exact feature commit, internal append/recovery API and transaction
files, before/after authority/store bindings, failure/concurrency totals,
focused and full gate totals, package/ownership delta, combined review result,
remaining bootstrap risk, and explicit confirmation that CLI/MCP writing,
dogfood, generated Current State, and WO-055 remain stopped.
