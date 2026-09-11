# WO-LOCAL-005: native Web lifecycle repair and release completion

2026-09-11. Profile: Infra/deploy/security-sensitive. Fresh manager source starts
at f4dea6c; lifecycle source candidate is cd7668b779a74a2c1bdb538934ca61f9ff31b8a4.
Prior source/security/clean-tag evidence remains in the linked local-004 packet.
Original checkout and prior reviewed trees are preserved. Existing user authority
covers reviewed merge, Release Bump/Publish 2.8.0 and the root-owned global CLI.
No release acceptance is claimed until exact-head native gates pass.

## Actual defect and bounded repair

Native hosted preflight 34595569328 failed the ten-second Web SIGINT gate and
runner cleanup found orphan shell, Node and esbuild processes. Both fresh
reviewers inspect actual pinned Harness b150a551. Its dsh script starts Node
through pnpm and a shell. Harness registers SIGINT and bounds application
disposal to five seconds, exiting 130. The release helper signalled only pnpm.

Ops reproduced the difference against an isolated copy of the actual pinned
Harness and installed profiles. PID-only SIGINT never reaches DSH's handler;
HTTP remains 200 with all descendants alive after 10,063ms. Group SIGINT reaches
the actual handler, DSH exits 130 after 31ms and the whole observed group and
port disappear by 123ms. Trace: /private/tmp/cortex-local-005-ops-evidence/diagnosis-v4.log.
Moved-tree pnpm dependency verification was disabled solely for that diagnostic
copy; actual hosted validation retains the unchanged frozen install workflow.
This is cause evidence, not a substitute for final native release acceptance.

The helper now starts a dedicated POSIX process group and sends terminal-equivalent
SIGINT to the positive spawned PID's group. It preserves 30-second binding,
ten-second shutdown, child-close and closed-port requirements. Failure cleanup
kills only the owned group and covers bind, HTTP and shutdown failures; timers
are cleared. Successful shutdown never uses SIGKILL. Premature close is rejected.
A proposed new wrapper-exit assertion was removed on review: real pnpm maps DSH's
130 to 1, so wrapper status is not an application-disposal contract. The original
gate did not use it. No Harness source, release workflow, package, existing
deadline, network boundary, assertion count guard or publication guard changes.

## Focused validation and context

Five nested wrapper/server regressions verify graceful SIGINT callback/disposal,
pre-bind failure, HTTP 503, broken fetch and stubborn shutdown. The stubborn
fixture receives SIGINT, fails at the original ten-second deadline and is cleaned
up without reporting graceful disposal. Manager focused release suite: 47 tests,
46 pass, one Linux-only skip on macOS. Existing full-suite guards remain exactly
81 context / 437 root / 6 bundle / 651 MCP; the changed identity test belongs to
the separate focused command. No root count was changed.

Source SHA256: release-artifacts.mjs a29e3ee844a286913252ea0be5bacb36e4e4a9533a7cc2501354c12f85fa8a6f;
release-harness-identity.test.mjs f45d794cf6e54e717b80a97900c4375ae76090d931ddc2106e6f6b5f1d5c1fe1.

Applied using-cortex/change-impact/pattern-review/context-review. Scoped lexical
and graph refresh covers six directly relevant helper/test/workflow files;
tracked config restored. Search resolves webSmoke and harnessCommand; six active
rules, impact/related and guidance succeed. Final per-file patterns succeed and
manager precommit review --diff returns ok with zero findings for the four
changed helper/test/control paths. Watch is stopped. No provider, embedding,
broad indexing or hooks. Evidence: /private/tmp/cortex-local-005-evidence.

## Residual scope and final gates

Close and port checks do not independently enumerate hypothetical ignored-stdio
descendants; no stronger universal process-containment claim is made. Actual
pinned observed descendants and fixture-owned descendants terminate. Historical
baseline ONNX extraction-root/pre-check races and the missing external benchmark
packet limitations remain as documented in local-004. No gate waiver.

Final independent source review, exact-head hosted PR preflight, expected-head
merge, actual Bump/Publish completion, registry byte/integrity verification and
root-owned /opt/homebrew installation remain to be recorded below.

## Source acceptance for draft preflight

Both fresh independent reviewers approve exact cd7668b, with no unresolved source
findings. [Security](local-005-independent-security-review.md) independently passes
47 focused tests (46 pass, one platform skip), verifies unrelated sentinel safety
and stubborn ten-second rejection/cleanup. [Ops](local-005-ops-validation-review.md)
passes all seven identity/lifecycle tests on Linux x64 and exact candidate webSmoke
against the actual pinned Harness: HTTP 200, 14,555 bytes, DSH handler exit 130
in 29ms, pnpm outcome 1, closed port and no observed Harness descendants.
Manager's final focused results agree. This accepts the narrow source repair for
draft push; exact final HEAD still requires native hosted preflight before merge.
