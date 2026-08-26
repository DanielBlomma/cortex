import fs from "node:fs";
import path from "node:path";
import {
  DIALECT_CAPABILITY_MANIFEST,
  DIALECT_CAPABILITY_MANIFEST_SHA256,
  DIALECT_LIMITS,
  DIALECT_LIMITS_SHA256,
  canonicalJson,
  canonicalRepositoryPath,
  canonicalize,
  exactKeys,
  hexSha256,
  nonNegativeInteger,
  sha256,
  stablePayloadHash
} from "./dialect-contract.mjs";

const PHASES = Object.freeze(["run_lock", "gold", "baseline", "candidate", "score", "reveal"]);
const ARTIFACT_NAMES = Object.freeze({
  run_lock: "00-run-lock.json",
  gold: "01-gold.json",
  baseline: "02-baseline.json",
  candidate: "03-candidate.json",
  score: "04-score.json",
  reveal: "05-reveal.json"
});
const RATINGS = Object.freeze(["explicit", "partial", "absent", "contradicted"]);

export const DIALECT_TASK_LOCK_CONTRACT = "The blinded evaluator owns computing task_sha256 and task_bytes from the same exact task bytes; task text is never persisted by this harness.";
export const DIALECT_PHASE_LOCK_RESIDUAL = "Offline wholesale chain rewrite cannot be cryptographically prevented without external trust; a retained predecessor digest rejects staged mutation of any earlier artifact. Portable path checks also cannot eliminate every privileged concurrent same-user run-root or parent redirection race, although stable symlink and hard-link layouts are denied.";

export function createDialectEvaluationRunLock(input) {
  exactKeys(input, ["fixture_set_sha256", "non_dialect_index_sha256", "retrieval_budget_sha256", "run_id", "source_catalog", "source_tree_sha256", "tasks"], "evaluation run input");
  const artifact = {
    schema_version: 1,
    phase: "run_lock",
    run_id: input.run_id,
    capability_manifest_sha256: DIALECT_CAPABILITY_MANIFEST_SHA256,
    limits_sha256: DIALECT_LIMITS_SHA256,
    fixture_set_sha256: input.fixture_set_sha256,
    source_tree_sha256: input.source_tree_sha256,
    non_dialect_index_sha256: input.non_dialect_index_sha256,
    retrieval_budget_sha256: input.retrieval_budget_sha256,
    source_catalog: canonicalize(input.source_catalog),
    tasks: canonicalize(input.tasks),
    tasks_sha256: sha256(canonicalJson(input.tasks)),
    payload_sha256: ""
  };
  artifact.payload_sha256 = stablePayloadHash(artifact);
  return validateRunLock(artifact);
}

export function initializeDialectEvaluation(runDirectory, runLock) {
  const root = inspectRunDirectory(runDirectory, { expectEmpty: true });
  validateRunLock(runLock);
  writeArtifactExclusive(root, ARTIFACT_NAMES.run_lock, runLock);
  return runLock;
}

export function freezeDialectGold(runDirectory, input) {
  const state = loadPhaseState(runDirectory, "gold");
  exactKeys(input, ["facets", "run_lock_sha256", "source_tree_sha256", "tasks_sha256"], "gold input");
  retainedDigest(input.run_lock_sha256, state.run_lock.payload_sha256, "run lock");
  const artifact = withPayloadHash({
    schema_version: 1,
    phase: "gold",
    run_lock_sha256: input.run_lock_sha256,
    source_tree_sha256: input.source_tree_sha256,
    tasks_sha256: input.tasks_sha256,
    facets: canonicalize(input.facets)
  });
  validateGold(artifact, state.run_lock);
  writeArtifactExclusive(state.root, ARTIFACT_NAMES.gold, artifact);
  return artifact;
}

export function freezeDialectBaseline(runDirectory, input) {
  const state = loadPhaseState(runDirectory, "baseline");
  exactKeys(input, ["gold_sha256", "input_lock", "outputs", "run_lock_sha256"], "baseline input");
  retainedDigest(input.run_lock_sha256, state.run_lock.payload_sha256, "run lock");
  retainedDigest(input.gold_sha256, state.gold.payload_sha256, "gold");
  const artifact = withPayloadHash({
    schema_version: 1,
    phase: "baseline",
    run_lock_sha256: input.run_lock_sha256,
    gold_sha256: input.gold_sha256,
    input_lock: canonicalize(input.input_lock),
    dialect_enabled: false,
    observation_index_sha256: null,
    outputs: canonicalize(input.outputs)
  });
  validateTreatment(artifact, "baseline", state.run_lock, state.gold);
  writeArtifactExclusive(state.root, ARTIFACT_NAMES.baseline, artifact);
  return artifact;
}

export function freezeDialectCandidate(runDirectory, input) {
  const state = loadPhaseState(runDirectory, "candidate");
  exactKeys(input, ["baseline_sha256", "gold_sha256", "input_lock", "observation_index_sha256", "outputs", "run_lock_sha256"], "candidate input");
  retainedDigest(input.run_lock_sha256, state.run_lock.payload_sha256, "run lock");
  retainedDigest(input.gold_sha256, state.gold.payload_sha256, "gold");
  retainedDigest(input.baseline_sha256, state.baseline.payload_sha256, "baseline");
  const artifact = withPayloadHash({
    schema_version: 1,
    phase: "candidate",
    run_lock_sha256: input.run_lock_sha256,
    gold_sha256: input.gold_sha256,
    baseline_sha256: input.baseline_sha256,
    input_lock: canonicalize(input.input_lock),
    dialect_enabled: true,
    observation_index_sha256: input.observation_index_sha256,
    outputs: canonicalize(input.outputs)
  });
  validateTreatment(artifact, "candidate", state.run_lock, state.gold, state.baseline);
  writeArtifactExclusive(state.root, ARTIFACT_NAMES.candidate, artifact);
  return artifact;
}

export function freezeDialectScore(runDirectory, input) {
  const state = loadPhaseState(runDirectory, "score");
  exactKeys(input, ["baseline_sha256", "candidate_sha256", "claim_audits", "facet_judgments", "gold_sha256", "run_lock_sha256"], "score input");
  retainedDigest(input.run_lock_sha256, state.run_lock.payload_sha256, "run lock");
  retainedDigest(input.gold_sha256, state.gold.payload_sha256, "gold");
  retainedDigest(input.baseline_sha256, state.baseline.payload_sha256, "baseline");
  retainedDigest(input.candidate_sha256, state.candidate.payload_sha256, "candidate");
  const summary = buildScoreSummary(input.facet_judgments, input.claim_audits, state);
  const artifact = withPayloadHash({
    schema_version: 1,
    phase: "score",
    run_lock_sha256: input.run_lock_sha256,
    gold_sha256: input.gold_sha256,
    baseline_sha256: input.baseline_sha256,
    candidate_sha256: input.candidate_sha256,
    facet_judgments: canonicalize(input.facet_judgments),
    claim_audits: canonicalize(input.claim_audits),
    summary
  });
  validateScore(artifact, state);
  writeArtifactExclusive(state.root, ARTIFACT_NAMES.score, artifact);
  return artifact;
}

export function freezeDialectReveal(runDirectory, input) {
  const state = loadPhaseState(runDirectory, "reveal");
  exactKeys(input, ["patches", "run_lock_sha256", "score_sha256"], "reveal input");
  retainedDigest(input.run_lock_sha256, state.run_lock.payload_sha256, "run lock");
  retainedDigest(input.score_sha256, state.score.payload_sha256, "score");
  const artifact = withPayloadHash({
    schema_version: 1,
    phase: "reveal",
    run_lock_sha256: input.run_lock_sha256,
    score_sha256: input.score_sha256,
    patches: canonicalize(input.patches)
  });
  validateReveal(artifact, state);
  writeArtifactExclusive(state.root, ARTIFACT_NAMES.reveal, artifact);
  return artifact;
}

export function canonicalEvaluationInputLock(runLock) {
  validateRunLock(runLock);
  return canonicalize({
    fixture_set_sha256: runLock.fixture_set_sha256,
    non_dialect_index_sha256: runLock.non_dialect_index_sha256,
    retrieval_budget_sha256: runLock.retrieval_budget_sha256,
    source_tree_sha256: runLock.source_tree_sha256,
    tasks_sha256: runLock.tasks_sha256
  });
}

export function createEvaluationOutput(taskId, renderedOutput, claims = [], diagnostics = []) {
  const artifact = {
    task_id: taskId,
    rendered_output: renderedOutput,
    rendered_output_bytes: Buffer.byteLength(renderedOutput),
    rendered_output_sha256: sha256(renderedOutput),
    claims: canonicalize(claims),
    diagnostics: canonicalize(diagnostics)
  };
  return artifact;
}

export function citationSetSha256(citations) {
  return sha256(canonicalJson(citations));
}

export function readDialectEvaluation(runDirectory) {
  const root = inspectRunDirectory(runDirectory);
  const entries = fs.readdirSync(root).sort();
  const unknown = entries.filter((entry) => !Object.values(ARTIFACT_NAMES).includes(entry));
  if (unknown.length > 0) fail(`unexpected run artifact: ${unknown[0]}`);
  const artifacts = {};
  for (const phase of PHASES) {
    const name = ARTIFACT_NAMES[phase];
    if (!entries.includes(name)) continue;
    artifacts[phase] = readArtifact(root, name);
  }
  if (!artifacts.run_lock) fail("run lock is missing");
  validateRunLock(artifacts.run_lock);
  if (artifacts.gold) validateGold(artifacts.gold, artifacts.run_lock);
  if (artifacts.baseline) validateTreatment(artifacts.baseline, "baseline", artifacts.run_lock, artifacts.gold);
  if (artifacts.candidate) validateTreatment(artifacts.candidate, "candidate", artifacts.run_lock, artifacts.gold, artifacts.baseline);
  if (artifacts.score) validateScore(artifacts.score, artifacts);
  if (artifacts.reveal) validateReveal(artifacts.reveal, artifacts);
  return artifacts;
}

function validateRunLock(artifact) {
  exactKeys(artifact, [
    "capability_manifest_sha256", "fixture_set_sha256", "limits_sha256",
    "non_dialect_index_sha256", "payload_sha256", "phase", "retrieval_budget_sha256",
    "run_id", "schema_version", "source_catalog", "source_tree_sha256", "tasks", "tasks_sha256"
  ], "evaluation run lock");
  if (artifact.schema_version !== 1 || artifact.phase !== "run_lock") fail("invalid run lock identity");
  visibleIdentifier(artifact.run_id, "run id");
  for (const [key, value] of Object.entries({
    capability_manifest_sha256: artifact.capability_manifest_sha256,
    fixture_set_sha256: artifact.fixture_set_sha256,
    limits_sha256: artifact.limits_sha256,
    non_dialect_index_sha256: artifact.non_dialect_index_sha256,
    retrieval_budget_sha256: artifact.retrieval_budget_sha256,
    source_tree_sha256: artifact.source_tree_sha256,
    tasks_sha256: artifact.tasks_sha256,
    payload_sha256: artifact.payload_sha256
  })) hexSha256(value, key);
  if (artifact.capability_manifest_sha256 !== DIALECT_CAPABILITY_MANIFEST_SHA256 || artifact.limits_sha256 !== DIALECT_LIMITS_SHA256) fail("run lock uses a different contract or limits manifest");
  if (!Array.isArray(artifact.tasks) || artifact.tasks.length !== 14 || artifact.tasks.length > DIALECT_LIMITS.max_tasks) fail("run lock must contain one task for every language family");
  requireSorted(artifact.tasks.map((task) => task.task_id), "task bindings");
  const taskIds = new Set();
  const families = new Set();
  for (const task of artifact.tasks) {
    exactKeys(task, ["base_commit", "family", "source_scope", "task_bytes", "task_id", "task_sha256"], "task binding");
    visibleIdentifier(task.task_id, "task id");
    if (!/^[a-f0-9]{40,64}$/.test(task.base_commit)) fail("invalid immutable base commit");
    hexSha256(task.task_sha256, "task hash");
    if (!Number.isSafeInteger(task.task_bytes) || task.task_bytes < 1 || task.task_bytes > DIALECT_LIMITS.max_task_bytes) fail("task bytes are outside the frozen bound");
    if (!DIALECT_CAPABILITY_MANIFEST.families.some((entry) => entry.family === task.family)) fail(`unknown task family: ${task.family}`);
    if (taskIds.has(task.task_id) || families.has(task.family)) fail("task ids and language families must be unique");
    taskIds.add(task.task_id);
    families.add(task.family);
    if (!Array.isArray(task.source_scope) || task.source_scope.length === 0) fail("task source scope must not be empty");
    const canonical = task.source_scope.map(canonicalRepositoryPath);
    if (new Set(canonical).size !== canonical.length || canonicalJson(canonical) !== canonicalJson([...canonical].sort())) fail("task source scope must be unique and sorted");
  }
  if (artifact.tasks_sha256 !== sha256(canonicalJson(artifact.tasks))) fail("task bindings changed after locking");
  validateSourceCatalog(artifact.source_catalog, artifact.tasks);
  if (artifact.source_tree_sha256 !== sha256(canonicalJson(artifact.source_catalog))) fail("source-tree hash must bind the complete frozen source catalog");
  validateSelfHash(artifact);
  forbidSensitivePayload(artifact);
  return artifact;
}

function validateGold(artifact, runLock) {
  if (!runLock) fail("gold requires a run lock");
  exactKeys(artifact, ["facets", "payload_sha256", "phase", "run_lock_sha256", "schema_version", "source_tree_sha256", "tasks_sha256"], "gold artifact");
  if (artifact.schema_version !== 1 || artifact.phase !== "gold" || artifact.run_lock_sha256 !== runLock.payload_sha256) fail("gold phase lock mismatch");
  if (artifact.source_tree_sha256 !== runLock.source_tree_sha256) fail("source-tree drift before gold freeze");
  if (artifact.tasks_sha256 !== runLock.tasks_sha256) fail("task mutation before gold freeze");
  if (!Array.isArray(artifact.facets) || artifact.facets.length > DIALECT_LIMITS.max_facets) fail("invalid gold facet inventory");
  requireSorted(artifact.facets.map((facet) => facet.facet_id), "gold facets");
  const taskMap = new Map(runLock.tasks.map((task) => [task.task_id, task]));
  const facetIds = new Set();
  const familyCounts = new Map();
  const familyCategories = new Map();
  for (const facet of artifact.facets) {
    exactKeys(facet, ["category", "citations", "critical", "facet_id", "family", "recurrence_rationale", "scope", "statement", "task_id"], "gold facet");
    visibleIdentifier(facet.facet_id, "facet id");
    if (facetIds.has(facet.facet_id)) fail(`duplicate facet id: ${facet.facet_id}`);
    facetIds.add(facet.facet_id);
    const task = taskMap.get(facet.task_id);
    if (!task || task.family !== facet.family) fail("gold facet does not match its frozen task/family");
    const family = DIALECT_CAPABILITY_MANIFEST.families.find((entry) => entry.family === facet.family);
    if (family?.capabilities[facet.category]?.status !== "applicable") fail("gold facet uses an unsupported observation category");
    visibleText(facet.statement, DIALECT_LIMITS.max_shape_chars, "facet statement");
    visibleText(facet.scope, DIALECT_LIMITS.max_repository_path_chars, "facet scope");
    visibleText(facet.recurrence_rationale, DIALECT_LIMITS.max_shape_chars, "recurrence rationale");
    if (typeof facet.critical !== "boolean") fail("facet critical flag must be boolean");
    validateCitations(facet.citations, task, runLock, { minimum: 2 });
    familyCounts.set(facet.family, (familyCounts.get(facet.family) ?? 0) + 1);
    if (!familyCategories.has(facet.family)) familyCategories.set(facet.family, new Set());
    familyCategories.get(facet.family).add(facet.category);
  }
  if (artifact.facets.length < 56) fail("gold must contain at least 56 facets");
  for (const family of DIALECT_CAPABILITY_MANIFEST.families) {
    if ((familyCounts.get(family.family) ?? 0) < DIALECT_LIMITS.min_facets_per_family) fail(`insufficient gold facets for ${family.family}`);
    for (const [category, capability] of Object.entries(family.capabilities)) {
      if (capability.status === "applicable" && !familyCategories.get(family.family)?.has(category)) fail(`gold does not cover applicable capability: ${family.family}/${category}`);
    }
  }
  validateSelfHash(artifact);
  forbidSensitivePayload(artifact);
  return artifact;
}

function validateTreatment(artifact, phase, runLock, gold, baseline = null) {
  if (!gold) fail(`${phase} requires frozen gold`);
  const keys = ["dialect_enabled", "gold_sha256", "input_lock", "observation_index_sha256", "outputs", "payload_sha256", "phase", "run_lock_sha256", "schema_version"];
  if (phase === "candidate") keys.push("baseline_sha256");
  exactKeys(artifact, keys, `${phase} artifact`);
  if (artifact.schema_version !== 1 || artifact.phase !== phase || artifact.run_lock_sha256 !== runLock.payload_sha256 || artifact.gold_sha256 !== gold.payload_sha256) fail(`${phase} phase lock mismatch`);
  if (phase === "baseline") {
    if (artifact.dialect_enabled !== false || artifact.observation_index_sha256 !== null) fail("baseline must exclude dialect observations");
  } else {
    if (!baseline || artifact.baseline_sha256 !== baseline.payload_sha256) fail("candidate requires the frozen baseline");
    if (artifact.dialect_enabled !== true) fail("candidate must enable the isolated dialect path");
    hexSha256(artifact.observation_index_sha256, "candidate observation index hash");
  }
  if (canonicalJson(artifact.input_lock) !== canonicalJson(canonicalEvaluationInputLock(runLock))) fail(`${phase} input lock differs from the frozen run`);
  validateOutputs(artifact.outputs, runLock);
  validateSelfHash(artifact);
  forbidSensitivePayload(artifact);
  return artifact;
}

function validateOutputs(outputs, runLock) {
  if (!Array.isArray(outputs) || outputs.length !== runLock.tasks.length) fail("treatment must retain exactly one output per task");
  requireSorted(outputs.map((output) => output.task_id), "treatment outputs");
  const tasks = new Map(runLock.tasks.map((task) => [task.task_id, task]));
  const seen = new Set();
  for (const output of outputs) {
    exactKeys(output, ["claims", "diagnostics", "rendered_output", "rendered_output_bytes", "rendered_output_sha256", "task_id"], "treatment output");
    const task = tasks.get(output.task_id);
    if (!task || seen.has(output.task_id)) fail("unknown or duplicate treatment output task");
    seen.add(output.task_id);
    if (typeof output.rendered_output !== "string") fail("rendered output must be a string");
    const bytes = Buffer.byteLength(output.rendered_output);
    if (bytes > DIALECT_LIMITS.max_rendered_output_bytes || output.rendered_output_bytes !== bytes || output.rendered_output_sha256 !== sha256(output.rendered_output)) fail("rendered output bytes or hash mismatch");
    if (!Array.isArray(output.claims) || output.claims.length > DIALECT_LIMITS.max_claims_per_task) fail("invalid positive claim inventory");
    if (!Array.isArray(output.diagnostics) || output.diagnostics.length > DIALECT_LIMITS.max_diagnostics_per_task) fail("invalid treatment diagnostics");
    for (const diagnostic of output.diagnostics) visibleText(diagnostic, DIALECT_LIMITS.max_diagnostic_chars, "treatment diagnostic");
    requireSorted(output.claims.map((claim) => claim.claim_id), "positive claims");
    const claimIds = new Set();
    for (const claim of output.claims) {
      exactKeys(claim, ["citations", "claim_id", "statement"], "positive claim");
      visibleIdentifier(claim.claim_id, "claim id");
      if (claimIds.has(claim.claim_id)) fail("duplicate claim id within task output");
      claimIds.add(claim.claim_id);
      visibleText(claim.statement, DIALECT_LIMITS.max_shape_chars, "claim statement");
      validateCitations(claim.citations, task, runLock, { minimum: DIALECT_LIMITS.min_citations_per_positive_claim });
    }
  }
}

function validateScore(artifact, state) {
  exactKeys(artifact, ["baseline_sha256", "candidate_sha256", "claim_audits", "facet_judgments", "gold_sha256", "payload_sha256", "phase", "run_lock_sha256", "schema_version", "summary"], "score artifact");
  if (artifact.schema_version !== 1 || artifact.phase !== "score" || artifact.run_lock_sha256 !== state.run_lock?.payload_sha256 || artifact.gold_sha256 !== state.gold?.payload_sha256 || artifact.baseline_sha256 !== state.baseline?.payload_sha256 || artifact.candidate_sha256 !== state.candidate?.payload_sha256) fail("score phase lock mismatch");
  validateJudgmentsAndAudits(artifact.facet_judgments, artifact.claim_audits, state);
  const expected = buildScoreSummary(artifact.facet_judgments, artifact.claim_audits, state);
  if (canonicalJson(artifact.summary) !== canonicalJson(expected)) fail("score summary is not derived from frozen judgments");
  validateSelfHash(artifact);
  forbidSensitivePayload(artifact);
  return artifact;
}

function validateJudgmentsAndAudits(judgments, audits, state) {
  if (!Array.isArray(judgments) || judgments.length !== state.gold.facets.length) fail("every gold facet must have one score judgment");
  requireSorted(judgments.map((judgment) => judgment.facet_id), "facet judgments");
  const facets = new Map(state.gold.facets.map((facet) => [facet.facet_id, facet]));
  const claims = treatmentClaimMap(state);
  const seenFacets = new Set();
  for (const judgment of judgments) {
    exactKeys(judgment, ["baseline", "candidate", "facet_id"], "facet judgment");
    const facet = facets.get(judgment.facet_id);
    if (!facet || seenFacets.has(judgment.facet_id)) fail("unknown or duplicate facet judgment");
    seenFacets.add(judgment.facet_id);
    for (const treatment of ["baseline", "candidate"]) {
      const result = judgment[treatment];
      exactKeys(result, ["claim_ids", "rating"], `${treatment} facet result`);
      if (!RATINGS.includes(result.rating) || !Array.isArray(result.claim_ids)) fail("invalid facet rating");
      requireSorted(result.claim_ids, `${treatment} facet claim ids`);
      if (result.rating === "explicit" && result.claim_ids.length === 0) fail("explicit facet ratings require a cited positive claim");
      const ids = new Set();
      for (const claimId of result.claim_ids) {
        visibleIdentifier(claimId, "scored claim id");
        if (ids.has(claimId)) fail("duplicate scored claim id");
        ids.add(claimId);
        const claim = claims.get(`${treatment}:${facet.task_id}:${claimId}`);
        if (!claim) fail("facet judgment references a claim outside its task and treatment");
      }
    }
  }
  if (!Array.isArray(audits) || audits.length !== claims.size) fail("every positive claim must have one immutable audit");
  requireSorted(audits.map((audit) => `${audit.treatment}:${audit.task_id}:${audit.claim_id}`), "claim audits");
  const seenClaims = new Set();
  const auditByClaim = new Map();
  for (const audit of audits) {
    exactKeys(audit, ["citation_set_sha256", "citation_valid", "claim_id", "recurrence_valid", "scope_valid", "task_id", "treatment", "unsupported_normativity"], "claim audit");
    if (!["baseline", "candidate"].includes(audit.treatment)) fail("invalid claim audit treatment");
    const key = `${audit.treatment}:${audit.task_id}:${audit.claim_id}`;
    const claim = claims.get(key);
    if (!claim || seenClaims.has(key)) fail("unknown or duplicate claim audit");
    seenClaims.add(key);
    auditByClaim.set(key, audit);
    if (audit.citation_set_sha256 !== citationSetSha256(claim.citations)) fail("citation drift between frozen output and score audit");
    for (const flag of ["citation_valid", "recurrence_valid", "scope_valid", "unsupported_normativity"]) {
      if (typeof audit[flag] !== "boolean") fail(`claim audit ${flag} must be boolean`);
    }
  }
  for (const judgment of judgments) {
    const facet = facets.get(judgment.facet_id);
    for (const treatment of ["baseline", "candidate"]) {
      if (judgment[treatment].rating !== "explicit") continue;
      for (const claimId of judgment[treatment].claim_ids) {
        const audit = auditByClaim.get(`${treatment}:${facet.task_id}:${claimId}`);
        if (!audit?.citation_valid || !audit.recurrence_valid || !audit.scope_valid || audit.unsupported_normativity) fail(`${treatment} explicit credit requires a fully valid immutable claim audit`);
      }
    }
  }
}

function buildScoreSummary(judgments, audits, state) {
  validateJudgmentsAndAudits(judgments, audits, state);
  const facets = new Map(state.gold.facets.map((facet) => [facet.facet_id, facet]));
  const total = judgments.length;
  const strict = (treatment, selected = judgments) => selected.filter((item) => item[treatment].rating === "explicit").length;
  const contradicted = (treatment) => judgments.filter((item) => item[treatment].rating === "contradicted").length;
  const ratio = (numerator, denominator) => denominator === 0 ? 0 : Number((numerator / denominator).toFixed(6));
  const baselineRecall = ratio(strict("baseline"), total);
  const candidateRecall = ratio(strict("candidate"), total);
  const critical = judgments.filter((item) => facets.get(item.facet_id)?.critical);
  const familyRecall = {};
  for (const family of DIALECT_CAPABILITY_MANIFEST.families) {
    const selected = judgments.filter((item) => facets.get(item.facet_id)?.family === family.family);
    familyRecall[family.family] = ratio(strict("candidate", selected), selected.length);
  }
  const candidateAudits = audits.filter((audit) => audit.treatment === "candidate");
  const citationPrecision = ratio(candidateAudits.filter((audit) => audit.citation_valid).length, candidateAudits.length);
  const recurrencePrecision = ratio(candidateAudits.filter((audit) => audit.recurrence_valid).length, candidateAudits.length);
  const scopePrecision = ratio(candidateAudits.filter((audit) => audit.scope_valid).length, candidateAudits.length);
  const unsupportedNormativity = candidateAudits.filter((audit) => audit.unsupported_normativity).length;
  const candidateContradicted = contradicted("candidate");
  const criticalRecall = ratio(strict("candidate", critical), critical.length);
  const delta = Number((candidateRecall - baselineRecall).toFixed(6));
  const scoreGatePass =
    candidateRecall >= 0.8 &&
    Object.values(familyRecall).every((value) => value >= 0.6) &&
    criticalRecall >= 0.8 &&
    citationPrecision === 1 &&
    recurrencePrecision === 1 &&
    scopePrecision === 1 &&
    contradicted("baseline") === 0 &&
    candidateContradicted === 0 &&
    unsupportedNormativity === 0 &&
    delta >= 0.3;
  return canonicalize({
    total_facets: total,
    baseline_strict_recall: baselineRecall,
    candidate_strict_recall: candidateRecall,
    candidate_recall_by_family: familyRecall,
    critical_strict_recall: criticalRecall,
    candidate_citation_precision: citationPrecision,
    candidate_recurrence_precision: recurrencePrecision,
    candidate_scope_precision: scopePrecision,
    baseline_contradicted_facets: contradicted("baseline"),
    candidate_contradicted_facets: candidateContradicted,
    candidate_unsupported_normative_claims: unsupportedNormativity,
    candidate_baseline_recall_delta: delta,
    score_gate_pass: scoreGatePass
  });
}

function validateReveal(artifact, state) {
  if (!state.score) fail("reveal is forbidden before immutable scoring");
  exactKeys(artifact, ["patches", "payload_sha256", "phase", "run_lock_sha256", "schema_version", "score_sha256"], "reveal artifact");
  if (artifact.schema_version !== 1 || artifact.phase !== "reveal" || artifact.run_lock_sha256 !== state.run_lock.payload_sha256 || artifact.score_sha256 !== state.score.payload_sha256) fail("reveal phase lock mismatch");
  if (!Array.isArray(artifact.patches) || artifact.patches.length !== state.run_lock.tasks.length) fail("reveal must account for every task patch");
  requireSorted(artifact.patches.map((patch) => patch.task_id), "reveal patches");
  const taskIds = new Set(state.run_lock.tasks.map((task) => task.task_id));
  const facetIds = new Set(state.gold.facets.map((facet) => facet.facet_id));
  const seen = new Set();
  for (const patch of artifact.patches) {
    exactKeys(patch, ["conformed", "exercised_facet_ids", "patch_sha256", "task_id"], "reveal patch");
    if (!taskIds.has(patch.task_id) || seen.has(patch.task_id)) fail("unknown or duplicate reveal task");
    seen.add(patch.task_id);
    hexSha256(patch.patch_sha256, "patch hash");
    if (typeof patch.conformed !== "boolean" || !Array.isArray(patch.exercised_facet_ids)) fail("invalid reveal patch result");
    requireSorted(patch.exercised_facet_ids, "exercised facet ids");
    for (const facetId of patch.exercised_facet_ids) {
      if (!facetIds.has(facetId)) fail("reveal references an unknown frozen facet");
      if (state.gold.facets.find((facet) => facet.facet_id === facetId)?.task_id !== patch.task_id) fail("reveal facet does not belong to the revealed task");
    }
  }
  validateSelfHash(artifact);
  return artifact;
}

function validateCitations(citations, task, runLock, { minimum }) {
  if (!Array.isArray(citations) || citations.length < minimum || citations.length > DIALECT_LIMITS.max_citations_per_claim) fail("citation count is outside the frozen bounds");
  requireSorted(citations.map((citation) => citation.citation_id), "citations");
  const ids = new Set();
  const locations = new Set();
  const sourceCatalog = new Map(runLock.source_catalog.map((source) => [source.path, source]));
  for (const citation of citations) {
    exactKeys(citation, ["citation_id", "end_line", "path", "source_sha256", "start_line"], "citation");
    visibleIdentifier(citation.citation_id, "citation id");
    if (ids.has(citation.citation_id)) fail("duplicate citation id");
    ids.add(citation.citation_id);
    canonicalRepositoryPath(citation.path);
    if (!task.source_scope.some((scope) => citation.path === scope || citation.path.startsWith(`${scope}/`))) fail("citation escaped the frozen local source scope");
    hexSha256(citation.source_sha256, "citation source hash");
    if (sourceCatalog.get(citation.path)?.source_sha256 !== citation.source_sha256) fail("citation source hash is not bound to the frozen source catalog");
    if (!Number.isSafeInteger(citation.start_line) || citation.start_line < 1 || !Number.isSafeInteger(citation.end_line) || citation.end_line < citation.start_line) fail("invalid citation line span");
    if (citation.end_line > sourceCatalog.get(citation.path).line_count) fail("citation line span exceeds the frozen catalog line count");
    const location = `${citation.path}:${citation.start_line}:${citation.end_line}:${citation.source_sha256}`;
    if (locations.has(location)) fail("citations must identify distinct unchanged source spans");
    locations.add(location);
  }
}

function treatmentClaimMap(state) {
  const claims = new Map();
  for (const treatment of ["baseline", "candidate"]) {
    for (const output of state[treatment].outputs) {
      for (const claim of output.claims) claims.set(`${treatment}:${output.task_id}:${claim.claim_id}`, claim);
    }
  }
  return claims;
}

function validateSourceCatalog(catalog, tasks) {
  if (!Array.isArray(catalog) || catalog.length === 0 || catalog.length > DIALECT_LIMITS.max_source_catalog_files) fail("invalid frozen source catalog size");
  requireSorted(catalog.map((source) => source.path), "source catalog");
  let aggregateBytes = 0;
  const countsByTask = new Map(tasks.map((task) => [task.task_id, 0]));
  for (const source of catalog) {
    exactKeys(source, ["bytes", "line_count", "path", "source_sha256"], "source catalog entry");
    canonicalRepositoryPath(source.path);
    hexSha256(source.source_sha256, "catalog source hash");
    nonNegativeInteger(source.bytes, "catalog source bytes");
    if (!Number.isSafeInteger(source.line_count) || source.line_count < 1) fail("catalog source line count must be a positive source-derived integer");
    if (source.bytes > DIALECT_LIMITS.max_source_bytes) fail("catalog source exceeds the per-file source byte cap");
    aggregateBytes += source.bytes;
    if (!Number.isSafeInteger(aggregateBytes) || aggregateBytes > DIALECT_LIMITS.max_source_catalog_bytes) fail("source catalog exceeds its aggregate byte cap");
    let owned = false;
    for (const task of tasks) {
      if (task.source_scope.some((scope) => source.path === scope || source.path.startsWith(`${scope}/`))) {
        countsByTask.set(task.task_id, countsByTask.get(task.task_id) + 1);
        owned = true;
      }
    }
    if (!owned) fail("source catalog entry is outside every frozen task scope");
  }
  for (const task of tasks) {
    if (countsByTask.get(task.task_id) < 1) fail(`source catalog lacks a scoped file for ${task.task_id}`);
  }
}

function loadPhaseState(runDirectory, nextPhase) {
  const root = inspectRunDirectory(runDirectory);
  const nextIndex = PHASES.indexOf(nextPhase);
  if (nextIndex < 1) fail("invalid next phase");
  const entries = fs.readdirSync(root).sort();
  const expected = PHASES.slice(0, nextIndex).map((phase) => ARTIFACT_NAMES[phase]).sort();
  if (entries.join("\0") !== expected.join("\0")) {
    if (entries.includes(ARTIFACT_NAMES[nextPhase])) fail(`${nextPhase} output is immutable and cannot be overwritten`);
    fail(`${nextPhase} cannot run before every preceding phase is frozen`);
  }
  const state = { root };
  for (const phase of PHASES.slice(0, nextIndex)) state[phase] = readArtifact(root, ARTIFACT_NAMES[phase]);
  validateRunLock(state.run_lock);
  if (state.gold) validateGold(state.gold, state.run_lock);
  if (state.baseline) validateTreatment(state.baseline, "baseline", state.run_lock, state.gold);
  if (state.candidate) validateTreatment(state.candidate, "candidate", state.run_lock, state.gold, state.baseline);
  if (state.score) validateScore(state.score, state);
  return state;
}

function inspectRunDirectory(runDirectory, { expectEmpty = false } = {}) {
  if (typeof runDirectory !== "string" || runDirectory.length === 0) fail("run directory is required");
  const resolved = path.resolve(runDirectory);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("run directory must be a real directory");
  if (fs.realpathSync.native(resolved) !== resolved) fail("run directory cannot contain a symlink component");
  const entries = fs.readdirSync(resolved);
  if (expectEmpty && entries.length !== 0) fail("new run directory must be empty");
  if (entries.length > DIALECT_LIMITS.max_evaluation_artifacts) fail("evaluation artifact count cap exceeded");
  return resolved;
}

function readArtifact(root, name) {
  const filePath = path.join(root, name);
  const before = fs.lstatSync(filePath);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) fail(`unsafe evaluation artifact: ${name}`);
  if (before.size > DIALECT_LIMITS.max_phase_artifact_bytes) fail(`oversized evaluation artifact: ${name}`);
  if (fs.realpathSync.native(filePath) !== filePath) fail(`redirected evaluation artifact: ${name}`);
  const bytes = fs.readFileSync(filePath);
  const after = fs.lstatSync(filePath);
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || bytes.length !== before.size) fail(`evaluation artifact changed during read: ${name}`);
  let artifact;
  try {
    artifact = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(`invalid JSON evaluation artifact: ${name}`);
  }
  if (prettyJson(artifact) !== bytes.toString("utf8")) fail(`non-canonical evaluation artifact: ${name}`);
  validateSelfHash(artifact);
  return artifact;
}

function writeArtifactExclusive(root, name, artifact) {
  const bytes = prettyJson(artifact);
  if (Buffer.byteLength(bytes) > DIALECT_LIMITS.max_phase_artifact_bytes) fail(`evaluation artifact exceeds byte cap: ${name}`);
  const rootBefore = fs.lstatSync(root);
  const filePath = path.join(root, name);
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes, "utf8");
  } catch (error) {
    if (error?.code === "EEXIST") fail(`${name} is immutable and cannot be overwritten`);
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  const rootAfter = fs.lstatSync(root);
  if (rootBefore.dev !== rootAfter.dev || rootBefore.ino !== rootAfter.ino) fail("run directory changed during artifact write");
  readArtifact(root, name);
}

function withPayloadHash(artifact) {
  artifact.payload_sha256 = stablePayloadHash(artifact);
  return artifact;
}

function retainedDigest(provided, actual, label) {
  hexSha256(provided, `${label} retained digest`);
  if (provided !== actual) fail(`${label} changed after its digest was retained`);
}

function validateSelfHash(artifact) {
  hexSha256(artifact.payload_sha256, "artifact payload hash");
  if (artifact.payload_sha256 !== stablePayloadHash(artifact)) fail("artifact payload hash mismatch");
}

function prettyJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function visibleIdentifier(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > DIALECT_LIMITS.max_identifier_chars || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) fail(`invalid ${label}`);
}

function visibleText(value, maxChars, label) {
  if (typeof value !== "string" || value.length === 0 || [...value].length > maxChars || /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value)) fail(`invalid ${label}`);
}

function requireSorted(values, label) {
  if (canonicalJson(values) !== canonicalJson([...values].sort())) fail(`${label} must be canonically ordered`);
  if (new Set(values).size !== values.length) fail(`${label} must be unique`);
}

function forbidSensitivePayload(value, key = "") {
  const forbidden = new Set(["issue_text", "patch", "patch_bytes", "raw_ast", "candidate_output", "baseline_output", "post_patch_source"]);
  if (forbidden.has(key)) fail(`blinded phase contains forbidden field: ${key}`);
  if (Array.isArray(value)) {
    for (const item of value) forbidSensitivePayload(item);
  } else if (value && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value)) forbidSensitivePayload(child, childKey);
  }
}

function fail(message) {
  throw new TypeError(`Dialect evaluation: ${message}`);
}

export { ARTIFACT_NAMES as DIALECT_EVALUATION_ARTIFACT_NAMES, PHASES as DIALECT_EVALUATION_PHASES };
