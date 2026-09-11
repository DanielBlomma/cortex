# WO-LOCAL-005: finish hosted release gates and publish Cortex 2.8

Fresh-session packet, 2026-09-11. Profile: Infra/deploy/security-sensitive.
This is a context-window handoff, not a request for user reconfirmation.

## Authority and boundaries

User authorized resolving adm-zip, final release tests, merging PR #130,
Release Bump/Publish 2.8.0, then updating the existing global CLI. Root reiterated
that required read-only PR preflight and the clean-tag test repair are within
scope. No gate waiver, ignored failure, assertion-deadline relaxation, provider,
embedding or unrelated indexing operation is authorized. Necessary checked-in
release-test lexical+graph context on repo/scaffold fixture paths is permitted.
Original /Users/danielnilsson/GIT/cortex and prior reviewed trees stay read-only.
Root owns the eventual /opt/homebrew CLI update after real publication.

Start a NEW isolated clone of the manager source below. Use this packet and its
direct references only. Assign fresh Security/Contract and Ops/Validation
reviewers before any new implementation; root + manager + two reviewers fits
four slots. Prior agents' exact review reports can support unchanged source.
Manager remains sole branch writer and coordinates exact HEAD before pushes.
Use git -c core.hooksPath=/dev/null for writes, and never force-push or rewrite a
published tag. Do not ask the user to restart or reapprove already authorized work.

## Source and remote identities

Manager source: /private/tmp/cortex-local-004.KRx8g8/repo.
Release dependency source 52bd6751e4e512c08a91ec533d623201a707eb40 changes only
adm-zip lock version/URL/integrity 0.6.0→0.6.1, preserving existing ^0.6.0 override,
ONNX 1.24.3, Transformers and every other locked resolution.
Read-only PR preflight + contract tests are independently approved at
0b1d53c9efc821f1f7c1ee96b6ab4f1889ded0f4.
Clean-tag CLI test repair is independently approved at
7699afb815b475fc7fe61acf711d8d0635795de3. Later local commits are control docs only.

At packet preparation, remote PR #130 is OPEN/draft at 0b1d53c; main is
37a511fa76ce04804f6cf4497202966dd78ff1f0. No merge/tag/Bump/Publish/CLI update yet.
No v2.8.0 tag or npm 2.8.0 root/bundle exists at last measured preflight start.
Recheck current external state before any dependent action.
GitHub synthetic merge f6b2db9b30b39472a9dcd343f88b942600f5d0e6 has tree
a83316c8930f4f7044cc11aff70fbf545b7f9243, matching local merge-tree on 0b1d53c/main.

## Completed hosted run — actual failure

Release Preflight 34595569328:
https://github.com/DanielBlomma/cortex/actions/runs/34595569328
Job 103250410890. This run binds remote head 0b1d53c and the synthetic merge above.
It passed setup, exact simulated 2.8 metadata and local bundle binding,
focused tests, full root/bundle, MCP, executable pristine fresh checkout,
six audits, packed containment, frontend, pinned Harness source contract,
duplicate artifacts and empty-cache dual install. It FAILED the full packed
Harness lifecycle on actual Ubuntu x64 at 11:57:45 UTC with exit 1:
`Release artifact validation failed: Web profile did not stop within 10 seconds after SIGINT`.
The final diff/boundary step was not reached. No merge/release GO exists.

Full raw log and job/step JSON are preserved:
/private/tmp/cortex-local-004.KRx8g8/hosted-preflight-34595569328.log
/private/tmp/cortex-local-004.KRx8g8/hosted-preflight-34595569328.json
Historical reviewed artifact report extracted from that log:
/private/tmp/cortex-local-004.KRx8g8/hosted-preflight-artifact-report.json
These are actual first-run evidence for 0b1d53c, not final7699afb acceptance.
Native failure means diagnose helper versus actual pinned Harness lifecycle;
do not assume helper-only, waive shutdown, or inflate its ten-second deadline.

7699afb must receive its own required hosted validation before merge because
query-cli.test.mjs ships inside the root artifact. Earlier artifact hashes are
historical evidence, not the final artifact identity. The first run has completed and its logs are preserved. Current local reviewed
7699afb was deliberately not pushed into a duplicate known-failing run; include
it with the next independently reviewed lifecycle correction.

## What was validated and independently reviewed

Read these direct reports and their referenced source/tests:
- docs/agent-control/local-004-release-completion-report.md
- docs/agent-control/local-004-independent-security-review.md
- docs/agent-control/local-004-preflight-security-review.md
- docs/agent-control/local-004-clean-tag-security-review.md
- docs/agent-control/local-004-ops-validation-review.md
- docs/agent-control/local-003-release-readiness-review.md (restored release gates)
- docs/agent-control/workflow-playbook.md, review-iteration-protocol.md,
  scaffold/AGENTS.md; repo Cortex skills under plugins/cortex/skills.

Mac validation on dependency candidate: six audits all zero; locked native MCP
install/build and ONNX tensor/sharp round-trip/Transformers import; root 81
context + 437 root + 6 bundle; MCP 651/651 in simulated eight-file 2.8 fixture;
focused 41 pass + one Linux-only skip (42 total); frontend and packed gate all pass.
Package inventory 465 = 444 mode0644 +21 mode0755, inventory SHA256
b57403ef4d5f9e59946eaf130e361f55114e378ab4da3a4918cf1c1207811a1e.
Ownership 423 managed/96 runtime; historical upgrade 110 changed/43 new,
110 hashes verified. Four frozen Git-ignore source/test hashes remain unchanged.

Security verifies all 20 published adm-zip files against official tag/gitHead,
both npm signatures, and 122 upstream tests. Manager temporary fixtures observe
rejection with original sibling bytes intact in all four extraction modes and
normal extraction passes. Existing predictable ONNX temp-root trust and
pre-check/write races are explicit minor baseline risks; no complete race-hardening
claim. No unsafe downgrade, scanner masking or override change.

Ops independent simulated Linux x64 artifact/install/negative/profile gates pass;
see report for exact historical hashes. Four black-box negatives reject nonempty
output, wrong installed version, generated-context precondition and corrupted
bundle integrity, with a valid exact artifact baseline. Profile evidence confirms
boot, network denial, two roots, four real commands, exact four tools/five skills,
four denial cases and all three disposal callbacks. This is NOT full Web lifecycle
success by itself.

## Diagnosed failures; do not repeat or hide them

1. Existing upstream ryugraph 25.9.1 linux-arm64 prebuilt is x86_64 ELF machine62.
   npm install scripts DID run; lifecycle-policy hypothesis was retracted.
   Actual release platform is Linux x64. No npm/OIDC policy changes were made.
2. Emulated x64 container without init left a killed owner zombie; Docker --init
   fixed this, then 81/437 full root passed.
3. Emulated bundle ESRCH assertion raced zombie reaping (10/11 unchanged targeted
   runs pass; failure was Z-state then absent, no executing leak). No assertion
   or deadline changed. Native hosted root/bundle and pristine already pass.
4. Local emulated Harness failed exact message: Web profile did not stop within
   10 seconds after SIGINT. pnpm's child shell/node/esbuild remained after its
   leader was killed; task-owned group3973 was cleaned. Full shutdown/removal
   NOT claimed. Native run decides whether this needs a real helper repair.
   Direct relevant code: scripts/release-artifacts.mjs webSmoke (around556-608)
   currently sends child.kill(SIGINT), then child.kill(SIGKILL) on timeout.
   Inspect actual hosted logs before implementing a fix; never weaken the gate.
5. Publish uses a clean immutable tag, unlike Bump/preflight's eight metadata
   changes. Old query-cli test's ambient observed_count>0 was invalid. 7699afb
   replaces only this with exact observed == items.length + omitted accounting,
   retaining schema/determinism/byte/no-mutation checks. Dedicated review tests
   own exact positive-five-path and clean-zero fixtures. Both reviewers reproduce
   original clean failure, then fixed clean CLI18/18, clean/dirty targeted modes
   including real eight-metadata state, and review suite29/29. No production
   behavior, test count or release guard changes.

Six historical standalone benchmark failures still require an unavailable
external frozen packet. Do not run benchmarks/providers or invent that fixture.

## Remaining concrete sequence

1. Diagnose the confirmed native Web lifecycle failure using the preserved logs,
   assign fresh independent reviewers, repair only proved helper/fixture cause,
   preserve isolation, real commands, exact artifacts, shutdown/removal and all
   other gates. Existing guards and no-waiver rule are binding.
2. Integrate 7699afb and any newly reviewed fix. Update durable control reports,
   obtain final source sign-offs, coordinate expected remote HEAD with root,
   fast-forward PR #130. Keep draft until exact final-head hosted preflight passes.
   Recheck main, synthetic merge tree, run identity and PR reviews/check state.
3. On actual accepted green gates, ready and merge using expected-head guard.
   User authorization already covers it. Use the existing Release Bump workflow
   on main with release_type=minor, then monitor Bump and triggered Release Publish
   through true completion. Bump uses Node22, Publish uses Node24, npm11.19.1;
   both preserve main/tag identity, eight-file staging, atomic push and OIDC.
   No immutable tag while a known required gate still fails.
4. Verify annotated v2.8.0 object/peeled commit/main/source tree; fetch real run
   logs and exact local reviewed root/bundle integrity and bytes. Verify registry
   name/version/latest, bundle's exact root dependency, dist.integrity and
   downloaded tarball SRI/SHA256 against those actual publication artifacts.
   Run helper install-registry in an empty temporary cache/directory and check CLI.
   Registry tag/version alone does not prove Publish succeeded.
5. Notify root with exact successful runs, tag/commit, both package identities
   and registry artifacts. Root installs pinned 2.8.0 into existing /opt/homebrew
   prefix (active npm default is NVM), then verifies command -v cortex/version.
   Root records standalone CLI evidence and sends it for durable final reports.
   Never modify/rewrite immutable tags for administrative report updates.

## Evidence locations and tools

Manager logs: /private/tmp/cortex-local-004.KRx8g8 (audit-0..5.json, root-tests.log,
mcp-tests-simulated.log, packed.log, preflight-focused-final.log, Cortex outputs,
preflight-pr-identity.json, report-draft.md). Ops logs/artifacts:
/private/tmp/cortex-local-004-ops-evidence, detailed index in its review report.
Security logs/fixtures: /private/tmp/cortex-local-004-security.yviHNJ.
Existing x64 container cortex-local-004-ops-x64-init is idle with only init/sleep;
no further emulator retries are needed. Do not touch unrelated Docker containers.

Use node bin/cortex.mjs (global CLI2.4.1 is too old). Scoped ingest.sh + load-ryu.sh
replace normal embedding-triggering update; restore tracked context config before
commits/packing. Mac cp -cR can clone ignored deps/runtime from manager tree;
install only into your own clone. Watch is stopped. Cortex rules/patterns pass
for final source; initial lock guidance and some combined doc-heavy reviews fail
safely, recorded as tooling limits rather than false policy passes.
