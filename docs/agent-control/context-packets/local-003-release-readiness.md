# WO-LOCAL-003: release readiness and next minor publication

Fresh-session handoff, 2026-09-10. Profile: Infra/deploy/security-sensitive.

## Current user authority

After reviewed Git-ignore PR #130 was left unmerged because ten baseline release
contract tests failed, user said: “vi vill ju göra en ny relese bump och uppdatera
 den” (we want to do a new release bump and update it). This authorizes working
through necessary release-readiness fixes, reviewed merge, release bump and
publication. Earlier local-001/002 no-release/no-baseline-remediation scope limits
are superseded for this release objective. No gate waiver, unrelated feature,
search experiment or broad indexing/provider run is authorized. Prefer the
existing next-minor workflow, 2.7.0 → 2.8.0, subject to fresh registry/tag checks.
Optional user clarification about also updating global CLI is pending; publication
is not dependent on that optional local installation choice.

## Fresh manager and isolation

This packet is intended for a fresh manager agent with zero inherited chat.
Create your own isolated clone/worktree. Do not write into the original historical
checkout `/Users/danielnilsson/GIT/cortex`, nor the reviewed candidate copy unless
coordinating an explicit final integration. Source candidate:
`/private/tmp/cortex-gitignore.vRkBH9/repo`, clean branch
`fix/root-gitignore-discovery`, head `3c5d4da028f169255c14fb8230392c922cc5b12a`.
Origin `https://github.com/DanielBlomma/cortex.git`; PR
https://github.com/DanielBlomma/cortex/pull/130 is draft/open, infra-sensitive.
Main remains `37a511fa76ce04804f6cf4497202966dd78ff1f0` as last checked.
No checks or Actions runs on this PR; conflict-free is not full validation.

Read workflow-playbook.md, review-iteration-protocol.md, scaffold/AGENTS.md and
local-002-gitignore-review.md from candidate. Follow required fresh-agent review
assignment before implementation. Reviewer agents may be spawned as required by
these protocols; maximum total running agents is four including coordinating root.
Root's old manager session only relays user messages and performs read-only
external-state/local-installation clarification; fresh agent manages this order.
Keep this work bounded, record durable state before approaching compaction.

## Direct sources and known blockers

- `.github/workflows/release-bump.yml`: inputs only minor; currently hardcodes
  BASE_VERSION 2.6.0, RELEASE_VERSION 2.7.0, RELEASE_TAG v2.7.0. Last release succeeded;
  rerunning unmodified now fails current version/tag checks. Preserve immutable
  tag/main guards, complete metadata staging, root/bundle integrity and OIDC.
- `.github/workflows/release-publish.yml`: tag-only, exact artifact publication,
  safe registry resume. Inspect actual validation ordering; no weaken/skip fixes.
- `tests/release-workflows.test.mjs`, `tests/plugin-manifests.test.mjs`,
  `tests/release-fresh-checkout.test.mjs`, `tests/release-harness-identity.test.mjs`,
  `scripts/release-fresh-checkout.mjs`, `scripts/release-artifacts.mjs`,
  `scripts/sync-release-version.mjs`, root/runtime/bundle package.json.
- `context-packets/rv-004-pr-checks.md` contains relevant contract-repair guidance
  but not a mandate to expand this release into the entire CI/inventory program.
- Root test failures: three plugin-manifest expectations and seven workflow
  contracts, stale expected 2.5.2 vs actual2.7.0 plus missing gate/fixture names and
  changed registry-helper contracts. Distinguish obsolete assertions from genuinely
  missing safeguards using actual released contracts/history; do not simply delete
  failing tests. Exact names in local-002-gitignore-review.md.
- Locked MCP dependencies had 5 high/5 moderate audit findings on Sep10; GitHub
  push reports default branch 5 high/6 moderate. If required release audit fails,
  inspect concrete findings and scope compatible necessary remediation separately
  within this release objective; do not waive gates or blanket upgrade dependencies.

## Existing exact reviewed Git-ignore evidence

Local-002 report binds four source/test hashes. Independent Code/Contract/Security
and Ops/Integration reviews pass. Focused103/103; context81/81; root427/437 with same
10 baseline failures; Harness6/6; ownership17/17. Packed 465 entries,48 boundary,
3 characterization,4+4 dashboard,423/96 ownership,110changed/43new historical
upgrade. Preserve these fixes and exact package assertions.
Candidate built ignored runtime `.context/mcp` and `.context/scripts` can be copied
into isolated worktrees with Mac `cp -cR` to reuse locked deps (roughly1GB); full
validation tree `/private/tmp/cortex-local-assess.zTBH2P/repo` also has deps but
contains candidate files, not untouched main. Do not write others' trees.

## Cortex

Use repo skills at plugins/cortex/skills/{using-cortex,change-impact,pattern-review,
context-review}/SKILL.md. Installed global CLI2.4.1 is old; use current
`node bin/cortex.mjs ...`. Candidate index only ingests direct sources/tests/control
files, so release sources are not indexed yet; refresh scoped lexical/graph context
in YOUR ignored runtime. Ordinary cortex update invokes embeddings unconditionally;
run its ingest+graph steps separately under the no-provider boundary. Restore any
tracked .context/config.yaml after temporary scoped config. No background Git
hooks: `git -c core.hooksPath=/dev/null ...` for mutations.

## Outcomes

1. Fresh evidence-backed classification of ten failures and minimal safe fixes,
   plus reusable/up-to-date release bump for next2.8.0.
2. Required independent review, meaningful negative workflow tests, full applicable
   root/runtime/bundle/package/build/audit validation. Record exact limitations.
3. Durable manager/handoff/matrix/risk/PR updates with current user release authority.
   Prefer updating PR130's concrete scope if lower-risk than a stack; reviewers and
   root must know which exact head is being pushed. Never merge bypassing failures.
4. When all required gates pass, ready+merge reviewed PR(s), dispatch Release Bump
   on main using established minor input, monitor Bump+Publish, inspect actual tag,
   package metadata/registry integrity and clean-install smoke. User authorization
   is provided above; no repeated permission question for these necessary steps.
5. If an external approval or genuinely unresolved blocker prevents publication,
   leave exact durable state and report action/reason. No claims of a release based
   only on dispatch success. No global CLI install until optional preference known.

## Subsequent authority clarification
User explicitly chose “Ja, uppdatera lokal CLI också”: after successful2.8 publication, root may update the existing global CLI installation under /opt/homebrew. Do not install a nonexistent/unverified release or change a different npm prefix. Publication remains gated by audits and complete validation.
