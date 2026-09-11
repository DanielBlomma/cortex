# Native preflight 34597272860 writer-race diagnosis — independent Ops

Diagnosis only, no implementation or release GO. Native final-head preflight failed; do not rerun blindly or broaden the expected error regex. Manager will hand off implementation to fresh WO-LOCAL-006. No source changes were made.

## Source and isolation

Final native candidate `54af80981782ad03a22eb9c9421c1ac8664d6ae5`, fresh separate diagnostic clone `/private/tmp/cortex-local-005-ops-writer` detached at that exact commit. Earlier ops clone/evidence preserved. Current diagnostic Git tree clean; temporary tracked Cortex scope config restored. No branch/remote mutation, hook, provider, embedding, package installation or broad test rerun. Existing built runtime/dependencies copied from authorized historical manager path for bounded local diagnostic only.

Source SHA256:

- trusted-writer.ts: `d5ac57cf2153329d479e39df4424360777d81e97d9c0140f89a83e1159102dfe`
- query-reader.ts: `49f37fa16dfb0f810b9aee888af3a13e452cf969d7c978e510e4904d717df2c4`
- analysis-state-trusted-writer.test.mjs: `3d49f3bdc6d6be1668955b2ff247dda0a57bb054a181475b89a338a51df37968`

Used existing using-cortex/context-review rules. Scoped ingest/load graph covered only analysis-state source and writer test. Search and six rules succeeded using lexical fallback, with related/impact evidence saved in writer-search.json, writer-rules.json, writer-related.json and writer-impact.json beside this report. Primary source entities are the trusted-writer and query-reader files, prepareAppend, appendTrustedAnalysisObservation and readTrustedAnalysisState.

## Observed native failure

`/private/tmp/cortex-local-005-evidence/preflight-34597272860.log`, excerpt around5158: initial full MCP651/651 passed; the fresh-checkout full MCP run finished650/651. Sole failure was writer-test513, two writers sharing expected generation. Status0/1 assertion had passed; assertion520 expected /stale writer/ but received `maintained analysis state changed during read`. No generation corruption is shown by this failure; assertions after the diagnostic mismatch did not execute, so native final state must not be claimed from that log.

## Independent source diagnosis

`appendTrustedAnalysisObservation` validates and calls `prepareAppend` before acquiring its coordinator (trusted-writer.ts760–770). `prepareAppend` first calls `readTrustedAnalysisState`, then validates expected generation and authority hash (298–306). The trusted reader binds strict identities for `.agents`, task and analysis directories and state files, reads authority, replays state, then rechecks identities (query-reader.ts145–179, readTrustedAnalysisState at329 onward).

An overlapping writer's coordinator mkdir or subsequent commit changes strict task-directory timestamps. A contender whose initial optimistic read spans that change correctly rejects with `STATE_UNTRUSTED` before it reaches the expected-generation comparison. It never mutates state. Coordinator-held append re-prepares and preserves CAS; the existing test's uncoordinated process launch does not guarantee both preparations complete before the first writer mutates.

For these two controlled writers, neither can mutate before completing initial preparation. Thus they cannot both fail their initial reads due solely to their own writes before any preparation completes: at least one reaches coordination first. The existing source protects maintained state; the observed error is a valid fail-closed outcome for an unstable read, not evidence to weaken reader identity checks or invent stale status for untrusted data.

Historical `docs/agent-control/maintained-analysis-state-writer-report.md:103–106` overstates the measured broad stale-CAS guarantee after ten successful races. Fresh work should clarify that exact stale-CAS classification is for prepared coordinated contenders, while a reader spanning mutation fails closed earlier.

## One deterministic independent cross-process reproduction

Ran once on macOS Node22.23.2 with unchanged production code. Archive fixture: `/private/tmp/cortex-local-005-ops-evidence/writer-crossprocess-diagnostic.mjs`; it was executed at `scaffold/mcp/tests/ops-writer-diagnosis.mjs` in the diagnostic clone, then archived and removed. Its relative test imports require placement under that tests directory when reproducing. Result: `writer-crossprocess-diagnostic.json` beside this report.

The loser process pauses using a test-local fs.lstatSync wrapper just before its final bound-identity validation. Rendezvous files are in a separate temporary directory outside the maintained state tree; readiness/release waits are bounded at5seconds. Parent then performs a real trusted append and captures the whole `.agents` identity/byte tree before releasing the loser.

Measured result:

- Winner commits generation2 and observation_count2.
- Loser exits1 with code `STATE_UNTRUSTED` and exact message `maintained analysis state changed during read`.
- After loser rejection, full state identity tree is unchanged from the winner's completed tree: bytes, inode/device, ctime/mtime, mode, nlink, sizes and directory entries. Loser is mutation-neutral.
- Fresh trusted read is generation2/count2 with winner snapshot `7660dc1d98d671c2e047d357f2031329653b2a6f82de858339701dde348bd991`, observation head `dea8c8a714b19c6dab9d605cbb0c385505d7efb1383283841d5aab701a4f0fda`, authority bundle `16ffdbc871e1447343a4b158731d06e5f8801506b6244c4453f317bc34f5507a`, and appended ID `obs:0d3f2e693492dba35f66cb91a603f384bee087728dc628903de714ed17e86505`.
- Worker stderr empty; fixture and barrier cleaned. No timing retries or native-gate bypass.

Security independently reproduced the same schedule with its own fixture; that is separate reviewer evidence, not relabeled as this run.

## Recommended bounded next change, not yet reviewed implementation

Make the intended two-writer CAS test deterministic by rendezvousing both workers immediately before their first coordinator mkdir, after both initial trusted preparations finish. Release them into the actual production mkdir/append path. Keep exact0/1 statuses and exact stale regex, then verify the winner's returned generation/authority/observation bindings against the fresh persisted state. Preserve a separate deterministic mixed-read rejection test and mutation-neutrality evidence.

Barrier files must live outside strict task state; intercept only the first task coordinator mkdir; bound all waits; terminate/reap workers and clean barriers even on assertion failure. Do not add production hooks, bypass real append operations, relax read guards, broaden diagnostics, or rely on repeated successful scheduling. Exact candidate test changes and artifact implications require fresh independent source review and final native hosted validation. Existing release failure remains blocking until that gate genuinely passes.
