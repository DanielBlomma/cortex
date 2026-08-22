import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_WO048_PATHS,
  FROZEN_WO048_TASK_IDS,
  buildWo048FourTreatment,
  projectPacketForModelFrame,
  utf8PrefixAtByteLimit,
  writeWo048FourTreatment
} from "../benchmark/bootstrapbench/wo048-four-treatment.mjs";

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

function selfHash(value, field) {
  const payload = structuredClone(value);
  delete payload[field];
  return sha256(JSON.stringify(canonicalize(payload)));
}

function forbidden(serialized) {
  return [
    "evaluator_judgments", "gold_context", "gold_patch", "mechanism_rubric",
    "primary_runtime_files", "regression_test_surfaces", "test_patch"
  ].filter((key) => serialized.includes(`\"${key}\"`));
}

test("WO-048 applies the unchanged bounded algorithm to exactly four passing tasks", () => {
  const first = buildWo048FourTreatment();
  const second = buildWo048FourTreatment();
  assert.deepEqual(first.retrievalArtifact, second.retrievalArtifact);
  assert.deepEqual(first.manifest, second.manifest);
  assert.deepEqual(first.score, second.score);
  assert.deepEqual(first.manifest.tasks.map((task) => task.task_id), FROZEN_WO048_TASK_IDS);
  assert.equal(first.manifest.tasks.some((task) => task.task_id.includes("720b4d92")), false);
  assert.equal(first.frames.length, 4);
  assert.equal(first.issueSources.length, 4);
  assert.equal(first.manifest.control_arm_present, false);
  assert.equal(first.manifest.prompt_assembly_status, "not_assembled");
  assert.deepEqual(first.manifest.algorithm_identity.parameters, {
    definition_limit: 12,
    baseline_file_symbol_limit: 2,
    graph_depth: 2,
    subsystem_anchor_limit: 12,
    pass2_candidate_pool: 80,
    runtime_lane_max: 32,
    test_lane_max: 12,
    final_result_max: 44,
    minimum_symbol_length: 4,
    minimum_query_token_length: 3,
    minimum_pass2_query_overlap: 2,
    estimated_token_divisor: 4
  });
  assert.ok(first.retrievalArtifact.packets.every((packet) => packet.pass0.retained_exact_order));
  assert.equal(selfHash(first.retrievalArtifact, "retrieval_payload_sha256"), first.retrievalArtifact.retrieval_payload_sha256);
  assert.equal(selfHash(first.manifest, "bridge_payload_sha256"), first.manifest.bridge_payload_sha256);
  assert.equal(selfHash(first.score, "score_payload_sha256"), first.score.score_payload_sha256);
  assert.deepEqual(first.manifest.counters, {
    planner_calls: 0,
    solution_model_calls: 0,
    provider_calls: 0,
    solution_agents_launched: 0,
    treatment_frames_created: 4,
    control_frames_created: 0
  });
  assert.deepEqual(forbidden(JSON.stringify(first.retrievalArtifact)), []);
  assert.deepEqual(forbidden(JSON.stringify(first.manifest)), []);
});

test("four frames bind task, issue, commit, index, sources, and frozen bounds", () => {
  const built = buildWo048FourTreatment();
  for (const [index, task] of built.manifest.tasks.entries()) {
    const frame = built.frames[index];
    const issue = built.issueSources[index];
    const decoded = JSON.parse(Buffer.from(frame.frame.split("\n")[6], "base64").toString("utf8"));
    assert.equal(task.treatment_frame.file_sha256, sha256(frame.frame));
    assert.equal(task.issue_text_source.file_sha256, sha256(issue.bytes));
    assert.deepEqual(task.exact_agent_prompt_source_paths, [issue.filename, frame.filename]);
    assert.equal(decoded.task_id, task.task_id);
    assert.equal(decoded.repo, task.repository);
    assert.equal(decoded.base_commit, task.base_commit);
    assert.equal(decoded.index_sha256, task.index_sha256);
    assert.equal(decoded.query_sha256, task.issue_text_source.file_sha256);
    assert.ok(task.treatment_frame.frame_utf8_bytes <= task.treatment_frame.maximum_frame_utf8_bytes);
    assert.ok(task.treatment_frame.decoded_payload_utf8_bytes <= task.treatment_frame.maximum_decoded_payload_utf8_bytes);
    assert.deepEqual(
      decoded.final_results.map((result) => [result.path, result.final_rank]),
      built.retrievalArtifact.packets[index].final_results.map((result) => [result.path, result.final_rank])
    );
    assert.deepEqual(forbidden(JSON.stringify(decoded)), []);
  }
  const fullPrettier = built.retrievalArtifact.packets[0].final_results.find((result) => result.path === "bin/prettier.js");
  const framedPrettier = JSON.parse(Buffer.from(built.frames[0].frame.split("\n")[6], "base64").toString("utf8"))
    .final_results.find((result) => result.path === "bin/prettier.js");
  assert.equal(fullPrettier.content_supplied_utf8_bytes, 3237);
  assert.equal(fullPrettier.content_truncated, false);
  assert.equal(framedPrettier.content_supplied_utf8_bytes, 2112);
  assert.equal(framedPrettier.content_truncated, true);
  assert.notEqual(framedPrettier.content_supplied_sha256, fullPrettier.content_supplied_sha256);
});

test("model projection accepts the exact byte limit and truncates over-limit UTF-8 deterministically", () => {
  const exact = "x".repeat(2112);
  const over = `${"x".repeat(2111)}€tail`;
  assert.equal(utf8PrefixAtByteLimit(exact), exact);
  const prefix = utf8PrefixAtByteLimit(over);
  assert.equal(prefix, "x".repeat(2111));
  assert.equal(Buffer.byteLength(prefix, "utf8"), 2111);
  assert.equal(utf8PrefixAtByteLimit(over), prefix);
  const packet = {
    final_results: [{
      content_supplied: over,
      content_supplied_sha256: sha256(over),
      content_full_sha256: sha256(over),
      content_full_utf8_bytes: Buffer.byteLength(over, "utf8"),
      content_supplied_utf8_bytes: Buffer.byteLength(over, "utf8"),
      content_omitted_utf8_bytes: 0,
      content_truncated: false,
      content_excerpt_strategy: "small_source_full"
    }]
  };
  const projected = projectPacketForModelFrame(packet);
  assert.equal(projected.final_results[0].content_supplied, prefix);
  assert.equal(projected.final_results[0].content_truncated, true);
  assert.equal(projected.final_results[0].content_supplied_sha256, sha256(prefix));
  assert.equal(packet.final_results[0].content_supplied, over);
  assert.equal(packet.final_results[0].content_truncated, false);
});

test("primary-owner recall is count-only and bound after frame freeze", () => {
  const { score, manifest } = buildWo048FourTreatment();
  assert.equal(score.evaluated_only_after_treatment_frame_freeze, true);
  assert.equal(score.frozen_bridge_payload_sha256, manifest.bridge_payload_sha256);
  assert.deepEqual(score.tasks.map((task) => task.task_id), FROZEN_WO048_TASK_IDS);
  assert.deepEqual(forbidden(JSON.stringify(score)), []);
  assert.equal(JSON.stringify(score).includes("src/printer.js"), false);
  assert.deepEqual(score.counters, {
    planner_calls: 0,
    solution_model_calls: 0,
    provider_calls: 0,
    solution_agents_launched: 0
  });
});

test("materialization is byte-identical, has no control files, and refuses overwrite", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "wo048-four-treatment-"));
  const firstPath = path.join(temporary, "first");
  const secondPath = path.join(temporary, "second");
  try {
    writeWo048FourTreatment(firstPath);
    writeWo048FourTreatment(secondPath);
    const expected = [
      "bridge-manifest-v1.json",
      "issue-text-01.txt", "issue-text-02.txt", "issue-text-03.txt", "issue-text-04.txt",
      "primary-owner-score-v1.json",
      "retrieval-packets-v1.json",
      "treatment-frame-01.txt", "treatment-frame-02.txt", "treatment-frame-03.txt", "treatment-frame-04.txt"
    ];
    assert.deepEqual(fs.readdirSync(firstPath).sort(), expected);
    assert.deepEqual(fs.readdirSync(secondPath).sort(), expected);
    for (const filename of expected) {
      assert.deepEqual(fs.readFileSync(path.join(firstPath, filename)), fs.readFileSync(path.join(secondPath, filename)));
      assert.equal(filename.includes("control"), false);
    }
    assert.throws(() => writeWo048FourTreatment(firstPath), /output already exists/u);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("fixture tampering fails closed before retrieval", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "wo048-four-treatment-tamper-"));
  const fixturePath = path.join(temporary, "fixture.json");
  try {
    const fixture = JSON.parse(fs.readFileSync(DEFAULT_WO048_PATHS.fixture, "utf8"));
    fixture.tasks[0].base_commit = "0".repeat(40);
    fs.writeFileSync(fixturePath, `${JSON.stringify(fixture)}\n`);
    assert.throws(
      () => buildWo048FourTreatment({ paths: { ...DEFAULT_WO048_PATHS, fixture: fixturePath } }),
      /fixture file hash changed/u
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
