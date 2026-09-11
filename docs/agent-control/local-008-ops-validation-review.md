# WO-LOCAL-008 independent Ops / Validation / Integration review

APPROVE the exact candidate four-file source hashes in reviewed-source-sha256.json for coordinated PR/native preflight. No unresolved blocker or major finding. Final exact toolchain clean-tag run passes81/437/6/651; this local approval does not replace native PR/Publish gates.

Reviewer assigned before implementation; own clone at31af0dae28b106ef916fdf8bed24cda450cdb498. Only packet/direct refs used. Prior clones read-only; manager sole source/remote writer. Auxiliary clean-tag and2.9 simulation clones are owned below /private/tmp/cortex-local-008-ops-evidence.

## Source and gate equivalence

The existing release-publish.yml filename retains hosted Ubuntu, Node24/npm11.19.1 and id-token:write. Only explicit Boolean recovery on workflow_dispatch from refs/heads/main selects the fixed2.8.0 release. Normal strict tagged invocation remains. Checkout obtains the annotated tag; recovery checks exact annotated objecte07de9de09e57ddf6375df72c241ba7c5b7ae8f5, commit00258d7fe40c58fa54e0723236e452630feb7009 and tree72c8ef3565a8b1b102da738de41c821cab6cb997 before any tagged code executes. Workflow source SHA/ref are recorded separately.

The recovery heredoc imports original tagged runFreshCheckout and executeChild. Every child executes through original executeChild and original output/count/failure validation. Only exact npm[test] at the helper cwd receives a copied environment with NODE_OPTIONS TAP; MCP explicit spec and both context preparation commands keep original options. Nonempty parent NODE_OPTIONS rejects before helper entry. Original helper/tests/source remain immutable.

Original gates remain: full and pristine counts; six audits; containment/frontend; pinned real Harness; duplicate/local artifact verification and install; local headless/Web/disposal/removal; exact registry safe resume; root publish then exact root registry verification before bundle publish; exact bundle verification; root CLI smoke; empty-cache dual registry install; final registry Harness. Original2.8 root and bundle SRI/SHA256 additionally reject byte drift before any publication. No npm auth fallback, version substitution or gate waiver.

Official npm documentation https://docs.npmjs.com/trusted-publishers/ confirms supported GitHub-hosted runner, minimum npm11.5.1/Node22.14 and owner/repository/workflow filename (+ optional environment) trust configuration. Filename is preserved; actual saved npm admin config was not read. Correct main workflow dispatch is required; rerunning immutable old tag workflow would retain old definition. Native successful publication remains authoritative for configured npm trust.

## Next-minor simulation and locked dependency bootstrap

Preflight still computes next minor2.9 locally without a release/tag publication. Bump/preflight shared blocks remain identical. Bundle npm ci is moved after built root seed and original metadata synchronization, primed by npm cache add exact seed tarball, and retains the existing local artifact install/version assertion. This removes dependence on unpublished current/next root registry versions while retaining all six locked ci commands and original8 metadata paths.

Independent real2.9 simulation uses original tag source with normal npm version minor, pack and sync scripts; Node24.20.0 and isolated npm11.19.1, initially absent private cache. Exact local root cache add plus npm ci --prefer-offline succeeds25 packages/0 vulnerabilities; unchanged subsequent local artifact install succeeds and installed root is2.9.0. Exactly8 expected metadata paths differ. Raw simulation-proof.json and simulation-npm11-{ci,bind}.log retained. Original --package-lock=false install re-resolves3 installed dependencies including koffi3.1.6→3.2.1; this preexisting behavior does not change locked artifact bytes and is not introduced by cache priming.

## Validation and context evidence

Candidate focused47 runs on macOS:46pass,0fail,1 expected Linux-only Harness identity skip. No claim of native47/47. Exact root artifact independently repacks to original SHA256834585c01bafc60e9d9a7551a51b3815d577ba3e1329cdcc614151b5f78d723e and passes tagged sync --check.

Used using-cortex/change-impact/pattern-review/context-review. Initial search/rules/impact/related warned copied graph publication was unavailable; lexical fallback disclosed. Fresh scoped ingest+graph covers only direct workflows/helpers/tests and packet. Tracked config restored; watch stopped. All6 rules and4 changed-file pattern requests succeed using current Ryu graph with lexical ranking. Local workflow evidence is same module Bump/preflight shared ordering; tests use existing validators and mutation checks. Combined review returns verbatim `Review failed safely`/INVALID_ARGS, retained as candidate-review.json; no automated pass claimed. Explicit skill rules+patterns fallback and independent source review are separate. git diff --check passes.

Final exact-head binding and native preflight/actual recovery Publish/registry/globalCLI completion remain required after this local approval.

## Classified local macOS test-host correction

First complete attempt: context81/root437/bundle6 all pass with original TAP count validation; MCP650/651 fails solely the existing socket transaction target test at analysis-state-trusted-writer.test.mjs366/375. Original helper rejects nonzero_exit with complete diagnostic; it is not a successful release gate. Raw exact-clean-tag-full.log is retained.

Independent causal proof uses the exact original test and exact Node24.20.0: default TMPDIR generates a134-byte realpath and net.listen returns EINVAL(-22). Local macOS SDK sys/un.h79 defines sun_path[104]. Exact same original test passes1/1 with task-owned TMPDIR=/private/tmp/wo008-ops, producing a100-byte socket path. An independent minimal same-layout net.listen probe records default134-byte EINVAL and short100-byte successful listen. Raw socket-original-{default,short}.log and socket-probe.{mjs,jsonl} are retained. This is a host path-length correction, not a test/source/guard change or retry without diagnosis.

After first attempt settled, original pristine-context reset restored clean tracked tag source. Entire unchanged original helper plus verbatim reviewed wrapper was run again with only the owned short TMPDIR correction; no runtime or test changes. This local macOS correction does not alter native Ubuntu workflow configuration or substitute for required hosted gates.

## Toolchain resolution correction

Both initial full attempts resolved bundled npm11.19.0 because the Node24 distribution bin directory preceded the isolated npm11.19.1 bin directory on PATH. The exact2.9 cache simulation directly invoked isolated npm11.19.1, so that evidence remains accurate. Initial full attempts are explicitly npm11.19.0 reporter/helper diagnostics, not required npm11.19.1 acceptance. Path binding detected this setup error before approval. Corrected order resolves Node24.20.0 and isolated npm11.19.1 and is recorded with command -v and versions in the final toolchain binding. No code/test change follows from this toolchain setup correction.

Independent cache-integrity negative: separate disposable bundle manifest/lock plus a copied successful private2.9 cache, exact npm11.19.1. Changing only locked root SRI to a valid wrong SHA512 makes npm ci --offline fail exit1 ENOTCACHED specifically for the unpublished root2.9 URL. Restoring original lock SRI with the same cache makes the same offline command succeed25 packages/exit0. This isolates integrity matching from registry/transitive cache availability. Raw integrity-negative-{delta.json}, integrity-negative.log and integrity-positive-control.log remain. These diagnostics are outside source; no production lock was edited.

All51 current multiline workflow shell blocks also pass bash -n; shell-syntax.json records each file/line result.

## Final exact-toolchain clean-tag acceptance

PASS: exact immutable00258d7 tag source, original helper and verbatim candidate wrapper, Node24.20.0 and npm11.19.1. Both resolved paths and versions are recorded and asserted before entry (exact-npm11-toolchain.txt). Only short owned TMPDIR corrects the proved macOS socket limitation. Original helper actually executes all four commands and reports81context/437root/6bundle/651MCP pass, zero failures/skips; subprocess exit0. Tracked tag source remains clean. Full collector log exact-clean-tag-npm11-full.log and parsed exact-clean-tag-npm11-proof.json bind commands, output hashes, counts, wrapper/helper hashes, source commit and toolchain.

Earlier npm11.19.0 diagnostic evidence remains explicitly superseded for toolchain acceptance; first134-byte socket failure is classified and retained, never reported as a pass. This is macOS actual execution, not native Ubuntu acceptance. Required exact-head PR native all-gates success and actual reviewed-main immutable Publish/registry completion remain manager/root responsibilities.
