# WO-LOCAL-006 independent Ops / Validation / Integration review

APPROVE the exact two-file candidate below for coordinated draft PR preflight.
No unresolved blocker or major source finding. This is not merge or release GO;
the complete native hosted final-head preflight and true Bump/Publish completion
remain mandatory.

## Isolation and candidate identity

Reviewer assigned before implementation, fresh session and separate clone
`/private/tmp/cortex-local-006-ops`, initial HEAD
`5428818831ebeb152bb43aa9fbd4e41dbea03ae4`. Read only the local-006 packet and direct
references. Historical trees remained read-only. Manager owns remote mutations;
this reviewer performed none. Existing ignored runtime/dependencies were copied
from the authorized local-005 manager. No package install, provider, embedding,
broad indexing, watch, hook, release, tag or global CLI action.

Exact SHA256 of reviewed manager candidate copied into the isolated clone:

- `scaffold/mcp/tests/analysis-state-trusted-writer.test.mjs`:
  `e40ba6d5668db08fd51b41ccaf2482292a717d33f22c057a2b106579ccc7f8f4`
- `docs/agent-control/maintained-analysis-state-writer-report.md`:
  `8de2fa1c1afd1ad4e75b69cab6c19f0a1fb1c648f3ef730c2d1926300e4ba9ac`

Only these two paths differ from the initial source candidate. Production,
workflows, package metadata, root/bundle/test-count guards and timeouts are
unchanged. The historical report now accurately limits stale-CAS classification
to successfully prepared contenders; it preserves fail-closed overlapping reads.

## Concurrency and cleanup review

`analysis-state-trusted-writer.test.mjs:494–535` instruments only the worker's first
mkdir of its exact exported coordinator-lock path. Production
`trusted-writer.ts:298–306,410–417,761–772` places that first mkdir after optimistic
trusted preparation. Each worker writes readiness into one private mkdtemp
outside the strict maintained-state tree, then both wait for the same parent
release marker. The original mkdir, return value, arguments, exceptions and real
append execute unchanged after release. Later mkdir calls do not pause again.

The existing race at test lines537–591 waits for both readiness markers before
release, still requires exact statuses0/1 and `/stale writer/u`, and additionally
requires empty stderr, success/failure JSON flags, generation2/count2 and exact
winner snapshot, observation head, authority bundle, authority manifest, source
registry and appended observation identity against a fresh trusted read. No
retry, widened diagnostic, reader guard bypass or production hook was added.

Parent bounds readiness plus append to5seconds; worker independently bounds its
rendezvous to5seconds. stdout/stderr are drained; spawn errors are captured and
child close resolves each worker result. Early close is detected during readiness.
Finally clears the parent deadline, SIGKILLs only still-open owned worker PIDs,
awaits close/reaping for all workers, then removes barrier and fixture. Normal
success reaches finally with both workers closed, so sends no kill. Workers run
only the synchronous append module and create no subprocess descendants.

## Independent validation

macOS Node22.23.2, one execution per scenario, no retry-to-green:

- Exact candidate entire writer test file:8/8 pass, no skips/failures; target race
  finishes266ms. `writer-candidate.log`.
- Unchanged reader regressions concurrent-authority-replacement-after-replay and
  unrelated-root-entry acceptance:2/2 pass. `reader-races.log`.
- Diagnostic-only early child exit23: expected early-rendezvous rejection234ms.
- Diagnostic-only spawn ENOENT: expected early-rendezvous rejection291ms.
- Diagnostic-only withheld readiness: expected parent deadline rejection5211ms.
- Diagnostic-only withheld release: expected parent deadline rejection5237ms.

All four failure probes checked child PIDs no longer exist and both fixture and
barrier paths are gone. No unhandled child error occurred. Each diagnostic used a
separate non-`.test.mjs` copy, changed only its specified fault plus PID/path
recording, ran only the target test, and was removed afterward. Production and
candidate file remained untouched. These expected-failure probes do not add tests
to or weaken the651-test suite. Reproducible driver and individual raw logs are in
`/private/tmp/cortex-local-006-ops-evidence/validate-cleanup.py`, `cleanup-summary.json`,
`early-exit.log`, `spawn-failure.log`, `missing-readiness.log`, `missing-release.log`.

## Cortex and integration evidence

Applied using-cortex/change-impact/pattern-review/context-review. Scoped lexical
and graph ingest covers only five direct writer/reader/store/test files plus the
edited historical report. Search identifies
`chunk:scaffold/mcp/tests/analysis-state-trusted-writer.test.mjs:runWorker:494-535`;
related/impact support the single caller. Six active rules returned. Same-file
pattern evidence cites fixture97–110 and runWorker494–535; the existing fixture,
child capture and cleanup conventions remain the local basis for review.
Per-file patterns are advisory evidence, not separate policy-pass claims.

Initial report pattern request failed verbatim:
`Pattern target was not found in indexed context: docs/agent-control/maintained-analysis-state-writer-report.md`.
The first diff review returned `Review failed safely` while the temporary scoped
config remained modified. Adding only that direct report to the scope and
restoring tracked config resolved both. Final `review --diff --json` returns
ok:true, exactly two changed paths, zero findings/conflicts; review hash
`5ac0c39b7333adc43dfc2adafdf498e40087b6813d6463bd2a0677f768cb3ad0`.
Evidence is retained in the same directory, including initial failures,
`final2-doc-pattern.json`, `final2-review.json`, rules/search/impact/related and
scoped ingest/load logs. `watch status` reports stopped; tracked config restored;
diff whitespace check passes.

The existing fresh-checkout guards still require81context/437root/6bundle/651MCP.
The candidate changes no test registration/count and no release script/workflow.
Preflight/Bump/Publish retain complete and pristine suites, six audits, packed
containment, frontend, exact duplicate root/bundle artifacts, empty-cache install,
pinned Harness headless/Web/removal lifecycle and final boundary checks. Bump
retains exact eight-file metadata staging and atomic main/annotated immutable tag;
Publish retains tag-only source, supported npm, OIDC, root-before-bundle exact
publication/safe resume, registry byte integrity and registry Harness lifecycle.
Previous native failure34597272860 remains historical failed evidence. Only a
successful actual final-head native run can clear that remaining release gate.
