# Output, Cache, and Dashboard-Data Containment

## Objective

Implement WO-034 by extending the accepted canonical real-project boundary to
all prior-cache files, output-directory construction, 48 ingest output leaves,
whole-set staging/commit/cleanup, and every dashboard manifest, relation, and
npm-cache access. Preserve all accepted WO-033 source/control/worker behavior
and every safe `v2.4.2` output contract.

Do not begin until the manager records independent Code Quality, Contract,
Security and Privacy, Integration, and Validation acceptance of
`docs/agent-control/wo-033-source-control-file-containment-baseline.md` and the
accepted WO-033 implementation commit.

## Durable Starting State

- Branch: continue from the manager-accepted WO-033 commit on
  `plan/r16-ingest-filesystem-containment`.
- Released compatibility baseline: `v2.4.2`, tag commit `736becf`.
- WO-033 establishes the sole real-project anchor, portable configured-source
  grammar, host repository identities, control/source discovery and reopen
  policy, worker fatal protocol, secondary README policy, and dashboard source
  pre-scan.
- The packaged library under `scaffold/scripts/lib/ingest/` remains the only
  canonical ingest implementation.
- R16 remains open until packed-artifact acceptance in WO-035.

## Required Contract Anchors

- `docs/agent-control/wo-033-source-control-file-containment-baseline.md`
  - accepted project/source/error contract, validation evidence, residual,
    and explicit remaining WO-034 ownership
- `docs/agent-control/wo-032-ingest-filesystem-containment-baseline.md`
  - complete operation inventory, 48-output inventory, frozen hashes, error
    grammar, migration contract, and WO-033/WO-034 split
- `docs/agent-control/wo-030-managed-scaffold-baseline.md`
  - reviewed segment validation, exclusive sibling staging, atomic rename,
    hard-link replacement, cleanup, and portable-Node residual patterns
- `scaffold/scripts/lib/ingest/filesystem-boundary.mjs`
  - canonical real-project anchor and closed filesystem-policy schema
- `scaffold/scripts/lib/ingest/runtime-paths.mjs`
  - accepted lazy real-root composition and current output path derivation
- `scaffold/scripts/lib/ingest/io.mjs`
  - current JSONL/TSV reads, direct writes, and two-file predictable staging
- `scaffold/scripts/lib/ingest/pipeline-stages.mjs` and
  `scaffold/scripts/lib/ingest/main.mjs`
  - prior-cache timing, directory creation, staged/direct output ordering,
    manifest publication, and final completion output
- `scaffold/scripts/lib/ingest/incremental-state.mjs`
  - seven changed-mode prior-cache consumers and accepted membership filtering
- `scripts/dashboard.mjs` and `scaffold/scripts/dashboard.mjs`
  - accepted source pre-scan and all remaining dashboard data/npm consumers
- `tests/ingest-characterization.test.mjs`,
  `tests/ingest-parallel.test.mjs`, `tests/ingest-worker-crash.test.mjs`,
  `tests/ingest-memory-trace.test.mjs`, `tests/dashboard.test.mjs`, and
  `tests/ingest-filesystem-boundary.test.mjs`
  - frozen output/order/worker/trace/dashboard contracts and temporary-root
    safety patterns

## Owned Scope

- Cache/output/dashboard-data APIs in the canonical filesystem boundary
- Safe existing-prefix validation and missing-directory construction below
  the accepted real `.context`
- Contained regular-file validation for all seven prior-cache JSONL inputs
- Preflight of all existing output directories, parents, and leaves before
  the first stage/write/rename
- Unpredictable exclusive same-directory staging for all 26 JSONL files, all
  21 TSV files, and `manifest.json`
- Whole-set staging, pre-commit revalidation, deterministic commit,
  `manifest.json` publication last, and cleanup of all uncommitted stages
- Hard-link-safe replacement through new staged inodes
- All-before-any dashboard-data preflight for cache/embedding ancestors, three
  manifests, six relation leaves, and npm-cache before data read or npm lookup
- Bounded cache/dashboard/output policy diagnostics using the already closed
  WO-032/WO-033 codes, phases, subject kinds, and reasons
- Focused benign temporary-root negative and compatibility tests
- Package/ownership inventory only if canonical runtime files change
- WO-034 baseline and a focused WO-035 integrated acceptance packet

## Out of Scope

- Project/control/source syntax, discovery, worker protocol, or README-policy
  redesign accepted in WO-033
- Parser semantics, hashes, IDs, graph schema, ranking, embeddings, or memory
  redesign
- Cross-file transactional claims that portable rename cannot provide
- External output roots, allowlists, telemetry, source-data egress, or new
  network paths
- Tree-sitter assets, C#/VB toolchain inputs/artifacts, external parser
  executables, or optional restore behavior
- Version/release metadata, release classification, publish, tag, merge, or
  deploy; WO-035 owns integrated release readiness and the alias-fix
  classification

## Required Design

### Canonical data/output policy

Extend the existing boundary; do not create a second containment
implementation. Use only the closed WO-032 fields:

- prior cache: `CORTEX_FS_CACHE`, phase `discovery`, subject kind `cache_path`;
- dashboard data: `CORTEX_FS_DASHBOARD`, phase `dashboard_data`, subject kind
  `dashboard_path`;
- output preflight/commit: `CORTEX_FS_OUTPUT`, phases `output_preflight` and
  `output_commit`, subject kind `output_path`.

Use only the accepted reasons. Diagnostics remain one bounded JSON-escaped
line and never expose resolved external paths, symlink targets, temporary
random names, file content, or stacks.

Every caller supplies a known project-relative cache/dashboard/output
identity. Reconstruct from the real anchor. Never authorize an absolute path
because a writer or dashboard caller supplied it.

### Existing prefixes and directory construction

Before any cache read, stage creation, write, rename, dashboard data access, or
npm invocation:

1. Revalidate the real `.context` anchor established by WO-033.
2. Inspect every existing component of `.context/cache`, `.context/db/import`,
   and (for dashboard data) `.context/embeddings` with non-following metadata.
3. Reject symlink, non-directory, or special existing components.
4. Create each missing output directory one segment at a time below the
   already validated parent. Revalidate after creation and before later use.

Do not use recursive `mkdirSync` as authority. Preserve safe missing output
directory creation. Dashboard data directories are inputs here: safe absence
keeps current fallback and must not be created merely by dashboard preflight,
except npm-cache remains an npm-managed location after the complete data
preflight succeeds.

### Prior-cache reads

Changed mode may read exactly these seven files:

- `.context/cache/entities.file.jsonl`
- `.context/cache/entities.adr.jsonl`
- `.context/cache/entities.chunk.jsonl`
- `.context/cache/relations.defines.jsonl`
- `.context/cache/relations.calls.jsonl`
- `.context/cache/relations.imports.jsonl`
- `.context/cache/relations.calls_sql.jsonl`

Preflight the complete set before reading any one file. Each existing leaf
must be a non-symlink regular file with non-symlink ancestors. Safe absence
retains the current empty-cache fallback. Preserve blank/malformed-line skip
behavior inside an accepted regular file. WO-033 repository-identity and
accepted-file membership validation remains unchanged after the file itself
is authorized.

### Output set and staging

The output set is fixed at 48 leaves: the 26 JSONL files and 21 TSV files
listed in the WO-032 baseline plus `.context/cache/manifest.json`.

- Preflight every parent and every existing final leaf before creating any
  stage. Existing leaves may be regular files, including multiply linked
  regular files; reject directory, symlink, FIFO, socket, device, and other
  special leaves.
- Create every stage beside its target with an unpredictable name and
  exclusive creation (`wx` or an equivalent exclusive primitive).
- Write and close the complete staged set before the first final rename.
- On staging or pre-commit failure, remove every stage created by this run and
  leave the previous complete final set unchanged.
- Immediately before each commit, revalidate the parent and final target.
  Rename the new inode atomically over the final path. Never open/truncate a
  final destination inode; replacing a hard-linked destination must leave the
  other link and its content unchanged.
- Commit data leaves in one deterministic order and publish
  `manifest.json` last. Normal completion output occurs only after manifest
  commit.
- On commit-phase failure, remove every still-uncommitted stage. Record
  honestly that a prefix may already have been replaced; portable Node does
  not provide a 48-file transaction.

Preserve ordered JSONL/TSV bytes, the four normalized hashes, output counts,
manifest shape, trace labels/order/counts, streaming memory bounds, and
sequential/parallel/worker-failure identity.

### Dashboard all-before-any data preflight

WO-033 source/config scanning remains the first dashboard operation. After a
safe baseline scan and before `gatherData()` reads any data or invokes npm,
preflight every existing item in this complete layout:

- `.context/cache`
- `.context/embeddings`
- `.context/cache/manifest.json`
- `.context/cache/graph-manifest.json`
- `.context/embeddings/manifest.json`
- `.context/cache/relations.constrains.jsonl`
- `.context/cache/relations.implements.jsonl`
- `.context/cache/relations.supersedes.jsonl`
- `.context/cache/relations.defines.jsonl`
- `.context/cache/relations.calls.jsonl`
- `.context/cache/relations.imports.jsonl`
- `.context/cache/npm-cache`

No manifest/relation may be read before every existing component/leaf above
has passed. No `npm view` may run before the same complete preflight. Existing
manifest/relation leaves must be non-symlink regular files; existing
cache/embeddings/npm-cache components must be non-symlink directories. Safe
missing optional data preserves null/empty rendering. A fake npm counter must
prove every denial occurs before invocation.

Keep root and packaged project-root defaults, extension sets, baseline counts,
de-duplication, local Git freshness behavior, version-cache semantics, and
normal non-TTY rendering unchanged.

## Benign Negative Test Matrix

All tests create project, output/data layout, external canaries, links, and
hard links under one test-owned temporary parent and remove it afterward.
Never inspect real external content.

| Area | Required cases | Required result |
|---|---|---|
| Existing ancestors | cache/db/embeddings ancestor is symlink, file, FIFO/socket where supported | Deny before read, mkdir, stage, output mutation, dashboard data, or npm |
| Prior cache | each of seven leaves safe/missing/symlink/directory/special; redirected ancestor | Complete preflight before first read; safe malformed lines still skip |
| Output preflight | each output parent/leaf class; one invalid late leaf | Deny before first stage or final mutation |
| Staging | exclusive-name collision, stage write failure, injected deterministic pre-commit failure | All run-owned stages removed; previous final set unchanged |
| Hard links | final JSONL, TSV, and manifest hard-linked to sibling canary | Rename installs a new inode; sibling inode/content unchanged |
| Commit | deterministic failure before first rename and after a committed prefix | No pre-commit mutation; commit residual recorded; remaining stages removed |
| Manifest | successful run and failure before manifest commit | Manifest last; no normal completion on failure |
| Dashboard | every manifest/relation leaf and each ancestor/npm-cache unsafe; safe missing optionals | All-before-any denial; fake read/npm counters stay zero; safe fallback preserved |
| Compatibility | full/changed, sequential/parallel, worker failures, 17 traces, dashboard overlap/rendering | Exact accepted bytes/counts/order/labels |

Use deterministic injectable writer/committer dependencies only in narrowly
scoped unit tests; do not add production environment hooks that widen
authority. Skip only genuinely unavailable platform node types and record the
skip.

## Known Failure Modes Checklist

- A cache file is checked only after `readJsonlSafe()` already opened it.
- Output directory creation still uses recursive mkdir through a symlinked
  existing prefix.
- The first output is staged before the last output leaf is preflighted.
- A direct writer still opens a final path with `"w"` and truncates a hard
  link.
- Only `documents.jsonl` and `entities.file.jsonl` use staging while the other
  46 leaves remain direct.
- Temporary names are predictable or opened without exclusivity.
- A failure leaks stages or overwrites a subset before staging completed.
- `manifest.json` is staged or committed early enough to advertise a partial
  set.
- Commit diagnostics claim cross-file atomicity.
- Root dashboard preflights all data but packaged dashboard does not, or the
  reverse.
- A dashboard manifest/relation is read, or npm is invoked, before the last
  data-layout item is checked.
- A safe missing optional dashboard file becomes fatal or gets created.
- WO-034 accidentally changes WO-033 source grammar, worker fatal handling,
  output IDs, hashes, traces, version metadata, or package surface.

## Validation

- `node --check` for both ingest wrappers, both dashboards, worker, and every
  changed canonical module
- Focused cache/output/dashboard-data negative tests
- `node --test tests/ingest-filesystem-boundary.test.mjs`
- `node --test tests/ingest-characterization.test.mjs`
- `node --test tests/ingest-parallel.test.mjs`
- `node --test tests/ingest-worker-crash.test.mjs`
- `node --test tests/ingest-memory-trace.test.mjs`
- `node --test tests/dashboard.test.mjs`
- Exact four normalized hashes, 26/21 counts, sequential/parallel and worker
  failure byte identity, and all 17 trace labels
- `node tests/context-regressions.test.mjs`
- Full root `npm test` and full `npm --prefix scaffold/mcp test` once at
  work-order acceptance
- Real `npm pack --dry-run --json` inventory and a packed-install output smoke
  if canonical package files change
- `git diff --check`
- Cortex search/rules/impact before design, pattern evidence for every changed
  indexed file, `cortex update`, `cortex doctor`, and watcher status
- Independent Code Quality, Contract, Security and Privacy, Integration, and
  Validation review closure

## Acceptance

- No prior cache opens before the complete prior-cache layout is authorized.
- No output directory, stage, or final leaf is mutated before complete output
  preflight.
- All 48 leaves use exclusive sibling stages; all stages complete before
  commit; manifest commits last; failures clean every uncommitted stage.
- Hard-linked final destinations are replaced without changing sibling links.
- Dashboard source scan remains first, followed by one all-before-any data
  preflight before any manifest/relation read or npm invocation.
- Safe missing dashboard data and all frozen ingest/dashboard behaviors remain
  unchanged.
- Diagnostics remain closed, bounded, and non-disclosing.
- R16 remains open for WO-035 packed-artifact acceptance; no version/release,
  publish, tag, merge, or deploy work occurs.
- The WO-034 baseline and packet 025 let a fresh WO-035 session continue with
  zero chat history.

## Fresh-Session Start

Start WO-034 in a new session with no chat history and this prompt only after
WO-033 review acceptance:

> Implement WO-034 from
> `docs/agent-control/context-packets/024-output-cache-dashboard-data-containment.md`.
> Read that packet completely, then only its direct references. Use Cortex
> search/rules/impact before code decisions. Extend the accepted canonical
> real-project boundary to all prior-cache files, output-directory creation,
> all 48 staged/committed output leaves, cleanup, and the complete dashboard
> data/npm preflight. Use only benign temporary-root fixtures, preserve every
> frozen WO-033 contract, obtain the required independent reviews, and stop
> after the WO-034 baseline and focused WO-035 packet. Do not change version,
> publish, tag, merge, or deploy.
