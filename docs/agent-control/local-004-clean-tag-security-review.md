# WO-LOCAL-004 clean-tag test contract review

Reviewer `/root/release_completion_manager/security_contract`, assigned before
implementation. Date 2026-09-11. Independent clone:
`/private/tmp/cortex-local-004-security.yviHNJ/repo`.
Exact reviewed candidate: `7699afb815b475fc7fe61acf711d8d0635795de3`.
Delta from `0b1d53c9efc821f1f7c1ee96b6ab4f1889ded0f4`.

## Disposition and classification

APPROVE the minimal test-contract repair. This closes a major validation defect
that would block Publish on a legitimately clean immutable tag. No runtime,
release gate, test count, lifecycle assertion, security limit or package version
was changed. Hosted artifact gates must run on the new candidate because the
packaged test's bytes change root-artifact identity. This is not merge/release GO.

The CLI integration test owns no Git fixture mutation yet formerly required
changed_files.observed_count > 0. Bump/preflight happen to create eight metadata
changes; Publish checks existing tagged metadata without changing it. Zero
changes are explicitly supported by review.ts's counted() implementation and
by the dedicated no-diff fixture in review.test.mjs. Requiring an ambient dirty
checkout therefore contradicted the tested API contract.

The replacement checks observed_count equals retained items plus omitted_count.
Schema, command/generator, argument-order determinism, byte limit, path masking
and exact context bytes/mtime invariance assertions remain untouched. Dedicated
review.test.mjs retains its own staged/unstaged/untracked/deletion/rename/binary
fixture and asserts five exact changed paths; this prevents an always-empty
implementation from silently satisfying all review tests.

## Independent clean and dirty evidence

- On the original clean candidate, targeted query-cli review test fails exactly
  at observed_count > 0. Direct runtime envelope is valid with zero changes.
- On 7699afb with clean Git status, all 18 query-cli tests pass. Targeted review
  test also passes; envelope has observed 0, omitted 0, items [].
- On 7699afb with one reviewer-owned README comment as the only Git diff,
  the targeted CLI test passes. Envelope reports observed 1, omitted 0 and
  the exact README.md path. The file was restored byte-for-byte afterwards.
- Dedicated no-diff plus owned five-path fixture tests pass 2/2 at exact head.
  The full unchanged review.test.mjs suite separately passes 29/29.
- `git diff --check 0b1d53c..7699afb` passes; no incidental source changes remain.

Logs in the clone parent directory: query-cli-clean-original-targeted.log,
query-cli-clean-fixed-full.log, query-cli-dirty-fixed.log,
query-cli-clean-fixed-envelope.json, query-cli-dirty-fixed-envelope.json,
review-clean-dirty-exact-head.log and review-fixtures-baseline.log.
An earlier overlapping context-preparation attempt returned a generic runtime
failure and is not the original-assertion reproduction; the subsequent stable
clean targeted run above is the decisive baseline evidence.

## Cortex and boundaries

Scoped lexical ingest and graph load cover six direct references: query-cli test,
review implementation/test, bin/cli/query-command.mjs, release-artifact helper
and Publish workflow. Search, six active rules and query-cli pattern evidence
succeed. Combined review after the final index refresh returns
`INVALID_ARGS: Review failed safely`; no policy pass is inferred from that
command. The documented rules/pattern fallback and direct exact-diff review
supply this review's evidence. Tracked config is restored. No provider,
embedding, broad index, background hook, remote write or other checkout mutation.
