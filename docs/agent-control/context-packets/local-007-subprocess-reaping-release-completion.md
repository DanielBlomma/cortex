# WO-LOCAL-007: classify subprocess exit/reaping and finish Cortex2.8 release

Fresh manager packet,2026-09-11. Profile: Infra/deploy/security-sensitive.
This is an automatic bounded handoff, not a user restart/permission request.
Existing user authority still covers reviewed PR130 merge, Bump/Publish2.8.0
and root-owned existing /opt/homebrew CLI update. No gate exceptions or blind rerun.

## Isolation, role assignment and direct references

Create a NEW isolated clone from /private/tmp/cortex-local-006-manager at the
final docs-only handoff HEAD supplied by root. Approved source head is
62750391fc1a8b5d306d8e44ab6168a45b4b16b6; later handoff changes are docs only.
Prior trees and original /Users/danielnilsson/GIT/cortex remain read-only.
Assign two NEW independent Security/Contract/CodeQuality and Ops/Validation/
Integration reviewers before implementation, each own clone. Root+manager+two
reviewers fits four slots. Manager is sole branch writer. Coordinate exact full
local and expected GitHub heads with root BEFORE push; no force push/tag rewrite.
Use git -c core.hooksPath=/dev/null for every write. Actual remote is
https://github.com/DanielBlomma/cortex.git; local clone origin is not GitHub.

Read docs/agent-control/workflow-playbook.md, review-iteration-protocol.md,
scaffold/AGENTS.md; apply plugins/cortex/skills/{using-cortex,change-impact,
pattern-review,context-review}/SKILL.md. Use only this packet plus direct refs.
Required unchanged release authority/evidence:
- context-packets/local-006-writer-fixture-release-completion.md
- local-006-release-completion-report.md
- local-006-writer-security-review.md and local-006-ops-validation-review.md
- their direct local-005/local-004 reports, especially
  local-004-independent-security-review.md155 onward (historical reaping diagnosis).

Use current CLI node bin/cortex.mjs (global2.4.1 old). No provider/embedding/broad
index/hooks. Necessary release-test lexical+graph preparation is authorized.
Manager006 ignored runtime/deps may be cp -cR copied: .context/{mcp,scripts,cache,db},
scaffold/mcp/{node_modules,dist}, scaffold/scripts/parsers/node_modules. Bundle
installed locked deps exist in /private/tmp/cortex-local-004.KRx8g8/repo/plugins/dsh-cortex/node_modules
(read-only source, copy into new own clone if needed); manager005/006 lack them.
Use scoped .context config + ingest.sh/load-ryu.sh, restore tracked config.
Watch stopped. Last manager006 index covers only provider/protocol/bundle test
and direct historical security report, not broad repository source.

## Exact current source, remote and completed failure

PR130 OPEN/DRAFT on fix/root-gitignore-discovery at exact6275039 above.
main37a511fa76ce04804f6cf4497202966dd78ff1f0. GitHub synthetic merge
 a2e56db7ea0b7b4bb7408e86b412f29ba8aa0871 tree
19825fad8892d083c1ce4c6ed2ef1ee58fd1a1e9 exactly equals local merge-tree.
No merge, Bump, tag, Publish or global update occurred. Recheck refs/registry.

Actual native Ubuntu preflight34598916068 FAILED at full bundle5/6, before MCP,
pristine, audits/artifact/Harness/final-boundary gates. Focused47/47 and full
context81/root437 passed. The006 writer test source has independent8/8+reader2/2
approval but this latest native run did NOT reach MCP; no native writer acceptance.
Run https://github.com/DanielBlomma/cortex/actions/runs/34598916068,
job103261177920. Full log:
/private/tmp/cortex-local-006-evidence/preflight-34598916068.log;
final step JSON preflight-current.json in same directory.

Exact failing test:
plugins/dsh-cortex/tests/local-subprocess-integration.test.mjs203,
'provider timeout kills a TERM-trapping descendant after the leader exits zero'.
At220, assert.throws(() => process.kill(descendantPid,0), /ESRCH/) failed
'Missing expected exception',3010.762714ms. Line219 TIMEOUT assertion passed.
All other five bundle tests passed, including settled-leader cancellation200.
Log3601–3633 contains exact failure; full root437 summary3563–3571.
Test's after-hook then sends SIGKILL to that PID and removes fixture.
Native log has NO /proc state/identity snapshot at failure, so it cannot prove
whether that process was already dead/zombie or still executing. Runner orphan
cleanup lists VBCSCompiler only, not a complete failure-time process inventory.
Do not assert native zombie classification from historical emulator evidence.

## Read diagnosis and remaining causal question

Direct code:
- plugins/dsh-cortex/tests/local-subprocess-integration.test.mjs: writeSettledLeaderFixture35,
  readLivePid80, killIfAlive87, settled cancellation180, timeout203–221.
- plugins/dsh-cortex/provider.mjs: run91–168; awaits handle.done then
  handle.waitForExit in finally, before throwing TIMEOUT/CANCELED.
- plugins/dsh-cortex/package.json and package-lock.json exact locked dependencies.
- Installed pinned @deepseek-ai/dsh-subprocess-local0.1.1-rc.2 source:
  /private/tmp/cortex-local-004.KRx8g8/repo/plugins/dsh-cortex/node_modules/@deepseek-ai/dsh-subprocess-local/lib/index.js
  parseProcStat274, linuxProcessGroupHasLiveMembers315–338, observe exit823–847,
  waitForExit915–937. It treats Linux group with only Z/X/x entries as nonexecuting;
  process.kill(pid,0) can still succeed before reaping. Preserve original source.

The fixture starts a SIGTERM-trapping descendant, observes readiness, lets its
leader exit0 and later times out provider at2000ms; provider uses the existing
termination grace. The immediate ESRCH assertion is stricter than confirmed
no-executing-member semantics. Historical004 Security instrumented a cancellation
copy and saw one failing immediate assertion with Z/PPID1, later /proc absent;
that is supporting evidence, not native classification or gate success.

Next manager must first prove the actual causal condition with independent
read-only/process-state diagnostics, preferably deterministic classification of
live versus already-dead identity. No blind CI retry. If only delayed reaping is
proved, bounded test-only eventual ESRCH may be appropriate ONLY for already-dead
identity; reject executing/unknown survivors immediately and preserve eventual
ESRCH, ownership/starttime identity, cleanup, provider deadline and grace.
Do not merely sleep, broaden statuses, accept kill(pid,0) success, inflate timeout,
change production based on assumptions or replace real Harness integration.
If a live survivor is proved, treat that as a production defect requiring its own
reviewed correction; no test bypass. No007 implementation exists yet.

## Accepted006 source and tests to preserve

6275039 changes existing writer test only plus control docs. Two fresh reviewers
formally approve exact commit (Security exact-commit-approval.json under
/private/tmp/cortex-local-006-security-evidence, Ops exact-head-approval.txt under
/private/tmp/cortex-local-006-ops-evidence). Test SHA256
e40ba6d5668db08fd51b41ccaf2482292a717d33f22c057a2b106579ccc7f8f4.
Each passes writer8/8, reader2/2 and negative earlyexit/spawn/readiness/cleanup
probes; Ops missing-release and Security postassertion paths also reject/clean.
Private5s rendezvous after both optimistic preparations and before first real
coordinator mkdir retains exact0/1, /stale writer/ and all production guards.
Winner generation/count, snapshot/head, authority/registry hashes and observation
identity are checked. MCP count651 and root81/437/bundle6 guards unchanged.
Historical production/clean-tag/lifecycle/dependency reviews remain applicable.
Manager doc-heavy combined Cortex review fails safely; per-file rules/patterns
succeed and independent two-path source reviews both report0 findings/conflicts.

## Remaining full completion chain

After bounded repair, independent exact-head approval and control docs, coordinate
root and fast-forward draftPR130. Required native preflight must truly pass all
unchanged full/pristine81/437/6/651, six audits, containment/frontend, exact
artifacts/empty-cache install, pinned Harness b150a551 lifecycle and final boundary.
Recheck base/head/reviews/checks and local/synthetic merge tree. Ready and merge
with expected-head guard under existing authority once green; no user question.
Dispatch existing release-bump.yml onmain release_type=minor and monitor actual
Bump completion plus triggered release-publish.yml through true completion.
Preserve Node22/24,npm11.19.1,eight metadata files,atomic main/tag,immutable annotated
tag,OIDC,ordered dual publication and safe resume. No tags while required gates fail.
Verify tag object/peeled commit/main/source tree, published-run logs, exact reviewed
root/bundle SRI+SHA256, registry versions/latest and exact bundle root dependency,
and downloaded registry bytes against actual publication artifact report.
Run install-registry in new empty output/cache and validate CLI. Registry version
alone is not Publish success; final registry Harness must finish. Send root proof;
root updates existing /opt/homebrew global CLI to pinned2.8 and returns command/version
evidence. Record durable final docs without rewriting immutable release tag.

Residual prior limitations remain: ONNX predictable-temp/pre-check races, missing
external frozen benchmark packet, mislabeled upstream linux-arm64 Ryu prebuilt.
Native Ubuntu x64 is authoritative. Existing owned init-enabled diagnostic
container cortex-local-004-ops-x64-init may be used narrowly; don't touch unrelated
containers or run provider/embedding operations. No gates have been waived.
