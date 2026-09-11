# WO-LOCAL-007 subprocess reaping and release completion

2026-09-11. Infra/deploy/security-sensitive. Fresh manager at c7ce1a9 and two
new independent reviewers assigned before implementation in isolated clones.
Root retains release authority and existing global CLI ownership.

## Deterministic diagnosis before implementation

Both independent reviewers run the actual pinned local subprocess runtime under
an owned Linux subreaper that withholds orphan waitpid. The original timeout
assertion fails at approximately 3.04 seconds: same PID/starttime/group changes
from executing S to zombie Z, kill(pid,0) still succeeds, waitpid then reports
SIGKILL9, and both ESRCH and absent /proc are proved. Ops PID8212/starttime20006511;
Security PID8262/starttime20009226. Each executes once, without retries or provider,
timeout/grace, fixture assertion or production dependency changes. The Linux x64
container is emulated; this establishes the general kernel-reaping race in the
actual pinned provider, not the historical native failure's unrecorded state or
native release success. Native34598916068 remains an unclassified assertion failure.
Raw evidence: local-007-ops-evidence/subreaper.log and subreaper.py;
local-007-security-evidence/independent-subreaper.log, beneath the disposable
reviewer evidence directories recorded in their reports.

Root's diagnostic clarification permits general deterministic Linux mechanism
proof; impossible retrospective state recovery is not a new acceptance condition.
Full unchanged native acceptance remains mandatory.

## First-pass bounded correction / review intake

Only plugins/dsh-cortex/tests/local-subprocess-integration.test.mjs changes code.
The two settled-leader tests capture positive descendant PID, Linux starttime,
process group and session while live and bind group/session to the actual spawned
leader handle. After the original CANCELED/TIMEOUT assertion, Linux must report
ESRCH immediately or the same identity in Z/X/x. Executing, unknown, malformed,
unreadable or reused records fail immediately. Only confirmed-dead records may
wait up to one second for ESRCH; every poll rechecks identity/dead state. An
ENOENT proc read requires a fresh successful ESRCH proof. Non-Linux retains the
original immediate ESRCH assertion. Cleanup checks Linux identity before signal,
never signals dead/reused/unknown records, and removes the fixture in finally.

Provider timeout2s, termination grace1s, runtime production, dependencies,
workflows, six-test declarations and all release counts remain unchanged. New
reaping bound applies after confirmed nonexecution, never to an executing child.
Open review: independently exercise bounded success, live/unknown/malformed/reused
and never-reaped negatives; check cleanup identity and temp removal. No source
acceptance or release GO yet.

## Review iteration — fixture setup failures

Security identified a major fix-now lifecycle issue before source acceptance:
new baseline assertions can fail before descendant identity assignment, leaving
the cancellation runner pending until its default timeout. Both settled fixtures
now observe pending rejection immediately; after-hook aborts the owned runner,
awaits its settlement, then performs identity cleanup and unconditional temp
removal. Timeout fixture uses its controller only for cleanup; its real2s timeout
assertion remains unchanged. Independent failure-path validation remains pending.

## WO-LOCAL-007 source acceptance

Accept bounded subprocess-test correction for coordinated draft/native preflight,
not merge/release approval. Exact test SHA256:
6d337c598caef11c5b9d3cdf2665379e04c91629a7ce3232d9cf35612041fac1.
Security closes baseline-failure cleanup finding;36 adversarial helper probes and
both real setup-failure paths reject/clean as required. Ops independently proves
controlled reap success and held-zombie bounded failure with actual pinned runtime.
Independent Linux/macOS settled2/2 and manager bundle6/6 pass. Manager scoped
Cortex review7paths returns zero findings/conflicts; six rules and all per-file
patterns succeed. Full native final-head release gates remain mandatory.
See local-007-release-completion-report.md and the two independent review reports.
Auto-advance under existing authority to coordinated draft PR130 update, native
preflight, then guarded merge/Bump/Publish only after actual green gates.

Current independent reports: local-007-independent-security-review.md and
local-007-ops-validation-review.md. Original provider/protocol, package/lockfiles,
release workflows, writer test and all full/pristine count guards are unchanged.
Scoped lexical+graph update only; tracked config restored, watch stopped; no
provider/embedding/broad indexing or hooks. Final commits, native run, merge and
Bump/Publish/registry identities remain to be bound below.

Final precommit Cortex review covers all nine changed paths, returns ok with zero
findings/conflicts; all nine required changed-file pattern requests succeed.
An additional optional pattern lookup for unchanged provider.mjs fails verbatim
`aliases is not iterable`; this is not relabeled as a pass. The required changed
file evidence and direct provider source review remain separate. Reviewer Ops's
combined-review fail-safe limitation is recorded in its report. Raw final review
and all pattern outputs remain in the manager evidence directory.
