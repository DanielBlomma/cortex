# WO-047 Two-Pass Subsystem Retrieval — Stage 1 Results

## Outcome

Stage 1 remains an offline retrieval `GO` at the frozen primary acceptance
floor after the Contract/Security remediation pass. The independent review's
prior `NO-GO` is not self-overridden; all fix-now findings from the
Contract/Security, Validation, and Integration/Code reviews are remediated
here for independent re-review.
The deterministic benchmark-only/default-off pipeline retrieved 7 of 10 frozen
primary runtime files, and every one of the five issues has at least one primary
owner hit. All five frozen original-query result lists remain exact ordered
prefixes. No planner, solution-model, or provider call occurred. Stage 2 was
neither prepared nor launched.

This result authorizes only a user decision about whether to prepare the exact
Stage 2 proposal. It does not authorize a solution-agent run, production-default
change, publication, release, or deployment.

## Frozen Evaluation And Retrieval Contracts

- Independent fixture reviewer: `/root/wo047_fixture_review`.
- Fixture: `benchmark/bootstrapbench/results/wo047-two-pass-stage1/frozen-fixture-v1.json`.
- Fixture file SHA-256:
  `af51a243ec396869f3348645de1faea59310e5eaac2547817480b769dac3148d`.
- Fixture canonical payload SHA-256:
  `89651b34fefed1a9ea2f06cf04f589c6fdeca1dac1f21c8165301b21cef71afa`.
- The fixture binds exactly five issues and ten unique primary-runtime
  `task x path` judgments. Its deterministic selection audit covers all 12
  source tasks and excludes the two tasks with discarded V9 non-empty model
  responses before sampling.
- Retrieval contract:
  `benchmark/bootstrapbench/wo047-two-pass-contract-v1.json`, file SHA-256
  `bc79202564c1545e20a8fa9725f48c5d181e291958dc80381e43f4344d60e172`.
- The contract file hash is independently pinned by
  `EXPECTED_CONTRACT_FILE_SHA256` in the benchmark implementation. Both file
  loading and direct retrieval reject changed frozen parameters or exclusions.
- Source V10c packet-set file SHA-256:
  `ff363512c2097c2d746601109b1317f5a6798261e1bc704a6face576daf12c4a`.
- The source packet set is resolved through the user-independent
  `AgentStackBench` sibling-repository locator plus repository-relative path
  and exact file hash; the contract contains no user-specific absolute path.
- Frozen bounds: definitions 12, baseline-file symbols 2, graph depth 2,
  subsystem anchors 12, Pass 2 candidate pool 80, runtime lane 32, test lane
  12, and final results 44.
- Reviewed graph relations are `CALLS`, `IMPORTS`, `EXPORTS`, `CONTAINS`,
  `CONTAINS_MODULE`, `DEFINES`, and `INCLUDES_FILE`. `PART_OF` is explicitly
  non-runtime proof.
- Generated, copied/build, dependency, cache, and experiment-result path
  components remain excluded. Every source index component and the exact set
  of `entities.*.jsonl` and `relations.*.jsonl` files is hash-validated before
  retrieval.

The fixture was frozen before any WO-047 candidate output. The first candidate
replay was 5/10 with one zero-owner issue. Exact-symbol parsing and graph
selection defects were corrected without changing the fixture, task set,
source indexes, baseline packets, lane/search bounds, reviewed relations,
exclusions, or ordering contract. An intermediate replay reached 6/10; tuning
stopped when the final replay first satisfied 7/10 and no-zero-owner.

## Offline Gate

| Frozen issue | Primary runtime | First owner rank | Prefix retained | Known regression tests |
| --- | ---: | ---: | --- | ---: |
| clap ArgsRequiredElseHelp | 2/2 | 6 | yes | 0/1 |
| ansible-doc macros | 2/2 | 5 | yes | 0/1 |
| NodeBB chat allow/deny | 1/4 | 31 | yes | 1/2 |
| Keras padding normalization | 1/1 | 18 | yes | 1/1 |
| SymPy additive Product | 1/1 | 25 | yes | 0/1 |
| **Aggregate** | **7/10** | — | **5/5** | **2/6** |

Additional frozen diagnostics:

- exact issue-named symbol definitions: 1/1;
- zero-owner issues: 0/5;
- Pass 1 additions: 4;
- Pass 2 additions: 69 (65 runtime, 4 test);
- final results: 176 across five packets;
- duplicates prevented: 115;
- unused lane capacity: 30 runtime and 41 test slots;
- excluded selected candidates: 0;
- canonical packet projection bytes: 1,214,542;
- estimated projection tokens: 303,637 at the frozen four-byte divisor.

The size projection contains the complete final packet and all final
diagnostic fields except the two self-referential reported fields themselves:
`diagnostics.canonical_projection_bytes` and
`diagnostics.estimated_projection_tokens`. Every packet records that exclusion
list. The per-task byte/token values are respectively 49,603/12,401;
337,454/84,364; 207,543/51,886; 337,267/84,317; and 282,675/70,669. Tests
independently reconstruct the projection and verify exact bytes and ceiling
division, avoiding a circular or pre-final measurement.

The three misses are all in the NodeBB task:
`public/src/client/account/settings.js`,
`src/controllers/accounts/settings.js`, and `src/user/settings.js`.
The authoritative server-side owner `src/messaging/index.js` is present at
rank 31, satisfying the per-issue owner gate.

The fixture does not freeze exhaustive negative path judgments or exhaustive
caller, barrel/re-export, and lifecycle-owner denominators. Those metrics are
therefore reported as `null`/denominator zero rather than inventing precision
or false-positive claims. Non-primary selected paths are explicitly
`unjudged`, not irrelevant. Known regression-test recall is 2/6. Runtime,
bytes, estimated tokens, and memory are diagnostics only.

## Contract And Security Review Finding Closure

The prior Contract/Security review reported one high, two medium, and one low
fix-now finding. The remediation candidate closes them as follows:

1. Pass 2 now distinguishes exact file anchors from directory/module anchors.
   Every addition requires both the frozen minimum issue-query overlap and a
   reconstructable same-file/directory-containment cause or a path reached by
   a reviewed relation. Query-only and lexical-anchor-only fallback is
   rejected. Each result emits its exact anchor scope, support kind,
   containment decision, cause entity, relation, relation path, query terms,
   and anchor terms. Frozen replay assertions validate every Pass 2 addition.
2. The retrieval contract is fail-closed under the independently pinned file
   hash. Exact in-code frozen parameter/exclusion copies also protect direct
   benchmark API use. Tests reject changed graph depth, minimum Pass 2 overlap,
   and dependency exclusion policy at both boundaries.
3. The future model-facing boundary is explicit and default-off. The pure
   `wo047_untrusted_retrieval_frame_v1` renderer allowlists retrieval fields,
   rejects fixture/score/evaluator fields, canonicalizes and base64-encodes the
   payload, and binds bytes plus SHA-256 inside an immutable-untrusted-data
   frame. Injection-looking source is tested as inert encoded data. The
   renderer makes no model call and does not create a Stage 2 prompt.
4. The contract's host-specific source packet path was replaced by the bound
   sibling-repository locator described above without changing source bytes or
   their content hash.

Negative tests cover false parent-directory inference, a query-only match,
and a sibling next to a graph-supported file anchor. A positive test covers
reviewed `CONTAINS_MODULE` support. Truthful scoping reduced known regression
test recall from 4/6 to 3/6 and reduced additive volume, but it preserved the
frozen 7/10 primary gate and zero-owner count of zero. No bound or fixture byte
was changed to recover metrics.

The subsequent Validation review reported one additional low fix-now accuracy
finding: packet size was measured before the final diagnostic fields were
attached. That is closed by the explicitly named, exactly recomputable final
canonical projection defined above. The old ambiguous `bytes` and
`estimated_tokens` fields were removed rather than presented as whole-packet
measurements.

The final Integration/Code review added three fix-now design findings, also
closed in this candidate:

1. The model-facing renderer no longer allowlists the unbounded
   `pass1.graph_evidence` audit fanout. It projects only final results, selected
   definitions whose paths survive, and graph provenance attached to surviving
   final Pass 1 results. `lanes`, full diagnostics, and audit-only graph records
   remain private. After closed-schema hardening, the five frozen decoded
   projections are 23,296; 55,107; 60,022; 43,782; and 64,157 bytes; the
   maximum base64 payload/complete frame is 85,544/85,923 bytes rather than the
   prior roughly 455 KB. Final, runtime, test,
   definition, selected-graph, and base64-size invariants are tested.
2. Definition candidates are classified into runtime/test buckets before the
   unchanged shared 12-definition cap, and runtime definitions are ordered
   first. An adversarial six-test-path fixture proves 12 test definitions
   cannot crowd out the runtime owner or subsystem anchor. This truthful change
   reduces known regression-test recall further from 3/6 to 2/6 but preserves
   the frozen primary gate and all bounds.
3. Direct exported `retrieveTask` use now validates every retrieval-semantic
   frozen field: schema/artifact/profile, parameters, exclusions, reviewed and
   non-runtime relation sets, ordering, test-path policy, model-query policy,
   and every provider-call count. Tests prove added `PART_OF`, removed `CALLS`,
   reordered policy, enabled model queries, and nonzero planner/model/provider
   counts all fail before traversal. File-based loading retains the independent
   exact contract hash check.

The final Contract/Security re-review found one additional high renderer
boundary issue: nested evaluator fields, unknown result keys, and arbitrarily
large copied result content could bypass the top-level allowlist. The renderer
now recursively rejects evaluator-only keys anywhere in the bounded,
model-eligible input and rebuilds every model-facing result, definition,
anchor, relation edge, subsystem cause, and provenance record through a closed
schema. No result object is copied wholesale. Private audit collections are
excluded from that recursive walk and from the projection.

Deterministic byte limits are formula-derived solely from the already frozen
44-result, four-byte divisor, 12-definition, and depth-two bounds: 2,112 UTF-8
bytes per string, 4,224 bytes per projected record, 185,856 decoded payload
bytes, and 252,032 complete frame bytes. Content is checked before projection;
each record is checked before aggregation; decoded and predicted base64/frame
sizes are checked before base64 allocation; and the completed frame is checked
again. Tests reproduce the reported nested `fixture.gold_files` exploit, an
unknown nested key, 2,113-byte content, and a 44-record aggregate overflow;
all fail closed. Every frozen frame remains deterministic and within bounds.

The subsequent renderer re-review found that those deep checks still began
before collection caps, allowing oversized definitions and private audit data
to consume work before being discarded. The renderer now checks the closed
top-level and shallow nested schemas first, then checks collection lengths and
record field counts before any element mapping or recursive walk. The frozen
preflight caps are 12 definitions, 12 anchors, 32 runtime-lane records, 12
test-lane records, and 44 diagnostic fields. The audit graph cap is the
formula-derived 528 records (`final_result_max * subsystem_anchor_limit`); its
records, lane records, and diagnostic values are never read by the renderer.
Only after this preflight does recursive validation visit the bounded,
model-eligible projection fields. Proxy-backed adversarial tests prove zero
element or value reads for an oversized unknown top-level array, definitions,
anchors, audit graph, lanes, and diagnostics. Frozen observed maxima are 12
definitions, 12 anchors, 383 audit graph records, 32/12 lane records, and 12
diagnostic fields. All five rendered packets retain the same payload hashes
and byte counts reported above.

## Determinism And Artifacts

- Retrieval artifact:
  `benchmark/bootstrapbench/results/wo047-two-pass-stage1/retrieval-packets-v1.json`.
- Retrieval file SHA-256:
  `22ca32e453aeecdc9e3c4d58c897fe01b4f923882b6cdfba505473abb9312856`.
- Retrieval canonical payload SHA-256:
  `aed97409dac3049e33d4bb03129c2d0d27b7113f7a28a3c96ee166b15e8b01ac`.
- Offline score:
  `benchmark/bootstrapbench/results/wo047-two-pass-stage1/offline-score-v1.json`.
- Score file SHA-256:
  `4940dfc3180818014954bbd85408c985507be901d4c7fd65e388d3aea4e6f349`.
- Score canonical payload SHA-256:
  `7963d340a07c817c1d41fcd0b860ebdb0afe97a1271fb6e2ea7e0f46eed50abf`.
- Two independent CLI materializations were byte-identical under `cmp`; both
  retrieval and score file hashes matched exactly.
- Representative final replay diagnostics: 7,271.801 ms wall time,
  44,056,576 bytes RSS before, and 537,133,056 bytes RSS after. The second
  byte-identical replay took 7,286.234 ms and ended at 537,149,440 bytes RSS.

## Validation

- `node --check benchmark/bootstrapbench/wo047-two-pass-subsystem.mjs` — pass.
- `node --test tests/bootstrapbench-two-pass-subsystem.test.mjs` — 13/13 pass.
- Root focused ranking plus WO-047 tests — 43/43 pass.
- `npm --prefix scaffold/mcp run build` — pass.
- Focused MCP aspect and graph-score tests — 26/26 pass.
- The WO-047 tests cover Pass 0 retention, exact-symbol precedence, reviewed
  and unsupported graph edges, truthful file/directory scope, query-only and
  false-containment rejection, lane isolation, subsystem provenance, bounds,
  contract/fixture tampering, safe rendering, five-issue gate replay, and
  byte-identical determinism. Frozen replay tests also independently recompute
  every packet's final canonical size projection and token estimate. Renderer
  tests cover evaluator-key rejection in bounded model-eligible data, closed
  nested schemas, shallow preflight before element access, per-field/per-record
  limits, aggregate decoded/frame limits, and frozen frame byte identity.

- `git diff --check` — pass.
- `cortex pattern-evidence <changed-file> --json` — pass for the contract,
  implementation, focused test, this results record, and context packet.
- The remediation `cortex update` ingested 688 files, 6 rules, 1 ADR, and
  3,562 chunks, then rebuilt the graph successfully. As in the initial Stage 1
  closeout, its changed-embedding subprocess exhibited runaway-memory
  behavior. Only that child was terminated (`SIGTERM`, PID 81065, 34,547,024
  KB RSS after 26 seconds); no other process was signaled and the embedding
  path was not rerun. The parent update completed with the documented lexical
  fallback, retained the prior atomic embedding artifact, rebuilt a 688-file
  graph, and exited zero. The initial closeout had used the same fallback after
  its embedding child reached 15.18 GB RSS at the manager's observation.
- A final `cortex ingest --changed` plus `cortex graph-load` refreshed this
  closeout edit without starting another embedding process; both exited zero.
- `cortex doctor` — 8/8 pass and 100% fresh after graph rebuild.
- `cortex watch status` — stopped; no background writer is active.

The provider boundary remains `planner_calls=0`, `solution_model_calls=0`,
and `provider_calls=0`; the historical cumulative two WO-045 calls remain
solely the discarded V9 attempts and are not WO-047 calls.
