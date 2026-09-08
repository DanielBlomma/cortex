# WO-048 Quick Four-Issue Treatment Results

Date: 2026-08-22

## Scope

The user requested a fast follow-up over the first four issue-quality-pass tasks
from the uncontaminated WO-048 remainder. The run used Prettier `10ab7842`, VS
Code `4f3cb6be`, scikit-learn `27320d49`, and Django `ac705f35`. Vuls
`720b4d92` was excluded because its frozen issue-description score was 3/8.

This was a treatment-only smoke, not a paired benchmark:

- model: `gpt-5.6-sol`;
- reasoning effort: `xhigh`;
- exactly one fresh solution agent and one attempt per task;
- exact issue text plus the frozen WO-048 two-pass retrieval frame;
- local repository inspection allowed, but no Cortex/MCP retrieval tools,
  external search, gold patch, mechanism rubric, evaluator data, prior solution,
  retry, or delegated agent;
- four solution-agent calls total and no issue-only control calls.

The solution worktrees were detached at the exact commits bound by
`benchmark/bootstrapbench/fixtures/wo048-clean-five-v1/frozen-fixture-v1.json`.
All mechanism rubrics were opened only after all four candidates had finished.

## Result

All four candidates were close to the frozen real-fix mechanism: **4/4**.

| Task | Issue quality | Primary-owner retrieval | Mechanism result | Verification |
| --- | ---: | ---: | --- | --- |
| Prettier `10ab7842` | 7/8 | 1/1, rank 2 | Close | Full suite: 383 suites, 1,096 tests, and 1,096 snapshots passed; focused export suites 14/14 passed |
| VS Code `4f3cb6be` | 7/8 | 0/1 | Close | `git diff --check` passed; repository dependencies/build output were absent, so the focused runtime test could not execute |
| scikit-learn `27320d49` | 8/8 | 1/1, rank 2 | Close | New tests 3/3, nearby tests 13/13, common contract tests 6 passed and 4 skipped |
| Django `ac705f35` | 6/8 | 1/1, rank 10 | Close | Compile, isolated DDL-reference behavior, and diff checks passed; the Django suite could not start because local dependencies were absent |

Aggregate retrieval was 3/4 primary owners, with no retrieval tuning. The VS
Code candidate still found the correct owner through ordinary local repository
inspection from a precise issue description despite the frozen frame missing
that owner.

## Mechanism Judgments

### Prettier — Close

The candidate changed `printExportDeclaration` in `src/printer.js` to separate
`ExportDefaultSpecifier` and `ExportNamespaceSpecifier` from ordinary named
specifiers. Standalone extension specifiers are printed without braces, while
only ordinary `ExportSpecifier` values remain in the braced group. Regression
coverage includes default-plus-named and default-plus-namespace forms under the
Babylon parser. This satisfies all three frozen requirements.

### VS Code — Close

The candidate narrowed the after-word suppression in
`TypeOperations._getAutoClosingPairClose` to single and double quotes by
explicitly exempting backticks. The regression test covers a backtick after a
tag identifier, multiline content, and overtyping the inserted closing
backtick. This satisfies all three frozen requirements without weakening the
single/double-quote rule.

### scikit-learn — Close

The candidate added `fill_value` to `IterativeImputer` documentation, parameter
constraints, constructor state, and the internal `SimpleImputer` construction.
The constraint remains no-validation, and tests cover a numeric value and
`np.nan`, including a NaN-tolerant estimator. Default `None` behavior remains
delegated to `SimpleImputer`. This satisfies all three frozen requirements.

### Django — Close

The candidate passes `model._meta.db_table`, rather than the already wrapped
`Table` reference, into `_index_columns()`. `IndexName`, `Columns`, and
`Expressions` therefore use the string table identity while only the
`Statement.table` field uses `Table`. The regression checks positive and
negative column references, and the existing `Table` field preserves table
reference detection. This satisfies all three frozen requirements.

## Candidate Patch Artifacts

Ignored artifact root:
`benchmark/bootstrapbench/results/wo048-quick-four-treatment-v1/`

- Prettier patch: `fc74d971fd06acf1f000936b515cf84ea16ebd0b1a4007dca07581a264a5868e`;
- VS Code patch: `1056e2aa3343f0189dd8db4ec76a36c3f2cf1325f24a11cdb482666485e29a2c`;
- scikit-learn patch: `39630bb71e082d5869ba74bafb9992b994aff1a3419e2e4a6701f382df1bd116`;
- Django patch: `0b0d9dc229bf03c39df476bfa930a781626a051f19c8085dd14a8e4bfdb0d06c`.

No candidate patch was applied to Cortex or its production code, and no commit,
push, publication, or Stage 2 run occurred.

## Interpretation

The result supports the user's hypothesis that issue-description quality was a
material weakness in the earlier five-task sample: the first treatment-only
set scored 2/5 close, while these four description-quality-pass tasks scored
4/4 close under the same model, reasoning effort, and one-attempt policy.

It does **not** isolate the causal benefit of two-pass retrieval. There was no
issue-only control arm for these four tasks, and solution agents could inspect
their local repositories. The VS Code result is especially important: it was
solved correctly even though retrieval missed the frozen primary owner. The
defensible conclusion is therefore that the new retrieval is useful but issue
quality and ordinary repository navigation remain major contributors. A small
paired issue-only versus two-pass run would still be required to claim uplift.
