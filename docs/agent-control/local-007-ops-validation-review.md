# WO-LOCAL-007 independent Ops / Validation / Integration source review

APPROVE exact test SHA256
6d337c598caef11c5b9d3cdf2665379e04c91629a7ce3232d9cf35612041fac1
for coordinated draft PR/native preflight. No unresolved blocker or major source
finding. This is not merge/release GO; final native full/pristine gates and actual
Bump/Publish completion remain required.

## Isolation and exact surface

Fresh reviewer assigned before implementation, own clone
/private/tmp/cortex-local-007-ops at c7ce1a9c0c22e19b772e2bf7b989b65904855e04.
Only packet and direct references used. Prior trees read-only; manager sole branch
writer. The only candidate code change is
plugins/dsh-cortex/tests/local-subprocess-integration.test.mjs. Production,
workflows, package metadata/dependencies, test declarations/counts and provider
termination deadline/grace remain unchanged. No push/tag/release/global install,
provider/embedding generation, broad indexing, hooks or dependency install by Ops.

## Diagnosis and contract assessment

Independent original-assertion subreaper witness proves a general deterministic
reaping mismatch in actual pinned runtime0.1.1-rc.2. Original immediateESRCH fails
at3038ms while same PID8212/starttime20006511/PGRP8205 becomesZ under owned
subreaper8183. Only after waitpid reportsSIGKILL9 does kill(pid,0) reportESRCH.
The witness uses an emulated Linux x64 container, not native release acceptance;
it does not classify unrecorded historical native34598916068. No retry-to-green.
Full witness methods, exact source/library hashes and untouched gate review are
in diagnosis-review.md and raw subreaper.log in this evidence directory.

Test83–141 now parses proc identity synchronously, validates positive safe PID,
starttime and group/session, and binds live baseline to actual spawn handlePID.
Test144–158 retains immediateESRCH success and non-Linux original assertion.
Linux only waits after the same known identity is positivelyZ/X/x; every poll
rechecks identity and state. Executing/unknown, malformed/unreadable, reused or
wrong-group records throw immediately. ProcENOENT requires a freshESRCH check.
Permanent zombie cannot pass: reaping-only deadline is1second, poll10ms. The
provider still must first produce exactCANCELED/TIMEOUT after waitForExit, with
original2second timeout and1second termination grace. No production guard moved.

Cleanup160–172 validates Linux identity before any test-owned signal and avoids
signals to absent/dead/reused/unknown records. Both settled fixture hooks abort
their actual controller and await observed pending rejection/settlement before
identity cleanup and guaranteed temporary-directory removal. The initial
candidate's pre-baseline failure gap was raised by Security and fixed before this
approval; Ops independently verifies that corrected path below. Successful
fixtures keep the original actual provider result assertions.

## Independent final-candidate validation

One execution per final scenario, Node22.23.2:

- Exact source, macOS settled cancellation+timeout:2/2 PASS, no skips/failures,
  final-candidate-settled-macos.log.
- Exact source, Linux x64 container settled cases:2/2 PASS, no skips/failures,
  final-candidate-settled-linux.log.
- Actual pinned-runtime controlled-reap witness: captures livePID8375 then same
  starttime20019202/group8368/session8368 zombie while candidate assertion is
  pending. Withholds reap100ms, then waitpidSIGKILL9. Candidate passes only after
  ESRCH; total3.72seconds; fixture removed. final-candidate-reap.log.
- Actual pinned-runtime held-zombie witness: PID8411/starttime20019586/group8404
  remainsZ throughout assertion. Candidate fails `dead descendant was not reaped`
  after its1second bound; total4.56seconds. Only afterward witness reapsSIGKILL9
  and confirmsESRCH/proc absent; fixture removed. final-candidate-hold.log.
- Pre-baseline fault copy throwsOPS_PRE_BASELINE_FAILURE after observing actual
  livePID8497 but before assigning the test's descendant variable. Hook aborts
  pending provider and awaits termination; original injected failure remains,
  no unhandled rejection, owned descendantZ with same starttime/group; waitpid
  returnsSIGKILL9, thenESRCH; fixture absent,1.97seconds total.
  final-baseline-failure.log.

All probes are separate diagnostic copies outside tracked source, add only the
specified instrumentation/fault, and use actual provider and pinned subprocess
runtime. Drivers/builders plus raw logs remain under
/private/tmp/cortex-local-007-ops-evidence. The Python subreaper only signals/reaps
its own adopted children in cleanup. Candidate helper negative-state/reuse probes
belong to the independent Security report; no duplicate claim is made here.
Manager owns complete bundle6 verification; native full/pristine81/437/6/651
remain authoritative and cannot be inferred from these focused results.

## Cortex and release boundary

Used required using-cortex/change-impact/pattern-review/context-review. Search,
impact/related identify test file and CortexCliRunner.run. Initial copied graph
publication warning was retained; final scoped ingest+graph load covers exactly
provider, protocol and integration test, no providers/embeddings. Tracked config
restored and watch stopped. Final rules succeeds with six active rules; final
pattern evidence succeeds using lexical ranking and current graph publication.
Existing same-file private fixture35–63 and bounded wait23–32 are applicable
local patterns; the newly added helpers returned as same-file search evidence
are not falsely characterized as pre-existing conventions.

Final `cortex review --diff --json` returns exactly `Review failed safely`
(INVALID_ARGS), retained as final-review.json. No automated pass is claimed.
The context-review skill's explicit CLI fallback (rules plus per-file pattern
checks) succeeded and supplements this direct independent source/validation
review. Diff whitespace check passed; own tracked diff contains exactly the test.

Directly reviewed all three release workflows and fresh-checkout guards. They
still require complete/pristine81context/437root/6bundle/651MCP, six audits,
containment/frontend, pinned real Harness headless/Web/removal lifecycle, exact
duplicate artifacts, empty-cache installation and final boundary before Bump's
immutable annotated tag and atomicmain/tag. Publish still validates immutable
tag source, Node24/npm11.19.1, OIDC, exact ordered dual publication/safe resume,
registry bytes, empty-cache install and final registry Harness completion.
Final exact-head/source review, hosted native preflight, guarded merge, actual
Bump/Publish completion and publication byte/tag/main reconciliation must precede
root-owned pinned2.8 globalCLI update. No release-gate waiver.

Exact commit binding will follow manager's final source/control commit.
