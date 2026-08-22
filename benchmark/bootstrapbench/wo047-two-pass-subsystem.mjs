#!/usr/bin/env node

/**
 * WO-047 deterministic, benchmark-only two-pass subsystem retrieval.
 *
 * This module is intentionally not imported by the production MCP runtime.
 * It consumes frozen WO-045 task indexes and baseline packets, performs no
 * network/model/planner calls, and keeps evaluator-only judgments out of the
 * retrieval functions.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
export const DEFAULT_CONTRACT_PATH = path.join(HERE, "wo047-two-pass-contract-v1.json");
export const EXPECTED_CONTRACT_FILE_SHA256 = "bc79202564c1545e20a8fa9725f48c5d181e291958dc80381e43f4344d60e172";

const FROZEN_PARAMETERS = Object.freeze({
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
export const MODEL_FACING_LIMITS = Object.freeze({
  string_utf8_bytes: FROZEN_PARAMETERS.final_result_max * FROZEN_PARAMETERS.estimated_token_divisor * FROZEN_PARAMETERS.definition_limit,
  record_utf8_bytes: FROZEN_PARAMETERS.final_result_max * FROZEN_PARAMETERS.estimated_token_divisor * FROZEN_PARAMETERS.definition_limit * FROZEN_PARAMETERS.graph_depth,
  audit_graph_records: FROZEN_PARAMETERS.final_result_max * FROZEN_PARAMETERS.subsystem_anchor_limit,
  diagnostic_fields: FROZEN_PARAMETERS.final_result_max,
  decoded_payload_utf8_bytes: FROZEN_PARAMETERS.final_result_max * FROZEN_PARAMETERS.final_result_max * FROZEN_PARAMETERS.estimated_token_divisor * FROZEN_PARAMETERS.definition_limit * FROZEN_PARAMETERS.graph_depth,
  frame_utf8_bytes:
    4 * Math.ceil((FROZEN_PARAMETERS.final_result_max * FROZEN_PARAMETERS.final_result_max * FROZEN_PARAMETERS.estimated_token_divisor * FROZEN_PARAMETERS.definition_limit * FROZEN_PARAMETERS.graph_depth) / 3) +
    FROZEN_PARAMETERS.final_result_max * FROZEN_PARAMETERS.estimated_token_divisor * FROZEN_PARAMETERS.definition_limit * FROZEN_PARAMETERS.graph_depth
});
const FROZEN_PATH_EXCLUSION_COMPONENTS = Object.freeze([
  ".context", ".git", "__pycache__", "build", "coverage", "dist", "generated",
  "node_modules", "target", "vendor"
]);
const FROZEN_PATH_EXCLUSION_PREFIXES = Object.freeze([
  "benchmark/bootstrapbench/results/", "results/run_suites/"
]);
const FROZEN_REVIEWED_RELATIONS = Object.freeze([
  "CALLS", "IMPORTS", "EXPORTS", "CONTAINS", "CONTAINS_MODULE", "DEFINES", "INCLUDES_FILE"
]);
const FROZEN_NON_RUNTIME_PROOF_RELATIONS = Object.freeze(["PART_OF"]);
const FROZEN_ORDERING = Object.freeze([
  "pass0 baseline records retain their exact source order",
  "exact symbol matches precede baseline-owner symbol candidates",
  "shorter graph distance precedes relation priority",
  "higher deterministic lexical score precedes lower score",
  "UTF-16-code-unit path order then entity-id order breaks every remaining tie"
]);
const FROZEN_PROVIDER_BOUNDARY = Object.freeze({
  planner_calls: 0,
  solution_model_calls: 0,
  provider_calls: 0,
  model_generated_queries: false
});
const FROZEN_TEST_PATH_CONTRACT = "a path is test evidence only when a component is test, tests, or __tests__, or its filename contains .test. or .spec.";

const STOP_WORDS = new Set([
  "a", "about", "all", "also", "an", "and", "any", "are", "as", "at", "be", "been",
  "but", "by", "can", "currently", "does", "during", "each", "example", "for", "from",
  "had", "has", "have", "how", "i", "if", "in", "into", "is", "it", "its", "must",
  "not", "of", "on", "only", "or", "other", "our", "should", "so", "some", "than",
  "that", "the", "their", "them", "then", "there", "these", "they", "this", "those",
  "through", "to", "under", "use", "used", "user", "users", "using", "want", "when",
  "where", "which", "who", "will", "with", "without"
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
  ["CALLS", 0],
  ["EXPORTS", 1],
  ["IMPORTS", 2],
  ["DEFINES", 3],
  ["CONTAINS", 4],
  ["CONTAINS_MODULE", 5],
  ["INCLUDES_FILE", 6]
]);

const LIFECYCLE_SYMBOL = /(?:^|[._-])(?:create|dispose|init|initialize|invoke|load|open|register|save|setup|start|stop|teardown|unregister)(?:$|[A-Z_.-])/u;

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(`WO-047 contract violation: ${message}`);
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort(compareText).map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function sha256File(filePath) {
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
      throw new Error(`Invalid JSONL at ${filePath}:${index + 1}: ${error.message}`);
    }
  });
}

function resolveRepoPath(candidate) {
  return path.isAbsolute(candidate) ? candidate : path.resolve(REPO_ROOT, candidate);
}

function validateRelativePath(value) {
  assertCondition(typeof value === "string" && value.length > 0, "empty repository path");
  assertCondition(!value.includes("\0") && !value.includes("\\"), `unsafe repository path ${value}`);
  assertCondition(!path.posix.isAbsolute(value), `absolute repository path ${value}`);
  const normalized = path.posix.normalize(value);
  assertCondition(normalized === value && !normalized.startsWith("../"), `non-canonical repository path ${value}`);
  return normalized;
}

function validateFrozenRetrievalContract(contract) {
  assertCondition(contract.schema_version === 1, "frozen contract schema changed");
  assertCondition(contract.artifact_type === "wo047_two_pass_stage1_retrieval_contract", "frozen contract artifact type changed");
  assertCondition(contract.profile === "benchmark_only_default_off", "frozen contract profile changed");
  assertCondition(canonicalJson(contract.parameters) === canonicalJson(FROZEN_PARAMETERS), "frozen retrieval parameters changed");
  assertCondition(
    canonicalJson(contract.path_exclusion_components) === canonicalJson(FROZEN_PATH_EXCLUSION_COMPONENTS),
    "frozen path-exclusion components changed"
  );
  assertCondition(
    canonicalJson(contract.path_exclusion_prefixes) === canonicalJson(FROZEN_PATH_EXCLUSION_PREFIXES),
    "frozen path-exclusion prefixes changed"
  );
  assertCondition(canonicalJson(contract.reviewed_relations) === canonicalJson(FROZEN_REVIEWED_RELATIONS), "frozen reviewed relation set changed");
  assertCondition(
    canonicalJson(contract.non_runtime_proof_relations) === canonicalJson(FROZEN_NON_RUNTIME_PROOF_RELATIONS),
    "frozen non-runtime-proof relation set changed"
  );
  assertCondition(canonicalJson(contract.ordering) === canonicalJson(FROZEN_ORDERING), "frozen ordering policy changed");
  assertCondition(canonicalJson(contract.provider_boundary) === canonicalJson(FROZEN_PROVIDER_BOUNDARY), "frozen provider/model-query boundary changed");
  assertCondition(contract.test_path_contract === FROZEN_TEST_PATH_CONTRACT, "frozen test-path contract changed");
}

export function loadAndValidateContract(contractPath = DEFAULT_CONTRACT_PATH) {
  const resolved = resolveRepoPath(contractPath);
  const fileSha256 = sha256File(resolved);
  assertCondition(fileSha256 === EXPECTED_CONTRACT_FILE_SHA256, "retrieval contract file hash changed");
  const contract = readJson(resolved);
  assertCondition(contract.schema_version === 1, "unsupported retrieval contract schema");
  assertCondition(contract.profile === "benchmark_only_default_off", "profile is not benchmark-only/default-off");
  assertCondition(contract.provider_boundary?.planner_calls === 0, "planner calls are not zero");
  assertCondition(contract.provider_boundary?.solution_model_calls === 0, "solution-model calls are not zero");
  assertCondition(contract.provider_boundary?.provider_calls === 0, "provider calls are not zero");
  assertCondition(contract.provider_boundary?.model_generated_queries === false, "model-generated queries are enabled");
  validateFrozenRetrievalContract(contract);
  assertCondition(contract.parameters.runtime_lane_max + contract.parameters.test_lane_max === contract.parameters.final_result_max, "lane and final bounds diverge");
  assertCondition(contract.model_facing_packet_contract?.enabled_by_default === false, "model-facing packet renderer is enabled by default");
  assertCondition(contract.model_facing_packet_contract?.encoding === "canonical_json_base64", "unsafe model-facing packet encoding");
  return { contract, path: resolved, file_sha256: fileSha256 };
}

export function loadAndValidateFixture(contract) {
  const fixturePath = resolveRepoPath(contract.fixture.path);
  assertCondition(sha256File(fixturePath) === contract.fixture.file_sha256, "frozen fixture file hash changed");
  const fixture = readJson(fixturePath);
  const claimedPayloadHash = fixture.fixture_payload_sha256;
  const payload = structuredClone(fixture);
  delete payload.fixture_payload_sha256;
  const actualPayloadHash = sha256Bytes(canonicalJson(payload));
  assertCondition(claimedPayloadHash === contract.fixture.payload_sha256, "fixture claimed payload hash changed");
  assertCondition(actualPayloadHash === contract.fixture.payload_sha256, "fixture canonical payload hash changed");
  assertCondition(fixture.verdict === "GO", "fixture verdict is not GO");
  assertCondition(fixture.tasks?.length === 5, "fixture does not contain exactly five tasks");
  const primaryPaths = fixture.tasks.flatMap((task) => task.primary_runtime_files.map((entry) => `${task.task_id}\0${entry.path}`));
  assertCondition(primaryPaths.length === 10 && new Set(primaryPaths).size === 10, "fixture does not contain exactly ten unique task/path primary judgments");
  assertCondition(fixture.acceptance_denominators?.held_out_issue_count === 5, "held-out issue denominator changed");
  assertCondition(fixture.acceptance_denominators?.primary_runtime_file_count === 10, "primary runtime denominator changed");
  assertCondition(fixture.acceptance_denominators?.minimum_primary_runtime_files_retrieved === 7, "primary runtime acceptance threshold changed");
  assertCondition(fixture.held_out_and_contamination_audit?.selected_tasks_with_prior_solution_model_call === 0, "selected task has a prior solution-model call");
  assertCondition(fixture.held_out_and_contamination_audit?.v10y_nonempty_raw_responses === 0, "V10y contains a non-empty model response");
  return { fixture, path: fixturePath, file_sha256: contract.fixture.file_sha256, payload_sha256: actualPayloadHash };
}

function validateIndexComponents(task) {
  const root = task.frozen_index_root;
  assertCondition(path.isAbsolute(root), `index root is not absolute for ${task.task_id}`);
  const componentPaths = new Set();
  for (const component of task.index_components) {
    const relative = validateRelativePath(component.path);
    const absolute = path.resolve(root, relative);
    assertCondition(absolute.startsWith(`${path.resolve(root)}${path.sep}`), `index component escapes root: ${relative}`);
    const stats = fs.lstatSync(absolute);
    assertCondition(stats.isFile() && !stats.isSymbolicLink(), `index component is not a regular nonsymlink file: ${relative}`);
    assertCondition(sha256File(absolute) === component.sha256, `index component hash changed: ${relative}`);
    componentPaths.add(relative);
  }

  const cacheRoot = path.join(root, ".context/cache");
  const boundGraphFiles = new Set(
    [...componentPaths].filter((entry) => /^\.context\/cache\/(?:entities|relations)\..+\.jsonl$/u.test(entry))
  );
  const actualGraphFiles = new Set(
    fs.readdirSync(cacheRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^(?:entities|relations)\..+\.jsonl$/u.test(entry.name))
      .map((entry) => `.context/cache/${entry.name}`)
  );
  assertCondition(canonicalJson([...actualGraphFiles].sort(compareText)) === canonicalJson([...boundGraphFiles].sort(compareText)), `unbound entity/relation component in ${task.task_id}`);
}

function resolveSourcePacketSetPath(contract) {
  const source = contract.source_packet_set;
  assertCondition(!Object.hasOwn(source, "path"), "source packet set uses a host-specific path");
  const locator = source.locator;
  assertCondition(locator?.kind === "sibling_repository", "unsupported source packet-set locator");
  assertCondition(
    typeof locator.repository_directory === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(locator.repository_directory) &&
      locator.repository_directory !== "." && locator.repository_directory !== "..",
    "unsafe source repository directory"
  );
  const relative = validateRelativePath(locator.repository_relative_path);
  const repositoryRoot = path.resolve(REPO_ROOT, "..", locator.repository_directory);
  const resolved = path.resolve(repositoryRoot, relative);
  assertCondition(resolved.startsWith(`${repositoryRoot}${path.sep}`), "source packet set escapes its repository");
  const stats = fs.lstatSync(resolved);
  assertCondition(stats.isFile() && !stats.isSymbolicLink(), "source packet set is not a regular nonsymlink file");
  return resolved;
}

export function loadAndValidatePacketSet(contract, fixture) {
  const packetSetPath = resolveSourcePacketSetPath(contract);
  assertCondition(sha256File(packetSetPath) === contract.source_packet_set.file_sha256, "source packet-set hash changed");
  const packetSet = readJson(packetSetPath);
  assertCondition(packetSet.planner_calls === 0 && packetSet.solution_agent_calls === 0, "source packet set crosses the provider boundary");
  assertCondition(packetSet.tasks?.length === 12 && packetSet.runs?.length === 24, "source packet-set cardinality changed");
  const tasksById = new Map(packetSet.tasks.map((task) => [task.task_id, task]));
  const selected = [];
  for (const fixtureTask of fixture.tasks) {
    const task = tasksById.get(fixtureTask.task_id);
    assertCondition(task, `selected task missing from packet set: ${fixtureTask.task_id}`);
    assertCondition(task.base_commit === fixtureTask.base_commit, `base commit changed for ${task.task_id}`);
    assertCondition(task.repository_root_tree_git_oid === fixtureTask.repository_root_tree_git_oid, `root tree changed for ${task.task_id}`);
    assertCondition(task.index_sha256 === fixtureTask.index_sha256, `index identity changed for ${task.task_id}`);
    assertCondition(sha256Bytes(task.query_text) === fixtureTask.issue.sha256, `issue bytes changed for ${task.task_id}`);
    assertCondition(Buffer.byteLength(task.query_text, "utf8") === fixtureTask.issue.bytes, `issue byte count changed for ${task.task_id}`);
    validateIndexComponents(task);

    const run = packetSet.runs.find((candidate) =>
      candidate.task_id === task.task_id && candidate.variant === contract.source_packet_set.baseline_variant
    );
    assertCondition(run, `baseline run binding missing for ${task.task_id}`);
    const packetRelativePath = validateRelativePath(run.packet_path);
    const packetSetDirectory = path.dirname(packetSetPath);
    const packetPath = path.resolve(packetSetDirectory, packetRelativePath);
    assertCondition(packetPath.startsWith(`${packetSetDirectory}${path.sep}`), `baseline packet escapes packet-set directory for ${task.task_id}`);
    assertCondition(sha256File(packetPath) === run.packet_file_sha256, `baseline packet hash changed for ${task.task_id}`);
    const baselinePacket = readJson(packetPath);
    assertCondition(baselinePacket.task_id === task.task_id && baselinePacket.query_sha256 === task.query_sha256, `baseline packet binding changed for ${task.task_id}`);
    assertCondition(Array.isArray(baselinePacket.results), `baseline results missing for ${task.task_id}`);
    selected.push({ task, baselinePacket, baselinePacketPath: packetPath, baselinePacketFileSha256: run.packet_file_sha256 });
  }
  return { packetSet, selected, path: packetSetPath, file_sha256: contract.source_packet_set.file_sha256 };
}

function splitCamel(value) {
  return value
    .replace(/([a-z\d])([A-Z])/gu, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .replace(/[_./:#@-]+/gu, " ");
}

function retrievalQuery(value) {
  return String(value).replace(/<!--[\s\S]*?-->/gu, " ");
}

export function tokenize(value, minimumLength = 3) {
  const words = splitCamel(String(value)).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words.filter((word) => word.length >= minimumLength && !STOP_WORDS.has(word)))];
}

function extractNamedSymbols(query, minimumLength) {
  const matches = retrievalQuery(query).match(/[A-Za-z_$][A-Za-z0-9_$]*(?:(?:\.|::)[A-Za-z_$][A-Za-z0-9_$]*)*/gu) ?? [];
  const symbols = [];
  const seen = new Set();
  for (const candidate of matches) {
    const terminal = candidate.split(/\.|::/u).at(-1);
    const segments = candidate.split(/\.|::/u);
    const qualifiedTechnical = segments.length > 1 && segments.some((segment) => /[A-Z_]/u.test(segment));
    const technical = qualifiedTechnical || candidate.includes("::") || candidate.includes("_") ||
      /[a-z][A-Z]|[A-Z].*[A-Z]/u.test(candidate) || candidate === candidate.toUpperCase();
    if (!technical || terminal.length < minimumLength || STOP_WORDS.has(terminal.toLowerCase())) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    symbols.push(candidate);
  }
  return symbols;
}

function isTestPath(filePath) {
  return /(^|\/)(?:test|tests|__tests__)(?:\/|$)/u.test(filePath) || /\.(?:test|spec)\.[^/]+$/u.test(filePath);
}

function isRuntimeSourcePath(filePath) {
  return /\.(?:c|cc|cpp|cs|cxx|go|h|hh|hpp|hxx|java|js|jsx|kt|kts|m|mm|mjs|php|py|rb|rs|swift|ts|tsx|vb)$/iu.test(filePath);
}

function excludedPath(filePath, contract) {
  const normalized = validateRelativePath(filePath);
  if (contract.path_exclusion_prefixes.some((prefix) => normalized.startsWith(prefix))) return true;
  const components = normalized.split("/");
  return components.some((component) => contract.path_exclusion_components.includes(component));
}

function entityText(entity) {
  return [entity.path, entity.name, entity.signature, entity.description, entity.summary, entity.exported_symbols, entity.body, entity.content]
    .filter(Boolean)
    .join("\n");
}

function loadTaskIndex(task, contract) {
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

function computeIdf(entities, queryTokens, minimumLength) {
  const counts = new Map(queryTokens.map((token) => [token, 0]));
  let documents = 0;
  for (const entity of entities) {
    if (entity.type !== "Chunk" && entity.type !== "File") continue;
    documents += 1;
    const tokens = new Set(tokenize(entityText(entity), minimumLength));
    for (const token of queryTokens) if (tokens.has(token)) counts.set(token, counts.get(token) + 1);
  }
  return new Map(queryTokens.map((token) => [token, Math.log((documents + 1) / ((counts.get(token) ?? 0) + 1)) + 1]));
}

function lexicalEvidence(entity, queryTokens, idf, minimumLength) {
  const tokens = new Set(tokenize(entityText(entity), minimumLength));
  const pathTokens = new Set(tokenize(entity.path, minimumLength));
  const nameTokens = new Set(tokenize(`${entity.name ?? ""} ${entity.signature ?? ""}`, minimumLength));
  const matched = queryTokens.filter((token) => tokens.has(token));
  let score = matched.reduce((sum, token) => sum + (idf.get(token) ?? 1), 0);
  score += queryTokens.filter((token) => pathTokens.has(token)).length * 1.5;
  score += queryTokens.filter((token) => nameTokens.has(token)).length * 2;
  return { score, matched };
}

function exactSymbolMatch(entity, candidate) {
  if (entity.type !== "Chunk") return false;
  const terminal = candidate.split(/\.|::/u).at(-1).replace(/#window\d+$/u, "");
  const entityName = String(entity.name ?? "").replace(/#window\d+$/u, "");
  const entityTerminal = entityName.split(/\.|::/u).at(-1);
  return entityTerminal === terminal || entityName === candidate;
}

function definitionRecord(entity, symbol, matchReason, matchClass) {
  return {
    entity_id: entity.id,
    path: entity.path,
    symbol: entity.name || symbol,
    signature: entity.signature || null,
    span: Number.isInteger(entity.start_line) && Number.isInteger(entity.end_line)
      ? { start_line: entity.start_line, end_line: entity.end_line }
      : null,
    match_reason: matchReason,
    match_class: matchClass,
    lane: isTestPath(entity.path) ? "test" : "runtime"
  };
}

function resolveDefinitions({ query, baselineResults, index, contract }) {
  const parameters = contract.parameters;
  const scopedQuery = retrievalQuery(query);
  const namedSymbols = extractNamedSymbols(scopedQuery, parameters.minimum_symbol_length);
  const definitionsByLane = { runtime: [], test: [] };
  const selectedIds = new Set();
  const addDefinition = (record) => definitionsByLane[record.lane].push(record);
  const baselinePathSet = new Set(baselineResults.map((result) => result.path).filter(Boolean));
  for (const symbol of namedSymbols) {
    const exactMatches = index.entities
      .filter((entity) => exactSymbolMatch(entity, symbol) && entity.owner_kind === "CODE" && isRuntimeSourcePath(entity.path) && !excludedPath(entity.path, contract))
      .sort((left, right) =>
        Number(baselinePathSet.has(right.path)) - Number(baselinePathSet.has(left.path)) ||
        Number(Boolean(right.exported)) - Number(Boolean(left.exported)) ||
        compareText(left.path, right.path) || compareText(left.id, right.id)
      );
    for (const entity of exactMatches) {
      if (selectedIds.has(entity.id)) continue;
      addDefinition(definitionRecord(entity, symbol, `issue_exact_symbol:${symbol}`, "exact"));
      selectedIds.add(entity.id);
    }
  }

  const baselinePaths = [...new Set(baselineResults.map((result) => result.path).filter(Boolean))];
  const queryTokens = tokenize(scopedQuery, parameters.minimum_query_token_length);
  const idf = computeIdf(index.entities, queryTokens, parameters.minimum_query_token_length);
  for (const baselinePath of baselinePaths) {
    const candidates = index.entities
      .filter((entity) =>
        entity.type === "Chunk" && entity.path === baselinePath && entity.owner_kind === "CODE" &&
        isRuntimeSourcePath(entity.path) && !["section", "heading", "object", "preamble"].includes(String(entity.kind).toLowerCase()) &&
        !["markdown", "json", "yaml", "yml"].includes(String(entity.language).toLowerCase()) && !selectedIds.has(entity.id)
      )
      .map((entity) => ({ entity, evidence: lexicalEvidence(entity, queryTokens, idf, parameters.minimum_query_token_length) }))
      .filter(({ evidence }) => evidence.matched.length >= parameters.minimum_pass2_query_overlap)
      .sort((left, right) => right.evidence.score - left.evidence.score || compareText(left.entity.id, right.entity.id))
      .slice(0, parameters.baseline_file_symbol_limit);
    for (const { entity, evidence } of candidates) {
      addDefinition(definitionRecord(entity, entity.name, `pass0_owner_candidate:query_terms=${evidence.matched.join(",")}`, "baseline_owner"));
      selectedIds.add(entity.id);
    }
  }
  const definitions = [...definitionsByLane.runtime, ...definitionsByLane.test].slice(0, parameters.definition_limit);
  return {
    named_symbols: namedSymbols,
    definitions,
    definition_lane_counts: {
      runtime: definitions.filter((definition) => definition.lane === "runtime").length,
      test: definitions.filter((definition) => definition.lane === "test").length
    }
  };
}

function buildAdjacency(relations) {
  const adjacency = new Map();
  for (const edge of relations) {
    const outgoing = adjacency.get(edge.from) ?? [];
    outgoing.push({ edge, next: edge.to, direction: "outgoing" });
    adjacency.set(edge.from, outgoing);
    const incoming = adjacency.get(edge.to) ?? [];
    incoming.push({ edge, next: edge.from, direction: "incoming" });
    adjacency.set(edge.to, incoming);
  }
  for (const neighbors of adjacency.values()) {
    neighbors.sort((left, right) =>
      (RELATION_PRIORITY.get(left.edge.relation) ?? 99) - (RELATION_PRIORITY.get(right.edge.relation) ?? 99) ||
      compareText(left.next, right.next) || compareText(left.direction, right.direction)
    );
  }
  return adjacency;
}

function graphRole(edge, direction, entity) {
  if (edge.relation === "CALLS") {
    if (direction === "incoming") return LIFECYCLE_SYMBOL.test(String(entity.name ?? "")) ? "lifecycle_owner" : "caller";
    return "callee";
  }
  if (edge.relation === "EXPORTS") return "barrel_or_public_export";
  if (edge.relation === "IMPORTS") return direction === "incoming" ? "importer" : "imported_runtime";
  if (edge.relation === "CONTAINS" || edge.relation === "CONTAINS_MODULE") return "module_owner";
  if (edge.relation === "INCLUDES_FILE") return "project_owner";
  if (edge.relation === "DEFINES") return "definition_owner";
  return "runtime_neighbor";
}

function traverseDefinitions(definitions, index, contract) {
  const adjacency = buildAdjacency(index.relations.filter((relation) => contract.reviewed_relations.includes(relation.relation)));
  const evidence = [];
  const seenEvidence = new Set();
  for (const definition of definitions) {
    const seen = new Set([definition.entity_id]);
    const queue = [{ id: definition.entity_id, depth: 0, trail: [] }];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current.depth >= contract.parameters.graph_depth) continue;
      for (const neighbor of adjacency.get(current.id) ?? []) {
        const nextDepth = current.depth + 1;
        const nextTrail = [...current.trail, {
          from: neighbor.edge.from,
          to: neighbor.edge.to,
          relation: neighbor.edge.relation,
          direction: neighbor.direction,
          note: neighbor.edge.note
        }];
        if (!seen.has(neighbor.next)) {
          seen.add(neighbor.next);
          queue.push({ id: neighbor.next, depth: nextDepth, trail: nextTrail });
        }
        const entity = index.entitiesById.get(neighbor.next);
        const entityPath = entity?.path ?? index.pathsByEntity.get(neighbor.next);
        if (!entity || !entityPath || excludedPath(entityPath, contract)) continue;
        const key = `${definition.entity_id}\0${entityPath}\0${neighbor.edge.relation}\0${neighbor.direction}`;
        if (seenEvidence.has(key)) continue;
        seenEvidence.add(key);
        evidence.push({
          entity_id: entity.id,
          entity_type: entity.type,
          path: entityPath,
          symbol: entity.name ?? null,
          span: Number.isInteger(entity.start_line) && Number.isInteger(entity.end_line)
            ? { start_line: entity.start_line, end_line: entity.end_line }
            : null,
          role: graphRole(neighbor.edge, neighbor.direction, entity),
          seed_definition_id: definition.entity_id,
          distance: nextDepth,
          relation_path: nextTrail
        });
      }
    }
  }
  evidence.sort((left, right) =>
    left.distance - right.distance ||
    (RELATION_PRIORITY.get(left.relation_path.at(-1).relation) ?? 99) - (RELATION_PRIORITY.get(right.relation_path.at(-1).relation) ?? 99) ||
    compareText(left.path, right.path) || compareText(left.entity_id, right.entity_id)
  );
  return evidence;
}

function deriveSubsystem(definitions, graphEvidence, contract) {
  const anchors = [];
  const seen = new Set();
  const add = (kind, value, causeEntityId, options = {}) => {
    if (!value || seen.has(`${kind}\0${value}`) || anchors.length >= contract.parameters.subsystem_anchor_limit) return;
    seen.add(`${kind}\0${value}`);
    anchors.push({
      kind,
      value,
      scope: options.scope ?? "lexical",
      support_kind: options.supportKind ?? "lexical_anchor",
      cause_entity_id: causeEntityId,
      cause_relation: options.causeRelation ?? null,
      source_path: options.sourcePath ?? null,
      relation_path: options.relationPath ?? null
    });
  };
  for (const definition of definitions) {
    add("owner_path", definition.path, definition.entity_id, {
      scope: "file",
      supportKind: "definition_owner_file",
      sourcePath: definition.path
    });
    const directory = path.posix.dirname(definition.path);
    if (directory !== ".") add("module_path", directory, definition.entity_id, {
      scope: "directory",
      supportKind: "definition_owner_directory",
      sourcePath: definition.path
    });
    add("owner_symbol", definition.symbol, definition.entity_id);
  }
  for (const evidence of graphEvidence) {
    if (!["module_owner", "barrel_or_public_export", "caller", "lifecycle_owner"].includes(evidence.role)) continue;
    const directoryScope = evidence.entity_type === "Module" || evidence.entity_type === "Project";
    add(directoryScope ? "graph_module_path" : "graph_file_path", evidence.path, evidence.entity_id, {
      scope: directoryScope ? "directory" : "file",
      supportKind: "reviewed_relation_path",
      causeRelation: evidence.relation_path.at(-1).relation,
      sourcePath: evidence.path,
      relationPath: evidence.relation_path
    });
  }
  return {
    status: anchors.length > 0 ? "grounded" : "unresolved",
    anchors,
    unresolved: anchors.length > 0 ? [] : ["no exact or baseline-owner definition produced a grounded subsystem anchor"]
  };
}

function containmentSupport(candidatePath, anchor) {
  if (anchor.scope === "file" && candidatePath === anchor.value) {
    return {
      anchor_kind: anchor.kind,
      anchor_value: anchor.value,
      anchor_scope: anchor.scope,
      support_kind: anchor.support_kind,
      containment: "same_file",
      cause_entity_id: anchor.cause_entity_id,
      cause_relation: anchor.cause_relation,
      source_path: anchor.source_path,
      relation_path: anchor.relation_path
    };
  }
  if (anchor.scope === "directory" && (candidatePath === anchor.value || candidatePath.startsWith(`${anchor.value}/`))) {
    return {
      anchor_kind: anchor.kind,
      anchor_value: anchor.value,
      anchor_scope: anchor.scope,
      support_kind: anchor.support_kind,
      containment: candidatePath === anchor.value ? "same_directory_entity" : "directory_descendant",
      cause_entity_id: anchor.cause_entity_id,
      cause_relation: anchor.cause_relation,
      source_path: anchor.source_path,
      relation_path: anchor.relation_path
    };
  }
  return null;
}

function bestContainmentSupport(candidatePath, anchors) {
  const supported = anchors
    .map((anchor) => containmentSupport(candidatePath, anchor))
    .filter(Boolean);
  supported.sort((left, right) =>
    Number(right.anchor_scope === "file") - Number(left.anchor_scope === "file") ||
    right.anchor_value.length - left.anchor_value.length ||
    compareText(left.anchor_kind, right.anchor_kind) ||
    compareText(left.cause_entity_id, right.cause_entity_id)
  );
  return supported[0] ?? null;
}

function selectRelevantGraphEvidence(graphEvidence, index, query, contract) {
  const minimumLength = contract.parameters.minimum_query_token_length;
  const queryTokens = tokenize(retrievalQuery(query), minimumLength);
  const idf = computeIdf(index.entities, queryTokens, minimumLength);
  const eligible = graphEvidence.map((item) => {
    const entity = index.entitiesById.get(item.entity_id);
    const matched = entity ? lexicalEvidence(entity, queryTokens, idf, minimumLength).matched.sort(compareText) : [];
    return { ...item, query_terms: matched };
  }).filter((item) => {
    if (item.distance !== 1) return false;
    if (["caller", "callee", "lifecycle_owner", "barrel_or_public_export"].includes(item.role)) return true;
    return ["importer", "imported_runtime"].includes(item.role) &&
      item.query_terms.length >= contract.parameters.minimum_pass2_query_overlap;
  });
  eligible.sort((left, right) =>
    right.query_terms.length - left.query_terms.length ||
    (RELATION_PRIORITY.get(left.relation_path.at(-1).relation) ?? 99) - (RELATION_PRIORITY.get(right.relation_path.at(-1).relation) ?? 99) ||
    compareText(left.path, right.path) || compareText(left.entity_id, right.entity_id)
  );
  const counts = new Map();
  return eligible.filter((item) => {
    const key = `${item.seed_definition_id}\0${item.role}`;
    const count = counts.get(key) ?? 0;
    if (count >= 2) return false;
    counts.set(key, count + 1);
    return true;
  });
}

function rankPass2({ query, index, subsystem, contract }) {
  if (subsystem.status !== "grounded") return [];
  const minimumLength = contract.parameters.minimum_query_token_length;
  const queryTokens = tokenize(retrievalQuery(query), minimumLength);
  const anchorTokens = tokenize(subsystem.anchors.map((anchor) => anchor.value).join(" "), minimumLength);
  const combinedTokens = [...new Set([...queryTokens, ...anchorTokens])];
  const idf = computeIdf(index.entities, combinedTokens, minimumLength);
  const pathAnchors = subsystem.anchors.filter((anchor) => anchor.scope === "file" || anchor.scope === "directory");
  const bestByPath = new Map();
  for (const entity of index.entities) {
    if ((entity.type !== "Chunk" && entity.type !== "File") || excludedPath(entity.path, contract)) continue;
    if (!isRuntimeSourcePath(entity.path) && !isTestPath(entity.path)) continue;
    const queryEvidence = lexicalEvidence(entity, queryTokens, idf, minimumLength);
    const anchorEvidence = lexicalEvidence(entity, anchorTokens, idf, minimumLength);
    const subsystemCause = bestContainmentSupport(entity.path, pathAnchors);
    if (!subsystemCause) continue;
    if (queryEvidence.matched.length < contract.parameters.minimum_pass2_query_overlap) continue;
    const score = queryEvidence.score + anchorEvidence.score * 1.25 + 3;
    const candidate = {
      entity_id: entity.id,
      path: entity.path,
      symbol: entity.type === "Chunk" ? entity.name ?? null : null,
      span: entity.type === "Chunk" && Number.isInteger(entity.start_line) && Number.isInteger(entity.end_line)
        ? { start_line: entity.start_line, end_line: entity.end_line }
        : null,
      score: Number(score.toFixed(6)),
      query_terms: queryEvidence.matched.sort(compareText),
      anchor_terms: anchorEvidence.matched.sort(compareText),
      subsystem_cause: subsystemCause
    };
    const prior = bestByPath.get(candidate.path);
    if (!prior || candidate.score > prior.score || (candidate.score === prior.score && compareText(candidate.entity_id, prior.entity_id) < 0)) {
      bestByPath.set(candidate.path, candidate);
    }
  }
  return [...bestByPath.values()]
    .sort((left, right) => right.score - left.score || compareText(left.path, right.path) || compareText(left.entity_id, right.entity_id))
    .slice(0, contract.parameters.pass2_candidate_pool);
}

function resultRecordFromDefinition(definition) {
  return {
    path: definition.path,
    entity_id: definition.entity_id,
    symbol: definition.symbol,
    span: definition.span,
    selected_by_pass: 1,
    selection_reason: definition.match_reason,
    evidence_role: "exact_or_baseline_definition"
  };
}

function resultRecordFromGraph(item) {
  return {
    path: item.path,
    entity_id: item.entity_id,
    symbol: item.symbol,
    span: item.span,
    selected_by_pass: 1,
    selection_reason: `${item.role}:${item.relation_path.map((edge) => edge.relation).join(">")}`,
    evidence_role: item.role,
    seed_definition_id: item.seed_definition_id,
    relation_path: item.relation_path
  };
}

function resultRecordFromPass2(item, lane) {
  return {
    path: item.path,
    entity_id: item.entity_id,
    symbol: item.symbol,
    span: item.span,
    selected_by_pass: 2,
    selected_lane: lane,
    selection_reason: `subsystem_refinement:support=${item.subsystem_cause.support_kind}:${item.subsystem_cause.containment}:${item.subsystem_cause.anchor_value};query_terms=${item.query_terms.join(",")};anchor_terms=${item.anchor_terms.join(",")}`,
    evidence_role: lane === "test" ? "regression_test_surface" : "subsystem_runtime",
    subsystem_cause: item.subsystem_cause,
    subsystem_query_terms: item.query_terms,
    subsystem_anchor_terms: item.anchor_terms,
    deterministic_score: item.score
  };
}

function classifyBaseline(result) {
  return isTestPath(result.path) ? "test" : isRuntimeSourcePath(result.path) ? "runtime" : "other";
}

function selectLanes({ baselineResults, definitions, graphEvidence, pass2Candidates, contract }) {
  const runtime = [];
  const tests = [];
  const otherPrefix = [];
  const selectedPaths = new Set();
  let duplicatesPrevented = 0;
  let excludedCandidates = 0;

  for (const result of baselineResults) {
    const lane = classifyBaseline(result);
    const record = { ...result, selected_by_pass: 0, selected_lane: lane, selection_reason: "immutable_original_query_prefix" };
    (lane === "test" ? tests : lane === "runtime" ? runtime : otherPrefix).push(record);
    selectedPaths.add(result.path);
  }

  const add = (record, lane, reserved = false) => {
    if (selectedPaths.has(record.path)) {
      duplicatesPrevented += 1;
      return;
    }
    if (excludedPath(record.path, contract)) {
      excludedCandidates += 1;
      return;
    }
    if (selectedPaths.size >= contract.parameters.final_result_max) {
      assertCondition(!reserved, `${lane} lane cannot reserve required evidence within frozen final bound`);
      return;
    }
    const target = lane === "test" ? tests : runtime;
    const limit = lane === "test" ? contract.parameters.test_lane_max : contract.parameters.runtime_lane_max;
    if (target.length >= limit && !reserved) return;
    assertCondition(target.length < limit, `${lane} lane cannot reserve required evidence within frozen bound`);
    target.push({ ...record, selected_lane: lane });
    selectedPaths.add(record.path);
  };

  for (const definition of definitions) add(resultRecordFromDefinition(definition), isTestPath(definition.path) ? "test" : "runtime", true);
  for (const item of graphEvidence) {
    if ((item.entity_type !== "Chunk" && item.entity_type !== "File") || (!isRuntimeSourcePath(item.path) && !isTestPath(item.path))) continue;
    add(resultRecordFromGraph(item), isTestPath(item.path) ? "test" : "runtime");
  }
  for (const item of pass2Candidates.filter((candidate) => !isTestPath(candidate.path))) add(resultRecordFromPass2(item, "runtime"), "runtime");
  for (const item of pass2Candidates.filter((candidate) => isTestPath(candidate.path))) add(resultRecordFromPass2(item, "test"), "test");

  assertCondition(runtime.length <= contract.parameters.runtime_lane_max, "runtime lane bound exceeded");
  assertCondition(tests.length <= contract.parameters.test_lane_max, "test lane bound exceeded");
  const prefix = baselineResults.map((result, index) => ({ ...result, rank: index + 1 }));
  const additions = [...runtime, ...tests].filter((record) => record.selected_by_pass !== 0);
  const finalResults = [...prefix, ...additions].map((record, index) => ({ ...record, final_rank: index + 1 }));
  assertCondition(finalResults.length <= contract.parameters.final_result_max, "final result bound exceeded");
  assertCondition(canonicalJson(finalResults.slice(0, prefix.length).map(({ final_rank: _rank, ...result }) => result)) === canonicalJson(prefix), "original-query prefix was mutated");
  return {
    runtime,
    tests,
    other_prefix: otherPrefix,
    final_results: finalResults,
    diagnostics: {
      runtime_unused_capacity: contract.parameters.runtime_lane_max - runtime.length,
      test_unused_capacity: contract.parameters.test_lane_max - tests.length,
      duplicates_prevented: duplicatesPrevented,
      excluded_candidates: excludedCandidates,
      prefix_runtime_count: runtime.filter((entry) => entry.selected_by_pass === 0).length,
      prefix_test_count: tests.filter((entry) => entry.selected_by_pass === 0).length,
      prefix_other_count: otherPrefix.length
    }
  };
}

function packetSizeDiagnostics(packet, divisor) {
  const projection = structuredClone(packet);
  delete projection.diagnostics.canonical_projection_bytes;
  delete projection.diagnostics.estimated_projection_tokens;
  const bytes = Buffer.byteLength(canonicalJson(projection), "utf8");
  return {
    canonical_projection_bytes: bytes,
    estimated_projection_tokens: Math.ceil(bytes / divisor)
  };
}

export function retrieveTask({ task, baselinePacket, index, contract }) {
  validateFrozenRetrievalContract(contract);
  const baselineResults = structuredClone(baselinePacket.results);
  for (const result of baselineResults) {
    validateRelativePath(result.path);
    assertCondition(!excludedPath(result.path, contract), `excluded artifact in immutable baseline: ${result.path}`);
  }
  const pass1 = resolveDefinitions({ query: task.query_text, baselineResults, index, contract });
  const graphEvidence = traverseDefinitions(pass1.definitions, index, contract);
  const selectedGraphEvidence = selectRelevantGraphEvidence(graphEvidence, index, task.query_text, contract);
  const subsystem = deriveSubsystem(pass1.definitions, graphEvidence, contract);
  const pass2Candidates = rankPass2({ query: task.query_text, index, subsystem, contract });
  const lanes = selectLanes({ baselineResults, definitions: pass1.definitions, graphEvidence: selectedGraphEvidence, pass2Candidates, contract });
  const unresolved = [];
  if (pass1.definitions.length === 0) unresolved.push("no symbol definition resolved");
  unresolved.push(...subsystem.unresolved);
  if (!lanes.tests.some((entry) => entry.selected_by_pass !== 0)) unresolved.push("no additive test surface selected");

  const packet = {
    schema_version: 1,
    artifact_type: "wo047_two_pass_retrieval_packet",
    task_id: task.task_id,
    repo: task.repo,
    base_commit: task.base_commit,
    index_sha256: task.index_sha256,
    query_sha256: task.query_sha256,
    parameters: contract.parameters,
    pass0: {
      source: "frozen_v10c_adaptive_control",
      baseline_result_count: baselineResults.length,
      results_sha256: sha256Bytes(canonicalJson(baselineResults)),
      retained_exact_order: true
    },
    pass1: {
      named_symbols: pass1.named_symbols,
      definitions: pass1.definitions,
      definition_lane_counts: pass1.definition_lane_counts,
      graph_evidence: graphEvidence,
      selected_graph_evidence_count: selectedGraphEvidence.length
    },
    subsystem,
    pass2: {
      query_sha256: sha256Bytes(`${task.query_text}\n${canonicalJson(subsystem.anchors)}`),
      candidate_count: pass2Candidates.length,
      additions_by_lane: {
        runtime: lanes.runtime.filter((entry) => entry.selected_by_pass === 2).length,
        test: lanes.tests.filter((entry) => entry.selected_by_pass === 2).length
      }
    },
    lanes: { runtime: lanes.runtime, test: lanes.tests },
    final_results: lanes.final_results,
    unresolved_needs: unresolved,
    diagnostics: lanes.diagnostics,
    provider_boundary: contract.provider_boundary
  };
  packet.diagnostics = {
    ...packet.diagnostics,
    additions_by_pass: {
      pass1: packet.final_results.filter((entry) => entry.selected_by_pass === 1).length,
      pass2: packet.final_results.filter((entry) => entry.selected_by_pass === 2).length
    },
    result_count: packet.final_results.length,
    size_projection_excludes: [
      "diagnostics.canonical_projection_bytes",
      "diagnostics.estimated_projection_tokens"
    ]
  };
  Object.assign(packet.diagnostics, packetSizeDiagnostics(packet, contract.parameters.estimated_token_divisor));
  return packet;
}

/**
 * Pure, default-off renderer for a possible future model-facing packet.
 * The payload is an allowlisted canonical projection encoded as base64 so
 * repository text cannot terminate the frame or become an outer instruction.
 * This function does not call a model or construct a Stage 2 prompt.
 */
const EVALUATOR_ONLY_KEYS = new Set([
  "fixture", "score", "aggregate", "evaluator", "evaluator_judgments",
  "gold", "gold_files", "gold_patch", "oracle", "expected_fix",
  "expected_files", "primary_runtime_files", "regression_test_surfaces"
]);

function assertPlainRecord(value, label) {
  assertCondition(value && typeof value === "object" && !Array.isArray(value), `${label} is not a record`);
}

function assertClosedKeys(value, allowed, label) {
  assertPlainRecord(value, label);
  for (const key of Object.keys(value)) {
    assertCondition(!EVALUATOR_ONLY_KEYS.has(key), `${label} contains forbidden evaluator field ${key}`);
    assertCondition(allowed.includes(key), `${label} contains unknown field ${key}`);
  }
}

function assertBoundedArray(value, maximum, label) {
  assertCondition(Array.isArray(value), `${label} is not an array`);
  assertCondition(value.length <= maximum, `${label} exceeds array bound`);
}

function assertBoundedRecordFields(value, maximum, label) {
  assertPlainRecord(value, label);
  assertCondition(Object.keys(value).length <= maximum, `${label} exceeds field-count bound`);
}

function boundedString(value, label, nullable = false) {
  if (nullable && value === null) return null;
  assertCondition(typeof value === "string", `${label} is not a string`);
  assertCondition(Buffer.byteLength(value, "utf8") <= MODEL_FACING_LIMITS.string_utf8_bytes, `${label} exceeds string byte bound`);
  return value;
}

function boundedInteger(value, label, nullable = false) {
  if (nullable && value === null) return null;
  assertCondition(Number.isSafeInteger(value) && value >= 0, `${label} is not a nonnegative safe integer`);
  return value;
}

function boundedNumber(value, label) {
  assertCondition(typeof value === "number" && Number.isFinite(value), `${label} is not finite`);
  return value;
}

function boundedStringArray(value, label) {
  assertCondition(Array.isArray(value) && value.length <= FROZEN_PARAMETERS.final_result_max, `${label} exceeds array bound`);
  return value.map((entry, index) => boundedString(entry, `${label}[${index}]`));
}

function projectSpan(value, label) {
  if (value === null) return null;
  assertClosedKeys(value, ["start_line", "end_line"], label);
  const startLine = boundedInteger(value.start_line, `${label}.start_line`);
  const endLine = boundedInteger(value.end_line, `${label}.end_line`);
  assertCondition(startLine <= endLine, `${label} is reversed`);
  return { start_line: startLine, end_line: endLine };
}

function projectRelationEdge(value, label) {
  assertClosedKeys(value, ["from", "to", "relation", "direction", "note"], label);
  const relation = boundedString(value.relation, `${label}.relation`);
  assertCondition(FROZEN_REVIEWED_RELATIONS.includes(relation), `${label} uses an unreviewed relation`);
  const direction = boundedString(value.direction, `${label}.direction`);
  assertCondition(direction === "incoming" || direction === "outgoing", `${label} has an invalid direction`);
  const projected = {
    from: boundedString(value.from, `${label}.from`),
    to: boundedString(value.to, `${label}.to`),
    relation,
    direction,
    note: boundedString(value.note, `${label}.note`)
  };
  return projected;
}

function projectRelationPath(value, label, nullable = false) {
  if (nullable && value === null) return null;
  assertCondition(Array.isArray(value) && value.length <= FROZEN_PARAMETERS.graph_depth, `${label} exceeds graph-depth bound`);
  return value.map((entry, index) => projectRelationEdge(entry, `${label}[${index}]`));
}

function assertProjectedRecordSize(value, label) {
  assertCondition(Buffer.byteLength(canonicalJson(value), "utf8") <= MODEL_FACING_LIMITS.record_utf8_bytes, `${label} exceeds record byte bound`);
  return value;
}

function projectDefinition(value, label) {
  assertClosedKeys(value, ["entity_id", "path", "symbol", "signature", "span", "match_reason", "match_class", "lane"], label);
  const lane = boundedString(value.lane, `${label}.lane`);
  assertCondition(lane === "runtime" || lane === "test", `${label}.lane is invalid`);
  return assertProjectedRecordSize({
    entity_id: boundedString(value.entity_id, `${label}.entity_id`),
    path: validateRelativePath(boundedString(value.path, `${label}.path`)),
    symbol: boundedString(value.symbol, `${label}.symbol`),
    signature: boundedString(value.signature, `${label}.signature`, true),
    span: projectSpan(value.span, `${label}.span`),
    match_reason: boundedString(value.match_reason, `${label}.match_reason`),
    match_class: boundedString(value.match_class, `${label}.match_class`),
    lane
  }, label);
}

function projectSubsystemAnchor(value, label) {
  assertClosedKeys(value, ["kind", "value", "scope", "support_kind", "cause_entity_id", "cause_relation", "source_path", "relation_path"], label);
  return assertProjectedRecordSize({
    kind: boundedString(value.kind, `${label}.kind`),
    value: boundedString(value.value, `${label}.value`),
    scope: boundedString(value.scope, `${label}.scope`),
    support_kind: boundedString(value.support_kind, `${label}.support_kind`),
    cause_entity_id: boundedString(value.cause_entity_id, `${label}.cause_entity_id`),
    cause_relation: boundedString(value.cause_relation, `${label}.cause_relation`, true),
    source_path: boundedString(value.source_path, `${label}.source_path`, true),
    relation_path: projectRelationPath(value.relation_path, `${label}.relation_path`, true)
  }, label);
}

function projectSubsystemCause(value, label) {
  assertClosedKeys(value, ["anchor_kind", "anchor_value", "anchor_scope", "support_kind", "containment", "cause_entity_id", "cause_relation", "source_path", "relation_path"], label);
  return assertProjectedRecordSize({
    anchor_kind: boundedString(value.anchor_kind, `${label}.anchor_kind`),
    anchor_value: boundedString(value.anchor_value, `${label}.anchor_value`),
    anchor_scope: boundedString(value.anchor_scope, `${label}.anchor_scope`),
    support_kind: boundedString(value.support_kind, `${label}.support_kind`),
    containment: boundedString(value.containment, `${label}.containment`),
    cause_entity_id: boundedString(value.cause_entity_id, `${label}.cause_entity_id`),
    cause_relation: boundedString(value.cause_relation, `${label}.cause_relation`, true),
    source_path: boundedString(value.source_path, `${label}.source_path`, true),
    relation_path: projectRelationPath(value.relation_path, `${label}.relation_path`, true)
  }, label);
}

function projectFinalResult(value, label) {
  assertPlainRecord(value, label);
  const pass = value.selected_by_pass ?? 0;
  if (pass === 0) {
    assertClosedKeys(value, [
      "rank", "id", "path", "title", "span", "symbol", "content_supplied",
      "covered_aspects", "content_supplied_sha256", "content_full_sha256",
      "content_full_utf8_bytes", "content_supplied_utf8_bytes",
      "content_omitted_utf8_bytes", "content_truncated",
      "content_excerpt_strategy", "final_rank"
    ], label);
    const content = boundedString(value.content_supplied, `${label}.content_supplied`);
    assertCondition(Buffer.byteLength(content, "utf8") === value.content_supplied_utf8_bytes, `${label}.content byte count changed`);
    return assertProjectedRecordSize({
      rank: boundedInteger(value.rank, `${label}.rank`),
      id: boundedString(value.id, `${label}.id`),
      path: validateRelativePath(boundedString(value.path, `${label}.path`)),
      title: boundedString(value.title, `${label}.title`),
      span: projectSpan(value.span, `${label}.span`),
      symbol: boundedString(value.symbol, `${label}.symbol`, true),
      content_supplied: content,
      content_supplied_sha256: boundedString(value.content_supplied_sha256, `${label}.content_supplied_sha256`),
      content_supplied_utf8_bytes: boundedInteger(value.content_supplied_utf8_bytes, `${label}.content_supplied_utf8_bytes`),
      content_truncated: (() => {
        assertCondition(typeof value.content_truncated === "boolean", `${label}.content_truncated is not boolean`);
        return value.content_truncated;
      })(),
      final_rank: boundedInteger(value.final_rank, `${label}.final_rank`)
    }, label);
  }
  if (pass === 1) {
    assertClosedKeys(value, ["path", "entity_id", "symbol", "span", "selected_by_pass", "selection_reason", "evidence_role", "seed_definition_id", "relation_path", "final_rank", "selected_lane"], label);
    const lane = boundedString(value.selected_lane, `${label}.selected_lane`);
    assertCondition(lane === "runtime" || lane === "test", `${label}.selected_lane is invalid`);
    return assertProjectedRecordSize({
      path: validateRelativePath(boundedString(value.path, `${label}.path`)),
      entity_id: boundedString(value.entity_id, `${label}.entity_id`),
      symbol: boundedString(value.symbol, `${label}.symbol`, true),
      span: projectSpan(value.span, `${label}.span`),
      selected_by_pass: boundedInteger(value.selected_by_pass, `${label}.selected_by_pass`),
      selection_reason: boundedString(value.selection_reason, `${label}.selection_reason`),
      evidence_role: boundedString(value.evidence_role, `${label}.evidence_role`),
      seed_definition_id: boundedString(value.seed_definition_id, `${label}.seed_definition_id`),
      relation_path: projectRelationPath(value.relation_path, `${label}.relation_path`),
      final_rank: boundedInteger(value.final_rank, `${label}.final_rank`),
      selected_lane: lane
    }, label);
  }
  assertCondition(pass === 2, `${label}.selected_by_pass is invalid`);
  assertClosedKeys(value, ["path", "entity_id", "symbol", "span", "selected_by_pass", "selected_lane", "selection_reason", "evidence_role", "subsystem_cause", "subsystem_query_terms", "subsystem_anchor_terms", "deterministic_score", "final_rank"], label);
  const lane = boundedString(value.selected_lane, `${label}.selected_lane`);
  assertCondition(lane === "runtime" || lane === "test", `${label}.selected_lane is invalid`);
  return assertProjectedRecordSize({
    path: validateRelativePath(boundedString(value.path, `${label}.path`)),
    entity_id: boundedString(value.entity_id, `${label}.entity_id`),
    symbol: boundedString(value.symbol, `${label}.symbol`, true),
    span: projectSpan(value.span, `${label}.span`),
    selected_by_pass: boundedInteger(value.selected_by_pass, `${label}.selected_by_pass`),
    selected_lane: lane,
    selection_reason: boundedString(value.selection_reason, `${label}.selection_reason`),
    evidence_role: boundedString(value.evidence_role, `${label}.evidence_role`),
    subsystem_cause: projectSubsystemCause(value.subsystem_cause, `${label}.subsystem_cause`),
    subsystem_query_terms: boundedStringArray(value.subsystem_query_terms, `${label}.subsystem_query_terms`),
    subsystem_anchor_terms: boundedStringArray(value.subsystem_anchor_terms, `${label}.subsystem_anchor_terms`),
    deterministic_score: boundedNumber(value.deterministic_score, `${label}.deterministic_score`),
    final_rank: boundedInteger(value.final_rank, `${label}.final_rank`)
  }, label);
}

export function renderUntrustedRetrievalPacket(packet) {
  const contract = loadAndValidateContract().contract;
  const renderer = contract.model_facing_packet_contract;
  assertCondition(renderer?.enabled_by_default === false, "model-facing renderer must remain default-off");

  // Preflight only shallow schemas and lengths/counts. In particular, do not
  // traverse evaluator-private audit collections before proving their frozen
  // bounds, and never traverse those collections during model projection.
  assertClosedKeys(packet, [
    "schema_version", "artifact_type", "task_id", "repo", "base_commit",
    "index_sha256", "query_sha256", "parameters", "pass0", "pass1",
    "subsystem", "pass2", "lanes", "final_results", "unresolved_needs",
    "diagnostics", "provider_boundary"
  ], "renderer input");
  assertCondition(packet?.artifact_type === "wo047_two_pass_retrieval_packet", "renderer received a non-retrieval artifact");
  assertCondition(packet?.schema_version === 1, "renderer received an unsupported packet schema");
  for (const field of renderer.forbidden_top_level_fields) {
    assertCondition(!Object.hasOwn(packet, field), `renderer input contains forbidden evaluator field ${field}`);
  }
  assertClosedKeys(packet.parameters, Object.keys(FROZEN_PARAMETERS), "renderer input.parameters");
  assertClosedKeys(packet.provider_boundary, Object.keys(FROZEN_PROVIDER_BOUNDARY), "renderer input.provider_boundary");
  assertClosedKeys(packet.pass0, ["source", "baseline_result_count", "results_sha256", "retained_exact_order"], "renderer input.pass0");
  assertClosedKeys(packet.pass1, ["named_symbols", "definitions", "definition_lane_counts", "graph_evidence", "selected_graph_evidence_count"], "renderer input.pass1");
  assertClosedKeys(packet.pass1.definition_lane_counts, ["runtime", "test"], "renderer input.pass1.definition_lane_counts");
  assertClosedKeys(packet.subsystem, ["status", "anchors", "unresolved"], "renderer input.subsystem");
  assertClosedKeys(packet.pass2, ["query_sha256", "candidate_count", "additions_by_lane"], "renderer input.pass2");
  assertClosedKeys(packet.pass2.additions_by_lane, ["runtime", "test"], "renderer input.pass2.additions_by_lane");
  assertClosedKeys(packet.lanes, ["runtime", "test"], "renderer input.lanes");
  assertBoundedArray(packet.final_results, contract.parameters.final_result_max, "renderer input.final_results");
  assertBoundedArray(packet.pass1.named_symbols, contract.parameters.final_result_max, "renderer input.pass1.named_symbols");
  assertBoundedArray(packet.pass1.definitions, contract.parameters.definition_limit, "renderer input.pass1.definitions");
  assertBoundedArray(packet.pass1.graph_evidence, MODEL_FACING_LIMITS.audit_graph_records, "renderer input.pass1.graph_evidence");
  assertBoundedArray(packet.subsystem.anchors, contract.parameters.subsystem_anchor_limit, "renderer input.subsystem.anchors");
  assertBoundedArray(packet.subsystem.unresolved, contract.parameters.final_result_max, "renderer input.subsystem.unresolved");
  assertBoundedArray(packet.lanes.runtime, contract.parameters.runtime_lane_max, "renderer input.lanes.runtime");
  assertBoundedArray(packet.lanes.test, contract.parameters.test_lane_max, "renderer input.lanes.test");
  assertBoundedArray(packet.unresolved_needs, contract.parameters.final_result_max, "renderer input.unresolved_needs");
  assertBoundedRecordFields(packet.diagnostics, MODEL_FACING_LIMITS.diagnostic_fields, "renderer input.diagnostics");

  // graph_evidence, lanes, and diagnostics are private audit data: their
  // shallow bounds above are checked, but their elements and values are never
  // read. The projectors below recursively validate only known, bounded fields
  // and reject unknown/evaluator keys before reading their values.
  const modelFacingFields = [
    "schema_version", "artifact_type", "task_id", "repo", "base_commit",
    "index_sha256", "query_sha256", "parameters", "pass0", "subsystem",
    "pass2", "final_results", "unresolved_needs", "provider_boundary"
  ];
  assertCondition(
    [...modelFacingFields, "pass1"].every((field) => renderer.allowed_top_level_fields.includes(field)),
    "renderer contract does not allow the bounded model-facing projection"
  );
  assertCondition(canonicalJson(packet.parameters) === canonicalJson(FROZEN_PARAMETERS), "renderer input parameters changed");
  assertCondition(canonicalJson(packet.provider_boundary) === canonicalJson(FROZEN_PROVIDER_BOUNDARY), "renderer input provider boundary changed");

  const finalResults = packet.final_results.map((entry, index) => projectFinalResult(entry, `renderer input.final_results[${index}]`));
  assertCondition(
    finalResults.filter((entry) => entry.selected_lane === "runtime").length <= contract.parameters.runtime_lane_max,
    "renderer input exceeds runtime-lane bound"
  );
  assertCondition(
    finalResults.filter((entry) => entry.selected_lane === "test").length <= contract.parameters.test_lane_max,
    "renderer input exceeds test-lane bound"
  );
  const allDefinitions = packet.pass1.definitions.map((entry, index) => projectDefinition(entry, `renderer input.pass1.definitions[${index}]`));
  const subsystemAnchors = packet.subsystem.anchors.map((entry, index) => projectSubsystemAnchor(entry, `renderer input.subsystem.anchors[${index}]`));
  const selectedPaths = new Set(finalResults.map((entry) => entry.path));
  const selectedGraphEvidence = finalResults
    .filter((entry) => entry.selected_by_pass === 1 && Array.isArray(entry.relation_path))
    .map((entry) => ({
      path: entry.path,
      entity_id: entry.entity_id,
      symbol: entry.symbol,
      span: entry.span,
      evidence_role: entry.evidence_role,
      seed_definition_id: entry.seed_definition_id,
      relation_path: entry.relation_path,
      selection_reason: entry.selection_reason
    }))
    .map((entry, index) => assertProjectedRecordSize(entry, `renderer selected_graph_evidence[${index}]`));
  const selectedDefinitions = allDefinitions.filter((definition) => selectedPaths.has(definition.path));
  assertCondition(selectedDefinitions.length <= contract.parameters.definition_limit, "renderer definition projection exceeds bound");
  assertCondition(selectedGraphEvidence.length <= contract.parameters.final_result_max, "renderer graph projection exceeds bound");
  const projection = {
    schema_version: 1,
    artifact_type: "wo047_two_pass_retrieval_packet",
    task_id: boundedString(packet.task_id, "renderer input.task_id"),
    repo: boundedString(packet.repo, "renderer input.repo"),
    base_commit: boundedString(packet.base_commit, "renderer input.base_commit"),
    index_sha256: boundedString(packet.index_sha256, "renderer input.index_sha256"),
    query_sha256: boundedString(packet.query_sha256, "renderer input.query_sha256"),
    parameters: FROZEN_PARAMETERS,
    pass0: {
      source: boundedString(packet.pass0.source, "renderer input.pass0.source"),
      baseline_result_count: boundedInteger(packet.pass0.baseline_result_count, "renderer input.pass0.baseline_result_count"),
      results_sha256: boundedString(packet.pass0.results_sha256, "renderer input.pass0.results_sha256"),
      retained_exact_order: (() => {
        assertCondition(packet.pass0.retained_exact_order === true, "renderer input.pass0 prefix is not retained");
        return true;
      })()
    },
    pass1: {
      named_symbols: boundedStringArray(packet.pass1.named_symbols, "renderer input.pass1.named_symbols"),
      definitions: selectedDefinitions,
      definition_lane_counts: {
        runtime: selectedDefinitions.filter((definition) => definition.lane === "runtime").length,
        test: selectedDefinitions.filter((definition) => definition.lane === "test").length
      },
      selected_graph_evidence: selectedGraphEvidence
    },
    subsystem: {
      status: boundedString(packet.subsystem.status, "renderer input.subsystem.status"),
      anchors: subsystemAnchors,
      unresolved: boundedStringArray(packet.subsystem.unresolved, "renderer input.subsystem.unresolved")
    },
    pass2: {
      query_sha256: boundedString(packet.pass2.query_sha256, "renderer input.pass2.query_sha256"),
      candidate_count: boundedInteger(packet.pass2.candidate_count, "renderer input.pass2.candidate_count"),
      additions_by_lane: {
        runtime: boundedInteger(packet.pass2.additions_by_lane.runtime, "renderer input.pass2.additions_by_lane.runtime"),
        test: boundedInteger(packet.pass2.additions_by_lane.test, "renderer input.pass2.additions_by_lane.test")
      }
    },
    final_results: finalResults,
    unresolved_needs: boundedStringArray(packet.unresolved_needs, "renderer input.unresolved_needs"),
    provider_boundary: FROZEN_PROVIDER_BOUNDARY
  };
  projection.pass1 = {
    named_symbols: projection.pass1.named_symbols,
    definitions: selectedDefinitions,
    definition_lane_counts: projection.pass1.definition_lane_counts,
    selected_graph_evidence: selectedGraphEvidence
  };
  assertCondition(projection.task_id && projection.query_sha256 && Array.isArray(projection.final_results), "renderer input is missing required retrieval fields");
  const payload = canonicalJson(projection);
  const bytes = Buffer.byteLength(payload, "utf8");
  assertCondition(bytes <= MODEL_FACING_LIMITS.decoded_payload_utf8_bytes, "renderer decoded payload exceeds total byte bound");
  const payloadSha256 = sha256Bytes(payload);
  const encodedBytes = 4 * Math.ceil(bytes / 3);
  const envelopeWithoutPayload = [
    renderer.untrusted_data_directive,
    renderer.frame_open,
    `renderer_version=${renderer.renderer_version}`,
    `encoding=${renderer.encoding}`,
    `payload_bytes=${bytes}`,
    `payload_sha256=${payloadSha256}`,
    "",
    renderer.frame_close
  ].join("\n");
  assertCondition(
    Buffer.byteLength(envelopeWithoutPayload, "utf8") + encodedBytes <= MODEL_FACING_LIMITS.frame_utf8_bytes,
    "renderer frame exceeds total byte bound"
  );
  const encoded = Buffer.from(payload, "utf8").toString("base64");
  const frame = [
    renderer.untrusted_data_directive,
    renderer.frame_open,
    `renderer_version=${renderer.renderer_version}`,
    `encoding=${renderer.encoding}`,
    `payload_bytes=${bytes}`,
    `payload_sha256=${payloadSha256}`,
    encoded,
    renderer.frame_close
  ].join("\n");
  assertCondition(Buffer.byteLength(frame, "utf8") <= MODEL_FACING_LIMITS.frame_utf8_bytes, "renderer frame exceeds total byte bound");
  return frame;
}

function issueNamesSymbol(query, symbol) {
  const candidates = [symbol, symbol.split(/\.|::/u).at(-1)];
  return candidates.some((candidate) => candidate.length >= 4 && new RegExp(`(^|[^A-Za-z0-9_$])${candidate.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}([^A-Za-z0-9_$]|$)`, "u").test(query));
}

function diagnosticPath(surface) {
  return String(surface).split("::", 1)[0];
}

export function scorePackets({ fixture, selectedInputs, packets }) {
  const inputsById = new Map(selectedInputs.map((entry) => [entry.task.task_id, entry]));
  const taskScores = [];
  let primaryFound = 0;
  let primaryTotal = 0;
  let namedSymbolsFound = 0;
  let namedSymbolsTotal = 0;
  let regressionFound = 0;
  let regressionTotal = 0;

  for (const fixtureTask of fixture.tasks) {
    const packet = packets.find((candidate) => candidate.task_id === fixtureTask.task_id);
    const input = inputsById.get(fixtureTask.task_id);
    assertCondition(packet && input, `missing scorer input for ${fixtureTask.task_id}`);
    const firstRankByPath = new Map();
    packet.final_results.forEach((result, index) => {
      if (!firstRankByPath.has(result.path)) firstRankByPath.set(result.path, index + 1);
    });
    const primary = fixtureTask.primary_runtime_files.map((entry) => ({
      path: entry.path,
      found: firstRankByPath.has(entry.path),
      first_rank: firstRankByPath.get(entry.path) ?? null
    }));
    primaryFound += primary.filter((entry) => entry.found).length;
    primaryTotal += primary.length;

    const namedSymbolJudgments = fixtureTask.primary_runtime_files.flatMap((entry) =>
      entry.symbols.filter((symbol) => issueNamesSymbol(input.task.query_text, symbol)).map((symbol) => ({ path: entry.path, symbol }))
    );
    const exactDefinitions = namedSymbolJudgments.map((judgment) => ({
      ...judgment,
      found: packet.pass1.definitions.some((definition) =>
        definition.match_class === "exact" && definition.path === judgment.path &&
        (definition.symbol === judgment.symbol || definition.symbol === judgment.symbol.split(/\.|::/u).at(-1) || judgment.symbol.endsWith(`.${definition.symbol}`))
      )
    }));
    namedSymbolsFound += exactDefinitions.filter((entry) => entry.found).length;
    namedSymbolsTotal += exactDefinitions.length;

    const regressionSurfaces = fixtureTask.mechanism_rubric.regression_surface ??
      (fixtureTask.mechanism_rubric.diagnostic_surfaces ?? []).filter((entry) => isTestPath(diagnosticPath(entry)));
    const regression = regressionSurfaces.map((surface) => ({
      surface,
      path: diagnosticPath(surface),
      found: firstRankByPath.has(diagnosticPath(surface)),
      first_rank: firstRankByPath.get(diagnosticPath(surface)) ?? null
    }));
    regressionFound += regression.filter((entry) => entry.found).length;
    regressionTotal += regression.length;

    const baseline = input.baselinePacket.results;
    const retained = canonicalJson(packet.final_results.slice(0, baseline.length).map(({ final_rank: _rank, ...result }) => result)) === canonicalJson(baseline);
    taskScores.push({
      task_id: fixtureTask.task_id,
      primary_runtime: primary,
      primary_found: primary.filter((entry) => entry.found).length,
      primary_total: primary.length,
      first_primary_rank: Math.min(...primary.map((entry) => entry.first_rank ?? Number.POSITIVE_INFINITY)) || null,
      no_zero_owner_gate: primary.some((entry) => entry.found),
      exact_named_definitions: exactDefinitions,
      regression_test_surfaces: regression,
      caller_recall: { found: null, total: 0, reason: "fixture freezes no exhaustive accepted-caller denominator" },
      barrel_reexport_recall: { found: null, total: 0, reason: "fixture freezes no exhaustive barrel/re-export denominator" },
      lifecycle_owner_recall: { found: null, total: 0, reason: "fixture freezes no exhaustive lifecycle-owner denominator" },
      prefix_retained_exact_order: retained,
      additions_by_pass: packet.diagnostics.additions_by_pass,
      additions_by_lane: packet.pass2.additions_by_lane,
      unresolved_needs: packet.unresolved_needs,
      duplicates_prevented: packet.diagnostics.duplicates_prevented,
      false_positives: null,
      unjudged_selected_paths: packet.final_results.filter((result) => !fixtureTask.primary_runtime_files.some((primaryEntry) => primaryEntry.path === result.path)).length,
      false_positive_limitation: "the frozen fixture is positive/mechanism-grounded but not an exhaustive path-relevance negative judgment set"
    });
  }

  const allPrefixesRetained = taskScores.every((task) => task.prefix_retained_exact_order);
  const noZeroOwners = taskScores.every((task) => task.no_zero_owner_gate);
  const primaryGate = primaryFound >= fixture.acceptance_denominators.minimum_primary_runtime_files_retrieved;
  return {
    schema_version: 1,
    artifact_type: "wo047_two_pass_stage1_offline_score",
    fixture_file_sha256: sha256File(resolveRepoPath("benchmark/bootstrapbench/results/wo047-two-pass-stage1/frozen-fixture-v1.json")),
    aggregate: {
      primary_runtime_files_found: primaryFound,
      primary_runtime_files_total: primaryTotal,
      primary_runtime_recall: primaryTotal === 0 ? null : Number((primaryFound / primaryTotal).toFixed(6)),
      exact_named_symbol_definitions_found: namedSymbolsFound,
      exact_named_symbol_definitions_total: namedSymbolsTotal,
      exact_named_symbol_definition_recall: namedSymbolsTotal === 0 ? null : Number((namedSymbolsFound / namedSymbolsTotal).toFixed(6)),
      regression_test_surfaces_found: regressionFound,
      regression_test_surfaces_total: regressionTotal,
      regression_test_surface_recall: regressionTotal === 0 ? null : Number((regressionFound / regressionTotal).toFixed(6)),
      all_original_query_prefixes_retained: allPrefixesRetained,
      zero_owner_issue_count: taskScores.filter((task) => !task.no_zero_owner_gate).length,
      primary_7_of_10_gate: primaryGate,
      no_zero_owner_gate: noZeroOwners,
      offline_primary_gates_passed: primaryGate && noZeroOwners && allPrefixesRetained
    },
    tasks: taskScores,
    provider_boundary: { planner_calls: 0, solution_model_calls: 0, provider_calls: 0 },
    stage2_prepared_or_launched: false
  };
}

export function buildStage1Artifacts(contractPath = DEFAULT_CONTRACT_PATH) {
  const contractBinding = loadAndValidateContract(contractPath);
  const fixtureBinding = loadAndValidateFixture(contractBinding.contract);
  const packetSetBinding = loadAndValidatePacketSet(contractBinding.contract, fixtureBinding.fixture);
  const packets = packetSetBinding.selected.map(({ task, baselinePacket }) => {
    const index = loadTaskIndex(task, contractBinding.contract);
    return retrieveTask({ task, baselinePacket, index, contract: contractBinding.contract });
  });
  const retrievalArtifact = {
    schema_version: 1,
    artifact_type: "wo047_two_pass_stage1_retrieval_packets",
    contract_file_sha256: contractBinding.file_sha256,
    fixture_file_sha256: fixtureBinding.file_sha256,
    fixture_payload_sha256: fixtureBinding.payload_sha256,
    source_packet_set_file_sha256: packetSetBinding.file_sha256,
    packet_count: packets.length,
    packets,
    provider_boundary: contractBinding.contract.provider_boundary,
    stage2_prepared_or_launched: false
  };
  retrievalArtifact.retrieval_payload_sha256 = sha256Bytes(canonicalJson(retrievalArtifact));
  const score = scorePackets({ fixture: fixtureBinding.fixture, selectedInputs: packetSetBinding.selected, packets });
  score.retrieval_payload_sha256 = retrievalArtifact.retrieval_payload_sha256;
  score.score_payload_sha256 = sha256Bytes(canonicalJson(score));
  return { retrievalArtifact, score, bindings: { contractBinding, fixtureBinding, packetSetBinding } };
}

function parseCli(argv) {
  const options = { contract: DEFAULT_CONTRACT_PATH, output: null, scoreOutput: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--contract") options.contract = argv[++index];
    else if (arg === "--output") options.output = argv[++index];
    else if (arg === "--score-output") options.scoreOutput = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  assertCondition(options.output && options.scoreOutput, "--output and --score-output are required");
  return options;
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseCli(process.argv.slice(2));
  const started = process.hrtime.bigint();
  const memoryBefore = process.memoryUsage().rss;
  const { retrievalArtifact, score } = buildStage1Artifacts(options.contract);
  atomicWriteJson(path.resolve(options.output), retrievalArtifact);
  atomicWriteJson(path.resolve(options.scoreOutput), score);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const memoryAfter = process.memoryUsage().rss;
  process.stdout.write(`${JSON.stringify({
    ok: true,
    retrieval_payload_sha256: retrievalArtifact.retrieval_payload_sha256,
    score_payload_sha256: score.score_payload_sha256,
    offline_primary_gates_passed: score.aggregate.offline_primary_gates_passed,
    primary_runtime: `${score.aggregate.primary_runtime_files_found}/${score.aggregate.primary_runtime_files_total}`,
    zero_owner_issue_count: score.aggregate.zero_owner_issue_count,
    latency_ms: Number(elapsedMs.toFixed(3)),
    rss_before_bytes: memoryBefore,
    rss_after_bytes: memoryAfter,
    output: path.resolve(options.output),
    score_output: path.resolve(options.scoreOutput)
  })}\n`);
}
