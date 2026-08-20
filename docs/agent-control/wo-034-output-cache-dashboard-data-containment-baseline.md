# WO-034 Output, Cache, and Dashboard-Data Containment Baseline

## Accepted State

WO-034 started from a clean `release/2.5.0` worktree at accepted WO-033 commit
`9f40376`; the current dirty state is the scoped WO-034 implementation and
review-fix diff listed in the handoff ledger. Independent Code
Quality/Integration, Contract/Security and Privacy, and Validation/Ops/Release
re-reviews all returned GO with no remaining blocker, major, or minor finding.
The manager accepts WO-034 locally and advances WO-035.

- Released compatibility baseline: `v2.4.2`, tag commit `736becf`.
- Package and release metadata remain `2.4.2`.
- Canonical ingest implementation remains under
  `scaffold/scripts/lib/ingest/`.
- R16 remains open through packed-artifact acceptance in WO-035.
- WO-036 through WO-046 code is absent from this implementation. In
  particular, no manifest generation ID/schema change, retrieval experiment,
  progressive indexing, version bump, GitHub action, commit, or release action
  is part of WO-034.

## Review Finding Triage

The first independent review returned five fix-now implementation/validation
findings and one dependency finding. This iteration:

- adds a separate whole-set precommit pass after the test hook and before the
  first rename, covering both parents, all 48 final snapshots, and all 48
  staged inodes while retaining immediate per-rename checks;
- preserves cleanup of owned staged inodes after a contained parent rename
  and proves late data, manifest, parent, and stage replacement cannot cause a
  first final rename;
- rethrows `npmCachePath()` filesystem-policy errors from both dashboards
  before the ordinary version-unavailable fallback;
- completes the factorized leaf/ancestor negative matrix, including guarded
  FIFO/socket cases, read/stage/npm counters, and both dashboard entrypoints;
- removes the unused predictable, non-exclusive `stageJsonl()` export; and
- executes the real package/install output smoke and target Cortex gates.

The dependency audit is not waived and is not changed in this WO-034 codefix.
Its 1 moderate and 4 high findings are an explicit hard release blocker for
WO-035 and require a separate dependency/release iteration before readiness.

## Implemented Boundary

The accepted real-project boundary now owns closed identity inventories for
the seven prior-cache JSONL files, 26 JSONL outputs, 21 TSV outputs,
`manifest.json`, and the complete 12-item dashboard data/npm layout. Callers
provide only known project-relative identities; the boundary reconstructs
paths from the immutable WO-033 anchor and uses the already accepted
`CORTEX_FS_CACHE`, `CORTEX_FS_OUTPUT`, and `CORTEX_FS_DASHBOARD` diagnostics.

Existing path components are inspected with non-following metadata. Missing
output directories are created one segment at a time only after every output
leaf has passed the static preflight. Every created or existing directory is
revalidated before use. Dashboard data remains input-only: safe missing cache,
embedding, manifest, and relation paths are not created. `npm-cache` remains
npm-managed after the complete dashboard layout passes.

Changed-mode prior-cache hydration begins with one complete preflight of all
seven leaves and `.context/cache`. Each access revalidates that complete
snapshot before reading a known regular file. Safe absence yields an empty
cache; blank and malformed lines retain the accepted skip behavior. Existing
repository-identity and accepted-membership filtering is unchanged.

## Whole-Set Output Publication

The pipeline preflights all 48 final leaves before any directory creation or
stage creation. Every existing final leaf must be a non-symlink regular file;
multiply linked regular files remain valid replacement targets.

All 48 outputs are written to unpredictable same-directory names opened with
exclusive `wx` creation and mode `0600`. The pipeline closes the whole staged
set before commit. After the precommit hook it first revalidates both parents,
all 48 original final-leaf snapshots, and all 48 staged inodes as one complete
pass. It then repeats parent/final/stage checks immediately before every
rename. Commit order is the frozen 26-JSONL inventory followed by the frozen
21-TSV inventory, with `manifest.json` last. Normal completion output follows
the manifest rename.

Staging, pre-commit, and commit failures remove every still-uncommitted stage.
A pre-commit failure preserves the previous complete final set. A commit-phase
failure may honestly leave an already replaced prefix; the implementation
does not claim a portable 48-file transaction. Atomic rename installs a new
inode, so replacing hard-linked JSONL, TSV, or manifest destinations leaves
their sibling inode and content unchanged.

## Dashboard Data Ordering

Both dashboard entrypoints preserve the WO-033 config/source scan as their
first operation. Each non-TTY render and each live frame then obtains one
all-before-any data handle by preflighting:

- `.context/cache`, `.context/embeddings`, and `.context/cache/npm-cache`;
- ingest, graph, and embedding manifests; and
- constrains, implements, supersedes, defines, calls, and imports relations.

No manifest or relation read and no `npm view` cache lookup is reachable until
all existing items pass. Every data read and npm-cache path request
revalidates the complete snapshot. Safe missing and malformed optional data
retains null/empty rendering. Policy failures, including failures returned by
`npmCachePath()`, are rethrown through the shared WO-033 terminal lifecycle
handler rather than converted into ordinary version fallback. Startup,
reload, timer, and resize retain that same terminal path.

## Focused Negative and Compatibility Evidence

`tests/ingest-filesystem-boundary.test.mjs` now has 41 cases, including 16
WO-034-focused cases. They use only test-owned temporary parents and cover:

- exact 7/26/21/48/12 inventories and manifest-last order;
- every prior-cache leaf as regular, missing, symlink, directory, and guarded
  special input, malformed-line skipping, complete-snapshot replacement
  denial, and zero reads before a failed preflight;
- a late invalid output leaf before missing DB creation or prior-file
  mutation;
- every output leaf as regular, missing, symlink, directory, and guarded
  special output before the first stage; exclusive-name collision, write
  failure, target replacement between stages, deterministic precommit failure,
  and failure after a committed prefix;
- late data-final, manifest, output-parent, and staged-inode replacement after
  full staging, with zero commit mutation and owned-stage cleanup;
- complete stage cleanup and previous-set preservation where portable rename
  permits it;
- hard-linked JSONL, TSV, and manifest replacement without sibling mutation;
- every dashboard manifest/relation/ancestor/npm-cache identity as regular,
  missing, symlink, wrong type, and guarded special input; factorized cache,
  DB/import, and embeddings ancestor cases; and complete-snapshot replacement
  denial with zero reads; and
- fake npm executables proving every data-identity denial and npm-cache policy
  failure in both dashboards occurs before npm invocation, with non-TTY/live
  fatal lifecycle, one bounded diagnostic, and no normal output/frame.

Frozen valid evidence remains unchanged:

| Contract | Result |
|---|---|
| Full JSONL | 26 files; `937102d472623c4d852762ab700ae510bdc30927ee8aec9aa890976e3b4d44fe` |
| Full TSV | 21 files; `253278db329ecd74ebce9379a2e406e71841388f37ae2ee4ebf166459df7dd43` |
| Changed JSONL | 26 files; `4fe3cf7e15908215863476a53c785c045ea71af75fb3db76ee88b41020276f3f` |
| Changed TSV | 21 files; `7e70109126569d4534c340ce6791bb4dc8c295c7db70eb9faf14196beda6c2f4` |
| Parallelism | Sequential/four-worker byte identity passed |
| Worker failure | Skip/crash/partial/all-death fallback identity passed |
| Trace | All 17 labels and zero retained/pending completion passed |
| Dashboard | Overlap de-duplication and rendering passed |

## Validation Evidence

- Syntax passed for both ingest wrappers, both dashboards, the worker, every
  changed canonical module, and the changed boundary test.
- WO-034-focused boundary cases: 16/16 within the complete suite.
- Complete filesystem-boundary suite: 41/41.
- Frozen ingest/parallel/worker/trace/dashboard group: 19/19.
- Context regressions: 81/81.
- Full root suite after the required clean-worktree MCP build: 364/364. The
  first attempt had one setup-only failure because package-owned MCP `dist`
  was absent; `npm ci && npm run build` under `scaffold/mcp` restored the
  established release-workflow prerequisite, and the complete rerun passed.
- Full package-owned MCP suite: 413/413.
- The initial pre-build inventory contained 416 entries. After the required
  package-owned MCP build/prepack step, the authoritative dry-run and real
  tarball each contain 417 entries at version `2.4.2`, matching the accepted
  post-build package inventory. Both dashboards and every changed canonical
  ingest module are present; ownership already inventories those runtime paths.
- A real tarball was installed into a clean temporary prefix. Its packaged
  ingest produced 26 JSONL and 21 TSV outputs with the frozen full hashes,
  emitted all 17 trace labels from `scan:start` through
  `writes:manifest_complete`, published the manifest, and printed normal
  completion only afterward.
- `git diff --check`: passed after durable-state finalization.
- The review authorized a target-local ignored `.context` runtime migration.
  `cortex init --force --bootstrap` completed with 805/805 initial embeddings
  and zero failures, but its legacy scaffold cleanup also attempted tracked
  `.gitignore`, root `scripts/`, and `docs/cortex-architecture.md` mutations.
  Those out-of-scope effects were isolated and patch-restored exactly; status
  after restoration matched the saved pre-init 15-file WO-034 scope. No second
  forced init is permitted in this worktree.
- A review-fix target `cortex update` completed with 48 embedded, 792 reused, and zero
  failed entities; indexed target pattern evidence passed 8/8, doctor passed
  8/8, and watcher status is stopped. The seven changed scaffold/test files are
  outside configured `bin, scripts, docs, README.md` source scope and are
  covered directly by syntax and focused/full tests.

## Residual Risks and Acceptance Boundary

- Portable Node still has the accepted narrow same-user
  validation-to-path-syscall interval; the implementation revalidates
  immediately but does not claim `openat`-style race elimination.
- A commit-phase failure may leave an already replaced deterministic prefix;
  uncommitted stages are removed and the manifest remains last.
- `npm audit --package-lock-only --audit-level=low --prefix scaffold/mcp`
  fails with 1 moderate and 4 high vulnerable packages: `hono`,
  `brace-expansion`, `fast-uri`, `ip-address`, and `js-yaml`. This is an
  explicit WO-035 hard release blocker. It must be updated, fully retested,
  and rerun at zero in a separate dependency/release iteration; WO-034 does
  not mutate the lockfile or dependency policy.
- WO-034 is accepted locally with no waived review finding. R16 remains open
  until WO-035 accepts the actual packed artifact. The dependency blocker also
  includes frontend `nanoid` at high severity in addition to the MCP findings;
  both audit trees must reach zero before release readiness.
