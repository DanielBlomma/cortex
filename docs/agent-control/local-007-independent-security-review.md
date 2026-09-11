# WO-LOCAL-007 independent Security / Contract / Code Quality review

APPROVE exact candidate test SHA256 `6d337c598caef11c5b9d3cdf2665379e04c91629a7ce3232d9cf35612041fac1` for coordinated draft PR/native preflight. No remaining blocker, major or minor finding. Source/test approval does not replace the actual final-head native release gates or classify the historical failure.

Reviewer assigned before implementation; isolated clone `/private/tmp/cortex-local-007-security` at base `c7ce1a9c0c22e19b772e2bf7b989b65904855e04`. Prior trees read-only. Manager alone writes the release branch/remotes. Reviewer used only packet/direct references and authorized ignored runtime copies; no providers, embeddings, broad indexing, hooks, package install or release mutations.

## Independent causal evidence

Reviewed the failed native log34598916068: TIMEOUT rejection succeeded, immediate ESRCH did not. There is no failure-time process state or identity; historical native cause remains unclassified.

Independently audited and executed Ops's deterministic Python subreaper witness once, using original test with diagnostic reads around the unchanged assertion. Actual provider and pinned subprocess library were unchanged. PID8262, starttime20009226, process group/session8255, observed live S then Z after TIMEOUT. Original immediate assertion failed at3047.6ms. The supervisor deliberately held adopted-child waitpid; kill0 still succeeded. waitpid returned SIGKILL9, then both ESRCH and absent /proc were verified. This proves the general dead-record/reaping mismatch, not the old native failure's state or native gate success. The Linux x64 container is emulated.

SHA256 comparison of Linux witness versus own locked source proves identical provider `d1c8d7ccc34ed23884da766a57806a8a72da4dcb861b7c52c19100d49fd7b914`, protocol `d30f43865d71a1e620e888ca9a06028dfe3df1eb9fc5704e7544716a258b3af3`, and pinned subprocess library `f3a11b8ad2d3e01ca9943e9ec919465d8d4525e60fdd6904da0d4494fe00c247`.

Direct source: provider92–169 awaits handle.done then handle.waitForExit before reporting TIMEOUT/CANCELED. Pinned @deepseek-ai/dsh-subprocess-local0.1.1-rc.2 lib/index.js315–338,823–847,915–937 considers a settled Linux group with only Z/X/x entries nonexecuting. OS reaping is a separate boundary.

## Contract and code-quality assessment

Only the two settled-leader tests and their private helpers change. Baseline validates positive PID, exact starttime string, process group and session against actual spawned leader handle.pid, and executing state. `/proc/stat` parsing uses the final closing parenthesis, preserving comm with spaces/parentheses and avoiding numeric precision loss for starttime.

Completion first probes ESRCH. A remaining Linux identity must exactly match PID/starttime/group/session and be Z/X/x. Executing, unknown, malformed, unreadable and reused records fail immediately. Every later probe repeats identity/dead checks. Only verified dead records may wait, bounded at1000ms, and successful completion still requires ESRCH. ENOENT alone never proves absence: it requires a fresh ESRCH probe. Non-Linux retains immediate original ESRCH assertion. No provider/dependency/runtime change, timeout/grace extension, test-declaration change, retry-to-green, weakened native count, or release-workflow modification.

Cleanup revalidates identity before SIGKILL and never signals dead, unknown or reused records. Temp removal occurs in finally. The fixture's real2s timeout and1s termination grace remain unchanged;1s reaping bound is separate and never tolerates executing survivors.

## Finding and iteration closure

Major / validation-lifecycle / FIXED: first candidate introduced baseline identity assertions before descendant assignment. A baseline failure in the cancellation test could bypass cancellation, leave an unhandled pending runner until15s default timeout, and remove the fixture before termination. Final candidate attaches an early rejection observer, aborts the fixture-owned controller in after-hook, awaits pending settlement, then performs identity cleanup and temp removal. Timeout controller is used only during cleanup, preserving genuine TIMEOUT assertion.

Independent fault injection throws during readLiveProcess before object assignment for both real tests. Both fail with the injected error as required; total2.253s, both captured child PIDs return ESRCH and both private temp trees are absent. No asynchronous-activity/unhandled-rejection diagnostic. Finding CLOSED.

## Independently executed validation

Raw evidence under `/private/tmp/cortex-local-007-security-evidence/`:

- `independent-subreaper.log`, `witness-{linux,local}-sha256.txt`: deterministic original-test failure, same live→Z identity, held-reap evidence, SIG9 reap and ESRCH; exact runtime identity.
- `candidate-focused.log`: final exact-candidate macOS real settled cancellation/timeout2/2 PASS, zero skips. Baseline2/2 also passed; neither is native release approval.
- `probe-helpers.cjs`, `helpers-final.json`:36 probes execute exact candidate helper source in an isolated VM with fault-injected process/fs/clock operations. Covers immediate absence; Z/X/x→reaped; R/S/D/T/t/I/W/K/P/unknown immediate rejection; each PID/pgrp/session/starttime mismatch; malformed stat, invalid starttime, EACCES, EPERM, ENOENT while PID remains, ENOENT plus fresh ESRCH; continuously zombie failure at1000ms; dead→executing rejection; live owned cleanup signal and no signal for dead/reused/unknown/unreadable; exact large starttime/complex comm parsing; wrong leader and PID0 rejection; strict non-Linux outcomes.
- `probe-cleanup.py`, `baseline-failure.{log,json}`: real baseline failure before assignment validates both owned-process and fixture cleanup paths.
- `candidate-review.json`: Cortex diff review ok,1 changed/eligible/reviewed file, zero findings/conflicts, no omitted files. `final-rules.json`:6 active rules. `final-pattern.json`: same-file fixture/readLivePid/localRuntime evidence. `git diff --check` passes.

Applied using-cortex/change-impact/pattern-review/context-review. Search/impact/related/rules use copied scoped cache, explicitly warning no valid generation-linked graph and missing embeddings; lexical fallback is disclosed, not graph-policy approval. Source review is exact-current diff plus direct reads. Manager separately refreshes scoped context before acceptance. Watch stopped. File-local evidence uses `file:plugins/dsh-cortex/tests/local-subprocess-integration.test.mjs`, `chunk:plugins/dsh-cortex/provider.mjs:CortexCliRunner.run:92-169`, and historical helper/fixture ranges78–83/34–62; advisory patterns do not replace direct assertions.

Actual native complete/pristine81/437/6/651, audits/artifacts/Harness/final boundaries and full Bump/Publish/registry/global-CLI completion remain required. Final commit binding follows manager commit; no broader approval is implied.
