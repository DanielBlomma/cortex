# WO-C Final Review Remediation

## Objective

Close the single independent comprehensive final review's NO-GO on the frozen
WO-C candidate. This packet is additive to and governed by packet 051. Work
only in `/Users/danielnilsson/GIT/cortex-wo-c-2.5.2` on accepted base
`482f196`. Preserve accepted WO-A/WO-B bytes, package version 2.5.2, and all
dependencies and lockfiles. No commit, push, merge, release, publish, deploy,
acceptance, WO-D, or additional broad review is authorized.

## Exact Review Majors

1. Bind and recheck the complete Git transaction: resolved real git-dir,
   index, and HEAD; canonical staged, unstaged, and non-ignored-untracked
   discovery; diff bytes; and all candidate path identities/bytes before
   output. Fail on any delta. Add tests for an omitted path appearing after
   discovery, another path changing after its read, index-only mutation,
   untracked add/remove, and linked-worktree gitdir races.
2. Resolve the changed file/subsystem and exact graph applicability before
   choosing the closest profile. Authority applies only when an exact active
   source-of-truth Rule/ADR applies to that candidate. `feature_graph` applies
   only for an exact graph connection. Never treat any profile's nonempty
   `related_subsystems` as global relevance. Add independent-module,
   repository-fallback, and live-checkout regressions and prevent false
   deterministic findings.
3. Validate every selected canonical profile and every output-affecting live
   backing/identity before use, and recheck them before output even when there
   are zero findings or conflicts. Reject stale source, chunk, module, project,
   path, and profile identities.
4. Make the schema recursively closed and canonical without `String`
   coercions: exact types for every optional, status, tier, and context field;
   canonical unique conflict claims/evidence/order; all cross-field
   invariants; and a coherently rehashed tamper matrix.
5. Replace the results record's summary-only reproduction with literal,
   placeholder-free fail-closed commands for the exact config patch/restore,
   current output-path pattern loop and digests, normal update, configured
   checksum/path set, complete manifests/profile/context/backing validator,
   accepted-base runner and hashes, exact 18-state snapshot/replay,
   doctor/watch/status, and diff checks. Rerun the complete frozen evidence
   sequence after the last covered edit.

## Validation and Handoff

Run build and targeted pure/runtime/root tests, then proportional full gates.
After the last covered edit, rerun expanded pattern evidence for every current
output path, restore normal config byte-for-byte, perform the final normal
update and complete backing validation, accepted-base comparisons, exact
18-state replay, doctor/watch/status, and diff checks. Update the WO-C results,
manager log, and handoff ledger with literal commands, exact counts/hashes,
residuals, and the remediation-owner disposition. Return the frozen candidate
to the same single reviewer for narrow delta verification only. Only the
manager may accept WO-C or unblock WO-D.
