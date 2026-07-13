# Context Packet Template

Numbering: packets are numbered sequentially and numbers are never reused.
Gaps are allowed (reserved or cancelled work), and the packet number does not
need to match the work-order number.

## Objective

State the concrete task and expected output.

## Background

List only the facts needed for this assignment. Link to prior decisions instead of copying long history.

## Work Profile

Exactly one profile from `review-iteration-protocol.md`, with a one-line motivation.

## Owned Scope

Files, modules, data entities, routes, tools, or docs this agent owns.

## Out Of Scope

Files, modules, entities, or decisions the agent must not touch.

## Constraints

Security, privacy, test, and architecture constraints.

## Known Failure Modes Checklist

Recurring review findings from past work orders. First-pass work must satisfy
these before reviewer handoff; reviewers reject first passes that miss them.
Grow this list from your own handoff ledger — these starters came from real
review iterations:

- Audit/event action names match the project's taxonomy verbatim; no local
  action-name drift.
- Every mutation path has success, denied, error, and no-row/no-match test
  coverage, not only happy paths.
- Errors are sanitized before they reach clients or audit metadata.
- Security/validation gate ordering is proven by a test, not asserted in prose.
- Locale and persona parity is covered where the surface is user-facing.
- Misuse and bypass attempts have explicit negative tests.

## Required Output

- Changed files/entities or findings.
- Tests run and results.
- Risks introduced or closed.
- Open decisions for the manager.

## Acceptance

Concrete checks the manager will use to accept or reject the handoff.
