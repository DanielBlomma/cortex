import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_PATH = path.join(
  ROOT,
  "benchmark/bootstrapbench/fixtures/wo048-clean-five-v1/frozen-fixture-v1.json",
);
const REPORT_PATH = path.join(ROOT, "docs/agent-control/wo048-alternative-five-fixture-report.md");
const ATTESTATION_PATH = path.join(
  ROOT,
  "benchmark/bootstrapbench/fixtures/wo048-clean-five-v1/artifact-attestation-v1.json",
);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function payloadHash(record, selfHashKey) {
  const payload = structuredClone(record);
  delete payload[selfHashKey];
  return sha256(JSON.stringify(canonicalize(payload)));
}

test("WO-048 fixture binds the exact clean remainder and issue bytes", () => {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  assert.equal(payloadHash(fixture, "fixture_payload_sha256"), fixture.fixture_payload_sha256);
  assert.equal(fixture.selection_contract.original_task_count, 12);
  assert.equal(fixture.selection_contract.excluded_union_count, 7);
  assert.equal(fixture.tasks.length, 5);
  assert.deepEqual(
    fixture.tasks.map((task) => task.task_id).sort(),
    [
      "SWE-Bench-Pro__go__maintenance__bugfix__720b4d92",
      "SWE-Bench-Verified__python__maintenance__bugfix__27320d49",
      "SWE-Bench-Verified__python__maintenance__bugfix__ac705f35",
      "SWE-PolyBench__javascript__maintenance__bugfix__10ab7842",
      "SWE-PolyBench__typescript__maintenance__bugfix__4f3cb6be",
    ],
  );
  for (const task of fixture.tasks) {
    const issue = Buffer.from(task.issue.base64, "base64");
    assert.equal(issue.length, task.issue.bytes, task.task_id);
    assert.equal(sha256(issue), task.issue.sha256, task.task_id);
    assert.equal(task.primary_runtime_files.length > 0, true, task.task_id);
    assert.equal(task.index_component_count, 29, task.task_id);
  }
});

test("WO-048 keeps contamination and issue quality as separate verdicts", () => {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  assert.equal(fixture.verdicts.exact_clean_remainder, "GO");
  assert.equal(fixture.verdicts.issue_description_quality, "NO-GO");
  assert.equal(fixture.verdicts.launch_or_retrieval_authorization, "NO-GO");
  assert.deepEqual(fixture.quality_summary.failing_task_ids, [
    "SWE-Bench-Pro__go__maintenance__bugfix__720b4d92",
  ]);
  assert.equal(fixture.contamination_evidence.selected_tasks_with_any_known_prior_solution_model_or_provider_call, 0);
  assert.equal(fixture.contamination_evidence.wo048_planner_calls, 0);
  assert.equal(fixture.contamination_evidence.wo048_solution_model_calls, 0);
  assert.equal(fixture.contamination_evidence.wo048_provider_calls, 0);
  assert.equal(fixture.contamination_evidence.wo048_retrieval_built_or_run, false);
  assert.equal(fixture.contamination_evidence.wo048_agents_launched, 0);
});

test("WO-048 detached attestation binds fixture and report files", () => {
  const attestation = JSON.parse(fs.readFileSync(ATTESTATION_PATH, "utf8"));
  assert.equal(payloadHash(attestation, "attestation_payload_sha256"), attestation.attestation_payload_sha256);
  assert.equal(sha256(fs.readFileSync(FIXTURE_PATH)), attestation.fixture.file_sha256);
  assert.equal(sha256(fs.readFileSync(REPORT_PATH)), attestation.report.file_sha256);
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  assert.equal(attestation.fixture.canonical_payload_sha256, fixture.fixture_payload_sha256);
});
