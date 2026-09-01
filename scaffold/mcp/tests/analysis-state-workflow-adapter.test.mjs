import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  REGISTERED_RULE_IDS,
  bindingIdentitySha256,
  createAuthorityManifest,
  createObservation,
  createSourceAuthorityRegistry,
  evaluateAnalysisState,
} from "../dist/core/analysis-state/engine.js";
import {
  assertWorkflowAnalysisAgreement,
  createWorkflowAnalysisObservation,
} from "../dist/core/workflow/analysis-state-adapter.js";
import { createRun, advanceStage, getRunState } from "../dist/core/workflow/run-lifecycle.js";

const SOURCE = { path: "evidence/workflow.json", sha256: "9".repeat(64), selector: "gate" };
const POLICY = createSourceAuthorityRegistry({
  [SOURCE.path]: { sha256: SOURCE.sha256, authorities: ["reviewer"] },
});
const WORKFLOW = {
  id: "analysis-gated",
  description: "Analysis gate test",
  version: 1,
  stages: [{
    name: "review",
    artifact: "review.md",
    reads: [],
    required_fields: [],
    validators: [],
    description: "Review",
  }],
};

function root() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-analysis-workflow-")));
}

function inputObservation(subject, predicate, object, index) {
  return createObservation({
    schema_version: 1,
    subject,
    predicate,
    object,
    operation: "assert",
    observed_at: `2026-08-30T10:00:${String(index).padStart(2, "0")}Z`,
    authority: "reviewer",
    source: SOURCE,
    scope: { repository: "cortex", work_order: "WO-TEST", phase: "review" },
    supersedes: [],
  });
}

function state(kind) {
  const binding = ["a".repeat(64), "b".repeat(40), "c".repeat(40), "d".repeat(64), "e".repeat(64), "f".repeat(64)];
  const identity = bindingIdentitySha256(binding);
  const observations = [
    inputObservation("task:test", "binding_exact", binding, 1),
    inputObservation("task:test", "replay_deterministic", [identity, 1, 2, 3, 4, 0, "e".repeat(64), "f".repeat(64)], 2),
    inputObservation("task:test", "distinct_semantic_owners", [identity, "e".repeat(64), `owner-v4:${"1".repeat(64)}`, `owner-v4:${"2".repeat(64)}`], 3),
    inputObservation("task:test", "contamination_clear", [identity, "a".repeat(64), true], 4),
    inputObservation("WO-TEST", "required_binding_set_exact", ["task:test"], 5),
    inputObservation("WO-TEST", "receipt_schema_closed", true, 6),
    inputObservation("WO-TEST", "receipt_externally_anchored", true, 7),
    inputObservation("WO-TEST", "negative_probes_observed", true, 8),
    inputObservation("WO-TEST", "required_review_set_exact", ["review:test"], 9),
    inputObservation("review:test", "review_go", true, 10),
    inputObservation("WO-TEST", "human_approval", true, 11),
  ];
  if (kind === "blocked") {
    observations.push(inputObservation("WO-TEST", "blocker_active", "security_blocker", 12));
  }
  const selected = kind === "missing" ? observations.slice(-1) : observations;
  return evaluateAnalysisState(
    { schema_version: 1, rule_ids: REGISTERED_RULE_IDS, observations: selected },
    createAuthorityManifest(selected),
    POLICY,
  );
}

function advance(cwd, analysisGate, status = "complete") {
  return advanceStage({
    cwd,
    taskId: "analysis-task",
    workflow: WORKFLOW,
    stageName: "review",
    artifactName: "review.md",
    frontmatter: { stage: "review", status, references: [] },
    body: "# Review\n",
    status,
    analysisGate,
  });
}

test("absent analysis gate preserves existing workflow behavior", () => {
  const cwd = root();
  try {
    createRun({ cwd, taskId: "analysis-task", workflow: WORKFLOW, taskDescription: "test" });
    const next = advance(cwd, undefined);
    assert.equal(next.outcome, "complete");
    assert.equal(fs.existsSync(path.join(cwd, ".agents", "analysis-task", "review.md")), true);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("accepted maintained state permits completion and returns complete provenance", () => {
  const cwd = root();
  try {
    const analysis = state("accepted");
    const agreement = assertWorkflowAnalysisAgreement("complete", { enabled: true, state: analysis, subject: "WO-TEST" });
    assert.equal(agreement.completion_fact_ids.length, 1);
    assert.ok(agreement.proof.length > 0);
    createRun({ cwd, taskId: "analysis-task", workflow: WORKFLOW, taskDescription: "test" });
    assert.equal(advance(cwd, { enabled: true, state: analysis, subject: "WO-TEST" }).outcome, "complete");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("missing or contradictory state blocks before artifact and state writes", () => {
  for (const analysis of [state("missing"), state("blocked")]) {
    const cwd = root();
    try {
      createRun({ cwd, taskId: "analysis-task", workflow: WORKFLOW, taskDescription: "test" });
      const before = fs.readFileSync(path.join(cwd, ".agents", "analysis-task", "state.json"));
      assert.throws(
        () => advance(cwd, { enabled: true, state: analysis, subject: "WO-TEST" }),
        /workflow analysis-state disagreement.*evidence=/u,
      );
      assert.deepEqual(fs.readFileSync(path.join(cwd, ".agents", "analysis-task", "state.json")), before);
      assert.equal(fs.existsSync(path.join(cwd, ".agents", "analysis-task", "review.md")), false);
      assert.equal(getRunState(cwd, "analysis-task").outcome, "in_progress");
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }
});

test("blocked workflow outcome requires a derived blocker and rejects derived acceptance", () => {
  const blocked = state("blocked");
  const accepted = state("accepted");
  assert.equal(assertWorkflowAnalysisAgreement("blocked", { enabled: true, state: blocked, subject: "WO-TEST" }).blocker_fact_ids.length, 1);
  assert.throws(
    () => assertWorkflowAnalysisAgreement("blocked", { enabled: true, state: accepted, subject: "WO-TEST" }),
    /lacks a derived blocker/u,
  );
});

test("workflow observation adapter is explicit and delegates the closed schema", () => {
  const raw = {
    schema_version: 1,
    subject: "WO-TEST",
    predicate: "human_approval",
    object: true,
    operation: "assert",
    observed_at: "2026-08-30T10:00:00Z",
    authority: "reviewer",
    source: SOURCE,
    scope: { repository: "cortex", work_order: "WO-TEST", phase: "review" },
    supersedes: [],
  };
  assert.match(createWorkflowAnalysisObservation(true, raw).id, /^obs:[0-9a-f]{64}$/u);
  assert.throws(() => createWorkflowAnalysisObservation(false, raw), /explicitly enabled/u);
});
