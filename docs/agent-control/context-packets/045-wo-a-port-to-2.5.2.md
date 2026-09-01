# WO-A Port To Cortex 2.5.2

## Objective

Port the reviewed WO-A repository-conventions implementation from the stale
2.4.2 worktree onto current `origin/main` / Cortex 2.5.2, preserving every
2.5.2 behavior and closing the two final packet-044 fixes. Return a cleanly
validated 2.5.2 WO-A tree for fresh five-role review. Do not start WO-B.

## Durable Starting State

- Target worktree: `/Users/danielnilsson/GIT/cortex-wo-a-2.5.2`.
- Target branch: `feature/wo-a-repo-conventions-2.5.2`.
- Target baseline: `origin/main` at
  `1cbb4f0522db9114be25ce6b779ae30b0c8b2b06`, package version `2.5.2`.
- Source/evidence worktree:
  `/Users/danielnilsson/GIT/cortex-wo-a`, based on stale commit
  `9f403762f373b379eb2597c7598c4848508b717f` / package `2.4.2`.
- The source tree is read-only port input. Do not run its lifecycle commands or
  modify it. Its packet 044 source/tests contain the latest two targeted fixes.
- The target was initialized only with its checkout-local 2.5.2 CLI. Init-only
  `.gitignore` and generated architecture side effects were removed; target
  tracked/untracked status was clean before this packet.
- Global `/opt/homebrew/bin/cortex` is stale 2.4.1 and must never be used.
  Invoke only `node bin/cortex.mjs` from the target checkout.
- No commit, merge, rebase, tag, publish, release, deploy, or WO-B work.

## Required Context

- User-provided repository `AGENTS.md` instructions remain governing even
  though current main does not track a root `AGENTS.md`.
- Read `scaffold/AGENTS.md` before scaffold changes.
- Read this packet completely, then the complete target baseline diff/status.
- Read source packets 037–044 and results from the source worktree as absolute
  direct references, especially:
  - `/Users/danielnilsson/GIT/cortex-wo-a/docs/agent-control/context-packets/037-wo-a-independent-review.md`
  - `/Users/danielnilsson/GIT/cortex-wo-a/docs/agent-control/context-packets/043-wo-a-final-review-remediation.md`
  - `/Users/danielnilsson/GIT/cortex-wo-a/docs/agent-control/context-packets/044-wo-a-cap-hash-visible-text-remediation.md`
  - `/Users/danielnilsson/GIT/cortex-wo-a/docs/agent-control/wo-a-repo-local-conventions-results.md`
  - `/Users/danielnilsson/GIT/cortex-wo-a/docs/repository-conventions.md`
- Read current 2.5.2 program/control references that govern progressive
  indexing, containment, retrieval, release state, ownership, and lifecycle:
  - `docs/agent-control/context-packets/035-progressive-background-indexing.md`
  - `docs/agent-control/context-packets/036-two-pass-subsystem-retrieval.md`
  - `docs/agent-control/wo046-progressive-background-indexing-results.md`
  - `docs/agent-control/wo047-two-pass-subsystem-retrieval-results.md`
  - `docs/agent-control/wo-035-integrated-filesystem-containment-acceptance-baseline.md`
  - current manager log, handoff ledger, ownership manifests, CLI/query,
    lifecycle scripts, package manifests/locks, tests, and complete diff from
    the old baseline to target baseline for every touched path.

## Port Requirements

1. Do not copy tracked files wholesale where 2.5.2 changed them. Reapply the
   semantic WO-A delta to current code, preserving progressive update/watch,
   containment, two-pass retrieval, 2.5.2 CLI/help/release metadata, and current
   ownership inventory.
2. Port the final convention engine, types, query command, root CLI shim,
   scaffold build inventory, lifecycle ordering, generated convention scripts,
   ownership entries, tests, public docs, and dependency remediation only where
   current 2.5.2 still needs it.
3. Reconcile dependency manifests/locks against 2.5.2. Do not downgrade or
   replace already-fixed packages; retain current direct/override structure and
   require zero vulnerabilities on all four audited surfaces.
4. Preserve 2.5.2 version `2.5.2` everywhere. Do not alter release metadata.
5. Include the packet-044 final fixes:
   - `source_hash` covers all output-affecting cap/diagnostic dependencies,
     including reusable relation and related-subsystem 20↔21 transitions;
   - common visible-text validation rejects Unicode `Zl`/`Zp`, including
     U+2028/U+2029, before JSON/text output or persistence.
6. Preserve every previously reviewed WO-A boundary: active/source-of-truth
   eligibility, canonical paths, exact capped provenance, endpoint/live
   backing, warning/error privacy, bounded controls, strict legacy migration
   with stale cleanup, stable persisted reads, full dependency closure,
   caller/test omissions, one canonical traversal, deterministic bounded public
   envelopes, and no WO-B guidance design.
7. Create a 2.5.2-specific durable results record. Update current 2.5.2 manager
   log/handoff minimally; do not import or overwrite stale 2.4.2 control history.

## Validation

- Start with build and targeted port/packet-044 tests, then pure/focused.
- Run full MCP, context regressions, full root, frontend build, and current
  dependency audits.
- Exercise 2.5.2 managed init/bootstrap/update/watch lifecycle in target/temp
  boundaries using only checkout-local CLI. Prove progressive/background and
  containment regressions remain green.
- Prove scaffold/runtime source/dist/package/lock/marker parity, deterministic
  live conventions output, manifest/profile validation, legacy migration/stale
  cleanup, and no warning/control/source leakage.
- Finalize all covered source/tests/docs/control first. Then run exact expanded
  pattern evidence, restore normal config byte-for-byte, run the final normal
  update strictly after the last covered edit, reconcile every indexed checksum,
  validate manifest/profiles, doctor/watch/diff/status, and do not edit covered
  files afterward.
- Report exact port conflicts/resolutions, file/accounting list, test totals,
  hashes, residuals, and scope. Fresh five-role review is mandatory; only the
  manager may accept WO-A and only then may WO-B start.
