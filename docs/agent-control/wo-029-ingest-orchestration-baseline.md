# WO-029 Ingest Orchestration Baseline

## Scope

WO-029 extracts parser loading/dispatch composition, worker scheduling and
streaming protocol, sorted result consumption, and bounded ingest pipeline
stages from the canonical packaged implementation. Observable ingest behavior
remains frozen at the WO-026/WO-028 contract.

- Branch: `refactor/cli-ingest-modularization`
- Release baseline: `v2.4.1`,
  `5ae3b00948bad26af2e5eaea60ce0b52567db352`
- Canonical implementation: `scaffold/scripts/lib/ingest/`
- Packaged entry: `scaffold/scripts/ingest.mjs` (16 lines, executable)
- Development entry: `scripts/ingest.mjs` (14 lines, executable)
- Canonical composition: `scaffold/scripts/lib/ingest/main.mjs` (76 lines)
- Parser compatibility entry: `scaffold/scripts/ingest-parsers.mjs` (1 line)

## Canonical Architecture

The canonical library now contains 15 modules:

| Module | Responsibility |
|---|---|
| `arguments.mjs` | CLI arguments, integer environment parsing, and opt-in memory trace records |
| `constants.mjs` | Ingest extension sets, limits, defaults, patterns, and stop words |
| `runtime-paths.mjs` | Canonical script, project, context, cache, and DB-import roots |
| `files.mjs` | Text/binary policy, path normalization, Git discovery, candidate collection, kind/trust metadata, and file/ADR helpers |
| `io.mjs` | Ordered JSONL/TSV streaming writers, staged JSONL writes, and safe JSONL reads |
| `config.mjs` | Source/rule parsing and rule/file token matching |
| `chunks.mjs` | Chunk IDs/descriptions, overlap windows, module summaries, and module relations |
| `relations.mjs` | Config, resource, settings, SQL, transform, include, and handler relation builders |
| `projects.mjs` | Solution and project entities plus file/project relations |
| `incremental-state.mjs` | Cached chunk/relation hydration and per-file state removal |
| `parser-registry.mjs` | Frozen parser load order, extension registry, availability checks, C# entrypoints, and inline file parse dispatch |
| `parser-composition.mjs` | Parser initialization, C# runtime/batch composition, eligibility gates, and parallel-safe worker task selection |
| `workers.mjs` | Worker-count resolution, message protocol, settlement/termination, streaming result consumption, and compatibility map collection |
| `pipeline-stages.mjs` | State-passing scan/hydration, parse, materialization, token matching, cache, DB, and manifest stages |
| `main.mjs` | Explicit ordered stage composition and compatibility exports |

The parser registry body is byte-equivalent to the accepted top-level registry
after only normalizing parser import paths for its nested location. The
top-level parser entry is now a compatibility re-export. The worker entry
imports that canonical registry directly.

`main()` initializes parser composition, creates one mutable pipeline state
object, and invokes these stages in order:

1. scan and hydration;
2. parse and sorted worker-result merge;
3. chunk/relation/module/project materialization;
4. staged file-cache writes;
5. token/rule matching and file-content release;
6. cache writes;
7. DB writes;
8. manifest completion.

Stages pass existing arrays, maps, sets, writers, and records by reference.
There is no stage-boundary clone of file, chunk, relation, task, or content
collections.

## Frozen Behavior Evidence

The WO-026 normalized digests remain unchanged:

| Mode | Files | Normalized SHA-256 |
|---|---:|---|
| Full JSONL tree | 26 | `937102d472623c4d852762ab700ae510bdc30927ee8aec9aa890976e3b4d44fe` |
| Full TSV tree | 21 | `253278db329ecd74ebce9379a2e406e71841388f37ae2ee4ebf166459df7dd43` |
| Changed/deleted JSONL tree | 26 | `4fe3cf7e15908215863476a53c785c045ea71af75fb3db76ee88b41020276f3f` |
| Changed/deleted TSV tree | 21 | `7e70109126569d4534c340ce6791bb4dc8c295c7db70eb9faf14196beda6c2f4` |

The focused and context-regression matrices also prove:

- development and packaged wrapper outputs remain equivalent;
- sequential and four-worker outputs remain byte-identical;
- worker threshold/count resolution remains unchanged;
- missing, invalid, skipped, partial-death, all-death, and disabled worker
  paths settle and retain inline fallback;
- the 56-file worker-failure pipeline remains byte-identical to inline ingest;
- streaming consumption remains in sorted `fileRecords` order;
- `worker_results_retained=0` and `worker_results_pending=0` at completion;
- all 17 memory trace labels retain their order, fields, and count semantics;
- incremental structured-target relations, windows, metadata, module exports,
  and JS/TS import/call attribution remain unchanged;
- the unavailable C# runtime preserves file-level output and parser health.

## Validation Evidence

- `node --check` passed for both wrappers, the parser compatibility entry, the
  worker entry, and all 15 canonical modules (19 files).
- Required focused ingest matrix: 63/63.
- Context regressions: 81/81.
- Full root Node suite: 302/302.
- Full MCP suite: 413/413.
- `git diff --check` passed.
- Parser-registry relocation comparison passed after normalizing only the
  required `../../parsers/` import prefix.
- `cortex update` completed with 65 embedded, 971 reused, and zero failed
  entities; graph load completed.
- Pattern evidence passed for all seven changed indexed control/context
  documents. The 11 changed `scaffold/` and `tests/` paths are outside the
  configured `bin, scripts, docs, README.md` source paths and returned
  not-indexed; direct relocation comparison, focused/full tests, and
  independent review covered those paths.
- `cortex doctor` passed 8/8; the optional watcher is stopped.
- `npm pack --dry-run --json --cache
  /private/tmp/cortex-wo029-npm-cache` passed:
  - version `2.4.1`;
  - 413 entries;
  - packed size 623,302 bytes;
  - unpacked size 2,615,869 bytes;
  - packaged wrapper mode `0755`;
  - all 15 `scaffold/scripts/lib/ingest/*.mjs` modules, the parser
    compatibility entry, and the worker entry present.

## Repeated Memory Comparison

Three comparable Docker runs used the exact WO-026 configuration:

- `benchmark/bootstrapbench/config.memory-rss.json`;
- image `cortex-bootstrapbench:memory-rss`;
- `Xenova/all-MiniLM-L6-v2`;
- `parallelism=1`, no Docker CPU quota;
- pinned Cortex SHA `051d4e6a87d968795482f65d900eda5dc8a94aae`;
- pinned Angular SHA `71bb19d772aa77a30922fb896f775b58a0862c36`.

All six repository samples completed with `status=ok`.

| Repository | Run | Total ms | Ingest ms | Embed ms | Peak RSS MB | Peak phase |
|---|---:|---:|---:|---:|---:|---|
| `DanielBlomma/cortex` | 1 | 5,806 | 109 | 2,990 | 626.87 | embed |
| `DanielBlomma/cortex` | 2 | 6,108 | 112 | 3,128 | 628.02 | embed |
| `DanielBlomma/cortex` | 3 | 5,929 | 108 | 3,109 | 625.93 | embed |
| `angular/angular` | 1 | 663,751 | 5,728 | 654,039 | 1,021.32 | ingest |
| `angular/angular` | 2 | 679,525 | 5,682 | 669,950 | 1,030.64 | ingest |
| `angular/angular` | 3 | 665,467 | 5,687 | 655,793 | 1,036.34 | ingest |

Median peak-RSS comparison:

| Repository | WO-026 median MB | WO-029 median MB | Delta |
|---|---:|---:|---:|
| `DanielBlomma/cortex` | 614.34 | 626.87 | +2.04% |
| `angular/angular` | 1,034.24 | 1,030.64 | -0.35% |

Both medians remain inside the five-percent acceptance band. Median Angular
ingest duration is 5,687 ms, +2.19% versus WO-026's 5,565 ms. Median Cortex
ingest duration is 109 ms, -5.22% versus WO-026's 115 ms.

The durable raw summaries are intentionally ignored benchmark artifacts:

- `benchmark/bootstrapbench/results/wo029-memory-1-20260729/summary.json`
- `benchmark/bootstrapbench/results/wo029-memory-2-20260729/summary.json`
- `benchmark/bootstrapbench/results/wo029-memory-3-20260729/summary.json`

## Review Closure

Independent Code Quality, Contract, Security and Privacy, Integration, and
Validation reviewers covered all five required roles. Code Quality and
Validation independently found one major defect: the extracted materialization
stage's verbose overlap-window diagnostic referenced three settings that were
not read from pipeline state. Default and non-verbose behavior remained green,
but `--verbose` with overlap windows exited unsuccessfully. The stage now reads
those settings from the shared state, and a subprocess regression proves the
diagnostic plus manifest completion. Code Quality, Contract, Security and
Privacy, Integration, and Validation returned PASS with no remaining blocker,
major, or minor findings.

## Residual Risks

- R16 remains the accepted pre-existing ingest filesystem-containment risk:
  configured sources can escape the project root, and cache/DB output paths do
  not reject symlink destinations. WO-029 intentionally preserves that 2.4.1
  behavior and adds no network or source-upload path.
- R15 remains open for WO-030 managed-scaffold ownership and obsolete-file
  cleanup.

## WO-030 Boundary

WO-030 starts from the architecture and validation above. It owns only
versioned managed-file ownership, contained obsolete-file cleanup, preservation
rules, negative migration coverage, and package/upgrade smokes. It must not
redesign ingest, remove MCP compatibility, or bump the package version.

Start the next fresh session from
`docs/agent-control/context-packets/020-managed-scaffold-upgrade-hygiene.md`.
