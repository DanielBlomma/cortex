#!/usr/bin/env node

/**
 * Reconstruct the immutable WO-048 alternative-five fixture from frozen
 * WO-045/WO-047 sources. This is an offline audit utility: it performs no
 * retrieval, planner, model, provider, or agent call.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORTEX_ROOT = path.resolve(HERE, "../..");
const AGENTSTACK_ROOT = process.env.WO048_AGENTSTACK_ROOT
  ? path.resolve(process.env.WO048_AGENTSTACK_ROOT)
  : path.resolve(CORTEX_ROOT, "../AgentStackBench");
const OUT_DIR = path.join(HERE, "fixtures", "wo048-clean-five-v1");
const FIXTURE_PATH = path.join(OUT_DIR, "frozen-fixture-v1.json");
const REPORT_PATH = path.join(CORTEX_ROOT, "docs/agent-control/wo048-alternative-five-fixture-report.md");
const ATTESTATION_PATH = path.join(OUT_DIR, "artifact-attestation-v1.json");

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const ORIGINAL_BINDING = path.join(
  CORTEX_ROOT,
  "benchmark/bootstrapbench/results/wo045-role-grounded-stage2/frozen-task-input-bindings-v1.json",
);
const V10Y_ROOT = path.join(AGENTSTACK_ROOT, "results/run_suites/wo045-frozen-inputs-v10y");
const V10Y_MANIFEST = path.join(V10Y_ROOT, "manifest.json");
const V10Y_PACKET_SET = path.join(V10Y_ROOT, "packet-set-v10y.json");
const V10Y_RUN_ROOT = path.join(
  AGENTSTACK_ROOT,
  "results/run_suites/codex-cortex-wo045-role-grounded-stage2-v10y",
);
const V9_RUN_ROOT = path.join(
  AGENTSTACK_ROOT,
  "results/run_suites/codex-cortex-wo045-role-grounded-stage2-v9",
);
const FULL_PARQUET = path.join(AGENTSTACK_ROOT, "data/full.parquet");

const EXPECTED_HASHES = Object.freeze({
  original_binding: "423a790a09bddb1a94764ab617591185f303f1e59652e51ecfddee14de46442d",
  full_parquet: "2f56535bdc73eb8a68bf4ebb49789d8e9cd4f219ea60df6290b85278aee61ca8",
  v10y_manifest: "8252aa01a11e9459ed347bc6fc706601bcf1e6dc5e1ac356f576de4d985faa23",
  v10y_packet_set: "896bf6b19a4685b811a2bf5749f310174341bb4025cdf72a7bde0a10de481d65",
  wo047_quick_report: "7e5729f83e24ae9f25d77bf8b70bb6a42d5d8df7a2143b788d41851ed6a82c9e",
  wo047_bridge: "cfe4933c1497d11adde9ba7162dfdfd53d84071a025edad8d746d1793fe880fe",
  wo047_fixture: "af51a243ec396869f3348645de1faea59310e5eaac2547817480b769dac3148d",
  v9_manifest: "8a5e16a516446ed1ac6d50d768ff3ad34fc7fef856315057d01ef3635483e50a",
  v9_control_results: "7bb8109956bd0f676103d188da92f5517a58b097d35239ebe024f22907f81571",
  v9_treatment_results: "a0f481b24f33bef304b16f015bc1e3f2a07d6972e8d5ed0bf1e351196f3dba85",
  v9_nonempty_raw_response: "48a3e5e91cfac96826e40763cf69d14450ec8b34e8b16afa2a30429463165dac",
});

const QUICK_FIVE = Object.freeze([
  "Multi-SWE-Bench__rust__maintenance__bugfix__37f525d2",
  "SWE-Bench-Pro__python__maintenance__bugfix__512d556b",
  "SWE-Bench-Pro__javascript__maintenance__bugfix__09eb0d6d",
  "SWE-PolyBench__python__maintenance__bugfix__8c189fda",
  "SWE-Bench-Verified__python__maintenance__bugfix__e09a2d75",
]);
const V9_CONTAMINATED = Object.freeze([
  "Multi-SWE-Bench__c__maintenance__bugfix__5dc9809e",
  "Multi-SWE-Bench__java__maintenance__bugfix__747c7f60",
]);
const EXPECTED_REMAINING = Object.freeze([
  "SWE-PolyBench__javascript__maintenance__bugfix__10ab7842",
  "SWE-PolyBench__typescript__maintenance__bugfix__4f3cb6be",
  "SWE-Bench-Pro__go__maintenance__bugfix__720b4d92",
  "SWE-Bench-Verified__python__maintenance__bugfix__27320d49",
  "SWE-Bench-Verified__python__maintenance__bugfix__ac705f35",
]);
const QUICK_PATCHES = Object.freeze([
  { task_id: QUICK_FIVE[0], path: "01-clap.patch", bytes: 3411, sha256: "90ded64208eafb9a84aafbcc6b2c3a91c6c71c4dbaaa06ed4076411ec8e06ff6" },
  { task_id: QUICK_FIVE[1], path: "02-ansible.patch", bytes: 2695, sha256: "83ffc282b29468f3e048b5bee887177f03472269e1593aeaede736622ffcdac0" },
  { task_id: QUICK_FIVE[2], path: "03-nodebb.patch", bytes: 23718, sha256: "3a9c29130db26186790e480510291cb01392913e49a8670308cfe4e9d86981fd" },
  { task_id: QUICK_FIVE[3], path: "04-keras.patch", bytes: 1128, sha256: "460dcedec895105ae6f324420b865289efcfb3a5cd48bd5492c4ca1e5029bfa8" },
  { task_id: QUICK_FIVE[4], path: "05-sympy.patch", bytes: 1660, sha256: "5d12af0c8c91581d6c3a6926e92a439964b6e15a686c83de57a0defa5b1cdb9a" },
]);

const TASK_JUDGMENTS = Object.freeze({
  "SWE-PolyBench__typescript__maintenance__bugfix__4f3cb6be": {
    primary_runtime_files: [
      {
        path: "src/vs/editor/common/controller/cursorTypeOperations.ts",
        base_git_blob_oid: "3f2e81ed0e1bac15e8901dcaf1a6b8bb1060717c",
        base_bytes: 40745,
        base_sha256: "7ef71c3801d7f23ebebaabfe2e40ae86101008ea407c070124e71d0db03f4d7d",
        symbols: ["TypeOperations._getAutoClosingPairClose"],
        rationale: "Owns the quote/backtick word-character auto-closing decision changed by the gold patch.",
      },
    ],
    mechanism_rubric: {
      rubric_id: "vscode-tagged-template-backtick-v1",
      close_requires: [
        "Restrict the after-word suppression to single and double quotes rather than every character classified as a quote.",
        "Allow a backtick typed after an identifier in a tagged template literal to auto-close.",
        "Cover the reported backtick-after-word regression without weakening the existing single/double-quote rule.",
      ],
      regression_surface: ["src/vs/editor/test/browser/controller/cursor.test.ts::issue #61070"],
    },
    issue_quality: {
      scores: { behavior_specificity: 2, scope_specificity: 2, named_symbols_or_files: 1, reproducible_expected_result: 2 },
      rationale: "Names tagged template literals and platforms, supplies concrete typed text, observed triple-backtick behavior, and the expected cursor/pair result; it names no internal file or symbol.",
    },
  },
  "SWE-PolyBench__javascript__maintenance__bugfix__10ab7842": {
    primary_runtime_files: [
      {
        path: "src/printer.js",
        base_git_blob_oid: "2468bbdba1f5bcf37acdc602e98ef5aba051183a",
        base_bytes: 66565,
        base_sha256: "b3063dfe84fed82e48575525fae37579d88db81ed742b07ce84fe2c4875169b0",
        symbols: ["printExportDeclaration"],
        rationale: "Owns formatting of export declaration specifiers and the incorrect brace insertion.",
      },
    ],
    mechanism_rubric: {
      rubric_id: "prettier-export-extension-specifier-v1",
      close_requires: [
        "Recognize a single ExportDefaultSpecifier or ExportNamespaceSpecifier as export-extension syntax.",
        "Print that specifier directly instead of routing it through the braced named-specifier branch.",
        "Preserve both `export v from` and `export * as ns from` semantics under the Babylon parser.",
      ],
      regression_surface: ["tests/export_extension/export.js", "tests/export_extension/jsfmt.spec.js"],
    },
    issue_quality: {
      scores: { behavior_specificity: 2, scope_specificity: 2, named_symbols_or_files: 1, reproducible_expected_result: 2 },
      rationale: "Provides exact input and incorrect output and explains the semantic change; it identifies syntax/tool scope but no internal symbol or file.",
    },
  },
  "SWE-Bench-Verified__python__maintenance__bugfix__27320d49": {
    primary_runtime_files: [
      {
        path: "sklearn/impute/_iterative.py",
        base_git_blob_oid: "1d918bc0c46433a93d4eaa3283eab1820039e528",
        base_bytes: 34743,
        base_sha256: "0798fb974d439441ad7553e174750ec4c6a51f6a7e2eb4555210a27f900c0e7f",
        symbols: ["IterativeImputer", "IterativeImputer._initial_imputation"],
        rationale: "Owns the public estimator parameter and construction of the initial SimpleImputer.",
      },
    ],
    mechanism_rubric: {
      rubric_id: "sklearn-iterative-imputer-fill-value-v1",
      close_requires: [
        "Add fill_value to IterativeImputer's public constructor, stored state, parameter constraints, and documentation.",
        "Pass fill_value to the SimpleImputer created for initial imputation.",
        "Support an arbitrary object/no-validation contract, including np.nan, while retaining SimpleImputer defaults when None.",
      ],
      regression_surface: ["sklearn/impute/tests/test_impute.py::test_iterative_imputer_constant_fill_value"],
    },
    issue_quality: {
      scores: { behavior_specificity: 2, scope_specificity: 2, named_symbols_or_files: 2, reproducible_expected_result: 2 },
      rationale: "Names both estimator classes and parameters, explains the initialization workflow, and states the constant and np.nan compatibility requirements.",
    },
  },
  "SWE-Bench-Verified__python__maintenance__bugfix__ac705f35": {
    primary_runtime_files: [
      {
        path: "django/db/backends/base/schema.py",
        base_git_blob_oid: "ad2f5a7da10b944ada60a32b99007a6a3f9d28d9",
        base_bytes: 62884,
        base_sha256: "6fd43ec87a3a4e8c2315aa6a1559839d8acc1d560b362381736fd21683e2a5da",
        symbols: ["BaseDatabaseSchemaEditor._create_unique_sql"],
        rationale: "Owns construction of the Statement, Columns, Expressions, and Table objects whose identity drives reference checks.",
      },
    ],
    mechanism_rubric: {
      rubric_id: "django-create-unique-reference-identity-v1",
      close_requires: [
        "Keep the table name as a string while constructing IndexName, Columns, and Expressions.",
        "Wrap the string in Table only for the Statement table field.",
        "Make the generated unique-constraint statement report true for both references_table(table) and references_column(table, column).",
      ],
      regression_surface: ["tests/schema/tests.py::SchemaTests.test_unique_constraint"],
    },
    issue_quality: {
      scores: { behavior_specificity: 2, scope_specificity: 1, named_symbols_or_files: 2, reproducible_expected_result: 1 },
      rationale: "Names _create_unique_sql, references_column, Table, and Columns and states the type mismatch, but gives no runnable setup or concrete SQL example.",
    },
  },
  "SWE-Bench-Pro__go__maintenance__bugfix__720b4d92": {
    primary_runtime_files: [
      {
        path: "models/scanresults.go",
        base_git_blob_oid: "f77c380a34245f8f8dc68ff3eec70b4d8c73e74a",
        base_bytes: 15456,
        base_sha256: "aea4187601a5df7f2a208c2051bd8fbebfdf7bc17e4c172ead4cf9f365d035f5",
        symbols: ["ScanResult.RemoveRaspbianPackFromResult"],
        rationale: "Defines the issue-named filtering behavior and return type.",
      },
      {
        path: "detector/detector.go",
        base_git_blob_oid: "26898e152160caf553d4152ffe4758bcc07e14bb",
        base_bytes: 14321,
        base_sha256: "d887ef57e42f4ece837fa87d7a56b2a877e29f179dddc4e656f3c6aa1dd65318",
        symbols: ["DetectPkgCves"],
        rationale: "Gold moves the Raspbian filtering lifecycle to the common package-CVE detection entrypoint.",
      },
      {
        path: "oval/debian.go",
        base_git_blob_oid: "c843fb2d770a1b030e19520c7ef839280d922027",
        base_bytes: 12725,
        base_sha256: "a95de97f3af19ba380128f54fe9546e0ebba6f9807afbd504ae38fd0b0220634",
        symbols: ["Debian.FillWithOval"],
        rationale: "Gold removes its duplicate local copy/filter path after filtering is centralized at the caller.",
      },
    ],
    mechanism_rubric: {
      rubric_id: "vuls-raspbian-filter-pointer-lifecycle-v1",
      close_requires: [
        "Return *ScanResult from RemoveRaspbianPackFromResult for both Raspbian and non-Raspbian families while preserving copy-on-filter behavior.",
        "Apply Raspbian package filtering once at the common DetectPkgCves lifecycle before OVAL and gost consume the result.",
        "Remove the duplicate Raspbian filtering/address conversion inside Debian OVAL handling and exercise both Raspbian and Debian cases.",
      ],
      accepted_equivalence: "Equivalent pointer-safe centralization is accepted if both detectors receive the correctly filtered result and non-Raspbian packages are unchanged.",
      gold_scope_note: "The gold patch also changes broader gost fixed/unfixed-CVE behavior not specified by this issue; those unrelated changes are not required by this rubric.",
      regression_surface: ["models/scanresults_test.go::TestRemoveRaspbianPackFromResult"],
    },
    issue_quality: {
      scores: { behavior_specificity: 0, scope_specificity: 1, named_symbols_or_files: 2, reproducible_expected_result: 0 },
      rationale: "Names the function and ScanResult model, but actual and expected behavior merely say the pointer/packages should be updated 'appropriately' and provide no input, excluded-package rule, observable output, or reproduction.",
    },
  },
});

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return sha256Bytes(fs.readFileSync(filePath));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJsonSha256(value) {
  return sha256Bytes(JSON.stringify(canonicalize(value)));
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

function assertFileHash(filePath, expected, label) {
  assertEqual(sha256File(filePath), expected, label);
}

function gitValue(gitDir, args) {
  return execFileSync("git", [`--git-dir=${gitDir}`, ...args], { encoding: "utf8" }).trim();
}

function gitFileBytes(gitDir, commit, filePath) {
  return execFileSync("git", [`--git-dir=${gitDir}`, "show", `${commit}:${filePath}`]);
}

function repoCache(taskId) {
  return path.join(
    AGENTSTACK_ROOT,
    ".cache/repos/wo045-heldout",
    `${taskId.replaceAll("__", "_").replaceAll("-", "-")}.git`,
  );
}

function allFiles(root) {
  const found = [];
  if (!fs.existsSync(root)) return found;
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) found.push(full);
    }
  };
  visit(root);
  return found;
}

function qualityResult(record) {
  const scores = record.issue_quality.scores;
  const total = Object.values(scores).reduce((sum, value) => sum + value, 0);
  const passes = total >= 6 && scores.behavior_specificity >= 1 && scores.reproducible_expected_result >= 1;
  return { ...record.issue_quality, total, maximum: 8, passes };
}

function verifyPrimaryFile(task, file) {
  const gitDir = repoCache(task.task_id);
  const actualTree = gitValue(gitDir, ["rev-parse", `${task.base_commit}^{tree}`]);
  assertEqual(actualTree, task.repository_root_tree_git_oid, `${task.task_id} root tree`);
  assertEqual(gitValue(gitDir, ["rev-parse", `${task.base_commit}:${file.path}`]), file.base_git_blob_oid, `${task.task_id} ${file.path} blob`);
  const bytes = gitFileBytes(gitDir, task.base_commit, file.path);
  assertEqual(bytes.length, file.base_bytes, `${task.task_id} ${file.path} bytes`);
  assertEqual(sha256Bytes(bytes), file.base_sha256, `${task.task_id} ${file.path} sha256`);
}

assertFileHash(ORIGINAL_BINDING, EXPECTED_HASHES.original_binding, "original WO-045 binding");
assertFileHash(FULL_PARQUET, EXPECTED_HASHES.full_parquet, "full.parquet");
assertFileHash(V10Y_MANIFEST, EXPECTED_HASHES.v10y_manifest, "V10y manifest");
assertFileHash(V10Y_PACKET_SET, EXPECTED_HASHES.v10y_packet_set, "V10y packet set");

const binding = JSON.parse(fs.readFileSync(ORIGINAL_BINDING, "utf8"));
const v10y = JSON.parse(fs.readFileSync(V10Y_MANIFEST, "utf8"));
assertEqual(binding.task_count, 12, "original task count");
assertEqual(binding.tasks.length, 12, "original binding row count");
assertEqual(v10y.tasks.length, 12, "V10y task count");

const originalIds = binding.tasks.map((task) => task.instance_id);
const excluded = new Set([...QUICK_FIVE, ...V9_CONTAMINATED]);
const remaining = originalIds.filter((taskId) => !excluded.has(taskId)).sort();
assertEqual(JSON.stringify(remaining), JSON.stringify([...EXPECTED_REMAINING].sort()), "exact remainder");
assertEqual(new Set([...QUICK_FIVE, ...V9_CONTAMINATED]).size, 7, "exclusion-set cardinality");

const bindingById = new Map(binding.tasks.map((task) => [task.instance_id, task]));
const v10yById = new Map(v10y.tasks.map((task) => [task.task_id, task]));
const tasks = EXPECTED_REMAINING.map((taskId) => {
  const source = bindingById.get(taskId);
  const frozen = v10yById.get(taskId);
  const judgment = TASK_JUDGMENTS[taskId];
  if (!source || !frozen || !judgment) throw new Error(`missing source for ${taskId}`);
  const issue = Buffer.from(frozen.query_text, "utf8");
  assertEqual(issue.length, source.problem_statement.bytes, `${taskId} issue bytes`);
  assertEqual(sha256Bytes(issue), source.problem_statement.sha256, `${taskId} issue hash`);
  assertEqual(frozen.query_sha256, source.problem_statement.sha256, `${taskId} query/issue binding`);
  assertEqual(frozen.base_commit, source.base_commit, `${taskId} commit binding`);
  assertEqual(frozen.repository_root_tree_git_oid, source.repository_root_tree_git_oid, `${taskId} root-tree binding`);
  for (const owner of judgment.primary_runtime_files) verifyPrimaryFile(frozen, owner);
  return {
    task_id: taskId,
    original_issue_id: frozen.original_instance_id,
    bench: frozen.bench,
    language: frozen.language,
    repo: frozen.repo,
    base_commit: frozen.base_commit,
    repository_root_tree_git_oid: frozen.repository_root_tree_git_oid,
    task_input_binding_sha256: frozen.task_input_binding_sha256,
    row_canonical_sha256: source.row_canonical_sha256,
    csv_row_canonical_sha256: source.csv_row_canonical_sha256,
    index_sha256: frozen.index_sha256,
    index_component_count: frozen.index_components.length,
    index_components_payload_sha256: canonicalJsonSha256(frozen.index_components),
    issue: {
      encoding: "utf8-base64",
      bytes: issue.length,
      sha256: sha256Bytes(issue),
      base64: issue.toString("base64"),
    },
    gold_context: source.gold_context,
    gold_patch: source.patch,
    test_patch: source.test_patch,
    primary_runtime_files: judgment.primary_runtime_files,
    mechanism_rubric: judgment.mechanism_rubric,
    issue_description_quality: qualityResult(judgment),
  };
});

const quickReport = path.join(CORTEX_ROOT, "docs/agent-control/wo047-quick-five-treatment-results.md");
const quickBridge = path.join(CORTEX_ROOT, "benchmark/bootstrapbench/results/wo047-stage2-bridge-v1/bridge-manifest-v1.json");
const quickFixture = path.join(CORTEX_ROOT, "benchmark/bootstrapbench/results/wo047-two-pass-stage1/frozen-fixture-v1.json");
assertFileHash(quickReport, EXPECTED_HASHES.wo047_quick_report, "WO-047 quick-five report");
assertFileHash(quickBridge, EXPECTED_HASHES.wo047_bridge, "WO-047 bridge");
assertFileHash(quickFixture, EXPECTED_HASHES.wo047_fixture, "WO-047 fixture");
const bridge = JSON.parse(fs.readFileSync(quickBridge, "utf8"));
assertEqual(
  JSON.stringify(bridge.tasks.map((task) => task.task_id).sort()),
  JSON.stringify([...QUICK_FIVE].sort()),
  "quick-five bridge IDs",
);
for (const patchRecord of QUICK_PATCHES) {
  const patchPath = path.join(
    CORTEX_ROOT,
    "benchmark/bootstrapbench/results/wo047-quick-five-treatment-v1",
    patchRecord.path,
  );
  assertEqual(fs.statSync(patchPath).size, patchRecord.bytes, `${patchRecord.task_id} quick patch bytes`);
  assertFileHash(patchPath, patchRecord.sha256, `${patchRecord.task_id} quick patch hash`);
}

const v9Manifest = path.join(V9_RUN_ROOT, "manifest.json");
const v9ControlResults = path.join(V9_RUN_ROOT, "variants/cortex-frozen-adaptive-control/task-results.jsonl");
const v9TreatmentResults = path.join(V9_RUN_ROOT, "variants/cortex-frozen-role-grounded-evidence/task-results.jsonl");
assertFileHash(v9Manifest, EXPECTED_HASHES.v9_manifest, "V9 manifest");
assertFileHash(v9ControlResults, EXPECTED_HASHES.v9_control_results, "V9 control results");
assertFileHash(v9TreatmentResults, EXPECTED_HASHES.v9_treatment_results, "V9 treatment results");
const v9Responses = [
  path.join(V9_RUN_ROOT, "variants/cortex-frozen-adaptive-control/agent_runs/codex/Multi/Multi-SWE-Bench__c__maintenance__bugfix__5dc9809e/raw-response.json"),
  path.join(V9_RUN_ROOT, "variants/cortex-frozen-role-grounded-evidence/agent_runs/codex/Multi/Multi-SWE-Bench__java__maintenance__bugfix__747c7f60/raw-response.json"),
];
for (const response of v9Responses) {
  assertEqual(fs.statSync(response).size, 76, `${response} nonempty size`);
  assertFileHash(response, EXPECTED_HASHES.v9_nonempty_raw_response, `${response} hash`);
}

const v10yOutputNames = allFiles(V10Y_RUN_ROOT).filter((file) =>
  ["codex-events.jsonl", "raw-response.json"].includes(path.basename(file)) || /prediction/i.test(path.basename(file)),
);
assertEqual(v10yOutputNames.length, 0, "V10y model-output artifact count");

const weakTasks = tasks.filter((task) => !task.issue_description_quality.passes).map((task) => task.task_id);
const fixture = {
  schema_version: 1,
  artifact_type: "wo048_alternative_five_immutable_fixture",
  fixture_id: "wo048-clean-remainder-five-v1",
  frozen_at: "2026-08-22",
  reviewer_identity: "/root/wo048_fixture",
  verdicts: {
    exact_clean_remainder: "GO",
    issue_description_quality: weakTasks.length === 0 ? "GO" : "NO-GO",
    launch_or_retrieval_authorization: "NO-GO",
    rationale: "Exactly five uncontaminated tasks remain, but every task must pass the predeclared issue-only quality screen; the Vuls task does not.",
  },
  source_bindings: {
    original_wo045_binding: { logical_path: "cortex/benchmark/bootstrapbench/results/wo045-role-grounded-stage2/frozen-task-input-bindings-v1.json", file_sha256: EXPECTED_HASHES.original_binding },
    agentstack_full_parquet: { logical_path: "AgentStackBench/data/full.parquet", file_sha256: EXPECTED_HASHES.full_parquet },
    wo045_v10y_manifest: { logical_path: "AgentStackBench/results/run_suites/wo045-frozen-inputs-v10y/manifest.json", file_sha256: EXPECTED_HASHES.v10y_manifest },
    wo045_v10y_packet_set: { logical_path: "AgentStackBench/results/run_suites/wo045-frozen-inputs-v10y/packet-set-v10y.json", file_sha256: EXPECTED_HASHES.v10y_packet_set },
    wo047_quick_report: { logical_path: "cortex/docs/agent-control/wo047-quick-five-treatment-results.md", file_sha256: EXPECTED_HASHES.wo047_quick_report },
    wo047_bridge: { logical_path: "cortex/benchmark/bootstrapbench/results/wo047-stage2-bridge-v1/bridge-manifest-v1.json", file_sha256: EXPECTED_HASHES.wo047_bridge },
    wo047_fixture: { logical_path: "cortex/benchmark/bootstrapbench/results/wo047-two-pass-stage1/frozen-fixture-v1.json", file_sha256: EXPECTED_HASHES.wo047_fixture },
    generator: { logical_path: "cortex/benchmark/bootstrapbench/wo048-freeze-clean-five.mjs", file_sha256: sha256File(fileURLToPath(import.meta.url)) },
  },
  selection_contract: {
    original_task_count: 12,
    excluded_wo047_quick_five: QUICK_FIVE,
    excluded_prior_nonempty_solution_or_provider_tasks: V9_CONTAMINATED,
    excluded_union_count: 7,
    exact_remainder_count: 5,
    rule: "Immutable set difference only; no sampling, replacement, retrieval inspection, or output-based selection.",
  },
  issue_description_quality_contract: {
    frozen_before_any_new_candidate_retrieval_or_model_output: true,
    gold_used_for_scoring: false,
    dimensions: {
      behavior_specificity: { 0: "No falsifiable behavior", 1: "Observable behavior but material ambiguity", 2: "Concrete actual behavior and failure mode" },
      scope_specificity: { 0: "Affected scope absent", 1: "Broad subsystem/scenario named", 2: "Affected conditions and boundaries are constrained" },
      named_symbols_or_files: { 0: "No concrete component", 1: "Product/syntax/domain component only", 2: "Exact API, symbol, parameter, class, function, or file" },
      reproducible_expected_result: { 0: "Neither reproducible input nor verifiable result", 1: "One of reproducible input or verifiable result", 2: "Both reproducible input/setup and verifiable expected result" },
    },
    pass_rule: "Total >= 6/8, behavior_specificity >= 1, and reproducible_expected_result >= 1.",
    required_for_five_issue_launch: "All five tasks pass.",
  },
  gold_judgment_contract: {
    primary_runtime_definition: "A production file directly owning the gold fix's steady-state behavior or the lifecycle relocation required by the issue.",
    evaluator_only: true,
    unavailable_to_future_retrieval_or_solution_agents: true,
    judgments_derived_from_new_candidate_output: false,
  },
  tasks,
  contamination_evidence: {
    wo047_quick_five: {
      exact_task_ids: QUICK_FIVE,
      treatment_patch_artifact_count: 5,
      treatment_patch_artifacts: QUICK_PATCHES,
      report_file_sha256: EXPECTED_HASHES.wo047_quick_report,
      excluded_before_remainder: true,
    },
    discarded_v9: {
      provider_model_calls: 2,
      exact_task_ids: V9_CONTAMINATED,
      nonempty_raw_response_count: 2,
      each_raw_response_bytes: 76,
      each_raw_response_sha256: EXPECTED_HASHES.v9_nonempty_raw_response,
      excluded_before_remainder: true,
    },
    v10y: {
      provider_model_calls: 0,
      nonempty_event_files: 0,
      raw_response_files: 0,
      prediction_files: 0,
      direct_named_output_artifact_count: v10yOutputNames.length,
    },
    selected_tasks_with_any_known_prior_solution_model_or_provider_call: 0,
    wo048_planner_calls: 0,
    wo048_solution_model_calls: 0,
    wo048_provider_calls: 0,
    wo048_retrieval_built_or_run: false,
    wo048_agents_launched: 0,
  },
  quality_summary: {
    passing_task_count: tasks.length - weakTasks.length,
    failing_task_count: weakTasks.length,
    failing_task_ids: weakTasks,
  },
};
fixture.fixture_payload_sha256 = canonicalJsonSha256(fixture);

fs.mkdirSync(OUT_DIR, { recursive: true });
if (fs.existsSync(FIXTURE_PATH)) fs.chmodSync(FIXTURE_PATH, 0o644);
fs.writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`, { flag: "w", mode: 0o444 });
const fixtureFileSha = sha256File(FIXTURE_PATH);

const rows = tasks.map((task) => {
  const q = task.issue_description_quality;
  return `| ${task.repo} | \`${task.task_id}\` | ${q.total}/8 | ${q.passes ? "Pass" : "Fail"} | \`${task.index_sha256}\` |`;
}).join("\n");
const report = `# WO-048 Alternative Five Fixture Audit\n\n## Disposition\n\n**NO-GO for a new five-issue retrieval or solution run.** The immutable set\ndifference is valid and contains exactly five tasks with no known prior\nsolution-model/provider call, but only four pass the issue-description-quality\nrubric frozen before any new candidate retrieval or model output was inspected.\nThe Vuls description fails because it does not state a falsifiable actual/expected\npackage result or a reproduction. No replacement exists inside the original\nWO-045 12-task binding after the seven mandatory exclusions.\n\n## Exact clean remainder\n\n| Repository | Task ID | Issue quality | Result | Frozen index SHA-256 |\n|---|---|---:|---|---|\n${rows}\n\nThe first four rows above pass the issue-only screen; Vuls scores 3/8 and fails.\n"Clean" here means uncontaminated, not automatically fit for a five-task run.\n\n## Frozen contracts\n\nThe fixture freezes exact UTF-8 issue bytes as base64 plus byte count and SHA-256,\nrepository commit/root-tree identity, aggregate/component index hashes, gold-derived\nprimary runtime owners with base blob/content hashes, and evaluator-only mechanism\nrubrics. Description quality uses only issue text across four 0-2 dimensions:\nbehavior specificity, scope specificity, named symbols/files, and reproducible\nexpected result. Passing requires total >=6, behavior >=1, and reproducibility >=1;\nall five must pass to authorize a five-issue run. Gold was not used for that score.\n\n## Contamination proof\n\nThe original immutable pool has 12 tasks. The five WO-047 quick-treatment task IDs\nwere removed first. Pony and Gson were independently removed because the discarded\nV9 evidence has one 76-byte nonempty raw response for each and the historical\nprovider/model-call count is two. Those seven IDs are disjoint, leaving exactly\nfive. V10y contributes zero provider/model calls and its frozen run tree contains\nno \`codex-events.jsonl\`, \`raw-response.json\`, or prediction file. WO-048 made\nzero planner/model/provider calls, built no retrieval, and launched no agents.\n\n## Immutable artifacts\n\n- Fixture: \`benchmark/bootstrapbench/fixtures/wo048-clean-five-v1/frozen-fixture-v1.json\`\n- Fixture canonical payload SHA-256: \`${fixture.fixture_payload_sha256}\`\n- Fixture file SHA-256: \`${fixtureFileSha}\`\n- Detached attestation: \`benchmark/bootstrapbench/fixtures/wo048-clean-five-v1/artifact-attestation-v1.json\`\n\nThe detached attestation binds the report file hash and has its own canonical\npayload hash. A file cannot truthfully embed its own byte hash, so file hashes are\nkept in the detached attestation while each JSON artifact self-binds its canonical\npayload.\n`;
fs.writeFileSync(REPORT_PATH, report, { flag: "w" });
const reportFileSha = sha256File(REPORT_PATH);
const attestation = {
  schema_version: 1,
  artifact_type: "wo048_fixture_artifact_attestation",
  fixture: {
    logical_path: "benchmark/bootstrapbench/fixtures/wo048-clean-five-v1/frozen-fixture-v1.json",
    file_sha256: fixtureFileSha,
    canonical_payload_sha256: fixture.fixture_payload_sha256,
  },
  report: {
    logical_path: "docs/agent-control/wo048-alternative-five-fixture-report.md",
    file_sha256: reportFileSha,
  },
};
attestation.attestation_payload_sha256 = canonicalJsonSha256(attestation);
if (fs.existsSync(ATTESTATION_PATH)) fs.chmodSync(ATTESTATION_PATH, 0o644);
fs.writeFileSync(ATTESTATION_PATH, `${JSON.stringify(attestation, null, 2)}\n`, { flag: "w", mode: 0o444 });

process.stdout.write(`${JSON.stringify({
  verdict: fixture.verdicts.launch_or_retrieval_authorization,
  clean_remainder: remaining,
  quality_failures: weakTasks,
  fixture_file_sha256: fixtureFileSha,
  fixture_payload_sha256: fixture.fixture_payload_sha256,
  report_file_sha256: reportFileSha,
  attestation_payload_sha256: attestation.attestation_payload_sha256,
}, null, 2)}\n`);
