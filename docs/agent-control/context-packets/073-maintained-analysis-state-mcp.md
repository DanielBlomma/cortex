# WO-059 Maintained Analysis State — Default-Off MCP Read Exposure

## Objective

Expose the accepted WO-058 maintained-analysis read contract through a small,
explicitly enabled community MCP surface. Reuse the exact Stage 1 replay and
WO-058 authority/query envelopes; do not create a second semantic path.

The user's “go on” after WO-058 acceptance authorizes this MCP-only gate. It
does not authorize an authority or observation writer, dogfood mutation,
generated Current State/manager/handoff prose, default-on behavior, or any
WO-055 phase.

## Starting State

- Accepted WO-058 feature: `e4d47c4`.
- Accepted control integration: `287e26b`; acceptance record: `e02357b`.
- Branch: `feature/wo059-maintained-analysis-mcp`.
- Worktree: `/Users/danielnilsson/GIT/cortex-wo059-maintained-analysis-mcp`.
- Start in a fresh session using only this packet and the direct references
  below. Do not reuse the WO-058 implementation session.

## Product Decision And Ordering

WO-059 is Stage 2B, immediately after the accepted Stage 2A CLI contract.

1. The community MCP server remains unchanged by default.
2. Exact opt-in `CORTEX_MAINTAINED_ANALYSIS_MCP=1` registers the four read
   tools below. Missing, empty, or any other value registers none of them.
3. A later work order may add a validated writer and non-blind dogfood. WO-059
   must stop after read exposure is accepted.

Do not use the enterprise-only `cortex.workflow.*` namespace, which already
owns mutable Harness workflow operations. The maintained-analysis tools are
read-only context operations.

## Required MCP Surface

Register exactly these opt-in tools:

- `context.analysis_state` with `{ "task_id": string }`;
- `context.analysis_why` with `{ "task_id": string, "fact_id": string }`;
- `context.analysis_why_not` with
  `{ "task_id": string, "predicate": string }`;
- `context.analysis_changes` with
  `{ "task_id": string, "since": non-negative safe integer }`.

Inputs are exact closed objects. Task, fact, predicate, integer, unsafe-visible-
text, unknown-key, missing-key, and byte limits remain the accepted WO-058
limits. Invalid tool input must return the same bounded, sanitized
`INVALID_ARGS` envelope and must not disclose the rejected value, absolute
paths, Zod/SDK details, or raw runtime messages.

Each successful or domain-error call returns the accepted object in both MCP
`structuredContent` and text content:

- `schema_version: 1`;
- `generator_version: "maintained-analysis-cli-v1"`;
- `command: "workflow"`;
- the exact accepted `input` object when parsing succeeded;
- exact accepted `data` or closed `error`.

Text is a deterministic bounded JSON rendering of the same object. Domain
failures use only `INVALID_ARGS`, `STATE_NOT_FOUND`, `AUTHORITY_INVALID`, or
`STATE_UNTRUSTED` and set the MCP result's `isError` flag without replacing the
closed envelope with a framework exception.

## Single Query Authority

Refactor only as needed to expose a pure programmatic WO-058 query runner from
`scaffold/mcp/src/cli/workflow-analysis.ts`. Both CLI and MCP must call that
same runner and produce deeply identical envelopes for identical valid inputs,
including errors after input parsing.

The runner must continue to:

- read `.agents/<task-id>/analysis-authority.json` independently;
- validate the accepted bundle, registry, manifest, modes, containment, and
  transaction identities;
- call the unchanged Stage 1 `readAnalysisState` replay;
- use the bundle's exact `primary_subject`;
- never repair, recover, write, or trust snapshot/log metadata as authority.

No observation or authority bytes may be accepted through MCP input. No tool
may select another project root or store path.

## Owned Production Surface

- `scaffold/mcp/src/server.ts` — exact default-off registration only;
- `scaffold/mcp/src/cli/workflow-analysis.ts` — smallest additive pure runner
  extraction required for CLI/MCP parity;
- exact focused MCP tests, preferably additions to
  `scaffold/mcp/tests/server.test.mjs` and
  `scaffold/mcp/tests/analysis-state-cli.test.mjs`;
- ownership `current.json` plus one immutable version only if the packed
  managed inventory actually gains files;
- package/containment expectation changes only if measured inventory changes;
- one short WO-059 result report under `docs/agent-control/`.

The accepted reader, engine, queries, store, schemas, CLI grammar, root shim,
workflow adapter, enterprise Harness, and persisted layouts are read-only
unless a focused failing test proves a minimal additive export is unavoidable.

## Direct References

1. `docs/agent-control/maintained-analysis-state-cli-report.md` — accepted
   WO-058 behavior, gates, schemas, and residual risk.
2. `scaffold/mcp/src/cli/workflow-analysis.ts` — sole accepted public-envelope
   and operation dispatcher authority.
3. `scaffold/mcp/src/core/analysis-state/query-reader.ts` plus Stage 1
   `store.ts` and `queries.ts` — sole trust, replay, and query authorities.
4. `scaffold/mcp/src/server.ts` and `scaffold/mcp/tests/server.test.mjs` —
   community tool registration, instrumentation, structured content, and real
   stdio-client precedent.
5. `scaffold/mcp/src/enterprise/tools/harness.ts` — namespace collision to
   avoid; do not modify or reuse its mutable operations.
6. `docs/superpowers/plans/2026-08-30-maintained-analysis-state.md`, Stage 2 —
   accepted ordering. Its stale status line is not authority over the newer
   WO-058 acceptance records and must not be edited merely to update prose,
   because the plan is a code-owned source-authority byte contract.

## Required Validation

- With the opt-in absent, an actual fresh MCP stdio server's `tools/list` is
  byte/structure-identical to the accepted tool inventory and all four analysis
  names are absent.
- With exact opt-in `1`, one fresh server lists exactly the four new tools with
  exact closed input schemas; enterprise `cortex.workflow.*` remains absent in
  community mode.
- Each MCP call is deeply identical to the accepted CLI JSON envelope for the
  same fixture/input and deterministic across two fresh servers.
- Tests cover all four successes plus missing state, missing/malformed/invalid
  authority, subject selection, future/invalid epoch, unknown predicate/fact,
  unknown/missing/extra input, unsafe visible text, traversal, symlink,
  hard-link, special file, wrong mode, identity drift, bundle/manifest/registry
  tamper, store-chain/snapshot tamper, and concurrent replacement
  proportionally without duplicating WO-058's full matrix unnecessarily.
- Calls are byte-, identity-, link-, mode-, mtime-, and directory-entry-neutral
  for authority and Stage 1 store paths.
- Existing community and enterprise tool inventories, instrumentation hooks,
  CLI bytes, Stage 0/1 semantics, disabled workflow behavior, and package
  boundaries do not regress.
- TypeScript, focused MCP, full MCP, full root, package, ownership, packed
  filesystem containment, `git diff --check`, Cortex update, pattern evidence,
  and one combined MCP/Contract/Security/Validation review pass. Full package
  gates run at acceptance.

## Explicit Non-Goals

- No MCP auto-enable, config mutation, client-registration change, or new
  top-level/root CLI command.
- No observation, authority-bundle, manager-log, handoff, Current State, or
  dogfood writer.
- No workflow gating or enterprise Harness change.
- No WO-055 task, private evidence, gold, treatment, score, or blind phase.
- No network, model, provider, planner, telemetry product surface, database,
  dependency, version, release, publish, or deployment change.
- No rule language, aliases, aggregation, temporal extension, `what_if`,
  Lemmalog integration, or Rust engine.

## Stop Conditions

Stop NO-GO if MCP cannot preserve the accepted closed envelope; framework
validation leaks rejected input or raw errors; disabled registration changes
the default tool list; the adapter needs a second semantic/query path; a read
writes or repairs state; the enterprise namespace must change; authority must
come from MCP input; or a new dependency, network/model call, writer, dogfood,
or WO-055 phase is required.

## Return

Return the exact feature commit, tool names and opt-in flag, schema/generator
versions, CLI/MCP parity evidence, focused and full gate totals, package and
ownership delta, combined review result, remaining risk, and explicit
confirmation that writing, dogfood, generated Current State, and WO-055 remain
stopped.
