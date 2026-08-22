# WO-048 Alternative Five Fixture Audit

## Disposition

**NO-GO for a new five-issue retrieval or solution run.** The immutable set
difference is valid and contains exactly five tasks with no known prior
solution-model/provider call, but only four pass the issue-description-quality
rubric frozen before any new candidate retrieval or model output was inspected.
The Vuls description fails because it does not state a falsifiable actual/expected
package result or a reproduction. No replacement exists inside the original
WO-045 12-task binding after the seven mandatory exclusions.

## Exact clean remainder

| Repository | Task ID | Issue quality | Result | Frozen index SHA-256 |
|---|---|---:|---|---|
| prettier/prettier | `SWE-PolyBench__javascript__maintenance__bugfix__10ab7842` | 7/8 | Pass | `1af4f9ac71ca2adb6cb250ada48b4858b17e5cd43d52cb299461518b042809b7` |
| microsoft/vscode | `SWE-PolyBench__typescript__maintenance__bugfix__4f3cb6be` | 7/8 | Pass | `fdaa1ea7adbc6030ee63c069ba3b79cb37750c507a5662c07c51873bbb9b82b8` |
| future-architect/vuls | `SWE-Bench-Pro__go__maintenance__bugfix__720b4d92` | 3/8 | Fail | `e2d493e80bd2794163236a663bd75509b8582b36911cbefeeb5db2183900c067` |
| scikit-learn/scikit-learn | `SWE-Bench-Verified__python__maintenance__bugfix__27320d49` | 8/8 | Pass | `cb9f65ee48100687f74b29ee056e7f6df42a3d294f81578122445a2f8df1ddaa` |
| django/django | `SWE-Bench-Verified__python__maintenance__bugfix__ac705f35` | 6/8 | Pass | `805a432ae808249fe8b350d8f9ff3a79dd87194b19e6d58b721c9949441a857d` |

The first four rows above pass the issue-only screen; Vuls scores 3/8 and fails.
"Clean" here means uncontaminated, not automatically fit for a five-task run.

## Frozen contracts

The fixture freezes exact UTF-8 issue bytes as base64 plus byte count and SHA-256,
repository commit/root-tree identity, aggregate/component index hashes, gold-derived
primary runtime owners with base blob/content hashes, and evaluator-only mechanism
rubrics. Description quality uses only issue text across four 0-2 dimensions:
behavior specificity, scope specificity, named symbols/files, and reproducible
expected result. Passing requires total >=6, behavior >=1, and reproducibility >=1;
all five must pass to authorize a five-issue run. Gold was not used for that score.

## Contamination proof

The original immutable pool has 12 tasks. The five WO-047 quick-treatment task IDs
were removed first. Pony and Gson were independently removed because the discarded
V9 evidence has one 76-byte nonempty raw response for each and the historical
provider/model-call count is two. Those seven IDs are disjoint, leaving exactly
five. V10y contributes zero provider/model calls and its frozen run tree contains
no `codex-events.jsonl`, `raw-response.json`, or prediction file. WO-048 made
zero planner/model/provider calls, built no retrieval, and launched no agents.

## Immutable artifacts

- Fixture: `benchmark/bootstrapbench/fixtures/wo048-clean-five-v1/frozen-fixture-v1.json`
- Fixture canonical payload SHA-256: `e6d4b5c22c27da0d83d062177df1cd63cd7514a2dd445179d7bce3746e0857ad`
- Fixture file SHA-256: `ec9788b14c5bd3ec9bb5c794a2c28f361bb97cf774f2410b9e73bf80a2902b0b`
- Detached attestation: `benchmark/bootstrapbench/fixtures/wo048-clean-five-v1/artifact-attestation-v1.json`

The detached attestation binds the report file hash and has its own canonical
payload hash. A file cannot truthfully embed its own byte hash, so file hashes are
kept in the detached attestation while each JSON artifact self-binds its canonical
payload.
