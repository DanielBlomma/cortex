# WO-LOCAL-004 independent Ops / Validation / Integration review

Reviewer assigned before implementation; separate clone `/private/tmp/cortex-local-004-ops-review`. Package/runtime source reviewed: `52bd6751e4e512c08a91ec533d623201a707eb40`. Final preflight source reviewed: `0b1d53c9efc821f1f7c1ee96b6ab4f1889ded0f4`.

**APPROVE final preflight/source for coordinated draft push. No merge/release GO from this report. Actual hosted Ubuntu x64 preflight must pass.** All source findings raised by this reviewer are closed. Local emulator pristine and complete Harness lifecycle did not pass; details below must remain explicit. No safety assertion, timeout, release guard or audit gate was weakened.

## Authority, isolation and environment

Manager alone owns implementation/branch writes. Reviewer made no remote writes, publication, tag, merge or global CLI update. Original historical checkout untouched. No external model/embedding provider call, broad background index or hooks. Reviewer Cortex index stayed scoped; the executable release fixture used the normal checked-in lexical+graph scope after manager relayed root authorization.

Linux test source is a separate clone inside Docker. Six dependency trees were installed with committed locks; no macOS native modules were copied into Linux. Final environment: Ubuntu 24.04.4 x64 under Docker/OrbStack emulation, Node 22.23.2, npm 11.19.1, .NET 8.0.424, non-root UID/GID 1001. Base image `cortex-wo069-runner:noble-amd64-sudo`, ID `sha256:6a240d1f4f14d9e9c895eb1a695c77b9b2c5adb067a374642621659e0c6bb9c4`. Docker used `--cap-add SYS_ADMIN --security-opt seccomp=unconfined` for the existing sudo/unshare helper, and finally `--init` for orphan reaping. Helper itself drops identity/capabilities and asserts no-new-privileges. Image base HOME ownership was corrected before validation; no generated session/profile permissions were repaired.

Current retained container: `cortex-local-004-ops-x64-init`. Its dependency snapshot ID is `sha256:8dce54f1db6c5862a8a80e1cd0bdb936a851df903c70cefc7f15d3d9c91793d9`. This is local emulation evidence, not a GitHub-hosted run.

## Measured gates

| Gate | Independent result |
| --- | --- |
| Six Linux locked dependency installs; trusted MCP build | PASS; MCP install audits 211 packages with zero findings |
| Linux native import | PASS ryugraph on x64; adm-zip 0.6.1 installed |
| Simulated minor metadata and seed root artifact | PASS 2.8.0, exact eight-file mutation set, sync/check against seed, exact local root binding into bundle tests |
| Focused release tests, Linux source 52bd675 | 42/42 PASS, zero skips, including actual network/identity isolation |
| Pristine helper, x64 with init | Context 81/81 and root 437/437 PASS; bundle 5/6, so helper exits 1 before MCP stage |
| Packed filesystem containment, simulated 2.8 | PASS 465 entries; 48 boundary / 3 characterization / 4 development + 4 packed dashboard cases |
| Packed modes and ownership | 444 mode 0644 / 21 mode 0755; 423 managed / 96 runtime |
| Historical v2.4.2 upgrade | 110 changed / 43 new / 110 state hashes checked; config, ontology, unknown data preserved |
| Frontend build, x64 | PASS |
| Duplicate local root and bundle packs | PASS exact byte/inventory twins; root seed integrity equals final root |
| Empty-cache dual artifact install | PASS CLI 2.8.0, exact bundle dependency and npm ls |
| Pinned Harness source | PASS 18 files at b150a551b8d465e31e418e1b2eaf5e79bbb7d28e |
| Installed Harness profile gate | PASS real local commands, isolation, discovery, negative cases and disposal; details below |
| Complete Harness headless/Web lifecycle | FAIL Web shutdown within existing 10-second bound; removal phase not reached |
| Independent black-box negative gates | 4/4 PASS, with unmodified positive artifact baseline |
| Exact final preflight focused suite, macOS | 42 total, 41 PASS, zero fail, one Linux-only skip |
| Diff whitespace check, 98ad614..0b1d53c | PASS |

No independent full Linux MCP or full pristine-success claim is made. Manager's separately measured macOS full matrix/audits are not relabeled as independent reviewer runs. The six known standalone benchmark tests needing the external frozen packet remain an inherited limitation, not silently excluded or executed here.

## Artifact identity

Root: 987,393 bytes, 465 entries; SHA256 `29c07f62a5bbc4f3871f0d7055dc785a5de01f9247cd5f90f0b4f1977bdc0340`; npm integrity `sha512-E1zLTfR3VZAN7t4G124stTpcRlfR2LHh7W9RPFTd1xmlBLQb4Kijq/ko4bgW8pQi+3gUdu4bwnrPxjRwGuqZCw==`.

Bundle: 10,260 bytes, exactly 12 entries; SHA256 `6f00ac246fd77630bcb8f173e63a1c06205dcbf6b1b7617ac4cc4cad0b78d59c`; npm integrity `sha512-+vARd84pIBwxaa7kY0eA5FDV8fhgaE1ltZa55W0Y4w6ofriI5nf4gsebl7gtDxvw5Icbq/a8k2OehGEdCCNfPA==`.

Packed root inventory SHA256 `b57403ef4d5f9e59946eaf130e361f55114e378ab4da3a4918cf1c1207811a1e`. Artifacts copied to host `artifact-files/` and independently rehashed against original report. These are simulated local artifacts, not published registry artifacts. Later preflight/test/control-only commits do not change packed input inventory.

## Exact failure classification

1. Initial ARM64 container could not load ryugraph. `ryugraph@25.9.1` supplies a linux-arm64 prebuilt with ELF machine 62 (x86_64), matching the x64 prebuilt; native file existed but had the wrong architecture. Initial npm install-policy hypothesis was retracted: debug logs prove install.js ran and exited 0. Switching to the release workflow's x64 architecture resolved loading. Retain the upstream ARM64 compatibility limitation separately.
2. First x64 container had PID 1 = sleep; interrupted-resume test failed because its killed owner remained an adopted zombie, correctly rejected by fail-closed identity logic. Docker --init resolved this infrastructure mismatch. First attempt had 81 context passes and root 436/437.
3. With init, root 437/437 passes; bundle's settled-leader cancellation test immediately demanded ESRCH after the runtime promise rejected. Independent Security observed 10/11 targeted unchanged-assertion passes; failing process was state Z, PPID 1, then disappeared. Runtime intentionally treats all-Z/X/x groups as exited. No executing descendant leakage was observed. This is evidence about the local race, not a gate waiver; hosted full tests remain required.
4. Full local Harness lifecycle later failed exactly: `Release artifact validation failed: Web profile did not stop within 10 seconds after SIGINT`. The profile gate, both --help commands and Web HTTP startup had completed. pnpm's child shell/node/esbuild remained after its leader was killed. Only those task-owned descendants were cleaned via their observed process group 3973 with SIGINT; no retry or timeout change. Final Web shutdown and profile removal are not claimed successful.

## Installed profile and independent negative evidence

`profile-gate-report.json` confirms installed profile boot; package-owned CLI with PATH unable to supply cortex; denied outbound networking; two isolated indexed roots; real search, rules, related and impact; four tools and five exact packaged skills; timeout, cancellation, malformed and oversized output rejection; first agent, second agent and bundle disposal. Full lifecycle does not succeed merely because these intermediate checks pass.

Separate fixture `/tmp/negative-gates-repo` avoided mutations to the active Harness source. Black-box tests require exit 1 and the specific diagnostic for nonempty artifact output, wrong expected installed version, generated-context precondition and corrupted bundle root integrity. Its unmodified positive pack matches both reviewed artifact hashes, proving a valid baseline. Initial reviewer harness expected a plain exception string for the generated-context case; corrected to the actual bounded diagnostic code `CORTEX_GENERATED_CONTEXT_PRESENT`, preserving failure/code requirements. Both attempt logs retained.

## Preflight source review closure

New workflow runs on pull_request to main, default merge-ref checkout with persist-credentials false, contents:read only and hosted Ubuntu. No secrets/token/OIDC grants, publication, staging, tag or push commands. Every shared executable gate matches Release Bump, excluding Git author and release mutation/push. Dynamic next minor derives from checked-out metadata through GITHUB_ENV, so future ordinary PRs are not pinned to 2.8. Existing Release Bump/Publish one-shot targets and all publication safeguards remain unchanged.

Tests reject pull_request_target, write permissions, persisted credentials, self-hosted runners, explicit secret token, npm publication, job-level if/continue-on-error bypass and wrong target arithmetic. Existing fail-closed executable/body/order/exact-artifact mutations also cover preflight. Reviewer EOF whitespace finding and future fixed-target concern are closed in exact commit 0b1d53c. Independent focused tests and diff check pass as listed above. No unresolved source finding; hosted workflow completion remains acceptance authority.

## Durable evidence and continuation

All paths below are relative to `/private/tmp/cortex-local-004-ops-evidence`:

- Exact commands: `run-gates.sh`, `resume-gates.sh`, `remaining-gates.sh`, `negative-gates-isolated-v2.mjs`.
- Execution: `gate-driver.log`, `gate-resume-driver.log`, `remaining-gate-driver.log`, per-gate logs; first ARM64 logs under `arm64/`.
- Failure: `pristine-fresh-attempt1-no-init.log`, `pristine-fresh.log`, `harness-lifecycle.log`, `post-harness-processes.txt`, `web-group-cleanup-processes.txt`.
- Artifact/install: `artifact-report.json`, `artifact-summary.json`, `seed-pack.json`, `artifact-files/`, `packed-containment.log`, `empty-cache-install.log`, `installed-tree.log`.
- Positive/negative profile: `profile-gate-report.json`, `negative-report.json`, `negative-baseline-report.json`, `negative-driver-v2.log`.
- Exact source review: `preflight-final-focused.log`, final Cortex JSON/logs, `x64-source-state.txt`.

Used repo using-cortex, context-review and pattern-review skills. Scoped search identified runFreshCheckout and workflow validator entities; six rules returned. Final preflight workflow/test pattern calls succeed with local evidence. Lock pattern call succeeds with weaker fallback advisory evidence. Missing embeddings are explicitly lexical-only. Temporary tracked config restored; reviewer Git tree clean. No all-green combined Cortex review is claimed.

Next: monitor actual hosted preflight on reviewed head/merge tree; resolve concrete failures through independently reviewed changes. Do not merge or dispatch immutable release until required hosted gates pass. No more emulator retries are authorized by the current manager instruction; reviewer remains available for actual hosted findings.

## Clean Publish test repair — 7699afb

Follow-up source: `7699afb815b475fc7fe61acf711d8d0635795de3`. Publish's tagged tree does not mutate release metadata: pack and sync --check are read-only; local bundle install disables save and lock mutation; builds/context state are ignored. The query CLI integration test created no owned change but required observed_count > 0. Dedicated review.test.mjs already requires zero on a clean fixture and exact owned positive paths/statuses on dirty fixtures. Fabricating a tracked Publish diff would violate this contract.

Independent original targeted test failed exactly at the positivity assertion on a clean reviewer Git tree. Fresh scaffold runtime JSON reported ok:true with observed_count 0, omitted_count 0 and empty items. The repair replaces ambient positivity with complete collection accounting and retains success/envelope, repeated-result determinism, output bound, path masking, and all state byte/mtime checks. No runtime, timing, release gate or count-total change.

Independent exact candidate execution:

- Clean Git: targeted integration test 1/1 PASS; runtime JSON observed 0 / omitted 0 / items 0.
- Real simulated 2.8 mutation: npm minor + exact root seed + metadata synchronization yields precisely eight release metadata files; targeted integration test 1/1 PASS, runtime JSON observed 8 / omitted 0.
- All eight metadata changes restored; reviewer Git tree clean. Diff whitespace check 0b1d53c..7699afb PASS.

Logs: `publish-clean-original-test.log`, `publish-clean-runtime-review.json`, `publish-clean-fixed-test.log`, `publish-dirty-runtime-review.json`, `publish-dirty-fixed-test.log`, `publish-review-dirty-paths.txt`, `publish-review-final-git-status.txt`. Initial bin shim review attempt returned `INVALID_ARGS: Review failed safely`; this tool limitation is retained in `publish-clean-review.json`. The test's actual fresh scaffold runtime returned valid complete zero-diff output and is the behavior tested above.

**Artifact caveat:** query-cli.test.mjs is shipped under scaffold/mcp/tests, so this fix changes root tarball bytes and the bundle lock's predicted root integrity. The 52bd675 artifact hashes in this report are historical validation only; a new preflight/release pack must bind the final 7699afb package bytes. Counts/inventory remain unchanged. Full clean MCP and dedicated positive/no-diff fixture evidence are manager/Security-owned; this reviewer claims only the independent targeted modes above.

Ops **APPROVES 7699afb815b475fc7fe61acf711d8d0635795de3 for the reviewed PR update**, with the hosted acceptance conditions unchanged. Refreshed scoped Cortex search/rules and query-cli test pattern evidence succeed with local evidence. No open source finding; final artifact revalidation and actual hosted gates remain required before merge/tag.
