# Clean PR Readiness Context Packet

## Objective

Prepare a clean PR/disposition plan for the local memory and Angular
improvements without merging stale remote perf branches.

## Background

- Current checkout is `main` and dirty with local implementation work.
- Pre-existing unrelated local files include `.gitignore`,
  `WORKPLAN-2.1.0.md`, and `cortex-2.1.0-changes.patch`; do not include them
  unless the manager explicitly asks.
- `origin/perf/embed-scheduler` is already contained by `origin/main`.
- `origin/perf/bootstrap-stage-optimizations` is stale/superseded and should
  not be merged directly.
- Angular quality backlog is deferred until after this memory pass.

## Owned Scope

- Read-only git/branch/PR analysis.
- Optional control-doc note under `docs/agent-control/` if assigned by manager.

## Out Of Scope

- Switching the manager checkout branch.
- Pushing branches or opening PRs.
- Reverting any user or unrelated local changes.
- Code edits to runtime/test files.

## Constraints

- Use non-destructive git commands only.
- Stage nothing and commit nothing.
- Produce an actionable branch/PR plan that separates intended tracked files
  from unrelated local files.
- Prefer a clean branch from current `main` with selected files over rebasing
  stale perf branches.

## Required Output

- Current branch and dirty-file classification.
- Remote perf branch disposition.
- Proposed PR split or single-PR recommendation.
- Exact file list that should be staged for the memory/Angular work and exact
  files that should be left out.
- Validation gates still needed before PR.

## Acceptance

- Manager can create the PR branch without relying on chat history.
- No destructive git action was taken.
