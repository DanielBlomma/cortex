# Source and Control-File Containment

## Objective

Implement WO-033 by establishing one canonical real-project filesystem
boundary and applying it to control files, configured/discovered sources,
changed mode, incremental source hydration, direct and worker reads, secondary
README reads, and both dashboard baseline scanners. Preserve every accepted
`v2.4.2` output, worker, trace, and dashboard contract for safe projects.

Do not begin until the manager records independent Contract and Security and
Privacy approval of
`docs/agent-control/wo-032-ingest-filesystem-containment-baseline.md`.

## Durable Starting State

- Branch: continue from `plan/r16-ingest-filesystem-containment` only after
  WO-032 review acceptance, using the manager-selected implementation branch.
- Released runtime baseline: `v2.4.2`, tag commit `736becf`.
- Planning base: `main` at
  `6052686f6019ff67d4d3946c047bd886feb511a5`.
- R16 remains open; WO-033 contains reads but does not close the output risk.
- The packaged scaffold under `scaffold/scripts/lib/ingest/` remains the only
  canonical ingest implementation.
- WO-032 changed no runtime, test, version, or package behavior. Its baseline
  inventories every filesystem operation and owns the approved contract.

## Work Profile

New contract/design — project trust, portable source syntax, symlink denial,
reopen validation, worker fatal errors, and migration diagnostics become
enforced runtime behavior for the first time.

## Required Contract Anchors

- `docs/agent-control/wo-032-ingest-filesystem-containment-baseline.md`
  - authoritative project/source/error/migration contract, operation inventory,
    released characterization, and frozen valid behavior
- `docs/agent-control/wo-029-ingest-orchestration-baseline.md`
  - canonical architecture, four hashes, worker fallback/order, trace, and
    retention contracts
- `docs/agent-control/wo-030-managed-scaffold-baseline.md`
  - reviewed real-root/symlink-denial pattern and honest portable-Node
    concurrent-mutator residual
- `scaffold/scripts/lib/ingest/runtime-paths.mjs`
  - current lexical project and output roots
- `scaffold/scripts/lib/ingest/config.mjs`
  - current source parser and compatibility spellings
- `scaffold/scripts/lib/ingest/files.mjs`
  - full/changed discovery, line-oriented Git parsing, walking, and prefix
    policy
- `scaffold/scripts/lib/ingest/pipeline-stages.mjs`
  - validation order, controls, hydrated paths, candidate stat/read, and
    output-directory timing
- `scaffold/scripts/lib/ingest/parser-composition.mjs`,
  `scaffold/scripts/lib/ingest/workers.mjs`, and
  `scaffold/scripts/ingest-worker.mjs`
  - absolute worker payload, reopen behavior, fallback, and fatal-error routing
- `scaffold/scripts/lib/ingest/chunks.mjs`
  - independently reconstructed module-summary README read
- `scripts/dashboard.mjs` and `scaffold/scripts/dashboard.mjs`
  - duplicate baseline scanners and their distinct project-root/extension
    defaults
- `tests/ingest-characterization.test.mjs`,
  `tests/ingest-parallel.test.mjs`,
  `tests/ingest-worker-crash.test.mjs`,
  `tests/ingest-memory-trace.test.mjs`, and `tests/dashboard.test.mjs`
  - frozen hashes, equivalence, worker, trace, root-scope, and dashboard
    compatibility evidence

## Owned Scope

- One new canonical filesystem-boundary module under
  `scaffold/scripts/lib/ingest/`
- `scaffold/scripts/lib/ingest/runtime-paths.mjs`
- `scaffold/scripts/lib/ingest/config.mjs`
- `scaffold/scripts/lib/ingest/files.mjs`
- `scaffold/scripts/lib/ingest/chunks.mjs`
- Source/control ordering and source-record handling in
  `scaffold/scripts/lib/ingest/pipeline-stages.mjs`
- Worker task/message/fatal-error handling in
  `scaffold/scripts/lib/ingest/parser-composition.mjs`,
  `scaffold/scripts/lib/ingest/workers.mjs`, and
  `scaffold/scripts/ingest-worker.mjs`
- Minimal composition changes in `scaffold/scripts/lib/ingest/main.mjs`
- Root and packaged dashboard baseline scanners
- Focused boundary/source/worker/dashboard tests and benign fixtures created
  exclusively in test-owned temporary directories
- Package inventory if a new canonical runtime module must be explicitly
  included
- WO-033 baseline, review evidence, and focused WO-034 packet

## Out Of Scope

- Replacing JSONL/TSV/manifest writers or staging behavior
- Output-leaf, output-directory, prior-cache-file, hard-link, and failure-cleanup
  implementation owned by WO-034
- External-source allowlists or authorization outside the selected project
- Parser semantics, chunk IDs, graph schema, ranking, embeddings, or memory
  redesign
- Dashboard display-only cache/status/version behavior except minimal imports
  needed for the validated baseline scan
- MCP compatibility removal or `.context/mcp` renaming
- Version changes, release notes, publish, tag, merge, or deploy
- Claims that portable Node path APIs eliminate the final same-user
  ancestor-swap interval

## Required Design

### Canonical boundary object

Create one canonical module instead of reproducing checks at each call site.
It must:

- resolve the selected project once, require an existing directory, obtain its
  real path, and carry that real path as the sole containment anchor;
- expose control/source validation and safe candidate reconstruction without
  treating caller-provided absolute paths as authority;
- use component-aware relative checks and non-following metadata inspection;
- distinguish a filesystem-policy error from ordinary missing/read/parser
  outcomes so callers cannot accidentally downgrade it;
- render only stable reason categories and approved project-relative/config
  values, never external content or symlink targets; and
- remain importable by the packaged worker and both dashboards, and remain
  present in the real npm artifact.

Do not use a lexical prefix such as `candidate.startsWith(root)`. Preserve the
reviewed WO-030 approach where applicable, but do not copy its scaffold-specific
ownership or mutation policy into ingest.

### Project and controls

1. `CORTEX_PROJECT_ROOT` chooses a project only. Resolve it to one existing
   real directory before parser initialization or filesystem mutation.
2. Reject a symlinked/non-directory `.context` component.
3. Require `.context/config.yaml` and `.context/rules.yaml` to be non-symlink
   regular files with non-symlink ancestors before reading either.
4. Preserve current missing-control diagnostics where safe, but use a bounded
   policy diagnostic for a symlink/type violation.
5. Do not call recursive output-directory creation until control, source
   syntax, explicit source roots, and the initial candidate set are valid.

### Portable source values

- Accept `.` as whole-project scope.
- Retain safe presentation aliases already accepted by current configs:
  leading `./`, redundant `.` segments, repeated POSIX separators, and a
  trailing `/`. Normalize only the internal authorization form; retain the
  original values in the manifest.
- Reject empty/whitespace, NUL, POSIX absolute, Windows drive-qualified or
  drive-relative, rooted-backslash/device/UNC, any backslash separator, and
  any `..` segment on every platform.
- Preserve a syntactically valid missing contained source as a non-fatal skip.
- Require an existing explicit source to be a non-symlink regular file or
  directory below the real project with non-symlink ancestors.
- Reject an explicit symlink even when it targets an in-project path. Continue
  not following symlink entries encountered during an otherwise valid walk.
- Preserve `.context` exclusion, root `bin` inclusion, other skipped directory
  semantics, repository-relative POSIX IDs, de-duplication, and sort order.

### Full, changed, and hydrated discovery

- Replace line-oriented Git status parsing with NUL-delimited porcelain.
  Parse every changed, renamed, and deleted pathname unambiguously before
  validation or source-prefix filtering.
- Cover quoted-looking names, embedded newlines, literal ` -> ` content,
  renames, deletions, and Git failure/empty-diff fallback.
- Validate every Git path against portable syntax and the real project before
  `exists`, `stat`, walking, or adding a deletion prefix.
- Validate every file/ADR path recovered from incremental JSONL before its
  existence check or reuse. Validate chunk/relation hydration through the
  already accepted file-ID set. WO-034 later validates the cache file itself.
- Revalidate every candidate immediately before stat and read. A symlink,
  outside path, replacement, or non-regular type is fatal.

### Worker and inline fallback

- Build worker authority from the real project anchor plus the validated
  repository-relative candidate identity. Do not grant authority because a
  parent supplied an absolute path.
- The worker independently reconstructs and revalidates the path immediately
  before read.
- Preserve inline fallback for parser unavailable/skip, worker crash, missing
  ordinary result, partial death, all death, disabled workers, and invalid
  worker counts.
- A filesystem-policy rejection is fatal. Preserve it across the worker
  message protocol, stop the ingest, and never parse retained content inline
  for that task.
- Keep sorted streaming consumption and completion retention counters exactly
  as frozen.

### Secondary README

Route `generateModuleSummary()` through the same boundary. Preserve automatic
summary fallback for a missing safe README or ordinary read failure after
regular-file validation. Do not catch and downgrade a symlink, escape, type,
or replacement denial.

### Dashboard baseline scans

Use the same canonical source syntax and source-resolution policy in
`scripts/dashboard.mjs` and `scaffold/scripts/dashboard.mjs`.

- Preserve root-script project selection and packaged
  `CORTEX_PROJECT_ROOT`/packaged-default selection.
- Preserve the packaged extension set, baseline counts, de-duplication, and
  normal non-TTY rendering.
- Unsafe control/source layouts exit non-zero with the same bounded policy
  categories; they must not become zero-count or unreadable-file skips.
- Do not broaden this work into display-only manifest/cache authorization.

## Error and Migration Contract

- Ingest and dashboard main entrypoints own final CLI rendering: exit non-zero,
  use stderr, omit stack traces and source content, and do not print normal
  completion for a denial.
- Diagnostics identify the rejected config value or repository-relative path
  and one stable reason category. Do not reveal an external real path or
  symlink target.
- Existing users with invalid source syntax must replace it with a portable
  project-relative forward-slash value. External source roots are unsupported.
- Existing explicit source symlinks must be replaced with the real in-project
  path or materialized regular project content.
- Existing symlinked control trees/files must be repaired deliberately. The
  runtime must not auto-follow, copy, or bless external content.
- Valid safe projects require no configuration migration.

## Implementation Sequence

1. Add focused unit tests for project anchoring, component containment,
   portable syntax, symlink/type denial, and sanitized error projection.
2. Implement the canonical boundary without changing current callers.
3. Integrate project/control validation and move source validation ahead of
   output-directory creation and parser work.
4. Integrate full discovery and candidate revalidation.
5. Implement NUL-delimited Git parsing and changed/deleted validation.
6. Validate hydrated source paths and the secondary README read.
7. Integrate independent worker revalidation plus fatal policy propagation;
   prove ordinary fallback remains unchanged.
8. Route both dashboard baseline scanners through the canonical policy.
9. Rerun the frozen full/changed hashes, sequential/parallel equivalence,
   worker-failure identity, trace labels, root scope, and dashboard contracts.
10. Verify the new runtime module ships in a real package inventory, resolve
    required reviews, write the WO-033 baseline, and create packet 024 for
    WO-034.

## Benign Negative Test Matrix

All cases create the project, sibling canaries, and links under one test-owned
temporary parent and remove that parent afterward. Tests never read real
external content.

| Area | Required cases | Required result |
|---|---|---|
| Project/control | nonexistent project, symlinked `.context`, config/rules symlink, directory/non-regular control | Non-zero before parse or output mutation; bounded diagnostic |
| Syntax | absolute POSIX, drive absolute/relative, UNC/device/rooted backslash, backslash separator, empty/quoted empty, NUL, any parent segment | Denied identically on POSIX; platform-specific cases guarded where necessary |
| Safe aliases | `.`, `./src`, redundant safe `.`/separator/trailing-slash forms | Same candidates, record IDs, ordering, and original manifest values |
| Source resolution | missing contained source, safe file/dir, explicit in-root symlink, explicit escaping symlink, nested walked symlink | Missing skips; safe indexes; explicit links deny; walked link is never read |
| Direct read | candidate replaced by symlink/directory before stat/read | Fatal denial; synthetic sibling canary unread |
| Changed mode | spaces, quotes, newline, literal ` -> `, rename, deletion, invalid candidate | Unambiguous contained IDs; invalid path denied before read |
| Hydration | safe cached file/ADR, parent/absolute/symlinked record path | Safe changed output frozen; invalid record cannot trigger external existence/read |
| Worker | safe worker, swap before worker read, ordinary skip/crash/all-death | Swap is fatal with no inline bypass; ordinary fallback remains byte-identical |
| README | safe, missing, ordinary unreadable, symlink/replacement | Safe summary/fallback preserved; policy violation fatal |
| Dashboard | normal overlap, invalid syntax, explicit symlink source, symlinked config | Counts unchanged for safe config; unsafe scan exits non-zero without external read |

Do not add timing-dependent race tests or hooks that widen production
authority. Prefer deterministic pre-dispatch replacement and direct boundary
unit tests. Skip only platform capabilities that are genuinely unavailable and
record each skip.

## Known Failure Modes Checklist

- The project spelling is real-pathed but later code continues using the old
  lexical `REPO_ROOT` for authorization.
- POSIX tests pass while drive-relative, device, rooted-backslash, or UNC
  spellings remain accepted on a POSIX runner.
- A safe alias is normalized into a different manifest value or record ID.
- Full discovery is contained but changed, deleted, hydrated, or README paths
  bypass the boundary.
- NUL-delimited rename parsing reverses old/new path ownership or drops one
  path from validation.
- Candidate validation occurs only at discovery, then stat/read reopens a
  replacement without checking.
- Worker rejection is represented as an ordinary miss and inline fallback
  parses retained content.
- `generateModuleSummary()` catches a boundary error and silently falls back.
- The root dashboard is fixed while the packaged scanner retains duplicate
  unsafe logic, or vice versa.
- Existing `ensureDirectory()` mutates a redirected cache/DB ancestor before
  invalid source input fails.
- A new boundary module works in the repository but is omitted from `npm pack`.
- Diagnostics disclose resolved external targets, source content, or stacks.
- Tests create or inspect anything outside their own temporary parent.

## Constraints

- Preserve the four normalized hashes, 26/21 file counts, sequential/parallel
  equivalence, worker fallback, sorted merge, 17 trace labels, and bounded
  retention for accepted projects.
- Preserve no-source-upload, no-telemetry, and no-new-service behavior.
- Keep packaged scaffold code canonical; root wrappers/scanners must not become
  a second ingest implementation.
- Do not weaken current tests or hash normalization.
- Do not implement WO-034 output staging early. It is acceptable and required
  to leave R16 open after WO-033 while recording the remaining output risk.
- Use portable Node APIs and explicit platform guards in tests.
- Do not bump version or perform release, tag, merge, publish, or deploy work.

## Required Reviewers

- Code Quality Reviewer
- Contract Reviewer
- Security and Privacy Reviewer
- Integration Reviewer
- Validation Reviewer

Reviewers cannot be the implementer. Resolve every blocker/major finding or
record an explicit manager deferral in the risk register before acceptance.

## Validation

- `node --check` for both ingest wrappers, both dashboards, the worker, and
  every changed canonical module
- Focused boundary/source/control/worker/dashboard negative tests
- `node --test tests/ingest-characterization.test.mjs`
- `node --test tests/ingest-parallel.test.mjs`
- `node --test tests/ingest-worker-crash.test.mjs`
- `node --test tests/ingest-memory-trace.test.mjs`
- `node --test tests/dashboard.test.mjs`
- Exact four normalized hashes, 26/21 counts, sequential/parallel and
  worker-failure byte identity, and 17 trace labels
- `node tests/context-regressions.test.mjs`
- Full root `npm test` and full `npm --prefix scaffold/mcp test` once at
  work-order acceptance
- Real `npm pack --dry-run --json` inventory proving the new canonical module
  is present
- `git diff --check`
- Cortex search/rules/impact before design, pattern evidence for every changed
  indexed file, `cortex update`, `cortex doctor`, and watcher status
- Independent five-role review closure

## Acceptance

- Invalid control/source syntax and static hostile source layouts fail before
  parser work, source read, output-directory creation, or output mutation.
- Full, changed, renamed, deleted, hydrated, secondary README, worker, and both
  dashboard scans enforce one real-project boundary.
- Worker-side denial cannot enter inline fallback.
- Diagnostics are bounded and disclose only approved config/repository-relative
  identity plus reason.
- Safe projects preserve every frozen digest/equivalence/trace/dashboard
  contract.
- The package contains the boundary module and both packaged consumers use it.
- R16 remains open with output containment explicitly handed to WO-034.
- Control documents let a fresh WO-034 session continue with zero chat history.

## Fresh-Session Start

Start WO-033 in a new session with no chat history and this prompt only after
WO-032 review acceptance:

> Implement WO-033 from
> `docs/agent-control/context-packets/023-source-control-file-containment.md`.
> Read that packet completely, then read only its direct references. Use Cortex
> search/rules/impact before code decisions. Enforce one canonical real-project
> boundary across controls, all source discovery/reopen paths, workers,
> secondary README reads, and both dashboard baseline scans. Use only benign
> temporary-directory fixtures. Preserve every frozen valid contract, obtain
> the required independent reviews, and stop after the WO-033 baseline and a
> focused WO-034 packet. Do not implement output staging, change version, or
> publish, tag, merge, or deploy.
