import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ANSWER_METRIC_POLICY,
  DEFAULT_STAGE1_PATHS,
  FROZEN_STAGE1_IDENTITIES,
  buildStage2Bridge,
  writeStage2Bridge
} from "../benchmark/bootstrapbench/wo047-stage2-bridge.mjs";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function listFiles(directory) {
  return fs.readdirSync(directory).sort();
}

function snapshotStage1() {
  return Object.fromEntries(
    Object.entries(DEFAULT_STAGE1_PATHS).map(([role, filePath]) => [role, sha256(fs.readFileSync(filePath))])
  );
}

function decodeFrame(frame) {
  const lines = frame.split("\n");
  return JSON.parse(Buffer.from(lines[6], "base64").toString("utf8"));
}

test("default Stage 1 inputs are repository-tracked fixture paths", () => {
  for (const role of ["frozen_input", "retrieval_packets", "offline_acceptance"]) {
    const filePath = DEFAULT_STAGE1_PATHS[role];
    assert.match(filePath.split(path.sep).join("/"), /benchmark\/bootstrapbench\/fixtures\/wo047-two-pass-stage1\/[^/]+\.json$/u);
    assert.equal(fs.existsSync(filePath), true, role);
  }
});

test("bridge maps the five immutable packets to five bounded treatment frames and no control frame", () => {
  const before = snapshotStage1();
  const first = buildStage2Bridge();
  const second = buildStage2Bridge();
  assert.deepEqual(first, second);
  assert.equal(first.frames.length, 5);
  assert.equal(first.manifest.tasks.length, 5);
  assert.deepEqual(first.manifest.counters, {
    planner_calls: 0,
    solution_model_calls: 0,
    provider_calls: 0,
    stage2_invocations_run: 0,
    treatment_frames_created: 5,
    control_frames_created: 0
  });
  assert.equal(first.manifest.experiment_contract.authorized_solution_calls, 10);
  assert.equal(first.manifest.experiment_contract.launch_status, "not_launched");
  assert.deepEqual(first.manifest.arms.find((arm) => arm.arm_id === "issue-text-only"), {
    arm_id: "issue-text-only",
    role: "control",
    receives_exact_issue_text: true,
    receives_bound_repository: true,
    receives_cortex_packet: false,
    cortex_tools_available: false,
    cortex_retrieval_tools_available: false
  });
  for (const [index, task] of first.manifest.tasks.entries()) {
    const frame = first.frames[index];
    assert.equal(frame.filename, `treatment-frame-${String(index + 1).padStart(2, "0")}.txt`);
    assert.equal(task.treatment_frame.file_sha256, sha256(frame.frame));
    assert.equal(task.treatment_frame.frame_utf8_bytes, Buffer.byteLength(frame.frame, "utf8"));
    assert.ok(task.treatment_frame.frame_utf8_bytes <= task.treatment_frame.maximum_frame_utf8_bytes);
    assert.ok(task.treatment_frame.decoded_payload_utf8_bytes <= task.treatment_frame.maximum_decoded_payload_utf8_bytes);
    const decoded = decodeFrame(frame.frame);
    assert.equal(decoded.task_id, task.task_id);
    assert.equal(decoded.repo, task.repository);
    assert.equal(decoded.base_commit, task.base_commit);
    assert.equal(decoded.query_sha256, task.issue_text.sha256);
    for (const forbidden of ["fixture", "score", "gold_patch", "mechanism_rubric", "primary_runtime_files", "regression_test_surfaces"]) {
      assert.equal(frame.frame.includes(`\"${forbidden}\"`), false);
    }
  }
  assert.deepEqual(snapshotStage1(), before);
});

test("manifest binds source hashes, renderer code identity, task/issue identity, and frozen metric policy", () => {
  const { manifest } = buildStage2Bridge();
  const bindings = Object.fromEntries(manifest.source_artifacts.map((entry) => [entry.role, entry]));
  assert.equal(bindings.stage1_frozen_input.file_sha256, FROZEN_STAGE1_IDENTITIES.frozen_input.file_sha256);
  assert.equal(bindings.stage1_frozen_input.canonical_payload_sha256, FROZEN_STAGE1_IDENTITIES.frozen_input.payload_sha256);
  assert.equal(bindings.stage1_retrieval_contract.file_sha256, FROZEN_STAGE1_IDENTITIES.retrieval_contract.file_sha256);
  assert.equal(bindings.stage1_retrieval_packets.file_sha256, FROZEN_STAGE1_IDENTITIES.retrieval_packets.file_sha256);
  assert.equal(bindings.stage1_retrieval_packets.canonical_payload_sha256, FROZEN_STAGE1_IDENTITIES.retrieval_packets.payload_sha256);
  assert.equal(bindings.stage1_offline_acceptance.file_sha256, FROZEN_STAGE1_IDENTITIES.offline_acceptance.file_sha256);
  assert.equal(bindings.stage1_offline_acceptance.canonical_payload_sha256, FROZEN_STAGE1_IDENTITIES.offline_acceptance.payload_sha256);
  assert.equal(manifest.renderer_identity.module_file_sha256, FROZEN_STAGE1_IDENTITIES.renderer_module.file_sha256);
  assert.equal(manifest.renderer_identity.function_source_sha256, FROZEN_STAGE1_IDENTITIES.renderer_module.function_source_sha256);
  assert.deepEqual(manifest.answer_metric_policy, ANSWER_METRIC_POLICY);
  assert.equal(manifest.answer_metric_policy.tie_breakers.length, 0);
  assert.equal(manifest.answer_metric_policy.aggregate_tie, "equal aggregates fail the strict-improvement gate");
  assert.deepEqual(manifest.tasks.map((task) => task.issue_id), [
    "clap-rs__clap-3421",
    "instance_ansible__ansible-fb144c44144f8bd3542e71f5db62b6d322c7bd85-vba6da65a0f3baefda7a058ebbd0a8dcafb8512f5",
    "instance_NodeBB__NodeBB-a5afad27e52fd336163063ba40dcadc80233ae10-vd59a5728dfc977f44533186ace531248c2917516",
    "keras-team__keras-18553",
    "sympy__sympy-13551"
  ]);
  const serialized = JSON.stringify(manifest);
  for (const forbiddenKey of ["gold_context", "gold_patch", "mechanism_rubric", "primary_runtime_files", "regression_test_surfaces", "test_patch", "evaluator_judgments"]) {
    assert.equal(serialized.includes(`\"${forbiddenKey}\"`), false);
  }
});

test("materialized bridge replays byte-identically and refuses overwrite", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "wo047-stage2-bridge-"));
  const firstPath = path.join(temporary, "first");
  const secondPath = path.join(temporary, "second");
  try {
    const first = writeStage2Bridge(firstPath);
    const second = writeStage2Bridge(secondPath);
    assert.equal(first.manifest_file_sha256, second.manifest_file_sha256);
    assert.deepEqual(listFiles(firstPath), [
      "bridge-manifest-v1.json",
      "treatment-frame-01.txt",
      "treatment-frame-02.txt",
      "treatment-frame-03.txt",
      "treatment-frame-04.txt",
      "treatment-frame-05.txt"
    ]);
    assert.deepEqual(listFiles(secondPath), listFiles(firstPath));
    for (const filename of listFiles(firstPath)) {
      assert.deepEqual(fs.readFileSync(path.join(firstPath, filename)), fs.readFileSync(path.join(secondPath, filename)));
    }
    assert.throws(() => writeStage2Bridge(firstPath), /output already exists/u);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("source artifact mutation fails closed before rendering", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "wo047-stage2-tamper-"));
  const tamperedRetrieval = path.join(temporary, "retrieval.json");
  try {
    const value = JSON.parse(fs.readFileSync(DEFAULT_STAGE1_PATHS.retrieval_packets, "utf8"));
    value.packets[0].base_commit = "0".repeat(40);
    fs.writeFileSync(tamperedRetrieval, `${JSON.stringify(value)}\n`);
    assert.throws(
      () => buildStage2Bridge({ paths: { ...DEFAULT_STAGE1_PATHS, retrieval_packets: tamperedRetrieval } }),
      /retrieval packets file hash changed/u
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
