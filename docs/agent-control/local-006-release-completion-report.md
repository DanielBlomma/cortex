# WO-LOCAL-006: deterministic prepared-writer fixture and release completion

2026-09-11. Profile: Infra/deploy/security-sensitive. Fresh manager clone started
at5428818831ebeb152bb43aa9fbd4e41dbea03ae4. Two fresh independent reviewers were
assigned before implementation, with separate clones and only the context packet
plus direct references. Existing user authority covers reviewed PR130 merge,
Release Bump/Publish2.8.0, and the root-owned existing global CLI update.

## Bounded correction

Native preflight34597272860 previously failed the two-writer test because one
valid commit overlapped the other contender's optimistic trusted read. The
reader correctly rejected changing strict-directory identity before reaching
stale-generation comparison. Independent diagnosis is retained in local-005
writer Security/Ops reports; production code remains unchanged.

The existing test now pauses each worker only at its first mkdir for the exact
coordinator lock path, after optimistic preparation. Each signals readiness in
a fresh private temporary directory outside maintained state. The parent releases
both only after both are ready; original mkdir and append then execute unchanged.
Parent and child rendezvous are bounded at five seconds; parent records spawn
errors/early exits, kills only owned unfinished workers, awaits close and removes
both private coordination and state fixtures in finally. No new test cases alter
the651 MCP total. No regex broadening, retry, production guard bypass or existing
release deadline change.

The exact0/1 status assertion and /stale writer/ remain. Winner generation/count,
snapshot/head hashes, authority bundle/manifest/source-registry hashes and
appended observation identity are checked against a fresh trusted read and the
expected input. Existing read-race rejection and unrelated-root acceptance remain
unchanged. Historical writer report now scopes exact stale classification to
prepared contenders instead of overgeneralizing ten sampled schedules.

## Manager validation and limits

Exact writer SHA256:
e40ba6d5668db08fd51b41ccaf2482292a717d33f22c057a2b106579ccc7f8f4.
Manager writer file8/8 PASS; unchanged reader races2/2 PASS, no skips/failures.
Raw logs are under /private/tmp/cortex-local-006-evidence. This is focused evidence;
actual full native preflight remains mandatory before merge, Bump and Publish.

Applied using-cortex/change-impact/pattern-review/context-review. Direct search,
rules, impact/related and guidance identify runWorker and prepare/acquire paths.
Scoped lexical+graph refresh only; no provider/embedding/broad update or hooks.
Tracked context config restored. Initial report-pattern target was not indexed
and combined review failed safely; final scoped review evidence is recorded below.
Unchanged source/release evidence remains in local-005-release-completion-report.md
and its direct local-004 references, including residual ONNX baseline risk and
unavailable external benchmark packet. Neither is a new gate exception.

Independent review disposition, exact-head native gates, guarded merge, actual
Bump/Publish, registry byte verification and root CLI evidence follow below.

## Independent source acceptance

Both fresh reviewers approve the exact SHA256 above with no remaining findings:
[Security/Contract/Code Quality](local-006-writer-security-review.md) and
[Ops/Validation/Integration](local-006-ops-validation-review.md). Each independently
passes writer8/8 and reader2/2, then injects early-exit/spawn/readiness failures
and checks owned process and temporary-tree cleanup. Ops also rejects missing
release; Security rejects post-append assertion failure. Expected timeouts finish
around5.2seconds, without extending the five-second bound or hiding a failure.

Manager per-file patterns succeed for all seven tracked changed files and six
active rules remain. Combined doc-heavy CLI review returns exactly `Review failed
safely`; the documented rules+patterns fallback and independent source-only
reviews (both ok, zero findings/conflicts) provide separate evidence. No failing
policy finding is relabeled as a pass. Full hosted gates still decide acceptance.

PR130 retains class:infra-sensitive, directly based on main, no stack conflict.
No PR comments/reviews require a pause at the latest read. Manager accepts this
bounded source repair for a coordinated draft update and auto-advances to exact
native preflight. This does not yet authorize merge ahead of green required gates.
