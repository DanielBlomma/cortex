# Context Review Pattern Integration

## Objective

Implement WO-022: integrate the accepted WO-021 pattern-evidence contract into
enterprise `context.review` as structured, evidence-backed review context.

## Background

- Packet 010 defines the repo-local review principle.
- Packet 011 and accepted WO-021 define deterministic per-target evidence.
- Existing `context.review` runs policy validators and records workflow/trust
  state, but does not expose repo-local pattern evidence.

## Work Profile

New contract/design: this extends the `context.review` MCP input and response
without changing existing policy pass/fail semantics.

Required reviewers: Code Quality, Contract, Security and Privacy, Validation.

## Owned Scope

- `scaffold/mcp/src/enterprise/tools/enterprise.ts` review integration.
- A focused enterprise review-pattern composition module.
- Focused MCP tests and public documentation.
- WO-022 control and release traceability.

## Out Of Scope

- LLM-generated findings or automatic claims that code conforms to a pattern.
- Changes to validator pass/fail results, workflow approval, or review trust.
- Source upload, new telemetry payloads, or external services.
- Automatic edits or Git mutations.

## Constraints

- Pattern context is local-only and non-blocking.
- Each analyzed target preserves WO-021 citations and explicit fallback state.
- Files are normalized, deduplicated, and ordered deterministically.
- Review scope is bounded; omitted files are counted explicitly.
- Unindexed files produce structured target status instead of failing the
  entire policy review.
- Existing `context.review` callers remain valid without new arguments.
- Audit metadata may include counts, never pattern excerpts or source content.

## Known Failure Modes Checklist

- Do not merge pattern context into policy validator summary counts.
- Do not label evidence as a pass/fail finding.
- Do not silently omit files beyond the configured limit.
- Do not expose absolute local paths or exception stacks.
- Do not run separate graph/embedding snapshots outside WO-021.
- Do not make enterprise review depend on network access.

## Required Output

- Optional `context.review` inputs for pattern evidence configuration.
- A `pattern_review` response with per-target status, canonical review question,
  citations, fallback state, and bounded summary counts.
- Focused tests for local evidence, repo fallback, unindexed files,
  deterministic ordering, limits, and disabled mode.

## Acceptance

- Existing review results and summary remain unchanged.
- Pattern context defaults on with a conservative target limit and can be
  disabled explicitly.
- No evidence result can be interpreted as automatic code approval.
- Tests and reviewer sign-offs cover contract, privacy, and validation.
- MCP and root test suites, release sync, live tool-level smoke, and
  `git diff --check` pass.
