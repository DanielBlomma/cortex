# WO-LOCAL-006: deterministic writer fixture and complete Cortex 2.8 release

Fresh session packet, 2026-09-11. Profile: Infra/deploy/security-sensitive because
this test ships in root artifact and release acceptance touches trusted state.
Root auto-starts a new manager; no user restart, permission or release waiver.

## Authority and immediate setup

User already authorized compatible dependency resolution, complete release tests,
reviewed merge PR130, Release Bump/Publish2.8.0 and existing global CLI update.
Manager owns isolated clone/branch/remote actions; root owns /opt/homebrew CLI
only after verified actual publication. Original /Users/danielnilsson/GIT/cortex
and prior trees remain read-only. No providers/embeddings/broad indexing/hooks.
Necessary release-test lexical+graph fixture preparation is authorized. Always
use git -c core.hooksPath=/dev/null for writes; no force push or tag rewriting.

Create NEW isolated clone of /private/tmp/cortex-local-005-manager at its final
HEAD (root will supply exact docs-only handoff commit). Reviewed production/head
is54af80981782ad03a22eb9c9421c1ac8664d6ae5; later handoff commits change docs only.
Assign NEW independent Security/Contract/Code Quality and Ops/Validation/Integration
reviewers BEFORE implementation, each separate clone. Root+manager+two fits slots.
Do not reuse previous reviewer sessions for the new work order.

Use only this packet and direct references. Required rules:
docs/agent-control/workflow-playbook.md, review-iteration-protocol.md,
scaffold/AGENTS.md; apply plugins/cortex/skills/{using-cortex,change-impact,
pattern-review,context-review}/SKILL.md. `node bin/cortex.mjs` is current CLI;
global2.4.1 is old. Ignored runtime/deps may be Mac cp -cR copied from source
.context/{mcp,scripts,cache,db}, scaffold/mcp/{node_modules,dist},
scaffold/scripts/parsers/node_modules. No bootstrap embedding call. Use scoped
.context config + ingest.sh/load-ryu.sh and restore tracked config before commit.
Watch stopped. Manager context was scoped to direct writer files at handoff.

## Exact current remote and evidence

Remote GitHub https://github.com/DanielBlomma/cortex.git. In manager005 clone,
`github` is actual GitHub; `origin` points at earlier local source. New clone origin
will likewise be local; do not confuse it with remote publication target.
PR130 OPEN/DRAFT branch fix/root-gitignore-discovery at54af809. main remains
37a511fa76ce04804f6cf4497202966dd78ff1f0. Synthetic merge
aed7ad4f7962c9bccaea6bc5add2025f272950b6 tree
2023c5d99bbc9eda826d139c155ea0df41501b63 exactly equals local merge-tree.
Last recheck found no v2.8.0 tag or root/bundle2.8 registry version.
No merge/Bump/Publish/global install has occurred. Recheck before dependent actions.

Actual native preflight34597272860 FAILED pristine MCP650/651 after:
- focused release47/47 PASS;
- full context81/root437/bundle6 PASS;
- first full MCP651/651 PASS;
- pristine context81/root437/bundle6 PASS.
Later audits/artifacts/Harness/final boundary did not execute in this run.
Run https://github.com/DanielBlomma/cortex/actions/runs/34597272860
Full raw log and JSON /private/tmp/cortex-local-005-evidence/preflight-34597272860.{log,json}.
Error near log5158 excerpt:
`analysis-state-trusted-writer.test.mjs:513`, test two writers with one expected
generation produce one commit and one stale loser; line520 expected /stale writer/,
actual `maintained analysis state changed during read`.

## Proved diagnosis; no new implementation yet

Direct implementation/tests:
- scaffold/mcp/tests/analysis-state-trusted-writer.test.mjs (runWorker494, test513)
- scaffold/mcp/src/core/analysis-state/trusted-writer.ts (prepareAppend299,
  acquireCoordinator410, appendWithCoordinator712, appendTrusted...761)
- scaffold/mcp/src/core/analysis-state/query-reader.ts (strict bindings144,
  assertTransactionUnchanged169, readTrustedAnalysisState around330)
- scaffold/mcp/src/core/analysis-state/store.ts (publishAnalysisState676)
- scaffold/mcp/tests/analysis-state-cli.test.mjs226,247 existing reader race tests
- docs/agent-control/maintained-analysis-state-writer-report.md105 historical claim

appendTrustedAnalysisObservation performs optimistic trusted prepare BEFORE lock
acquisition. Reader binds strict task-directory identity and rechecks it after
replay. A valid winner's mkdir/commit can change identity while loser reads,
so reader correctly throws STATE_UNTRUSTED before stale-generation classification.
Hosted test already passed statuses[0,1]; it failed only over-specific scheduling.
Both independent diagnostics deterministically reproduce exact native error with
one real winner append, no retry loops. Final generation2/count2 and exact winner
hashes remain. Ops cross-process proof confirms loser leaves the winner's complete
bytes/inodes/ctimes/mtimes/modes/links/directory identity tree unchanged. Security
also runs existing concurrent-authority reader rejection and unrelated-root
acceptance tests2/2. No production defect or guard-bypass justification found.

Read independent reports:
- docs/agent-control/local-005-writer-security-review.md
- docs/agent-control/local-005-writer-ops-review.md
Security raw /private/tmp/cortex-local-005-security-writer-diagnostic.log and
-reader-race-regression.log; diagnostic own fixture in security clone tests/local005-writer-diagnostic.mjs.
Ops raw /private/tmp/cortex-local-005-ops-evidence/writer-crossprocess-diagnostic.json;
fixture /private/tmp/cortex-local-005-ops-writer/scaffold/mcp/tests/ops-writer-diagnosis.mjs.
No candidate test/runtime changed for this new race at handoff.

## Bounded proposed test repair

Synchronize both worker processes after successful optimistic prepare, immediately
BEFORE their FIRST mkdir of the exact coordinator lock path. Release both only
when both are ready; execute original real mkdir/append thereafter. This isolates
the intended prepared-contender stale-CAS schedule instead of weakening reader
safety. Preserve exact statuses0/1 and /stale writer/ assertion; strengthen winner
returned hash/authority/observation identity vs fresh trusted state and gen/count.
Keep test counts651 and root81/437/6 unchanged. Existing read-race rejection tests
remain required. No production retry, relaxed regex/error alternatives, timeout
inflation, reader/lock bypass, or blind retry-to-green.

Implementation may use worker-only exact-path fs.mkdirSync interception with a
parent-controlled pipe/FD rendezvous, or private separate temp coordination path.
Never place marker files under strict .agents/task ancestors; bound waiting,
handle early worker exits, and always release/kill/reap owned workers on failure.
runWorker has only this test caller. Review synchronization/cleanup independently.
Historical report's broad 'required stale-CAS loser' wording applies only after
successful prepare; overlap during trusted read can legitimately fail earlier.
Record this clarified scope without altering production contract.

## Unchanged reviewed release work and remaining chain

Read docs/agent-control/local-005-release-completion-report.md and linked005
Security/Ops reviews; previous packet local-005-hosted-release-completion.md plus
its local004 reports bind earlier dependency, workflow, artifact/security work.
52bd675 minimal adm-zip0.6.1 lock fix has six auditszero and official source/signature
proof. 7699afb clean-tag CLI review accounting test is independently approved.
cd7668b Web helper process-group fix is independently approved, in remote54af809.
Actual pinned b150a551 Harness old-PID signal misses DSH; group signal invokes
handler, DSH exits130 in29ms, wrapper pnpm reports1, port/observed tree closes.
Five checked-in lifecycle cases preserve original30sbind/10sshutdown; failed owned
groups cleaned, success neverSIGKILL. Native final-head full Harness still required;
first run34595569328 failed oldWeb, latest stopped earlier at writer fixture.

After new test and exact-head independent review:
1. Update durable docs, coordinate exact local+expected remoteHEAD with root, then
   fast-forward draftPR130. Revalidate final head in actual native preflight; retain
   clean immutable-tag behavior and all unchanged release gates. No merge untilgreen.
2. Recheck main/head/review/check state and local/synthetic merge tree. Ready and
   merge with expected-head guard under existing authority; no repeated permission.
3. Dispatch existing release-bump.yml onmain release_type=minor. Monitor true Bump
   completion and triggered release-publish.yml through true completion. Node22/24,
   npm11.19.1, eight metadata files, atomic main/tag, immutable annotated tag, OIDC,
   exact dual ordered publication and safe resume remain unchanged.
4. Verify tag object/peeledcommit/main/source tree, actual published run logs,
   reviewed artifact report root/bundle SRI+SHA256. Verify registry versions/latest,
   bundle exact rootdependency, downloaded tarball bytes vs published local artifacts.
   Run helper install-registry in new empty dir/cache and validate CLI. Registry
   version alone is not successful Publish proof; registry Harness must finish.
5. Send root exact successful runs/tag/commit/packagebytes/integrities. Root updates
   existing /opt/homebrew global CLI explicitly (defaultnpm prefix=NVM) to pinned2.8,
   verifies command -v/version and returns evidence. Record final durable reports;
   never rewrite immutable tag merely to update control docs.

Residual historical limitations: ONNX predictabletemp-root/pre-check races remain
minor unchanged baseline; six standalone benchmarks require absent external frozen
packet, do not invent/run them. Existing ryugraph linux-arm64 prebuilt is x64;
release target native Ubuntu x64. No emulator gate waiver. Container
cortex-local-004-ops-x64-init remains available for bounded owned diagnostics;
never touch unrelated containers. Actual hosted gates are authoritative.
