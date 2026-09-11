# WO-LOCAL-006 independent Security / Contract / Code Quality review

GO for the bounded writer-fixture repair below; no blocker, major, or minor
finding. This is source/test approval, not release approval. Actual native
final-head preflight and the complete published-release chain remain required.

Fresh independent reviewer assigned before implementation. Own clone
`/private/tmp/cortex-local-006-security`, base
`5428818831ebeb152bb43aa9fbd4e41dbea03ae4`, original/prior trees read-only.
Reviewed exact manager candidate copied as two files; no production changes.

SHA256 of approved candidate:

- `scaffold/mcp/tests/analysis-state-trusted-writer.test.mjs`:
  `e40ba6d5668db08fd51b41ccaf2482292a717d33f22c057a2b106579ccc7f8f4`
- `docs/agent-control/maintained-analysis-state-writer-report.md`:
  `8de2fa1c1afd1ad4e75b69cab6c19f0a1fb1c648f3ef730c2d1926300e4ba9ac`

## Contract and implementation assessment

The only runtime interception is inside the test's owned child process:
`runWorker`, test lines494–535. Its fs.mkdirSync wrapper pauses only before the
first mkdir of that fixture's exact coordinator path. Original mkdir receives
unchanged receiver and arguments after release. No trusted read, lock acquisition,
append, generation check, or identity validation is bypassed. The parent verifies
both readiness files before releasing either contender (lines537–568).

The source contract remains exact: trusted-writer.ts298–306 prepares and checks
expected generation and authority; lines410–451 acquire the real lock;
lines712–774 re-prepare while coordinated and retain stale CAS checks. Reader
query-reader.ts144–179 retains strict task identities and fail-closed replay
revalidation. The test now proves the intended already-prepared race; the
historical report correctly distinguishes an optimistic read spanning mutation.

The original status0/status1 and `/stale writer/u` expectations remain. The
candidate additionally verifies empty child stderr, success/failure flags, fresh
generation2/count2, returned snapshot/head/authority/authority-manifest/source
registry hashes, and appended observation identity against both persisted state
and the requested observation (test lines569–587). Test declarations/count are
unchanged. No retry-to-green, broadened diagnostic, production retry, timeout
inflation, runtime hook, provider, or release-gate change.

The barrier is a fresh private mkdtemp directory outside the repository fixture
and its strict `.agents` ancestry. Readiness and release writes use exclusive
creation. Child polling and parent total wait are bounded at5seconds. Early
close/spawn errors are surfaced; finally kills only still-open owned workers,
awaits close results, then removes barrier and fixture (lines588–597). Any losing
Promise.race polling branch observes those closed workers and terminates; it
cannot leave a worker or recurring wait behind.

## Independently executed evidence

Evidence directory: `/private/tmp/cortex-local-006-security-evidence/`.

- Exact candidate full writer file: **8/8 PASS**, zero fail/skip/cancel, including
  CLI/MCP fresh-generation bindings, invalid-input neutrality, recovery, special
  files/links/modes, coordinator ownership, ancestor redirection and the repaired
  two-process race. `candidate-writer-tests.log`.
- Unchanged trusted-reader race regressions: **2/2 PASS**, zero skips. Concurrent
  authority replacement remains `STATE_UNTRUSTED`; an unrelated repository-root
  entry remains accepted. `reader-regressions.log`.
- Four separate diagnostic copies inject an early exit7, a never-ready child,
  an ENOENT spawn executable, and a post-append assertion failure. All fail as
  expected and reap every observed child; both fixture paths are absent after
  close. Elapsed0.237s/5.169s/0.218s/0.353s. `failure-paths.json`, corresponding
  raw `.log`/`.jsonl`, reproducible `check-failure-paths.py`. Diagnostic modules
  removed from the clone after execution; candidate source untouched.
- Production trusted-writer.ts, query-reader.ts and store.ts equal the prior
  reviewed source byte for byte. `production-identity.json`; git diff contains
  only the two named candidate files before this review report. `git diff
  --check` passed.

## Cortex and local-pattern evidence

Applied using-cortex, change-impact, pattern-review and context-review skills.
Search/related/impact/rules run before review; scoped ingest and graph load cover
only five direct source/test references, then the candidate historical report.
Tracked config restored; watch stopped; no providers/embeddings/broad indexing
or hooks. Search uses lexical ranking with an explicit missing-embeddings
warning; graph/context review uses the valid local Ryu publication.

Relevant entities: file:scaffold/mcp/src/core/analysis-state/trusted-writer.ts,
file:scaffold/mcp/src/core/analysis-state/query-reader.ts,
chunk:scaffold/mcp/tests/analysis-state-trusted-writer.test.mjs:runWorker:494-535.
File-local fixture/private-temp conventions at test44–46,82–110, and same-module
analysis-state-cli.test.mjs78–91 support the candidate's fixture approach.
Pattern evidence for the historical report has no applicable local evidence;
no invented documentation convention is imposed.

Candidate `cortex review --diff --json`: two changed files, one eligible/reviewed
code file, zero findings, zero conflicts, no omitted files. `candidate-review.json`.
Six active rules and per-file pattern evidence saved alongside that output.
No policy failure observed; advisory automated review supplements direct review.

Final commit binding is to be added after manager commit; approval applies only
to the exact candidate hashes above and documented control-only additions.
