# Memory Benchmark Analysis Context Packet

## Objective

Run the next memory benchmark after WO-010 lands, analyze Cortex and Angular
RSS/trace output, and recommend the next code change. Do not decide Angular
semantic-quality work yet.

## Background

- The current memory benchmark config is
  `benchmark/bootstrapbench/config.memory-rss.json`.
- The latest accepted run is `memory-rss-2026-06-16` with Cortex and Angular
  only.
- Current measured peaks:
  - Cortex: max RSS 611.27 MB, phase `embed`.
  - Angular: max RSS 1221.68 MB, phase `ingest`.
- Unsupported Angular file decisions are deferred until after the memory work.

## Owned Scope

- Read-only benchmark execution and result analysis.
- Ignored result files under `benchmark/bootstrapbench/results/`.
- Control-doc summary updates in `docs/agent-control/` if assigned by manager.

## Out Of Scope

- Code edits to parser, ingest, benchmark, graph, embed, or frontend code.
- Adding repos beyond Cortex and Angular unless the manager explicitly asks.
- Angular semantic/resource quality decision.

## Constraints

- Use the Cortex/Angular-only benchmark config.
- If the run would take too long, capture partial trace/RSS evidence and state
  exactly what completed.
- Compare against `memory-rss-2026-06-16` using absolute dates and run IDs.
- Keep ignored benchmark artifacts out of the tracked diff unless the manager
  explicitly requests publishing data.

## Required Output

- Commands run and whether each repo succeeded.
- Peak RSS by repo and phase.
- Ingest trace checkpoints for Angular if WO-010 trace is available.
- One prioritized next memory change with evidence.
- Explicit note that Angular quality backlog remains deferred.

## Acceptance

- New benchmark evidence exists or the blocker is documented with the last
  completed phase.
- The next memory change is grounded in measured RSS/trace evidence.
