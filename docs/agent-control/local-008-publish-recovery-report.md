# WO-LOCAL-008 immutable publication recovery

Infra/deploy/security-sensitive. Fresh manager and independent Security/Contract/
CodeQuality and Ops/Validation/Integration reviewers were assigned before edits,
in separate008 clones at31af0dae. Source branch is based on actual release00258d7
plus docs-only handoff; original checkout and previous clones remain read-only.

## Contract and affected surface

Cortex search identifies runFreshCheckout429–520 and executeChild270–374 in
scripts/release-fresh-checkout.mjs; impact/related identify its four real child
commands and tests. Six active rules were read. Initial copied cache warns of
missing generation-linked graph and uses lexical fallback; no graph-policy pass
is inferred. Only workflow orchestration, existing workflow contract tests and
control docs change. Tagged helpers, tests, packages and metadata stay immutable.

Existing release-publish.yml gains explicit recover_2_8 Boolean dispatch on main.
Normal strict-tag invocation remains. Recovery pins v2.8.0 annotated object,
peeled commit and tree before any tagged script runs, checks original Bump SRI
and SHA256 before publication, and records workflow SHA separately from source.
Original runFreshCheckout and executeChild execute every real command with the
original collector/count guards. Only exact root npm[test] at repository cwd
receives TAP NODE_OPTIONS in a copied child environment; nonempty inherited
NODE_OPTIONS fails closed. MCP receives its original explicit spec environment.

Same workflow filename, repository, hosted runner, OIDC permissions and npm11.19.1
remain. Official npm trusted-publisher docs bind owner/repo/workflow filename
and optional environment; GitHub dispatch docs distinguish workflow source ref.
Actual saved npm admin configuration is not readable in this session; no auth
change is attempted. Native actual publication remains the authoritative check.
https://docs.npmjs.com/trusted-publishers/
https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow

PR preflight still simulates next minor2.9 with all original eight metadata paths
and all release gates; no new Bump is dispatched. Its current bundle npm ci would
require unpublished2.8 before seeding. Move that same locked install after exact
local root seed, prime content-addressable npm cache with that artifact, then
retain original binding/version check. Keep Bump/preflight shared gate blocks
identical. Independent empty-cache proof is required before acceptance.

## Acceptance still required

Focused main workflow positive/negative tests, exact-tag actual Node24 full
81/437/6/651 with wrapper, independent source approvals, complete native PR gates,
guarded merge, correct main recovery dispatch, actual Publish success including
registry Harness, exact registry bytes/SRI/SHA256 and empty-cache dual install.
Root alone updates existing globalCLI after receiving complete evidence.
No tag mutation, release version substitution, gate waiver or auth fallback.

## Verification in progress and actual trust evidence

Main focused suite47 has46pass/0fail/1 Linux-only skip on macOS; native47/47
remains required. Both fresh reviewers independently exercise exact-tag Node24
full gates. Security24 scope and positive/negative probes show original count/missing-summary/
nonzero-exit fail-closed behavior and exact child environment/command scope.
Ops verifies unpublished2.9 seed with actual npm11.19.1, initially empty private
cache, successful locked ci, original local binding and exactly8 metadata paths.
Original local --package-lock=false binding can refresh installed transitives;
this pre-existing behavior does not change committed lock or artifact bytes.

Actual prior successful Publish33473686535 and public npm2.7 root provenance
bind DanielBlomma/cortex/.github/workflows/release-publish.yml to hosted runner,
workflow_dispatch and tag commitcd7e41469d208018554d878862119d4c443a512a.
Raw prior-publish.json, prior-root-attestation.json and decoded provenance are in
/private/tmp/cortex-local-008-evidence. This proves historical root workflow
identity, not current saved settings for either package. Both2.8 endpoints remain
404 before recovery. New workflow keeps exact filename/permissions/auth path.

Scoped manager ingest/load-ryu refreshed17 direct files/217chunks; config restored,
watch stopped. Combined review returns verbatim `Review failed safely`/INVALID_ARGS;
no automated pass is claimed. Required rules/per-file patterns and independent
source reviews are separate evidence.

## Local context command scope incident

Manager mistakenly invoked `node bin/cortex.mjs update --help` expecting syntax
help; this CLI executes update. It ingested10 changed-context files and launched
embed.sh, which actually downloaded model metadata/tokenizer and209636334bytes
of a partial ONNX model into the new008 clone. Manager stopped the entire owned
process tree with SIGTERM; command exited143. No embedding snapshot or inference
result was observed. No network trace was captured, so no categorical no-network/
no-source-upload claim is made. Independent Security source review confirms this
stage fetches model resources and awaits local model initialization before
scheduling local feature extraction. This is a real unauthorized model-download
scope deviation, not a successful no-provider update.

Root and Security were informed immediately. Durable raw inventory/hashes and
npm log are update-incident-{files,hashes}.json and update-incident-npm.log in the
manager evidence directory. Verified solely task-owned newly created embeddings
cache was removed; old clones and original checkout were never touched. No live
owned embed process remains. Further refresh uses only explicit scoped ingest
and load-ryu; no speculative CLI help/update invocation. Release source, tag,
package bytes and authorization are unaffected. Root directs continuation after
containment, preserving required independent and native release gates.

A direct original-vs-candidate workflow comparison confirms all32 original
Publish steps retain order;27 steps are byte-identical. The five changed original
steps are dispatch selection, checkout ref, tag-name mapping, scoped pristine
executor and final source/workflow evidence. Two added identity/byte gates fail
closed. Raw gate-equivalence.json records the exact comparison.

## Independent full-tag validation: first macOS outcome

Security's first actual Node24 full-tag run passed81context/437root/6bundle, then
ran all651 MCP tests and failed650/651. Original executor/helper rejected the
nonzero exit as required. Diagnostic reports a Unix socket path under macOS's
long default TMPDIR in the analysis-writer fixture. Causal classification and
any environment-only correction are pending; no successful full-tag claim,
retry-to-green, source edit, push or release GO follows from this failed run.
Raw exact-tag-full.log is preserved in the independent Security evidence dir.

Security has now causally classified the first failure: exact socket test fails
with134-byte macOS path and sun_path[104], passes unchanged with owned short
TMPDIR. Corrected original full helper on exact tag/Node24.20.0/npm11.19.1 exits0
with81/437/6/651 and no fail/skip/cancel/todo. Its report and final source/toolchain/
log binding are local-008-independent-security-review.md and independent evidence
final-validation-binding.json. Security approves four unchanged source hashes.
Ops independently reproduces the path constraint; its shortTMP full diagnostic
passes81/437/6/651 on bundlednpm11.19.0, explicitly not mislabeled11.19.1. A final
correctly resolved npm11.19.1 full gate is running before final Ops approval.

## WO-LOCAL-008 source and local validation acceptance

Both fresh independent reviewers approve the four source hashes with no remaining
blocker/major finding. Both original clean-tag full helpers independently pass
81/437/6/651 on exact Node24.20.0/npm11.19.1, with zero fail/skip/cancel/todo.
The host-only socket correction uses short task-owned TMPDIR and changes no source,
helper, command or guard. First long-path failures and Ops's intermediate11.19.0
diagnostic remain explicitly scoped; only final11.19.1 runs establish acceptance.
Ops proves wrong locked root SRI rejects offline while restoring only exact SRI
passes against the same cache. Both independent reports are committed alongside
local-008-publish-recovery-report.md; raw final bindings remain in008 evidence dirs.

Accept for coordinated draft PR and complete hosted native preflight, not merge
or publication ahead of native gates. Auto-advance existing authorization to
exact-head push, PR validation, guarded merge and explicit main recover_2_8
Publish only after required green gates. Never rerun Bump or mutate v2.8.0.
Root alone installs existing globalCLI after actual complete Publish/registry
byte/SRI/SHA256/empty-cache/Harness evidence. Class:infra-sensitive, no PR stack.
