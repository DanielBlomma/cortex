# WO-056 Maintained Analysis State — Stage 0 Spike Report

## Result

**GO for combined Contract/Validation review; not committed or accepted.**

The benchmark-only evaluator derives exactly
`task_binding_viable(wo055a-sql-002)` and
`task_binding_viable(wo055a-typescript-002)` from the frozen sanitized
observations. It does not derive `work_order_inputs_viable(WO-055A)`,
`evidence_trusted(WO-055A)`, `required_reviews_go(WO-055A)`,
`review_ready(WO-055A)`, or `accepted(WO-055A)`.

VB6 and VB.NET are explicit missing required bindings. Ten additional opaque
required bindings are also absent; no assertion upgrades the two reached
tasks into whole-work-order viability. Receipt trust requires positive closed
schema and external-anchor observations, all three Packet 069 reviews remain
NO-GO, and human approval is not positive.

The six current blocker facts are:

- `forged_receipt_accepted`
- `receipt_not_observed_execution`
- `synthetic_negative_results`
- `open_receipt_schema`
- `malformed_control_hash`
- `generator_incompatible`

The exact identity-bound semantic owners are:

- SQL-002:
  `owner-v4:7be096f16d0546afc19f80ae79712863b96bfbbed73169954d3d2fd509390b32`
  and
  `owner-v4:f9a392621b0f2931a244adbb4a9f8e86cadce9a5e462b4d9195425128358d4c8`
- TypeScript-002:
  `owner-v4:afa858d77518cc8ab5fab63174a22d39c1f1a883e2c22f3e3056f543732ca619`
  and
  `owner-v4:cf44fee89e26fe3313dfbe1c6264367992daa48ad01931da96f570d7b2da6e0c`

The malformed frozen digest-shape observation remains in history and is
inactive because the reviewer-observed corrected shape explicitly supersedes
it. The associated control defect remains an independently anchored active
blocker; Packet 069 was not rewritten.

## Closed Contract

The implementation uses Node's `crypto` built-in only. The evaluator has no
filesystem, child-process, network, model/provider, planner, telemetry,
solution, gold, treatment, task-text, or private-bundle authority. The focused
test alone reads the tracked fixture and spawns two fresh Node processes to
prove cross-process determinism.

Base-admissible predicates and derived-only predicates are disjoint code-owned
registries. Authorities, operations, rule IDs, per-predicate tuple shapes, and
exact source path/hash/authority triples are closed. Observation, fact, proof,
ruleset, observation-head, and snapshot identities are SHA-256 values over
canonical JSON. Input order is removed from all hashed state, and wall-clock
generation time is absent. Untrusted proof records are not an input surface.

Observation admission additionally requires an independently passed, closed
authority manifest. Each frozen manifest claim binds an exact observation ID
to the canonical digest of every logical claim field, including the complete
source selector, source hash, authority, and scope. The evaluator recomputes
the entire sorted manifest and its top-level hash; an opposite claim cannot be
admitted merely by reusing a real allowed source path, hash, and authority.
The frozen fixture authority-manifest SHA-256 is
`85f6ccd86c792261e4e8217b6cb1a17b98866115ab7744990e78c4c6a64dc5ba`.

Task replay, exactly two distinct semantic-owner identities, and contamination
clearance each carry the canonical binding-identity hash. Replay and owners
also cross-bind the selected index/replay hashes; contamination cross-binds
the task hash. A well-shaped but mismatched tuple cannot derive viability.

Retractions name one exact observation ID. Assertions may supersede an exact
prior observation with the same subject and predicate. Closed observations
remain queryable in history but cannot support current facts. Every derived
support is a bounded, cycle-checked proof DAG terminating at observation IDs,
tracked source paths, and source hashes. Contradicted premise tuples are
removed from the usable proof relation, while both contradictory fact values
and complete source provenance remain visible. Active blockers and relevant
contradictions are explicit code-owned guards on readiness and acceptance.
Readiness and acceptance `why_not` results include every contradiction on the
same related-subject set used by those guards, preserve both observation and
source provenances, and name the guard constraint failure. A blocked query
expands the registered `blocker_active` premise. A non-derivable query with no
registered reason cannot claim a complete explanation.

Evaluator generations remain monotonic for `changes_since`, while fact birth
epochs and snapshot epochs are stable logical-state metadata. Support-only
changes emit before/after fact records plus added/retracted proof records.
Revisiting a previously seen logical observation head reuses its snapshot
epoch, so same-instance correction and restoration reproduce canonical bytes.

## Frozen Fixture Measurements

| Measure | Value |
|---|---:|
| Epoch | 1 |
| Registered rules | 9 |
| Observation history | 26 |
| Active observations | 25 |
| Active base facts | 25 |
| Active derived facts | 8 |
| Total active facts | 33 |
| Active proof records | 33 |
| Active blockers | 6 |
| Active contradictions | 0 |
| Canonical snapshot bytes | 5,505 |
| Canonical SQL `why` bytes | 5,029 |
| Canonical acceptance `why_not` bytes | 25,389 |
| Canonical epoch-0 changes bytes | 28,968 |

Hashes:

- ruleset SHA-256:
  `572b5fcf9eb06e9edad62e93367da0cf2616975f2d08defda9d23d507ded555a`
- observation-head SHA-256:
  `57ab3acd7b37698b43deb099a0e19ee521f6b34e47f9d9fb33a44929831610fd`
- snapshot SHA-256:
  `d053d73ed72ba48c4e2f42c6955d94f387ede9db9633b2692e6bb8e6864d16ac`
- authority-manifest SHA-256:
  `85f6ccd86c792261e4e8217b6cb1a17b98866115ab7744990e78c4c6a64dc5ba`
- canonical fixture SHA-256:
  `df804a25e9d58416591481daeb774fc97fad8032ca4c3be20a8348ff2f9ca9e8`

The synthetic resolution retracts only the `open_receipt_schema` blocker
observation. Exactly two active fact IDs retract: that base blocker fact and
its derived `blocked` fact. No unrelated fact is added or removed. The same
evaluator restored to the original fixture at generation 3 reproduces
the original generation-1 snapshot bytes exactly while reporting both deltas.

## Gate Evidence

| Packet 070 gate | Evidence | Status |
|---|---|---|
| 1. Multi-step derivation | Synthetic exact binding, whole-input, trust, review, readiness, and approval chain reaches acceptance with source-complete proof DAG | PASS |
| 2. One-support cascade | Exact binding retraction removes the base fact plus task viability, every-binding viability, and whole-input viability: 4 retractions, zero stale dependents | PASS |
| 3. Multiple supports | Two binding anchors produce two task proof paths; first retraction retains one path, final retraction removes the fact | PASS |
| 4. Supersession | Prior false digest-shape fact becomes inactive, corrected true fact remains active, both observations remain in history | PASS |
| 5. Contradictions | Simultaneous positive and negative human approval retains both sources and blocks readiness/acceptance; child and otherwise-independent related-task contradictions recursively reach parent explanations with the exact global-guard constraint; attempts to inject base values for derived-only predicates reject | PASS |
| 6. Fail closed | Unknown schema/rule/key/predicate/operation/authority/shape/hash/path, missing authority manifest, fake 64-hex hash on an allowed path, wrong path authority, observation-only opposite claim against the frozen manifest, direct derived assertion, and impossible calendar timestamp all reject | PASS |
| 7. Determinism | 100 seeded shuffles plus two fresh processes reproduce facts, proofs, changes, and exact snapshot bytes | PASS |
| 8. WO-055 truth | Exactly two task viabilities; 6 blockers; no whole inputs, trust, reviews, readiness, or acceptance; bounded explanations name VB6/VB.NET and every other missing premise | PASS |
| 9. Synthetic resolution | One blocker correction changes only its 2-fact/2-proof closure; unrelated SQL fact bytes stay exact; same-instance original-input restore reproduces original bytes with an honest generation-3 delta | PASS |
| 10. Capability/source scan | Engine imports only `node:crypto`; fixture and engine scan has zero task-text/private/forbidden capability markers | PASS |
| 11. Focused/syntax/JSON/diff/scope/Cortex | Final command evidence recorded below; direct product CLI is not supplied; all four owned paths are new, so legacy Cortex pattern evidence is exact new-file N/A | PASS / N/A as stated |

Focused Node test result: **19/19 subtests pass**. This directly covers all
eleven original gates plus every combined-review reproduction. Gate 7 contains
100 in-process shuffles plus two fresh-process replays.

The proportional bootstrapbench run is **90/98 pass**. All eight failures are
the pre-existing WO-047 `ENOENT` family for absent
`results/wo047-two-pass-stage1` frozen files, matching the review baseline;
all WO-056 and every other proportional test passed.

## Remaining Decision And Risks

- A combined fresh Contract/Validation review is still required before any
  commit. This report is implementation evidence, not acceptance.
- The V1 rule set intentionally has no general rule parser, persistence,
  negation, aggregation, temporal query language, CLI, or MCP surface.
- Proof support is deliberately bounded at 64 paths per fact and 256 nodes per
  rendered path. Change rendering is bounded at 64 epochs and 512 fact
  records, and every renderer has a 65,536-byte ceiling. Crossing a bound
  rejects evaluation rather than returning incomplete provenance.
- Stage 1 persistence, production integration, WO-055 resumption, and any
  Security review remain later decisions. Security review is N/A for this
  spike because the evaluator gained no filesystem or execution authority.

## Final Validation Record

The remediation run completed the focused test at 19/19, the proportional
bootstrapbench run at 90/98 with eight proven pre-existing WO-047 missing-file
failures, both Node syntax checks, fixture JSON and canonical-hash validation,
direct module smoke, and
the engine/fixture forbidden-capability scan. Tracked and no-index whitespace
checks passed. `git status --porcelain=v1 -uall` reported exactly the four
owned new files and HEAD remained the Packet 070 control commit.

Cortex `search`, `rules`, and `impact` succeeded from the healthy primary
checkout as authorized. The feature worktree's context runtime is not built;
running `pattern-evidence` from the primary checkout returned `target was not
found in indexed context` for each of the four new files. Pattern evidence is
therefore exact new-file N/A. `cortex update` is also N/A: making the new files
indexable would require a context bootstrap/update outside the exact four-file
scope, and Packet 070 forbids that outside-Git mutation. No product CLI was
supplied, so the successful direct module smoke is the applicable Stage 0
smoke. Exact final file hashes are returned beside this report for review. No
commit was created.
