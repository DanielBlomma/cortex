# Ingest Filesystem Containment Plan

## Goal

Close R16 by making ingest read only explicitly configured files inside the
project and write only regular Cortex-owned outputs below the project's real
`.context` directory. Reject traversal, absolute-path, symlink, special-file,
and destination-redirection layouts before they can affect data outside that
boundary.

## Baseline

- Planning branch: `plan/r16-ingest-filesystem-containment`
- Planning baseline: `main` at
  `6052686f6019ff67d4d3946c047bd886feb511a5`
- Released runtime baseline: `v2.4.2`, tag commit `736becf`
- Program packet:
  `docs/agent-control/context-packets/022-ingest-filesystem-containment.md`
- Canonical implementation: `scaffold/scripts/lib/ingest/`
- Existing deterministic contract:
  `docs/agent-control/wo-029-ingest-orchestration-baseline.md`

## Security Contract

### Project trust anchor

- Resolve the configured project root once, require an existing directory,
  and use its real path as the containment anchor.
- Treat `.context/config.yaml` and `.context/rules.yaml` as control inputs.
  Reject a symlinked `.context` tree, symlinked control file, or non-regular
  control file before parsing configuration.
- Keep `CORTEX_PROJECT_ROOT` as the packaged/test integration mechanism; it
  chooses the project but does not authorize paths outside the chosen root.

### Source policy

- Accept only portable repository-relative `source_paths`; `.` remains the
  explicit whole-project value.
- Reject empty values, NULs, absolute POSIX paths, Windows drive/UNC paths,
  and any normalized parent traversal.
- Missing contained sources keep the current skip behavior. Existing sources
  must resolve to a regular file or directory below the real project root.
- Reject an explicitly configured source whose path contains a symlink,
  including a symlink that happens to resolve back inside the project. Do not
  follow symlink entries encountered while walking a directory.
- Revalidate every candidate immediately before stat/read and again before a
  worker reads by path. Apply the same validation to Git changed-mode paths
  and hydrated cache paths.
- Replace ambiguous line-oriented Git status path parsing with a NUL-delimited
  porcelain contract before validating changed, renamed, or deleted paths.
- Route secondary reads, including module-summary `README.md` lookup, through
  the same boundary instead of reconstructing and opening a path independently.
- Make the root and packaged dashboard baseline scanners use the same validated
  `source_paths` policy; they currently duplicate parsing and filesystem scans
  even though they do not write ingest output.
- Preserve repository-relative POSIX record IDs and deterministic ordering for
  every accepted source.

### Output policy

- Permit writes only below real `.context/cache` and `.context/db/import`
  directories rooted in the project. Create missing directory components one
  segment at a time and reject symlink or non-directory components.
- Reject existing output targets that are symlinks, directories, FIFOs,
  sockets, devices, or other non-regular files.
- Stage every JSONL, TSV, and manifest output in its destination directory
  using an unpredictable name and exclusive creation. Revalidate the parent
  and destination before an atomic rename.
- Never truncate an existing destination in place. Atomic replacement must
  leave any external hard-linked inode unchanged.
- Stage the complete output set before committing it, publish the manifest
  last, and remove every uncommitted temporary file on failure. Do not claim a
  cross-file atomic transaction that portable Node APIs cannot guarantee.
- Reads of prior cache state use the same contained regular-file policy and
  fail closed on redirected or special-file cache inputs.

### Explicit residual boundary

Portable Node path APIs cannot fully eliminate a malicious same-user process
swapping an ancestor between final validation and the filesystem syscall.
Static hostile layouts and ordinary project input must fail closed; the
remaining concurrent-mutator interval is recorded and reviewed explicitly,
matching the trust-model treatment used for WO-030.

## Work Order Sequence

### WO-032 — Characterization and Security Contract

- [x] Build controlled temporary-directory probes for absolute, parent,
  symlinked, special-file, and redirected-output layouts.
- [x] Record the v2.4.2 observable behavior without touching files outside the
  temporary test sandbox.
- [x] Freeze valid full/changed, sequential/parallel, worker-fallback, trace,
  and cache-hydration contracts that must remain unchanged.
- [x] Finalize error ownership: invalid configuration and unsafe filesystem
  layout exit non-zero on stderr before parsing or output mutation.
- [x] Inventory every ingest filesystem operation, including worker-thread
  reads, cache hydration, staged JSONL, TSV, manifest writes, and both
  dashboard baseline scanners that consume `source_paths`.
- [x] Produce the focused WO-033 context packet.
- [ ] Obtain Contract plus Security and Privacy review of the policy before
  runtime changes.

### WO-033 — Source and Control-File Containment

- [ ] Add one canonical ingest filesystem-boundary module rather than
  duplicating path checks across discovery, pipeline, and workers.
- [ ] Anchor the project by real path and validate control-file reads.
- [ ] Validate and normalize configured source paths before discovery.
- [ ] Apply containment to full discovery, Git changed/deleted paths,
  incremental hydration, direct and secondary README reads, and worker-path
  reads.
- [ ] Parse renamed/deleted Git paths through NUL-delimited porcelain so
  quoting, newlines, and literal ` -> ` filename content cannot alter scope.
- [ ] Apply the same validated source contract to root and packaged dashboard
  baseline scans so status diagnostics cannot retain an external-read path.
- [ ] Reject explicit symlink sources and prevent recursive discovery from
  following symlink entries.
- [ ] Add negative subprocess tests for POSIX absolute, Windows drive/UNC,
  parent traversal, in-root and escaping symlinks, symlinked control files,
  and candidate replacement before read.
- [ ] Prove accepted full/changed and worker outputs remain byte-identical to
  the v2.4.2 baseline.
- [ ] Resolve review findings and create the focused WO-034 packet.

### WO-034 — Output Containment and Failure Cleanup

- [ ] Validate/create the `.context`, cache, and DB-import directory chain
  without following symlink components.
- [ ] Replace direct truncating JSONL, TSV, and manifest writes with one
  contained same-directory staging primitive.
- [ ] Stage all outputs before commit, publish the manifest last, and clean up
  uncommitted artifacts on every error path.
- [ ] Reject symlink and special-file destinations and prove hard-linked
  external files are not mutated.
- [ ] Apply contained regular-file checks to cache hydration reads.
- [ ] Add deterministic fault injection at staging and pre-rename boundaries;
  verify non-zero exit, unchanged external targets, preserved previously
  committed outputs before commit, and no temporary-file residue.
- [ ] Keep JSONL/TSV bytes, file counts, ordering, trace labels, and memory
  retention within their accepted contracts.
- [ ] Resolve review findings and create the focused WO-035 packet.

### WO-035 — Integrated Validation and Release Readiness

- [ ] Run syntax checks for the wrappers, worker, and all canonical ingest
  modules.
- [ ] Run the complete containment negative matrix on supported CI platforms.
- [ ] Run focused ingest, worker failure, memory trace, characterization, and
  context-regression suites.
- [ ] Reconfirm full/changed hashes and sequential/parallel/worker-failure byte
  identity for accepted configurations.
- [ ] Run complete root and MCP suites plus every committed dependency audit.
- [ ] Pack and install the real npm artifact; verify the new module and tests'
  assumed runtime layout are present.
- [ ] Exercise packed `init --bootstrap`, `doctor`, `update`, and `search` in a
  normal repository, then run packed negative containment smokes.
- [ ] Confirm no source upload, telemetry, or new network path exists.
- [ ] Complete Code Quality, Contract, Security and Privacy, Integration,
  Validation, and Ops/Release review.
- [ ] Update R16 only after all gates prove both source and output containment.
  Choose release version/classification separately after compatibility review.

## Negative Test Matrix

| Boundary | Required cases | Required result |
|---|---|---|
| Project/control | symlinked `.context`, config/rules symlink, directory/FIFO control input | Fail before config parse or mutation |
| Source syntax | `/absolute`, `../parent`, drive path, UNC path, empty/NUL | Fail with bounded stderr diagnostic |
| Source resolution | source symlink inside root, source symlink outside root, nested symlink entry | Explicit source fails; walked symlink is never read |
| Changed mode | hostile/quoted/newline/` -> ` Git path, deleted traversal, swapped candidate | No parse ambiguity or read outside the real root |
| Worker | path replacement between scheduling and worker read | Worker rejects and inline fallback cannot bypass policy |
| Dashboard | invalid source syntax and symlinked source | No external scan; same bounded diagnostic/policy as ingest |
| Output parents | symlinked cache, DB, import, or replaced ancestor | Fail before external mutation |
| Output leaf | symlink, directory, FIFO/socket, hard-link alias | Reject redirects/special files; replace a hard link without mutating its external inode |
| Failure cleanup | stage failure, pre-commit failure, rename failure | Non-zero exit and no staged residue |
| Compatibility | normal full/changed/parallel/worker-failure fixtures | Frozen bytes, counts, ordering, and traces |

## Validation Gates

- Focused containment and ingest unit/subprocess tests during iteration.
- `node --check` for every changed executable and module.
- Frozen normalized JSONL/TSV hashes and worker equivalence.
- `node tests/context-regressions.test.mjs`.
- Full root `npm test` and full `npm --prefix scaffold/mcp test` once at
  integrated acceptance.
- `npm run audit:dependencies`, package inventory, extracted-package install,
  and packed runtime smokes.
- `git diff --check`.
- `cortex pattern-evidence <changed-file> --json`, `cortex update`,
  `cortex doctor`, and `cortex watch status` before acceptance.

## Final Definition of Done

- No configured or discovered ingest source can escape the real project root
  through path syntax or a static symlink layout.
- No ingest cache, DB-import, staged, or manifest write can be redirected
  outside the real `.context` tree through a static hostile layout.
- Unsafe control/cache inputs and non-regular destinations fail closed before
  they are consumed or mutated.
- Failed staging leaves no temporary artifacts and never mutates an external
  symlink or hard-link target.
- Accepted repositories retain deterministic output, incremental behavior,
  worker fallback, trace, package, and memory contracts.
- R16 is marked mitigated only after independent security review and packed
  artifact evidence; the narrow same-user concurrent-swap residual is stated
  honestly.
