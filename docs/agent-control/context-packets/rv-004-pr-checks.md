# WO-RV-004: Pull Request Checks and Test Inventory

Status: Planned; starts after accepted WO-RV-001; final gate needs WO-RV-003.
Requirement: REQ-RV-1. Owner: Release and Distribution + Validation.
Profile: Infra/deploy/security-sensitive — untrusted PR execution and release gates.
Packet review: `/root/wo050_review` (Code Quality + Security), `/root` (Validation).
Implementation panel: independent Security/Privacy, Ops/Release, Validation, and
Control Manager; add Code Quality for test/helpers and Integration for shared files.
Manager names actual fresh-session assignees before implementation.

## Baseline and read first

- [Program](../2026-09-08-reliability-and-agent-value-plan.md),
  [baseline packet](rv-001-baseline-reconciliation.md),
  [workflow](../workflow-playbook.md), [review](../review-iteration-protocol.md),
  [handoff](../handoff-ledger.md), and [risks](../risk-register.md).
- Main `b7d466fa474dfa97fb77a931a674080801e6fa77`, package `2.7.0`;
  refresh identity after WO-RV-003 integrates. Use a fresh isolated checkout;
  never reset/merge/install in the user's checkout 123 commits behind main.
- Read `package.json`, runtime/bundle package scripts, all four current
  `.github/workflows/*.yml`, `tests/release-workflows.test.mjs`,
  `tests/release-fresh-checkout.test.mjs`, `scripts/release-fresh-checkout.mjs`,
  `scripts/release-artifacts.mjs`, and `scripts/sync-release-version.mjs`.
- All four workflows currently lack `pull_request`. Main's root tests already
  include DSH tests; release context preparation and packed gates already exist.
- 2026-09-08 baseline: `node --test tests/release-workflows.test.mjs` reports
  6 pass/7 fail of 13. Expectations include obsolete 2.5.2 metadata, missing
  fresh-checkout steps, forbidden bundle registry helpers, and absent Setup .NET
  mutation insertion points. Reconcile each with released contracts/security
  intent; this is neither a license to skip tests nor proof every assertion is right.

## Owned surfaces and integration order

Own a PR workflow, test-lane/inventory helpers under `scripts/`, root/runtime/bundle
package scripts, focused workflow/inventory tests, and concise CI documentation.
Release workflow edits are restricted to necessary validation/contract repairs;
do not bump versions, dispatch publication, or redesign artifact distribution.
Read released source/history to distinguish stale tests from missing safeguards.
Preserve immutable annotated-tag identity, exact root/bundle artifact integrity,
safe registry resume, OIDC provenance, secret-free auth, and version synchronization.
Keep live benchmark/Pages deployment out of PR jobs.

WO-RV-003 owns manifest dependency/override entries and all lockfile remediation.
Integrate that work first, then apply script changes on its accepted revision;
do not overwrite overrides or regenerate locks solely to merge scripts.
WO-RV-002 owns freshness source/tests; inventory must classify its additions.
Manager records exact shared-file ownership and order before parallel work starts.

## Tasks and bounded acceptance

1. Inventory executable tests from root, runtime, and bundle, including custom
   runners and packed/clean-install fixtures. Assign every test to fast or named
   integration lanes. Fail when a new executable test has no lane or an exclusion
   lacks an explicit reason/owner. Do not assume all tests use `node --test`.
2. Run root/runtime core checks on ordinary and fork PRs with read-only permissions,
   no secrets or privileged `pull_request_target` execution. Use supported Node
   and explicit native/parser prerequisites; configure timeout/concurrency limits.
3. Run optional-tool/slow integration fixtures in named jobs with visible reasons
   for genuine unavailable prerequisites; required failures propagate. No blanket
   `continue-on-error`, silent `|| true`, or path filter that omits core changes.
4. Reuse release context preparation and packed containment gates. Repair brittle
   release assertions while keeping executable failure/ordering/authentication
   tests, including negative cases for missing gates and mismatched artifacts.
5. Include all six committed dependency trees in audit enforcement at low-or-higher.
   Inspect branch protection/rulesets read-only; report actual required-check names
   and missing configuration separately. Workflow presence is not branch protection.

## Validation and handoff

Run Cortex search/rules before changes and pattern evidence for each changed file.
Focused baseline and candidate commands, from the isolated candidate root:

```bash
node --test tests/release-workflows.test.mjs tests/release-fresh-checkout.test.mjs tests/release-harness-identity.test.mjs tests/plugin-manifests.test.mjs
npm run release:check-version-sync
npm run audit:dependencies
npm audit --package-lock-only --audit-level=low --prefix plugins/dsh-cortex
git diff --check
```

Add and run a test-inventory regression proving an unassigned new test fails.
Exercise the exact new CI commands on a fresh disposable checkout; record context
preparation, dependency installation, native tools, test counts, and every skip.
Run `release:test-fresh-checkout` only in its own clean disposable fixture; inspect
its hardcoded totals and reconcile current inventory without weakening completeness.
Required full root/runtime/bundle, frontend build, audit, and packed containment
gates run once at acceptance, with CI authoritative when available.
No unresolved release-contract failures may be hidden in a green required check.
Log review closure, CI evidence, branch-protection limitations, integration order,
and residual risks. No live agent benchmark, release dispatch, or publication.
