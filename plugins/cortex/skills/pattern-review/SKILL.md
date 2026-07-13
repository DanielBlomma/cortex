---
name: pattern-review
description: Use when reviewing a changed file, diff, or pull request - retrieves repo-local pattern evidence with Cortex so review feedback follows this repository's conventions before generic best practices
---

# Pattern Review

## Workflow

For each changed file, run `cortex pattern-evidence <file-path> --json`.

Evidence is ordered by locality: same file, same module, same feature area,
then repository-wide fallback.

## Rules

- Prefer local evidence: if the same file or module already solves this kind
  of problem, the change should follow that pattern
  (rule.repo_local_pattern_review).
- Cite evidence (`path`, `start_line`-`end_line`) for every pattern claim.
- `local_pattern_found: false` with fallback evidence means weaker claims:
  present repository-wide patterns as suggestions, not conventions.
- Do not invent a pass/fail: pattern evidence is advisory context.
