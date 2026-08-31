# WO-062 Maintained Analysis State — Git-Anchored Provisioning Report

## Result

**GO for WO-062 acceptance. Public writing/rendering, production control-document
mutation, workflow auto-emission, dogfood, and WO-055 remain stopped.**

WO-062 adds one internal literal-opt-in operation:

```ts
provisionTrackedAnalysisState({ enabled: true, cwd, seedPath })
```

The semantic caller input remains only one physical repository root and one
portable seed path. Optional hooks are code-owned failure/race probes used only
by the focused test. The caller cannot provide repository/task/subject,
observations, source authority, manifests, expected hashes, output paths, Git
identity, or recovery policy.

## Accepted Boundary

The provisioner:

- binds one physical non-linked repository, exact HEAD/tree, seed blob, index
  entry, worktree bytes, mode, inode, ancestors, and every cited source before
  parsing;
- clears inherited `GIT_*` controls and uses bounded argument-array Git reads
  with hooks, fsmonitor, credentials, pager, editor, alternates, replacement
  objects, grafts, and partial-object ambiguity disabled or rejected;
- admits only canonical UTF-8/LF closed seed schema v1, verifies its canonical
  payload hash, and delegates observation/registry/manifest/state semantics to
  the accepted engine and Stage 1 store;
- builds generation 1, the authority bundle, and a private Git-binding receipt
  under one same-filesystem owned staging root, then validates the complete
  candidate with `readTrustedAnalysisState`;
- publishes the task directory with a fixed system no-clobber move primitive,
  preserving a competing empty task inode as well as non-empty/mismatched
  targets; and
- returns `already_provisioned` only after an exact trusted replay plus receipt,
  authority, observation, seed, HEAD/tree/blob, and current file-identity
  comparison.

`analysis-provisioning.json` is part of the private task inventory. It is the
durable proof that a retry is comparing the existing generation-1 state with
the same tracked seed rather than accepting merely equivalent derived facts.
It is mode `0600`, self-hashed, and atomically published with the store and
`analysis-authority.json`.

Stale staging reclamation requires a closed owner record, exited PID, exact
root/task/token binding, private modes, bounded known paths and types, single
links, and matching intended receipt. Unknown or externally linked content is
never deleted. Live owners wait. Two fresh processes therefore produce exactly
one `created` result and one byte-identical `already_provisioned` result.

## Frozen Generation-1 Binding

The focused fixture uses seed `fixtures/analysis-seed.json` and one tracked
source `evidence/review.json`. Two independently initialized repositories with
fixed identical commit metadata produced byte-identical managed files and this
binding:

| Binding | Value |
| --- | --- |
| HEAD | `6db2aa485fd72a81b454472fca3ba593c1d4091f` |
| Tree | `15dc781ee24de01601cd9b05600700ac0910e129` |
| Seed blob | `5da785c0f38dd093a698043b0e9ceff7b1792521` |
| Seed SHA-256 | `128ccc26b26151fa1fb0dd65d9784653a3a3f6094d39c287804845622089dab3` |
| Source SHA-256 | `07e05614f61207059f9d3f466d4ce8cb66140555cd04edd6928cd0ca3c0f280e` |
| Generation / observations | `1` / `1` |
| Snapshot SHA-256 | `e6ed1bb9784cae39ce901cc7f927b6d629cbf30d0096e05c7736633ff3dbeeea` |
| Authority bundle SHA-256 | `2316508d50924fac29e3c4c4b673fb358eaee1756bb1b5a04b21c29ab1d349b0` |
| Authority manifest SHA-256 | `ffdbbef0a86f004820ba18f9f724f1d2040626af0caaf3c64480b560c854be8a` |
| Source registry SHA-256 | `5979f4afaca920e556985a714ff1cbca8057bdb12d716fc82a6113b15dbabcd9` |

The immediate trusted read, all four query/proof operations, and the WO-061
Current State projection bind that exact generation and snapshot. A retry
changes only the result outcome from `created` to `already_provisioned` and
leaves every managed byte unchanged.

## Validation

- TypeScript build: pass.
- Focused provisioning: 11/11 pass. Coverage includes canonical schema/hash/
  UTF-8/LF/bounds, invalid semantics and injection text, dirty index/worktree,
  symlink/gitlink/hard-link/FIFO/directory/mode/ancestor cases, missing objects,
  alternates/replacements, inherited Git controls, identity and destination
  races, all twelve failure boundaries, exact retry, two-process concurrency,
  exited-owner recovery, tampered staging, partial and tampered targets, and
  deterministic fresh repositories/processes.
- Combined maintained-analysis chain: 48/48 pass. Final full MCP suite:
  643/643, zero skipped.
- Accepted Stage 0 oracle: 19/19; native engine runs the same 19-case fixture
  byte-for-byte and its focused contract suite passes 3/3.
- Root: 81/81 context regressions and 400/400 Node tests.
- Ownership: 17/17. Immutable v7 adds exactly provisioning source, dist, and
  test: 423 managed paths and 96 runtime paths.
- Package: 465 entries (444 mode `0644`, 21 mode `0755`), inventory SHA-256
  `b57403ef4d5f9e59946eaf130e361f55114e378ab4da3a4918cf1c1207811a1e`,
  tarball SHA-256
  `5ae739f30f0bfcd3d71722a80717c0a546e1857d189bf5e7b2c49f0bb149cbeb`.
  Packed containment is 42/42, characterization 3/3, and development/packed
  dashboard 4/4 each. Forced upgrade verifies 110 changed managed files and 43
  additions.
- Ten repeated WO-060 two-writer races pass after one initial full-suite run
  observed the already accepted alternative coordinator-loser diagnostic; the
  clean final full MCP run is 643/643.
- `git diff --check`: pass. Cortex update/graph load: pass with 193 files, six
  rules, 1,661 chunks, 671 constraint relations, 623 call relations, and
  1,874/1,874 embeddings. Changed code/test/ownership paths are outside the
  configured Cortex source paths, so their required per-file pattern-evidence
  query reports them unindexed exactly as in WO-060; Packet 076 and the direct
  accepted implementation references remain the governing evidence.
- Deterministic repo-diff review reports zero findings and zero conflicts. A
  manual combined Core/Contract/Security/Validation review covers the four
  changed code files for which the repository has no applicable convention
  profile, including Git environment isolation, exact seed closure, source and
  filesystem identity binding, private recovery ownership, no-clobber atomic
  publication, fixed errors, retry/concurrency behavior, public inventory
  neutrality, and all stop conditions.

## Stopped Work

No public CLI or MCP provisioner/writer was registered. Default CLI grammar and
community MCP inventory remain unchanged. No workflow adapter, manager log,
handoff ledger, production Current State document, Stage 0 fixture/oracle,
Enterprise surface, instrumentation, dependency, network/model path, dogfood,
or WO-055 artifact was changed. Selecting and reviewing a real seed and
starting non-blind dogfood require a later separately authorized work order.
