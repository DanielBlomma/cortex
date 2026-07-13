# Ingest Memory Trace Context Packet

## Objective

Add a lightweight, opt-in ingest memory trace so large-repo bootstrap runs can
show which ingest checkpoints retain peak RSS before we change more logic.

## Background

- The first memory pass already streams graph CSV rows, embedding JSONL reads
  and writes, ingest TSV/JSONL output, and worker task payloads.
- `benchmark/bootstrapbench/results/memory-rss-2026-06-16/summary.json`
  recorded Angular peak RSS at 1221.68 MB during `ingest`.
- Remaining suspected ingest retainers are `fileRecords.content`, chunk and
  relation materialization, token/rule-match maps, and parser batch payloads.
- Angular semantic-quality decisions are deferred until after this memory pass.

## Owned Scope

- `scaffold/scripts/ingest.mjs`
- Focused ingest tests under `tests/ingest-*.test.mjs` if needed.
- Small docs/control-doc updates only if they are required to explain the trace.

## Out Of Scope

- Angular parser/resource quality work orders WO-002 through WO-005.
- Benchmark RSS aggregation unless the trace needs a tiny compatibility hook.
- `scaffold/mcp/` graph/embed code.
- Branch or PR cleanup.

## Constraints

- Use Cortex MCP before implementation decisions.
- Do not remove or weaken existing ingest output fields.
- Trace must be opt-in via an environment variable, with no output or file churn
  in normal runs.
- Prefer stderr JSON-lines or a single ignored artifact under `.context/cache/`
  over changing core output contracts.
- Keep overhead low: `process.memoryUsage().rss`, counts, and checkpoint labels
  are enough.

## Required Output

- Implement `CORTEX_INGEST_TRACE_MEMORY` or an equivalent narrowly named env
  switch.
- Record checkpoints around scan/fileRecords, hydration, parse/worker merge,
  chunk/relation materialization, token/rule matching, and final writes.
- Add focused validation that normal ingest output is unchanged and trace mode
  emits useful checkpoints.
- Return changed files, commands run, and any trace limitations.

## Acceptance

- Focused ingest tests pass.
- Normal `cortex ingest` behavior remains unchanged without the env var.
- Trace output is stable enough for WO-011 to run Angular and identify the next
  concrete memory target.
