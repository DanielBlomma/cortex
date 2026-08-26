import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DIALECT_CAPABILITY_MANIFEST,
  DIALECT_LIMITS,
  canonicalJson,
  canonicalize,
  stablePayloadHash,
  sha256
} from "../benchmark/bootstrapbench/dialect-contract.mjs";
import {
  DIALECT_EVALUATION_ARTIFACT_NAMES,
  DIALECT_PHASE_LOCK_RESIDUAL,
  DIALECT_TASK_LOCK_CONTRACT,
  canonicalEvaluationInputLock,
  citationSetSha256,
  createDialectEvaluationRunLock,
  createEvaluationOutput,
  freezeDialectBaseline,
  freezeDialectCandidate,
  freezeDialectGold,
  freezeDialectReveal,
  freezeDialectScore,
  initializeDialectEvaluation,
  readDialectEvaluation
} from "../benchmark/bootstrapbench/dialect-evaluation.mjs";

const SHA = (label) => sha256(`dialect-evaluation:${label}`);
const BASE_COMMIT = "a".repeat(40);

function makeTasks() {
  return DIALECT_CAPABILITY_MANIFEST.families
    .map((family) => ({
      task_id: `task-${family.family}`,
      family: family.family,
      base_commit: BASE_COMMIT,
      task_sha256: SHA(`task-${family.family}`),
      task_bytes: 256,
      source_scope: [`src/${family.family}`]
    }))
    .sort((left, right) => left.task_id.localeCompare(right.task_id));
}

function makeRunLock() {
  const sourceCatalog = DIALECT_CAPABILITY_MANIFEST.families.flatMap((family) =>
    ["a", "b"].map((suffix) => ({
      path: `src/${family.family}/example-${suffix}.txt`,
      source_sha256: SHA(`${family.family}-${suffix}`),
      bytes: 128,
      line_count: 10
    }))
  ).sort((left, right) => left.path.localeCompare(right.path));
  return createDialectEvaluationRunLock({
    run_id: "dialect-blind-v1",
    fixture_set_sha256: SHA("fixtures"),
    source_catalog: sourceCatalog,
    source_tree_sha256: sha256(canonicalJson(sourceCatalog)),
    non_dialect_index_sha256: SHA("non-dialect-index"),
    retrieval_budget_sha256: SHA("retrieval-budget"),
    tasks: makeTasks()
  });
}

function citationsFor(family, facetId) {
  return ["a", "b"].map((suffix, index) => ({
    citation_id: `${facetId}-${suffix}`,
    path: `src/${family}/example-${suffix}.txt`,
    start_line: index + 1,
    end_line: index + 2,
    source_sha256: SHA(`${family}-${suffix}`)
  }));
}

function makeFacets() {
  const facets = [];
  for (const family of DIALECT_CAPABILITY_MANIFEST.families) {
    const categories = Object.entries(family.capabilities)
      .filter(([, capability]) => capability.status === "applicable")
      .map(([category]) => category);
    categories.forEach((category, index) => {
      const facetId = `facet-${family.family}-${index + 1}`;
      facets.push({
        facet_id: facetId,
        task_id: `task-${family.family}`,
        family: family.family,
        category,
        statement: `${family.family} recurring ${category} pattern ${index + 1}`,
        scope: `src/${family.family}`,
        critical: index === 0,
        recurrence_rationale: "Two unchanged local examples use the same structural solution.",
        citations: citationsFor(family.family, facetId)
      });
    });
  }
  return facets.sort((left, right) => left.facet_id.localeCompare(right.facet_id));
}

function makeOutputs(tasks, facets, treatment) {
  return tasks.map((task) => {
    const taskFacets = facets.filter((facet) => facet.task_id === task.task_id);
    const claims = treatment === "candidate"
      ? taskFacets.map((facet) => ({
          claim_id: `claim-${facet.facet_id}`,
          statement: facet.statement,
          citations: facet.citations
        })).sort((left, right) => left.claim_id.localeCompare(right.claim_id))
      : [];
    return createEvaluationOutput(
      task.task_id,
      treatment === "candidate" ? `Candidate dialect facts for ${task.task_id}.` : `Baseline context for ${task.task_id}.`,
      claims
    );
  });
}

function makeScoreInputs(facets, candidateOutputs) {
  const facetJudgments = facets.map((facet) => ({
    facet_id: facet.facet_id,
    baseline: { rating: "absent", claim_ids: [] },
    candidate: { rating: "explicit", claim_ids: [`claim-${facet.facet_id}`] }
  }));
  const claimAudits = candidateOutputs.flatMap((output) =>
    output.claims.map((claim) => ({
      treatment: "candidate",
      task_id: output.task_id,
      claim_id: claim.claim_id,
      citation_set_sha256: citationSetSha256(claim.citations),
      citation_valid: true,
      recurrence_valid: true,
      scope_valid: true,
      unsupported_normativity: false
    }))
  ).sort((left, right) =>
    `${left.treatment}:${left.task_id}:${left.claim_id}`.localeCompare(`${right.treatment}:${right.task_id}:${right.claim_id}`)
  );
  return { facetJudgments, claimAudits };
}

function freezeScore(state, inputs) {
  return freezeDialectScore(state.runDirectory, {
    run_lock_sha256: state.runLock.payload_sha256,
    gold_sha256: state.gold.payload_sha256,
    baseline_sha256: state.baseline.payload_sha256,
    candidate_sha256: state.candidate.payload_sha256,
    facet_judgments: inputs.facetJudgments,
    claim_audits: inputs.claimAudits
  });
}

function createRunDirectory(prefix = "cortex-dialect-evaluation-") {
  return fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), prefix));
}

function initializeRun(runDirectory = createRunDirectory()) {
  const runLock = makeRunLock();
  initializeDialectEvaluation(runDirectory, runLock);
  return { runDirectory, runLock, tasks: runLock.tasks, facets: makeFacets() };
}

function freezeThroughCandidate(state) {
  const gold = freezeDialectGold(state.runDirectory, {
    run_lock_sha256: state.runLock.payload_sha256,
    source_tree_sha256: state.runLock.source_tree_sha256,
    tasks_sha256: state.runLock.tasks_sha256,
    facets: state.facets
  });
  const inputLock = canonicalEvaluationInputLock(state.runLock);
  const baselineOutputs = makeOutputs(state.tasks, state.facets, "baseline");
  const baseline = freezeDialectBaseline(state.runDirectory, {
    run_lock_sha256: state.runLock.payload_sha256,
    gold_sha256: gold.payload_sha256,
    input_lock: inputLock,
    outputs: baselineOutputs
  });
  const candidateOutputs = makeOutputs(state.tasks, state.facets, "candidate");
  const candidate = freezeDialectCandidate(state.runDirectory, {
    run_lock_sha256: state.runLock.payload_sha256,
    gold_sha256: gold.payload_sha256,
    baseline_sha256: baseline.payload_sha256,
    input_lock: inputLock,
    observation_index_sha256: SHA("observation-index"),
    outputs: candidateOutputs
  });
  return { ...state, gold, baseline, candidate, baselineOutputs, candidateOutputs };
}

function freezeCompleteRun(runDirectory = createRunDirectory()) {
  const state = freezeThroughCandidate(initializeRun(runDirectory));
  const scoreInputs = makeScoreInputs(state.facets, state.candidateOutputs);
  const score = freezeDialectScore(state.runDirectory, {
    run_lock_sha256: state.runLock.payload_sha256,
    gold_sha256: state.gold.payload_sha256,
    baseline_sha256: state.baseline.payload_sha256,
    candidate_sha256: state.candidate.payload_sha256,
    facet_judgments: scoreInputs.facetJudgments,
    claim_audits: scoreInputs.claimAudits
  });
  const patches = state.tasks.map((task) => ({
    task_id: task.task_id,
    patch_sha256: SHA(`patch-${task.task_id}`),
    exercised_facet_ids: state.facets.filter((facet) => facet.task_id === task.task_id).map((facet) => facet.facet_id).sort(),
    conformed: true
  }));
  const reveal = freezeDialectReveal(state.runDirectory, {
    run_lock_sha256: state.runLock.payload_sha256,
    score_sha256: score.payload_sha256,
    patches
  });
  return { ...state, score, reveal };
}

test("blind evaluation freezes all phases, score gates, and deterministic hashes", () => {
  const state = freezeCompleteRun();
  const artifacts = readDialectEvaluation(state.runDirectory);
  assert.deepEqual(Object.keys(artifacts), ["run_lock", "gold", "baseline", "candidate", "score", "reveal"]);
  assert.equal(artifacts.gold.facets.length, 68);
  assert.equal(artifacts.score.summary.candidate_strict_recall, 1);
  assert.equal(artifacts.score.summary.baseline_strict_recall, 0);
  assert.equal(artifacts.score.summary.candidate_citation_precision, 1);
  assert.equal(artifacts.score.summary.score_gate_pass, true);

  const second = freezeCompleteRun();
  for (const name of Object.values(DIALECT_EVALUATION_ARTIFACT_NAMES)) {
    assert.deepEqual(
      fs.readFileSync(path.join(state.runDirectory, name)),
      fs.readFileSync(path.join(second.runDirectory, name)),
      name
    );
  }
});

test("phase ordering rejects baseline before gold and reveal before scoring", () => {
  const earlyBaseline = initializeRun();
  assert.throws(
    () => freezeDialectBaseline(earlyBaseline.runDirectory, {
      run_lock_sha256: earlyBaseline.runLock.payload_sha256,
      gold_sha256: SHA("not-yet-frozen-gold"),
      input_lock: canonicalEvaluationInputLock(earlyBaseline.runLock),
      outputs: makeOutputs(earlyBaseline.tasks, earlyBaseline.facets, "baseline")
    }),
    /cannot run before every preceding phase/
  );

  const earlyReveal = freezeThroughCandidate(initializeRun());
  assert.throws(
    () => freezeDialectReveal(earlyReveal.runDirectory, {
      run_lock_sha256: earlyReveal.runLock.payload_sha256,
      score_sha256: SHA("not-yet-frozen-score"),
      patches: []
    }),
    /cannot run before every preceding phase/
  );
});

test("task mutation, source-tree drift, and candidate input drift are rejected", () => {
  const taskMutation = initializeRun();
  assert.throws(
    () => freezeDialectGold(taskMutation.runDirectory, {
      run_lock_sha256: taskMutation.runLock.payload_sha256,
      source_tree_sha256: taskMutation.runLock.source_tree_sha256,
      tasks_sha256: SHA("mutated-tasks"),
      facets: taskMutation.facets
    }),
    /task mutation/
  );

  const sourceDrift = initializeRun();
  assert.throws(
    () => freezeDialectGold(sourceDrift.runDirectory, {
      run_lock_sha256: sourceDrift.runLock.payload_sha256,
      source_tree_sha256: SHA("drifted-tree"),
      tasks_sha256: sourceDrift.runLock.tasks_sha256,
      facets: sourceDrift.facets
    }),
    /source-tree drift/
  );

  const candidateDrift = initializeRun();
  const candidateGold = freezeDialectGold(candidateDrift.runDirectory, {
    run_lock_sha256: candidateDrift.runLock.payload_sha256,
    source_tree_sha256: candidateDrift.runLock.source_tree_sha256,
    tasks_sha256: candidateDrift.runLock.tasks_sha256,
    facets: candidateDrift.facets
  });
  const lock = canonicalEvaluationInputLock(candidateDrift.runLock);
  const candidateBaseline = freezeDialectBaseline(candidateDrift.runDirectory, {
    run_lock_sha256: candidateDrift.runLock.payload_sha256,
    gold_sha256: candidateGold.payload_sha256,
    input_lock: lock,
    outputs: makeOutputs(candidateDrift.tasks, candidateDrift.facets, "baseline")
  });
  assert.throws(
    () => freezeDialectCandidate(candidateDrift.runDirectory, {
      run_lock_sha256: candidateDrift.runLock.payload_sha256,
      gold_sha256: candidateGold.payload_sha256,
      baseline_sha256: candidateBaseline.payload_sha256,
      input_lock: { ...lock, retrieval_budget_sha256: SHA("different-budget") },
      observation_index_sha256: SHA("observations"),
      outputs: makeOutputs(candidateDrift.tasks, candidateDrift.facets, "candidate")
    }),
    /input lock differs/
  );
});

test("frozen artifacts cannot be overwritten or mutated between phases", () => {
  const overwrite = initializeRun();
  const goldInput = {
    run_lock_sha256: overwrite.runLock.payload_sha256,
    source_tree_sha256: overwrite.runLock.source_tree_sha256,
    tasks_sha256: overwrite.runLock.tasks_sha256,
    facets: overwrite.facets
  };
  freezeDialectGold(overwrite.runDirectory, goldInput);
  assert.throws(() => freezeDialectGold(overwrite.runDirectory, goldInput), /immutable and cannot be overwritten/);

  const mutation = initializeRun();
  const mutationGold = freezeDialectGold(mutation.runDirectory, {
    run_lock_sha256: mutation.runLock.payload_sha256,
    source_tree_sha256: mutation.runLock.source_tree_sha256,
    tasks_sha256: mutation.runLock.tasks_sha256,
    facets: mutation.facets
  });
  const goldPath = path.join(mutation.runDirectory, DIALECT_EVALUATION_ARTIFACT_NAMES.gold);
  const altered = JSON.parse(fs.readFileSync(goldPath, "utf8"));
  altered.facets[0].statement = "Mutated after freeze";
  fs.writeFileSync(goldPath, `${JSON.stringify(altered, null, 2)}\n`);
  assert.throws(
    () => freezeDialectBaseline(mutation.runDirectory, {
      run_lock_sha256: mutation.runLock.payload_sha256,
      gold_sha256: mutationGold.payload_sha256,
      input_lock: canonicalEvaluationInputLock(mutation.runLock),
      outputs: makeOutputs(mutation.tasks, mutation.facets, "baseline")
    }),
    /(non-canonical evaluation artifact|payload hash mismatch)/
  );
});

test("score phase rejects citation drift and incomplete positive-claim audits", () => {
  const drift = freezeThroughCandidate(initializeRun());
  const inputs = makeScoreInputs(drift.facets, drift.candidateOutputs);
  inputs.claimAudits[0] = { ...inputs.claimAudits[0], citation_set_sha256: SHA("drifted-citations") };
  assert.throws(
    () => freezeDialectScore(drift.runDirectory, {
      run_lock_sha256: drift.runLock.payload_sha256,
      gold_sha256: drift.gold.payload_sha256,
      baseline_sha256: drift.baseline.payload_sha256,
      candidate_sha256: drift.candidate.payload_sha256,
      facet_judgments: inputs.facetJudgments,
      claim_audits: inputs.claimAudits
    }),
    /citation drift/
  );

  const incomplete = freezeThroughCandidate(initializeRun());
  const incompleteInputs = makeScoreInputs(incomplete.facets, incomplete.candidateOutputs);
  incompleteInputs.claimAudits.pop();
  assert.throws(
    () => freezeDialectScore(incomplete.runDirectory, {
      run_lock_sha256: incomplete.runLock.payload_sha256,
      gold_sha256: incomplete.gold.payload_sha256,
      baseline_sha256: incomplete.baseline.payload_sha256,
      candidate_sha256: incomplete.candidate.payload_sha256,
      facet_judgments: incompleteInputs.facetJudgments,
      claim_audits: incompleteInputs.claimAudits
    }),
    /every positive claim/
  );
});

test("candidate explicit credit requires fully valid audits and all precision gates", () => {
  for (const [field, value] of [
    ["citation_valid", false],
    ["recurrence_valid", false],
    ["scope_valid", false],
    ["unsupported_normativity", true]
  ]) {
    const state = freezeThroughCandidate(initializeRun());
    const inputs = makeScoreInputs(state.facets, state.candidateOutputs);
    inputs.claimAudits[0] = { ...inputs.claimAudits[0], [field]: value };
    assert.throws(() => freezeScore(state, inputs), /fully valid immutable claim audit/, field);
  }

  const baselineState = initializeRun();
  const baselineGold = freezeDialectGold(baselineState.runDirectory, {
    run_lock_sha256: baselineState.runLock.payload_sha256,
    source_tree_sha256: baselineState.runLock.source_tree_sha256,
    tasks_sha256: baselineState.runLock.tasks_sha256,
    facets: baselineState.facets
  });
  const baselineInputLock = canonicalEvaluationInputLock(baselineState.runLock);
  const baselineOutputs = makeOutputs(baselineState.tasks, baselineState.facets, "baseline");
  const baselineFacet = baselineState.facets.find((facet) => facet.task_id === baselineOutputs[0].task_id);
  const baselineClaim = {
    claim_id: `baseline-${baselineFacet.facet_id}`,
    statement: baselineFacet.statement,
    citations: baselineFacet.citations
  };
  baselineOutputs[0] = createEvaluationOutput(
    baselineOutputs[0].task_id,
    baselineOutputs[0].rendered_output,
    [baselineClaim]
  );
  const frozenBaseline = freezeDialectBaseline(baselineState.runDirectory, {
    run_lock_sha256: baselineState.runLock.payload_sha256,
    gold_sha256: baselineGold.payload_sha256,
    input_lock: baselineInputLock,
    outputs: baselineOutputs
  });
  const candidateOutputs = makeOutputs(baselineState.tasks, baselineState.facets, "candidate");
  const frozenCandidate = freezeDialectCandidate(baselineState.runDirectory, {
    run_lock_sha256: baselineState.runLock.payload_sha256,
    gold_sha256: baselineGold.payload_sha256,
    baseline_sha256: frozenBaseline.payload_sha256,
    input_lock: baselineInputLock,
    observation_index_sha256: SHA("baseline-adversarial-observations"),
    outputs: candidateOutputs
  });
  const baselineScoreState = {
    ...baselineState,
    gold: baselineGold,
    baseline: frozenBaseline,
    candidate: frozenCandidate,
    candidateOutputs
  };
  const baselineInputs = makeScoreInputs(baselineState.facets, candidateOutputs);
  const baselineJudgment = baselineInputs.facetJudgments.find((judgment) => judgment.facet_id === baselineFacet.facet_id);
  baselineJudgment.baseline = { rating: "explicit", claim_ids: [baselineClaim.claim_id] };
  baselineInputs.claimAudits.push({
    treatment: "baseline",
    task_id: baselineOutputs[0].task_id,
    claim_id: baselineClaim.claim_id,
    citation_set_sha256: citationSetSha256(baselineClaim.citations),
    citation_valid: true,
    recurrence_valid: false,
    scope_valid: true,
    unsupported_normativity: false
  });
  baselineInputs.claimAudits.sort((left, right) =>
    `${left.treatment}:${left.task_id}:${left.claim_id}`.localeCompare(`${right.treatment}:${right.task_id}:${right.claim_id}`)
  );
  assert.throws(
    () => freezeScore(baselineScoreState, baselineInputs),
    /baseline explicit credit requires a fully valid immutable claim audit/
  );

  const contradicted = freezeThroughCandidate(initializeRun());
  const contradictedInputs = makeScoreInputs(contradicted.facets, contradicted.candidateOutputs);
  contradictedInputs.facetJudgments[0].baseline.rating = "contradicted";
  const score = freezeScore(contradicted, contradictedInputs);
  assert.equal(score.summary.baseline_contradicted_facets, 1);
  assert.equal(score.summary.candidate_citation_precision, 1);
  assert.equal(score.summary.candidate_recurrence_precision, 1);
  assert.equal(score.summary.candidate_scope_precision, 1);
  assert.equal(score.summary.score_gate_pass, false);

  const imprecise = freezeThroughCandidate(initializeRun());
  const impreciseInputs = makeScoreInputs(imprecise.facets, imprecise.candidateOutputs);
  const partial = impreciseInputs.facetJudgments.find((judgment) => judgment.facet_id.endsWith("-2"));
  partial.candidate.rating = "partial";
  const partialClaimId = partial.candidate.claim_ids[0];
  const partialAudit = impreciseInputs.claimAudits.find((audit) => audit.claim_id === partialClaimId);
  partialAudit.recurrence_valid = false;
  partialAudit.scope_valid = false;
  const impreciseScore = freezeScore(imprecise, impreciseInputs);
  assert.ok(impreciseScore.summary.candidate_recurrence_precision < 1);
  assert.ok(impreciseScore.summary.candidate_scope_precision < 1);
  assert.equal(impreciseScore.summary.score_gate_pass, false);
});

test("judgment claim ids are sorted and unique", () => {
  const state = freezeThroughCandidate(initializeRun());
  const inputs = makeScoreInputs(state.facets, state.candidateOutputs);
  const claimId = inputs.facetJudgments[0].candidate.claim_ids[0];
  inputs.facetJudgments[0].candidate.claim_ids = [claimId, claimId];
  assert.throws(() => freezeScore(state, inputs), /facet claim ids must be unique/);
});

test("gold covers every applicable family capability and citations bind to the frozen source catalog", () => {
  const missingCapability = initializeRun();
  const incompleteFacets = missingCapability.facets.filter(
    (facet) => !(facet.family === "javascript" && facet.category === "test_shape")
  );
  assert.throws(
    () => freezeDialectGold(missingCapability.runDirectory, {
      run_lock_sha256: missingCapability.runLock.payload_sha256,
      source_tree_sha256: missingCapability.runLock.source_tree_sha256,
      tasks_sha256: missingCapability.runLock.tasks_sha256,
      facets: incompleteFacets
    }),
    /does not cover applicable capability/
  );

  const citationMutation = initializeRun();
  const mutatedFacets = structuredClone(citationMutation.facets);
  mutatedFacets[0].citations[0].source_sha256 = SHA("different-source-bytes");
  assert.throws(
    () => freezeDialectGold(citationMutation.runDirectory, {
      run_lock_sha256: citationMutation.runLock.payload_sha256,
      source_tree_sha256: citationMutation.runLock.source_tree_sha256,
      tasks_sha256: citationMutation.runLock.tasks_sha256,
      facets: mutatedFacets
    }),
    /not bound to the frozen source catalog/
  );

  const impossibleLine = initializeRun();
  const impossibleLineFacets = structuredClone(impossibleLine.facets);
  impossibleLineFacets[0].citations[0].end_line = 1_000_000;
  assert.throws(
    () => freezeDialectGold(impossibleLine.runDirectory, {
      run_lock_sha256: impossibleLine.runLock.payload_sha256,
      source_tree_sha256: impossibleLine.runLock.source_tree_sha256,
      tasks_sha256: impossibleLine.runLock.tasks_sha256,
      facets: impossibleLineFacets
    }),
    /exceeds the frozen catalog line count/
  );

  const valid = makeRunLock();
  const invalidTreeHash = structuredClone(valid);
  invalidTreeHash.source_tree_sha256 = SHA("unbound-source-tree");
  invalidTreeHash.payload_sha256 = stablePayloadHash(invalidTreeHash);
  assert.throws(
    () => initializeDialectEvaluation(createRunDirectory(), invalidTreeHash),
    /source-tree hash must bind/
  );

  const unsortedCatalog = structuredClone(valid);
  unsortedCatalog.source_catalog.reverse();
  unsortedCatalog.source_tree_sha256 = sha256(canonicalJson(unsortedCatalog.source_catalog));
  unsortedCatalog.payload_sha256 = stablePayloadHash(unsortedCatalog);
  assert.throws(
    () => initializeDialectEvaluation(createRunDirectory(), unsortedCatalog),
    /source catalog must be canonically ordered/
  );

  const singleFilePerTask = structuredClone(valid);
  singleFilePerTask.source_catalog = singleFilePerTask.source_catalog.filter((source) => source.path.endsWith("example-a.txt"));
  singleFilePerTask.source_tree_sha256 = sha256(canonicalJson(singleFilePerTask.source_catalog));
  singleFilePerTask.payload_sha256 = stablePayloadHash(singleFilePerTask);
  assert.doesNotThrow(
    () => initializeDialectEvaluation(createRunDirectory(), singleFilePerTask)
  );

  const treatmentMutation = initializeRun();
  const treatmentGold = freezeDialectGold(treatmentMutation.runDirectory, {
    run_lock_sha256: treatmentMutation.runLock.payload_sha256,
    source_tree_sha256: treatmentMutation.runLock.source_tree_sha256,
    tasks_sha256: treatmentMutation.runLock.tasks_sha256,
    facets: treatmentMutation.facets
  });
  const inputLock = canonicalEvaluationInputLock(treatmentMutation.runLock);
  const treatmentBaseline = freezeDialectBaseline(treatmentMutation.runDirectory, {
    run_lock_sha256: treatmentMutation.runLock.payload_sha256,
    gold_sha256: treatmentGold.payload_sha256,
    input_lock: inputLock,
    outputs: makeOutputs(treatmentMutation.tasks, treatmentMutation.facets, "baseline")
  });
  const candidateOutputs = makeOutputs(treatmentMutation.tasks, treatmentMutation.facets, "candidate");
  candidateOutputs[0].claims[0].citations[0].source_sha256 = SHA("candidate-source-mutation");
  assert.throws(
    () => freezeDialectCandidate(treatmentMutation.runDirectory, {
      run_lock_sha256: treatmentMutation.runLock.payload_sha256,
      gold_sha256: treatmentGold.payload_sha256,
      baseline_sha256: treatmentBaseline.payload_sha256,
      input_lock: inputLock,
      observation_index_sha256: SHA("observations"),
      outputs: candidateOutputs
    }),
    /not bound to the frozen source catalog/
  );

  const scoreMutation = freezeThroughCandidate(initializeRun());
  const candidatePath = path.join(scoreMutation.runDirectory, DIALECT_EVALUATION_ARTIFACT_NAMES.candidate);
  const rewrittenCandidate = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
  rewrittenCandidate.outputs[0].claims[0].citations[0].source_sha256 = SHA("score-source-mutation");
  rewrittenCandidate.payload_sha256 = stablePayloadHash(rewrittenCandidate);
  fs.writeFileSync(candidatePath, `${JSON.stringify(canonicalize(rewrittenCandidate), null, 2)}\n`);
  assert.throws(
    () => freezeScore(scoreMutation, makeScoreInputs(scoreMutation.facets, scoreMutation.candidateOutputs)),
    /not bound to the frozen source catalog/
  );
});

test("retained predecessor digests reject a canonically rehashed staged mutation", () => {
  const state = initializeRun();
  const gold = freezeDialectGold(state.runDirectory, {
    run_lock_sha256: state.runLock.payload_sha256,
    source_tree_sha256: state.runLock.source_tree_sha256,
    tasks_sha256: state.runLock.tasks_sha256,
    facets: state.facets
  });
  const goldPath = path.join(state.runDirectory, DIALECT_EVALUATION_ARTIFACT_NAMES.gold);
  const rewritten = JSON.parse(fs.readFileSync(goldPath, "utf8"));
  rewritten.facets[0].statement = "Canonically rewritten after the evaluator retained the original digest.";
  rewritten.payload_sha256 = stablePayloadHash(rewritten);
  fs.writeFileSync(goldPath, `${JSON.stringify(canonicalize(rewritten), null, 2)}\n`);

  assert.throws(
    () => freezeDialectBaseline(state.runDirectory, {
      run_lock_sha256: state.runLock.payload_sha256,
      gold_sha256: gold.payload_sha256,
      input_lock: canonicalEvaluationInputLock(state.runLock),
      outputs: makeOutputs(state.tasks, state.facets, "baseline")
    }),
    /gold changed after its digest was retained/
  );
  assert.match(DIALECT_PHASE_LOCK_RESIDUAL, /Offline wholesale chain rewrite cannot be cryptographically prevented without external trust/);
  assert.match(DIALECT_PHASE_LOCK_RESIDUAL, /privileged concurrent same-user run-root or parent redirection race/);
});

test("reveal facets are unique and remain bound to their task", () => {
  const scoreState = freezeThroughCandidate(initializeRun());
  const score = freezeScore(scoreState, makeScoreInputs(scoreState.facets, scoreState.candidateOutputs));
  const patches = scoreState.tasks.map((task) => ({
    task_id: task.task_id,
    patch_sha256: SHA(`patch-${task.task_id}`),
    exercised_facet_ids: scoreState.facets.filter((facet) => facet.task_id === task.task_id).map((facet) => facet.facet_id).sort(),
    conformed: true
  }));
  const foreignFacet = patches[1].exercised_facet_ids[0];
  patches[0].exercised_facet_ids = [foreignFacet];
  assert.throws(
    () => freezeDialectReveal(scoreState.runDirectory, {
      run_lock_sha256: scoreState.runLock.payload_sha256,
      score_sha256: score.payload_sha256,
      patches
    }),
    /does not belong to the revealed task/
  );

  const ownFacet = scoreState.facets.find((facet) => facet.task_id === patches[0].task_id).facet_id;
  patches[0].exercised_facet_ids = [ownFacet, ownFacet];
  assert.throws(
    () => freezeDialectReveal(scoreState.runDirectory, {
      run_lock_sha256: scoreState.runLock.payload_sha256,
      score_sha256: score.payload_sha256,
      patches
    }),
    /exercised facet ids must be unique/
  );
});

test("evaluation artifacts reject symlinks, hard links, and out-of-scope citations", { skip: process.platform === "win32" }, () => {
  const linkedRootTarget = createRunDirectory("cortex-dialect-linked-target-");
  const linkedRoot = `${linkedRootTarget}-link`;
  fs.symlinkSync(linkedRootTarget, linkedRoot, "dir");
  assert.throws(() => initializeDialectEvaluation(linkedRoot, makeRunLock()), /real directory|symlink component/);

  const hardLinked = initializeRun();
  const runLockPath = path.join(hardLinked.runDirectory, DIALECT_EVALUATION_ARTIFACT_NAMES.run_lock);
  const externalLinkDirectory = createRunDirectory("cortex-dialect-hardlink-");
  fs.linkSync(runLockPath, path.join(externalLinkDirectory, "run-lock-copy.json"));
  assert.throws(
    () => freezeDialectGold(hardLinked.runDirectory, {
      run_lock_sha256: hardLinked.runLock.payload_sha256,
      source_tree_sha256: hardLinked.runLock.source_tree_sha256,
      tasks_sha256: hardLinked.runLock.tasks_sha256,
      facets: hardLinked.facets
    }),
    /unsafe evaluation artifact/
  );

  const escapedCitation = initializeRun();
  const facets = structuredClone(escapedCitation.facets);
  facets[0].citations[0].path = "outside/example.txt";
  assert.throws(
    () => freezeDialectGold(escapedCitation.runDirectory, {
      run_lock_sha256: escapedCitation.runLock.payload_sha256,
      source_tree_sha256: escapedCitation.runLock.source_tree_sha256,
      tasks_sha256: escapedCitation.runLock.tasks_sha256,
      facets
    }),
    /escaped the frozen local source scope/
  );

  const repeatedCitation = initializeRun();
  const repeatedFacets = structuredClone(repeatedCitation.facets);
  repeatedFacets[0].citations[1] = {
    ...repeatedFacets[0].citations[0],
    citation_id: repeatedFacets[0].citations[1].citation_id
  };
  assert.throws(
    () => freezeDialectGold(repeatedCitation.runDirectory, {
      run_lock_sha256: repeatedCitation.runLock.payload_sha256,
      source_tree_sha256: repeatedCitation.runLock.source_tree_sha256,
      tasks_sha256: repeatedCitation.runLock.tasks_sha256,
      facets: repeatedFacets
    }),
    /distinct unchanged source spans/
  );
});

test("run lock and phase artifacts contain hashes rather than issue, patch, or raw AST bytes", () => {
  const runLock = makeRunLock();
  const serialized = canonicalJson(runLock);
  assert.doesNotMatch(serialized, /issue_text|patch_bytes|raw_ast/);
  assert.equal(runLock.tasks.every((task) => !Object.hasOwn(task, "task_text")), true);
  assert.equal(runLock.tasks.every((task) => task.task_bytes === 256), true);
  assert.match(DIALECT_TASK_LOCK_CONTRACT, /evaluator owns computing task_sha256 and task_bytes from the same exact task bytes/);

  const oversizedTask = structuredClone(runLock);
  oversizedTask.tasks[0].task_bytes = DIALECT_LIMITS.max_task_bytes + 1;
  oversizedTask.tasks_sha256 = sha256(canonicalJson(oversizedTask.tasks));
  oversizedTask.payload_sha256 = stablePayloadHash(oversizedTask);
  assert.throws(
    () => initializeDialectEvaluation(createRunDirectory(), oversizedTask),
    /task bytes are outside the frozen bound/
  );
});

test("contract and harness remain local-only and do not load model, provider, planner, telemetry, or network paths", () => {
  for (const relativePath of [
    "../benchmark/bootstrapbench/dialect-contract.mjs",
    "../benchmark/bootstrapbench/dialect-evaluation.mjs"
  ]) {
    const source = fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.doesNotMatch(source, /node:https?|\bfetch\s*\(|child_process|worker_threads|telemetry|planner|embedding|model provider/i, relativePath);
  }
});
