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

## WO-LOCAL-006 / PR130

Remote main37a511fa76ce04804f6cf4497202966dd78ff1f0 and PR head54af80981782ad03a22eb9c9421c1ac8664d6ae5
were rechecked before candidate commit; clean fast-forward ancestry, no dependent
PR stack or conflict. Final committed head and synthetic tree are verified in
local-006-release-completion-report.md before guarded merge.

## WO-LOCAL-007 actual native acceptance and guarded merge

Both reviewers formally bind exact6672c3259478034b079fd0cd9564f58ab020a351.
Coordinated fast-forward PR130 from6275039 to6672c32. Actual native Ubuntu
preflight34600081411 completedSUCCESS,29/29 steps success. Full focused47,
context81/root437/bundle6/MCP651 and pristine81/437/6/651 pass with zero skips;
six audits report zero vulnerabilities. Containment/frontend, pinned Harness,
identical duplicate artifacts, empty-cache install, real headless/Web/disposal/
profile-removal and final diff/secrets/version/runtime boundary all pass.
Raw log: local-007-evidence/preflight-34600081411.log; structured reports and
step JSON retained alongside it. Historical native failure remains unclassified.

Rechecked PR130 OPEN/DRAFT, head6672c32, main37a511f, no comments/reviews/pause,
MERGEABLE/CLEAN, required validateSUCCESS. Synthetic merge
9ead1dd9955f1ac89ad033b55434c02b9ebaf99c has tree
f9975b49f75061dbb9247c5b172461e429c3a058, exactly local merge-tree. No conflict
or dependent stack. Root independently confirms nativeSUCCESS. Manager accepts
final source/native gates and auto-advances existing authorized ready+guarded
merge, then existing minor Bump/Publish chain. No release gate waiver.
