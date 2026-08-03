# WO-032 Ingest Filesystem Containment Baseline

## Handoff State

WO-032's characterization and contract first pass is complete on
`plan/r16-ingest-filesystem-containment`. Runtime code, tests, release metadata,
and package contents are unchanged.

- Released behavior characterized: npm/tag baseline `v2.4.2`, tag commit
  `736becf`.
- Planning base: `main` at
  `6052686f6019ff67d4d3946c047bd886feb511a5`.
- Program packet:
  `docs/agent-control/context-packets/022-ingest-filesystem-containment.md`.
- Next implementation packet:
  `docs/agent-control/context-packets/023-source-control-file-containment.md`.
- Acceptance gate: independent Contract and Security and Privacy review is
  still required. The implementer does not approve this first pass, and
  WO-033 remains blocked until the manager records both approvals.
- R16 remains open through packed-artifact acceptance in WO-035.

## Characterization Safety and Provenance

The released behavior was characterized only in disposable directories made
with the operating system temporary-directory API. Each sandbox contained a
synthetic project, synthetic sibling content, and any symlink or hard-link
canary used by that case. The complete sandbox was removed in `finally` after
each probe. No real external source, user file, network service, credential,
or repository-adjacent path was read or mutated. The one-off probe code was
not added to the repository.

The probes record existing unsafe behavior so later work can prove its denial;
they do not authorize or preserve that behavior.

| Controlled case | Released `v2.4.2` observation | Required disposition |
|---|---|---|
| Absolute source naming a synthetic sibling file | Ingest exited 0 and emitted a `../outside/...` file record | Reject before source read or output mutation |
| Parent-relative source naming the same sibling file | Ingest exited 0 and emitted the same parent-relative record | Reject before source read or output mutation |
| Explicit source directory symlink to the synthetic sibling | Ingest exited 0 and emitted the target file under the lexical symlink path | Reject the explicit source symlink, even when its target would remain in the project |
| Symlinked `.context/config.yaml` to a synthetic control file | Ingest exited 0 and consumed the linked configuration | Reject before parsing configuration |
| `.context/cache` symlink to a synthetic sibling directory | Ingest exited 0 and placed all 27 cache entries, including the manifest, in the sibling directory | Reject before directory creation, read, staging, or write |
| Direct JSONL destination symlink to a synthetic canary | Ingest exited 0 and truncated the canary | Reject without opening the destination |
| Direct JSONL destination hard-linked to a synthetic canary | Ingest exited 0 and truncated the shared inode | Replace through a new staged inode so the external link remains unchanged |
| Direct JSONL destination is a directory | Ingest exited 1, but the two staged file caches had already replaced prior content and no manifest was written | Reject all output leaves before any output commit |

Static inspection also establishes these released behaviors:

- a project root is only lexically resolved, not anchored by `realpath`;
- recursive discovery currently skips a symlink entry because a symlink
  `Dirent` is neither a directory nor a regular file, but an explicitly
  configured symlink is followed by `statSync`/`readdirSync`;
- control-file, candidate, prior-cache, worker, and module-summary reads use
  path-based operations that follow symlinks;
- JSONL/TSV writers open final paths with truncating `"w"`; only
  `documents.jsonl` and `entities.file.jsonl` use temporary names, and those
  names are predictable and non-exclusive;
- a failure between staging and commit has no pipeline-level cleanup, and a
  failure after either staged cache commits can leave a partially replaced
  output set;
- the manifest is written directly after the JSONL and TSV files, so current
  output publication is neither per-file safe nor cross-file atomic.

## Filesystem-Operation Inventory

### Project, controls, and directory setup

| Operation | Current owner and behavior | Contract owner |
|---|---|---|
| Select project | `runtime-paths.mjs` applies `path.resolve` to `CORTEX_PROJECT_ROOT` or the packaged default; it does not require an existing directory or retain a real-path anchor | WO-033 |
| Locate `.context` | `runtime-paths.mjs` derives context, cache, and DB-import paths lexically below that root | WO-033 establishes the trusted `.context` anchor; WO-034 validates output descendants |
| Check controls | `pipeline-stages.mjs` uses `existsSync` for `config.yaml` and `rules.yaml`; symlinks and non-regular files are not rejected | WO-033 |
| Create output directories | `ensureDirectory()` calls recursive `mkdirSync` for cache and DB import before either control file is read or source syntax is validated | WO-033 moves creation after input validation; WO-034 replaces it with contained segment-by-segment creation |
| Read controls | `pipeline-stages.mjs` reads both files directly and passes their text to the existing parsers | WO-033 |

### Source discovery and direct reads

| Operation | Current owner and behavior | Required boundary |
|---|---|---|
| Parse `source_paths` | `config.mjs` returns unquoted list text without syntax or containment validation | Validate portable syntax before resolving any source |
| Full discovery | `files.mjs` resolves each value against the lexical project root, skips missing values, follows an explicit symlink through `statSync`, and recursively walks directories | Preserve missing-contained-source skip behavior; reject invalid syntax and explicit symlinks; never follow walked symlinks |
| Changed discovery | `files.mjs` runs line-oriented `git status --porcelain`, trims and splits rename text on ` -> `, resolves every payload, then stats/walks it | Parse NUL-delimited porcelain and validate every changed, renamed, and deleted path before use |
| Candidate stat/read | `pipeline-stages.mjs` sorts absolute candidates, calls `statSync`, then `readFileSync`; it does not revalidate the path selected during discovery | Revalidate containment, non-symlink ancestry, and regular-file type immediately before both operations |
| Cached file/ADR hydration | `pipeline-stages.mjs` accepts cache record paths using lexical source-prefix checks, resolves them, and tests existence before reuse | Validate every hydrated path as a source before existence/stat/read decisions |
| Secondary README read | `chunks.mjs` reconstructs `<module>/README.md`, checks existence, and reads it independently; all errors currently fall back to an automatic summary | Route through the same project/source boundary; unsafe layouts are fatal, while a missing safe README retains automatic-summary fallback |

### Prior-cache reads

`readJsonlSafe()` checks existence and then reads the named path directly. For
a safe regular JSONL file it keeps the accepted compatibility behavior of
ignoring blank or malformed lines. It does not currently reject a symlink,
special file, or redirected ancestor.

Changed mode can read these seven cache files:

- `entities.file.jsonl`
- `entities.adr.jsonl`
- `entities.chunk.jsonl`
- `relations.defines.jsonl`
- `relations.calls.jsonl`
- `relations.imports.jsonl`
- `relations.calls_sql.jsonl`

WO-033 validates source paths recovered from safe cache records. WO-034 owns
contained regular-file validation of the cache files and their ancestors.

### Parser composition and workers

- `parser-composition.mjs` creates worker tasks from accepted file records but
  reconstructs an absolute path with `path.resolve(REPO_ROOT, fileRecord.path)`.
- `workers.mjs` sends that absolute path to a worker and treats every worker
  error/skip as an absent parse result.
- `ingest-worker.mjs` reopens `message.absolutePath` with `readFileSync` when
  content is not carried in the message.
- `pipeline-stages.mjs` responds to an absent worker result by parsing the
  already retained file content inline.

The accepted fallback remains required for parser absence, worker crash, or
ordinary skipped work. A filesystem-policy rejection is different: it is a
fatal ingest error and must never be converted into inline fallback.

### Cache and DB outputs

The cache stage writes 26 JSONL files:

`documents.jsonl`, `entities.file.jsonl`, `entities.adr.jsonl`,
`entities.rule.jsonl`, `entities.chunk.jsonl`, `entities.module.jsonl`,
`entities.project.jsonl`, `relations.supersedes.jsonl`,
`relations.constrains.jsonl`, `relations.implements.jsonl`,
`relations.defines.jsonl`, `relations.calls.jsonl`,
`relations.imports.jsonl`, `relations.calls_sql.jsonl`,
`relations.uses_config_key.jsonl`, `relations.uses_resource_key.jsonl`,
`relations.uses_setting_key.jsonl`, `relations.contains.jsonl`,
`relations.contains_module.jsonl`, `relations.exports.jsonl`,
`relations.includes_file.jsonl`, `relations.uses_resource.jsonl`,
`relations.uses_setting.jsonl`, `relations.uses_config.jsonl`,
`relations.transforms_config.jsonl`, and
`relations.references_project.jsonl`.

The DB stage writes 21 TSV files:

`file_nodes.tsv`, `rule_nodes.tsv`, `adr_nodes.tsv`, `chunk_nodes.tsv`,
`project_nodes.tsv`, `constrains_rel.tsv`, `implements_rel.tsv`,
`supersedes_rel.tsv`, `defines_rel.tsv`, `calls_rel.tsv`, `imports_rel.tsv`,
`calls_sql_rel.tsv`, `uses_config_key_rel.tsv`,
`uses_resource_key_rel.tsv`, `uses_setting_key_rel.tsv`,
`includes_file_rel.tsv`, `references_project_rel.tsv`,
`uses_resource_rel.tsv`, `uses_setting_rel.tsv`, `uses_config_rel.tsv`, and
`transforms_config_rel.tsv`.

`manifest.json` is the twenty-seventh cache entry and is currently written
directly after those 47 data files. WO-034 must route all 48 outputs through
one contained staging/commit policy and publish the manifest last.

### Dashboard consumers

`scripts/dashboard.mjs` and `scaffold/scripts/dashboard.mjs` duplicate the
same baseline scan. They read config, resolve configured sources, stat/walk
them, and read accepted text files without source validation. The packaged
copy differs only in project-root selection and support for four additional
TypeScript extensions. WO-033 must reuse one canonical project/source policy
for both scanners while preserving those entrypoint-specific defaults.

The dashboards' display-only manifest reads, Git freshness calculation,
version lookup, and relation summaries do not grant filesystem authority and
are outside WO-033 unless a minimal call-site change is required to share the
validated baseline scanner.

## Frozen Valid Compatibility Contract

The containment program changes only configurations and layouts that violate
the new boundary. Accepted projects retain these behaviors:

| Contract | Frozen evidence |
|---|---|
| Development/packaged equivalence | Both wrappers use the packaged canonical ingest library and produce identical output |
| Full JSONL | 26 files; normalized SHA-256 `937102d472623c4d852762ab700ae510bdc30927ee8aec9aa890976e3b4d44fe` |
| Full TSV | 21 files; normalized SHA-256 `253278db329ecd74ebce9379a2e406e71841388f37ae2ee4ebf166459df7dd43` |
| Changed/deleted JSONL | 26 files; normalized SHA-256 `4fe3cf7e15908215863476a53c785c045ea71af75fb3db76ee88b41020276f3f` |
| Changed/deleted TSV | 21 files; normalized SHA-256 `7e70109126569d4534c340ce6791bb4dc8c295c7db70eb9faf14196beda6c2f4` |
| Ordering and IDs | Repository-relative POSIX file IDs and sorted file-record/worker merge order stay unchanged |
| Parallelism | Sequential and four-worker accepted output stays byte-identical |
| Worker fallback | Missing, invalid, skipped, partial-death, all-death, and disabled workers retain safe inline fallback and settle without hanging |
| Memory trace | All 17 labels, their order, fields, and completion semantics stay unchanged; retained and pending worker results are zero at completion |
| Incremental hydration | Safe regular prior caches retain current record filtering and deterministic changed/deleted materialization |
| Optional C# | An unavailable runtime retains file-level output and parser-health reporting |
| Whole project | `.` remains the explicit whole-project source and still excludes `.context`; the root `bin` exception and nested generated-directory skips remain |
| Missing source | A syntactically valid, contained, missing source remains a non-fatal skip |
| Dashboard baseline | Overlapping accepted source paths remain de-duplicated and the packaged extension set remains intact |

Safe compatibility aliases already accepted by the parser may be normalized
internally: leading `./`, redundant `.` segments, repeated separators, and a
trailing `/`. The original configured values remain in the manifest so a safe
configuration does not acquire unrelated observable drift. An empty value is
not a root alias; `.` is the explicit root value.

## Fail-Closed Security Contract

### Validation order

1. Resolve the selected project once, require an existing directory, obtain
   its real path, and use that real path as the only containment anchor.
2. Validate every existing component from the real project to `.context` and
   both control files without following a symlink. Require `.context` to be a
   real directory and each control to be a regular file before reading it.
3. Parse control text only after those checks. Validate and normalize every
   `source_paths` value before resolving, statting, walking, or creating output
   directories.
4. Validate explicit sources and collect candidates without following walked
   symlink entries. Validate every Git and hydrated-cache path before it can
   enter the candidate set.
5. Revalidate a candidate immediately before direct stat/read and reconstruct
   and revalidate it independently in the worker. Apply the same policy to a
   secondary README read.
6. Only after all input validation succeeds may output setup or mutation
   begin. WO-034 adds complete output preflight, staging, commit, and cleanup.

`CORTEX_PROJECT_ROOT` selects the project. It never authorizes an external
source or output root. A symlink used to select a project may resolve to an
existing project directory, but the resulting real directory—not the symlink
spelling—is the anchor. A symlink below that anchor is not granted authority.

### Portable source syntax

After removing accepted safe presentation aliases, a source must be `.` or a
non-empty repository-relative POSIX path. Reject before resolution:

- NUL or other invalid path input;
- empty or whitespace-only values, including quoted empty values;
- POSIX absolute paths;
- Windows drive-qualified, drive-relative, rooted-backslash, device, or UNC
  spellings on every host platform;
- backslash separators, because configured paths are portable POSIX values;
- any `..` segment, even if later normalization would return inside the root.

Lexical containment and `realpath` containment are both required; neither is
sufficient by itself. Use component-aware relative-path checks, never string
prefix comparison.

### Source resolution and reopen

- An existing explicit source must be a non-symlink regular file or directory
  with non-symlink ancestors below the real project.
- An explicit source containing a symlink is rejected even when the symlink
  target is inside the project.
- A symlink entry encountered while walking a valid directory is not followed.
- A discovered candidate must be a contained non-symlink regular file at each
  source read. A replacement or type change is fatal.
- Every changed, renamed, and deleted Git path is parsed unambiguously from a
  NUL-delimited result and validated before prefix filtering or resolution.
- Every path recovered from incremental cache state is validated before an
  existence check or reuse.
- A worker receives the real project anchor and repository-relative candidate
  identity, not an absolute path as independent authority. Worker-side policy
  rejection is fatal and cannot enter ordinary inline fallback.
- Secondary README lookup may retain its automatic-summary fallback only for a
  missing safe path or an ordinary read failure of a validated regular file.
  A symlink, escape, or type violation must propagate as a fatal boundary
  error rather than being swallowed by the summary fallback.

### Output and prior-cache requirements

- Read prior cache only from contained regular files below the real
  `.context/cache` directory with non-symlink directory ancestors.
- Write only below real `.context/cache` and `.context/db/import` directories.
  Create missing output components one segment at a time after validating the
  existing prefix.
- Preflight every output parent and leaf before staging any output. Reject a
  symlink, directory, FIFO, socket, device, or other non-regular leaf.
- Stage every JSONL, TSV, and manifest beside its target with an unpredictable
  exclusive name. Revalidate parent and target before atomic rename.
- Never truncate an existing destination inode. Replacing a hard-linked
  regular destination must leave the other link's inode and content unchanged.
- Stage the entire set before the first commit, remove every uncommitted
  temporary file on failure, and publish `manifest.json` last.
- A failure before commit preserves the previous complete output set. Portable
  Node APIs do not provide a cross-file transaction, so a commit-phase failure
  may replace a prefix of files; the implementation and diagnostics must not
  claim stronger atomicity.

### Error ownership and disclosure

The canonical boundary creates filesystem-policy errors. Ingest wrappers own
the final CLI rendering and keep exit status 1. Dashboard main entrypoints must
also convert a boundary error to non-zero exit rather than printing an
uncaught stack. Callers must not catch a policy error as a missing file,
unavailable parser, skipped worker result, or automatic-summary fallback.

A diagnostic must be bounded and name only:

- the rejected configuration value or repository-relative path;
- a stable reason category such as invalid syntax, symlink component, outside
  project, wrong file type, changed-path rejection, worker revalidation, or
  unsafe output ancestor/leaf; and
- the relevant project-relative control/output name when applicable.

Do not print file content, a symlink target, an unrelated absolute path, or a
stack trace. A denial occurs before source parsing and output mutation, so no
normal completion summary or manifest is produced.

### Residual concurrent-mutator boundary

Portable Node APIs do not expose the directory-descriptor-relative `openat`
family needed to remove every validation-to-syscall interval. A malicious
same-user process could still exchange an ancestor after final validation and
before a later path-based syscall. The program must revalidate immediately
before each sensitive operation and cover static hostile layouts and
deterministic replacements, but it must state this narrow residual honestly.
This is the same trust-model boundary accepted in WO-030; it is not a claim of
complete race elimination.

## Migration Contract

| Existing project state | Required operator action |
|---|---|
| Safe portable relative sources, including `.` | None; output and record contracts remain frozen |
| Safe missing contained source | None; it remains skipped |
| Absolute, parent, drive, UNC, rooted-backslash, backslash-separated, empty, or NUL-bearing source | Replace it with a portable forward-slash project-relative value; external roots are no longer supported |
| Explicit source symlink, including an in-project target | Configure the real in-project file/directory path or materialize regular project-owned content; do not retain the symlink |
| Symlinked `.context`, config, or rules | Replace it deliberately with a real project directory and regular project-owned control files before rerunning |
| Redirected/special cache or DB layout | Remove the redirection or special node and restore real contained directories/regular files; no automatic follow/copy is permitted |
| Existing safe regular cache | Reuse remains supported; malformed individual JSONL lines keep current skip behavior |

The runtime must never auto-import, copy, or bless external content while
reporting a migration error. No external-root allowlist is introduced. Release
classification and version remain an open WO-035 decision after compatibility
evidence from WO-033 and WO-034.

## Work-Order Boundaries

- WO-033 owns the project anchor, control files, source syntax/resolution,
  full/changed/hydrated candidates, direct and worker reads, module README,
  and both dashboard baseline scans. It must also ensure invalid inputs fail
  before the current recursive output-directory creation.
- WO-034 owns output-directory construction, prior-cache file containment,
  target preflight, exclusive staging, atomic replacement, manifest-last
  commit, and failure cleanup.
- WO-035 owns integrated suites, audits, real package inventory/install,
  normal and negative packed smokes, full review closure, release decision,
  and final R16 disposition.

No work order adds source upload, telemetry, remote storage, or another
network path. MCP compatibility and `.context/mcp` naming remain unchanged.

## Validation Evidence

The focused compatibility command passed 19/19:

```text
node --test tests/ingest-characterization.test.mjs \
  tests/ingest-parallel.test.mjs \
  tests/ingest-worker-crash.test.mjs \
  tests/ingest-memory-trace.test.mjs \
  tests/dashboard.test.mjs
```

It reconfirmed development/packaged equivalence, all four normalized hashes,
the 17 trace labels, root-source behavior, sequential/parallel identity,
worker crash/skip fallback, unavailable C# behavior, and dashboard baseline
de-duplication.

Final documentation/control gates:

- context regressions: 81 passed, 0 failed;
- `git diff --check`: passed;
- final `cortex update`: 32 embedded, 1,156 reused, 0 failed; graph load
  completed;
- `cortex pattern-evidence`: local patterns found for all eight changed files;
- `cortex doctor`: 8/8; and
- `cortex watch status`: stopped (optional watcher).

## Review Gate

Contract review must confirm that the portable syntax, compatibility aliases,
error ownership, migration requirements, and WO-033/WO-034 split are precise
enough to implement without policy inference.

Security and Privacy review must confirm that every read/reopen/write path is
owned, denial precedes mutation, worker fallback cannot bypass policy,
diagnostics do not disclose external data, no external-root authority or
network path is added, and the concurrent-mutator residual is stated narrowly.

Until both reviews pass with no blocker or major finding, this document is a
complete first-pass handoff but not an accepted authorization for WO-033.
