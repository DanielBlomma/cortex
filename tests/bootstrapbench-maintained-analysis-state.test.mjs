import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const STAGE0_ENGINE_PATH = path.join(REPO_ROOT, "benchmark/bootstrapbench/maintained-analysis-state.mjs");
const NATIVE_ENGINE_PATH = path.join(REPO_ROOT, "scaffold/mcp/dist/core/analysis-state/engine.js");
const USE_NATIVE_ENGINE = process.env.CORTEX_ANALYSIS_ENGINE === "native";
const stage0Engine = await import(STAGE0_ENGINE_PATH);
const selectedEngine = USE_NATIVE_ENGINE ? await import(NATIVE_ENGINE_PATH) : stage0Engine;
const {
  REGISTERED_RULE_IDS,
  bindingIdentitySha256,
  canonicalJson,
  createAuthorityManifest,
  createObservation,
} = selectedEngine;
const { SOURCE_AUTHORITIES } = stage0Engine;
const SOURCE_AUTHORITY_REGISTRY = USE_NATIVE_ENGINE
  ? selectedEngine.createSourceAuthorityRegistry(SOURCE_AUTHORITIES)
  : null;
const evaluateAnalysisState = (analysisInput, authorityManifest) => USE_NATIVE_ENGINE
  ? selectedEngine.evaluateAnalysisState(analysisInput, authorityManifest, SOURCE_AUTHORITY_REGISTRY)
  : selectedEngine.evaluateAnalysisState(analysisInput, authorityManifest);
const ENGINE_PATH = USE_NATIVE_ENGINE ? NATIVE_ENGINE_PATH : STAGE0_ENGINE_PATH;
const FIXTURE_PATH = path.join(REPO_ROOT, "benchmark/bootstrapbench/fixtures/maintained-analysis-state/wo055-v1.json");
const PLAN_PATH = "docs/superpowers/plans/2026-08-30-maintained-analysis-state.md";
const PLAN_SHA256 = "bcc4d4e1bbde3381be1c0f3cb955445f26e5d3ebfdbbc22dafdccb8c165cad31";
const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
let observationSequence = 0;

function observation(subject, predicate, object, options = {}) {
  observationSequence += 1;
  return createObservation({
    schema_version: 1,
    subject,
    predicate,
    object,
    operation: options.operation ?? "assert",
    ...(options.operation === "retract" ? { target_observation_id: options.target_observation_id } : {}),
    observed_at: new Date(Date.UTC(2026, 7, 30, 12, 0, observationSequence)).toISOString().replace(".000Z", "Z"),
    authority: options.authority ?? "test",
    source: { path: PLAN_PATH, sha256: PLAN_SHA256, selector: options.selector ?? `test-${observationSequence}` },
    scope: { repository: "cortex", work_order: options.work_order ?? "WO-TEST", phase: "contract" },
    supersedes: [...(options.supersedes ?? [])].sort(),
  });
}

function input(observations, extra = {}) {
  return { schema_version: 1, rule_ids: REGISTERED_RULE_IDS, observations, ...extra };
}

function evaluateState(analysisInput, authorityManifest = createAuthorityManifest(analysisInput.observations)) {
  return evaluateAnalysisState(analysisInput, authorityManifest);
}

function replaceState(state, analysisInput, authorityManifest = createAuthorityManifest(analysisInput.observations)) {
  return state.replace(analysisInput, authorityManifest);
}

function fixtureInput(observations = fixture.observations) {
  return { schema_version: fixture.schema_version, rule_ids: fixture.rule_ids, observations };
}

function bindingPremises(subject, options = {}) {
  const salt = options.salt ?? "a";
  const binding = [salt.repeat(64), "b".repeat(40), "c".repeat(40), null, "d".repeat(64), null];
  const identity = bindingIdentitySha256(binding);
  return [
    observation(subject, "binding_exact", binding, options),
    observation(subject, "replay_deterministic", [identity, 1, 2, 3, 4, 0, binding[4], binding[5]], options),
    observation(subject, "distinct_semantic_owners", [identity, binding[4], `owner-v4:${"e".repeat(64)}`, `owner-v4:${"f".repeat(64)}`], options),
    observation(subject, "contamination_clear", [identity, binding[0], true], options),
  ];
}

function acceptedPremises() {
  const taskId = "test-task-accepted";
  const reviewId = "review:test-accepted";
  return [
    ...bindingPremises(taskId),
    observation("WO-TEST", "required_binding_set_exact", [taskId]),
    observation("WO-TEST", "receipt_schema_closed", true),
    observation("WO-TEST", "receipt_externally_anchored", true),
    observation("WO-TEST", "negative_probes_observed", true),
    observation("WO-TEST", "required_review_set_exact", [reviewId]),
    observation(reviewId, "review_go", true),
    observation("WO-TEST", "human_approval", true),
  ];
}

function seededShuffle(values, seed) {
  const result = [...values];
  let state = seed >>> 0;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const target = state % (index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

test("basic multi-step derivation reaches acceptance with complete proof paths", () => {
  const state = evaluateState(input(acceptedPremises()));
  const accepted = state.query("WO-TEST", "accepted");
  assert.equal(accepted.length, 1);
  for (const predicate of ["task_binding_viable", "every_required_binding_viable", "work_order_inputs_viable", "evidence_trusted", "every_required_review_go", "required_reviews_go", "review_ready"]) {
    const subject = predicate === "task_binding_viable" ? "test-task-accepted" : "WO-TEST";
    assert.equal(state.query(subject, predicate).length, 1, predicate);
  }
  const explanation = state.why(accepted[0].id);
  assert.equal(explanation.paths.length, 1);
  assert.ok(explanation.paths[0].observation_ids.length >= 10);
  assert.ok(explanation.paths[0].sources.every((source) => source.observation_id.startsWith("obs:") && /^[0-9a-f]{64}$/.test(source.sha256)));
  assert.ok(explanation.paths[0].proof_graph.some((proof) => proof.rule_id === "rule.task_binding_viable.v1"));
});

test("one-support retraction cascades with zero stale dependents", () => {
  const taskId = "test-task-cascade";
  const premises = bindingPremises(taskId);
  const requiredSet = observation("WO-TEST", "required_binding_set_exact", [taskId]);
  const state = evaluateState(input([...premises, requiredSet]));
  assert.equal(state.query("WO-TEST", "work_order_inputs_viable").length, 1);
  const retraction = observation(taskId, premises[0].predicate, premises[0].object, {
    operation: "retract",
    target_observation_id: premises[0].id,
  });
  replaceState(state, input([...premises, requiredSet, retraction]));
  assert.equal(state.query(taskId, "binding_exact").length, 0);
  assert.equal(state.query(taskId, "task_binding_viable").length, 0);
  assert.equal(state.query("WO-TEST", "every_required_binding_viable").length, 0);
  assert.equal(state.query("WO-TEST", "work_order_inputs_viable").length, 0);
  assert.deepEqual(state.changesSince(1).map((change) => change.epoch), [2]);
  assert.equal(state.changesSince(1)[0].retracted_facts.length, 4);
});

test("multiple supports retain a fact until the final support is removed", () => {
  const taskId = "test-task-multisupport";
  const premises = bindingPremises(taskId);
  const duplicateBinding = observation(taskId, premises[0].predicate, premises[0].object, { selector: "second-binding-anchor" });
  const state = evaluateState(input([...premises, duplicateBinding]));
  let viable = state.query(taskId, "task_binding_viable")[0];
  assert.equal(state.why(viable.id).paths.length, 2);

  const firstRetraction = observation(taskId, premises[0].predicate, premises[0].object, { operation: "retract", target_observation_id: premises[0].id });
  replaceState(state, input([...premises, duplicateBinding, firstRetraction]));
  viable = state.query(taskId, "task_binding_viable")[0];
  assert.ok(viable);
  assert.equal(state.why(viable.id).paths.length, 1);
  const supportDelta = state.changesSince(1)[0];
  assert.equal(supportDelta.added_facts.length, 0);
  assert.equal(supportDelta.retracted_facts.length, 0);
  assert.equal(supportDelta.changed_facts.length, 2);
  assert.equal(supportDelta.retracted_proofs.length, 2);

  const secondRetraction = observation(taskId, duplicateBinding.predicate, duplicateBinding.object, { operation: "retract", target_observation_id: duplicateBinding.id });
  replaceState(state, input([...premises, duplicateBinding, firstRetraction, secondRetraction]));
  assert.equal(state.query(taskId, "task_binding_viable").length, 0);
});

test("supersession closes prior validity while retaining history", () => {
  const prior = observation("WO-TEST", "control_replay_digest_shape_valid", false);
  const correction = observation("WO-TEST", "control_replay_digest_shape_valid", true, { supersedes: [prior.id] });
  const state = evaluateState(input([prior, correction]));
  assert.deepEqual(state.query("WO-TEST", "control_replay_digest_shape_valid").map((fact) => fact.object), [true]);
  const history = state.observationHistory();
  assert.equal(history.length, 2);
  assert.equal(history.find((item) => item.id === prior.id).active, false);
  assert.equal(history.find((item) => item.id === correction.id).active, true);
});

test("contradictory active approval facts retain both provenances and block acceptance", () => {
  const premises = acceptedPremises();
  const denial = observation("WO-TEST", "human_approval", false, { selector: "approval-denial" });
  const state = evaluateState(input([...premises, denial]));
  assert.equal(state.query("WO-TEST", "review_ready").length, 0);
  assert.equal(state.query("WO-TEST", "accepted").length, 0);
  assert.deepEqual(state.query("WO-TEST", "human_approval").map((fact) => fact.object).sort(), [false, true]);
  assert.equal(state.snapshot.contradictions.length, 1);
  assert.equal(state.snapshot.contradictions[0].predicate, "human_approval");
  assert.equal(state.snapshot.contradictions[0].values.length, 2);
  assert.ok(state.snapshot.contradictions[0].values.every((value) => value.sources.length === 1 && /^[0-9a-f]{64}$/.test(value.sources[0].sha256)));
  assert.equal(state.whyNot("WO-TEST", "accepted").contradictions.length, 1);
});

test("derived-only predicates cannot be asserted as base observations", () => {
  for (const predicate of ["accepted", "review_ready", "evidence_trusted", "task_binding_viable", "work_order_inputs_viable"]) {
    const direct = observation("WO-TEST", predicate, true, { selector: `direct-${predicate}` });
    assert.throws(() => evaluateState(input([direct])), /derived-only predicate/);
  }
  const impossibleDerivedBaseConflict = observation("WO-TEST", "review_ready", false, { selector: "derived-base-conflict" });
  assert.throws(() => evaluateState(input([...acceptedPremises(), impossibleDerivedBaseConflict])), /derived-only predicate/);
});

test("allowed sources require the exact code-owned hash and authority", () => {
  const good = observation("WO-TEST", "human_approval", true);
  const reanchor = (source, authority = good.authority) => createObservation({
    schema_version: 1,
    subject: good.subject,
    predicate: good.predicate,
    object: good.object,
    operation: good.operation,
    observed_at: good.observed_at,
    authority,
    source,
    scope: good.scope,
    supersedes: [],
  });
  assert.throws(() => evaluateState(input([reanchor({ ...good.source, sha256: "a".repeat(64) })])), /source hash is not authorized/);
  assert.throws(() => evaluateState(input([reanchor(good.source, "manager")])), /authority manager is not authorized/);
  for (const [sourcePath, contract] of Object.entries(SOURCE_AUTHORITIES)) {
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(REPO_ROOT, sourcePath))).digest("hex");
    assert.equal(actual, contract.sha256, sourcePath);
  }
});

test("independent frozen authority manifest rejects observation-only opposite claims", () => {
  assert.equal(fixture.authority_manifest.manifest_sha256, "85f6ccd86c792261e4e8217b6cb1a17b98866115ab7744990e78c4c6a64dc5ba");
  const original = fixture.observations.find((item) => item.predicate === "receipt_schema_closed" && item.object === false);
  assert.ok(original);
  const opposite = createObservation({
    schema_version: original.schema_version,
    subject: original.subject,
    predicate: original.predicate,
    object: true,
    operation: original.operation,
    observed_at: original.observed_at,
    authority: original.authority,
    source: original.source,
    scope: original.scope,
    supersedes: original.supersedes,
  });
  const observations = fixture.observations.map((item) => item.id === original.id ? opposite : item);
  assert.throws(
    () => evaluateAnalysisState(fixtureInput(observations), fixture.authority_manifest),
    /differs from the independent authority manifest/,
  );
  assert.throws(() => evaluateAnalysisState(fixtureInput()), /authority manifest must be a plain object/);
});

test("an active blocker prevents readiness and acceptance despite every positive premise", () => {
  const blocker = observation("WO-TEST", "blocker_active", "reviewer_blocker", { selector: "active-blocker" });
  const state = evaluateState(input([...acceptedPremises(), blocker]));
  assert.equal(state.query("WO-TEST", "work_order_inputs_viable").length, 1);
  assert.equal(state.query("WO-TEST", "evidence_trusted").length, 1);
  assert.equal(state.query("WO-TEST", "required_reviews_go").length, 1);
  assert.equal(state.query("WO-TEST", "review_ready").length, 0);
  assert.equal(state.query("WO-TEST", "accepted").length, 0);
  const explanation = state.whyNot("WO-TEST", "accepted");
  assert.equal(explanation.active_blockers.length, 1);
  assert.equal(explanation.active_blockers[0].paths[0].observation_ids.length, 1);
  assert.match(explanation.active_blockers[0].paths[0].sources[0].sha256, /^[0-9a-f]{64}$/);
});

test("task viability rejects mismatched replay, owner, and contamination bindings", () => {
  const taskId = "test-task-mismatch";
  const premises = bindingPremises(taskId);
  const variants = [
    [1, observation(taskId, "replay_deterministic", ["1".repeat(64), 1, 2, 3, 4, 0, "2".repeat(64), null], { selector: "bad-replay-binding" })],
    [2, observation(taskId, "distinct_semantic_owners", [bindingIdentitySha256(premises[0].object), "2".repeat(64), `owner-v4:${"e".repeat(64)}`, `owner-v4:${"f".repeat(64)}`], { selector: "bad-owner-index" })],
    [3, observation(taskId, "contamination_clear", [bindingIdentitySha256(premises[0].object), "2".repeat(64), true], { selector: "bad-contamination-task" })],
  ];
  for (const [index, replacement] of variants) {
    const candidate = [...premises];
    candidate[index] = replacement;
    const state = evaluateState(input(candidate));
    assert.equal(state.query(taskId, "task_binding_viable").length, 0);
    assert.ok(state.whyNot(taskId, "task_binding_viable").constraint_failures.length > 0);
  }
});

test("a contradictory child review retains both sources and recursively explains blocked parents", () => {
  const premises = acceptedPremises();
  const reviewId = "review:test-accepted";
  const noGo = observation(reviewId, "review_go", false, { selector: "child-review-no-go" });
  const state = evaluateState(input([...premises, noGo]));
  assert.equal(state.query("WO-TEST", "required_reviews_go").length, 0);
  assert.equal(state.query("WO-TEST", "review_ready").length, 0);
  const explanation = state.whyNot("WO-TEST", "accepted");
  const conflict = explanation.contradictions.find((item) => item.subject === reviewId && item.predicate === "review_go");
  assert.ok(conflict);
  assert.equal(conflict.values.length, 2);
  assert.ok(conflict.values.every((value) => value.sources.length === 1));
  const leaf = explanation.missing_premises.find((item) => item.subject === reviewId && item.predicate === "review_go");
  assert.ok(leaf);
  assert.equal(leaf.contrary_facts.length, 2);
  assert.ok(leaf.contrary_facts.every((fact) => fact.observation_ids.length === 1 && fact.sources.length === 1));
  const serializedTree = canonicalJson(explanation.explanation);
  assert.match(serializedTree, /every_required_review_go/);
  assert.match(serializedTree, /review_go/);
});

test("global contradiction guard is completely explained for readiness and acceptance", () => {
  const premises = acceptedPremises();
  const taskId = "test-task-accepted";
  const compatible = observation(taskId, "generator_compatible", true, { selector: "generator-compatible" });
  const incompatible = observation(taskId, "generator_compatible", false, { selector: "generator-incompatible" });
  const state = evaluateState(input([...premises, compatible, incompatible]));
  assert.equal(state.query("WO-TEST", "work_order_inputs_viable").length, 1);
  assert.equal(state.query("WO-TEST", "review_ready").length, 0);
  assert.equal(state.query("WO-TEST", "accepted").length, 0);
  for (const predicate of ["review_ready", "accepted"]) {
    const explanation = state.whyNot("WO-TEST", predicate);
    const conflict = explanation.contradictions.find((item) => item.subject === taskId && item.predicate === "generator_compatible");
    assert.ok(conflict, predicate);
    assert.equal(conflict.values.length, 2);
    assert.ok(conflict.values.every((value) => value.observation_ids.length === 1 && value.sources.length === 1));
    const guard = explanation.constraint_failures.find((item) => item.code === "relevant_contradiction_guard");
    assert.ok(guard, predicate);
    assert.equal(guard.evidence.length, 1);
    assert.equal(guard.evidence[0].values.length, 2);
    assert.equal(explanation.complete_within_registered_rules, true);
  }
});

test("why_not blocked expands the registered blocker premise instead of itself", () => {
  const state = evaluateState(input([]));
  const explanation = state.whyNot("WO-TEST", "blocked");
  assert.equal(explanation.derivable, false);
  assert.ok(explanation.missing_premises.some((item) => item.predicate === "blocker_active"));
  assert.equal(explanation.missing_premises.some((item) => item.predicate === "blocked"), false);
  assert.equal(explanation.explanation.premises[0].predicate, "blocker_active");
  assert.equal(explanation.complete_within_registered_rules, true);
});

test("RFC 3339 validation rejects normalized-but-impossible calendar dates", () => {
  const invalid = createObservation({
    schema_version: 1,
    subject: "WO-TEST",
    predicate: "human_approval",
    object: true,
    operation: "assert",
    observed_at: "2026-02-30T12:00:00Z",
    authority: "test",
    source: { path: PLAN_PATH, sha256: PLAN_SHA256, selector: "impossible-date" },
    scope: { repository: "cortex", work_order: "WO-TEST", phase: "contract" },
    supersedes: [],
  });
  assert.throws(() => evaluateState(input([invalid])), /RFC 3339/);
});

test("unknown schemas, predicates, rules, operations, authorities, keys, tuple shapes, hashes, paths, and proof input fail closed", () => {
  const good = observation("WO-TEST", "human_approval", true);
  const mutate = (changes) => ({ ...good, ...changes });
  const cases = [
    { ...input([good]), schema_version: 2 },
    { ...input([good]), rule_ids: [...REGISTERED_RULE_IDS, "rule.unknown.v1"].sort() },
    { ...input([good]), proofs: [{ id: "proof:a", premise_proof_ids: ["proof:a"] }] },
    input([{ ...good, unknown: true }]),
    input([mutate({ predicate: "unknown_predicate" })]),
    input([mutate({ operation: "unknown" })]),
    input([mutate({ authority: "unknown" })]),
    input([mutate({ payload_sha256: "0".repeat(64) })]),
    input([mutate({ source: { ...good.source, path: "../../private/task.json" } })]),
    input([mutate({ source: { ...good.source, sha256: "f".repeat(63) } })]),
    input([mutate({ predicate: "binding_exact", object: ["bad-shape"] })]),
  ];
  for (const candidate of cases) assert.throws(() => evaluateState(candidate), /maintained-analysis-state/);
});

test("shuffled orders and two fresh processes reproduce facts, proofs, changes, and snapshot bytes", () => {
  const baseline = evaluateState(fixtureInput(), fixture.authority_manifest);
  const baselineFacts = canonicalJson(baseline.snapshot.derived_facts);
  const baselineWhy = canonicalJson(baseline.why(baseline.query("wo055a-sql-002", "task_binding_viable")[0].id));
  const baselineChanges = canonicalJson(baseline.changesSince(0));
  for (let seed = 1; seed <= 100; seed += 1) {
    const shuffled = evaluateState(fixtureInput(seededShuffle(fixture.observations, seed)), fixture.authority_manifest);
    assert.equal(shuffled.snapshotBytes, baseline.snapshotBytes);
    assert.equal(canonicalJson(shuffled.snapshot.derived_facts), baselineFacts);
    assert.equal(canonicalJson(shuffled.why(shuffled.query("wo055a-sql-002", "task_binding_viable")[0].id)), baselineWhy);
    assert.equal(canonicalJson(shuffled.changesSince(0)), baselineChanges);
  }

  const sourceAuthorityArgument = USE_NATIVE_ENGINE
    ? `, createSourceAuthorityRegistry(${JSON.stringify(SOURCE_AUTHORITIES)})`
    : "";
  const sourceAuthorityImport = USE_NATIVE_ENGINE ? ", createSourceAuthorityRegistry" : "";
  const program = `import fs from "node:fs"; import { evaluateAnalysisState, canonicalJson${sourceAuthorityImport} } from ${JSON.stringify(ENGINE_PATH)}; const fixture = JSON.parse(fs.readFileSync(${JSON.stringify(FIXTURE_PATH)}, "utf8")); const input = { schema_version: fixture.schema_version, rule_ids: fixture.rule_ids, observations: fixture.observations }; const state = evaluateAnalysisState(input, fixture.authority_manifest${sourceAuthorityArgument}); process.stdout.write(canonicalJson({ snapshot_bytes: state.snapshotBytes, changes: state.changesSince(0), why: state.why(state.query("wo055a-sql-002", "task_binding_viable")[0].id) }));`;
  const outputs = [1, 2].map(() => spawnSync(process.execPath, ["--input-type=module", "-e", program], { cwd: REPO_ROOT, encoding: "utf8" }));
  for (const result of outputs) assert.equal(result.status, 0, result.stderr);
  assert.equal(outputs[0].stdout, outputs[1].stdout);
});

test("WO-055 fixture derives exactly two task bindings and no whole-WO readiness or acceptance", () => {
  const state = evaluateState(fixtureInput(), fixture.authority_manifest);
  const viable = state.snapshot.derived_facts.filter((fact) => fact.predicate === "task_binding_viable");
  assert.deepEqual(viable.map((fact) => fact.subject).sort(), ["wo055a-sql-002", "wo055a-typescript-002"]);
  for (const predicate of ["work_order_inputs_viable", "evidence_trusted", "required_reviews_go", "review_ready", "accepted"]) {
    assert.equal(state.query("WO-055A", predicate).length, 0, predicate);
    assert.ok(state.whyNot("WO-055A", predicate).missing_premises.length > 0, predicate);
  }
  assert.ok(state.whyNot("WO-055A", "work_order_inputs_viable").missing_premises.some((item) => item.subject === "wo055a-vb6-binding"));
  assert.ok(state.whyNot("WO-055A", "work_order_inputs_viable").missing_premises.some((item) => item.subject === "wo055a-vbnet-binding"));
  assert.equal(state.snapshot.blockers.length, 6);
  assert.equal(state.snapshot.active_observation_count, 25);
  assert.equal(state.snapshot.derived_facts.length, 8);
  assert.equal(state.observationHistory().length, 26);
  assert.deepEqual(state.statistics, {
    epoch: 1,
    snapshot_epoch: 1,
    authority_manifest_sha256: "85f6ccd86c792261e4e8217b6cb1a17b98866115ab7744990e78c4c6a64dc5ba",
    observation_count: 26,
    active_observation_count: 25,
    base_fact_count: 25,
    derived_fact_count: 8,
    active_fact_count: 33,
    proof_count: 33,
    contradiction_count: 0,
    blocker_count: 6,
    rule_count: 9,
  });
});

test("same-instance blocker correction changes only its closure and restore reproduces exact canonical bytes", () => {
  const state = evaluateState(fixtureInput(), fixture.authority_manifest);
  const originalBytes = state.snapshotBytes;
  const originalSqlFact = canonicalJson(state.query("wo055a-sql-002", "task_binding_viable")[0]);
  const blocker = fixture.observations.find((item) => item.predicate === "blocker_active" && item.object === "open_receipt_schema");
  const resolution = observation(blocker.subject, blocker.predicate, blocker.object, {
    operation: "retract",
    target_observation_id: blocker.id,
    work_order: "WO-055A",
    selector: "synthetic-blocker-resolution",
  });
  replaceState(state, fixtureInput([...fixture.observations, resolution]));
  assert.equal(state.snapshot.blockers.length, 5);
  assert.equal(canonicalJson(state.query("wo055a-sql-002", "task_binding_viable")[0]), originalSqlFact);
  const delta = state.changesSince(1);
  assert.equal(delta.length, 1);
  assert.equal(delta[0].added_facts.length, 0);
  assert.equal(delta[0].retracted_facts.length, 2);
  assert.equal(delta[0].changed_facts.length, 0);
  assert.equal(delta[0].added_proofs.length, 0);
  assert.equal(delta[0].retracted_proofs.length, 2);
  replaceState(state, fixtureInput(), fixture.authority_manifest);
  assert.equal(state.epoch, 3);
  assert.equal(state.snapshot.epoch, 1);
  assert.equal(state.snapshotBytes, originalBytes);
  const restoreDelta = state.changesSince(2)[0];
  assert.equal(restoreDelta.added_facts.length, 2);
  assert.equal(restoreDelta.retracted_facts.length, 0);
  assert.equal(restoreDelta.changed_facts.length, 0);
  assert.equal(restoreDelta.added_proofs.length, 2);
});

test("canonical hashes validate and engine/fixture have no forbidden authority or task text fields", () => {
  assert.equal(canonicalJson(JSON.parse(canonicalJson(fixture))), canonicalJson(fixture));
  for (const item of fixture.observations) {
    assert.match(item.id, /^obs:[0-9a-f]{64}$/);
    assert.equal(item.id.slice(4), item.payload_sha256);
  }
  const ownerFacts = fixture.observations.filter((item) => item.predicate === "distinct_semantic_owners");
  assert.equal(ownerFacts.length, 2);
  assert.ok(ownerFacts.every((item) => item.object.length === 4 && item.object[2] !== item.object[3]));
  assert.ok(ownerFacts.every((item) => item.object.slice(2).every((owner) => /^owner-v4:[0-9a-f]{64}$/.test(owner))));
  assert.deepEqual(Object.fromEntries(ownerFacts.map((item) => [item.subject, item.object.slice(2)])), {
    "wo055a-sql-002": [
      "owner-v4:7be096f16d0546afc19f80ae79712863b96bfbbed73169954d3d2fd509390b32",
      "owner-v4:f9a392621b0f2931a244adbb4a9f8e86cadce9a5e462b4d9195425128358d4c8",
    ],
    "wo055a-typescript-002": [
      "owner-v4:afa858d77518cc8ab5fab63174a22d39c1f1a883e2c22f3e3056f543732ca619",
      "owner-v4:cf44fee89e26fe3313dfbe1c6264367992daa48ad01931da96f570d7b2da6e0c",
    ],
  });
  const engineSource = fs.readFileSync(ENGINE_PATH, "utf8");
  const fixtureSource = fs.readFileSync(FIXTURE_PATH, "utf8");
  assert.deepEqual([...engineSource.matchAll(/from\s+["'](node:[^"']+)["']/g)].map((match) => match[1]), ["node:crypto"]);
  for (const forbidden of ["node:fs", "node:child_process", "http://", "https://", "task_text", "private_bundle", "solution_patch", "model_provider", "telemetry", "planner", "treatment", "gold_output"]) {
    assert.equal(engineSource.includes(forbidden), false, forbidden);
    assert.equal(fixtureSource.includes(forbidden), false, forbidden);
  }
  assert.equal(crypto.createHash("sha256").update(Buffer.from(canonicalJson(fixture))).digest("hex").length, 64);
});
