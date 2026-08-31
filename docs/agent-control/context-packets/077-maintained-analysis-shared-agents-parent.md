# WO-063 Maintained Analysis State — Safe Shared `.agents` Parent

## Objective

Make the accepted WO-062 Git-anchored provisioner work below a repository's
existing safe `.agents` namespace without weakening task privacy, exact Git and
filesystem binding, atomic no-clobber publication, recovery ownership, or
sibling-content neutrality.

The change is accepted only when a hermetic repository containing tracked
`.agents/skills/...` under a physical mode-`0755` parent provisions generation
1 without chmod or sibling mutation, while unsafe parents and identity races
still fail closed.

## Starting State

- Accepted WO-062 feature: `769396a`.
- Accepted control integration: `98301f8`.
- WO-062 report:
  `docs/agent-control/maintained-analysis-provisioning-report.md`.
- Real-repo trigger: an isolated shallow clone of
  `https://github.com/microsoft/vscode.git` at upstream HEAD
  `bfafa1afad2b59a3091cee0faad3ed458b239209` and tree
  `85c78d21fb92be7a8027e6b86d0a6b34289adf45` contained tracked
  `.agents/skills` below a physical mode-`0755` `.agents` parent.
- The unmodified clone failed with fixed `PROVISIONING_UNTRUSTED` / managed
  directory not private. In the isolated clone only, changing the parent to
  `0700` allowed generation 1 with 11 observations, five derivable Current
  State decisions, zero blockers/contradictions, snapshot
  `53b73839b3a015214007e31dd416862a93f7eecc007a1191bea263750b83d731`,
  and a byte-identical `already_provisioned` retry.
- This live check proves a compatibility gap and the already accepted engine;
  it is not an upstream VS Code quality assessment or production dogfood.
- Create branch `feature/wo063-shared-agents-parent` in a separate worktree
  from the control authorization commit containing this packet (whose parent
  includes integration `98301f8`) and start in a fresh session using only this
  packet and the direct references below.

## Work Profile

**New contract/design** — the public API is unchanged, but parent-directory
permission acceptance is a security policy change and requires the full Core
MCP reviewer panel.

## Product Decision

The private security boundary belongs to the provisioned task subtree, not to
every pre-existing sibling below a repository-owned `.agents` namespace.

- A newly created `.agents` parent remains mode `0700`.
- An existing parent may be accepted only when it is a physical directory,
  stays within and directly below the selected physical repository root, is
  owned consistently with that root/process policy, has no group or world
  write bits, and retains the exact bound identity and mode across
  publication.
- Mode `0700` and conventional safe shared modes such as `0755` are therefore
  admissible; `0770`, `0775`, `0777`, symlinks, special files, redirected
  ancestors, ownership mismatch, and identity/mode races fail closed.
- The provisioned `.agents/<task-id>`, staging directories, authority,
  receipt, and store files retain the accepted WO-062 exact private modes and
  inventories.
- Existing `.agents` children are foreign sibling content. The provisioner
  never chmods, writes, renames, inventories as owned, hashes as authority,
  or cleans them.

## Owned Scope

- `scaffold/mcp/src/core/analysis-state/provisioning.ts` — introduce the
  narrow existing-parent validator and replace only the exact-private parent
  assertion at canonical publication.
- `scaffold/mcp/tests/analysis-state-provisioning.test.mjs` — add the shared
  parent positive and adversarial regression matrix.
- `docs/agent-control/maintained-analysis-shared-parent-report.md` — short
  result, frozen fixture bindings, gates, and stopped work.
- Existing ownership/package expectation files only when mechanically required
  by changed packed bytes. Do not create ownership v8 unless a managed path is
  added or removed.

## Out Of Scope

- No seed schema, observation, authority, evaluator, rule, query, store,
  receipt, result schema, task path, staging-root, retry, recovery, or public
  API change.
- No changes to shared `ensureSecureManagedDirectory` semantics used by other
  writers; keep the new parent policy local to provisioning unless direct
  evidence proves a shared helper is required without broadening behavior.
- No chmod/chown of a pre-existing `.agents` parent or sibling.
- No public CLI/MCP provisioner or writer, seed builder, automatic repository
  inspection, workflow auto-emission, production Current State/control-doc
  mutation, manager/handoff replacement, release/dependency/network/model
  work, broad dogfood, or WO-055 phase.
- Do not commit the live VS Code clone, its generated seed/evidence, or its
  `.agents/<task-id>` state. Acceptance uses a hermetic fixture; a repeat live
  smoke is optional evidence only.

## Required Contract

1. Separate parent and task policies. The accepted WO-062
   `assertPrivateDirectory` continues to guard stage/task/analysis directories;
   a new narrowly named validator handles only the canonical existing
   `.agents` parent.
2. Bind the parent with `lstat`/`realpath`-safe physical identity before the
   final target absence check and publication. Recheck device, inode, mode,
   type, link status, and chosen ownership fields after rename/fsync and before
   returning success.
3. Reject any group/world-writable parent with a fixed bounded provisioning
   error. Read/execute bits may vary; write bits for group/other may not.
4. A parent created by this attempt remains `0700`. The implementation must
   distinguish safe reuse from creation without changing caller input or
   result output.
5. Existing sibling inventory must be byte-, mode-, link-, and identity-neutral
   on success, exact retry, injected failure, competing target, and rejected
   parent cases. Cleanup owns only the proven staging root and never traverses
   canonical siblings.
6. Publication remains one fixed no-clobber task-directory move. An existing
   target of any kind is never overwritten, including an empty competing
   directory.
7. Dynamic filesystem diagnostics remain masked behind the accepted fixed
   error codes/messages.

## Known Failure Modes Checklist

- Treating non-world-writable as sufficient while allowing group write.
- Calling `chmod` on an existing parent to make a test pass.
- Applying the relaxed parent validator to the task, analysis, stage, lock,
  authority, receipt, or store paths.
- Checking mode once but failing to bind/recheck inode, type, or mode across
  the rename window.
- Assuming Git tracks directory modes or that a tracked child makes the parent
  immutable.
- Recursively snapshotting or deleting unknown `.agents` siblings.
- Letting an existing sibling or concurrent different task become part of the
  exact target inventory.
- Weakening the accepted empty-target no-clobber guarantee because POSIX
  directory rename can replace an empty directory.
- Making a network-dependent VS Code clone part of the deterministic test
  suite.

## Direct References

1. `scaffold/mcp/src/core/analysis-state/provisioning.ts` — accepted parent,
   task, staging, publication, identity, and cleanup logic.
2. `scaffold/mcp/tests/analysis-state-provisioning.test.mjs` — accepted
   fixture, race hooks, injected boundaries, retry, and no-clobber tests.
3. `scaffold/mcp/src/progressiveIndexing.ts` — existing physical managed-path
   creation helper; read as precedent only and do not broaden its contract.
4. `scaffold/mcp/src/core/analysis-state/query-reader.ts` and `store.ts` —
   accepted private task/read/store contracts; unchanged.
5. `docs/agent-control/context-packets/076-maintained-analysis-git-anchored-provisioning.md`
   and `docs/agent-control/maintained-analysis-provisioning-report.md` — frozen
   WO-062 scope and validation baseline.
6. `docs/agent-control/review-iteration-protocol.md` — New contract/design
   reviewer and iteration gates.

## Required Validation

- Focused positive: a fresh physical repo tracks at least one
  `.agents/skills/...` file, parent mode is `0755`, seed/evidence are exact
  HEAD, provisioning returns `created`, trusted read/query/Current State pass,
  and retry is byte-identical `already_provisioned`.
- Freeze the complete sibling path/type/mode/link/inode/bytes snapshot before
  provisioning and prove it is identical afterward. Prove Git status differs
  only by the expected untracked provisioned task when the fixture does not
  ignore it.
- Positive parent modes: at minimum `0700`, `0711`, `0750`, and `0755` when
  ownership and physical identity are valid.
- Negative parent modes: at minimum `0720`, `0730`, `0770`, `0775`, `0777`,
  plus symlink, file, redirected ancestor, unexpected owner where portable,
  and replacement/mode races before and after the no-clobber move.
- Prove task/analysis directories remain `0700`; authority, receipt, and every
  managed file remain `0600`; the exact task inventory is unchanged.
- Rerun every WO-062 focused failure boundary, destination race, two-process
  concurrency, stale-owner recovery, tampered-stage/target, exact retry, and
  deterministic two-repository test.
- Default CLI help/grammar and community MCP inventory remain identical.
- Run TypeScript build; maintained-analysis focused/combined suites; full MCP;
  root context and Node suites; Stage 0 oracle/native; ownership; packed
  filesystem containment/characterization/dashboard; `git diff --check`;
  Cortex update and per-file pattern evidence; and one combined
  Code/Contract/Security/Validation review.
- An optional final live smoke may use the frozen VS Code upstream commit from
  Starting State, but must be isolated, non-authoritative, and never replace
  the hermetic regression.

## Acceptance

GO only if the unmodified hermetic shared-parent fixture provisions and retries
successfully, every unsafe/racing parent fails closed, all foreign sibling
content and Git state remain neutral, every WO-062 guarantee and public
inventory stays exact, the complete validation matrix is green, and combined
review has no blocker or major finding.

Stop NO-GO on any parent chmod/chown, sibling mutation, relaxed task/file mode,
unbound parent identity, overwrite, recursive canonical cleanup, raw diagnostic,
public surface, network-dependent gate, seed/evaluator/store change, dogfood,
production document mutation, or WO-055 work.

## Return

Return the exact feature commit; changed parent-policy function and unchanged
public/internal API; frozen shared-parent fixture and identities; positive and
negative mode/race/sibling-neutrality evidence; focused/full/package/ownership
totals; combined review; and explicit confirmation that seed automation,
public provisioning, production mutation, broader dogfood, and WO-055 remain
stopped.
