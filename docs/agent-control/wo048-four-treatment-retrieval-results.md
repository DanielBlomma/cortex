# WO-048 Four-Task Offline Retrieval And Treatment Frames

## Outcome

The exact stabilized WO-047 two-pass retrieval algorithm was replayed without
tuning over the four issue-quality-pass WO-048 tasks: Prettier `10ab7842`, VS
Code `4f3cb6be`, scikit-learn `27320d49`, and Django `ac705f35`. Vuls
`720b4d92` was excluded. The run created exactly four treatment frames and no
control frames. It made zero planner, solution-model, provider, or solution
agent calls, and no solution agent was launched.

The full retrieval packets preserve the frozen Pass-0 results, ordering,
ranking, paths, selection, and hashes. Prettier's frozen rank-four Pass-0
record contains 3,237 UTF-8 bytes, exceeding the already frozen 2,112-byte
model-facing per-string limit. Under the user's explicit follow-up
authorization, only the model-facing copy uses a general deterministic valid
UTF-8 prefix at that existing limit. The projected record is marked
`content_truncated=true`; the full retrieval artifact remains unchanged. No
bound was raised and no retrieval or score input was tuned.

## Frozen Results

Primary-owner recall was computed only after all four frame bytes and the
bridge payload were frozen. The evaluator-only count artifact exports no owner
paths or mechanism rubric.

| Task | Primary-owner recall | First owner rank | Frame bytes | Decoded bytes | Frame SHA-256 |
| --- | ---: | ---: | ---: | ---: | --- |
| Prettier `10ab7842` | 1/1 | 2 | 12,994 | 9,460 | `585e645bf5d4ab830c888579d8b1caf388cef45fa4a3241011f1007ce3546cca` |
| VS Code `4f3cb6be` | 0/1 | — | 6,402 | 4,516 | `06c40d9c7d5f30fa73cc655572e419c5b010ae766a3abec67083157e24ba5f2b` |
| scikit-learn `27320d49` | 1/1 | 2 | 56,539 | 42,118 | `c304288e6b97724da1a28dcd14d96514e2c235b68f013c4031332c4d4ff0ba2f` |
| Django `ac705f35` | 1/1 | 10 | 104,731 | 78,264 | `cce906bef6bfbb3205fe01d2bd35a3d73305d18e033428e5db92369f723747fe` |
| **Aggregate** | **3/4** | — | **180,666** | **134,358** | — |

Every frame is below the unchanged 252,032-byte complete-frame and
185,856-byte decoded-payload limits. The untreated VS Code miss is reported as
observed; no parameter, query, bound, ordering rule, or selection was changed
to recover it. No solution run is authorized or launched by this result.

## Artifacts And Prompt Sources

Artifact root:
`benchmark/bootstrapbench/results/wo048-four-treatment-v1/`

- bridge manifest file SHA-256:
  `d37bfef48a50631ee90e2a0ea357c4d450755f356e26324c0a670caf6b03c23c`;
- bridge canonical payload SHA-256:
  `7ad009217d8570cf14ee434ea8cbcf385cc0011e25e41472bd98e31c4bdef881`;
- retrieval file SHA-256:
  `ff69f257942a8f0f9906f04143534ef9a83f8c0883c575e18d9f6e21e53ad020`;
- retrieval canonical payload SHA-256:
  `d6ba519d7cb0e72944dc9410aeae0c0f106de3b407ccdeb62d688f210aa0289a`;
- primary-owner score file SHA-256:
  `5ffcad4c0e72da4d9dd21f98e62adc07a6f56bf87d26d3da141af4717fc52d0b`;
- primary-owner score canonical payload SHA-256:
  `cbda87f3fb5a4320a1d8378d0705ecb163769471304786116c4c92d6bf175a92`.

Exact future treatment-agent prompt source paths, in manifest order, are:

1. Prettier: `issue-text-01.txt`, `treatment-frame-01.txt`;
2. VS Code: `issue-text-02.txt`, `treatment-frame-02.txt`;
3. scikit-learn: `issue-text-03.txt`, `treatment-frame-03.txt`;
4. Django: `issue-text-04.txt`, `treatment-frame-04.txt`.

No prompt was assembled. The manifest binds each source's exact byte count and
SHA-256, plus task ID, issue ID, repository, base commit, root-tree OID, frozen
index SHA-256, source-row hashes, and frozen baseline packet SHA-256. The
treatment frames and bridge manifest contain no gold, rubric, evaluator, or
control fields.

## Validation

- `node --check benchmark/bootstrapbench/wo048-four-treatment.mjs` — pass.
- Focused WO-048 suite — 6/6 pass, including exact-bound acceptance,
  deterministic over-bound UTF-8 truncation, nonmutation of full retrieval,
  source tamper rejection, no control files, closed evaluator fields, and
  byte-identical materialization.
- The permanent artifact tree was regenerated independently and compared
  byte-for-byte.
- The existing WO-047 retrieval and bridge modules and artifacts remain
  byte-identical and unchanged.
- Final counters are `planner_calls=0`, `solution_model_calls=0`,
  `provider_calls=0`, `solution_agents_launched=0`,
  `treatment_frames_created=4`, and `control_frames_created=0`;
  `launch_status=not_launched`.
