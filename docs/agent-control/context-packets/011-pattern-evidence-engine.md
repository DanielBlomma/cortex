# Pattern Evidence Engine

## Objective

Implement WO-021: a deterministic CLI-first evidence engine that retrieves and
classifies repo-local pattern evidence for a file path or file-backed entity.

## Background

The governing principle and evidence order live in
`010-repo-local-pattern-review.md`. `rule.repo_local_pattern_review` makes the
principle active, but Cortex does not yet expose structured pattern evidence for
a review target.

## Work Profile

New contract/design: this work introduces a stable JSON output contract for a
new CLI retrieval command.

Required reviewers before manager acceptance: Code Quality Reviewer, Contract
Reviewer, and Validation Reviewer.

## Owned Scope

- `bin/cortex.mjs` CLI help and dispatch.
- `scaffold/mcp/src/cli/query.ts` CLI argument and envelope handling.
- A focused pattern-evidence module under `scaffold/mcp/src/`.
- Focused MCP runtime and root CLI shim tests.
- WO-021 agent-control traceability.

## Out Of Scope

- An MCP `context.review` tool or LLM-authored review findings.
- Changes to the general search ranking algorithm or embedding model.
- Automatic diff parsing or Git worktree mutation.
- New external services, telemetry, or source upload.

## Constraints

- Reuse the existing local Cortex search runtime.
- Accept a repository-relative file path or file-backed entity id.
- Preserve this evidence order: same file, same module, same feature area,
  repository-wide fallback.
- Every evidence item must cite a path and include line bounds when the indexed
  entity is a code chunk.
- State explicitly when no applicable local pattern is found.
- Keep JSON output deterministic for identical indexed context and arguments.

## Known Failure Modes Checklist

- Do not treat the target entity itself as supporting evidence.
- Do not silently classify repository-wide evidence as a local pattern.
- Normalize path separators before locality comparison.
- Do not emit uncited prose findings.
- Invalid or non-file-backed targets return a structured CLI error with
  `--json`.

## Required Output

- `cortex pattern-evidence <file-path|entity-id> [--query <text>] [--top-k <n>] --json`.
- A stable target, query, tier, citation, and fallback response shape.
- Fixture tests covering helper shape, error handling, configuration parsing,
  and a repository-only negative case.
- Focused and full validation results recorded in the handoff ledger.

## Acceptance

- Results are grouped into all four evidence tiers in the required order.
- Code-chunk evidence includes `path`, `start_line`, and `end_line`.
- `local_pattern_found` is false when only repository-wide evidence exists.
- CLI JSON errors preserve the existing envelope convention.
- Focused tests, the MCP test suite, root tests, `git diff --check`, and a live
  Cortex smoke query pass.
