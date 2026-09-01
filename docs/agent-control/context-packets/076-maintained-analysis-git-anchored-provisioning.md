# WO-062 Maintained Analysis State — Git-Anchored Initial Provisioning

## Objective

Implement the smallest fail-closed trust root that can create generation 1 of
maintained-analysis state and its independent authority bundle from one closed,
reviewable seed already tracked at the repository's exact `HEAD`. Provisioning
must bind the seed and every cited evidence file to Git objects and unchanged
worktree bytes, build the complete task state outside its canonical path, and
make it visible with one atomic task-directory rename.

The user's “go on” after WO-061 acceptance authorizes this initial-
provisioning gate only. It does not authorize a public CLI/MCP writer, manager
or handoff replacement, workflow auto-emission, dogfood, or any WO-055 phase.

## Starting State

- Accepted WO-061 feature: `42fc33e`.
- Accepted control integration: `0f71d0c`.
- Acceptance control record: `4fa2ec6`.
- Branch: `feature/wo062-maintained-analysis-bootstrap`.
- Worktree:
  `/Users/danielnilsson/GIT/cortex-wo062-maintained-analysis-bootstrap`.
- Start in a fresh session using only this packet and the direct references
  below. Do not reuse the WO-061 implementation session.

## Product Decision And Ordering

WO-056 through WO-061 deliberately stopped before initial authority. Tests
could construct a bundle, and WO-060 could extend one, but production had no
reviewable trust root for generation 1. Dogfood cannot honestly start while
that gap remains.

1. A committed Git object is the first local review/audit anchor. The
   provisioner may trust only a closed seed and evidence bytes tracked at the
   same exact `HEAD` and unchanged in both index and worktree.
2. The seed is structured authority, not prose. Narrative packets, logs,
   Markdown status, current CLI/MCP output, snapshots, or caller-provided
   manifests are not inputs.
3. Canonical state becomes visible only after the complete store and
   `analysis-authority.json` pass the accepted trusted reader in a private
   same-filesystem staging root.
4. A later work order must separately choose and review one non-blind dogfood
   seed, production Current State document replacement, and comparison gates.

## Required Internal Contract

Expose one narrow operation with exact naming chosen by the implementation but
this semantic input:

```text
provisionTrackedAnalysisState({
  enabled: true,
  cwd,
  seedPath
})
```

- `enabled` must be literal `true`; options are an exact plain object.
- `seedPath` is a portable repository-relative tracked file path. It cannot be
  absolute, parent-traversing, Git-internal, `.agents`-resident, a directory,
  symlink, submodule, special file, or caller-selected output path.
- The caller cannot supply repository, task ID, primary subject, observations,
  source registry, authority manifest, expected hashes, template, output path,
  trust policy, Git identity, or recovery policy separately.
- The operation is retry-safe. An exact already-provisioned target returns a
  fixed `already_provisioned` outcome after a complete trusted read and seed
  binding comparison. Any non-exact existing target fails closed.
- Return a closed schema-version-1 result containing fixed generator,
  `created` or `already_provisioned`, repository/task/primary subject, bound
  HEAD/tree/seed-blob identities, seed SHA-256, generation, observation count,
  snapshot SHA-256, authority-bundle SHA-256, and authority/source-registry
  hashes. Return no source body, raw Git/runtime error, or absolute path.

## Closed Seed Schema

Freeze one canonical UTF-8/LF JSON schema version 1 containing only:

```text
schema_version
repository
task_id
primary_subject
observations
source_authorities
seed_sha256
```

- `seed_sha256` binds the canonical payload without that field.
- Observations use the accepted closed observation input contract and are
  canonicalized only through the accepted engine. No ID, payload hash, derived
  fact, snapshot, authority claim, rule, template, or prose summary is supplied
  by the seed.
- `source_authorities` uses the accepted closed registry schema. Every source
  path is used by at least one observation, every observation source is
  present, and no unused authority or source entry is admitted.
- At least one and at most `LIMITS.observations` observations are required.
  The primary subject must occur in the admitted base observations.
- Every cited source is a portable regular tracked file at the same HEAD. Its
  Git mode/object, worktree identity, exact bytes, and declared SHA-256 must
  agree. Symlinks, submodules, hard links, special files, staged/unstaged
  divergence, clean-filter ambiguity, and identity races fail closed.
- Unrelated dirty files are neutral. The seed and its complete transitive
  evidence set alone must be clean and HEAD-exact.

## Git And Filesystem Binding

- Resolve one physical repository root and one exact HEAD at entry. Use
  argument-array, read-only Git operations with bounded stdout/stderr and no
  shell interpolation, hooks, network, credential helper, pager, editor, or
  repository-controlled executable path.
- Bind HEAD, tree, seed blob, every evidence blob/mode, and the physical file
  identities before parsing. Recheck HEAD, index/worktree equality, root,
  `.agents`, seed, and evidence identities before publication and after the
  final trusted read.
- No Git command may fetch, update refs/index, run filters/hooks, or write
  repository state. Unsupported object format, linked Git indirection that
  escapes the selected repository, replacement refs, grafts, alternates,
  partial/missing objects, or command-output overflow fails closed.
- Dynamic Git and filesystem diagnostics are mapped to fixed bounded errors.

## Atomic Initial Publication

- Reuse `publishAnalysisState`, authority-bundle construction/rendering, and
  `readTrustedAnalysisState`; do not create a second evaluator, store format,
  authority parser, or semantic path.
- Build the complete candidate below a private same-filesystem staging project
  root owned by this provisioning attempt. Write the private authority file,
  fsync all files/directories, and validate the candidate through the accepted
  trusted reader before canonical publication.
- The canonical `.agents/<task-id>` must not exist until one atomic rename makes
  the complete task directory visible. Never publish store files or authority
  separately into the canonical task directory.
- A private owner record binds PID/start identity, random token, root/task,
  HEAD/tree/blob, seed hash, and intended final bindings. Live owners cannot be
  reclaimed. A retry may reclaim only a fully validated exited-owner staging
  tree containing the exact closed path/type/mode/link inventory and no
  externally linked inode.
- Failure before rename leaves no canonical task. Failure after rename may
  leave only a validated private empty/staging remainder; retry must return the
  exact already-provisioned state and safely clean only its own proven residue.
- Two concurrent provisioners for one absent task yield one created state and
  one exact already-provisioned result, never overwrite or mixed authority.
  Provisioning different task IDs must not share a lock or stage.

## Owned Production Surface

- Prefer one new module under
  `scaffold/mcp/src/core/analysis-state/` for provisioning.
- Small additive exports in existing store/reader modules are allowed only
  when required to reuse their accepted implementation rather than copying it.
- Add one focused test file under `scaffold/mcp/tests/` and one short WO-062
  result report under `docs/agent-control/`.
- Add ownership `current.json` plus immutable v7 only if the packed managed
  inventory gains files. Change package/containment expectations only by the
  measured delta.

The CLI root/runtime, MCP registrations, trusted append transaction, evaluator
rules, workflow adapter, Enterprise Harness, manager log, handoff ledger,
Stage 0 oracle/fixture, and WO-055 artifacts are read-only.

## Direct References

1. `docs/agent-control/maintained-analysis-current-state-report.md` — accepted
   WO-061 boundary and stopped bootstrap/dogfood decisions.
2. `scaffold/mcp/src/core/analysis-state/trusted-writer.ts` — accepted
   coordinator, owner, CAS, and contained mutation precedent.
3. `scaffold/mcp/src/core/analysis-state/query-reader.ts` — sole authority
   parser and trusted read result.
4. `scaffold/mcp/src/core/analysis-state/store.ts` — sole generation
   publication and recovery format.
5. `scaffold/mcp/src/core/analysis-state/engine.ts` and `schemas.ts` — accepted
   observation, registry, manifest, evaluation, canonicalization, and limits.
6. `scaffold/mcp/tests/analysis-state-trusted-writer.test.mjs` and
   `analysis-state-current-state.test.mjs` — containment, crash, race,
   neutrality, and complete-view precedents.
7. `scaffold/mcp/src/review.ts` — read-only bounded Git invocation and dirty
   candidate precedent only; do not reuse its review semantics.

## Required Validation

- Freeze one exact tracked seed fixture and generation-1 binding. Two fresh
  repositories and fresh processes produce byte-identical managed file bytes
  and result bindings apart from the fixed `created`/`already_provisioned`
  outcome.
- Prove an immediate accepted trusted read, every query/proof operation, and
  WO-061 Current State projection bind the exact provisioned generation.
- Cover unknown/missing/surplus seed keys, malformed canonical JSON/LF/UTF-8,
  bad seed/source hashes, invalid observations/registry/subject/scope, unused
  sources/authorities, zero/over-limit items, and injection payloads.
- Cover untracked/ignored/absolute/parent/Git-internal seed paths, missing
  objects, dirty index/worktree, HEAD/index/worktree races, symlink, submodule,
  hard-link, FIFO/socket/device/directory, wrong mode, linked/redirected
  ancestors, replacement refs/alternates, and bounded Git-output failures.
- Inject failure after every staging/store/authority/fsync/validation/rename/
  cleanup boundary. Before rename the target is absent; after rename it is
  completely trusted; no external byte, identity, link, or mode changes.
- Repeated and concurrent provisioning is exact and bounded. Existing exact
  state is neutral; mismatched/partial/tampered state cannot be replaced.
- Default CLI help/grammar and community MCP inventory remain identical. No
  provisioning or Current State operation is public.
- Stage 0 oracle/native, Stage 1 store/workflow, WO-058 CLI, WO-059 MCP, WO-060
  append/recovery, WO-061 projection, Enterprise workflow, instrumentation,
  and disabled behavior do not regress.
- TypeScript, focused tests, full MCP, full root, package, ownership, packed
  filesystem containment, `git diff --check`, Cortex update, pattern evidence,
  and one combined Core/Contract/Security/Validation review pass.

## Explicit Non-Goals

- No caller-supplied observations, registry, manifest, primary subject,
  expected hashes, raw authority bundle, or prose interpretation.
- No unsigned/untracked/dirty seed, TOFU from an existing snapshot, seed made
  authoritative merely by self-hash, or trust in Git index/worktree without an
  exact HEAD object binding.
- No public CLI/MCP provisioner or writer, config/client mutation, workflow
  auto-emission, manager/handoff replacement, dogfood, or WO-055 phase.
- No network, fetch, model, provider, planner, telemetry, external signer/key
  service, database, dependency, release, publish, or deployment change.

## Stop Conditions

Stop NO-GO if initial authority requires caller policy/prose, a self-rehashed
untracked file, source bytes not bound to HEAD, a second evaluator/store/read
path, non-atomic canonical visibility, deletion of an unproven staging tree,
overwrite of any existing task, raw Git/runtime disclosure, a public surface,
network/model/dependency work, production document mutation, dogfood, or
WO-055 resumption.

## Return

Return the exact feature commit and internal API; frozen seed/HEAD/tree/blob
and generation bindings; fresh-process, atomic-visibility, retry, race, and
neutrality evidence; focused/full/package/ownership totals; combined review;
and explicit confirmation that public writing/rendering, manager/handoff
replacement, workflow auto-emission, dogfood, and WO-055 remain stopped.
