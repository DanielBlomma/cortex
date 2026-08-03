# WO-033 Source and Control-File Containment Baseline

## Implementation State

WO-033 implementation is complete on `plan/r16-ingest-filesystem-containment`
from accepted WO-032 commit `6be1fdbdd56cb9baf534725df8fec7e345f21455`.
Independent Code Quality, Contract, Security and Privacy, Integration, and
Validation review remains pending; this document records implementation
evidence, not manager acceptance.

- Released compatibility baseline: `v2.4.2`, tag commit `736becf`.
- Package and release metadata remain `2.4.2`.
- Canonical implementation remains under `scaffold/scripts/lib/ingest/`.
- New canonical policy module:
  `scaffold/scripts/lib/ingest/filesystem-boundary.mjs`.
- Implementation packet:
  `docs/agent-control/context-packets/023-source-control-file-containment.md`.
- Focused next packet:
  `docs/agent-control/context-packets/024-output-cache-dashboard-data-containment.md`.
- R16 remains open. WO-034 still owns prior-cache-file, output, cleanup, and
  dashboard-data containment.

## Implemented Boundary

`createFilesystemBoundary()` resolves the selected project once, requires an
existing directory, retains its real path as the sole anchor, and reconstructs
all later source paths from repository-relative identities. Component-aware
`path.relative()` checks, `lstatSync()` inspection, and immediate reopen
validation replace lexical-prefix authority. A project-root symlink spelling
may select a project, but no symlink below the resulting real anchor grants
authority.

The canonical module owns the closed `CortexFilesystemPolicyError` schema,
bounded subject projection, single-line CLI rendering, worker wire projection,
and worker-envelope validation. Project, control, configured-source, and
repository-path errors expose only contract-approved values or the stable
`<repository-path>` placeholder when an invalid host identity has no safe
project-relative representation. They never expose a symlink target or an
external resolved path.

The final same-user ancestor-exchange interval remains: portable Node APIs do
not expose directory-descriptor-relative `openat` operations. Every sensitive
source operation revalidates immediately before its path-based syscall, but
the implementation does not claim complete concurrent-mutator elimination.

## Project and Control Ordering

Ingest now performs this static sequence before parser initialization or any
output-directory creation:

1. Resolve and real-path the selected project.
2. Validate `.context`, `.context/config.yaml`, and
   `.context/rules.yaml` without following symlinks.
3. Read the validated config, validate all configured-source syntax, validate
   every existing explicit source, then read the already validated rules.
4. Collect the initial candidate set, initialize parsers, hydrate and directly
   revalidate candidates, parse, and materialize secondary README summaries.
5. Only after all source/worker/README policy phases succeed, create the
   current output directories and enter the unchanged write stages.

Both controls are regular non-symlink files for ingest. Each dashboard
validates only `.context/config.yaml`, because that is the only control input
the dashboard consumes; an unused `rules.yaml` does not become dashboard
authorization. This distinction is explicitly covered by a regression. Both
dashboards still deny a symlinked or invalid config before `gatherData()` can
read manifests/relations or reach the npm version lookup.

## Separate Identity Grammars

Configured `source_paths` accept `.`, leading `./`, trailing `/`, repeated
POSIX separators, and redundant interior `.` segments. They reject empty or
whitespace-only values, NUL, POSIX absolute paths, Windows drive-qualified or
drive-relative paths, rooted backslash/device/UNC forms, every backslash
separator, and every `..` segment on every host. Missing safe contained
sources remain non-fatal. Existing explicit sources must be regular files or
directories with non-symlink ancestors; an explicit symlink is denied even
when its target is inside the project.

Git, walk, and hydrated-cache identities use a separate host-repository
grammar. On POSIX, literal `C:foo.js` and `a\\b.js` names remain valid and keep
their exact repository-relative IDs through full discovery, walking, changed
mode, and incremental hydration. Walked symlink entries remain skipped rather
than followed. Hydrated file and ADR paths are validated before existence or
reuse, file IDs are canonicalized to the accepted repository path, and cached
chunks/relations continue to hydrate only through the accepted file-ID set.

The accepted alias correctness exception is implemented: full output for
`src//nested` and `src/./nested` stays equal to `src/nested`, and changed output
now also equals the canonical spelling. Manifests retain the original source
value and file IDs remain canonical. WO-035 must classify this observable
changed-mode correctness fix; it requires no configuration migration.

## Discovery, Reopen, Worker, and README Policy

Git status now uses `--porcelain=v1 -z --untracked-files=all`. The parser
validates every changed, renamed, copied, and deleted identity before source
filtering, handles the NUL-mode destination/source ordering for renames, and
preserves spaces, quote-looking names, embedded newlines, and literal ` -> `
content. Git failure or an empty diff retains the full-source fallback.

Candidate sets carry repository identities rather than caller-authoritative
absolute paths. Direct scan revalidates before metadata inspection and again
before read. Symlink, escape, directory replacement, and special-file
replacements are fatal filesystem-policy errors.

Worker tasks carry only the real project anchor plus the accepted repository
identity. The worker reconstructs and revalidates the path before reading. A
policy failure is sent only in the closed `policy_error` envelope, is checked
against the in-flight task in the parent, terminates the stream, and cannot
enter retained-content inline fallback. Malformed policy envelopes become
fatal `CORTEX_FS_SOURCE` / `worker_read` / `worker_protocol`. Ordinary parser
skip, crash, missing result, partial/all worker death, disabled workers, and
invalid worker-count fallback remain unchanged.

`generateModuleSummary()` now performs its independent README lookup through
the same boundary. A missing safe README or ordinary read failure after
regular-file validation preserves automatic fallback. Symlink, escape, type,
or replacement errors propagate fatally.

## Dashboard Source Scan

The repository and packaged dashboards import the same canonical boundary.
Their project-root defaults, extension sets, skip rules, overlapping-source
de-duplication, baseline counts, and non-TTY rendering remain distinct where
previously specified and otherwise unchanged. Source/config policy failure is
rendered as one bounded stderr line and exits non-zero before `gatherData()`;
a fake-npm marker regression proves the version lookup is not invoked.

WO-033 does not authorize dashboard data. WO-034 must preflight
`.context/cache`, `.context/embeddings`, all three manifests, all six relation
leaves, and `npm-cache` before the first dashboard data access or npm
invocation.

## Compatibility and Negative Evidence

The focused compatibility and policy matrix passed 61/61. It includes the 17
new temporary-root cases in
`tests/ingest-filesystem-boundary.test.mjs` plus the frozen ingest, worker,
trace, dashboard, and C#/VB parser suites.

The new cases cover:

- missing/file/symlink-spelled project roots;
- symlinked or non-directory `.context` and symlinked/directory controls;
- the complete portable-source rejection families and accepted aliases;
- safe/missing/explicit-link/intermediate-link/walked-link sources;
- direct symlink/directory/FIFO replacement with a sibling canary;
- NUL Git parsing for spaces, quotes, newlines, arrows, rename, and deletion;
- full/changed alias equivalence and original manifest values;
- POSIX colon/backslash identities through full/changed/walk/hydration;
- invalid hydrated source identities before reuse;
- independent worker denial and malformed-envelope fatal handling;
- safe/missing/symlinked secondary README behavior;
- root/packaged dashboard denial before data/npm; and
- bounded JSON-escaped diagnostics without stack or target disclosure.

All fixtures create the project, links, and synthetic sibling canaries under
one test-owned temporary parent and remove that parent. The Windows-incompatible
FIFO, symlink, newline-name, and literal-backslash-name cases use explicit
platform guards.

Frozen valid evidence remains:

| Contract | Result |
|---|---|
| Full JSONL | 26 files; `937102d472623c4d852762ab700ae510bdc30927ee8aec9aa890976e3b4d44fe` |
| Full TSV | 21 files; `253278db329ecd74ebce9379a2e406e71841388f37ae2ee4ebf166459df7dd43` |
| Changed JSONL | 26 files; `4fe3cf7e15908215863476a53c785c045ea71af75fb3db76ee88b41020276f3f` |
| Changed TSV | 21 files; `7e70109126569d4534c340ce6791bb4dc8c295c7db70eb9faf14196beda6c2f4` |
| Parallelism | Sequential/four-worker byte identity passed |
| Worker failure | Skip/crash/partial/all-death fallback identity passed |
| Trace | All 17 labels and zero retained/pending completion passed |
| Root scope | `.` exclusion/root-`bin` behavior passed |
| Dashboard | Overlap de-duplication and rendering passed |

## Validation Evidence

- Syntax checks passed for both ingest wrappers, both dashboards, the worker,
  and every changed canonical module.
- Focused boundary/ingest/dashboard/C#/VB matrix: 61 passed, 0 failed.
- Context regressions: 81 passed, 0 failed.
- Full root `npm test`, after adding the new boundary suite to the
  authoritative test script: 340 passed, 0 failed, plus 81/81 context
  regressions.
- Full `npm --prefix scaffold/mcp test`: 413 passed, 0 failed.
- `npm pack --dry-run --json`: version `2.4.2`, 418 entries, including
  `scaffold/scripts/lib/ingest/filesystem-boundary.mjs` and all three packaged
  ingest/worker/dashboard consumers.
- `scaffold/ownership/v1.json` explicitly manages the new runtime module for
  initialized projects.
- Final `cortex update`: completed with 0 failed entities; graph load
  completed.
- `cortex pattern-evidence`: passed for all four changed indexed files
  (`scripts/ingest.mjs`, `scripts/dashboard.mjs`, this baseline, and packet
  024). Changed `scaffold/`, `tests/`, package, and ownership files are outside
  the configured `bin, scripts, docs, README.md` source set and are covered by
  direct tests, package inventory, and pending independent review.
- `cortex doctor`: 8/8; optional watcher: stopped.
- `git diff --check`: passed.

## Remaining Risks and Review Gate

- R16 remains open. Existing prior-cache reads and every output leaf still
  need WO-034 containment, exclusive staging, manifest-last commit, and
  cleanup.
- Dashboard manifest/relation/embedding/npm-cache reads and npm invocation
  still need the all-before-any WO-034 data preflight.
- The narrow portable-Node same-user concurrent ancestor-swap residual remains
  as documented above.
- Independent five-role review is pending. This implementation must not be
  accepted, merged, released, tagged, published, or used to close R16 until
  review findings are resolved or explicitly deferred by the manager.
