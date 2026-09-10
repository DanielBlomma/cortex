# WO-LOCAL-003 independent Security / Contract / Code Quality review

Reviewer: `/root/release_manager/security_contract`, assigned before implementation.
Date: 2026-09-10. Isolated checkout: `/private/tmp/cortex-security-review.xHZN71/repo`.
Baseline: `3c5d4da028f169255c14fb8230392c922cc5b12a`.
No implementation edits, provider calls, embeddings or background hooks.
Candidate review is pending owner intake; this is not acceptance.

## Baseline findings

- Severity: blocker. Area: validation/security. Both release workflows omit actual root/runtime/fresh-checkout/audit/packed/Harness gates before tag or publication. The prior implementation at `477f17e^` provides direct restoration evidence. Restore executable fail-closed gates while retaining current exact dual-package registry integrity and dependency checks.
- Severity: major. Area: validation/contract. Baseline focused tests reproduce all ten known failures. The hardcoded 2.5.2 version and prohibitions on all bundle registry operations are obsolete relative to released dual-package implementation. Replace with synchronized current-version checks and exact dual-publish safety assertions; do not remove meaningful constraints.
- Severity: major. Area: validation. Several mutation regressions fail on absent baseline gates or insertion points, rather than the intended mutation. Require the baseline validator to pass and prove mutations changed input before asserting targeted failures.
- Severity: note. Area: security. Existing strict tag/ref-type guard, annotated-tag/HEAD binding, exact metadata, atomic push, OIDC provenance, missing-only publish, root-before-bundle, exact registry name/version/integrity/dependency/latest checks are present and should be preserved. `registryStateCommand`, `scripts/release-artifacts.mjs:705-724` is the direct helper contract.

Command: `node --test tests/release-workflows.test.mjs tests/plugin-manifests.test.mjs`.
Raw evidence: `/private/tmp/cortex-security-review.xHZN71/baseline.log`.

## Dependency findings

Fresh `npm audit --package-lock-only --json --prefix scaffold/mcp` fails with
5 high / 6 moderate findings. Raw JSON:
`/private/tmp/cortex-security-review.xHZN71/audit-mcp.json`.

Compatible published patch paths exist for js-yaml 4.3.2, fast-uri 3.1.6,
hono 4.13.5, qs 6.16.0, and sharp 0.35.4. Sharp's Node >=20.9.0 floor matches
the runtime package and its current override already permits the 0.35 patch line.

Severity: blocker. Area: security/audit. adm-zip latest is 0.6.0 and registry
version inventory contains no newer release. The
[reviewed advisory](https://github.com/advisories/GHSA-vwc7-r8mq-g2x9)
reports affected 0.5.9 through 0.6.0, with no patched version. Destination
symlinks can redirect extraction writes outside the intended directory.
[Upstream fix PR 575](https://github.com/cthackers/adm-zip/pull/575) remains open.
Latest onnxruntime-node 1.29.0 still requires adm-zip ^0.6.0; latest
transformers 4.2.0 pins onnxruntime-node 1.24.3. Downgrading onnxruntime to
1.21.1 would remove adm-zip in favor of tar, but native runtime compatibility
across three minor versions is not established and is not a bounded patch.
Downgrading adm-zip below an advisory lower bound is not proof of safety.
No compatible published solution currently established; required low-level
audit gate remains blocked and must not be waived or hidden.

[Sharp advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) confirms
0.35.4 as the patched release. This fixes that finding only.

## Cortex evidence

Used repo using-cortex, pattern-review and context-review skills. Copied ignored
local runtime/cache, then scoped lexical ingest and graph-load to eight direct
release source/test refs, restoring tracked config afterwards. Search and rules
succeed; six active rules. Search identifies
`chunk:scripts/release-artifacts.mjs:registryStateCommand:705-724` and
`chunk:tests/release-workflows.test.mjs:validatePublishWorkflow:199-257`.
No embeddings exist; search reports lexical-only fallback explicitly.
Final candidate per-file pattern evidence and review remain pending.

## First candidate review

Snapshot reviewed from owner checkout `/private/tmp/cortex-release.JjNEyG/repo`
on 2026-09-10, before final immutable candidate commit. Seven implementation
files copied to the independent checkout. Core workflow/plugin tests: 24/24.

Actual restored workflow ordering and artifact routing are correct in this
snapshot: tests/build/audit/packed install/Harness precede tag or publish;
post-gate root and bundle integrity equal pre-gate seed integrity; publication
uses `steps.artifacts` outputs and validates root visibility before bundle
publication. OIDC, strict tags, complete metadata staging and atomic push remain.

Severity: major. Area: validation. Artifact pack and empty-cache install gates
are checked by name/order but absent from executable gate requirements. Replacing
either full Publish step body with `run: echo gate skipped` is accepted by
`validatePublishWorkflow`. Changing the Harness root artifact environment binding
to `/tmp/unreviewed.tgz` also passes. Required action: add actual pack/install
commands, fail-closed constraints, exact root+bundle env bindings for install and
Harness, seed-integrity binding assertions, and meaningful negative cases for
both workflows. Reproduction: `tests/.security-mutations.mjs` in independent
checkout (review-only, do not integrate).

Dependency manifest and lock diff stays in the requested remediation scope.
Sharp platform packages advance to 0.35.4/libvips1.3.3; qs ancillary packages and
frontend browserslist data follow compatible dependency resolution. Independent
candidate audit verifies 0 high / 3 moderate, exclusively adm-zip and its two
ancestors. This remains a release/merge blocker under the no-waiver rule.

Cortex: refreshed eleven direct source/lock/test refs via scoped ingest+graph,
restored config, all seven per-file pattern evidence calls succeed and rules
succeed. `review --diff --json` returns verbatim `INVALID_ARGS: Review failed
safely`; no pass is claimed for that combined command. The skill's documented
fallback (rules plus per-file pattern evidence) is complete. Candidate review is
not yet signed off pending mutation-test closure and final identity.

## Final independent review closure — 2eb9190

Reviewed commit: `2eb9190359a31a7db3237c00c48b185d840cf280`, fetched into the
reviewer's isolated checkout with Git hooks disabled. This section supersedes
pending candidate-review statements above.

Disposition: **APPROVE the blocked readiness patch for review**, covering
Security/Privacy, Contract and Code Quality. **NOT merge/release GO**. Required
full validation remains the manager/Ops gate, and the adm-zip audit blocker remains
open without waiver. No additional implementation blocker found in this patch.

The major artifact validation finding is closed. `validateArtifactGates` now
checks pack/install execution, fail-closed configuration, both root and bundle
environment and argument bindings for installed/Harness validation, expected
version, and both seed/reviewed integrity equalities. Independent rerun of all
three original reviewer mutations now rejects: omitted pack body, omitted
empty-cache install body, and a wrong Harness root artifact path. Candidate
negative cases also cover both workflows, both artifact identities, and both
seed-integrity bindings. Actual workflow gate ordering and dual immutable
publication routing remain sound.

Independent command:
`node --test tests/release-workflows.test.mjs tests/plugin-manifests.test.mjs tests/release-fresh-checkout.test.mjs tests/release-harness-identity.test.mjs`
Result: 42 tests total, 41 pass, zero fail, one Linux-only skip on macOS.
Log: `/private/tmp/cortex-security-review.xHZN71/final-focused.log`.
`git diff --check 3c5d4da` passes. Fresh-checkout helper changes retain exact
completeness checks and only advance observed counts to root437/MCP651; actual
full fixture execution is owned by Ops/manager and is not claimed here.
Dependency files match the independently audited first snapshot: 0 high / 3
moderate (adm-zip plus ancestors), so that evidence remains applicable.

Final Cortex limitations: scoped ingest/graph over all15 changed files plus2
artifact-helper refs; tracked config restored; no providers/embeddings/hooks.
Rules succeed. Pattern evidence succeeds for13/15 changed files after indexing
the control docs. The fresh-checkout helper and its test both fail verbatim
`INVALID_ARGS: aliases is not iterable`. Combined review fails verbatim
`INVALID_ARGS: Review failed safely`. These are tool limitations, not successful
policy checks, and were reported to the manager. Direct review of the two
count-only diffs and their executable regression tests is complete; no
architectural rule violation was identified. No claim of an all-green Cortex
review is made.

## Bounded Ops iteration closure — 31fc32e

Final reviewed commit advances to `31fc32e47f0a5e42d4dd08cdd150f803335e1719`.
**APPROVE blocked readiness patch for review** remains; this supersedes the
prior commit identity only, and still grants no merge/release GO.

Three-file delta reviewed: exact generated `scaffold/.context/mcp/` and
`scaffold/.context/scripts/` ignore entries; dual registry installation and
registry Harness smoke after both exact registry verification steps and before
summary; executable command/ordering negative cases. Existing helpers use exact
root and bundle version specs, empty dedicated npm caches/directories, and the
pinned Harness checkout. No provider or smoke invocation executed by reviewer.
No new security/contract/code-quality finding.

Independent `node --test tests/release-workflows.test.mjs tests/plugin-manifests.test.mjs`
passes24/24, zero skips. `git diff --check 2eb9190` passes. Unchanged dependency,
fresh-helper and prior artifact-mutation evidence applies. Cortex search/rules
and the two workflow/test pattern calls succeed. `.gitignore` pattern request
reports `INVALID_ARGS: Pattern target was not found in indexed context: .gitignore`;
its two explicit generated-directory additions were directly reviewed. All prior
Cortex tool limitations remain explicit, with no all-green combined-review claim.

## Later manager validation reconciliation
After this review, manager full root passed81/81context,437/437root,6/6bundle;
Ops independently passed651/651MCP on31fc32e; frontend build and packed
containment also passed. The earlier full-validation-pending wording is
superseded for those measured gates. No pristine2.8 full release fixture,
full packed/registry Harness lifecycle, Linux publication, or audit pass is
claimed. Audit remains3moderate nodes from the unpatchedadm-zipchain.
See local-003-release-readiness-review.md for the combined final disposition.
