# WO-LOCAL-002: independently accept the Git-ignore candidate

Status update: independent review and iteration completed in WO-LOCAL-002.
The [final report](../local-002-gitignore-review.md) supersedes the original
frozen hashes and pending-review statements below. Merge remains blocked.

Fresh-session continuation of WO-LOCAL-001, 2026-09-10. The implementation
session compacted; stop at the frozen candidate and do not treat its summary
as review evidence. This packet and direct files suffice to resume.

## Authority and location

- User authorized completing only Git-ignore discovery and previously authorized
  PR publication and code merge. No search/benchmark experiment, dependency
  remediation, provider call, heavyweight indexing, release or gate waiver.
- Candidate: `/private/tmp/cortex-gitignore.vRkBH9/repo`, branch
  `fix/root-gitignore-discovery`, base `37a511fa76ce04804f6cf4497202966dd78ff1f0`.
  All changes are unstaged/uncommitted; no runtime PR exists yet.
- Separate baseline/validation tree: `/private/tmp/cortex-local-assess.zTBH2P/repo`,
  detached at that same base. Locked parser, MCP and Harness dependencies are
  installed; MCP build and `npm run release:prepare-root-test-context` passed.
  Its ignored `.context` is lexical/graph only, not an embedding run.
- Original `/Users/danielnilsson/GIT/cortex` is a dirty historical checkout on
  `plan/r16-ingest-filesystem-containment`; never stage/reset/merge there. All
  770 previously captured file hashes were independently rechecked unchanged
  at this handoff. Do not import old runtime or search changes from it.

Read workflow-playbook.md, review-iteration-protocol.md, scaffold/AGENTS.md,
local-001-gitignore-port.md, and the three candidate files below. Assign fresh
independent reviewers before any iteration. Original implementation owner was
`/root/local_runtime_assess`; root review was assigned but not completed.

## Frozen candidate and owner evidence (not independent acceptance)

| File | SHA-256 |
|---|---|
| scaffold/scripts/lib/ingest/files.mjs | adf6abc0180c66929d365c3e15bf0be37eb8eccdc04ed199b3f3b8c8bd3b8148 |
| scaffold/scripts/lib/ingest/pipeline-stages.mjs | fcf277a4e60b6fc48e7ad3bb1264424dea45af8d1cb2437d71258b8adf3c6c92 |
| tests/ingest-filesystem-boundary.test.mjs | bad27a5a8c3b43b0d4da941b014b482209eed4c2a662ea8567f2ac76cfff88cb |

The owner reports `node --test tests/ingest-filesystem-boundary.test.mjs
tests/ingest-units.test.mjs`: 96/96 pass, zero skips (21.8s), plus module syntax
checks. Manager independently ran `git diff --check`: pass.

Behavior to review: root scope omits untracked Git-ignored paths, retains tracked
paths and normal untracked files; explicit non-root sources override ignoring
regardless of order. Changed-mode cache hydration removes newly ignored files
and ADRs, with existing hydration removing dependent chunks. Git discovery uses
shell-free subprocesses, sanitized GIT_* environment, root-identity checks,
30-second/32-MiB limits and scrubbed errors. Genuine Git errors abort changed
mode even for explicit scopes; only positively identified non-Git directories
fall back. Git metadata and global ignore configuration remain authoritative.

Six new test groups exercise scope overrides, nested/newline/Unicode paths,
tracked files beneath ignored parents, cache pruning, corrupted Git repositories,
ambient overrides, root replacement, malformed and cross-boundary rename records.
Timeout/output-limit branches inject subprocess results; these are not measured
30-second or 32-MiB stress runs. Positive Git and corruption cases use real repos.

## Independently measured untouched-main baseline

- Focused boundary/unit/characterization/dashboard: 97/97, zero skips.
- `npm test`: context regressions pass; Node 431 total, 421 pass, 10 fail,
  zero skips. Failures: three plugin-manifest release expectations and seven
  release-workflow contracts (stale expected 2.5.2 versus actual 2.7.0, missing
  gate/fixture names and newer registry-helper contracts). No candidate source
  had been copied into this tree for these measurements.
- Separate context regression run: 81/81. Separate Harness tests: 6/6, because
  the failing root stage prevents the chained Harness invocation.
- Locked MCP install reports five high/five moderate audit findings on Sep 10;
  parser and Harness installs report zero. No dependency changes made.
- Known baseline failures are not permission to weaken or skip merge gates.
  Keep WO-RV-003/004 findings explicit and distinguish new regressions.

## Remaining acceptance work

1. Verify hashes/base and inspect the complete source/test diff independently.
   Check scope pruning, cross-prefix rename endpoints, fail-closed Git/non-Git
   classification, ignored retained records and last-published-state preservation.
2. Fix the known test-gate follow-up before packing: the packed containment gate
   at `tests/packed-filesystem-containment.test.mjs:515` and its evidence field
   at line 549 still pin 42 boundary cases. Six new groups were added. Establish
   the actual new count, update only the related exact-count assertions, and run
   the gate; do not weaken inventory, mode, ownership or integrity assertions.
3. Copy only reviewed candidate source/tests into the separate validation tree;
   rerun focused, full root/Harness and applicable packed containment/ownership
   gates. Candidate-wide and packed validation have NOT run yet.
4. Use Cortex search/rules/impact and required review/pattern tools. Prior owner
   used the old installed CLI (guidance/review unsupported). Manager built current
   CLI context but `node bin/cortex.mjs guidance ... --json` returned
   `INVALID_ARGS: Guidance failed safely`. Search evidence was from the old index;
   no candidate context refresh/pattern review/final review is yet accepted.
   Do not invoke a broad Jina embedding update: use scoped lexical/graph context
   and explicitly record limitations and direct review if tools fail safely.
5. Resolve review findings, update manager/handoff/matrix/risk status, then commit
   explicit files, push and open an infra-sensitive PR. Use no background hooks
   that could trigger excluded heavy indexing. Inspect actual CI/merge state;
   merge only after acceptance, never admin-bypass failing checks. No release.

If any baseline gate prevents safe merge, publish the reviewed PR as blocked and
report exact remaining authority/work instead of claiming completion.
