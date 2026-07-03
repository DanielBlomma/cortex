# Ingest Worker Result Streaming Context Packet

## Objective

Reduce Angular ingest peak memory by avoiding retention of a full
`Map<fileId, parseResult>` for all worker-parsed files before the merge loop.

## Background

- WO-010 added `CORTEX_INGEST_TRACE_MEMORY` checkpoints.
- WO-011 ran `memory-rss-trace-2026-06-16`:
  - Cortex succeeded, peak RSS 614.94 MB in `embed`.
  - Angular succeeded, peak process-tree RSS 1359.15 MB in `ingest`.
  - Manual Angular ingest trace showed main-process RSS:
    - `parse:workers_start`: 230.10 MB, `worker_tasks=7787`, `worker_count=8`
    - `parse:workers_complete`: 459.82 MB, `worker_results=7294`
    - `parse:merge_complete`: 592.93 MB, `chunks=22742`
    - `writes:manifest_complete`: 622.63 MB
- The gap between main-process trace and process-tree RSS means workers still
  dominate peak, but retaining thousands of worker results before merge is the
  next measured main-process target.

## Owned Scope

- `scaffold/scripts/ingest.mjs`
- `tests/ingest-parallel.test.mjs`
- Additional focused ingest test files if necessary.

## Out Of Scope

- Angular semantic/resource quality work orders WO-002 through WO-005.
- Benchmark runner/env forwarding changes.
- `scaffold/mcp/`, parser implementations, C#/VB bridge changes, frontend.
- Branch/PR staging or remote branch cleanup.

## Constraints

- Use Cortex MCP before implementation decisions.
- Do not change ingest output semantics.
- Preserve deterministic merge order. Current output is based on sorted
  `fileRecords`; do not merge parse results directly in nondeterministic worker
  completion order unless tests prove byte-identical output.
- Preserve worker fallback behavior: skipped, missing, crashed, or invalid
  worker results must still fall back to inline parsing.
- Keep normal non-worker and `CORTEX_INGEST_WORKERS=0` behavior unchanged.
- The trace checkpoint labels from WO-010 must remain parseable.

## Required Output

- Refactor worker result handling so the caller can consume completed parse
  results without holding every successful worker result until all workers are
  done.
- Keep or improve trace counts so the manager can see retained/pending worker
  results after the change.
- Add or update focused tests proving parallel ingest remains byte-identical to
  sequential output and worker fallback still works.
- Run syntax checks and focused ingest tests.

## Acceptance

- Focused ingest tests pass, including parallel-vs-sequential equivalence.
- `node --check scaffold/scripts/ingest.mjs` passes.
- A manager can rerun Angular trace and compare `parse:workers_complete` /
  `parse:merge_complete` RSS against WO-011.
