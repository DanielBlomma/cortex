# WO-LOCAL-005 independent Security / Contract / Code Quality review

Reviewer `/root/hosted_release_manager/security_contract`, assigned before edits.
Own isolated clone `/private/tmp/cortex-local-005-security`, base `f4dea6c`.
Only context packet and direct references used. No implementation/remote writes.

## Initial diagnosis

Actual native hosted run 34595569328 fails at webSmoke line600 after the unchanged
10-second SIGINT deadline. Preserved log lines6345–6356 show exact failure; runner
cleanup lines6374–6376 terminates orphan sh30027, node30028 and esbuild30041.
Existing helper sends SIGINT and failure SIGKILL only to its pnpm child PID.
Its close event waits for inherited descendant stdio closure, so termination of
that parent is insufficient evidence of Web shutdown.

Pinned Harness copied read-only from preserved container
`cortex-local-004-ops-x64-init:/tmp/deepseek-harness`: HEAD exact
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`; package.json, profile-boot.ts and
process-shutdown.ts Git status clean. Copies retained as
`/private/tmp/cortex-local-005-security-harness-package.json` and
`/private/tmp/cortex-local-005-security-harness-cli`.

package.json dsh script executes node --import tsx/esm apps/cli/src/bin.ts.
apps/cli/src/profile-boot.ts210–222 registers SIGINT to shutdown.interrupt(130),
with whole-app fiber.dispose. apps/cli/src/process-shutdown.ts4 uses 5000ms
maximum, and interrupt requests immediate process.exit after disposal or timeout.
This source plus actual native orphan topology supports missing descendant signal
delivery. It does not prove all Harness disposal behavior succeeds; actual final
hosted lifecycle remains required. Deadline inflation is unjustified.

Proposed narrow design should own a new POSIX process group, deliver SIGINT to
that group, retain child close plus closed-port assertions, and guarantee bounded
owned-group SIGKILL cleanup for bind/fetch/shutdown failure. Forced cleanup must
never turn a failure into success. PID/group targeting must be restricted to the
spawned task and reject unsupported platform behavior explicitly if needed.

## Cortex context

Used using-cortex, context-review and pattern-review repo skills. Own runtime
copied from manager; scoped ingest/load covers only scripts/release-artifacts.mjs,
scripts/release-harness-profile-gate.mjs and tests/release-harness-identity.test.mjs.
50 chunks, six rules; search/related/impact/rules and baseline helper pattern call
succeed lexical-only with missing-embeddings warning. No providers, embeddings,
broad context update or hooks. Tracked config restored. Evidence files are
/private/tmp/cortex-local-005-security-{ingest.log,graph.log,search.json,rules.json,
impact.json,related.json,pattern-baseline.json}.

Cited search entities: chunk:scripts/release-artifacts.mjs:webSmoke:556-609,
chunk:scripts/release-artifacts.mjs:harnessCommand:611-681,
chunk:scripts/release-artifacts.mjs:assertFinalHarnessEvidence:450-477.

Review of the implementation is pending; no source sign-off or hosted pass claimed.

## First-pass review and refinement

First source patch changed only release-artifacts.mjs webSmoke and its existing
release-harness-identity test file. POSIX detached group targets negative spawned
positive PID; ESRCH alone is ignored. try/finally sends SIGKILL only on failure,
clears both bind/stop timers, and preserves original HTTP content, 30-second bind,
10-second shutdown, close-event and closed-port checks. Success never escalates.

Independent first-pass checked-in tests: eight total, seven pass and one existing
Linux-only skip on macOS. Focused release suite: 48 total, 47 pass, one skip.
Separate black-box wrapper/worker fixtures pass graceful shutdown, HTTP503,
broken connection, abnormal-code rejection (first-pass-only assertion), and
SIGINT-ignoring timeout. Each verifies worker absent and unrelated sentinel
alive. Stubborn case rejects at 10066ms. Evidence:
/private/tmp/cortex-local-005-security-candidate-tests.log,
/private/tmp/cortex-local-005-security-final-focused.log,
/private/tmp/cortex-local-005-security-independent{.mjs,.log}.

An initial reviewer major count finding was retracted: I incorrectly assumed
root npm test used a glob. Actual package.json scripts.test uses an explicit list
that excludes release-harness-identity; only focused release:test includes it.
Exact root/pristine81/437/6/651 expectations must remain unchanged.

Ops actual pinned dynamic evidence establishes pnpm exits1 while its DSH child
handles SIGINT and exits130. Therefore the newly added wrapper outcome allowlist
cannot represent the actual shutdown contract; reviewer agrees to remove it and
its bad-exit fixture. This preserves original acceptance semantics; process close
and port closure within unchanged10 seconds are required, independent of launcher
status. The pinned-source SIGINT handler and Ops disposal evidence must not be
confused with wrapper exit status. Final exact-byte rerun pending.

Cortex refreshed with same narrow scope. Six rules and both source/test pattern
calls succeed with local evidence. Combined review --diff returns exact
`INVALID_ARGS: Review failed safely`; no policy pass is inferred. Documented
rules/pattern fallback and direct diff review support this review. Evidence:
/private/tmp/cortex-local-005-security-final-{ingest.log,graph.log,rules.json,
pattern-helper.json,pattern-test.json,review.json}. Config restored.

## Exact source closure — cd7668b779a74a2c1bdb538934ca61f9ff31b8a4

APPROVE this exact source for coordinated draft-PR push and hosted preflight.
No unresolved blocker/major security, contract or code-quality findings. This is
not merge/release approval: final candidate actual hosted lifecycle and all gates
remain required. Preserved historical artifact identities cannot substitute.

Final source removes the invalid wrapper exit-status assertion and its fixture.
No original gate, timeout, network isolation, artifact/profile identity, real
command, profile removal, permission, publication workflow or dependency changes.
The only source delta from f4dea6c is webSmoke and its existing identity test file.

Exact independently copied source SHA256:
- scripts/release-artifacts.mjs:
  a29e3ee844a286913252ea0be5bacb36e4e4a9533a7cc2501354c12f85fa8a6f
- tests/release-harness-identity.test.mjs:
  f45d794cf6e54e717b80a97900c4375ae76090d931ddc2106e6f6b5f1d5c1fe1

Exact focused npm run release:test:47 total,46 pass,zero fail,one pre-existing
Linux-only skip on macOS;10476.9805ms. Own independent final four wrapper/worker
modes pass successful shutdown, HTTP503 rejection, connection rejection and
SIGINT-ignore rejection at10050ms. Worker gone and unrelated sentinel alive in
every mode. Logs:
/private/tmp/cortex-local-005-security-exact-focused.log and
/private/tmp/cortex-local-005-security-exact-independent.log.

Fresh exact-source scoped Cortex ingest/graph, six rules and both per-file local
pattern calls succeed; original tracked config restored, git diff --check passes.
Evidence /private/tmp/cortex-local-005-security-exact-{ingest.log,graph.log,
rules.json,pattern-helper.json,pattern-test.json}. Combined review limitation
above remains honestly reported. Same-file helper runNetworkDenied signal/child
handling and failure helper provide local pattern evidence; the new code is
limited to the affected asynchronous lifecycle rather than changing synchronous
command execution globally.

Residual bounds: close+port evidence covers the actual inherited-stdio launch
chain; arbitrary descendants that deliberately detach or discard all inherited
stdio are not independently enumerated by this helper. Successful shutdown never
uses forced SIGKILL; failed paths send group SIGKILL without claiming graceful
disposal. Wrapper exit status is retained as diagnostic evidence only. These
limits do not waive full actual pinned Harness shutdown/removal validation.
