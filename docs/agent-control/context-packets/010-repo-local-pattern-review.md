# Repo-Local Pattern Review

## Principle

AI-generated or AI-reviewed code should follow repo-local and file-local
conventions. The goal is for new code to look like it was written by the same
people who wrote the surrounding code.

## Review Goal

When reviewing a change, Cortex should help the reviewer compare new code
against existing patterns in nearby code and in the same feature area.

The review should prefer evidence from:

1. The same file.
2. The same directory or module.
3. The same feature area.
4. Repo-wide conventions.
5. General best practices, only as a fallback.

## Pattern Types

Cortex should detect and compare patterns such as:

- Helper shape and naming.
- Error handling.
- Configuration and environment-variable parsing.
- Test fixture style.
- Data transformation style.
- Fallback behavior.
- Command and output shape.
- Validation requirements.
- Retry, timeout, and logging patterns.

## Review Question

Does this change follow the established pattern for this kind of problem in
this repository, or does it introduce a second way to solve something that
already has a local convention?

## Evidence Requirement

Every pattern finding must cite concrete existing code or documentation.
Cortex must not invent style rules without evidence. If no applicable local
pattern is found, the review should state that before applying general best
practices.

## Intended Follow-Up

Use this principle as the source for a future work order that integrates
repo-local pattern evidence into automated Cortex-assisted review. The active
`rule.repo_local_pattern_review` entry in `.context/rules.yaml` remains short
and links back to this document rather than duplicating it.
