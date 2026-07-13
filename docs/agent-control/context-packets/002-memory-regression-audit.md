# Memory Regression Audit Context Packet

## Objective

Assess Norbert's perf draft branches for regressions and produce a staged plan
to reduce Cortex peak memory during bootstrap, ingest, embedding, graph-load,
and MCP search without weakening output quality.

## Background

- Current manager checkout is dirty on `main` with local Angular/benchmark
  improvements. Do not switch branches in the manager checkout.
- `gh pr list --state open` returned no open PRs on 2026-06-16, but remote
  branches exist:
  - `origin/perf/embed-scheduler`
  - `origin/perf/bootstrap-stage-optimizations`
- `origin/perf/embed-scheduler` is already an ancestor of `origin/main`; it is
  not a new merge candidate.
- `origin/perf/bootstrap-stage-optimizations` still has unique commits and
  `git merge-tree` against `origin/main` reports at least a `package.json`
  conflict. Treat it as stale until rebased or closed.
- Preliminary memory concern: graph-load, embed, and ingest retain large
  arrays/maps and can duplicate content across CSV generation, scheduler
  structures, and worker-thread messages.

## Work Profile

New contract/design. This adds a memory/performance acceptance contract and
may change runtime architecture across `scaffold/mcp/` and `scaffold/scripts/`.

## Owned Scope

- `scaffold/mcp/src/loadGraph.ts`, `jsonl.ts`, `graphCsv.ts` if restored or
  reworked.
- `scaffold/mcp/src/embed.ts`, `embedScheduler.ts`, `embeddings.ts`, `types.ts`.
- `scaffold/scripts/ingest.mjs`, parser dispatch, worker-thread ingest code if
  reintroduced.
- Memory benchmark tooling under `benchmark/` or `scripts/`, plus tests.
- Remote branch analysis for `origin/perf/*`.

## Out Of Scope

- Angular semantic quality work orders WO-002 through WO-005 unless memory
  measurement needs their benchmark fixtures.
- Website UI changes unrelated to benchmark/memory reporting.
- Release/version bumps unless the manager opens a release work order.

## Constraints

- Use Cortex MCP before code answers.
- Do not merge stale perf branches directly.
- Preserve local-first behavior; no source upload or external telemetry.
- Memory improvements must preserve graph and embedding semantics unless an
  explicit opt-in mode documents non-identical output.
- Add memory evidence before accepting performance changes. Runtime-only speed
  wins are not enough.

## Required Output

- Branch disposition recommendation for `perf/embed-scheduler` and
  `perf/bootstrap-stage-optimizations`.
- Risk-ranked memory findings for graph-load, embed/search vector loading, and
  ingest/parser workers.
- Work orders with dependencies and acceptance gates.
- Proposed benchmark commands and pass/fail thresholds.

## Acceptance

- Explorer findings recorded in handoff ledger.
- Risk register includes memory and stale-branch risks.
- Manager plan identifies first implementation work order and validation gate.
- No code implementation is accepted until memory benchmark evidence exists.
