# WO-063 Maintained Analysis State — Shared `.agents` Parent Report

## Result

**GO for WO-063 acceptance. Public provisioning/writing, production
control-document mutation, seed automation, broader dogfood, and WO-055 remain
stopped.**

WO-063 changes only the internal parent policy and its focused regression
surface. The public and internal semantic API remains:

```ts
provisionTrackedAnalysisState({ enabled: true, cwd, seedPath })
```

The accepted seed schema, generation-1 engine/store/query/Current State result,
authority model, receipt, recovery policy, and exact task inventory are
unchanged from WO-062.

## Accepted Parent Policy

The provisioner now accepts an already existing physical `.agents` directory
only when it is a direct child of the same bound physical repository, is owned
by the repository owner/current process where portable, and has neither group
nor world write permission. Safe existing modes `0700`, `0711`, `0750`, and
`0755` are retained byte- and mode-exact. Unsafe modes `0720`, `0730`, `0770`,
`0775`, and `0777`, unexpected portable ownership, files, symlinks, redirected
ancestors, and identity or mode replacement fail closed.

A missing `.agents` parent is still created privately as `0700`. Task, staging,
and analysis directories remain `0700`; every managed file remains `0600`.
The provisioner never calls `chmod` or `chown` on a pre-existing parent and
never mutates, traverses for cleanup, or claims authority over foreign sibling
content.

The parent binding records path, device, inode, complete mode, owner, group,
and whether the directory was provisioner-created. It is established after
private candidate staging and validation, checked immediately before
publication, checked through an opened directory descriptor during
publication, and checked again through the canonical repository path after
publication. Publication changes the process working directory to the verified
physical parent, opens and `fstat`s `.`, and invokes the fixed no-clobber move
with `.` as destination. The child inherits the already bound kernel
working-directory reference, so replacing the canonical `.agents` name during
the last publication gap cannot redirect the task into a replacement symlink
or directory. Relative post-publication identity checks and directory `fsync`
complete inside that same binding before the canonical post-check. Every
post-binding no-clobber fallback must also match that original binding before
it may accept an exact existing task.

## Frozen Shared-Parent Fixture

The focused fixture keeps the accepted seed `fixtures/analysis-seed.json`, the
tracked source `evidence/review.json`, and the unchanged `wo062-test` task /
`WO-062` subject semantics. It additionally commits
`.agents/skills/fixture/SKILL.md` and places a foreign regular file plus a
foreign symlink beside the managed task. Before each operation the test freezes
the complete sibling path/type/mode/device/inode/link-count/bytes/link-target
inventory and the parent device/inode/mode/uid/gid tuple. Success, retry,
failure, safe-mode, unsafe-mode, and two-process cases prove those values remain
exact. Git status changes only by the expected untracked task directory.

Two independently initialized fixtures with fixed commit metadata produce the
same managed bytes and these frozen bindings:

| Binding | Value |
| --- | --- |
| HEAD | `dceffa0adc413de99c8a40ecb8b0fdca3f6a4945` |
| Tree | `e2223dbe6c9ad9924fbbcaf82c526d51da3f7aca` |
| Seed blob | `5da785c0f38dd093a698043b0e9ceff7b1792521` |
| Seed SHA-256 | `128ccc26b26151fa1fb0dd65d9784653a3a3f6094d39c287804845622089dab3` |
| Source SHA-256 | `07e05614f61207059f9d3f466d4ce8cb66140555cd04edd6928cd0ca3c0f280e` |
| Generation / observations | `1` / `1` |
| Snapshot SHA-256 | `e6ed1bb9784cae39ce901cc7f927b6d629cbf30d0096e05c7736633ff3dbeeea` |
| Authority bundle SHA-256 | `2316508d50924fac29e3c4c4b673fb358eaee1756bb1b5a04b21c29ab1d349b0` |
| Authority manifest SHA-256 | `ffdbbef0a86f004820ba18f9f724f1d2040626af0caaf3c64480b560c854be8a` |
| Source registry SHA-256 | `5979f4afaca920e556985a714ff1cbca8057bdb12d716fc82a6113b15dbabcd9` |

HEAD differs from the WO-062 fixture only because the shared-parent fixture now
tracks the sibling skill. The seed blob and every semantic state/authority hash
remain exactly the accepted WO-062 values.

## Validation

- TypeScript build: pass.
- Focused provisioner: 19/19, zero skipped. This covers the tracked shared
  `0755` parent, all four accepted modes, all five rejected writable modes,
  symlink/file/redirected-ancestor/portable-owner rejection, parent mode and
  identity races on both sides of publication, deterministic final-gap name
  replacement, physical replacement plus a no-clobber collision and exact
  replacement target, sibling and Git neutrality, exact private
  modes/inventory, all WO-062 injected boundaries, competing targets,
  two-process rendezvous, exited-owner recovery, deterministic repositories,
  and exact retry.
- Combined maintained-analysis chain: 56/56, zero skipped. The accepted native
  engine contract remains 3/3. Stage 0 oracle: 19/19.
- Default CLI grammar and MCP inventory contract: 22/22.
- Root context regressions: 81/81. Root Node suite: 400/400, zero skipped.
- Ownership/package/containment/characterization/dashboard: 25/25. Immutable v7
  remains 423 managed and 96 runtime paths; no ownership v8 is required.
  Package: 465 entries (444 mode `0644`, 21 mode `0755`), inventory SHA-256
  `b57403ef4d5f9e59946eaf130e361f55114e378ab4da3a4918cf1c1207811a1e`,
  tarball SHA-256
  `2c0d72d481d08949095ac8f4c3b3d04f7a47078d2cf7fd368db99e6517907bd7`.
  Packed containment is 42/42, characterization 3/3, and development/packed
  dashboard 4/4 each. Forced upgrade verifies 110 changed managed files and 43
  additions.
- Full MCP suite: 651/651, zero skipped. One clean-worktree run produced 649/650
  because the pre-existing `review --diff` test asserts that the worktree has
  at least one changed file; the report itself supplies that expected local
  diff for the final run.
- An initial concurrent root run observed one timeout/state-transition failure
  in the pre-existing background-worker test; its immediate isolated rerun is
  1/1 and the final serialized root run is recorded above.
- `git diff --check`: pass. Cortex update and graph load: pass with 194 files,
  six rules, 1,667 chunks, 676 constraint relations, 623 call relations, and
  1,881/1,881 embeddings; doctor is 8/8. Freshness is 99% solely because the
  staged result report remains the intentional acceptance diff. The changed
  runtime source and test remain outside configured Cortex `source_paths`, so
  their required per-file pattern-evidence calls report them unindexed, as in
  WO-062. This report is indexed and its local pattern evidence resolves the
  accepted WO-062 report and governing maintained-analysis packets.

## Independent Review Iterations

The first independent Code/Integration and Validation reviews found no runtime
blocker but correctly withheld GO while this required report was absent. The
first Contract/Security review found one publication-gap blocker: pathname-only
`/bin/mv -n` could follow a replacement `.agents` symlink after the last
canonical check. The implementation was changed to the verified inherited-CWD
binding described above and gained a deterministic regression that proves the
external replacement remains empty.

The first remediation at commit
`a8e0927d8be10cc76a45a955d6e4ea62a43a17f9` received independent Validation GO,
but final combined review found a second blocker: the `mv -n` no-op fallback
could freshly bind a different safe physical parent containing an exact task.
Every post-bind exact-target fallback now requires the original parent binding
at entry and exit. A deterministic regression combines a physical replacement,
an empty collision in the original parent, and an exact replacement target and
requires fixed `PROVISIONING_UNTRUSTED`.

Independent Code/Contract/Security/Integration and Validation re-reviewed exact
remediation commit `56d0d5801769dc073632a2a0949ac8f15a45fb2f` and both return
GO with no blocker, major, or minor findings. Both ran build and 19/19; Validation
also repeated the fallback, redirect-gap, and barrier-concurrency cases three
times (9/9). The owner-mismatch branch remains conditionally unexercised on
hosts where a portable privileged `chown` is unavailable; the policy and
conditional test remain present.

## Stopped Work

No public CLI or MCP provisioner/writer was registered. No seed selector or
automation, workflow auto-emission, manager log, handoff ledger, production
Current State/control document, Stage 0 fixture/oracle, Enterprise surface,
instrumentation, dependency, network/model path, live upstream smoke, broader
dogfood, or WO-055 artifact was changed. These remain separately authorized
future work.
