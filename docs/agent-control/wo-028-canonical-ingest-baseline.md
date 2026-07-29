# WO-028 Canonical Ingest Baseline

## Scope

WO-028 makes the packaged scaffold the only ingest implementation and extracts
the pure responsibilities listed in context packet 018. It deliberately leaves
parser composition, worker scheduling/protocol, and pipeline-stage
orchestration for WO-029.

- Branch: `refactor/cli-ingest-modularization`
- Release baseline: `v2.4.1`,
  `5ae3b00948bad26af2e5eaea60ce0b52567db352`
- Canonical implementation:
  `scaffold/scripts/lib/ingest/`
- Packaged entry: `scaffold/scripts/ingest.mjs` (16 lines, executable)
- Development entry: `scripts/ingest.mjs` (14 lines, executable)
- Canonical orchestration boundary:
  `scaffold/scripts/lib/ingest/main.mjs` (1,664 lines)

## Canonical Module Map

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
| `main.mjs` | Frozen parser loading, worker lane, pipeline ordering, persistence, trace checkpoints, and CLI composition pending WO-029 |

The wrappers import the same canonical `main()` implementation. The packaged
wrapper retains compatibility re-exports, while direct unit tests target the
canonical pure modules. Copied-script fixtures now copy `lib/ingest/` together
with the wrapper, parser registry, worker, and parser fixtures.

## Frozen Output Evidence

The WO-026 normalized digests remain unchanged:

| Mode | Files | Normalized SHA-256 |
|---|---:|---|
| Full JSONL tree | 26 | `937102d472623c4d852762ab700ae510bdc30927ee8aec9aa890976e3b4d44fe` |
| Full TSV tree | 21 | `253278db329ecd74ebce9379a2e406e71841388f37ae2ee4ebf166459df7dd43` |
| Changed/deleted JSONL tree | 26 | `4fe3cf7e15908215863476a53c785c045ea71af75fb3db76ee88b41020276f3f` |
| Changed/deleted TSV tree | 21 | `7e70109126569d4534c340ce6791bb4dc8c295c7db70eb9faf14196beda6c2f4` |

The focused matrix also proves:

- development and packaged wrapper output hashes are identical;
- sequential and four-worker outputs are byte-identical;
- skipped, unavailable, partial-death, and all-death worker paths settle and
  retain inline fallback;
- the 56-file worker-failure pipeline is byte-identical to inline ingestion;
- all 17 memory trace labels, their order, fields, and count semantics remain
  unchanged.

## Validation Evidence

- `node --check` passed for both wrappers and all 11 canonical modules.
- Required focused ingest matrix: 61/61.
- Root suite: context regressions 81/81 and Node tests 300/300.
- MCP suite: 413/413.
- `git diff --check` passed.
- `npm pack --dry-run --json --cache
  /private/tmp/cortex-wo028-npm-cache` passed:
  - version `2.4.1`
  - 409 entries
  - packed size 621,660 bytes
  - unpacked size 2,606,574 bytes
  - packaged wrapper mode `0755`
  - all 11 `scaffold/scripts/lib/ingest/*.mjs` modules present

## Review Closure

Independent Code Quality, Contract, Security and Privacy, Integration, and
Validation review closed with no blocker or major findings.

- Code Quality/Integration found one minor documentation mismatch: the
  canonical main line count was recorded as 1,662 instead of 1,664. The two
  references were corrected and re-review passed.
- Contract/Validation confirmed canonical ownership, compatibility exports,
  byte-identical extracted helper/worker/main bodies except for the required
  relocated worker URL, all frozen hashes/equivalence/trace contracts, both
  full suites, and package inclusion.
- Security/Privacy found no WO-028-specific finding and confirmed no network,
  upload, secret, or command-injection path was added.
- Pattern-evidence commands were attempted for all changed files. The indexed
  control docs and root wrapper passed; `scaffold/` and `tests/` are outside
  the user-configured Cortex `source_paths`, so those targets returned
  not-indexed and were covered by direct repo-local comparison and tests.

Two pre-existing security residuals remain explicitly outside this
behavior-preserving refactor and are tracked as R16:

- configured absolute/parent/symlinked source paths are not contained to the
  project root;
- cache/DB output paths do not reject symlink destinations, and staged JSONL
  temporary names are predictable.

## WO-029 Boundary

WO-029 starts from the 1,664-line canonical `main.mjs`. It may extract parser
composition, worker scheduling/protocol, streaming result consumption, and
explicit pipeline stages. It must not redesign:

- sorted file-record merge order;
- worker threshold/count resolution;
- missing/invalid/skipped/crashed worker fallback;
- trace labels, ordering, fields, or counts;
- JSONL/TSV ordering or schemas;
- incremental deletion/hydration semantics;
- retained-result and released-content behavior.

The repeated memory comparison remains anchored to
`docs/agent-control/wo-026-characterization-baseline.md`. Investigate median
peak-RSS movement above five percent before accepting WO-029.
