# WO-LOCAL-004: resolve adm-zip and complete Cortex 2.8 release

Fresh-session packet, 2026-09-11. Profile: Infra/deploy/security-sensitive.

## Authority

User requested new release bump/update, explicitly approved local CLI update after
publication, and now said “kör på då” after the five remaining steps were listed:
resolve adm-zip, final release tests, merge PR130, publish2.8.0, update local CLI.
Proceed through all authorized steps without repeated permission questions when
required gates pass. No gate waiver, scanner suppression, unrelated work,
provider call or broad embedding/index run. Original historical checkout remains
read-only. New user direction does not mean bypass audit.

## Fresh state

Read `docs/agent-control/local-003-release-readiness-review.md` and its two review
reports, workflow-playbook.md, review-iteration-protocol.md, scaffold/AGENTS.md.
Reviewed source tree `/private/tmp/cortex-release.JjNEyG/repo` clean at
51a276723999cd48ca082fba7f66ae29148b653a before this untracked packet was added.
PR130 https://github.com/DanielBlomma/cortex/pull/130 is OPEN/draft,
head51a276723999cd48ca082fba7f66ae29148b653a, main37a511fa76ce04804f6cf4497202966dd78ff1f0.
Source review binds31fc32e; later commits are docs only. Use a NEW isolated clone.
User original `/Users/danielnilsson/GIT/cortex` must not be staged/reset/merged or
changed. Root has a preservation snapshot of770nonignored files at
/private/tmp/cortex-local-002-original-hashes.json and original Git status at
/private/tmp/cortex-local-002-original-status.bin.

## New primary evidence, Sept11

`npm view adm-zip version dist.integrity --json` now returns0.6.1,
integrity sha512-Xwrja8nx9e5o2N1my4DsKCeKpdrnACyr1wtbPxBDgGzKzKyE9kRtBFA8mWldI+RVlD7CBZNWY/wQ2+ydwOR6kQ==.
Previously0.6.0 was latest and blocked release. Advisory GHSA-vwc7-r8mq-g2x9 still
says patched versions None and affected0.5.9–0.6.0, so independently inspect new
package source/provenance/patch behavior; do not mistake audit silence for proof.
Upstream PR575 remains OPEN at7d90dea2bfd35bc4761d6c8cf822f26b59aeef77.
Latest onnxruntime-node1.29.0 depends adm-zip^0.6.0; Transformers4.2.0 still pins
onnxruntime-node1.24.3. Keep current ONNX/Transformers if0.6.1 provides safe fix.
Use official npm/GitHub/advisory sources to verify current state.

## Existing readiness

local-003 restored release validation and explicitly targets2.7→2.8. Metadata is
still2.7.0; no tag/merge/publication/CLI update occurred. Passed root81context+
437tests+6bundle; MCP651; packed465entries/48boundary/3characterization/4+4dashboard,
423managed/96runtime,110changed/43new upgrade; frontendbuild; focused41pass1Linuxskip.
Five audits clean, MCP3moderate all fromadmzipchain. Four reviewed Git-ignore source
hashes unchanged (local-002 report). Full pristine fresh-checkout, simulated2.8
artifact/empty-cache/Harness and actual Linux release gates still need execution;
previous reports explicitly did NOT claim these. Six unrelated standalone tests
need absent external benchmark fixture; keep their limitation explicit, no benchmark
execution or silent exclusion. Existing workflow source is authoritative.

## Work and review

Fresh manager owns this work order with fresh independent Security/Contract and
Ops/Validation agents assigned before implementation. At most4active agents total
including root, so manager may spawn2reviewers. Each reviewer uses separate clone.
Root only relays user/status and handles authorized local CLI update after verified
publication. Send progress and exact final HEAD before fast-forward push of PR130;
no other branch writer. Do not force push or merge past failing gates.

1. Inspect and reproduce the0.6.1 security fix, make minimal compatible locked update,
   run six audits and native/runtime compatibility tests. If new package not fixed,
   investigate bounded supported alternatives without hiding vulnerabilities.
2. Complete previously deferred pristine/artifact/install/Harness validations and
   meaningful negative tests; run appropriate full regression/package gates once
   final relevant changes stabilize. Preserve exact counts/modes/ownership/integrity,
   OIDC, immutable tag and root/bundle order and exact artifact checks.
3. Record independent reviews and durable current manager/handoff/matrix/risk/report
   state. Update PR130 after final review, verify head/merge-tree/current CI state.
4. When required pre-merge gates pass, ready and merge under existing user authority;
   dispatch Release Bump on main with minor input; monitor Bump+Publish through real
   completion. Do not claim release from dispatch/tag alone. Resolve concrete gate
   failures safely; never move/rewrite published immutable tags.
5. Verify exact2.8 root+bundle registry artifacts and clean install; notify root so it
   updates existing global CLI at /opt/homebrew, not active NVM npm default prefix.
   Root verifies `command -v cortex` and version after install. Current2.4.1 binary:
   /opt/homebrew/bin/cortex→../lib/node_modules/@danielblomma/cortex-mcp/bin/cortex.mjs.

## Tools and boundaries

Use repo Cortex skills under plugins/cortex/skills. CLI2.7 is `node bin/cortex.mjs`;
global2.4.1 too old. Search/rules/impact/guidance before edits; patterns/review before
finalization. Fresh scoped lexical+graph only; normal update triggers embeddings
so use separate ingest and graph steps. Restore tracked .context/config.yaml after
temporary scope. Built locked deps/runtime can be copied via Mac cp-cR from
/private/tmp/cortex-release.JjNEyG/repo; no installing into other agents' copies.
Use git-c core.hooksPath=/dev/null for writes to prevent excluded background indexing.
Read current scripts/package commands; no stale hardcoded validation assumptions.
Keep report text readable with spaces between words/versions/counts. Stay within one
bounded context; save exact durable state before compaction, not after.
