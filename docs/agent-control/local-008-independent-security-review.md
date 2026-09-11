# WO-LOCAL-008 independent Security / Contract / Code Quality review

APPROVE the four exact source hashes in source-hashes.json for coordinated draft/native preflight. No unresolved blocker, major, or minor finding. Complete original helper passes81/437/6/651 on exact immutable tag with Node24.20.0/npm11.19.1 and the documented macOS TMPDIR correction. This is source/local validation approval; native PR/release gates and actual publication remain required.

Fresh reviewer assigned before implementation; isolated reviewer clone at31af0dae28b106ef916fdf8bed24cda450cdb498 and separate untouched-tag fixture at00258d7fe40c58fa54e0723236e452630feb7009, tree72c8ef3565a8b1b102da738de41c821cab6cb997. Original/prior trees read-only, manager sole branch/control-doc writer. No remote writes or release/auth mutations by this reviewer.

## Source and trust contract

Existing release-publish.yml gains explicit Boolean recover_2_8 dispatch, admitted only for workflow_dispatch on refs/heads/main. Normal dispatch still requires strict tag. It selects fixed v2.8.0 and verifies annotated objecte07de9de09e57ddf6375df72c241ba7c5b7ae8f5, exact checkout commit/tree, peeled target, and clean tracked state before tagged code executes. All actual checkout helpers/tests/packages remain immutable. Workflow ref/SHA are recorded separately from checkout tag/object/commit/tree; GitHub environment is never rewritten to impersonate tag provenance.

Same filename, owner/repository, hosted runner, Node24/npm11.19.1, OIDC permissions, provenance flag, ordered dual publication, exact-registry safe resume, six audits, containment/frontend, pinned real Harness, empty-cache installs and final registry Harness remain. Recovery additionally verifies original Bump root/bundle SRI and actual SHA256 before publication. Official npm trusted-publisher documentation binds required owner/repository/workflow filename and optional environment; GitHub OIDC documentation defines trigger ref separately from workflow ref/SHA. Existing filename preserves documented identity; historical root publication is evidence, while actual current settings for both packages are not observed. Actual hosted publication remains required; no fallback token/auth change is approved.

Sources: https://docs.npmjs.com/trusted-publishers/ and https://docs.github.com/en/actions/reference/security/oidc .

## Original executor and gates

Extracted inline wrapper SHA2562b82f1c5a97d66f0e0bf3ae388b5b439bb207070fd1a6e501a8abf5622285644 imports original tagged runFreshCheckout and executeChild. Only exact npm + [test] + root cwd receives a copied env with NODE_OPTIONS=--test-reporter=tap. Nonempty inherited parent NODE_OPTIONS rejects before helper execution. All other options/env/commands pass unchanged, especially MCP's explicit spec reporter. Original output capture/limits, error classification, count parsing and fail-closed early stopping remain. No generated summaries, hidden tests, changed production/helper source, or gate waiver.

Preflight/Bump remain Node22. Their original locked bundle npm ci moves after exact simulated-version seed/synchronized lock creation. npm cache add supplies the exact immutable root content for locked prefer-offline resolution of an unpublished next version; original local artifact binding remains. Both workflows share the same gate block. This does not dispatch Bump or publish2.9. Ops owns independent initially-empty-cache proof. Main orchestration tests run in main PR preflight; tagged tests inspect tagged workflows and cannot stand in for main source validation. New cases fit existing test declarations, preserving counts.

## Independent evidence

- Exact-tag Node24 pack independently reproduces both complete packet SRIs and SHA256, root988282/bundle10260bytes (seed-report.json). Installed this exact root into own bundle dependency tree; own isolated npm11.19.1 used for full proof.
- wrapper-probes.json:24 scope and positive/negative probes execute exact extracted wrapper body. Only exact root child changes; parent/options identities retained otherwise; nonempty env fails before helper; unchanged original helper rejects each context/root/bundle/MCP count drift, missing/wrong reporter summaries and nonzero exits, stopping at same command boundary.
- reporter-real.json: four actual Node24.20.0 executions prove default spec, inherited TAP, explicit spec, and inherited TAP+explicit spec's required exit1 reporter/destination conflict.
- guard-probes.json:12 extracted-shell probes. Actual exact clean-tag identity passes; independently wrong type/object/HEAD/peel/tree/dirty reject. GNU coreutils9.4 in packet-authorized owned Linux container accepts original bytes and rejects root/bundle SRI mismatch or independently corrupted tarballs. Own container fixture removed. macOS sha256sum lacks GNU --strict, so that local execution was not mislabeled success.
- focused-main.log: original focused47 declarations,46pass/1Linux-only skip/0fail on macOS. Native47/47 remains required.
- source-review.json: Cortex diff review ok, four paths, one eligible/reviewed test code file, zero findings/conflicts. YAML reviewed directly. Six rules, refreshed seven-file lexical+graph index, final four per-file patterns all succeed. Initial preflight/Bump pattern lookups failed target-not-indexed, retained separately. No provider/embedding update; tracked config restored; watch stopped. Diff whitespace passes.

## macOS fixture path correction

First original full helper run exact-tag-full.log passed context81/root437/bundle6, then failed MCP650/651. Failure is original socket transaction test at scaffold/mcp/tests/analysis-state-trusted-writer.test.mjs366/375: listen EINVAL errno−22 on134-byte canonical macOS TMPDIR socket path. Local SDK sys/un.h79 has sun_path[104]. The fixture's makeRoot resolves the macOS long temp path; no test/runtime change caused it.

Exact unchanged test independently reproduces1/1failure with default temp root (socket-long-tmp.log) and1/1pass with owned /private/tmp/c8s (socket-short-tmp.log), zero skips. This causally justifies one original clean-tag full rerun with only TMPDIR=/private/tmp/c8s; first failure stays recorded. Native Ubuntu gates remain authoritative. Final corrected run result will be appended.

## Manager context command incident

Manager update --help actually launched update and embedding stage; retained model config/tokenizer plus209636334-byte partial ONNX prove actual model-resource download. Source embed.ts1117–1130 awaits local model initialization before later local runWorkUnits1182. Installed transformers hub.js70–72 fetches resource URL with headers and no repository-text request body in that path. This supports a model-download classification; without network trace no categorical absence-of-source-upload claim is justified. Manager killed owned process tree, exit143, no embedding snapshot/inference result observed, retained inventory/hashes/log, removed only newly owned model cache and restored explicit scoped ingest/graph workflow. Root informed and directed continuation. Candid report closes process finding without claiming the unauthorized download did not occur; release source/tag/package integrity is independently unchanged.

## Final corrected exact-tag outcome

Original full helper completed exit0 with actual81context/437root/6bundle/651MCP, all passes and zero failures, skips, cancellations or TODO. Exact extracted wrapper and all original helpers/tests stayed unchanged; final git status is clean and tag/object/commit/tree still match packet. Node24.20.0 and isolated npm11.19.1 are bound in final-runtime-binding.log with the same PATH/TMPDIR as the full invocation. Original long-path650/651 failure remains evidence, causally corrected solely by owned short TMPDIR.

Full log: exact-tag-full-short-tmp.log; five original JSON reports: full-reports.json; toolchain/tag/source/log hash binding: final-validation-binding.json. Final refreshed Cortex diff review (final-source-review.json) succeeds with zero findings/conflicts. Both SRIs/SHA256 and original seed sizes remain exact. Source hashes rechecked equal manager. Commit binding follows manager commit; no native/publication approval is implied.
