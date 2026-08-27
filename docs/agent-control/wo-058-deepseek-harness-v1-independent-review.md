# WO-058 DeepSeek Harness V1 Independent Acceptance Review

**Date:** 2026-08-27

**Overall decision:** **GO**

The corrected dirty candidate independently passes the contract, isolation,
subprocess-tree, protocol, package, dependency, headless, Web, and full
regression gates. In particular, both required real negative cases now pass
after the direct CLI leader has exited 0 while a SIGTERM-trapping descendant
remains alive: caller abort and provider deadline each deliver TERM, wait for
the configured grace and escalation, leave no live tree, and return the
correct `CANCELED` or `TIMEOUT` classification. There are no unresolved
blocker, major, minor, or note findings.

R20 may close locally. The candidate is ready for fresh-manager acceptance.
Merge, npm publication, README release promotion, and V2 remain unauthorized.

This was a fresh, read-only runtime review. The previous WO-058 report was
read only after the independent conclusions and evidence had been obtained,
then replaced as existing output. No runtime, test, manifest, configuration,
plan, README, release, commit, tag, publication, Cortex index, or V2 change was
made. This report is the only candidate file written by this review.

## Candidate identity

- Worktree: `/Users/danielnilsson/GIT/cortex-worktrees/deepseek-stage0`
- Branch: `feature/deepseek-harness-stage0`
- Candidate HEAD: `c82fd113e923025297bb701a1189f5bf706d9ddd`
- HEAD subject: `Merge pull request #119 from DanielBlomma/docs/minimal-readme`
- Bundle: `@danielblomma/dsh-cortex@2.5.2`
- Harness checkout: `/private/tmp/cortex-wo057-harness-20260827`
- Harness release: `0.1.1-rc.2`
- Harness HEAD: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`
- Review target: the exact uncommitted and unpublished dirty worktree, not
  `main` and not the planning checkout.

Initial and final pre-report `git status --short` were materially identical:

```text
 M README.md
 M docs/agent-control/acceptance-matrix.md
 M docs/agent-control/agent-work-orders.md
 M docs/agent-control/handoff-ledger.md
 M docs/agent-control/manager-log.md
 M docs/agent-control/risk-register.md
 M package.json
 M scripts/sync-release-version.mjs
 M tests/plugin-manifests.test.mjs
 M tests/plugin-skills.test.mjs
?? docs/agent-control/context-packets/055-deepseek-harness-integration.md
?? docs/agent-control/context-packets/056-deepseek-harness-session-provider.md
?? docs/agent-control/context-packets/057-deepseek-harness-v1-independent-acceptance.md
?? docs/agent-control/wo-056-deepseek-harness-stage0-compatibility.md
?? docs/agent-control/wo-057-deepseek-harness-contract-security-review.md
?? docs/agent-control/wo-057-deepseek-harness-session-provider-result.md
?? docs/agent-control/wo-057-deepseek-harness-session-provider.md
?? docs/agent-control/wo-058-deepseek-harness-v1-independent-review.md
?? docs/superpowers/plans/2026-08-25-deepseek-harness-integration.md
?? plugins/dsh-cortex/
?? scripts/check-deepseek-harness-compatibility.mjs
?? tests/deepseek-harness-compatibility.test.mjs
?? tests/deepseek-harness-session-provider.test.mjs
?? tests/fixtures/deepseek-harness-compatibility.json
```

## Reviewed inventory

The WO-057 runtime/distribution scope was read in full or checked
deterministically:

- Bundle and runtime: `plugins/dsh-cortex/package.json`, `package-lock.json`,
  `cordis.patch.yml`, `protocol.mjs`, `provider.mjs`, `tools.mjs`, `skills.mjs`,
  and `skills-manifest.json`.
- Packaged skills: `plugins/dsh-cortex/skills/{change-impact,context-review,
  pattern-review,repo-research,using-cortex}/SKILL.md`.
- Bundle tests: `plugins/dsh-cortex/tests/local-subprocess-integration.test.mjs`
  and `plugins/dsh-cortex/tests/scoped-integration.test.mjs`.
- Root integration: `package.json`, `scripts/sync-release-version.mjs`,
  `scripts/check-deepseek-harness-compatibility.mjs`,
  `tests/deepseek-harness-compatibility.test.mjs`,
  `tests/deepseek-harness-session-provider.test.mjs`,
  `tests/plugin-manifests.test.mjs`, `tests/plugin-skills.test.mjs`, and
  `tests/fixtures/deepseek-harness-compatibility.json`.
- Release-state check: the DeepSeek Harness section of `README.md`; it remains
  explicitly `planned` and unavailable.
- Authority/intake: packet 057 and every direct reference named there. The
  WO-057 result record was treated as intake, not proof.
- Upstream: all 18 fixture-pinned files were re-hashed. The packet-056 Harness
  contract files for tools/schema/scope, Agent identity, file-reference
  lifecycle, subprocess service/types, skills, and bundle publication were
  inspected. The concrete installed
  `@deepseek-ai/dsh-subprocess-local@0.1.1-rc.2` implementation reached by the
  integration tests was also inspected.

Cortex evidence was obtained before code conclusions with `cortex search`,
`cortex rules`, and `cortex impact`. `cortex pattern-evidence` succeeded for
the two changed indexed scripts. The new untracked bundle and tests are absent
from the current index and returned `INVALID_ARGS: Pattern target was not found
in indexed context`; direct files, imports, pinned upstream, tests, and actual
execution therefore govern those files. No `cortex update` was run because the
review packet explicitly makes index mutation out of scope.

## Role decisions and findings

| Reviewer role | Decision | Findings and basis |
|---|---|---|
| Code Quality | **GO** | `none`. The post-spawn termination observer is small, disposed deterministically, and follows the pinned whole-tree handle contract. Tests cover both simulated ordering and real OS processes. |
| Contract | **GO** | `none`. Exact Agent identity, canonical workspace authority, CLI limits/argv, four-command envelopes, exact package export, and agent-local readiness all pass. |
| Security/Privacy | **GO** | `none`. Isolation, fail-closed authority, argv safety, bounded/redacted output, local-only retrieval, tree quiescence, and teardown pass. |
| Integration | **GO** | `none`. Real Harness scoped registries, two indexed roots, packed dependency closure, headless/Web composition, upgrade, and removal pass. |
| Validation | **GO** | `none`. All focused, full, independent-negative, network-denied, package, audit, and lifecycle gates pass. |
| Ops/Release | **GO for local readiness** | `none`. Artifact contents and repeat hashes are exact, README remains planned, and the npm package is absent. Release actions remain unauthorized. |

## Material contract and security evidence

- `plugins/dsh-cortex/tools.mjs:43-114,168-176` captures the owning Agent in
  each scoped tool and compares `exec.agent` by object identity before any
  provider call. No public schema contains a cwd, root, workspace, executable,
  or command selector.
- `plugins/dsh-cortex/provider.mjs:92-169,214-231` requires a caller signal,
  reads only `agent.session.header.cwd`, requires an existing absolute
  directory, resolves it with `realpath`, and uses only the canonical path as
  subprocess cwd. Missing/relative/deleted/non-directory roots fail before
  spawn; a symlink rebind cannot replace the already canonical argv cwd.
- Search and related delimit positional input; impact safely delimits a
  double-dash query and rejects flag-shaped option values; all execution uses
  an argv array with `--json` before any delimiter. Public maxima (search 20,
  related depth 3, impact depth 4/top-k 20/path hops 8), enums, booleans, and
  the 8 KiB UTF-8 text cap are enforced without duplicating Cortex ranking.
- `resolveCortexCliEntry()` resolves the direct
  `@danielblomma/cortex-mcp@2.5.2` export, requires `bin/cortex.mjs`, and runs
  `[process.execPath, entry, command, ...args, --json]`. There is no shell,
  `npx`, PATH-only Cortex, registry tag, or private retrieval import.
- stdout is capped at 2 MiB, stderr at 64 KiB, the deadline at 15 seconds, and
  termination grace at 1 second. Lossy, signaled, non-zero, malformed,
  multi-document, wrong-command, invalid-success, and invalid bounded-failure
  envelopes normalize without exposing child payloads or diagnostics.
- `plugins/dsh-cortex/provider.mjs:117-130` keeps an independent fused-signal
  observer calling idempotent `handle.terminate()` after spawn and always
  awaits `handle.waitForExit()` before classification. The observer remains
  active after `handle.done` settles, then is removed in `finally`.
- Independent real reproduction used a package-shaped leader that spawned a
  descendant with a SIGTERM handler and ignored stdio, waited for the
  descendant-ready marker, then exited 0. Before each trigger, `handle.done`
  was `{ exitCode: 0, signal: null }` and the descendant was proven alive.
  Exact observations:

  ```json
  [
    {
      "kind": "caller",
      "leaderOutcome": { "exitCode": 0, "signal": null },
      "aliveBefore": true,
      "classification": "CANCELED",
      "termSeen": true,
      "aliveAfter": false,
      "elapsedTotalMs": 1067,
      "waitedAfterTriggerMs": 1008
    },
    {
      "kind": "deadline",
      "leaderOutcome": { "exitCode": 0, "signal": null },
      "aliveBefore": true,
      "classification": "TIMEOUT",
      "termSeen": true,
      "aliveAfter": false,
      "elapsedTotalMs": 2299,
      "waitedAfterTriggerMs": 2204
    }
  ]
  ```

  The caller case waited through the 1,000 ms escalation instead of settling
  early; the deadline case fired at 1,200 ms and likewise waited for complete
  tree exit. The supplied real Harness regressions at
  `plugins/dsh-cortex/tests/local-subprocess-integration.test.mjs:181-220`
  independently pass both cases as well.
- Two simultaneous real provider searches against the indexed Cortex and
  `data-platform` roots returned only their distinct result sets. Cortex paths
  included `docs/agent-control/wo-057-deepseek-harness-session-provider.md`;
  data-platform paths were under `tests/collection_jobs/github_*`; neither set
  contained the other's expected paths.
- Real Harness scoped registries prove same-name tool/skill visibility,
  subjectless-call denial, distinct result state, per-Agent teardown, and no
  host-global Cortex tool. Agent and bundle disposal clear registrations and
  retained readiness state.
- `required: true` performs only one Agent's read-only `rules` readiness check,
  caches only successful readiness in a `WeakSet`, and cannot veto another
  Agent or process activation. It performs no proactive retrieval.
- The five packaged skills are byte-identical to their canonical
  `plugins/cortex/skills/` sources and match every manifest SHA-256.
- No explicit child environment, remote retrieval, telemetry, source upload,
  session export, automatic bootstrap/update/watch, persistent result cache,
  official MCP topology, or V2 pre-step retrieval was introduced.

## Validation commands and exact results

| Gate / command | Result |
|---|---|
| `node scripts/check-deepseek-harness-compatibility.mjs --checkout /private/tmp/cortex-wo057-harness-20260827` | PASS, exact HEAD and 18/18 files |
| Focused compatibility/provider/manifest/skill Node tests | PASS, 32/32 |
| `npm --prefix plugins/dsh-cortex test` | PASS, 6/6 (five real subprocess cases plus one scoped-registry case) |
| Independent leader-exit-0 + TERM-trapping descendant reproductions | PASS, 2/2: caller abort and provider deadline |
| Concurrent real indexed roots | PASS, 2/2 roots; no cross-result paths |
| Packed provider under macOS `deny network*` and `PATH=/nonexistent` | PASS, 4/4 commands (`search`, `related`, `impact`, `rules`) |
| Root `npm test` | PASS: context regressions 81/81, root Node TAP 403/403, Harness plugin TAP 6/6; total 490 pass, 0 fail |
| `npm --prefix scaffold/mcp test` | PASS, 426/426 |
| `node scripts/sync-release-version.mjs --check` | PASS |
| `git diff --check` | PASS |
| Bundle plus two profile dependency/list/frozen-lock closures | PASS, 3/3; no invalid or peer report |
| Dependency audit: root, frontend, MCP, both parser trees, bundle | PASS, 6/6 trees; 0 vulnerabilities |
| Two fresh `npm pack --json` runs | PASS, 2/2 identical artifacts |
| Fresh pinned headless/Web install and source-link-to-tarball upgrade | PASS, install 2/2 and upgrade 2/2 |
| Pinned profile config, smoke, shutdown, and removal | PASS: 3 Cortex rows/profile; headless help 1/1; Web HTTP 200 1/1; port closed after interrupt 1/1; removal 2/2 with 0 rows |
| `npm view @danielblomma/dsh-cortex@2.5.2 version --json` | Expected E404; package is not published |

One initial profile-management invocation reported that `pnpm` was absent from
PATH. A temporary Corepack-managed pnpm shim was added inside the disposable
review directory and every lifecycle gate was then rerun successfully. This
was reviewer environment setup, not a candidate or gate failure.

## Packed artifact and pinned Harness lifecycle

- Filename: `danielblomma-dsh-cortex-2.5.2.tgz`
- Review pack directory: `/private/tmp/cortex-wo058-rereview.j59sjU`
- Entry count: 12, exactly the declared runtime set. No tests, lockfile,
  source checkout, cache, control document, or environment file ships.
- Packed size: 10,211 bytes
- Unpacked size: 36,348 bytes
- SHA-1: `731a55355db2980e2f0d9c7b659f7bbf136f5620`
- SHA-256: `d7be11a964d6aa4562fac22a3a944e1919a0b46652f3f1a2dc732dde96c90beb`
- npm integrity:
  `sha512-VbGFcxI53e/f10PgYPeXwwepWhm4B094g6PNr4Fp8J3vjTQOmv2GPRGnJ77sTWkRx7Xibdt0jOtpmwOQfsKSBQ==`
- A second fresh pack in
  `/private/tmp/cortex-wo058-second-pack.tZUPXe` reproduced the same sizes,
  entry count, SHA-1, SHA-256, and integrity.

Packed entries were `package.json`, `cordis.patch.yml`, `provider.mjs`,
`protocol.mjs`, `tools.mjs`, `skills.mjs`, `skills-manifest.json`, and the five
declared skill files.

On pinned Harness `b150a551...`, disposable headless and Web profiles:

1. Installed the tarball with exact dependency closure and no peer warning.
2. Composed exactly three Cortex rows: `cortex-context`, `cortex-tools`, and
   `cortex-skills`.
3. Re-adding the packed artifact remained clean. A separate fresh profile pair
   transitioned from `link:<candidate>/plugins/dsh-cortex` to
   `file:<review-pack>/danielblomma-dsh-cortex-2.5.2.tgz`; frozen installs and
   both post-upgrade three-row configs passed.
4. Loaded headless help. Web bound `http://127.0.0.1:56610`, returned HTTP 200
   with a 14,522-byte HTML body, stopped on controlled interrupt, and refused a
   subsequent connection because the port was closed.
5. Executed the provider from the packed profile with network access denied and
   `PATH=/nonexistent`. Its resolved entry was the profile-owned
   `node_modules/@danielblomma/cortex-mcp/bin/cortex.mjs`, and all four commands
   returned validated success envelopes.
6. Removal from both profile pairs deleted the dependency/bundle entries and
   left zero Cortex config rows.

## Residual risks and R20

- The complete lifecycle was reproduced on macOS. Windows was not executed in
  this review; the pinned Harness seam nevertheless specifies tree-scoped
  Windows termination, and the corrected provider logic is platform-neutral.
- The candidate remains intentionally dirty and unpublished. Fresh-manager
  acceptance must consume this exact status and the artifact hashes above.
- V1 is explicit, per-call local retrieval. Proactive retrieval, answer-level
  experiments, update/watch/bootstrap behavior, and official MCP integration
  remain unimplemented and outside this acceptance.

**R20 may close locally.** Exact Agent/workspace isolation, complete-child-tree
termination and waiting, bounded local execution, scoped teardown, and packed
headless/Web lifecycle all have independent passing evidence.

## Final decision

**GO.** All six reviewer roles return GO with findings `none`. The corrected
candidate is ready for fresh-manager acceptance. This review does not authorize
merge, PR publication, npm publication, tag/release creation, README status
promotion, or V2 work.
