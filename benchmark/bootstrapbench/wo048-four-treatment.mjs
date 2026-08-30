#!/usr/bin/env node

/**
 * WO-048 deterministic offline retrieval and treatment-frame bridge.
 *
 * This wrapper applies the byte-bound WO-047 retrieval and renderer exports
 * unchanged to the four issue-quality-pass tasks in the immutable WO-048
 * fixture. It creates no control input and performs no planner, model,
 * provider, or agent call.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXPECTED_CONTRACT_FILE_SHA256,
  MODEL_FACING_LIMITS,
  canonicalJson,
  loadAndValidateContract,
  loadAndValidatePacketSet,
  renderUntrustedRetrievalPacket,
  retrieveTask
} from "./wo047-two-pass-subsystem.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const MODULE_PATH = fileURLToPath(import.meta.url);
const CORE_PATH = path.join(HERE, "wo047-two-pass-subsystem.mjs");

export const DEFAULT_WO048_PATHS = Object.freeze({
  fixture: path.join(HERE, "fixtures/wo048-clean-five-v1/frozen-fixture-v1.json"),
  contract: path.join(HERE, "wo047-two-pass-contract-v1.json"),
  core_module: CORE_PATH
});

export const FROZEN_WO048_IDENTITIES = Object.freeze({
  fixture: Object.freeze({
    file_sha256: "ec9788b14c5bd3ec9bb5c794a2c28f361bb97cf774f2410b9e73bf80a2902b0b",
    payload_sha256: "e6d4b5c22c27da0d83d062177df1cd63cd7514a2dd445179d7bce3746e0857ad"
  }),
  retrieval_contract: Object.freeze({ file_sha256: EXPECTED_CONTRACT_FILE_SHA256 }),
  wo047_core: Object.freeze({
    file_sha256: "e5f315a2def57d9793e12e60aecb8b05c5b1c0faecf8982b8732d495ed453847",
    retrieve_export: "retrieveTask",
    retrieve_function_source_sha256: "4b5c379e1de3300859d903516be2c3a4783619cd359e99f7a760a8fd4749935d",
    retrieve_function_source_utf8_bytes: 3222,
    renderer_export: "renderUntrustedRetrievalPacket",
    renderer_function_source_sha256: "0f803cc04d3dc469e800545621ba326484515bd539ed6d20a651ccfb090f6a2d",
    renderer_function_source_utf8_bytes: 10483
  })
});

export const FROZEN_WO048_TASK_IDS = Object.freeze([
  "SWE-PolyBench__javascript__maintenance__bugfix__10ab7842",
  "SWE-PolyBench__typescript__maintenance__bugfix__4f3cb6be",
  "SWE-Bench-Verified__python__maintenance__bugfix__27320d49",
  "SWE-Bench-Verified__python__maintenance__bugfix__ac705f35"
]);

const EXCLUDED_VULS_TASK_ID = "SWE-Bench-Pro__go__maintenance__bugfix__720b4d92";
const FORBIDDEN_MODEL_KEYS = new Set([
  "evaluator", "evaluator_judgments", "expected_fix", "fixture", "gold",
  "gold_context", "gold_files", "gold_patch", "mechanism_rubric", "oracle",
  "primary_runtime_files", "regression_test_surfaces", "score", "test_patch"
]);
const RELATION_FILE_TYPES = new Map([
  ["relations.calls.jsonl", "CALLS"],
  ["relations.imports.jsonl", "IMPORTS"],
  ["relations.exports.jsonl", "EXPORTS"],
  ["relations.contains.jsonl", "CONTAINS"],
  ["relations.contains_module.jsonl", "CONTAINS_MODULE"],
  ["relations.defines.jsonl", "DEFINES"],
  ["relations.includes_file.jsonl", "INCLUDES_FILE"]
]);
const RELATION_PRIORITY = new Map([
  ["CALLS", 0], ["EXPORTS", 1], ["IMPORTS", 2], ["DEFINES", 3],
  ["CONTAINS", 4], ["CONTAINS_MODULE", 5], ["INCLUDES_FILE", 6]
]);

function fail(message) {
  throw new Error(`WO-048 four-treatment violation: ${message}`);
}

function assertCondition(condition, message) {
  if (!condition) fail(message);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return sha256Bytes(fs.readFileSync(filePath));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) return [];
  return raw.split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      fail(`invalid JSONL at ${filePath}:${index + 1}: ${error.message}`);
    }
  });
}

function validateRelativePath(value) {
  assertCondition(typeof value === "string" && value.length > 0, "empty repository path");
  assertCondition(!value.includes("\0") && !value.includes("\\"), `unsafe repository path ${value}`);
  assertCondition(!path.posix.isAbsolute(value), `absolute repository path ${value}`);
  const normalized = path.posix.normalize(value);
  assertCondition(normalized === value && !normalized.startsWith("../"), `non-canonical repository path ${value}`);
  return normalized;
}

function relativeSourcePath(filePath) {
  const relative = path.relative(REPO_ROOT, filePath);
  assertCondition(relative && !relative.startsWith("..") && !path.isAbsolute(relative), `source path escapes repository: ${filePath}`);
  return relative.split(path.sep).join("/");
}

function assertNoEvaluationKeys(value, label = "artifact") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoEvaluationKeys(entry, `${label}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    assertCondition(!FORBIDDEN_MODEL_KEYS.has(key), `${label} contains forbidden field ${key}`);
    assertNoEvaluationKeys(entry, `${label}.${key}`);
  }
}

export function utf8PrefixAtByteLimit(value, maximumBytes = MODEL_FACING_LIMITS.string_utf8_bytes) {
  assertCondition(typeof value === "string", "model-facing content is not a string");
  assertCondition(Number.isSafeInteger(maximumBytes) && maximumBytes >= 0, "model-facing byte limit is invalid");
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maximumBytes) return value;
  let end = maximumBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  const prefix = bytes.subarray(0, end).toString("utf8");
  assertCondition(Buffer.byteLength(prefix, "utf8") <= maximumBytes, "UTF-8 prefix exceeds model-facing byte limit");
  return prefix;
}

export function projectPacketForModelFrame(packet) {
  const projected = structuredClone(packet);
  for (const result of projected.final_results) {
    if ((result.selected_by_pass ?? 0) !== 0) continue;
    const originalBytes = Buffer.byteLength(result.content_supplied, "utf8");
    const supplied = utf8PrefixAtByteLimit(result.content_supplied);
    const suppliedBytes = Buffer.byteLength(supplied, "utf8");
    if (suppliedBytes === originalBytes) continue;
    result.content_supplied = supplied;
    result.content_supplied_sha256 = sha256Bytes(supplied);
    result.content_supplied_utf8_bytes = suppliedBytes;
    result.content_omitted_utf8_bytes = result.content_full_utf8_bytes - suppliedBytes;
    result.content_truncated = true;
    result.content_excerpt_strategy = `${result.content_excerpt_strategy}+wo048_model_utf8_prefix_${MODEL_FACING_LIMITS.string_utf8_bytes}`;
  }
  return projected;
}

function loadFixture(paths) {
  assertCondition(sha256File(paths.fixture) === FROZEN_WO048_IDENTITIES.fixture.file_sha256, "fixture file hash changed");
  const fixture = readJson(paths.fixture);
  const payload = structuredClone(fixture);
  delete payload.fixture_payload_sha256;
  assertCondition(fixture.fixture_payload_sha256 === FROZEN_WO048_IDENTITIES.fixture.payload_sha256, "fixture claimed payload hash changed");
  assertCondition(sha256Bytes(canonicalJson(payload)) === FROZEN_WO048_IDENTITIES.fixture.payload_sha256, "fixture canonical payload hash changed");
  assertCondition(fixture.tasks?.length === 5, "immutable fixture cardinality changed");
  assertCondition(fixture.quality_summary?.passing_task_count === 4, "issue-quality pass count changed");
  assertCondition(canonicalJson(fixture.quality_summary?.failing_task_ids) === canonicalJson([EXCLUDED_VULS_TASK_ID]), "issue-quality failure identity changed");
  const tasksById = new Map(fixture.tasks.map((task) => [task.task_id, task]));
  const selected = FROZEN_WO048_TASK_IDS.map((taskId) => {
    const task = tasksById.get(taskId);
    assertCondition(task, `selected task missing: ${taskId}`);
    assertCondition(task.issue_description_quality?.passes === true, `selected task does not pass issue-quality screen: ${taskId}`);
    const issueBytes = Buffer.from(task.issue.base64, "base64");
    assertCondition(issueBytes.length === task.issue.bytes, `issue byte count changed: ${taskId}`);
    assertCondition(sha256Bytes(issueBytes) === task.issue.sha256, `issue hash changed: ${taskId}`);
    return { fixtureTask: task, issueBytes };
  });
  assertCondition(tasksById.get(EXCLUDED_VULS_TASK_ID)?.issue_description_quality?.passes === false, "Vuls exclusion no longer holds");
  return { fixture, selected };
}

// Byte-for-byte behavioral copy of WO-047's private frozen-index loader. The
// retrieval algorithm itself remains the imported, hash-bound retrieveTask.
function loadFrozenTaskIndex(task, contract) {
  const cache = path.join(task.frozen_index_root, ".context/cache");
  const files = readJsonl(path.join(cache, "entities.file.jsonl"));
  const chunks = readJsonl(path.join(cache, "entities.chunk.jsonl"));
  const modules = readJsonl(path.join(cache, "entities.module.jsonl"));
  const projects = readJsonl(path.join(cache, "entities.project.jsonl"));
  const filesById = new Map(files.map((file) => [file.id, file]));
  const entities = [];
  const entitiesById = new Map();
  const pathsByEntity = new Map();

  for (const file of files) {
    if (file.status === "deprecated") continue;
    const filePath = validateRelativePath(file.path);
    const entity = { ...file, type: "File", path: filePath, name: filePath };
    entities.push(entity);
    entitiesById.set(entity.id, entity);
    pathsByEntity.set(entity.id, filePath);
  }
  for (const chunk of chunks) {
    if (chunk.status === "deprecated") continue;
    const owner = filesById.get(chunk.file_id);
    if (!owner) continue;
    const filePath = validateRelativePath(owner.path);
    const entity = { ...chunk, type: "Chunk", path: filePath, owner_kind: owner.kind };
    entities.push(entity);
    entitiesById.set(entity.id, entity);
    pathsByEntity.set(entity.id, filePath);
  }
  for (const module of modules) {
    if (module.status === "deprecated" || !module.path) continue;
    const modulePath = validateRelativePath(module.path);
    const entity = { ...module, type: "Module", path: modulePath };
    entities.push(entity);
    entitiesById.set(entity.id, entity);
    pathsByEntity.set(entity.id, modulePath);
  }
  for (const project of projects) {
    if (project.status === "deprecated" || !project.path || project.path === ".") continue;
    const projectPath = validateRelativePath(project.path);
    const entity = { ...project, type: "Project", path: projectPath };
    entities.push(entity);
    entitiesById.set(entity.id, entity);
    pathsByEntity.set(entity.id, projectPath);
  }

  const relations = [];
  for (const [fileName, relation] of RELATION_FILE_TYPES) {
    if (!contract.reviewed_relations.includes(relation)) continue;
    for (const row of readJsonl(path.join(cache, fileName))) {
      if (!row.from || !row.to) continue;
      relations.push({
        from: String(row.from),
        to: String(row.to),
        relation,
        note: String(row.note ?? row.call_type ?? row.import_name ?? "")
      });
    }
  }
  relations.sort((left, right) =>
    compareText(left.from, right.from) ||
    (RELATION_PRIORITY.get(left.relation) ?? 99) - (RELATION_PRIORITY.get(right.relation) ?? 99) ||
    compareText(left.to, right.to) ||
    compareText(left.note, right.note)
  );
  return { entities, entitiesById, pathsByEntity, relations };
}

function parseFrame(frame, rendererContract) {
  const lines = frame.split("\n");
  assertCondition(lines.length === 8, "renderer frame line count changed");
  assertCondition(lines[0] === rendererContract.untrusted_data_directive, "renderer directive changed");
  assertCondition(lines[1] === rendererContract.frame_open && lines[7] === rendererContract.frame_close, "renderer delimiter changed");
  const payloadBytes = Number(lines[4].replace(/^payload_bytes=/u, ""));
  const payloadSha256 = lines[5].replace(/^payload_sha256=/u, "");
  const decodedBytes = Buffer.from(lines[6], "base64");
  assertCondition(decodedBytes.length === payloadBytes, "frame payload byte declaration changed");
  assertCondition(sha256Bytes(decodedBytes) === payloadSha256, "frame payload hash changed");
  assertCondition(Buffer.byteLength(frame, "utf8") <= MODEL_FACING_LIMITS.frame_utf8_bytes, "frame exceeds frozen byte bound");
  assertCondition(decodedBytes.length <= MODEL_FACING_LIMITS.decoded_payload_utf8_bytes, "decoded frame exceeds frozen byte bound");
  const decoded = JSON.parse(decodedBytes.toString("utf8"));
  assertNoEvaluationKeys(decoded, "decoded treatment frame");
  return { decoded, payloadBytes, payloadSha256, base64Bytes: Buffer.byteLength(lines[6], "utf8") };
}

function primaryOwnerScore(selectedFixture, packets, frozenBridgeHash) {
  const tasks = selectedFixture.map(({ fixtureTask }) => {
    const packet = packets.find((entry) => entry.task_id === fixtureTask.task_id);
    const firstRankByPath = new Map();
    packet.final_results.forEach((result, index) => {
      if (!firstRankByPath.has(result.path)) firstRankByPath.set(result.path, index + 1);
    });
    const ranks = fixtureTask.primary_runtime_files.map((owner) => firstRankByPath.get(owner.path) ?? null);
    return {
      task_id: fixtureTask.task_id,
      primary_owners_found: ranks.filter((rank) => rank !== null).length,
      primary_owners_total: ranks.length,
      primary_owner_recall: Number((ranks.filter((rank) => rank !== null).length / ranks.length).toFixed(6)),
      first_primary_owner_rank: ranks.filter((rank) => rank !== null).sort((left, right) => left - right)[0] ?? null
    };
  });
  const found = tasks.reduce((sum, task) => sum + task.primary_owners_found, 0);
  const total = tasks.reduce((sum, task) => sum + task.primary_owners_total, 0);
  const score = {
    schema_version: 1,
    artifact_type: "wo048_four_treatment_primary_owner_score",
    evaluated_only_after_treatment_frame_freeze: true,
    frozen_bridge_payload_sha256: frozenBridgeHash,
    tasks,
    aggregate: {
      primary_owners_found: found,
      primary_owners_total: total,
      primary_owner_recall: Number((found / total).toFixed(6)),
      zero_owner_task_count: tasks.filter((task) => task.primary_owners_found === 0).length
    },
    counters: { planner_calls: 0, solution_model_calls: 0, provider_calls: 0, solution_agents_launched: 0 }
  };
  score.score_payload_sha256 = sha256Bytes(canonicalJson(score));
  return score;
}

function verifyCoreIdentity(paths) {
  assertCondition(sha256File(paths.core_module) === FROZEN_WO048_IDENTITIES.wo047_core.file_sha256, "WO-047 core module hash changed");
  for (const [role, fn, hashKey, bytesKey] of [
    ["retrieveTask", retrieveTask, "retrieve_function_source_sha256", "retrieve_function_source_utf8_bytes"],
    ["renderUntrustedRetrievalPacket", renderUntrustedRetrievalPacket, "renderer_function_source_sha256", "renderer_function_source_utf8_bytes"]
  ]) {
    const source = fn.toString();
    assertCondition(sha256Bytes(source) === FROZEN_WO048_IDENTITIES.wo047_core[hashKey], `${role} function source hash changed`);
    assertCondition(Buffer.byteLength(source, "utf8") === FROZEN_WO048_IDENTITIES.wo047_core[bytesKey], `${role} function source size changed`);
  }
}

export function buildWo048FourTreatment({ paths = DEFAULT_WO048_PATHS } = {}) {
  verifyCoreIdentity(paths);
  assertCondition(sha256File(paths.contract) === FROZEN_WO048_IDENTITIES.retrieval_contract.file_sha256, "retrieval contract hash changed");
  const contractBinding = loadAndValidateContract(paths.contract);
  const { fixture, selected } = loadFixture(paths);
  const sanitizedFixture = {
    tasks: selected.map(({ fixtureTask }) => ({
      task_id: fixtureTask.task_id,
      base_commit: fixtureTask.base_commit,
      repository_root_tree_git_oid: fixtureTask.repository_root_tree_git_oid,
      index_sha256: fixtureTask.index_sha256,
      issue: { bytes: fixtureTask.issue.bytes, sha256: fixtureTask.issue.sha256 }
    }))
  };
  assertNoEvaluationKeys(sanitizedFixture, "retrieval fixture projection");
  const packetSetBinding = loadAndValidatePacketSet(contractBinding.contract, sanitizedFixture);
  const packets = packetSetBinding.selected.map(({ task, baselinePacket }) =>
    retrieveTask({ task, baselinePacket, index: loadFrozenTaskIndex(task, contractBinding.contract), contract: contractBinding.contract })
  );

  const retrievalArtifact = {
    schema_version: 1,
    artifact_type: "wo048_four_treatment_retrieval_packets",
    profile: "benchmark_only_default_off_offline",
    task_ids: FROZEN_WO048_TASK_IDS,
    source_fixture_file_sha256: FROZEN_WO048_IDENTITIES.fixture.file_sha256,
    source_fixture_payload_sha256: FROZEN_WO048_IDENTITIES.fixture.payload_sha256,
    retrieval_contract_file_sha256: contractBinding.file_sha256,
    source_packet_set_file_sha256: packetSetBinding.file_sha256,
    wo047_core_module_file_sha256: FROZEN_WO048_IDENTITIES.wo047_core.file_sha256,
    packets,
    counters: { planner_calls: 0, solution_model_calls: 0, provider_calls: 0, solution_agents_launched: 0 },
    launch_status: "not_launched"
  };
  assertNoEvaluationKeys(retrievalArtifact, "retrieval artifact");
  retrievalArtifact.retrieval_payload_sha256 = sha256Bytes(canonicalJson(retrievalArtifact));

  const rendererContract = contractBinding.contract.model_facing_packet_contract;
  const frames = [];
  const issueSources = [];
  const manifestTasks = selected.map(({ fixtureTask, issueBytes }, index) => {
    const packet = packets[index];
    const modelPacket = projectPacketForModelFrame(packet);
    const frame = renderUntrustedRetrievalPacket(modelPacket);
    const parsed = parseFrame(frame, rendererContract);
    assertCondition(parsed.decoded.task_id === fixtureTask.task_id, `${fixtureTask.task_id} frame task binding changed`);
    assertCondition(parsed.decoded.repo === fixtureTask.repo, `${fixtureTask.task_id} frame repository binding changed`);
    assertCondition(parsed.decoded.base_commit === fixtureTask.base_commit, `${fixtureTask.task_id} frame commit binding changed`);
    assertCondition(parsed.decoded.index_sha256 === fixtureTask.index_sha256, `${fixtureTask.task_id} frame index binding changed`);
    assertCondition(parsed.decoded.query_sha256 === fixtureTask.issue.sha256, `${fixtureTask.task_id} frame issue binding changed`);
    const ordinal = String(index + 1).padStart(2, "0");
    const issueFilename = `issue-text-${ordinal}.txt`;
    const frameFilename = `treatment-frame-${ordinal}.txt`;
    frames.push({ filename: frameFilename, frame });
    issueSources.push({ filename: issueFilename, bytes: issueBytes });
    const selectedInput = packetSetBinding.selected[index];
    return {
      ordinal: index + 1,
      task_id: fixtureTask.task_id,
      issue_id: fixtureTask.original_issue_id,
      repository: fixtureTask.repo,
      base_commit: fixtureTask.base_commit,
      repository_root_tree_git_oid: fixtureTask.repository_root_tree_git_oid,
      index_sha256: fixtureTask.index_sha256,
      task_input_binding_sha256: fixtureTask.task_input_binding_sha256,
      source_row_sha256: fixtureTask.row_canonical_sha256,
      source_csv_row_sha256: fixtureTask.csv_row_canonical_sha256,
      frozen_baseline_file_sha256: selectedInput.baselinePacketFileSha256,
      exact_agent_prompt_source_paths: [issueFilename, frameFilename],
      issue_text_source: {
        repository_relative_output_path: issueFilename,
        utf8_bytes: issueBytes.length,
        file_sha256: sha256Bytes(issueBytes)
      },
      treatment_frame: {
        repository_relative_output_path: frameFilename,
        file_sha256: sha256Bytes(frame),
        frame_utf8_bytes: Buffer.byteLength(frame, "utf8"),
        base64_utf8_bytes: parsed.base64Bytes,
        decoded_payload_utf8_bytes: parsed.payloadBytes,
        decoded_payload_sha256: parsed.payloadSha256,
        maximum_frame_utf8_bytes: MODEL_FACING_LIMITS.frame_utf8_bytes,
        maximum_decoded_payload_utf8_bytes: MODEL_FACING_LIMITS.decoded_payload_utf8_bytes
      }
    };
  });
  assertCondition(frames.length === 4 && issueSources.length === 4, "did not create exactly four treatment inputs");

  const manifest = {
    schema_version: 1,
    artifact_type: "wo048_four_treatment_frozen_bridge",
    profile: "treatment_only_default_off_offline_preparation",
    freeze_id: "wo048-four-treatment-v1",
    task_count: 4,
    control_arm_present: false,
    prompt_assembly_status: "not_assembled",
    prompt_source_contract: "for a separately authorized future treatment agent, use the exact issue-text file bytes followed by the exact treatment-frame file bytes; no prompt or agent run is created here",
    source_artifacts: [
      { role: "immutable_wo048_fixture", repository_relative_path: relativeSourcePath(paths.fixture), ...FROZEN_WO048_IDENTITIES.fixture },
      { role: "wo047_retrieval_contract", repository_relative_path: relativeSourcePath(paths.contract), file_sha256: contractBinding.file_sha256 },
      { role: "wo045_frozen_packet_set", locator: contractBinding.contract.source_packet_set.locator, file_sha256: packetSetBinding.file_sha256 },
      { role: "wo047_retrieval_and_renderer_core", repository_relative_path: relativeSourcePath(paths.core_module), file_sha256: FROZEN_WO048_IDENTITIES.wo047_core.file_sha256 }
    ],
    algorithm_identity: {
      parameters: contractBinding.contract.parameters,
      reviewed_relations: contractBinding.contract.reviewed_relations,
      non_runtime_proof_relations: contractBinding.contract.non_runtime_proof_relations,
      path_exclusion_components: contractBinding.contract.path_exclusion_components,
      path_exclusion_prefixes: contractBinding.contract.path_exclusion_prefixes,
      ordering: contractBinding.contract.ordering,
      model_facing_content_projection: {
        scope: "model-facing frame copy only; full retrieval artifact remains unchanged",
        policy: "deterministic valid-UTF-8 prefix for Pass-0 content_supplied values above the frozen per-string limit",
        maximum_utf8_bytes: MODEL_FACING_LIMITS.string_utf8_bytes,
        ranking_paths_selection_and_scoring_changed: false,
        truncated_records_marked_content_truncated: true
      },
      retrieve_export: FROZEN_WO048_IDENTITIES.wo047_core.retrieve_export,
      retrieve_function_source_sha256: FROZEN_WO048_IDENTITIES.wo047_core.retrieve_function_source_sha256,
      retrieve_function_source_utf8_bytes: FROZEN_WO048_IDENTITIES.wo047_core.retrieve_function_source_utf8_bytes,
      renderer_export: FROZEN_WO048_IDENTITIES.wo047_core.renderer_export,
      renderer_function_source_sha256: FROZEN_WO048_IDENTITIES.wo047_core.renderer_function_source_sha256,
      renderer_function_source_utf8_bytes: FROZEN_WO048_IDENTITIES.wo047_core.renderer_function_source_utf8_bytes,
      renderer_version: rendererContract.renderer_version,
      limits: MODEL_FACING_LIMITS
    },
    retrieval_artifact: {
      repository_relative_output_path: "retrieval-packets-v1.json",
      canonical_payload_sha256: retrievalArtifact.retrieval_payload_sha256
    },
    tasks: manifestTasks,
    counters: {
      planner_calls: 0,
      solution_model_calls: 0,
      provider_calls: 0,
      solution_agents_launched: 0,
      treatment_frames_created: 4,
      control_frames_created: 0
    },
    launch_status: "not_launched"
  };
  assertNoEvaluationKeys(manifest, "bridge manifest");
  manifest.bridge_payload_sha256 = sha256Bytes(canonicalJson(manifest));

  // Evaluator-only primary-owner counts are computed only after all four frame
  // bytes and the bridge payload have been frozen. No owner path is exported.
  const score = primaryOwnerScore(selected, packets, manifest.bridge_payload_sha256);
  return { fixture, retrievalArtifact, manifest, score, frames, issueSources };
}

export function writeWo048FourTreatment(outputDir, options = {}) {
  const resolved = path.resolve(outputDir);
  assertCondition(!fs.existsSync(resolved), `output already exists: ${resolved}`);
  const built = buildWo048FourTreatment(options);
  fs.mkdirSync(resolved, { recursive: false, mode: 0o700 });
  for (const source of built.issueSources) fs.writeFileSync(path.join(resolved, source.filename), source.bytes, { mode: 0o600, flag: "wx" });
  for (const frame of built.frames) fs.writeFileSync(path.join(resolved, frame.filename), frame.frame, { encoding: "utf8", mode: 0o600, flag: "wx" });
  for (const [filename, value] of [
    ["retrieval-packets-v1.json", built.retrievalArtifact],
    ["bridge-manifest-v1.json", built.manifest],
    ["primary-owner-score-v1.json", built.score]
  ]) fs.writeFileSync(path.join(resolved, filename), `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return {
    ...built,
    output_dir: resolved,
    manifest_file_sha256: sha256File(path.join(resolved, "bridge-manifest-v1.json")),
    retrieval_file_sha256: sha256File(path.join(resolved, "retrieval-packets-v1.json")),
    score_file_sha256: sha256File(path.join(resolved, "primary-owner-score-v1.json"))
  };
}

function parseCli(argv) {
  assertCondition(argv.length === 2 && argv[0] === "--output-dir" && argv[1], "usage: wo048-four-treatment.mjs --output-dir <new-directory>");
  return { outputDir: argv[1] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === MODULE_PATH) {
  const { outputDir } = parseCli(process.argv.slice(2));
  const result = writeWo048FourTreatment(outputDir);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    output_dir: result.output_dir,
    retrieval_payload_sha256: result.retrievalArtifact.retrieval_payload_sha256,
    bridge_payload_sha256: result.manifest.bridge_payload_sha256,
    score_payload_sha256: result.score.score_payload_sha256,
    treatment_frames_created: 4,
    control_frames_created: 0,
    planner_calls: 0,
    solution_model_calls: 0,
    provider_calls: 0,
    solution_agents_launched: 0,
    launch_status: "not_launched"
  })}\n`);
}
