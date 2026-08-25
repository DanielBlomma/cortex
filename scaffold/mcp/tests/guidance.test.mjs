import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { fileURLToPath } from "node:url";
import {
  GUIDANCE_GENERATOR_VERSION,
  GUIDANCE_LIMITS,
  GUIDANCE_SCHEMA_VERSION,
  canonicalGuidanceJson,
  formatGuidancePublicText,
  runGuidance,
  serializeGuidancePublicError,
  serializeGuidancePublicResponse,
  validateGuidanceData,
  validateGuidanceDataAgainstTask,
  validateGuidanceDataWithContext,
  validateGuidanceTaskInput,
} from "../dist/guidance.js";
import { validateGuidanceTargetSyntax } from "../dist/guidance.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function document(filePath) {
  return {
    id: `file:${filePath}`,
    path: filePath,
    kind: "CODE",
    updated_at: "2026-08-01T00:00:00.000Z",
    source_of_truth: false,
    trust_level: 60,
    status: "active",
    excerpt: "",
    content: `source:${filePath}`,
  };
}

function chunk(filePath, name, start, exported = true) {
  return {
    id: `chunk:${filePath}:${name}:${start}-${start + 4}`,
    file_id: `file:${filePath}`,
    name,
    kind: "function",
    signature: `${name}()`,
    body: `function ${name}() {}`,
    description: "",
    start_line: start,
    end_line: start + 4,
    language: "typescript",
    exported,
    updated_at: "2026-08-01T00:00:00.000Z",
    source_of_truth: false,
    trust_level: 60,
    status: "active",
  };
}

function fixtureData(reverse = false) {
  const files = [
    document("src/auth/factory.ts"),
    document("src/auth/caller.ts"),
    document("src/auth/factory.test.ts"),
  ];
  const factory = chunk(files[0].path, "createAuthFactory", 10);
  const caller = chunk(files[1].path, "useAuthFactory", 20, false);
  const fixture = chunk(files[2].path, "authFactoryFixture", 30, false);
  const module = {
    id: "module:src/auth",
    path: "src/auth",
    name: "auth",
    summary: "authentication module",
    file_count: 3,
    exported_symbols: "",
    updated_at: "2026-08-01T00:00:00.000Z",
    source_of_truth: false,
    trust_level: 75,
    status: "active",
  };
  const rules = [
    {
      id: "rule.auth.factory",
      title: "Use the indexed authentication factory",
      body: "convention:auth.factory=indexed",
      scope: "global",
      updated_at: "2026-08-01T00:00:00.000Z",
      source_of_truth: true,
      trust_level: 95,
      status: "active",
      priority: 90,
    },
    {
      id: "rule.auth.factory.alternate",
      title: "Retain the alternate active authentication factory claim",
      body: "convention:auth.factory=alternate",
      scope: "global",
      updated_at: "2026-08-01T00:00:00.000Z",
      source_of_truth: true,
      trust_level: 95,
      status: "active",
      priority: 80,
    },
  ];
  const relations = [
    ...files.map((file) => ({ from: module.id, to: file.id, relation: "CONTAINS", note: "" })),
    { from: module.id, to: factory.id, relation: "EXPORTS", note: "" },
    { from: factory.file_id, to: factory.id, relation: "DEFINES", note: "" },
    { from: caller.id, to: factory.id, relation: "CALLS", note: "direct" },
    { from: fixture.id, to: factory.id, relation: "CALLS", note: "test" },
  ];
  const data = {
    documents: files,
    chunks: [factory, caller, fixture],
    rules,
    adrs: [],
    modules: [module],
    projects: [],
    relations,
    ranking: { semantic: 0.4, graph: 0.25, trust: 0.2, recency: 0.15 },
    source: "cache",
  };
  if (!reverse) return data;
  return {
    ...data,
    documents: [...data.documents].reverse(),
    chunks: [...data.chunks].reverse(),
    rules: [...data.rules].reverse(),
    relations: [...data.relations].reverse(),
  };
}

function materialize(data) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-guidance-pure-")));
  for (const item of data.documents) {
    const target = path.join(root, ...item.path.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `fixture:${item.path}\n`, "utf8");
  }
  return root;
}

function rehashGuidance(data) {
  const copy = structuredClone(data);
  delete copy.guidance_hash;
  data.guidance_hash = crypto.createHash("sha256").update(canonicalGuidanceJson(copy)).digest("hex");
  return data;
}

function cappedFixtureData() {
  const files = Array.from({ length: 14 }, (_, index) => document(`src/many/symbol-${String(index).padStart(2, "0")}.ts`));
  const chunks = files.map((file, index) => chunk(file.path, `createSymbolFactory${String(index).padStart(2, "0")}`, 1 + index * 5));
  const module = {
    id: "module:src/many",
    path: "src/many",
    name: "many",
    summary: "many symbols",
    file_count: files.length,
    exported_symbols: "",
    updated_at: "2026-08-01T00:00:00.000Z",
    source_of_truth: false,
    trust_level: 75,
    status: "active",
  };
  const rules = [];
  for (let index = 0; index < 11; index += 1) {
    for (const value of ["alpha", "beta"]) {
      rules.push({
        id: `rule.symbol-${String(index).padStart(2, "0")}-${value}`,
        title: `Symbol factory policy ${index} ${value}`,
        body: `convention:symbol.${index}=${value}`,
        scope: "global",
        updated_at: "2026-08-01T00:00:00.000Z",
        source_of_truth: true,
        trust_level: 95,
        status: "active",
        priority: value === "alpha" ? 90 : 80,
      });
    }
  }
  return {
    documents: files,
    chunks,
    rules,
    adrs: [],
    modules: [module],
    projects: [],
    relations: [
      ...files.map((file) => ({ from: module.id, to: file.id, relation: "CONTAINS", note: "" })),
      ...chunks.map((item) => ({ from: module.id, to: item.id, relation: "EXPORTS", note: "" })),
    ],
    ranking: { semantic: 0.4, graph: 0.25, trust: 0.2, recency: 0.15 },
    source: "cache",
  };
}

function evidenceBoundaryFixtureData(observed) {
  assert.ok(observed === 10 || observed === 11);
  const exportedCount = observed;
  const files = Array.from({ length: exportedCount }, (_, index) => document(
    index === 0 ? "src/cap/auth-factory.ts" : `src/cap/peer-${String(index).padStart(2, "0")}.ts`,
  ));
  const symbols = files.map((file, index) => chunk(
    file.path,
    index === 0 ? "createAuthFactory" : `createPeerFactory${String(index).padStart(2, "0")}`,
    1 + index * 5,
  ));
  const module = {
    id: "module:src/cap",
    path: "src/cap",
    name: "cap",
    summary: "evidence cap module",
    file_count: files.length,
    exported_symbols: "",
    updated_at: "2026-08-01T00:00:00.000Z",
    source_of_truth: false,
    trust_level: 75,
    status: "active",
  };
  const authorityTargets = [module.id, ...files.map((file) => file.id)].slice(0, observed);
  const rules = [
    {
      id: "rule.cap.alpha",
      title: "Use the accepted auth factory",
      body: "convention:cap.factory=alpha",
      scope: "src/cap",
      updated_at: "2026-08-01T00:00:00.000Z",
      source_of_truth: true,
      trust_level: 95,
      status: "active",
      priority: 90,
    },
    {
      id: "rule.cap.beta",
      title: "Retain the conflicting auth factory claim",
      body: "convention:cap.factory=beta",
      scope: "src/cap",
      updated_at: "2026-08-01T00:00:00.000Z",
      source_of_truth: true,
      trust_level: 95,
      status: "active",
      priority: 80,
    },
  ];
  const callerCount = observed - 3;
  return {
    documents: files,
    chunks: symbols,
    rules,
    adrs: [],
    modules: [module],
    projects: [],
    relations: [
      ...files.map((file) => ({ from: module.id, to: file.id, relation: "CONTAINS", note: "" })),
      ...symbols.map((symbol) => ({ from: module.id, to: symbol.id, relation: "EXPORTS", note: "" })),
      { from: symbols[0].file_id, to: symbols[0].id, relation: "DEFINES", note: "" },
      ...symbols.slice(1, 1 + callerCount).map((caller, index) => ({
        from: caller.id,
        to: symbols[0].id,
        relation: index % 2 === 0 ? "CALLS" : "IMPORTS",
        note: "accepted graph evidence",
      })),
      ...rules.flatMap((rule) => authorityTargets.map((target) => ({ from: rule.id, to: target, relation: "CONSTRAINS", note: "" }))),
    ],
    ranking: { semantic: 0.4, graph: 0.25, trust: 0.2, recency: 0.15 },
    source: "cache",
  };
}

test("guidance task validation freezes scalar, UTF-8, and visible-text boundaries", () => {
  for (const length of [4_095, 4_096]) assert.equal(validateGuidanceTaskInput("a".repeat(length)).length, length);
  assert.throws(() => validateGuidanceTaskInput("a".repeat(4_097)), /version-1 input limit/);
  const byte16383 = `${"😀".repeat(4_095)}€`;
  const byte16384 = "😀".repeat(4_096);
  const byte16385 = `${byte16384}a`;
  assert.equal(Buffer.byteLength(validateGuidanceTaskInput(byte16383)), 16_383);
  assert.equal(Buffer.byteLength(validateGuidanceTaskInput(byte16384)), 16_384);
  assert.equal(Buffer.byteLength(byte16385), 16_385);
  assert.throws(() => validateGuidanceTaskInput(byte16385), /version-1 input limit/);
  assert.throws(() => validateGuidanceTaskInput("😀".repeat(4_097)), /version-1 input limit/);
  for (const unsafe of ["", " task", "task ", "a\nb", "a\rb", "a\u001bb", "a\u0085b", "a\u2028b", "a\u2029b", "a\u202eb"]) {
    assert.throws(() => validateGuidanceTaskInput(unsafe), /Guidance task/);
  }
  assert.throws(() => validateGuidanceTaskInput("\ud800"), /invalid Unicode scalar/);
});

test("guidance rejects malformed target and task inputs before context access", async () => {
  let contextReads = 0;
  const options = {
    get data() {
      contextReads += 1;
      return fixtureData();
    },
  };
  await assert.rejects(runGuidance({ target: "../outside.ts", task: "safe task" }, options), /Invalid repository-relative convention target/);
  await assert.rejects(runGuidance({ target: "src/auth/factory.ts", task: "unsafe\ntask" }, options), /Guidance task/);
  await assert.rejects(runGuidance({ target: "src/auth/factory.ts", task: "x".repeat(4_097) }, options), /version-1 input limit/);
  assert.equal(contextReads, 0);
});

test("guidance target grammar is exact, type-specific, and shared before context reads", async () => {
  const valid = [
    "src/auth/factory.ts",
    "file:src/auth/factory.ts",
    "chunk:src/auth/factory.ts:createAuthFactory:10-14",
    "module:src/auth",
    "project:src/auth/app.csproj",
    "rule.auth.factory",
    "rule:auth.factory",
    "adr.auth-factory",
    "adr:auth-factory",
  ];
  for (const target of valid) assert.equal(validateGuidanceTargetSyntax(target), target);
  const invalid = [
    "/tmp/x.ts", "C:/tmp/x.ts", "C:\\tmp\\x.ts", "../x.ts", "src/../x.ts", "./src/x.ts",
    "src/./x.ts", "src//x.ts", "src/x.ts/", "file:/tmp/x.ts", "file:../x.ts", "file:src//x.ts",
    "file:", "module:", "project:", "rule:", "rule.", "adr:", "adr.", "unknown:value",
    "chunk:/tmp/x.ts:name:1-2", "chunk:src/x.ts:name:0-2", "chunk:src/x.ts:name:2-1",
    "chunk:src/x.ts:name:01-2", "chunk:src/x.ts::1-2", "chunk:src/x.ts:name:1-2-extra",
  ];
  for (const target of invalid) assert.throws(() => validateGuidanceTargetSyntax(target), /Invalid/iu, target);

  let reads = 0;
  for (const target of invalid) {
    await assert.rejects(runGuidance({ target, task: "safe task" }, { get data() { reads += 1; return fixtureData(); } }), /Invalid/iu, target);
  }
  assert.equal(reads, 0);
});

test("guidance is deterministic, task-hashed, cited, conflicting, bounded, and inspection-only", async () => {
  const data = fixtureData();
  const repoRoot = materialize(data);
  const secret = "rotate auth factory secret-DO-NOT-ECHO";
  try {
    const before = fs.readdirSync(repoRoot, { recursive: true }).sort();
    const forward = await runGuidance({ target: "src/auth/factory.ts", task: secret }, {
      data,
      repo_root: repoRoot,
      repository_id: "fixture",
    });
    const reversed = await runGuidance({ target: "src/auth/factory.ts", task: secret }, {
      data: fixtureData(true),
      repo_root: repoRoot,
      repository_id: "fixture",
    });
    assert.equal(canonicalGuidanceJson(forward), canonicalGuidanceJson(reversed));
    assert.equal(forward.schema_version, GUIDANCE_SCHEMA_VERSION);
    assert.equal(forward.generator_version, GUIDANCE_GENERATOR_VERSION);
    assert.equal(forward.task_hash, crypto.createHash("sha256").update(secret).digest("hex"));
    assert.equal(canonicalGuidanceJson(forward).includes(secret), false);
    assert.equal(forward.active_governing_rules.items.length, 2);
    assert.equal(forward.conflicts.items.length, 1);
    assert.equal(new Set(forward.conflicts.items[0].claims.map((claim) => claim.value)).size, 2);
    assert.equal(forward.reusable_symbols.items[0].entity_id, "chunk:src/auth/factory.ts:createAuthFactory:10-14");
    const callerExamples = forward.concrete_examples.items.filter((item) => ["representative_caller", "representative_test"].includes(item.kind));
    assert.ok(callerExamples.length > 0);
    for (const example of callerExamples) {
      assert.equal(example.reusable_symbol_id, "chunk:src/auth/factory.ts:createAuthFactory:10-14");
      assert.ok(example.evidence.some((evidence) => ["CALLS", "IMPORTS"].includes(evidence.relation?.type) && evidence.relation.from === example.entity_id && evidence.relation.to === example.reusable_symbol_id));
    }
    assert.equal(Object.hasOwn(forward, "retrieval_evidence"), false);
    assert.equal(Object.hasOwn(forward.limits, "max_retrieval_evidence"), false);
    for (const section of [forward.active_governing_rules, forward.reusable_symbols, forward.concrete_examples]) {
      for (const item of section.items) {
        assert.ok(item.evidence.length > 0);
        assert.equal(item.evidence_observed_count - item.evidence.length, item.evidence_omitted);
      }
    }
    const json = serializeGuidancePublicResponse({ target: "src/auth/factory.ts", task: secret }, forward);
    assert.ok(Buffer.byteLength(json) <= GUIDANCE_LIMITS.max_response_bytes);
    assert.equal(json.includes(secret), false);
    assert.equal(json, serializeGuidancePublicResponse({ target: "src/auth/factory.ts", task: secret }, reversed));
    assert.match(formatGuidancePublicText(forward), /^guidance: schema=1/u);
    assert.deepEqual(fs.readdirSync(repoRoot, { recursive: true }).sort(), before);
    assert.equal(fs.existsSync(path.join(repoRoot, ".context")), false);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("guidance validators reject unknown keys and public errors never echo task text", async () => {
  const data = fixtureData();
  const repoRoot = materialize(data);
  try {
    const result = await runGuidance({ target: "src/auth/factory.ts", task: "auth factory" }, {
      data,
      repo_root: repoRoot,
      repository_id: "fixture",
    });
    const malformed = structuredClone(result);
    malformed.unknown = true;
    assert.throws(() => validateGuidanceData(malformed), /unknown or missing schema keys/);
    const nestedUnknown = rehashGuidance(structuredClone(result));
    nestedUnknown.reusable_symbols.items[0].unknown = true;
    rehashGuidance(nestedUnknown);
    assert.throws(() => validateGuidanceData(nestedUnknown), /unknown or missing schema keys/);
    const reversed = structuredClone(result);
    reversed.active_governing_rules.items.reverse();
    rehashGuidance(reversed);
    assert.throws(() => validateGuidanceData(reversed), /canonically ordered/);
    const task = "private-task-secret";
    const error = serializeGuidancePublicError({ target: "../outside.ts", task }, new Error(`raw ${task} ${repoRoot}`));
    assert.equal(error.includes(task), false);
    assert.equal(error.includes(repoRoot), false);
    assert.ok(Buffer.byteLength(error) < 1_024);
    assert.deepEqual(JSON.parse(error).input, { target: "[rejected]", task_hash: crypto.createHash("sha256").update(task).digest("hex") });
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("guidance recursively rejects rehashed nested tampering and context recomputation rejects fabricated meaning", async () => {
  const data = fixtureData();
  const repoRoot = materialize(data);
  try {
    const params = { target: "src/auth/factory.ts", task: "auth factory" };
    const result = await runGuidance(params, { data, repo_root: repoRoot, repository_id: "fixture" });
    const mutations = [
      (x) => { x.target.entity_type = "Rule"; },
      (x) => { x.target.path = "/absolute/private"; },
      (x) => { x.profile_selection[0].evidence_tier = "nearby"; },
      (x) => { x.profile_selection[0].language = 4; },
      (x) => { x.active_governing_rules.items[0].priority = Infinity; },
      (x) => { x.active_governing_rules.items[0].scope = "global"; },
      (x) => { x.active_governing_rules.items[0].evidence[0].path = "/private"; },
      (x) => { x.active_governing_rules.items[0].relevance.reason = "invented"; },
      (x) => { x.active_governing_rules.items[0].relevance.score_components.matched_fields = 0.5; },
      (x) => { x.reusable_symbols.items[0].role = 7; },
      (x) => { x.reusable_symbols.items[0].signature = "unsafe\nvalue"; },
      (x) => { x.reusable_symbols.items[0].evidence_observed_count += 1; },
      (x) => { x.concrete_examples.items[0].kind = "invented"; },
      (x) => { x.conflicts.items[0].claims[0].source_type = "File"; },
      (x) => { x.context_source = "network"; },
    ];
    for (const mutate of mutations) {
      const malformed = structuredClone(result);
      mutate(malformed);
      rehashGuidance(malformed);
      assert.throws(() => validateGuidanceData(malformed));
    }
    const fabricated = structuredClone(result);
    fabricated.active_governing_rules.items[0].title = "Rehashed fabricated policy title";
    rehashGuidance(fabricated);
    validateGuidanceData(fabricated);
    await assert.rejects(validateGuidanceDataWithContext(fabricated, params, { data, repo_root: repoRoot, repository_id: "fixture" }), /raw task and public fields|canonical current context/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("guidance enforces normalized observed, retained, omitted, and matched-term invariants recursively", async () => {
  const data = fixtureData();
  const repoRoot = materialize(data);
  const params = { target: "src/auth/factory.ts", task: "auth factory" };
  try {
    const result = await runGuidance(params, { data, repo_root: repoRoot, repository_id: "fixture" });
    const mutations = [
      (value) => { value.task_projection.normalized_term_observed_count = 0; value.task_projection.normalized_terms_omitted = 0; },
      (value) => { value.task_projection.normalized_term_observed_count = 4_097; value.task_projection.normalized_terms_omitted = 4_065; },
      (value) => { value.task_projection.normalized_term_observed_count = 33; value.task_projection.normalized_terms_omitted = 0; },
      (value) => { value.task_projection.normalized_term_observed_count = 1; value.task_projection.normalized_terms_omitted = 0; },
    ];
    for (const mutate of mutations) {
      const malformed = structuredClone(result);
      mutate(malformed);
      rehashGuidance(malformed);
      assert.throws(() => validateGuidanceData(malformed));
      assert.throws(() => serializeGuidancePublicResponse(params, malformed));
      await assert.rejects(validateGuidanceDataWithContext(malformed, params, { data, repo_root: repoRoot, repository_id: "fixture" }));
    }
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("public serialization recomputes raw-task counts and every relevance component from allowlisted fields", async () => {
  const data = fixtureData();
  const repoRoot = materialize(data);
  const params = { target: "src/auth/factory.ts", task: "auth factory" };
  try {
    const result = await runGuidance(params, { data, repo_root: repoRoot, repository_id: "fixture" });
    assert.doesNotThrow(() => validateGuidanceDataAgainstTask(result, params.task));
    assert.equal(JSON.parse(serializeGuidancePublicResponse(params, result)).ok, true);

    const upwardCount = structuredClone(result);
    upwardCount.task_projection.normalized_term_observed_count += 1;
    rehashGuidance(upwardCount);

    const fabricatedTerm = structuredClone(result);
    for (const section of [fabricatedTerm.active_governing_rules, fabricatedTerm.reusable_symbols, fabricatedTerm.concrete_examples]) {
      for (const item of section.items) item.relevance.matched_terms = item.relevance.matched_terms.map((term) => term === "auth" ? "phantom" : term).sort();
    }
    fabricatedTerm.task_projection.matched_terms = fabricatedTerm.task_projection.matched_terms.map((term) => term === "auth" ? "phantom" : term).sort();
    rehashGuidance(fabricatedTerm);

    const exactPrefixSwap = structuredClone(result);
    const exactItem = exactPrefixSwap.active_governing_rules.items.find((item) => item.relevance.score_components.exact_term_matches > 0);
    assert.ok(exactItem);
    exactItem.relevance.score_components.exact_term_matches -= 1;
    exactItem.relevance.score_components.prefix_term_matches += 1;
    exactItem.relevance.score -= 75;
    rehashGuidance(exactPrefixSwap);

    const alteredFields = structuredClone(result);
    const fieldItem = alteredFields.active_governing_rules.items.find((item) => item.relevance.score_components.matched_fields < 5);
    assert.ok(fieldItem);
    fieldItem.relevance.score_components.matched_fields += 1;
    fieldItem.relevance.score += 10;
    rehashGuidance(alteredFields);

    for (const malformed of [upwardCount, fabricatedTerm, exactPrefixSwap, alteredFields]) {
      validateGuidanceData(malformed);
      assert.throws(() => validateGuidanceDataAgainstTask(malformed, params.task), /raw task|public fields/);
      assert.throws(() => serializeGuidancePublicResponse(params, malformed), /raw task|public fields/);
      await assert.rejects(validateGuidanceDataWithContext(malformed, params, { data, repo_root: repoRoot, repository_id: "fixture" }), /raw task|public fields/);
    }
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("task projection freezes 32-to-33 accounting and NFKC-equivalent relevance", async () => {
  const data = fixtureData();
  const repoRoot = materialize(data);
  try {
    const terms32 = Array.from({ length: 32 }, (_, index) => `term${String(index).padStart(2, "0")}`).join(" ");
    const terms33 = `${terms32} term32`;
    const at32 = await runGuidance({ target: "src/auth/factory.ts", task: terms32 }, { data, repo_root: repoRoot, repository_id: "fixture" });
    const at33 = await runGuidance({ target: "src/auth/factory.ts", task: terms33 }, { data, repo_root: repoRoot, repository_id: "fixture" });
    assert.deepEqual([at32.task_projection.normalized_term_observed_count, at32.task_projection.normalized_terms_omitted], [32, 0]);
    assert.deepEqual([at33.task_projection.normalized_term_observed_count, at33.task_projection.normalized_terms_omitted], [33, 1]);

    const ascii = await runGuidance({ target: "src/auth/factory.ts", task: "auth factory" }, { data, repo_root: repoRoot, repository_id: "fixture" });
    const compatibility = await runGuidance({ target: "src/auth/factory.ts", task: "ａｕｔｈ　ｆａｃｔｏｒｙ" }, { data: fixtureData(true), repo_root: repoRoot, repository_id: "fixture" });
    const projection = (value) => ({
      task_projection: value.task_projection,
      profile_selection: value.profile_selection,
      active_governing_rules: value.active_governing_rules,
      reusable_symbols: value.reusable_symbols,
      concrete_examples: value.concrete_examples,
      conflicts: value.conflicts,
      fallback_mode: value.fallback_mode,
    });
    assert.deepEqual(projection(ascii), projection(compatibility));
    assert.notEqual(ascii.task_hash, compatibility.task_hash);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("guidance selects one, multilanguage, and repository-fallback profiles canonically", async () => {
  const one = fixtureData();
  const oneRoot = materialize(one);
  try {
    const single = await runGuidance({ target: "src/auth/factory.ts", task: "factory" }, { data: one, repo_root: oneRoot, repository_id: "fixture" });
    assert.equal(single.profile_selection.length, 1);
    assert.equal(single.profile_selection[0].evidence_tier, "closest_profile");
  } finally {
    fs.rmSync(oneRoot, { recursive: true, force: true });
  }

  const multilingual = fixtureData();
  multilingual.chunks.push({ ...chunk("src/auth/factory.ts", "createAuthFactoryPy", 40), language: "python" });
  multilingual.relations.push({ from: multilingual.modules[0].id, to: multilingual.chunks.at(-1).id, relation: "EXPORTS", note: "" });
  const multiRoot = materialize(multilingual);
  try {
    const result = await runGuidance({ target: "src/auth/factory.ts", task: "factory" }, { data: multilingual, repo_root: multiRoot, repository_id: "fixture" });
    assert.deepEqual(result.profile_selection.map((profile) => profile.language), ["python", "typescript"]);
    assert.ok(result.profile_selection.every((profile) => profile.evidence_tier === "closest_profile"));
  } finally {
    fs.rmSync(multiRoot, { recursive: true, force: true });
  }

  const rootFile = document("root.ts");
  const rootChunk = chunk("root.ts", "createRootFactory", 1);
  const repository = {
    documents: [rootFile], chunks: [rootChunk], rules: [], adrs: [], modules: [], projects: [],
    relations: [], ranking: { semantic: 0.4, graph: 0.25, trust: 0.2, recency: 0.15 }, source: "cache",
  };
  const repositoryRoot = materialize(repository);
  try {
    const fallback = await runGuidance({ target: "root.ts", task: "factory" }, { data: repository, repo_root: repositoryRoot, repository_id: "fixture" });
    assert.equal(fallback.profile_selection.length, 1);
    assert.deepEqual(fallback.profile_selection[0], {
      profile_id: fallback.profile_selection[0].profile_id,
      language: "typescript",
      subsystem_id: "path:.",
      subsystem_path: ".",
      evidence_tier: "repository_fallback",
    });
  } finally {
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test("every guidance item class reaches the real context-backed 10-to-11 evidence boundary", async () => {
  const data10 = evidenceBoundaryFixtureData(10);
  const data11 = evidenceBoundaryFixtureData(11);
  const repoRoot = materialize(data11);
  try {
    const params = { target: "src/cap/auth-factory.ts", task: "auth factory" };
    for (const [observed, data] of [[10, data10], [11, data11]]) {
      const result = await runGuidance(params, { data, repo_root: repoRoot, repository_id: "fixture" });
      const symbolId = "chunk:src/cap/auth-factory.ts:createAuthFactory:1-5";
      const records = [
        result.active_governing_rules.items.find((item) => item.entity_id === "rule.cap.alpha"),
        result.reusable_symbols.items.find((item) => item.entity_id === symbolId),
        result.concrete_examples.items.find((item) => item.kind === "reusable_symbol" && item.entity_id === symbolId),
        result.conflicts.items[0].claims.find((item) => item.source_id === "rule.cap.alpha"),
      ];
      assert.ok(records.every(Boolean));
      for (const record of records) {
        assert.equal(record.evidence_observed_count, observed);
        assert.equal(record.evidence.length, Math.min(observed, 10));
        assert.equal(record.evidence_omitted, observed === 11 ? 1 : 0);
        assert.ok(record.evidence.every((evidence) => !evidence.relation || data.relations.some((relation) => relation.from === evidence.relation.from && relation.to === evidence.relation.to && relation.relation === evidence.relation.type)));
      }
      await validateGuidanceDataWithContext(result, params, { data, repo_root: repoRoot, repository_id: "fixture" });
    }
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("guidance applies every item cap after ranking with exact omissions and deterministic fallback", async () => {
  const data = cappedFixtureData();
  const repoRoot = materialize(data);
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("guidance must never fetch");
  };
  try {
    const matched = await runGuidance({ target: data.documents[0].path, task: "THE symbol factory and SYMBOL" }, {
      data,
      repo_root: repoRoot,
      repository_id: "fixture",
    });
    assert.equal(matched.active_governing_rules.observed_count, 22);
    assert.equal(matched.active_governing_rules.items.length, 8);
    assert.equal(matched.active_governing_rules.omitted_count, 14);
    assert.equal(matched.reusable_symbols.observed_count, 14);
    assert.equal(matched.reusable_symbols.items.length, 12);
    assert.equal(matched.reusable_symbols.omitted_count, 2);
    assert.ok(matched.concrete_examples.observed_count > 6);
    assert.equal(matched.concrete_examples.items.length, 6);
    assert.equal(matched.concrete_examples.omitted_count, matched.concrete_examples.observed_count - 6);
    assert.equal(matched.conflicts.observed_count, 11);
    assert.equal(matched.conflicts.items.length, 10);
    assert.equal(matched.conflicts.omitted_count, 1);
    assert.equal(matched.fallback_mode, "task_match");
    assert.deepEqual(matched.task_projection.matched_terms, ["factory", "symbol"]);
    assert.equal(matched.task_projection.matched_terms.includes("the"), false);
    assert.equal(matched.task_projection.matched_terms.includes("and"), false);

    const fallback = await runGuidance({ target: data.documents[0].path, task: "quasar" }, {
      data,
      repo_root: repoRoot,
      repository_id: "fixture",
    });
    assert.equal(fallback.fallback_mode, "closest_profile_fallback");
    assert.ok(fallback.reusable_symbols.items.every((item) => item.relevance.reason === "closest_profile_fallback"));
    assert.equal(fetchCalls, 0);
    assert.equal(Object.hasOwn(matched, "retrieval_evidence"), false);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("guidance calls no retrieval, embedding, model, planner, provider, fetch, telemetry, or network surface", async () => {
  const source = fs.readFileSync(path.join(PROJECT_ROOT, "scaffold", "mcp", "src", "guidance.ts"), "utf8");
  for (const prohibited of ["runContextSearch", "./search.js", "embeddingModel", "query_vector", "planner", "provider", "telemetry", "fetch(", "http.request", "https.request", "node:net"]) {
    assert.equal(source.includes(prohibited), false, prohibited);
  }
  const data = fixtureData();
  const repoRoot = materialize(data);
  const originalFetch = globalThis.fetch;
  const originalHttpRequest = http.request;
  const originalHttpsRequest = https.request;
  const originalNetConnect = net.connect;
  const calls = { fetch: 0, http: 0, https: 0, net: 0 };
  globalThis.fetch = async () => { calls.fetch += 1; throw new Error("fetch sentinel"); };
  http.request = () => { calls.http += 1; throw new Error("http sentinel"); };
  https.request = () => { calls.https += 1; throw new Error("https sentinel"); };
  net.connect = () => { calls.net += 1; throw new Error("network sentinel"); };
  try {
    await runGuidance({ target: "src/auth/factory.ts", task: "auth factory" }, { data, repo_root: repoRoot, repository_id: "fixture" });
    assert.deepEqual(calls, { fetch: 0, http: 0, https: 0, net: 0 });
  } finally {
    globalThis.fetch = originalFetch;
    http.request = originalHttpRequest;
    https.request = originalHttpsRequest;
    net.connect = originalNetConnect;
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("context-bound guidance rejects duplicates, cross-type collisions, inactive authority, and stale backing", async () => {
  const data = fixtureData();
  const repoRoot = materialize(data);
  const params = { target: "src/auth/factory.ts", task: "auth factory" };
  try {
    const result = await runGuidance(params, { data, repo_root: repoRoot, repository_id: "fixture" });
    const variants = [];
    const duplicateRule = structuredClone(data);
    duplicateRule.rules.push(structuredClone(duplicateRule.rules[0]));
    variants.push(duplicateRule);
    const crossType = structuredClone(data);
    crossType.documents.push({ ...document("src/auth/collision.ts"), id: crossType.rules[0].id });
    variants.push(crossType);
    const inactive = structuredClone(data);
    inactive.rules[0].status = "deprecated";
    variants.push(inactive);
    const substituted = structuredClone(data);
    substituted.chunks[0].name = "substitutedFactory";
    variants.push(substituted);
    for (const variant of variants) {
      await assert.rejects(validateGuidanceDataWithContext(result, params, { data: variant, repo_root: repoRoot, repository_id: "fixture" }));
    }

    const targetPath = path.join(repoRoot, "src", "auth", "factory.ts");
    const backup = fs.readFileSync(targetPath);
    fs.rmSync(targetPath);
    await assert.rejects(validateGuidanceDataWithContext(result, params, { data, repo_root: repoRoot, repository_id: "fixture" }), /missing|stale/);
    fs.writeFileSync(targetPath, backup);
    const alias = path.join(repoRoot, "src", "auth", "factory-alias.ts");
    fs.linkSync(targetPath, alias);
    await assert.rejects(validateGuidanceDataWithContext(result, params, { data, repo_root: repoRoot, repository_id: "fixture" }), /unsafe|identity/);
    fs.rmSync(alias);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("guidance fails before output when the fully capped public response exceeds 65,536 bytes", async () => {
  const data = fixtureData();
  const task = Array.from({ length: 32 }, (_, index) => `term${String(index).padStart(2, "0")}${"q".repeat(40)}`).join(" ");
  data.chunks = Array.from({ length: 12 }, (_, index) => ({
    ...chunk("src/auth/factory.ts", `oversizedFactory${String(index).padStart(2, "0")}`, 10 + index * 5),
    signature: task,
  }));
  data.relations = [
    ...data.documents.map((file) => ({ from: "module:src/auth", to: file.id, relation: "CONTAINS", note: "" })),
    ...data.chunks.map((item) => ({ from: "module:src/auth", to: item.id, relation: "EXPORTS", note: "" })),
  ];
  data.rules = [];
  for (let key = 0; key < 10; key += 1) {
    for (let claim = 0; claim < 10; claim += 1) {
      const value = `${String(claim).padStart(2, "0")}-${"x".repeat(180)}`;
      data.rules.push({
        id: `rule.large-${key}-${claim}`,
        title: `Large policy ${key} ${claim}`,
        body: `convention:large.${key}=${value}`,
        scope: "global",
        updated_at: "2026-08-01T00:00:00.000Z",
        source_of_truth: true,
        trust_level: 95,
        status: "active",
        priority: 100 - claim,
      });
    }
  }
  const repoRoot = materialize(data);
  try {
    await assert.rejects(
      runGuidance({ target: "src/auth/factory.ts", task }, {
        data,
        repo_root: repoRoot,
        repository_id: "fixture",
      }),
      /Guidance public response exceeds the version-1 byte limit/,
    );
    assert.equal(fs.existsSync(path.join(repoRoot, ".context")), false);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("guidance public response accepts exact and one-byte-near limits and rejects one byte over", async () => {
  const data = fixtureData();
  const repoRoot = materialize(data);
  const input = { target: "src/auth/factory.ts", task: "auth factory" };
  try {
    const baseline = await runGuidance(input, { data, repo_root: repoRoot, repository_id: "fixture" });
    const candidate = structuredClone(baseline);
    let serialized = serializeGuidancePublicResponse(input, candidate);
    let index = 0;
    while (true) {
      const next = structuredClone(candidate);
      next.profile_selection.push({
        profile_id: `convention:${index.toString(16).padStart(32, "0")}`,
        language: "zz",
        subsystem_id: "x",
        subsystem_path: "x",
        evidence_tier: "closest_profile",
      });
      rehashGuidance(next);
      try {
        serialized = serializeGuidancePublicResponse(input, next);
        candidate.profile_selection = next.profile_selection;
        candidate.guidance_hash = next.guidance_hash;
        index += 1;
      } catch (error) {
        assert.match(String(error), /exceeds the version-1 byte limit/);
        break;
      }
    }

    const remaining = GUIDANCE_LIMITS.max_response_bytes - Buffer.byteLength(serialized);
    assert.ok(remaining > 1 && remaining < 1_000);
    const last = candidate.profile_selection.at(-1);
    last.subsystem_id = "x".repeat(remaining);
    rehashGuidance(candidate);
    const near = serializeGuidancePublicResponse(input, candidate);
    assert.equal(Buffer.byteLength(near), GUIDANCE_LIMITS.max_response_bytes - 1);

    last.subsystem_id += "x";
    rehashGuidance(candidate);
    const exact = serializeGuidancePublicResponse(input, candidate);
    assert.equal(Buffer.byteLength(exact), GUIDANCE_LIMITS.max_response_bytes);

    last.subsystem_id += "x";
    rehashGuidance(candidate);
    assert.throws(() => serializeGuidancePublicResponse(input, candidate), /exceeds the version-1 byte limit/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
