# WO-047 Stage 2 Frozen-Input Bridge

## Outcome

The Cortex-side deterministic bridge is complete and remains offline. It maps
the five immutable Stage 1 retrieval packets through the exact
`renderUntrustedRetrievalPacket` export into exactly five bounded treatment
frames. It creates no control frame. The `issue-text-only` control contract
receives the exact issue text and bound repository, with no Cortex packet and
no Cortex retrieval tools.

This work prepared artifacts only. It made zero planner calls, zero
solution-model calls, zero provider calls, and zero Stage 2 invocations. It did
not launch AgentStackBench or edit the AgentStackBench repository. The user's
authorization is recorded as exactly ten future solution calls: five frozen
tasks times two arms, one attempt per task/arm, with no retry, fallback, arm
substitution, or post-freeze mutation.

## Frozen Sources And Renderer Identity

The bridge fails closed unless all source bytes match:

| Source | File SHA-256 | Canonical payload SHA-256 |
| --- | --- | --- |
| Stage 1 frozen fixture | `af51a243ec396869f3348645de1faea59310e5eaac2547817480b769dac3148d` | `89651b34fefed1a9ea2f06cf04f589c6fdeca1dac1f21c8165301b21cef71afa` |
| Stage 1 retrieval contract | `bc79202564c1545e20a8fa9725f48c5d181e291958dc80381e43f4344d60e172` | n/a |
| Stage 1 retrieval packets | `22ca32e453aeecdc9e3c4d58c897fe01b4f923882b6cdfba505473abb9312856` | `aed97409dac3049e33d4bb03129c2d0d27b7113f7a28a3c96ee166b15e8b01ac` |
| Stage 1 offline score | `4940dfc3180818014954bbd85408c985507be901d4c7fd65e388d3aea4e6f349` | `7963d340a07c817c1d41fcd0b860ebdb0afe97a1271fb6e2ea7e0f46eed50abf` |
| Stage 1 renderer module | `6970be751dc0afe307fcd5add6e2dced465d12257101d45d63bce6d7c92ae980` | n/a |

The exact renderer identity is module
`benchmark/bootstrapbench/wo047-two-pass-subsystem.mjs`, export
`renderUntrustedRetrievalPacket`, renderer version
`wo047_untrusted_retrieval_frame_v1`, function-source SHA-256
`0f803cc04d3dc469e800545621ba326484515bd539ed6d20a651ccfb090f6a2d`,
and function-source size 10,483 UTF-8 bytes. The renderer-contract canonical
SHA-256 is
`5df5bf03e9e584bf4e6bd5dde8193057e825c0a963a6bc3f0f5c6e1f2ab71418`.
The bridge module file SHA-256 is
`5d8c70ca91f55462cd6e779f5e63dda64cdedfeb5b49c37263deddab7a84b78c`.

The Stage 1 fixture, contract, retrieval packets, offline score, and renderer
module remained byte-identical before and after materialization.

## Neutral Consumer Contract

The manifest exposes
`consumer_contract.schema_name=wo047_neutral_paired_frozen_input_v1` for the
AgentStackBench-side adapter. The consumer must:

1. join tasks only by exact `task_id` in manifest ordinal order;
2. verify repository, base commit, root-tree, index, issue ID, issue byte size,
   and issue SHA-256 before constructing either arm;
3. give the control exact issue bytes and normal repository coding tools, but
   no Cortex packet or Cortex retrieval tools;
4. give treatment the same inputs plus only the exact bound treatment-frame
   bytes after frame file hash and size verification; and
5. fail closed on any identity, order, byte, or hash mismatch.

The manifest and decoded frames contain no gold patch, gold context, mechanism
rubric, primary-runtime judgment, regression-test surface, test patch,
evaluator judgment, expected-fix, or oracle field. The bridge does not copy
issue text; it binds its exact byte count and SHA-256 for the consumer to
verify symmetrically.

## Candidate-Neutral Metric And Tie Policy

The primary metric was frozen before candidate output as
`native_resolution_pass_at_1_count`: each task/arm receives binary value one
when its native resolution passes and zero otherwise, summed across all five
symmetrically valid task pairs. Treatment must be strictly greater than
control.

- When both arms have the same binary result, the task pair remains tied.
- Equal aggregate counts fail the strict-improvement gate.
- There are no primary tie breakers; supporting metrics never break a primary
  tie.
- An invalid arm invalidates its pair symmetrically, and any invalid pair makes
  the frozen five-pair primary result non-passing.

Patch overlap; file, symbol, and line precision/recall; time to first relevant
edit; broad repository wandering; and irrelevant files opened remain
supporting metrics only.

## Artifacts

Manifest:
`benchmark/bootstrapbench/results/wo047-stage2-bridge-v1/bridge-manifest-v1.json`

- file SHA-256:
  `cfe4933c1497d11adde9ba7162dfdfd53d84071a025edad8d746d1793fe880fe`;
- canonical payload SHA-256:
  `376294d3c0ca79e49690f70ad787cc3808d9fe82e79b77f9e8924e74d2a44289`.

| Ordinal | Frozen task / issue | Commit | Frame SHA-256 | Frame bytes | Decoded bytes |
| ---: | --- | --- | --- | ---: | ---: |
| 1 | `Multi-SWE-Bench__rust__maintenance__bugfix__37f525d2` / `clap-rs__clap-3421` | `15f01789d2a6b8952a01a8a3881b94aed4a44f4c` | `2cd7616f620e8d64497a9121245c41aeb22858731a5162cb0f06eb17e2d45b0d` | 31,443 | 23,296 |
| 2 | `SWE-Bench-Pro__python__maintenance__bugfix__512d556b` / `instance_ansible__ansible-fb144c44144f8bd3542e71f5db62b6d322c7bd85-vba6da65a0f3baefda7a058ebbd0a8dcafb8512f5` | `662d34b9a7a1b3ab1d4847eeaef201a005826aef` | `891fc7abef65412dadabd9e8a6a2e0e56dc38227850d16fa8ee28436ce0b1c92` | 73,855 | 55,107 |
| 3 | `SWE-Bench-Pro__javascript__maintenance__bugfix__09eb0d6d` / `instance_NodeBB__NodeBB-a5afad27e52fd336163063ba40dcadc80233ae10-vd59a5728dfc977f44533186ace531248c2917516` | `7800016f2f1b89d2d3cfea6a7da7c77096b7b927` | `6c8e38ad6599fcc293cee2700cbc1f006154fcdc46b1956427412c1a86022541` | 80,411 | 60,022 |
| 4 | `SWE-PolyBench__python__maintenance__bugfix__8c189fda` / `keras-team__keras-18553` | `c8a5a8969a8712a9a1939937ce34158e04cfc09d` | `de3b2c01a2a4f927fb89088bb44f5f74d96c16685b9f263501f506bca75f33ef` | 58,755 | 43,782 |
| 5 | `SWE-Bench-Verified__python__maintenance__bugfix__e09a2d75` / `sympy__sympy-13551` | `9476425b9e34363c2d9ac38e9f04aa75ae54a775` | `89bd1b09aceb50a0e3b9f78a262590f53e67495535fbecc0ef0483e97212c5d3` | 85,923 | 64,157 |

All frames are below the frozen 252,032-byte complete-frame and 185,856-byte
decoded-payload bounds. Their aggregate complete-frame size is 330,387 bytes;
their aggregate decoded size is 246,364 bytes.

## Validation

- `node --check benchmark/bootstrapbench/wo047-stage2-bridge.mjs` — pass.
- `node --test tests/bootstrapbench-wo047-stage2-bridge.test.mjs` — 4/4
  pass.
- Combined frozen Stage 1 replay and bridge suite — 17/17 pass.
- Two independent in-memory builds and two independent directory
  materializations are byte-identical.
- The focused suite proves exact five/no-control framing, closed control-arm
  delivery, source and renderer binding, task/issue/commit binding, frame
  bounds, absent evaluation fields, metric/tie freezing, zero-call counters,
  immutable Stage 1 hashes, no overwrite, and fail-closed source tampering.
- `git diff --check` — pass.
- `cortex pattern-evidence <changed-file> --json` — pass for the bridge module,
  focused test, this record, and context packet after refresh. The generated
  manifest and frame files are deliberately outside indexed context under the
  frozen `benchmark/bootstrapbench/results/` exclusion; their exact hashes,
  closed payloads, bounds, and replay are validated directly by the focused
  suite.
- `cortex update` ingested 691 files and rebuilt the graph. Its changed-entity
  embedding child repeated the documented runaway-memory behavior and reached
  approximately 17.8 GB RSS after 52 seconds. Only that exact child was sent
  `SIGTERM`; the parent completed with lexical fallback and exited zero. A
  final `cortex ingest --changed` and `cortex graph-load` refreshed the index
  and graph without restarting embeddings.
- `cortex doctor` — 8/8 pass at 100% freshness.
- `cortex watch status` — stopped; no background writer is active.

Final activity remains `planner_calls=0`, `solution_model_calls=0`,
`provider_calls=0`, `stage2_invocations_run=0`, and
`launch_status=not_launched`.
