# Ingest Filesystem Containment

## Objective

Close R16 through a sequenced security program that characterizes the released
behavior, defines a fail-closed project filesystem boundary, contains every
ingest source and output path, preserves valid ingest contracts, and validates
the packed artifact before changing the risk status.

The detailed implementation sequence is stored in
`docs/superpowers/plans/2026-08-03-ingest-filesystem-containment.md`.

## Background

- Released baseline is `v2.4.2`; the planning branch starts from `main` at
  `6052686f6019ff67d4d3946c047bd886feb511a5`.
- R16 records that absolute, parent, or symlinked `source_paths` can escape the
  project and that predictable cache/DB destinations can follow symlinks.
- The packaged scaffold under `scaffold/scripts/lib/ingest/` is the only
  canonical ingest implementation. Root and packaged entrypoints are thin
  wrappers.
- `collectCandidateFiles()` currently resolves configuration values against
  the repository without first enforcing containment. The worker can later
  reopen an absolute candidate path.
- JSONL/TSV writers currently open final destinations with truncating writes;
  only two file caches use temporary staging, and manifest output is direct.
- WO-029 freezes deterministic full/changed output, worker fallback, trace,
  and memory behavior. WO-030 provides a reviewed repo-local example for
  symlink denial, atomic replacement, hard-link safety, and the narrow
  same-user concurrent-ancestor-swap residual.
- The application adds no source-data egress or telemetry; this program must
  not add either or create a new network path. Existing dashboard `npm view`
  version lookup and optional C#/VB `dotnet publish`/restore are status and
  trusted-toolchain behaviors that may use the network.

## Required Contract Anchors

- `docs/superpowers/plans/2026-08-03-ingest-filesystem-containment.md`
  - program sequence, concrete policy, negative matrix, and final definition
    of done
- `docs/agent-control/risk-register.md`
  - current R16 wording, ownership, mitigation sequence, and open status
- `docs/agent-control/wo-029-ingest-orchestration-baseline.md`
  - canonical ingest architecture, deterministic hashes, worker behavior,
    trace, and memory contracts
- `docs/agent-control/wo-030-managed-scaffold-baseline.md`
  - repo-local containment, symlink denial, atomic replacement, hard-link
    safety, and accepted concurrent-mutator precedent
- `scaffold/scripts/lib/ingest/files.mjs`
  - source discovery and current line-oriented Git change parsing
- `scaffold/scripts/lib/ingest/io.mjs`
  - current direct JSONL/TSV writers and limited staging primitive
- `scaffold/scripts/lib/ingest/pipeline-stages.mjs`
  - control-file, cache hydration, source read, cache/DB, and manifest paths
- `scaffold/scripts/ingest-worker.mjs`
  - worker-side absolute-path reopen
- `scaffold/scripts/lib/ingest/chunks.mjs`
  - secondary module-summary README read
- `scripts/dashboard.mjs` and `scaffold/scripts/dashboard.mjs`
  - duplicated baseline scans of configured source paths

## Work Profile

New contract/design — source syntax, symlink handling, trusted roots, safe
filesystem mutation, errors, and migration behavior become explicit security
contracts.

## Work Order Sequence

1. **WO-032 — Characterization and security contract**
   - Inventory filesystem operations, capture controlled v2.4.2 exploit
     evidence, freeze valid behavior, and obtain contract/security approval.
2. **WO-033 — Source and control-file containment**
   - Implement canonical project/source validation across discovery,
     hydration, direct reads, changed mode, and worker reads.
3. **WO-034 — Output containment and failure cleanup**
   - Implement contained directory validation, same-directory exclusive
     staging, atomic replacement, cache-read validation, cleanup, and
     dashboard manifest/relation/npm-cache containment.
4. **WO-035 — Integrated validation and release readiness**
   - Validate the complete source/output boundary and packed artifact, close
     reviews, and update R16 only after all evidence passes.

Every implementation work order starts in a fresh session with a smaller
packet created by the preceding work order.

## Owned Scope

- `scaffold/scripts/lib/ingest/runtime-paths.mjs`
- `scaffold/scripts/lib/ingest/config.mjs`
- `scaffold/scripts/lib/ingest/chunks.mjs`
- `scaffold/scripts/lib/ingest/files.mjs`
- `scaffold/scripts/lib/ingest/io.mjs`
- `scaffold/scripts/lib/ingest/incremental-state.mjs`
- `scaffold/scripts/lib/ingest/main.mjs`
- `scaffold/scripts/lib/ingest/parser-composition.mjs`
- `scaffold/scripts/lib/ingest/pipeline-stages.mjs`
- `scaffold/scripts/lib/ingest/workers.mjs`
- `scaffold/scripts/ingest-worker.mjs`
- `scripts/dashboard.mjs` and `scaffold/scripts/dashboard.mjs` as the other
  file-scanning consumers of `source_paths`
- One new canonical filesystem-boundary module under
  `scaffold/scripts/lib/ingest/` if the contract pass confirms that boundary
- Focused containment, ingest, worker, characterization, and package tests
- Agent-control, migration, package inventory, and release notes required for
  traceability

## Out Of Scope

- Authorizing arbitrary external source roots or introducing an external-path
  allowlist
- New source-data egress, remote storage, telemetry, network paths, or services
- Search ranking, parser semantics, graph schema, embeddings, or chunk IDs
- Redesigning scaffold ownership or claiming to eliminate the accepted
  same-user final ancestor-swap interval with portable Node APIs
- MCP compatibility removal or `.context/mcp` renaming
- Publishing, tagging, merging, or deploying without later explicit authority
- A release version decision before compatibility and integrated review

## Required Contract

### Project and control inputs

- Canonicalize one existing project directory as the real containment anchor.
- Reject symlinked/non-regular `.context/config.yaml` and `rules.yaml` inputs
  and symlinked `.context` ancestors.
- `CORTEX_PROJECT_ROOT` selects the project only; it grants no external path
  authority.

### Sources

- Accept portable relative `source_paths` only; retain `.` as whole-project.
- Reject absolute, drive, UNC, empty/NUL, and normalized parent paths.
- Reject explicit source roots containing a symlink, even if the target is
  inside the project; never follow walked symlink entries.
- Revalidate candidates before direct reads and worker reads. Apply the same
  policy to full, changed/deleted, and hydrated-cache paths.
- Use NUL-delimited Git status path parsing and validate every changed,
  renamed, or deleted path under host-repository identity rules before use;
  do not apply portable config grammar to legal POSIX colon/backslash names.
- Route secondary module-summary `README.md` reads through the same boundary.
- Make both dashboard baseline scanners use the same validated source policy;
  source denial precedes `gatherData()` and version lookup. WO-034 separately
  authorizes dashboard manifests, relation data, and npm-cache access.
- Valid sources retain existing relative IDs, ordering, output, and fallback.

### Outputs and prior cache

- Read and write only ingest-managed data in contained regular files below
  real `.context/cache` and `.context/db/import` directories with non-symlink
  directory ancestors. This does not describe trusted parser assets or
  external toolchain publish artifacts.
- Preflight dashboard cache/embeddings manifests, relations, and npm-cache in
  WO-034 before any one of those reads/writes or `npm view` invocation.
- Stage JSONL, TSV, and manifest files beside their targets with unpredictable
  exclusive names; revalidate and atomically replace without truncating an
  existing inode.
- Stage all output before committing, publish the manifest last, and remove
  uncommitted temporary files on failure.
- Reject symlink/special-file destinations; prove external hard-linked inodes
  remain unchanged.
- Do not claim cross-file atomicity beyond what the implementation and tests
  prove.

## Constraints

- Preserve accepted full and changed JSONL/TSV bytes for valid repositories.
- Preserve sequential/parallel equivalence, sorted merge order, worker
  fallback, memory trace labels, and bounded retention.
- A worker-side rejection must not become an unsafe inline fallback.
- Fail before output mutation when configuration, control files, sources, or
  output ancestors violate policy.
- Diagnostics name the rejected repo-relative/config value and reason without
  leaking unrelated external content.
- Use portable Node behavior with platform-specific guards only where tests
  explicitly account for them.
- Keep the packaged scaffold canonical and ensure every new runtime module is
  present in `npm pack`.
- Do not weaken existing tests or hash normalization to obtain green gates.

## Known Failure Modes Checklist

- Lexical prefix checks confuse `/repo-a` with `/repo-ab` or overlook Windows
  drive/UNC syntax on a POSIX runner.
- `realpath` containment is checked once, then a candidate or ancestor is
  reopened later without revalidation.
- Full ingest is contained while `--changed`, cache hydration, C# batch, or a
  worker read retains an escape path.
- Line-oriented Git status parsing misinterprets quoting, newlines, renames, or
  a literal ` -> ` inside a filename.
- Module-summary README lookup reconstructs a path and bypasses the validated
  candidate set.
- Root and packaged dashboards retain duplicated, uncontained `source_paths`
  scans after ingest itself is hardened.
- A worker rejects a swapped path but inline fallback reads it anyway.
- `mkdirSync({ recursive: true })` follows an existing symlinked `.context`
  component before validation.
- A final destination is opened with `"w"` and truncates a symlink or external
  hard-linked inode before type checks.
- Only the two existing staged caches are protected while the other JSONL,
  TSV, or manifest paths remain redirectable.
- Temporary files use predictable names, are created non-exclusively, or
  remain after a failed run.
- Security tests pass but deterministic full/changed output or worker fallback
  changes for normal repositories.
- Tests cover POSIX paths only and miss drive/UNC parsing behavior.

## Required Reviewers

- Code Quality Reviewer
- Contract Reviewer
- Security and Privacy Reviewer
- Integration Reviewer
- Validation Reviewer
- Ops/Release Reviewer for WO-035

Reviewers cannot be the implementer. WO-032 must obtain Contract and Security
and Privacy approval before WO-033 changes runtime behavior.

## Validation

- Controlled v2.4.2 characterization under temporary roots only
- Focused source, symlink, special-file, hard-link, worker, changed-mode,
  cache-hydration, failure-cleanup, and diagnostic tests
- Existing ingest unit, characterization, worker-crash, memory-trace, and
  context-regression suites
- Frozen full/changed hashes and sequential/parallel/worker-failure identity
- Syntax checks for wrappers, worker, and every changed canonical module
- Full root and MCP suites once at work-order acceptance
- Dependency audits, version synchronization when applicable, and clean diff
- Real npm pack, inventory, clean install, normal runtime smoke, and negative
  containment smoke in WO-035
- `cortex pattern-evidence`, `cortex update`, `cortex doctor`, and watcher
  status before final acceptance

## Acceptance

- Static absolute, parent, drive, UNC, and symlink source escapes fail before
  external reads.
- Static symlink/special-file output layouts fail before external mutation.
- Hard-linked external output content is not truncated or modified.
- Worker and inline fallback paths enforce identical containment.
- Failed staging leaves no uncommitted temporary artifacts.
- Normal repositories preserve deterministic, incremental, worker, trace,
  package, and memory contracts.
- No source-data egress, telemetry, new network path/service, or compatibility
  removal is introduced; existing npm version and optional .NET toolchain
  network behaviors are not expanded.
- R16 remains open until WO-035 has packed-artifact evidence and all required
  reviewers close.

## Fresh-Session Start

Start WO-032 in a new session with no chat history and this prompt:

> Implement WO-032 from
> `docs/agent-control/context-packets/022-ingest-filesystem-containment.md`.
> Read that packet completely, then read only its direct references. Use
> Cortex search/rules/impact before code decisions. Characterize R16 only in
> controlled temporary roots, freeze valid v2.4.2 behavior, finalize the
> source/output security contract, obtain Contract and Security review, and
> write the focused WO-033 packet. Do not change runtime behavior, release
> metadata, tags, publishing, or deployment.
