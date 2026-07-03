# Conflict Ledger

The manager owns merge-conflict detection, resolution tracking, and validation
evidence. Do not rely on the code host's conflict banner as the only record.

## Rules

- Check PR mergeability after every push that changes shared implementation files.
- Before merge readiness, fetch the default branch and run a local merge or merge-tree check.
- Log every conflict with owner, decision, resolution, validation, and residual risk.
- If resolution changes behavior, run the affected test gates before marking resolved.
- Update the PR body when conflict status affects remaining gaps or release readiness.

## Template

| ID | PR | Base | Head | File | Conflict | Resolution | Validation | Status |
|---|---|---|---|---|---|---|---|---|
| C-001 | `#N` | `origin/main@<sha>` | `<branch>@<sha>` | path | What each side changed | What was kept and why | Commands/results | Resolved/Open |
