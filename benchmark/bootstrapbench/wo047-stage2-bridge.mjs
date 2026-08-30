#!/usr/bin/env node

/**
 * WO-047 Stage 2 frozen-input bridge.
 *
 * This default-off, offline-only module turns the five immutable Stage 1
 * retrieval packets into five bounded treatment frames. It does not build a
 * prompt, expose evaluation material, call a model/provider/planner, or launch
 * an AgentStackBench run.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MODEL_FACING_LIMITS,
  canonicalJson,
  renderUntrustedRetrievalPacket
} from "./wo047-two-pass-subsystem.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const BRIDGE_MODULE_PATH = fileURLToPath(import.meta.url);

export const DEFAULT_STAGE1_PATHS = Object.freeze({
  frozen_input: path.join(REPO_ROOT, "benchmark/bootstrapbench/fixtures/wo047-two-pass-stage1/frozen-fixture-v1.json"),
  retrieval_packets: path.join(REPO_ROOT, "benchmark/bootstrapbench/fixtures/wo047-two-pass-stage1/retrieval-packets-v1.json"),
  offline_acceptance: path.join(REPO_ROOT, "benchmark/bootstrapbench/fixtures/wo047-two-pass-stage1/offline-score-v1.json"),
  retrieval_contract: path.join(REPO_ROOT, "benchmark/bootstrapbench/wo047-two-pass-contract-v1.json"),
  renderer_module: path.join(REPO_ROOT, "benchmark/bootstrapbench/wo047-two-pass-subsystem.mjs")
});

export const FROZEN_STAGE1_IDENTITIES = Object.freeze({
  frozen_input: Object.freeze({
    file_sha256: "af51a243ec396869f3348645de1faea59310e5eaac2547817480b769dac3148d",
    payload_sha256: "89651b34fefed1a9ea2f06cf04f589c6fdeca1dac1f21c8165301b21cef71afa"
  }),
  retrieval_contract: Object.freeze({
    file_sha256: "bc79202564c1545e20a8fa9725f48c5d181e291958dc80381e43f4344d60e172"
  }),
  retrieval_packets: Object.freeze({
    file_sha256: "22ca32e453aeecdc9e3c4d58c897fe01b4f923882b6cdfba505473abb9312856",
    payload_sha256: "aed97409dac3049e33d4bb03129c2d0d27b7113f7a28a3c96ee166b15e8b01ac"
  }),
  offline_acceptance: Object.freeze({
    file_sha256: "4940dfc3180818014954bbd85408c985507be901d4c7fd65e388d3aea4e6f349",
    payload_sha256: "7963d340a07c817c1d41fcd0b860ebdb0afe97a1271fb6e2ea7e0f46eed50abf"
  }),
  renderer_module: Object.freeze({
    file_sha256: "e5f315a2def57d9793e12e60aecb8b05c5b1c0faecf8982b8732d495ed453847",
    export_name: "renderUntrustedRetrievalPacket",
    function_source_sha256: "0f803cc04d3dc469e800545621ba326484515bd539ed6d20a651ccfb090f6a2d",
    function_source_utf8_bytes: 10483
  })
});

export const ANSWER_METRIC_POLICY = Object.freeze({
  frozen_before_candidate_output: true,
  candidate_neutral: true,
  primary_metric_id: "native_resolution_pass_at_1_count",
  per_task_values: Object.freeze({ resolved: 1, unresolved: 0 }),
  aggregate: "sum the binary native-resolution result over all five symmetrically valid task pairs",
  treatment_gate: "two-pass-retrieval aggregate must be strictly greater than issue-text-only aggregate",
  task_pair_tie: "both arms with the same binary native-resolution result remain tied",
  aggregate_tie: "equal aggregates fail the strict-improvement gate",
  invalid_pair: "an invalid arm invalidates its pair symmetrically; any invalid pair makes the frozen five-pair primary result non-passing",
  tie_breakers: Object.freeze([]),
  supporting_metrics_do_not_break_ties: true,
  supporting_metrics: Object.freeze([
    "patch_overlap",
    "file_precision",
    "file_recall",
    "symbol_precision",
    "symbol_recall",
    "line_precision",
    "line_recall",
    "time_to_first_relevant_edit",
    "broad_repository_wandering",
    "irrelevant_files_opened"
  ])
});

const FORBIDDEN_EXPORTED_KEYS = new Set([
  "gold", "gold_context", "gold_files", "gold_patch", "mechanism_rubric",
  "primary_runtime_files", "regression_test_surfaces", "test_patch",
  "evaluator", "evaluator_judgments", "expected_fix", "oracle"
]);

function fail(message) {
  throw new Error(`WO-047 Stage 2 bridge violation: ${message}`);
}

function assertCondition(condition, message) {
  if (!condition) fail(message);
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return sha256Bytes(fs.readFileSync(filePath));
}

function relativeSourcePath(filePath) {
  const relative = path.relative(REPO_ROOT, filePath);
  assertCondition(relative && !relative.startsWith("..") && !path.isAbsolute(relative), `source path escapes repository: ${filePath}`);
  return relative.split(path.sep).join("/");
}

function readBoundJson(role, filePath, identity) {
  const bytes = fs.readFileSync(filePath);
  assertCondition(sha256Bytes(bytes) === identity.file_sha256, `${role} file hash changed`);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`${role} is not valid JSON: ${error.message}`);
  }
  return value;
}

function verifySelfHash(value, field, expected, role) {
  assertCondition(value[field] === expected, `${role} claimed payload hash changed`);
  const projection = structuredClone(value);
  delete projection[field];
  assertCondition(sha256Bytes(canonicalJson(projection)) === expected, `${role} canonical payload hash changed`);
}

function assertZeroBoundary(value, role) {
  assertCondition(value?.planner_calls === 0, `${role} planner call count is not zero`);
  assertCondition(value?.solution_model_calls === 0, `${role} solution-model call count is not zero`);
  assertCondition(value?.provider_calls === 0, `${role} provider call count is not zero`);
}

function assertNoExportedEvaluationKeys(value, label = "artifact") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoExportedEvaluationKeys(entry, `${label}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    assertCondition(!FORBIDDEN_EXPORTED_KEYS.has(key), `${label} contains forbidden field ${key}`);
    assertNoExportedEvaluationKeys(entry, `${label}.${key}`);
  }
}

function parseFrame(frame, rendererContract) {
  const lines = frame.split("\n");
  assertCondition(lines.length === 8, "renderer frame line count changed");
  assertCondition(lines[0] === rendererContract.untrusted_data_directive, "renderer directive changed");
  assertCondition(lines[1] === rendererContract.frame_open, "renderer opening delimiter changed");
  assertCondition(lines[2] === `renderer_version=${rendererContract.renderer_version}`, "renderer version changed");
  assertCondition(lines[3] === `encoding=${rendererContract.encoding}`, "renderer encoding changed");
  assertCondition(lines[7] === rendererContract.frame_close, "renderer closing delimiter changed");
  const payloadBytes = Number(lines[4].replace(/^payload_bytes=/u, ""));
  const payloadSha256 = lines[5].replace(/^payload_sha256=/u, "");
  assertCondition(Number.isSafeInteger(payloadBytes) && payloadBytes >= 0, "frame payload byte declaration is invalid");
  assertCondition(/^[0-9a-f]{64}$/u.test(payloadSha256), "frame payload hash declaration is invalid");
  assertCondition(/^[A-Za-z0-9+/]*={0,2}$/u.test(lines[6]), "frame payload is not canonical base64 text");
  const decodedBytes = Buffer.from(lines[6], "base64");
  assertCondition(decodedBytes.length === payloadBytes, "frame payload byte declaration changed");
  assertCondition(sha256Bytes(decodedBytes) === payloadSha256, "frame payload hash changed");
  assertCondition(Buffer.byteLength(frame, "utf8") <= MODEL_FACING_LIMITS.frame_utf8_bytes, "frame exceeds frozen byte bound");
  assertCondition(decodedBytes.length <= MODEL_FACING_LIMITS.decoded_payload_utf8_bytes, "decoded frame exceeds frozen byte bound");
  const decoded = JSON.parse(decodedBytes.toString("utf8"));
  assertNoExportedEvaluationKeys(decoded, "decoded treatment frame");
  return {
    decoded,
    payload_utf8_bytes: decodedBytes.length,
    payload_sha256: payloadSha256,
    base64_utf8_bytes: Buffer.byteLength(lines[6], "utf8")
  };
}

function sourceBinding(role, filePath, identity) {
  return {
    role,
    repository_relative_path: relativeSourcePath(filePath),
    file_sha256: identity.file_sha256,
    ...(identity.payload_sha256 ? { canonical_payload_sha256: identity.payload_sha256 } : {})
  };
}

function validateInputs(paths) {
  const frozenInput = readBoundJson("frozen input", paths.frozen_input, FROZEN_STAGE1_IDENTITIES.frozen_input);
  const contract = readBoundJson("retrieval contract", paths.retrieval_contract, FROZEN_STAGE1_IDENTITIES.retrieval_contract);
  const retrieval = readBoundJson("retrieval packets", paths.retrieval_packets, FROZEN_STAGE1_IDENTITIES.retrieval_packets);
  const acceptance = readBoundJson("offline acceptance", paths.offline_acceptance, FROZEN_STAGE1_IDENTITIES.offline_acceptance);
  assertCondition(sha256File(paths.renderer_module) === FROZEN_STAGE1_IDENTITIES.renderer_module.file_sha256, "renderer module file hash changed");
  const rendererSource = renderUntrustedRetrievalPacket.toString();
  assertCondition(Buffer.byteLength(rendererSource, "utf8") === FROZEN_STAGE1_IDENTITIES.renderer_module.function_source_utf8_bytes, "renderer function source size changed");
  assertCondition(sha256Bytes(rendererSource) === FROZEN_STAGE1_IDENTITIES.renderer_module.function_source_sha256, "renderer function source hash changed");

  verifySelfHash(frozenInput, "fixture_payload_sha256", FROZEN_STAGE1_IDENTITIES.frozen_input.payload_sha256, "frozen input");
  verifySelfHash(retrieval, "retrieval_payload_sha256", FROZEN_STAGE1_IDENTITIES.retrieval_packets.payload_sha256, "retrieval packets");
  verifySelfHash(acceptance, "score_payload_sha256", FROZEN_STAGE1_IDENTITIES.offline_acceptance.payload_sha256, "offline acceptance");
  assertCondition(frozenInput?.tasks?.length === 5, "frozen input must contain exactly five tasks");
  assertCondition(retrieval?.packet_count === 5 && retrieval?.packets?.length === 5, "retrieval source must contain exactly five packets");
  assertCondition(acceptance?.tasks?.length === 5, "offline acceptance must contain exactly five task records");
  assertCondition(acceptance?.aggregate?.offline_primary_gates_passed === true, "Stage 1 offline primary gates did not pass");
  assertCondition(retrieval.stage2_prepared_or_launched === false, "retrieval source records Stage 2 activity");
  assertCondition(acceptance.stage2_prepared_or_launched === false, "offline acceptance records Stage 2 activity");
  assertZeroBoundary(contract.provider_boundary, "retrieval contract");
  assertZeroBoundary(retrieval.provider_boundary, "retrieval packets");
  assertZeroBoundary(acceptance.provider_boundary, "offline acceptance");
  assertCondition(retrieval.contract_file_sha256 === FROZEN_STAGE1_IDENTITIES.retrieval_contract.file_sha256, "retrieval contract binding changed");
  assertCondition(retrieval.fixture_file_sha256 === FROZEN_STAGE1_IDENTITIES.frozen_input.file_sha256, "retrieval frozen-input binding changed");
  assertCondition(acceptance.fixture_file_sha256 === FROZEN_STAGE1_IDENTITIES.frozen_input.file_sha256, "acceptance frozen-input binding changed");
  assertCondition(acceptance.retrieval_payload_sha256 === FROZEN_STAGE1_IDENTITIES.retrieval_packets.payload_sha256, "acceptance retrieval binding changed");

  const acceptanceTaskIds = acceptance.tasks.map((task) => task.task_id);
  const frozenTaskIds = frozenInput.tasks.map((task) => task.task_id);
  const retrievalTaskIds = retrieval.packets.map((packet) => packet.task_id);
  assertCondition(canonicalJson(retrievalTaskIds) === canonicalJson(frozenTaskIds), "retrieval task order or identity changed");
  assertCondition(canonicalJson(acceptanceTaskIds) === canonicalJson(frozenTaskIds), "acceptance task order or identity changed");
  return { frozenInput, contract, retrieval, acceptance };
}

export function buildStage2Bridge({ paths = DEFAULT_STAGE1_PATHS } = {}) {
  const { frozenInput, contract, retrieval } = validateInputs(paths);
  const rendererContract = contract.model_facing_packet_contract;
  assertCondition(rendererContract?.enabled_by_default === false, "renderer is not default-off");
  const frames = [];
  const tasks = frozenInput.tasks.map((task, index) => {
    const packet = retrieval.packets[index];
    assertCondition(packet.task_id === task.task_id, `task mismatch at ordinal ${index + 1}`);
    assertCondition(packet.repo === task.repo, `${task.task_id} repository changed`);
    assertCondition(packet.base_commit === task.base_commit, `${task.task_id} commit changed`);
    assertCondition(packet.index_sha256 === task.index_sha256, `${task.task_id} index hash changed`);
    assertCondition(packet.query_sha256 === task.issue.sha256, `${task.task_id} issue bytes do not match retrieval query`);
    const frame = renderUntrustedRetrievalPacket(packet);
    const parsed = parseFrame(frame, rendererContract);
    assertCondition(parsed.decoded.task_id === task.task_id, `${task.task_id} frame task binding changed`);
    assertCondition(parsed.decoded.repo === task.repo, `${task.task_id} frame repository binding changed`);
    assertCondition(parsed.decoded.base_commit === task.base_commit, `${task.task_id} frame commit binding changed`);
    assertCondition(parsed.decoded.query_sha256 === task.issue.sha256, `${task.task_id} frame issue binding changed`);
    const filename = `treatment-frame-${String(index + 1).padStart(2, "0")}.txt`;
    frames.push({ filename, frame });
    return {
      ordinal: index + 1,
      task_id: task.task_id,
      issue_id: task.original_issue_id,
      repository: task.repo,
      base_commit: task.base_commit,
      repository_root_tree_git_oid: task.repository_root_tree_git_oid,
      index_sha256: task.index_sha256,
      issue_text: {
        utf8_bytes: task.issue.bytes,
        sha256: task.issue.sha256
      },
      source_row_sha256: task.row_canonical_sha256,
      source_csv_row_sha256: task.csv_row_canonical_sha256,
      treatment_frame: {
        repository_relative_output_path: filename,
        file_sha256: sha256Bytes(frame),
        frame_utf8_bytes: Buffer.byteLength(frame, "utf8"),
        base64_utf8_bytes: parsed.base64_utf8_bytes,
        decoded_payload_utf8_bytes: parsed.payload_utf8_bytes,
        decoded_payload_sha256: parsed.payload_sha256,
        maximum_frame_utf8_bytes: MODEL_FACING_LIMITS.frame_utf8_bytes,
        maximum_decoded_payload_utf8_bytes: MODEL_FACING_LIMITS.decoded_payload_utf8_bytes
      }
    };
  });
  assertCondition(frames.length === 5, "bridge did not create exactly five treatment frames");

  const manifest = {
    schema_version: 1,
    artifact_type: "wo047_stage2_frozen_input_bridge",
    profile: "benchmark_only_default_off_offline_preparation",
    freeze_id: "wo047-stage2-bridge-v1",
    consumer_contract: {
      consumer: "AgentStackBench",
      schema_name: "wo047_neutral_paired_frozen_input_v1",
      task_join_key: "task_id",
      task_order: "manifest ordinal ascending",
      issue_bytes_contract: "consumer supplies the exact issue bytes matching issue_text.sha256 and issue_text.utf8_bytes to both arms",
      treatment_delivery_contract: "consumer appends the exact bound treatment-frame file bytes as immutable untrusted data only to two-pass-retrieval",
      fail_closed_on_identity_or_hash_mismatch: true
    },
    experiment_contract: {
      task_count: 5,
      arm_count: 2,
      authorized_solution_calls: 10,
      attempts_per_task_arm: 1,
      retry_allowed: false,
      fallback_allowed: false,
      arm_substitution_allowed: false,
      post_freeze_mutation_allowed: false,
      symmetric_pair_invalidation: true,
      launch_status: "not_launched"
    },
    arms: [
      {
        arm_id: "issue-text-only",
        role: "control",
        receives_exact_issue_text: true,
        receives_bound_repository: true,
        receives_cortex_packet: false,
        cortex_tools_available: false,
        cortex_retrieval_tools_available: false
      },
      {
        arm_id: "two-pass-retrieval",
        role: "treatment",
        receives_exact_issue_text: true,
        receives_bound_repository: true,
        receives_cortex_packet: true,
        cortex_tools_available: false,
        cortex_retrieval_tools_available: false,
        packet_delivery: "exact treatment_frame bytes bound per task"
      }
    ],
    source_artifacts: [
      sourceBinding("stage1_frozen_input", paths.frozen_input, FROZEN_STAGE1_IDENTITIES.frozen_input),
      sourceBinding("stage1_retrieval_contract", paths.retrieval_contract, FROZEN_STAGE1_IDENTITIES.retrieval_contract),
      sourceBinding("stage1_retrieval_packets", paths.retrieval_packets, FROZEN_STAGE1_IDENTITIES.retrieval_packets),
      sourceBinding("stage1_offline_acceptance", paths.offline_acceptance, FROZEN_STAGE1_IDENTITIES.offline_acceptance),
      sourceBinding("stage1_renderer_module", paths.renderer_module, FROZEN_STAGE1_IDENTITIES.renderer_module)
    ],
    renderer_identity: {
      module_repository_relative_path: relativeSourcePath(paths.renderer_module),
      module_file_sha256: FROZEN_STAGE1_IDENTITIES.renderer_module.file_sha256,
      export_name: FROZEN_STAGE1_IDENTITIES.renderer_module.export_name,
      function_source_sha256: FROZEN_STAGE1_IDENTITIES.renderer_module.function_source_sha256,
      function_source_utf8_bytes: FROZEN_STAGE1_IDENTITIES.renderer_module.function_source_utf8_bytes,
      renderer_version: rendererContract.renderer_version,
      renderer_contract_canonical_sha256: sha256Bytes(canonicalJson(rendererContract)),
      bridge_module_repository_relative_path: relativeSourcePath(BRIDGE_MODULE_PATH),
      bridge_module_file_sha256: sha256File(BRIDGE_MODULE_PATH),
      limits: MODEL_FACING_LIMITS
    },
    answer_metric_policy: ANSWER_METRIC_POLICY,
    tasks,
    counters: {
      planner_calls: 0,
      solution_model_calls: 0,
      provider_calls: 0,
      stage2_invocations_run: 0,
      treatment_frames_created: 5,
      control_frames_created: 0
    }
  };
  assertNoExportedEvaluationKeys(manifest, "bridge manifest");
  manifest.bridge_payload_sha256 = sha256Bytes(canonicalJson(manifest));
  return { manifest, frames };
}

export function writeStage2Bridge(outputDir, options = {}) {
  const resolvedOutput = path.resolve(outputDir);
  assertCondition(!fs.existsSync(resolvedOutput), `output already exists: ${resolvedOutput}`);
  const { manifest, frames } = buildStage2Bridge(options);
  fs.mkdirSync(resolvedOutput, { recursive: false, mode: 0o700 });
  for (const { filename, frame } of frames) {
    fs.writeFileSync(path.join(resolvedOutput, filename), frame, { encoding: "utf8", mode: 0o600, flag: "wx" });
  }
  const manifestPath = path.join(resolvedOutput, "bridge-manifest-v1.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return {
    manifest,
    frames,
    output_dir: resolvedOutput,
    manifest_file_sha256: sha256File(manifestPath)
  };
}

function parseCli(argv) {
  assertCondition(argv.length === 2 && argv[0] === "--output-dir" && argv[1], "usage: wo047-stage2-bridge.mjs --output-dir <new-directory>");
  return { outputDir: argv[1] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === BRIDGE_MODULE_PATH) {
  const { outputDir } = parseCli(process.argv.slice(2));
  const result = writeStage2Bridge(outputDir);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    output_dir: result.output_dir,
    manifest_payload_sha256: result.manifest.bridge_payload_sha256,
    manifest_file_sha256: result.manifest_file_sha256,
    treatment_frames_created: result.frames.length,
    control_frames_created: 0,
    planner_calls: 0,
    solution_model_calls: 0,
    provider_calls: 0,
    stage2_invocations_run: 0,
    launch_status: "not_launched"
  })}\n`);
}
