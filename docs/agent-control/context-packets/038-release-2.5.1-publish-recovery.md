# Release 2.5.1 Publish Recovery

## Work Profile

Infra/deploy/security-sensitive — this fixes a cross-Node release-gate failure
after `v2.5.0` was created but before npm publication. Required reviewers:
Security/Contract (`wo047_security_contract_review`), Code/Integration
(`wo047_code_integration_review`), and Validation/Ops/Release
(`wo047_validation_release_review`), with Control Manager acceptance.

## Objective

Make the packed-artifact harness accept the documented successful summary from
both Node 22 and Node 24, preserve every actual containment assertion, and ship
the already accepted 2.5 feature set as patch release `2.5.1` without moving or
reusing the immutable, unpublished `v2.5.0` tag.

## Starting Point

- Branch: `release/2.5.1-recovery`
- Base: `origin/main` release commit `4887baa1a3fe6e35f3a876cd17132a2980ada388`
- Immutable tag: `v2.5.0` points to that release commit.
- Failed Publish run: `32395455646`; tag/metadata, root, MCP, and audits passed.
  The installed boundary itself passed 41/41, but the harness expected Node 22
  TAP text `# pass 41` while Node 24 emitted `ℹ pass 41`. npm publish was skipped.
- npm `latest` remains `2.4.2`; `2.5.0` is not published.

## Scope

- Replace reporter-symbol-specific packed-harness assertions with one bounded
  summary matcher that accepts Node's TAP and spec summary prefixes while
  requiring the exact pass count and zero failures.
- Validate the complete packed harness on Node 22 and Node 24.
- Record the unpublished 2.5.0 tag and patch-release recovery in changelog and
  control records.
- Open/merge one narrow PR, dispatch Release Bump with `patch`, then verify the
  tag-gated Publish run and npm `latest=2.5.1`.

## Exclusions

- No runtime, containment, dependency, progressive-indexing, Angular evidence,
  package-inventory, or public feature behavior changes.
- Do not delete, move, or retag `v2.5.0`.
- Do not manually publish or bypass the tag-gated workflow.

## First-Pass Intake

- Exact candidate scope: eight paths — this packet, `CHANGELOG.md`, the packed
  containment harness, and the acceptance/work-order/handoff/manager/risk
  control records.
- Implementation: `assertNodeTestSummary()` accepts only line-start `#` or `ℹ`
  summary markers, still requires the exact expected pass total, and still
  requires zero failures. All eight former literal summary assertions use it.
- Node 22 full packed harness: 420 entries, modes 399/21, inventory SHA-256
  `cebf97a2b13ef48733d79b97b0c7785d3152915e0b5ab6706190a836e38b48bd`,
  installed boundary 41/41, characterization 3/3, development and installed
  dashboards 4/4 each, ownership 385/94, upgrade 38 changed/five new.
- Node 24.19.0 reproduced the same complete result as the non-root workflow
  user. A root-container diagnostic was intentionally superseded because root
  bypasses the unreadable-file fixtures; it was not a candidate failure.
- Syntax, release version synchronization, and `git diff --check` pass. No
  runtime, package inventory, dependency, workflow, or frozen Angular binding
  changed.
- Cortex pattern evidence, refresh, and watch status were attempted from the
  clean recovery worktree. The installed 2.4.1 CLI cannot operate on the
  candidate scaffold without a mutating init/bootstrap, so all three stopped
  before mutation; no workaround was used for this harness/docs-only patch.
- Review intake is read-only. Open decision: ship only after all three named
  reviewers return GO; preserve `v2.5.0` and use the normal patch Release Bump
  plus tag-gated Publish path for `v2.5.1`.

## Acceptance

- Node 22 and Node 24 both pass the full packed containment harness with the
  exact 420-entry inventory and installed 41/3/4/4 test totals.
- All independent reviewers return GO without unresolved blocker/major/minor.
- A new patch Release Bump creates immutable `v2.5.1`; tag-gated Publish passes;
  npm `latest` and the installed package report `2.5.1`.

## Independent Review

- Security/Contract: GO; zero blocker, major, minor, or note findings.
- Code/Integration: GO after correcting two control-record phrases from
  package-content to package-inventory; zero remaining findings.
- Validation/Ops/Release: GO; zero blocker, major, minor, or note findings.
- All three independently confirmed the eight-path scope, bounded positive and
  negative matcher behavior, immutable unpublished `v2.5.0`, and the normal
  patch-bump/tag-gated `v2.5.1` recovery sequence.
