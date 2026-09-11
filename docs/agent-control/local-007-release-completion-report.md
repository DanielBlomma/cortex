# WO-LOCAL-007 subprocess reaping and release completion

2026-09-11. Infra/deploy/security-sensitive. Fresh manager at c7ce1a9 and two
new independent reviewers assigned before implementation in isolated clones.
Root retains release authority and existing global CLI ownership.

## Deterministic diagnosis before implementation

Both independent reviewers run the actual pinned local subprocess runtime under
an owned Linux subreaper that withholds orphan waitpid. The original timeout
assertion fails at approximately 3.04 seconds: same PID/starttime/group changes
from executing S to zombie Z, kill(pid,0) still succeeds, waitpid then reports
SIGKILL9, and both ESRCH and absent /proc are proved. Ops PID8212/starttime20006511;
Security PID8262/starttime20009226. Each executes once, without retries or provider,
timeout/grace, fixture assertion or production dependency changes. The Linux x64
container is emulated; this establishes the general kernel-reaping race in the
actual pinned provider, not the historical native failure's unrecorded state or
native release success. Native34598916068 remains an unclassified assertion failure.
Raw evidence: local-007-ops-evidence/subreaper.log and subreaper.py;
local-007-security-evidence/independent-subreaper.log, beneath the disposable
reviewer evidence directories recorded in their reports.

Root's diagnostic clarification permits general deterministic Linux mechanism
proof; impossible retrospective state recovery is not a new acceptance condition.
Full unchanged native acceptance remains mandatory.

## First-pass bounded correction / review intake

Only plugins/dsh-cortex/tests/local-subprocess-integration.test.mjs changes code.
The two settled-leader tests capture positive descendant PID, Linux starttime,
process group and session while live and bind group/session to the actual spawned
leader handle. After the original CANCELED/TIMEOUT assertion, Linux must report
ESRCH immediately or the same identity in Z/X/x. Executing, unknown, malformed,
unreadable or reused records fail immediately. Only confirmed-dead records may
wait up to one second for ESRCH; every poll rechecks identity/dead state. An
ENOENT proc read requires a fresh successful ESRCH proof. Non-Linux retains the
original immediate ESRCH assertion. Cleanup checks Linux identity before signal,
never signals dead/reused/unknown records, and removes the fixture in finally.

Provider timeout2s, termination grace1s, runtime production, dependencies,
workflows, six-test declarations and all release counts remain unchanged. New
reaping bound applies after confirmed nonexecution, never to an executing child.
Open review: independently exercise bounded success, live/unknown/malformed/reused
and never-reaped negatives; check cleanup identity and temp removal. No source
acceptance or release GO yet.

## Review iteration — fixture setup failures

Security identified a major fix-now lifecycle issue before source acceptance:
new baseline assertions can fail before descendant identity assignment, leaving
the cancellation runner pending until its default timeout. Both settled fixtures
now observe pending rejection immediately; after-hook aborts the owned runner,
awaits its settlement, then performs identity cleanup and unconditional temp
removal. Timeout fixture uses its controller only for cleanup; its real2s timeout
assertion remains unchanged. Independent failure-path validation remains pending.

## WO-LOCAL-007 source acceptance

Accept bounded subprocess-test correction for coordinated draft/native preflight,
not merge/release approval. Exact test SHA256:
6d337c598caef11c5b9d3cdf2665379e04c91629a7ce3232d9cf35612041fac1.
Security closes baseline-failure cleanup finding;36 adversarial helper probes and
both real setup-failure paths reject/clean as required. Ops independently proves
controlled reap success and held-zombie bounded failure with actual pinned runtime.
Independent Linux/macOS settled2/2 and manager bundle6/6 pass. Manager scoped
Cortex review7paths returns zero findings/conflicts; six rules and all per-file
patterns succeed. Full native final-head release gates remain mandatory.
See local-007-release-completion-report.md and the two independent review reports.
Auto-advance under existing authority to coordinated draft PR130 update, native
preflight, then guarded merge/Bump/Publish only after actual green gates.

Current independent reports: local-007-independent-security-review.md and
local-007-ops-validation-review.md. Original provider/protocol, package/lockfiles,
release workflows, writer test and all full/pristine count guards are unchanged.
Scoped lexical+graph update only; tracked config restored, watch stopped; no
provider/embedding/broad indexing or hooks. Final commits, native run, merge and
Bump/Publish/registry identities remain to be bound below.

Final precommit Cortex review covers all nine changed paths, returns ok with zero
findings/conflicts; all nine required changed-file pattern requests succeed.
An additional optional pattern lookup for unchanged provider.mjs fails verbatim
`aliases is not iterable`; this is not relabeled as a pass. The required changed
file evidence and direct provider source review remain separate. Reviewer Ops's
combined-review fail-safe limitation is recorded in its report. Raw final review
and all pattern outputs remain in the manager evidence directory.

## WO-LOCAL-007 actual native acceptance and guarded merge

Both reviewers formally bind exact6672c3259478034b079fd0cd9564f58ab020a351.
Coordinated fast-forward PR130 from6275039 to6672c32. Actual native Ubuntu
preflight34600081411 completedSUCCESS,29/29 steps success. Full focused47,
context81/root437/bundle6/MCP651 and pristine81/437/6/651 pass with zero skips;
six audits report zero vulnerabilities. Containment/frontend, pinned Harness,
identical duplicate artifacts, empty-cache install, real headless/Web/disposal/
profile-removal and final diff/secrets/version/runtime boundary all pass.
Raw log: local-007-evidence/preflight-34600081411.log; structured reports and
step JSON retained alongside it. Historical native failure remains unclassified.

Rechecked PR130 OPEN/DRAFT, head6672c32, main37a511f, no comments/reviews/pause,
MERGEABLE/CLEAN, required validateSUCCESS. Synthetic merge
9ead1dd9955f1ac89ad033b55434c02b9ebaf99c has tree
f9975b49f75061dbb9247c5b172461e429c3a058, exactly local merge-tree. No conflict
or dependent stack. Root independently confirms nativeSUCCESS. Manager accepts
final source/native gates and auto-advances existing authorized ready+guarded
merge, then existing minor Bump/Publish chain. No release gate waiver.

PR130 guarded merge completed2026-09-11T13:00:22Z; merge/main commit
6a42922b933f5869ae188b8d9cc56afccbbd2554, tree identical to native preflight.
Dispatched existing minor Release Bump34601925375 on that main commit; full and
pristine gates continue unchanged. No tag or Publish success has been claimed.

## Release Bump completed / immutable Publish in progress

Bump34601925375 completedSUCCESS, every step passed including the second actual
full/pristine/audit/artifact/Harness/final-boundary sequence and atomic tag+main.
Annotated v2.8.0 objecte07de9de09e57ddf6375df72c241ba7c5b7ae8f5 peels to
00258d7fe40c58fa54e0723236e452630feb7009, exact remote main, tree
72c8ef3565a8b1b102da738de41c821cab6cb997. Parent is reviewed merge6a42922.
Exactly the expected eight metadata paths differ from merge; production/test
source remains reviewed. Bump root/bundle SHA256 and SRI match native preflight
bytes exactly. Full Bump log and extracted reports are in local-007-evidence.

Existing Bump workflow automatically started Publish34603037854 at that immutable
release commit. Actual publication, final registryHarness, downloaded bytes, fresh
registry dual-install and root globalCLI proof remain pending. No tag is rewritten.

## WO-LOCAL-007 Publish outcome / WO-LOCAL-008 bounded handoff

Actual Publish34603037854 FAILED before any npm publication: pristine npm test
exits0 with81/437/6 pass, but original root summary parser requiresTAP '#' and
Node24.20.0 defaults to spec 'ℹ'. First full tagged MCP651 passed; pristine MCP
was never reached. All later audits/artifacts/Harness/publication steps skipped.
Both2.8.0 registry endpoints rechecked404. Immutable v2.8.0 object/commit remain
e07de9de09e57ddf6375df72c241ba7c5b7ae8f5 /
00258d7fe40c58fa54e0723236e452630feb7009; actual main is same releasecommit.

Exact Node24.20.0 diagnostic proves globalNODE_OPTIONS TAP would break explicit
MCPspec via duplicate reporters, so no global flag/rerun is attempted. A scoped
original-executor wrapper is conditional pending fresh independent review and
exact clean-tag full gates. Existing tag workflow has no recovery inputs and
branch-ref rejection; safe main-workflow orchestration needs new reviewed work.
Root authorizes that bounded recovery under existing2.8 publication scope. No
tag rewrite, Bump rerun, version substitution, auth mutation or gate waiver.

Fresh packet context-packets/local-008-immutable-publish-reporter-recovery.md
contains completed source/native/Bump identities, all artifact bytes, actual
failed Publish evidence, no-publication state and conditional recovery design.
Root automatically starts a fresh manager and two fresh reviewers. This is a
context/work-order boundary, not a user stop/reapproval request.

Handoff docs use a final scoped lexical+graph refresh of direct reporter/helper/
workflow references and control docs, with tracked config restored. Required
eight changed-file pattern calls and rules succeed; combined doc-only review
fails verbatim `Review failed safely`. No automated pass is claimed; prescribed
rules/pattern fallback and independent closure review remain separate. Cortex
search identifies file:scripts/release-fresh-checkout.mjs and
chunk:scripts/release-fresh-checkout.mjs:validateExpectedTotals:400-410.
