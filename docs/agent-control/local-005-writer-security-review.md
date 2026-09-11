# WO-LOCAL-005 native trusted-writer test diagnosis and review

Fresh reviewer assigned in existing bounded WO-LOCAL-005 session, prior source
and isolated trees preserved. No manager implementation or remote writes.
Actual hosted preflight34597272860 final54af809 log at
/private/tmp/cortex-local-005-evidence/preflight-34597272860.log.

## Actual evidence and cause

Pristine MCP reports650pass/1fail of651. The failing test is
analysis-state-trusted-writer.test.mjs513, exact /stale writer/ mismatch at520.
The status assertion immediately above already established one successful writer
and one rejected writer. Actual loser message:
`maintained analysis state changed during read`.

Cortex scoped search/impact/rules cover only trusted-writer.ts, query-reader.ts,
store.ts and the direct test. appendTrustedAnalysisObservation calls prepareAppend
before acquiring its coordinator. prepareAppend calls readTrustedAnalysisState
before checking generation. The reader binds strict task/analysis directory and
file metadata, performs replay, then verifies unchanged identities; overlapping
legitimate lock creation or commit can invalidate this read and produce
STATE_UNTRUSTED before generation comparison. Changing production to suppress or
retry this safety rejection is not justified by the native failure.

Independent deterministic proof: own diagnostic intercepts loser's second root
bigint lstat, after replay and immediately before the final unchanged assertion,
and executes one actual valid winning append. Winner commits generation2/count2;
loser rejects STATE_UNTRUSTED with the exact native message; final trusted read
remains generation2/count2. No probabilistic repeat-until-pass. Runtime source
cmp equals reviewed source. Evidence:
/private/tmp/cortex-local-005-security-writer-diagnostic.log and
/private/tmp/cortex-local-005-security/scaffold/mcp/tests/local005-writer-diagnostic.mjs.

## Narrow repair contract

Synchronize the two existing test workers immediately before their first
coordinator mkdir, after each initial trusted preparation completed. Keep exact
/stale writer/ rejection, one status0/one1, generation2/count2, and strengthen
winner result/authority/observation identity checks if practical. Coordination
must be test-only, exact owned path, outside strict task directories, bounded,
and cleaned on all outcomes. This deliberately exercises the claimed coordinated
CAS race; it must not broaden the assertion, add retries or alter production.
Existing trusted-reader race negatives remain required unchanged.

Historical maintained-analysis-state-writer-report.md105 broadly called a stale
loser required after ten sampled races. Clarification is needed: stale class
applies after successful initial preparation; overlapping pre-lock trusted reads
legitimately fail closed before that point. The current observed ordering is
not proof of broken atomicity or unsafe writes.

Cortex evidence prefix /private/tmp/cortex-local-005-security-writer-:
ingest.log,graph.log,search.json,rules.json,impact.json. Lexical-only, no providers,
embeddings,broad updates or hooks; tracked config restored. Search entity
file:scaffold/mcp/src/core/analysis-state/trusted-writer.ts and direct related
query-reader code327–358,168–179 substantiate this diagnosis.

Implementation review pending; no source sign-off for a test repair yet.

## Diagnosis handoff closure

No implementation occurred in WO-LOCAL-005 after this native writer failure.
Manager is splitting the test-only repair into fresh WO-LOCAL-006 with fresh
reviewers and this report as a direct packet reference. Do not infer a repair
sign-off or release acceptance from this diagnosis.

Additional unchanged reader evidence: scaffold/mcp/tests/analysis-state-cli.test.mjs
concurrent-authority-replacement-after-replay requires STATE_UNTRUSTED; unrelated
repository-root entry remains accepted. Independent targeted run of precisely
those two tests passes2/2 with no failures or skips. Log:
/private/tmp/cortex-local-005-security-reader-race-regression.log.

Recommended next step: implement the bounded pre-coordinator test rendezvous,
retain exact stale rejection and one-commit/identity invariants, independently
review and validate in a new isolated clone. The old failure is fully preserved;
no retry-to-green, diagnostic broadening or production suppression is approved.
