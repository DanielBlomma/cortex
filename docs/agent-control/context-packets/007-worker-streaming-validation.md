# Worker Streaming Validation Context Packet

## Objective

Validate WO-013 on real benchmark data by rerunning Cortex/Angular memory
evidence after worker parse results are consumed through the streaming path.

## Background

- WO-011 baseline after trace instrumentation:
  - Run `memory-rss-trace-2026-06-16` succeeded 2/2.
  - Cortex peak RSS: 614.94 MB in `embed`.
  - Angular peak process-tree RSS: 1359.15 MB in `ingest`.
  - Manual Angular trace before WO-013:
    - `parse:workers_start`: 230.10 MB
    - `parse:workers_complete`: 459.82 MB, `worker_results=7294`
    - `parse:merge_complete`: 592.93 MB
- WO-013 added streaming worker result consumption and trace counts:
  `worker_results_retained`, `worker_results_retained_peak`,
  `worker_results_pending`, and `worker_results_consumed`.
- Full root `npm test` after WO-013 passed 193/193.

## Owned Scope

- Read-only benchmark execution and analysis.
- Ignored result files under `benchmark/bootstrapbench/results/`.

## Out Of Scope

- Code edits.
- Angular semantic/resource quality decisions.
- Branch, staging, commit, or PR operations.

## Constraints

- Use Cortex/Angular-only `benchmark/bootstrapbench/config.memory-rss.json`.
- Build the Docker image from the current working tree so WO-013 is included.
- The official runner may not forward `CORTEX_INGEST_TRACE_MEMORY`; if so,
  capture a manual Angular-only trace log as in WO-011.
- Do not keep auxiliary containers running after trace capture.

## Required Output

- Commands run and result paths.
- Whether each repo succeeded.
- Peak RSS by repo/phase compared with `memory-rss-trace-2026-06-16`.
- Angular trace comparison for `parse:workers_start`,
  `parse:workers_complete`, `parse:merge_complete`, and retained/pending
  worker result counts.
- One concise recommendation for the next memory step.
- Explicit note that Angular semantic-quality work remains deferred.

## Acceptance

- Benchmark/trace evidence exists, or a concrete blocker is documented.
- No code or git state changes are made.
