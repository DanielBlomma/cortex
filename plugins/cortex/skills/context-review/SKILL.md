---
name: context-review
description: Use when finalizing any code review, pull request, or completed change - runs the Cortex review gates so policy rules and pattern evidence are checked before sign-off
---

# Context Review

## Workflow

1. If the enterprise MCP tool `context.review` is available, run it with
   scope `changed` and include its policy results in the review.
2. CLI fallback when MCP is not connected:
   - `cortex rules --json` — verify the change respects active rules.
   - `cortex pattern-evidence <file> --json` for each changed file (see the
     `pattern-review` skill).
3. Report failures verbatim; do not soften failing policies.

## Rules

- Run the review BEFORE declaring work finished, not after.
- `pattern_review` output is non-blocking advisory context; policy failures
  from validators are blocking findings.
- After substantial changes, run `cortex update` so the review sees them.
