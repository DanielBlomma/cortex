# WO-LOCAL-004 independent preflight Security / Contract review

Reviewer `/root/release_completion_manager/security_contract`, assigned before
implementation. Date 2026-09-11. Isolated clone
`/private/tmp/cortex-local-004-security.yviHNJ/repo`.
First candidate `c7b700e7166cecac3820ea92805d29625686a254`, delta from `98ad614`.
No remote writes or changes to other checkouts.

## First-pass findings

- Severity: major. Area: validation. Preflight validator accepts job-level
  `if: false` and `continue-on-error: true` inserted before `runs-on`, bypassing
  otherwise protected step-level gates. Actual workflow contains neither bypass;
  this is a fail-closed regression-validator gap. Independent mutation evidence:
  `../preflight-independent-mutations.log` has `rejected:false` for both.
  Required action: reject job-level skipping/failure suppression and add these
  two negative cases before reviewer sign-off.
- Severity: minor. Area: code quality. `git diff --check 98ad614..c7b700e` reports
  `.github/workflows/release-preflight.yml:187: new blank line at EOF.` Remove it
  in the same bounded iteration.

## Reviewed security and contract boundaries

Actual workflow is pull_request-to-main only, with contents:read and no job
permission override. Checkout uses the default PR merge candidate with credential
persistence disabled. No pull_request_target, secrets, write token, id-token
permission, environment credentials, staging/commit/tag/push/publish/dispatch
commands are introduced. Runtime is an ephemeral hosted Ubuntu runner rather
than self-hosted infrastructure. Untrusted PR content executes ordinary tests and
install scripts without a write credential. Existing pinned npm 11.19.1, Node 22,
.NET 8 and exact Harness commit are preserved.

Every executable validation step from Release Bump's Node setup through final
version/diff boundary check is copied exactly, excluding only Git author setup.
Order, expected 2.8 metadata, exact eight-file mutation check, artifact identity,
empty-cache install, Harness lifecycle, full root/MCP/fresh-checkout, audits,
packed containment and frontend remain. Existing Bump and Publish workflows
are unchanged. Preflight publication is absent; it supplies hosted evidence and
does not itself grant merge or release approval.

The new validator adds exact event/job/permission/checkout constraints and exact
step parity to existing executable-gate validators. Independent negative cases
successfully reject extra write permissions, explicit wrong checkout ref,
omitted artifact install body, wrong Harness bundle artifact binding, missing
MCP dependency install, missing frontend gate and an additional executable step.
Only the two job-level failures described above were accepted.

## Independent checks

Focused command: `node --test tests/release-workflows.test.mjs tests/plugin-manifests.test.mjs tests/release-fresh-checkout.test.mjs tests/release-harness-identity.test.mjs`.
Result: 42 total, 41 pass, zero fail, one Linux-only skip on macOS, ~5.1 seconds.
Raw log: `../preflight-focused.log`. No hosted CI pass is claimed.

Scoped Cortex lexical/graph refresh covers only the three workflows and workflow
test. Search/rules and both candidate per-file pattern evidence succeed; six active
rules. Configuration restored, no provider/embedding/broad index/hooks. Full
combined clean-tree review is not used as evidence for a committed diff.

## Iteration closure — 0b1d53c9efc821f1f7c1ee96b6ab4f1889ded0f4

Final disposition: APPROVE for coordinated draft-PR push and hosted preflight
execution. This is not merge or publication approval; hosted gates remain pending.

Both findings are closed. The validator now rejects job-level conditions and
continue-on-error. Independent re-execution of both original accepted mutations
now rejects them. The trailing EOF blank line is removed, and
`git diff --check 98ad614..0b1d53c` passes.

Ops's future-PR applicability refinement is accepted: preflight calculates the
next minor from the checked-out package using numeric major/minor values and
exports it through GITHUB_ENV before dependency installation. It does not modify
package files in that step. The existing metadata-bump step then asserts the
calculated version, keeping 2.7 -> 2.8 for this candidate while avoiding a
permanent preflight target after release. Bump/Publish's existing explicit target
and every copied validation gate body remain unchanged. The expected step-order
validator accounts for the one added calculation step. Independent mutations
reject a wrong increment and omitted environment output.

Exact-head independent focused rerun: 42 tests, 41 pass, zero fail, one Linux-only
skip on macOS, approximately 4.6 seconds. Fresh scoped Cortex ingest/graph,
rules and both changed-source pattern calls succeed. No additional security,
contract or code-quality finding. Logs: `../preflight-closure-focused.log` and
`../preflight-closure-mutations.log`. Earlier source-boundary review applies.
