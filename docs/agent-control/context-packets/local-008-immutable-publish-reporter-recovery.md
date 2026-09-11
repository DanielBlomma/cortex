# WO-LOCAL-008: finish immutable Cortex2.8 publication after Node24 reporter failure

Fresh manager packet,2026-09-11. Infra/deploy/security-sensitive. Automatic bounded
handoff, not user restart/permission request. User/root authority covers a reviewed
safe main-workflow recovery for the already-authorized2.8 publication, preserving
immutable tag/bytes, original helpers and all gates. Root owns existing global CLI
update only after actual complete publication/registry verification. No new Bump.

## Isolation and required setup

Create NEW isolated clone of /private/tmp/cortex-local-007-manager at final docs-only
handoff HEAD supplied by root. Handoff commit is based on actual release/main
00258d7fe40c58fa54e0723236e452630feb7009, not the old feature source. All earlier
clones and original /Users/danielnilsson/GIT/cortex stay read-only. Manager alone
writes branch/remotes; coordinate exact full local+expected remote HEAD with root
before GitHub pushes. Actual remote https://github.com/DanielBlomma/cortex.git;
local clone origin is not GitHub. Always git -c core.hooksPath=/dev/null for writes.
Never force-push or rewrite/delete existing v2.8.0 tag.

Assign two NEW independent Security/Contract/CodeQuality and Ops/Validation/
Integration reviewers BEFORE implementation, each own clone. Root+manager+two
fits four slots. Read only this packet and direct references. Required:
docs/agent-control/workflow-playbook.md, review-iteration-protocol.md,
scaffold/AGENTS.md; plugins/cortex/skills/{using-cortex,change-impact,
pattern-review,context-review}/SKILL.md. Use current CLI node bin/cortex.mjs;
global2.4.1 old. No providers/embeddings/broad indexing/hooks. Necessary release
lexical+graph test preparation is authorized. Use scoped config+ingest/load-ryu
and restore tracked config. Watch stopped.

Ignored runtime/deps can be cp -cR copied from manager007: .context/{mcp,scripts,
cache,db}, scaffold/mcp/{node_modules,dist}, scaffold/scripts/parsers/node_modules,
plugins/dsh-cortex/node_modules. Final manager007 index is scoped to the direct reporter/helper/workflow references
and handoff control docs; new work must refresh its own clone as needed. Root Node24 binary for
narrow diagnostics is available under
/private/tmp/cortex-local-007-evidence/node24/node-v24.20.0-darwin-arm64/bin/node.
Official archive and SHASUMS256.txt are retained there; archive SHA256
b7bf7707070b950ba1ec5f1af3bb6de0f2b1962c5033973d94068ab021ef3014.
This is local macOS Node24.20.0, not native Ubuntu acceptance. Existing owned
Linux x64 init container cortex-local-004-ops-x64-init may be used narrowly;
never mutate unrelated containers/trees. Native hosted gates remain authoritative.

## Completed source, native acceptance and immutable release identities

Read local-007-release-completion-report.md and its independent Security/Ops
reports, plus local-006 report/direct previous references for earlier scopes.
Reviewed source6672c3259478034b079fd0cd9564f58ab020a351, tree
f9975b49f75061dbb9247c5b172461e429c3a058. Both fresh reviewers approve exact head;
raw bindings /private/tmp/cortex-local-007-{security,ops}-evidence/exact-head-approval.json.

PR130 is MERGED at2026-09-11T13:00:22Z with expected-head guard. Merge/main commit
6a42922b933f5869ae188b8d9cc56afccbbd2554 has the exact reviewed/native tree above.
Native preflight34600081411 SUCCESS, all29steps: focused47, full81/437/6/651,
pristine81/437/6/651, six zero audits, containment/frontend, pinned Harness,
byte-identical duplicate artifacts, empty-cache dual install, actual headless/Web,
disposal/profile removal and final boundary. No waiver.

Actual Bump34601925375 SUCCESS, including complete repeated full/pristine gates,
all audits/artifact/Harness/final boundaries and atomic main+annotated tag push.
Tag v2.8.0 object e07de9de09e57ddf6375df72c241ba7c5b7ae8f5 peels to
00258d7fe40c58fa54e0723236e452630feb7009, exact GitHub main at handoff, tree
72c8ef3565a8b1b102da738de41c821cab6cb997. Parent is reviewed merge6a42922. Exactly
eight expected metadata paths differ from merge. Original production/tests/helpers
and package source remain reviewed. Do NOT run Bump again or make2.9/2.8.1 by default.

Actual preflight and Bump root bytes agree:
- root SHA256834585c01bafc60e9d9a7551a51b3815d577ba3e1329cdcc614151b5f78d723e,
  SRI sha512-QOiP27vDAVo7982ZFpf/cbb6KpT4dwbyW3r+h7AQR6AuATEjsVLPhau4SYS4mNruj+43lfgr5GhU2usTXDMkRA==,
  size988282.
- bundle SHA2566f00ac246fd77630bcb8f173e63a1c06205dcbf6b1b7617ac4cc4cad0b78d59c,
  SRI sha512-+vARd84pIBwxaa7kY0eA5FDV8fhgaE1ltZa55W0Y4w6ofriI5nf4gsebl7gtDxvw5Icbq/a8k2OehGEdCCNfPA==,
  size10260.
Exact reviewed bundle dependency is @danielblomma/cortex-mcp2.8.0.

## Actual Publish failure and no registry publication

Bump automatically dispatched Publish34603037854 on immutable release00258d7.
Run https://github.com/DanielBlomma/cortex/actions/runs/34603037854 completedFAILURE
at `Run executable fresh-checkout regression` before all audits/artifacts/Harness
and ALL npm publication steps. First full tagged context81/root437/bundle6/MCP651
and focused47 passed. Pristine root command exits0 with81/437/6pass, zero failures;
helper rejects `missing_tap_summary: root, deepseekHarnessBundle`. Pristine MCP
never runs because root count parser fails. Do not call this successful Publish.

Native Node24.20.0 emits spec `ℹ tests437`, `ℹ pass437`, `ℹ tests6`, `ℹ pass6`.
Helper expects root/bundle TAP `#` and correctly fails closed. This is a reporter
contract defect, not failing tests or a reason to bypass count gates. Both new
settled-leader tests pass even in this pristine bundle6 run.

Rechecked exact registry endpoints after failure: both @danielblomma/cortex-mcp
and @danielblomma/dsh-cortex2.8.0 return404 `version not found:2.8.0`.
No root/bundle partial publication; existing global CLI unchanged. Preserve that
status until actual successful recovery evidence. Recheck before action.

## Direct code and proved reporter behavior

- scripts/release-fresh-checkout.mjs: executeChild exported270; nodeTapSummaries380;
  validateRootTotals412 hardcodes#; validateMcpTotals423 hardcodesℹ;
  runFreshCheckout exported429 accepts executor; actual four commands507–510.
- package.json71 root test uses default node --test and npm bundle test.
- plugins/dsh-cortex/package.json test also default node --test.
- scaffold/mcp/package.json13 test:ci explicitly uses --test-reporter=spec.
- tests/release-fresh-checkout.test.mjs, tests/release-workflows.test.mjs.
- .github/workflows/{release-publish,release-preflight,release-bump}.yml.
- scripts/release-artifacts.mjs exact artifacts/install/Harness/registry helpers.

Manager diagnostic on official verified exact Node24.20.0, outside tracked source:
/private/tmp/cortex-local-007-evidence/reporter-probe/results.json and *.log.
Default simple actual node:test emits spec; NODE_OPTIONS=--test-reporter=tap emits
TAP and exit0; normal non-test command accepts flag. BUT inherited TAP env plus
MCP's explicit --test-reporter=spec FAILS exit1: both reporters present but only
one destination. Therefore global NODE_OPTIONS is NOT an acceptable recovery.
This is syntax/format proof, not full clean-tag validation of a wrapper.

Potential narrowly scoped execution design (conditional, not implemented): import
original tagged runFreshCheckout and executeChild; invoke original runFreshCheckout
with an executor that delegates every actual command to original executeChild,
setting NODE_OPTIONS TAP ONLY on the exact root `npm test` child. All other calls,
especially MCP explicit spec, retain original environment. Do not synthesize
output, transform summaries, skip commands or replace real tests. Need independent
exact clean-tag full81/437/6/651 proof and negative count/failure/command/env probes.
The helper's original capture/output limits, cleanup and count validation remain.
An equally strict better design is allowed with concrete evidence; no blind rerun.

## Workflow-source/resume constraint and required next work

Tag's existing release-publish.yml has empty workflow_dispatch inputs, rejects
branch ref, checks out github.ref, and gets its own workflow definition from the
dispatched tag. Editing main YAML then re-running the old tag invocation does not
apply the new definition. Registry safe-resume exists only later in the old flow,
after the failed gate. No current input supplies reporter environment or alternate
reviewed orchestration. A fresh reviewed recovery mode on main is authorized,
provided it explicitly pins/checks out the same immutable tag/object/commit and
preserves exact artifact bytes, original helpers and all gates. Review which
workflow definition executes separately from which source is checked out. Keep
Node24/npm11.19.1, OIDC, ordered dual publication, exact-registry safe-resume and
final registryHarness. Reusing release-publish.yml filename may matter for npm
trusted-publisher identity; verify official contract/config evidence, don't assume
new filenames or trust changes are free. Do not alter registry auth blindly.

Before implementation: map Cortex rules/impact/relationships for actual new files,
assign fresh reviewers, document source/workflow trust model, intended minimal
recovery and gate-equivalence. New work should branch from actual main00258d7;
local handoff adds docs only. Review existing workflow contract tests, including
preflight's automatic next-minor simulation now that main metadata is2.8. No
unrequested tag/version bump follows from a preflight fixture. Do not silently
waive a PR or release gate if existing post-release workflow assumptions surface.

Then implement/review bounded recovery, focused positive+negative diagnostics,
actual exact-clean-tag gate, coordinated reviewed PR/push/merge of workflow-only
orchestration as required. Dispatch correct reviewed workflow source with explicit
immutable release identity. Monitor actual Publish to completion including final
registry Harness. Registry version appearing alone is insufficient.

Finally reconcile immutable tag/source ancestry/currentmain (main may advance only
with reviewed recovery control changes), actual successful Publish report, exact
root/bundle registry versions/latest/dependency/SRI/SHA256 and downloaded bytes vs
preflight/Bump/Publish artifacts. Run install-registry in a fresh empty output/cache
and validate CLI. Send root full proof; root updates existing /opt/homebrew global
CLI to pinned2.8 and returns command/version evidence. Record final durable control
docs without rewriting immutable release tag. No user reapproval needed.

## Evidence and primary reference locations

All manager raw logs/JSON are /private/tmp/cortex-local-007-evidence:
preflight-34600081411.log, preflight-current.json, preflight.reports.json;
bump-34601925375.log, bump-current.json, bump.reports.json;
publish-34603037854.log, publish-failed.log, publish-current.json;
registry-after-failed-publish.json; native-binding.json; tag-binding.json.
extract-reports.py parses stage JSON and counts; verify-registry.py is prepared
but NOT EXECUTED and currently expects successful `publish.reports.json` in that
evidence directory. Adapt paths to own evidence directory instead of mutating old.

Official references opened for diagnosis:
https://nodejs.org/docs/latest-v24.x/api/test.html#test-reporters
https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow
Use exact24.20 source/docs and actual diagnostics for version-specific claims.

Residual previous limitations unchanged: ONNX predictabletemp/pre-check races;
absent external frozen benchmark packet; upstream linux-arm64 Ryu package is x64.
No provider/model calls, full emulator substitution or release gate waiver.
