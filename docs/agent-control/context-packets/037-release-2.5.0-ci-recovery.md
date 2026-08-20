# Release 2.5.0 CI Recovery

## Work Profile

Infra/deploy/security-sensitive — this is a release recovery that changes a
filesystem containment boundary and resumes tag/publish workflows. Required
reviewers: Security and Privacy/Contract (`wo047_security_contract_review`),
Code Quality/Integration (`wo047_code_integration_review`), and
Validation/Ops/Release (`wo047_validation_release_review`), with the Control
Manager making the final acceptance decision.

## Objective

Recover the authorized `2.5.0` release after Release Bump run `32393046529`
failed before commit, tag, or publication. Fix only the two filesystem-boundary
regressions exposed by Linux after the minor version bump, validate them, and
resume the existing tag-gated release sequence.

## Starting Point

- Branch: `release/2.5.0-recovery`
- Base: `origin/main` at merge commit
  `f2a6e6c22d178e37b5ffda6f70442c4e4be99dcd`
- Failed workflow: `https://github.com/DanielBlomma/cortex/actions/runs/32393046529`
- No release commit, `v2.5.0` tag, npm publication, or partial release mutation
  was produced by the failed run.

## Included Scope

- Strengthen managed filesystem snapshots so same-path inode reuse cannot make
  a removed and recreated staging file appear unchanged.
- Make dashboard version-cache hits revalidate the managed npm-cache path
  before returning cached version data.
- Add deterministic regression coverage for both conditions in the existing
  filesystem-boundary suite.
- Update the WO-048 durable release-recovery record, open and merge one narrow
  recovery PR, then rerun the authorized minor Release Bump and tag-gated
  Publish workflows.

## Exclusions

- No progressive indexing, retrieval, ranking, package inventory, dependency,
  or Angular evidence behavior changes.
- No change to the accepted `2.5.0` public feature set or migration notes.
- Do not touch the original dirty worktree or its excluded WO-036 through
  WO-045 experiments.

## Acceptance

- The Linux-reproduced stage replacement is rejected as `path_replaced` even
  if the filesystem reuses the same `dev` and `ino`.
- Both root and packaged dashboards call `npmCachePath()` and propagate its
  policy error on a warm version-cache hit.
- Focused boundary tests, full root/MCP release gates, version sync, audits,
  package containment, and diff checks pass.
- Independent review reports no unresolved blocker, major, or minor finding.
- Release Bump creates `v2.5.0`; Publish succeeds from that tag; npm `latest`
  resolves to `2.5.0` before cleanup.

## First-Pass Review Intake

- Exact ten-path changed scope: canonical
  `scaffold/scripts/lib/ingest/filesystem-boundary.mjs`, both dashboard mirrors,
  `tests/ingest-filesystem-boundary.test.mjs`, this packet, and the
  work-order/handoff/manager/risk/acceptance control records.
- Implemented result: file and stage snapshots add `ctimeNs`; directory
  snapshots intentionally remain `dev`/`ino` because child creation changes
  directory ctime. Stage validation and owned cleanup require the captured
  ctime. Both dashboards validate `npmCachePath()` before a version-cache hit.
- Regression result: macOS boundary 41/41; clean Linux Node 22 container 2/2
  for same-inode stage rebinding and warm-cache dashboard denial; root 81/81 +
  386/386; sequential MCP 426/426; frontend build 2,267 modules; five audits
  zero; packed containment 420 entries at 399/21 modes with inventory digest
  `cebf97a2b13ef48733d79b97b0c7785d3152915e0b5ab6706190a836e38b48bd`;
  syntax, version-sync, and diff checks pass.
- Risks: the already documented trusted-same-user validation-to-syscall
  interval remains; this fix prevents the observed same-inode false identity
  but does not claim kernel-atomic path ownership. Root and MCP full suites
  must run sequentially because root fixtures temporarily manipulate scaffold
  state, matching the release workflow order.
- Open decisions for reviewers: confirm `ctimeNs` portability under Node
  `>=20.9.0`, ordinary dashboard version fallback compatibility, and that no
  Angular rerun is required because none of the frozen report's 14 source
  bindings changed.
