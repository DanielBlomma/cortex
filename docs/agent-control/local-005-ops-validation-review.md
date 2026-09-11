# WO-LOCAL-005 independent Ops / Validation / Integration review

**APPROVE cd7668b779a74a2c1bdb538934ca61f9ff31b8a4 for coordinated draft PR update. This is not merge/release GO; exact final-head native hosted preflight must pass every required gate.**

Reviewer assigned before implementation and started from packet local-005-hosted-release-completion.md plus direct references. Isolated clone `/private/tmp/cortex-local-005-ops`, initial f4dea6c, final detached cd7668b. Manager is sole branch writer. No remote write, provider/embedding operation, hook, publication, tag, merge, or global CLI mutation. Historical trees and existing Harness/profile sources remained untouched. Diagnostic copies reside in `/tmp/local005ops-harness`, `/tmp/local005ops-profile`, `/tmp/local005ops-repo`, and `/tmp/local005ops-evidence` inside the retained init-enabled x64 container. These are bounded diagnostics and focused tests, not repeated full emulator acceptance attempts.

## Diagnosis and exact evidence

Actual hosted run 34595569328 / job 103250410890 failed `webSmoke` at line600 with `Web profile did not stop within 10 seconds after SIGINT`. The preserved raw log subsequently records runner cleanup of orphan sh30027, node30028 and esbuild30041 (lines6374–6376). That is native evidence of incomplete owned lifecycle, not a permission to waive shutdown. The log does not by itself identify signal receipt.

Independent pinned source inspection: container `/tmp/deepseek-harness` HEAD is b150a551b8d465e31e418e1b2eaf5e79bbb7d28e. Its root `dsh` package script starts `node --import tsx/esm apps/cli/src/bin.ts` under pnpm's child shell. `apps/cli/src/profile-boot.ts:210–222` constructs the whole-app disposer and registers SIGINT to abort startup and invoke shutdown.interrupt(130). `process-shutdown.ts` bounds disposal at 5,000ms and exits130 after the interrupt disposal path. The release helper's existing ten-second stop deadline already exceeds this upstream bound.

Independent dynamic comparison used copied actual pinned Harness source and copied historical installed profile/dependencies in the retained Ubuntu x64 Docker emulator. A Node preload wrapped registrations of process SIGINT/SIGTERM listeners and process.exit for trace evidence; source shutdown code remained unchanged. To avoid pnpm re-installing moved dependencies, the diagnostic passes `--config.verify-deps-before-run=false`. This is explicitly diagnostic-only, not checked into or passed by the release helper. Initial diagnostic setup attempts exited before DSH because pnpm requested a moved-dependency reinstall; those failures remain in diagnosis.log, diagnosis-v2.log and diagnosis-v3.log and are not counted as lifecycle observations.

Completed comparison (`diagnosis-v4.log`):

- PID-only SIGINT: launcher7801, shell7813, DSH Node7814 and esbuild7826 remain alive after10,063ms; HTTP still200; trace shows launcher SIGINT callbacks but no DSH SIGINT callback. This dynamically reproduces the native failure mechanism.
- Owned process-group SIGINT: launcher7853, shell7865 and DSH7866; actual DSH SIGINT callback executes and calls process.exit(130)31ms later. At123ms, launcher close is observed, port is closed, and process group is empty. The observed launcher pnpm subsequently exits1, even though DSH exits130.

That last fact produced one major fix-now finding in the first-pass candidate: a newly introduced leader-outcome filter would reject pnpm1 despite correct DSH interruption. Manager removed that new unsupported check and its bad-exit fixture. The original release gate never constrained the pnpm leader exit code. Final source retains the observed code in its report; no special exception for code1 or weakened existing gate was added.

## Final source and independent validation

Exact hashes:

- scripts/release-artifacts.mjs: `a29e3ee844a286913252ea0be5bacb36e4e4a9533a7cc2501354c12f85fa8a6f`
- tests/release-harness-identity.test.mjs: `f45d794cf6e54e717b80a97900c4375ae76090d931ddc2106e6f6b5f1d5c1fe1`

Final webSmoke now creates an owned detached POSIX process group and sends SIGINT to that group, reproducing terminal signal delivery to pnpm, shell and DSH. SIGKILL is failure-only cleanup of that owned group. Finally clears bind/stop timers. Existing thirty-second bind and ten-second shutdown bounds remain unchanged, as do HTTP200/nonempty body, close and closed-port requirements. The helper still invokes the actual pnpm dsh command, and surrounding exact-artifact/profile/isolation/removal gates are unchanged.

Five new process fixtures verify real nested wrapper/server signal delivery and disposal side effects; pre-bind exit, bad HTTP, failed HTTP transport, and noncooperative ten-second shutdown all reject and check that parent and worker PIDs disappear. No shortened deadline mocks or fixture-only success flags replace the behavior under test.

Independent final exact-source results:

- macOS Node22.23.2 identity/lifecycle file: 7 total, 6 pass, one existing Linux-only skip, zero failures (`final-mac-tests.log`).
- Ubuntu24.04 x64 emulation with init and Node22.23.2: 7/7 pass, zero skips, including real network/identity isolation and full ten-second stubborn failure (`final-linux-tests.log`).
- Exact candidate `webSmoke` called against copied actual pinned Harness: PASS HTTP200, 14,555 bytes, actual DSH SIGINT callback then process.exit(130)29ms later; pnpm outcome code1 retained; port closed and post-run process inventory contains only container init/sleep and the diagnostic driver/ps, no Harness descendants (`candidate-harness.log`). This validates the final helper against actual upstream launch/shutdown code; it is not full fresh-artifact/profile-removal acceptance.
- Scoped lexical+graph Cortex refresh only; no embeddings/providers. Six active rules returned and both changed-file pattern calls succeeded with local evidence (`final-rules.json`, `final-script-pattern.json`, `final-test-pattern.json`). Search identified `chunk:scripts/release-artifacts.mjs:webSmoke:556-609`, related edge from harnessCommand, and impact confirmed that caller. Final diff whitespace check passes. Temporary tracked context config restored; final reviewer tree clean.

Using-cortex, context-review and pattern-review skills applied. Repo-local pattern evidence is advisory, not a separate all-green policy validator claim. Prior accepted clean-tag test/dependency reports continue to own their unchanged scopes; this review does not relabel historical artifact hashes as final source artifacts.

## Limits and remaining gate

There is no remaining blocker/major source finding in this correction. Shutdown evidence verifies launcher close and closed port; it is not a generic proof that arbitrary descendants which detach or close all inherited stdio have exited. No such descendant remained in the measured actual pinned lifecycle. The real installed-profile gate separately checks disposal callbacks, tools/skills, commands and isolation; this diagnostic does not replace that gate or prove profile removal.

Native hosted preflight on the final integrated head/merge tree remains mandatory before merge/tag/release. It must re-pack and bind exact final root/bundle bytes, execute complete Harness headless/Web/removal lifecycle, and pass every remaining gate and final boundary check. Emulator diagnostics and focused tests are supporting evidence only.
