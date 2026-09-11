# WO-LOCAL-001: selective Git-ignore port

Status update: independent review and iteration completed in WO-LOCAL-002.
The [final report](../local-002-gitignore-review.md) supersedes the original
frozen hashes and pending-review statements below. Merge remains blocked.

Continuation of the local-code integration assessment, authorized 2026-09-10.
Profile: Infra/deploy/security-sensitive (source discovery + Git error boundary).
Base: `37a511fa76ce04804f6cf4497202966dd78ff1f0`, main 2.7.0.
Owner: `/root/local_runtime_assess`; independent combined Code/Contract/Security,
Validation and Integration/Ops reviewer: `/root`, assigned before implementation.

Read workflow-playbook.md, review-iteration-protocol.md and the direct sources:
`scaffold/scripts/lib/ingest/files.mjs`, filesystem-boundary.mjs, pipeline-stages.mjs,
tests/ingest-filesystem-boundary.test.mjs, tests/ingest-units.test.mjs, package.json.
Original mixed checkout `/Users/danielnilsson/GIT/cortex` is read-only reference.

## Scope

Implement only root Git-ignore discovery and focused tests in existing test files.
Do not port old containment, package/ownership versions, search or benchmark code.
Use Cortex search/rules/impact before edits; direct main sources are authoritative.

## Contract

- Root scope `.` skips untracked Git-ignored paths, retains tracked files even
  if a new ignore rule matches, and retains normal untracked/nonignored files.
- Explicit non-root source selections keep their existing behavior, including
  intentional selection of an ignored file/directory. Mixed scopes must respect
  that override deterministically, independent of order.
- Both full and changed/fallback discovery must be coherent. Ignore-rule changes
  must not leave newly ignored old records in the published file inventory.
- Non-Git directories remain supported; genuine Git failures, malformed output,
  timeout and output bounds are distinguishable from a successful empty result.
  Never swallow policy errors or expose raw Git stderr/secrets in diagnostics.
- Bounded shell-free Git calls; pre/post root identity checks; no path confusion
  for spaces, newline, Unicode, quotes or literal POSIX backslashes. Preserve
  symlink/containment contracts and prevent ambient Git env from selecting another
  repository. Avoid per-file Git spawning or quadratic ignored-path matching.
- Keep the last published data intact if discovery fails. No heavyweight index,
  provider call, dependency upgrade, release or new feature is in scope.

## Gates and handoff

Focused positive/negative tests, current-main ingest/boundary/dashboard regression
checks, appropriate root/package gates, independent review and exact residuals.
Owner returns source/test diff, commands, results and limitations before commit.
Manager handles docs, PR and user-authorized merge only after acceptance; no
automatic release. Known unrelated release-workflow failures must stay explicit.
