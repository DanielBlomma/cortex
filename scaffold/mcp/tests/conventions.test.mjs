import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  CONVENTION_GENERATOR_VERSION,
  CONVENTION_LIMITS,
  CONVENTION_SCHEMA_VERSION,
  buildConventionProfiles,
  canonicalConventionJson,
  formatConventionPublicText,
  persistConventionProfiles,
  readConventionProfile,
  runConventions,
  sanitizeConventionPublicError,
  serializeConventionPublicError,
  serializeConventionPublicResponse,
  validateConventionProfile,
  validateConventionProfilesAgainstContext,
} from "../dist/conventions.js";

function digest(value) {
  return crypto.createHash("sha256").update(canonicalConventionJson(value)).digest("hex");
}

function rehashProfile(profile) {
  const copy = structuredClone(profile);
  delete copy.profile_hash;
  profile.profile_hash = digest(copy);
  return profile;
}

function rehashManifest(manifest) {
  manifest.index_hash = digest(manifest.profiles.map((entry) => [entry.profile_id, entry.source_hash, entry.profile_hash]));
  return manifest;
}

function priorLimitProfile(profile) {
  const legacy = structuredClone(profile);
  delete legacy.limits.max_repository_control_bytes;
  return rehashProfile(legacy);
}

function priorLimitManifest(manifest, profilesById = new Map()) {
  const legacy = structuredClone(manifest);
  delete legacy.limits.max_repository_control_bytes;
  for (const entry of legacy.profiles) {
    const profile = profilesById.get(entry.profile_id);
    if (!profile) continue;
    entry.source_hash = profile.source_hash;
    entry.profile_hash = profile.profile_hash;
  }
  return rehashManifest(legacy);
}

function withReadSwap(targetPath, swap, action) {
  const target = path.resolve(targetPath);
  const original = fs.readFileSync;
  let swapped = false;
  fs.readFileSync = function patchedRead(filePath, ...args) {
    const result = original.call(this, filePath, ...args);
    if (!swapped && path.resolve(String(filePath)) === target) {
      swapped = true;
      swap(result);
    }
    return result;
  };
  try {
    return action();
  } finally {
    fs.readFileSync = original;
  }
}

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

function chunk(filePath, name, options = {}) {
  const start = options.start ?? 1;
  return {
    id: `chunk:${filePath}:${name}:${start}-${start + 4}`,
    file_id: `file:${filePath}`,
    name,
    kind: options.kind ?? "function",
    signature: options.signature ?? `${name}()`,
    body: options.body ?? `function ${name}() {}`,
    description: "",
    start_line: start,
    end_line: start + 4,
    language: options.language ?? "typescript",
    exported: options.exported ?? true,
    updated_at: "2026-08-01T00:00:00.000Z",
    source_of_truth: false,
    trust_level: 60,
    status: "active",
  };
}

function moduleRecord(modulePath, fileCount) {
  return {
    id: `module:${modulePath}`,
    path: modulePath,
    name: path.posix.basename(modulePath),
    summary: "fixture module",
    file_count: fileCount,
    exported_symbols: "",
    updated_at: "2026-08-01T00:00:00.000Z",
    source_of_truth: false,
    trust_level: 75,
    status: "active",
  };
}

function projectRecord(projectPath, fileCount) {
  return {
    id: `project:${projectPath}`,
    path: projectPath,
    name: path.posix.basename(projectPath),
    kind: "project",
    language: "typescript",
    target_framework: "",
    summary: "fixture project",
    file_count: fileCount,
    updated_at: "2026-08-01T00:00:00.000Z",
    source_of_truth: false,
    trust_level: 75,
    status: "active",
  };
}

function rule(id, body, priority = 90) {
  return {
    id,
    title: id,
    body,
    scope: "global",
    updated_at: "2026-08-01T00:00:00.000Z",
    source_of_truth: true,
    trust_level: 95,
    status: "active",
    priority,
  };
}

function adr(id, body, options = {}) {
  return {
    id,
    title: id,
    body,
    path: options.path ?? `docs/adr/${id}.md`,
    decision_date: "2026-08-01",
    source_of_truth: true,
    trust_level: 95,
    status: options.status ?? "active",
  };
}

function fixtureData(options = {}) {
  const files = options.files ?? [
    document("src/auth/factory.ts"),
    document("src/auth/caller.ts"),
    document("src/auth/factory.test.ts"),
  ];
  const factory = chunk("src/auth/factory.ts", "createAuthFactory", { start: 10 });
  const caller = chunk("src/auth/caller.ts", "useAuth", { exported: false, start: 20 });
  const testCaller = chunk("src/auth/factory.test.ts", "authFactoryFixture", { exported: false, start: 30 });
  const chunks = options.chunks ?? [factory, caller, testCaller];
  const module = moduleRecord("src/auth", files.length);
  const relations = options.relations ?? [
    ...files.map((file) => ({ from: module.id, to: file.id, relation: "CONTAINS", note: "" })),
    { from: module.id, to: factory.id, relation: "EXPORTS", note: "" },
    { from: factory.file_id, to: factory.id, relation: "DEFINES", note: "" },
    { from: caller.id, to: factory.id, relation: "CALLS", note: "direct" },
    { from: testCaller.id, to: factory.id, relation: "CALLS", note: "direct" },
  ];
  return {
    documents: files,
    chunks,
    rules: options.rules ?? [rule("rule.local", "Use indexed evidence.")],
    adrs: options.adrs ?? [],
    modules: options.modules ?? [module],
    projects: options.projects ?? [],
    relations,
    ranking: { semantic: 0.4, graph: 0.25, trust: 0.2, recency: 0.15 },
    source: "cache",
  };
}

function pairedProfileData() {
  const files = [document("src/a/export.ts"), document("src/b/export.ts")];
  const chunks = [chunk("src/a/export.ts", "createAFactory"), chunk("src/b/export.ts", "createBFactory")];
  const modules = [moduleRecord("src/a", 1), moduleRecord("src/b", 1)];
  return fixtureData({
    files,
    chunks,
    modules,
    relations: [
      { from: "module:src/a", to: files[0].id, relation: "CONTAINS", note: "" },
      { from: "module:src/b", to: files[1].id, relation: "CONTAINS", note: "" },
      { from: "module:src/a", to: chunks[0].id, relation: "EXPORTS", note: "" },
      { from: "module:src/b", to: chunks[1].id, relation: "EXPORTS", note: "" },
    ],
  });
}

function citationFixtureData() {
  const exportFile = document("src/auth/export.ts");
  const callerFile = document("src/client/caller.ts");
  const exported = chunk(exportFile.path, "createAuth", { start: 10 });
  const caller = chunk(callerFile.path, "callAuth", { exported: false, start: 30 });
  const auth = moduleRecord("src/auth", 1);
  const client = moduleRecord("src/client", 1);
  const policy = adr("adr.auth-policy", "convention:auth.mode=strict", { path: "docs/adr/auth-policy.md" });
  const data = fixtureData({
    files: [exportFile, callerFile],
    chunks: [exported, caller],
    modules: [auth, client],
    rules: [],
    adrs: [policy],
    relations: [
      { from: auth.id, to: exportFile.id, relation: "CONTAINS", note: "" },
      { from: client.id, to: callerFile.id, relation: "CONTAINS", note: "" },
      { from: auth.id, to: exported.id, relation: "EXPORTS", note: "" },
      { from: caller.id, to: exported.id, relation: "CALLS", note: "cross-subsystem" },
      { from: policy.id, to: exportFile.id, relation: "CONSTRAINS", note: "exact" },
    ],
  });
  return { data, exportFile, callerFile, exported, caller, policy };
}

function materializeDocuments(repoRoot, data) {
  for (const item of data.documents) {
    const target = path.join(repoRoot, ...item.path.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `fixture:${item.path}\n`, "utf8");
  }
}

const persistenceRoots = [];
test.after(() => {
  for (const root of persistenceRoots) fs.rmSync(root, { recursive: true, force: true });
});

function persistenceOptions(data, stateDir, repositoryId = "fixture") {
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-persist-context-")));
  persistenceRoots.push(repoRoot);
  materializeDocuments(repoRoot, data);
  for (const record of data.adrs) {
    const target = path.join(repoRoot, ...record.path.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `fixture:${record.path}\n`, "utf8");
  }
  return { state_dir: stateDir, data, repository_id: repositoryId, repo_root: repoRoot };
}

test("builds deterministic module- and language-scoped profiles with cited reusable exports", () => {
  const data = fixtureData();
  const forward = buildConventionProfiles(data, { repository_id: "fixture" });
  const reversed = buildConventionProfiles({
    ...data,
    documents: [...data.documents].reverse(),
    chunks: [...data.chunks].reverse(),
    rules: [...data.rules].reverse(),
    relations: [...data.relations].reverse(),
  }, { repository_id: "fixture" });

  assert.equal(forward.length, 1);
  assert.equal(canonicalConventionJson(reversed), canonicalConventionJson(forward));
  const profile = forward[0];
  assert.equal(profile.schema_version, CONVENTION_SCHEMA_VERSION);
  assert.equal(profile.generator_version, CONVENTION_GENERATOR_VERSION);
  assert.equal(profile.language, "typescript");
  assert.equal(profile.subsystem.id, "module:src/auth");
  assert.equal(profile.subsystem.type, "module");
  assert.equal(profile.authoritative_evidence[0].entity_id, "rule.local");
  assert.equal(profile.reusable_symbols.length, 1);
  assert.equal(profile.reusable_symbols[0].role, "factory");
  assert.equal(profile.reusable_symbols[0].evidence[0].path, "src/auth/factory.ts");
  assert.equal(profile.reusable_symbols[0].evidence[0].start_line, 10);
  assert.deepEqual(
    profile.reusable_symbols[0].representative_callers.map((item) => item.entity_id),
    [
      "chunk:src/auth/caller.ts:useAuth:20-24",
      "chunk:src/auth/factory.test.ts:authFactoryFixture:30-34",
    ],
  );
  assert.deepEqual(
    profile.reusable_symbols[0].representative_tests.map((item) => item.path),
    ["src/auth/factory.test.ts"],
  );
  assert.ok(profile.structural_facts.every((fact) => fact.normative === false && fact.evidence.length > 0));
});

test("excludes inactive, deprecated, and non-source-of-truth records from every convention subsystem", async () => {
  const activeFile = document("src/active/export.ts");
  const deprecatedFile = { ...document("src/deprecated/export.ts"), status: "deprecated" };
  const activeExport = chunk(activeFile.path, "activeExport", { start: 10 });
  const deprecatedChunk = { ...chunk(deprecatedFile.path, "deprecatedExport", { start: 20 }), status: "deprecated" };
  const deprecatedCaller = { ...chunk(activeFile.path, "deprecatedCaller", { exported: false, start: 30 }), status: "deprecated" };
  const activeModule = moduleRecord("src/active", 1);
  const deprecatedModule = { ...moduleRecord("src/deprecated", 1), status: "deprecated" };
  const activeRule = rule("rule.active-authority", "convention:mode=active");
  const nonTruthRule = { ...rule("rule.non-truth", "convention:mode=non-truth"), source_of_truth: false };
  const deprecatedRule = { ...rule("rule.deprecated", "convention:mode=deprecated"), status: "deprecated" };
  const governed = adr("adr.active-policy", "convention:storage=current");
  const nonTruthSuperseder = { ...adr("adr.non-truth", "convention:storage=hidden"), source_of_truth: false };
  const deprecatedSuperseder = { ...adr("adr.deprecated", "convention:storage=hidden"), status: "deprecated" };
  const data = fixtureData({
    files: [activeFile, deprecatedFile],
    chunks: [activeExport, deprecatedChunk, deprecatedCaller],
    modules: [activeModule, deprecatedModule],
    rules: [activeRule, nonTruthRule, deprecatedRule],
    adrs: [governed, nonTruthSuperseder, deprecatedSuperseder],
    relations: [
      { from: activeModule.id, to: activeFile.id, relation: "CONTAINS", note: "" },
      { from: deprecatedModule.id, to: deprecatedFile.id, relation: "CONTAINS", note: "" },
      { from: activeModule.id, to: activeExport.id, relation: "EXPORTS", note: "" },
      { from: deprecatedCaller.id, to: activeExport.id, relation: "CALLS", note: "ineligible" },
      { from: governed.id, to: activeFile.id, relation: "CONSTRAINS", note: "exact" },
      { from: nonTruthSuperseder.id, to: activeFile.id, relation: "CONSTRAINS", note: "not-truth" },
      { from: nonTruthSuperseder.id, to: governed.id, relation: "SUPERSEDES", note: "not-truth" },
      { from: deprecatedSuperseder.id, to: activeFile.id, relation: "CONSTRAINS", note: "deprecated" },
      { from: deprecatedSuperseder.id, to: governed.id, relation: "SUPERSEDES", note: "deprecated" },
    ],
  });
  data.projects = [{ ...projectRecord("src/deprecated", 1), status: "inactive" }];
  const profiles = buildConventionProfiles(data, { repository_id: "fixture" });
  assert.equal(profiles.length, 1);
  const profile = profiles[0];
  assert.deepEqual(profile.file_ids, [activeFile.id]);
  assert.deepEqual(profile.authoritative_evidence.map((item) => item.entity_id), [governed.id, activeRule.id]);
  assert.equal(profile.reusable_symbols[0].relations.some((item) => item.entity_id === deprecatedCaller.id), false);
  assert.equal(canonicalConventionJson(profile).includes("deprecated"), false);
  assert.equal(canonicalConventionJson(profile).includes("non-truth"), false);

  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-eligibility-")));
  const stateDir = path.join(repoRoot, "state");
  try {
    materializeDocuments(repoRoot, { ...data, documents: [activeFile] });
    const policyPath = path.join(repoRoot, ...governed.path.split("/"));
    fs.mkdirSync(path.dirname(policyPath), { recursive: true });
    fs.writeFileSync(policyPath, "active policy\n");
    const result = await runConventions({ target: activeFile.path }, {
      data,
      repository_id: "fixture",
      repo_root: repoRoot,
      state_dir: stateDir,
    });
    assert.equal(canonicalConventionJson(result).includes("deprecated"), false);
    assert.equal(fs.readFileSync(path.join(stateDir, "manifest.json"), "utf8").includes("deprecated"), false);
    await assert.rejects(
      runConventions({ target: deprecatedFile.id }, { data, repository_id: "fixture", repo_root: repoRoot, persist: false }),
      /inactive|stale|No convention profile/,
    );
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("uses one strict persisted path grammar while accepting canonicalizable input aliases", async () => {
  const data = fixtureData();
  const canonical = buildConventionProfiles(data, { repository_id: "fixture" })[0];
  assert.equal(canonical.subsystem.path, "src/auth");
  const rootProfile = buildConventionProfiles(fixtureData({
    files: [document("root.ts")],
    chunks: [chunk("root.ts", "root")],
    modules: [],
    relations: [],
  }), { repository_id: "fixture" })[0];
  assert.equal(rootProfile.subsystem.path, ".");
  assert.equal(rootProfile.subsystem.id, "path:.");

  for (const invalidPath of ["./src/auth/factory.ts", "src//auth/factory.ts", "src/./auth/factory.ts", "src/auth/factory.ts/", "/src/auth/factory.ts", "."]) {
    const malformed = fixtureData({ files: [document(invalidPath)], chunks: [], modules: [], relations: [] });
    assert.throws(() => buildConventionProfiles(malformed, { repository_id: "fixture" }), /Invalid repository-relative/, invalidPath);
  }
  const invalidModule = fixtureData();
  invalidModule.modules[0].path = "src/./auth";
  assert.throws(() => buildConventionProfiles(invalidModule, { repository_id: "fixture" }), /Invalid repository-relative/);
  const invalidCitation = fixtureData({
    adrs: [adr("adr.bad-path", "policy", { path: "docs/./adr/bad.md" })],
  });
  invalidCitation.relations.push({ from: "adr.bad-path", to: "file:src/auth/factory.ts", relation: "CONSTRAINS", note: "" });
  assert.throws(() => buildConventionProfiles(invalidCitation, { repository_id: "fixture" }), /Invalid repository-relative/);

  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-path-alias-")));
  try {
    materializeDocuments(repoRoot, data);
    const result = await runConventions({ target: "./src//auth/./factory.ts" }, {
      data,
      repository_id: "fixture",
      repo_root: repoRoot,
      persist: false,
    });
    assert.equal(result.target.path, "src/auth/factory.ts");
    assert.equal(result.profiles[0].profile_hash, canonical.profile_hash);
    assert.equal(result.profiles[0].source_hash, canonical.source_hash);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("preserves all contradictory active claims while making governing priority explicit", () => {
  const conflictData = fixtureData({
    rules: [
      rule("rule.errors-a", "convention:error.strategy=result", 90),
      rule("rule.errors-b", "convention:error.strategy=exception", 90),
      rule("rule.lower", "convention:logging.sink=stdout", 80),
      rule("rule.higher", "convention:logging.sink=structured", 100),
    ],
  });
  const profile = buildConventionProfiles(conflictData, { repository_id: "fixture" })[0];

  assert.equal(profile.conflicts.length, 2);
  assert.equal(profile.conflicts[0].key, "error.strategy");
  assert.equal(profile.conflicts[0].governing_priority, 90);
  assert.deepEqual(profile.conflicts[0].claims.map((claim) => claim.value), ["exception", "result"]);
  assert.equal(profile.conflicts[1].key, "logging.sink");
  assert.equal(profile.conflicts[1].governing_priority, 100);
  assert.deepEqual(profile.conflicts[1].claims.map((claim) => [claim.priority, claim.value]), [
    [100, "structured"],
    [80, "stdout"],
  ]);
});

test("ADR authority uses exact graph applicability and only applicable active superseders", () => {
  const rootFile = document("main.ts");
  const rootChunk = chunk("main.ts", "main");
  const unrelated = adr("adr.unrelated", "Ordinary prose mentions main.ts, src/auth, and punctuation.");
  const prefixCollision = adr("adr.prefix", "The src/auth-extra path is discussed incidentally.");
  const governed = adr("adr.governed", "convention:error.strategy=result");
  const inactiveSuperseder = adr("adr.inactive", "convention:error.strategy=exception", { status: "inactive" });
  const activeSuperseder = adr("adr.active", "convention:error.strategy=typed-result");
  const base = fixtureData({
    files: [rootFile],
    chunks: [rootChunk],
    modules: [],
    rules: [],
    adrs: [unrelated, prefixCollision, governed, inactiveSuperseder],
    relations: [
      { from: governed.id, to: rootFile.id, relation: "CONSTRAINS", note: "exact" },
      { from: inactiveSuperseder.id, to: rootFile.id, relation: "CONSTRAINS", note: "inactive" },
      { from: inactiveSuperseder.id, to: governed.id, relation: "SUPERSEDES", note: "inactive" },
    ],
  });
  const withoutActive = buildConventionProfiles(base, { repository_id: "fixture" })[0];
  assert.deepEqual(withoutActive.authoritative_evidence.map((item) => item.entity_id), [governed.id]);
  assert.equal(withoutActive.authoritative_evidence.some((item) => item.entity_id === unrelated.id || item.entity_id === prefixCollision.id), false);

  const withActive = {
    ...base,
    adrs: [...base.adrs, activeSuperseder],
    relations: [
      ...base.relations,
      { from: activeSuperseder.id, to: rootFile.id, relation: "CONSTRAINS", note: "exact" },
      { from: activeSuperseder.id, to: governed.id, relation: "SUPERSEDES", note: "active" },
    ],
  };
  const active = buildConventionProfiles(withActive, { repository_id: "fixture" })[0];
  assert.deepEqual(active.authoritative_evidence.map((item) => item.entity_id), [activeSuperseder.id]);
});

test("ADR supersession requires equal canonical applicability sets", () => {
  const files = [document("src/scope/a.ts"), document("src/scope/b.ts")];
  const chunks = [chunk(files[0].path, "a"), chunk(files[1].path, "b")];
  const module = moduleRecord("src/scope", 2);
  const governed = adr("adr.governed", "convention:storage.mode=legacy");
  const superseder = adr("adr.superseder", "convention:storage.mode=current");
  const baseRelations = [
    ...files.map((file) => ({ from: module.id, to: file.id, relation: "CONTAINS", note: "" })),
    ...files.map((file) => ({ from: governed.id, to: file.id, relation: "CONSTRAINS", note: "exact" })),
    { from: superseder.id, to: governed.id, relation: "SUPERSEDES", note: "explicit" },
  ];
  const build = (extraRelations, supersederStatus = "active") => buildConventionProfiles(fixtureData({
    files,
    chunks,
    modules: [module],
    rules: [],
    adrs: [governed, { ...superseder, status: supersederStatus }],
    relations: [...baseRelations, ...extraRelations],
  }), { repository_id: "fixture" })[0].authoritative_evidence.map((item) => item.entity_id);

  assert.deepEqual(build(files.map((file) => ({ from: superseder.id, to: file.id, relation: "CONSTRAINS", note: "same" }))), [superseder.id]);
  assert.deepEqual(build([{ from: superseder.id, to: "file:src/other.ts", relation: "CONSTRAINS", note: "disjoint" }]), [governed.id]);
  assert.deepEqual(build([{ from: superseder.id, to: files[0].id, relation: "CONSTRAINS", note: "partial" }]), [governed.id, superseder.id]);
  assert.deepEqual(build([
    ...files.map((file) => ({ from: superseder.id, to: file.id, relation: "CONSTRAINS", note: "current-plus-extra" })),
    { from: superseder.id, to: "file:src/other.ts", relation: "CONSTRAINS", note: "current-plus-extra" },
  ]), [governed.id, superseder.id]);
  assert.deepEqual(build(files.map((file) => ({ from: superseder.id, to: file.id, relation: "CONSTRAINS", note: "inactive" })), "inactive"), [governed.id]);

  const rootFile = document("root.ts");
  const rootProfile = buildConventionProfiles(fixtureData({
    files: [rootFile],
    chunks: [chunk(rootFile.path, "root")],
    modules: [],
    rules: [],
    adrs: [governed, superseder],
    relations: [
      { from: governed.id, to: rootFile.id, relation: "CONSTRAINS", note: "same" },
      { from: superseder.id, to: rootFile.id, relation: "CONSTRAINS", note: "same" },
      { from: superseder.id, to: governed.id, relation: "SUPERSEDES", note: "explicit" },
    ],
  }), { repository_id: "fixture" })[0];
  assert.deepEqual(rootProfile.authoritative_evidence.map((item) => item.entity_id), [superseder.id]);
});

test("sorts and deduplicates capped relation evidence before hashing", () => {
  const data = fixtureData();
  const factory = data.chunks.find((item) => item.name === "createAuthFactory");
  const extraChunks = [];
  const extraRelations = [];
  for (let index = 0; index < CONVENTION_LIMITS.max_reusable_relations + 8; index += 1) {
    const caller = chunk("src/auth/caller.ts", `caller${String(index).padStart(2, "0")}`, { exported: false, start: 100 + index * 10 });
    extraChunks.push(caller);
    extraRelations.push({ from: caller.id, to: factory.id, relation: "CALLS", note: index % 2 === 0 ? "tied-a" : "tied-b" });
  }
  extraChunks.push({ ...extraChunks[0], signature: "caller00(tiedDuplicate)" });
  extraRelations.push(structuredClone(extraRelations[0]));
  extraRelations.push({ ...extraRelations[0], note: "duplicate-entity-different-note" });
  const expanded = { ...data, chunks: [...data.chunks, ...extraChunks], relations: [...data.relations, ...extraRelations] };
  const reversed = { ...expanded, chunks: [...expanded.chunks].reverse(), relations: [...expanded.relations].reverse() };
  const forwardProfile = buildConventionProfiles(expanded, { repository_id: "fixture" })[0];
  const reverseProfile = buildConventionProfiles(reversed, { repository_id: "fixture" })[0];
  assert.equal(canonicalConventionJson(reverseProfile), canonicalConventionJson(forwardProfile));
  assert.equal(reverseProfile.source_hash, forwardProfile.source_hash);
  assert.equal(reverseProfile.profile_hash, forwardProfile.profile_hash);
  assert.equal(forwardProfile.reusable_symbols[0].relations.length, CONVENTION_LIMITS.max_reusable_relations);
  assert.ok(forwardProfile.diagnostics.reusable_relations_omitted > 0);
  assert.equal(forwardProfile.limits.max_reusable_relations, CONVENTION_LIMITS.max_reusable_relations);
  assert.match(canonicalConventionJson(forwardProfile), /"max_reusable_relations": 20/);
  assert.equal(new Set(forwardProfile.reusable_symbols[0].relations.map((item) => canonicalConventionJson(item))).size, forwardProfile.reusable_symbols[0].relations.length);

  const forwardState = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-relations-forward-")));
  const reverseState = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-relations-reverse-")));
  try {
    assert.throws(
      () => persistConventionProfiles([forwardProfile], persistenceOptions(expanded, forwardState)),
      /unique indexed backing record/,
    );
    assert.throws(
      () => persistConventionProfiles([reverseProfile], persistenceOptions(reversed, reverseState)),
      /unique indexed backing record/,
    );
  } finally {
    fs.rmSync(forwardState, { recursive: true, force: true });
    fs.rmSync(reverseState, { recursive: true, force: true });
  }
});

test("source hashes cross the reusable-relation cap and ignore unrelated records", () => {
  const exportFile = document("src/local/export.ts");
  const exported = chunk(exportFile.path, "createLocal", { start: 10 });
  const local = moduleRecord("src/local", 1);
  const externalProjects = Array.from(
    { length: CONVENTION_LIMITS.max_reusable_relations },
    (_, index) => projectRecord(`zz-external-${String(index).padStart(2, "0")}`, 0),
  );
  const dataFor = (count) => fixtureData({
    files: [exportFile],
    chunks: [exported],
    modules: [local],
    projects: externalProjects.slice(0, count),
    rules: [],
    adrs: [],
    relations: [
      { from: local.id, to: exportFile.id, relation: "CONTAINS", note: "" },
      { from: local.id, to: exported.id, relation: "EXPORTS", note: "" },
      ...externalProjects.slice(0, count).map((item) => ({ from: item.id, to: exported.id, relation: "DEFINES", note: "cap-only" })),
    ],
  });
  const profileFor = (data) => buildConventionProfiles(data, { repository_id: "fixture" })
    .find((profile) => profile.subsystem.id === local.id);
  // EXPORTS is itself one retained incident relation, so 19 and 20 external
  // DEFINES edges exercise the complete 20-to-21 transition. The project IDs
  // sort after the retained EXPORTS edge, keeping the retained array stable.
  const atCapData = dataFor(CONVENTION_LIMITS.max_reusable_relations - 1);
  const overCapData = dataFor(CONVENTION_LIMITS.max_reusable_relations);
  const atCap = profileFor(atCapData);
  const overCap = profileFor(overCapData);
  const reversed = profileFor({
    ...overCapData,
    documents: [...overCapData.documents].reverse(),
    chunks: [...overCapData.chunks].reverse(),
    modules: [...overCapData.modules].reverse(),
    projects: [...overCapData.projects].reverse(),
    relations: [...overCapData.relations].reverse(),
  });
  const unrelatedFile = document("src/unrelated/standalone.ts");
  const unrelatedChunk = chunk(unrelatedFile.path, "standalone");
  const unrelated = profileFor({
    ...overCapData,
    documents: [...overCapData.documents, unrelatedFile],
    chunks: [...overCapData.chunks, unrelatedChunk],
  });

  assert.equal(atCap.diagnostics.reusable_relations_omitted, 0);
  assert.equal(overCap.diagnostics.reusable_relations_omitted, 1);
  assert.deepEqual(overCap.reusable_symbols[0].relations, atCap.reusable_symbols[0].relations);
  assert.notEqual(overCap.source_hash, atCap.source_hash);
  assert.notEqual(overCap.profile_hash, atCap.profile_hash);
  assert.equal(canonicalConventionJson(reversed), canonicalConventionJson(overCap));
  assert.equal(unrelated.source_hash, overCap.source_hash);
});

test("source hashes cross the related-subsystem cap and ignore unrelated records", () => {
  const localFile = document("src/local/use.ts");
  const localChunk = chunk(localFile.path, "useRemote", { exported: false, start: 10 });
  const local = moduleRecord("src/local", 1);
  const externalFiles = Array.from(
    { length: CONVENTION_LIMITS.max_related_subsystems + 1 },
    (_, index) => document(`src/remote-${String(index).padStart(2, "0")}/api.ts`),
  );
  const externalChunks = externalFiles.map((file, index) => chunk(
    file.path,
    `remote${String(index).padStart(2, "0")}`,
    { exported: false, start: 20 + index * 10 },
  ));
  const externalModules = externalFiles.map((file) => moduleRecord(path.posix.dirname(file.path), 1));
  const dataFor = (count) => fixtureData({
    files: [localFile, ...externalFiles.slice(0, count)],
    chunks: [localChunk, ...externalChunks.slice(0, count)],
    modules: [local, ...externalModules.slice(0, count)],
    rules: [],
    adrs: [],
    relations: [
      { from: local.id, to: localFile.id, relation: "CONTAINS", note: "" },
      ...externalFiles.slice(0, count).map((file, index) => ({ from: externalModules[index].id, to: file.id, relation: "CONTAINS", note: "" })),
      ...externalChunks.slice(0, count).map((item) => ({ from: localChunk.id, to: item.id, relation: "CALLS", note: "cap-only" })),
    ],
  });
  const profileFor = (data) => buildConventionProfiles(data, { repository_id: "fixture" })
    .find((profile) => profile.subsystem.id === local.id);
  const atCapData = dataFor(CONVENTION_LIMITS.max_related_subsystems);
  const overCapData = dataFor(CONVENTION_LIMITS.max_related_subsystems + 1);
  const atCap = profileFor(atCapData);
  const overCap = profileFor(overCapData);
  const reversed = profileFor({
    ...overCapData,
    documents: [...overCapData.documents].reverse(),
    chunks: [...overCapData.chunks].reverse(),
    modules: [...overCapData.modules].reverse(),
    relations: [...overCapData.relations].reverse(),
  });
  const unrelatedFile = document("src/unrelated/standalone.ts");
  const unrelatedChunk = chunk(unrelatedFile.path, "standalone");
  const unrelated = profileFor({
    ...overCapData,
    documents: [...overCapData.documents, unrelatedFile],
    chunks: [...overCapData.chunks, unrelatedChunk],
  });

  assert.equal(atCap.diagnostics.related_subsystems_omitted, 0);
  assert.equal(overCap.diagnostics.related_subsystems_omitted, 1);
  assert.deepEqual(overCap.related_subsystems, atCap.related_subsystems);
  assert.notEqual(overCap.source_hash, atCap.source_hash);
  assert.notEqual(overCap.profile_hash, atCap.profile_hash);
  assert.equal(canonicalConventionJson(reversed), canonicalConventionJson(overCap));
  assert.equal(unrelated.source_hash, overCap.source_hash);
});

test("source hashes close over external caller, test, and cross-subsystem output dependencies only", () => {
  const exportFile = document("src/auth/export.ts");
  const callerFile = document("src/client/caller.ts");
  const testFile = document("src/client/caller.test.ts");
  const exported = chunk(exportFile.path, "createAuth", { start: 10 });
  const caller = chunk(callerFile.path, "callAuth", { exported: false, start: 30 });
  const testCaller = chunk(testFile.path, "testAuth", { exported: false, start: 50 });
  const auth = moduleRecord("src/auth", 1);
  const client = moduleRecord("src/client", 2);
  const data = fixtureData({
    files: [exportFile, callerFile, testFile],
    chunks: [exported, caller, testCaller],
    modules: [auth, client],
    rules: [],
    adrs: [],
    relations: [
      { from: auth.id, to: exportFile.id, relation: "CONTAINS", note: "" },
      { from: client.id, to: callerFile.id, relation: "CONTAINS", note: "" },
      { from: client.id, to: testFile.id, relation: "CONTAINS", note: "" },
      { from: auth.id, to: exported.id, relation: "EXPORTS", note: "" },
      { from: caller.id, to: exported.id, relation: "CALLS", note: "caller" },
      { from: testCaller.id, to: exported.id, relation: "CALLS", note: "test" },
    ],
  });
  const authProfile = (value) => buildConventionProfiles(value, { repository_id: "fixture" })
    .find((profile) => profile.subsystem.id === auth.id);
  const baseline = authProfile(data);
  const reversed = authProfile({
    ...data,
    documents: [...data.documents].reverse(),
    chunks: [...data.chunks].reverse(),
    modules: [...data.modules].reverse(),
    relations: [...data.relations].reverse(),
  });
  assert.equal(reversed.source_hash, baseline.source_hash);

  const callerLineChanged = authProfile({
    ...data,
    chunks: data.chunks.map((item) => item.id === caller.id
      ? { ...item, start_line: item.start_line + 1, end_line: item.end_line + 1 }
      : item),
  });
  const testLineChanged = authProfile({
    ...data,
    chunks: data.chunks.map((item) => item.id === testCaller.id
      ? { ...item, start_line: item.start_line + 1, end_line: item.end_line + 1 }
      : item),
  });
  assert.notEqual(callerLineChanged.source_hash, baseline.source_hash);
  assert.notEqual(testLineChanged.source_hash, baseline.source_hash);

  const unrelatedFile = document("src/unrelated/standalone.ts");
  const unrelatedChunk = chunk(unrelatedFile.path, "standalone");
  const withUnrelated = authProfile({
    ...data,
    documents: [...data.documents, unrelatedFile],
    chunks: [...data.chunks, unrelatedChunk],
  });
  assert.equal(withUnrelated.source_hash, baseline.source_hash);
});

test("representative caller and test caps expose exact deterministic omission accounting", () => {
  const exportFile = document("src/auth/export.ts");
  const callerFiles = Array.from({ length: 6 }, (_, index) => document(`src/client/caller-${index}.ts`));
  const testFiles = Array.from({ length: 6 }, (_, index) => document(`src/client/caller-${index}.test.ts`));
  const exported = chunk(exportFile.path, "createAuth", { start: 10 });
  const callers = callerFiles.map((file, index) => chunk(file.path, `caller${index}`, { exported: false, start: 20 + index * 10 }));
  const tests = testFiles.map((file, index) => chunk(file.path, `testCaller${index}`, { exported: false, start: 100 + index * 10 }));
  const auth = moduleRecord("src/auth", 1);
  const client = moduleRecord("src/client", 12);
  const data = fixtureData({
    files: [exportFile, ...callerFiles, ...testFiles],
    chunks: [exported, ...callers, ...tests],
    modules: [auth, client],
    rules: [],
    adrs: [],
    relations: [
      { from: auth.id, to: exportFile.id, relation: "CONTAINS", note: "" },
      ...[...callerFiles, ...testFiles].map((file) => ({ from: client.id, to: file.id, relation: "CONTAINS", note: "" })),
      { from: auth.id, to: exported.id, relation: "EXPORTS", note: "" },
      ...[...callers, ...tests].map((item) => ({ from: item.id, to: exported.id, relation: "CALLS", note: "" })),
    ],
  });
  const profileFor = (value) => buildConventionProfiles(value, { repository_id: "fixture" })
    .find((profile) => profile.subsystem.id === auth.id);
  const forward = profileFor(data);
  const reversed = profileFor({
    ...data,
    documents: [...data.documents].reverse(),
    chunks: [...data.chunks].reverse(),
    modules: [...data.modules].reverse(),
    relations: [...data.relations].reverse(),
  });
  const symbol = forward.reusable_symbols[0];
  assert.equal(canonicalConventionJson(reversed), canonicalConventionJson(forward));
  assert.equal(symbol.representative_callers_observed_count, 12);
  assert.equal(symbol.representative_callers.length, CONVENTION_LIMITS.max_representative_callers);
  assert.equal(symbol.representative_tests_observed_count, 6);
  assert.equal(symbol.representative_tests.length, CONVENTION_LIMITS.max_representative_callers);
  assert.equal(forward.diagnostics.representative_callers_omitted, 7);
  assert.equal(forward.diagnostics.representative_tests_omitted, 1);
});

test("retains typed provenance and full observed counts across citation caps", () => {
  const localFiles = [];
  const remoteFiles = [];
  const localChunks = [];
  const remoteChunks = [];
  const relations = [];
  const local = moduleRecord("src/local", 12);
  const remote = moduleRecord("src/remote", 12);
  const policy = adr("adr.mixed-applicability", "convention:mode=typed");
  for (let index = 0; index < 12; index += 1) {
    const localFile = document(`src/local/file${String(index).padStart(2, "0")}.ts`);
    const remoteFile = document(`src/remote/file${String(index).padStart(2, "0")}.ts`);
    const localChunk = chunk(localFile.path, `local${index}`, { start: index * 10 + 1 });
    const remoteChunk = chunk(remoteFile.path, `remote${index}`, { exported: false, start: index * 10 + 1 });
    localFiles.push(localFile);
    remoteFiles.push(remoteFile);
    localChunks.push(localChunk);
    remoteChunks.push(remoteChunk);
    relations.push(
      { from: local.id, to: localFile.id, relation: "CONTAINS", note: "" },
      { from: remote.id, to: remoteFile.id, relation: "CONTAINS", note: "" },
      { from: localChunk.id, to: remoteChunk.id, relation: index % 2 === 0 ? "CALLS" : "IMPORTS", note: "mixed" },
      index % 2 === 0
        ? { from: policy.id, to: localFile.id, relation: "CONSTRAINS", note: "mixed" }
        : { from: localFile.id, to: policy.id, relation: "IMPLEMENTS", note: "mixed" },
    );
  }
  const data = fixtureData({
    files: [...localFiles, ...remoteFiles],
    chunks: [...localChunks, ...remoteChunks],
    modules: [local, remote],
    rules: [],
    adrs: [policy],
    relations,
  });
  const profile = buildConventionProfiles(data, { repository_id: "fixture" })
    .find((item) => item.subsystem.id === local.id);
  const reversed = buildConventionProfiles({
    ...data,
    documents: [...data.documents].reverse(),
    chunks: [...data.chunks].reverse(),
    relations: [...data.relations].reverse(),
  }, { repository_id: "fixture" }).find((item) => item.subsystem.id === local.id);
  assert.equal(canonicalConventionJson(reversed), canonicalConventionJson(profile));
  assert.equal(profile.subsystem.evidence.length, CONVENTION_LIMITS.max_evidence_per_fact);
  assert.equal(profile.diagnostics.subsystem_evidence_omitted, 2);

  const authority = profile.authoritative_evidence.find((item) => item.entity_id === policy.id);
  assert.equal(authority.observed_count, 12);
  assert.equal(authority.evidence.length, CONVENTION_LIMITS.max_evidence_per_fact);
  assert.deepEqual([...new Set(authority.evidence.map((item) => item.relation.type))].sort(), ["CONSTRAINS", "IMPLEMENTS"]);
  assert.equal(profile.diagnostics.authoritative_evidence_omitted, 2);

  const related = profile.related_subsystems.find((item) => item.subsystem_id === remote.id);
  assert.equal(related.observed_count, 12);
  assert.equal(related.evidence.length, CONVENTION_LIMITS.max_evidence_per_fact);
  assert.deepEqual(related.relation_types, ["CALLS", "IMPORTS"]);
  assert.equal(profile.diagnostics.related_subsystem_evidence_omitted, 2);
  const graphFact = profile.structural_facts.find((item) => item.category === "graph_connection" && item.value === remote.id);
  assert.equal(graphFact.observed_count, 12);
  assert.deepEqual(graphFact.evidence, related.evidence);

  for (const [label, mutate] of [
    ["undeclared retained type", (value) => { value.related_subsystems[0].relation_types = ["CALLS"]; }],
    ["rewritten observed total", (value) => { value.related_subsystems[0].observed_count = value.related_subsystems[0].evidence.length; value.structural_facts.find((item) => item.category === "graph_connection").observed_count = value.related_subsystems[0].evidence.length; }],
    ["incoherent authority omission", (value) => { value.diagnostics.authoritative_evidence_omitted = 0; }],
    ["incoherent related omission", (value) => { value.diagnostics.related_subsystem_evidence_omitted = 0; }],
  ]) {
    const malformed = structuredClone(profile);
    mutate(malformed);
    rehashProfile(malformed);
    assert.throws(() => validateConventionProfile(malformed), undefined, label);
  }
});

test("combined symbol and relation caps count omissions only for retained symbols", () => {
  const file = document("src/caps/exports.ts");
  const scope = moduleRecord("src/caps", 1);
  const exports = [];
  const callers = [];
  const relations = [{ from: scope.id, to: file.id, relation: "CONTAINS", note: "" }];
  for (let index = 0; index < CONVENTION_LIMITS.max_reusable_symbols; index += 1) {
    const symbol = chunk(file.path, `a${String(index).padStart(3, "0")}`, { start: index * 10 + 1 });
    exports.push(symbol);
    relations.push({ from: scope.id, to: symbol.id, relation: "EXPORTS", note: "" });
  }
  const omitted = chunk(file.path, "zzzzOmitted", { start: 5000 });
  exports.push(omitted);
  relations.push({ from: scope.id, to: omitted.id, relation: "EXPORTS", note: "" });
  for (let index = 0; index <= CONVENTION_LIMITS.max_reusable_relations; index += 1) {
    const caller = chunk(file.path, `caller${String(index).padStart(2, "0")}`, { exported: false, start: 6000 + index * 10 });
    callers.push(caller);
    relations.push({ from: caller.id, to: omitted.id, relation: "CALLS", note: "omitted-symbol" });
  }
  const data = fixtureData({ files: [file], chunks: [...exports, ...callers], modules: [scope], rules: [], relations });
  const forward = buildConventionProfiles(data, { repository_id: "fixture" })[0];
  const reversed = buildConventionProfiles({ ...data, chunks: [...data.chunks].reverse(), relations: [...data.relations].reverse() }, { repository_id: "fixture" })[0];
  assert.equal(canonicalConventionJson(reversed), canonicalConventionJson(forward));
  assert.equal(forward.reusable_symbols.length, CONVENTION_LIMITS.max_reusable_symbols);
  assert.equal(forward.reusable_symbols.some((item) => item.entity_id === omitted.id), false);
  assert.equal(forward.diagnostics.reusable_symbols_omitted, 1);
  assert.equal(forward.diagnostics.reusable_relations_omitted, 0);
  validateConventionProfile(forward);
});

test("keeps reusable graph relations exactly incident on each exported symbol", () => {
  const exportFile = document("src/auth/exports.ts");
  const callerFile = document("src/client/caller.ts");
  const first = chunk(exportFile.path, "firstExport", { start: 10 });
  const second = chunk(exportFile.path, "secondExport", { start: 30 });
  const caller = chunk(callerFile.path, "callFirst", { exported: false, start: 50 });
  const auth = moduleRecord("src/auth", 1);
  const client = moduleRecord("src/client", 1);
  const data = fixtureData({
    files: [exportFile, callerFile],
    chunks: [first, second, caller],
    modules: [auth, client],
    rules: [],
    relations: [
      { from: auth.id, to: exportFile.id, relation: "CONTAINS", note: "" },
      { from: client.id, to: callerFile.id, relation: "CONTAINS", note: "" },
      { from: auth.id, to: first.id, relation: "EXPORTS", note: "" },
      { from: auth.id, to: second.id, relation: "EXPORTS", note: "" },
      { from: exportFile.id, to: first.id, relation: "DEFINES", note: "file-level" },
      { from: exportFile.id, to: second.id, relation: "DEFINES", note: "file-level" },
      { from: caller.id, to: first.id, relation: "CALLS", note: "symbol-level" },
      { from: callerFile.id, to: exportFile.id, relation: "IMPORTS", note: "file-level" },
    ],
  });
  const profile = buildConventionProfiles(data, { repository_id: "fixture" })
    .find((item) => item.subsystem.id === auth.id);
  const firstRecord = profile.reusable_symbols.find((item) => item.entity_id === first.id);
  const secondRecord = profile.reusable_symbols.find((item) => item.entity_id === second.id);

  assert.deepEqual(firstRecord.relations.map((item) => [item.direction, item.relation, item.entity_id]), [
    ["incoming", "CALLS", caller.id],
    ["incoming", "DEFINES", exportFile.id],
    ["incoming", "EXPORTS", auth.id],
  ]);
  assert.deepEqual(secondRecord.relations.map((item) => [item.direction, item.relation, item.entity_id]), [
    ["incoming", "DEFINES", exportFile.id],
    ["incoming", "EXPORTS", auth.id],
  ]);
  assert.deepEqual(firstRecord.representative_callers.map((item) => item.entity_id), [caller.id]);
  assert.deepEqual(secondRecord.representative_callers, []);
  assert.equal(firstRecord.relations.some((item) => item.relation === "IMPORTS"), false);
  assert.equal(secondRecord.relations.some((item) => item.entity_id === caller.id), false);
});

test("rejects self, mutual, and longer active supersession cycles for an exact applicability set", () => {
  const file = document("src/policy/value.ts");
  const symbol = chunk(file.path, "value");
  const scope = moduleRecord("src/policy", 1);
  const records = [adr("adr.a", "a"), adr("adr.b", "b"), adr("adr.c", "c")];
  const base = [
    { from: scope.id, to: file.id, relation: "CONTAINS", note: "" },
    ...records.map((item) => ({ from: item.id, to: file.id, relation: "CONSTRAINS", note: "exact" })),
  ];
  const cases = [
    [{ from: records[0].id, to: records[0].id, relation: "SUPERSEDES", note: "self" }],
    [
      { from: records[0].id, to: records[1].id, relation: "SUPERSEDES", note: "mutual" },
      { from: records[1].id, to: records[0].id, relation: "SUPERSEDES", note: "mutual" },
    ],
    [
      { from: records[0].id, to: records[1].id, relation: "SUPERSEDES", note: "long" },
      { from: records[1].id, to: records[2].id, relation: "SUPERSEDES", note: "long" },
      { from: records[2].id, to: records[0].id, relation: "SUPERSEDES", note: "long" },
    ],
  ];
  for (const edges of cases) {
    assert.throws(() => buildConventionProfiles(fixtureData({
      files: [file],
      chunks: [symbol],
      modules: [scope],
      rules: [],
      adrs: records,
      relations: [...base, ...edges],
    }), { repository_id: "fixture" }), /supersession cycle/);
  }
});

test("rejects rehashed profiles whose canonical arrays are reversed", () => {
  const data = fixtureData({
    rules: [
      rule("rule.authority-a", "convention:error.a=one", 100),
      rule("rule.authority-b", "convention:error.a=two", 100),
      rule("rule.authority-c", "convention:error.b=one", 100),
      rule("rule.authority-d", "convention:error.b=two", 100),
    ],
  });
  const extraExport = chunk("src/auth/factory.ts", "createSecondFactory", { start: 60 });
  const secondTestFile = document("src/auth/second.test.ts");
  const secondTestCaller = chunk(secondTestFile.path, "secondFixture", { exported: false, start: 70 });
  const externalFiles = [document("src/b/export.ts"), document("src/c/export.ts")];
  const externalChunks = [chunk(externalFiles[0].path, "exportB"), chunk(externalFiles[1].path, "exportC")];
  const externalModules = [moduleRecord("src/b", 1), moduleRecord("src/c", 1)];
  const scopedAdr = adr("adr.scoped", "Use exact indexed scope.");
  data.documents.push(secondTestFile, ...externalFiles);
  data.chunks.push(extraExport, secondTestCaller, ...externalChunks);
  data.modules.push(...externalModules);
  data.adrs.push(scopedAdr);
  data.relations.push(
    { from: "module:src/auth", to: secondTestFile.id, relation: "CONTAINS", note: "" },
    { from: "module:src/auth", to: extraExport.id, relation: "EXPORTS", note: "" },
    { from: extraExport.file_id, to: extraExport.id, relation: "DEFINES", note: "" },
    { from: secondTestCaller.id, to: extraExport.id, relation: "CALLS", note: "" },
    { from: secondTestCaller.id, to: data.chunks.find((item) => item.name === "createAuthFactory").id, relation: "CALLS", note: "" },
    { from: externalModules[0].id, to: externalFiles[0].id, relation: "CONTAINS", note: "" },
    { from: externalModules[1].id, to: externalFiles[1].id, relation: "CONTAINS", note: "" },
    { from: data.chunks.find((item) => item.name === "useAuth").id, to: externalChunks[0].id, relation: "CALLS", note: "" },
    { from: data.chunks.find((item) => item.name === "useAuth").id, to: externalChunks[0].id, relation: "IMPORTS", note: "" },
    { from: data.chunks.find((item) => item.name === "useAuth").id, to: externalChunks[1].id, relation: "CALLS", note: "" },
    { from: scopedAdr.id, to: "file:src/auth/factory.ts", relation: "CONSTRAINS", note: "" },
    { from: scopedAdr.id, to: "file:src/auth/caller.ts", relation: "CONSTRAINS", note: "" },
  );
  const profile = buildConventionProfiles(data, { repository_id: "fixture" }).find((item) => item.subsystem.id === "module:src/auth");
  const reversals = [
    ["subsystem evidence", (value) => value.subsystem.evidence.reverse()],
    ["file IDs", (value) => value.file_ids.reverse()],
    ["authoritative evidence", (value) => value.authoritative_evidence.reverse()],
    ["authoritative nested evidence", (value) => value.authoritative_evidence.find((item) => item.evidence.length > 1).evidence.reverse()],
    ["structural facts", (value) => value.structural_facts.reverse()],
    ["structural nested evidence", (value) => value.structural_facts.find((fact) => fact.evidence.length > 1).evidence.reverse()],
    ["reusable symbols", (value) => value.reusable_symbols.reverse()],
    ["reusable relations", (value) => value.reusable_symbols.find((symbol) => symbol.relations.length > 1).relations.reverse()],
    ["representative callers", (value) => value.reusable_symbols.find((symbol) => symbol.representative_callers.length > 1).representative_callers.reverse()],
    ["representative tests", (value) => value.reusable_symbols.find((symbol) => symbol.representative_tests.length > 1).representative_tests.reverse()],
    ["related subsystems", (value) => value.related_subsystems.reverse()],
    ["related relation types", (value) => value.related_subsystems.find((related) => related.relation_types.length > 1).relation_types.reverse()],
    ["related nested evidence", (value) => value.related_subsystems.find((related) => related.evidence.length > 1).evidence.reverse()],
    ["conflicts", (value) => value.conflicts.reverse()],
    ["conflict claims", (value) => value.conflicts[0].claims.reverse()],
  ];
  for (const [label, mutate] of reversals) {
    const malformed = structuredClone(profile);
    mutate(malformed);
    rehashProfile(malformed);
    assert.throws(() => validateConventionProfile(malformed), /canonical builder ordering|sorted and unique/, label);
  }
});

test("reports deterministic conflict omissions instead of silently truncating", () => {
  const rules = [];
  for (let index = 0; index <= CONVENTION_LIMITS.max_conflicts; index += 1) {
    const key = `conflict.${String(index).padStart(3, "0")}`;
    rules.push(rule(`rule.${key}.a`, `convention:${key}=a`, 100));
    rules.push(rule(`rule.${key}.b`, `convention:${key}=b`, 100));
    rules.push(rule(`rule.${key}.lower`, `convention:${key}=lower`, 50));
  }
  const forward = buildConventionProfiles(fixtureData({ rules }), { repository_id: "fixture" })[0];
  const reversed = buildConventionProfiles(fixtureData({ rules: [...rules].reverse() }), { repository_id: "fixture" })[0];
  assert.equal(forward.conflicts.length, CONVENTION_LIMITS.max_conflicts);
  assert.equal(forward.diagnostics.conflicts_omitted, 1);
  assert.equal(forward.conflicts[0].governing_priority, 100);
  assert.deepEqual(forward.conflicts[0].claims.map((claim) => claim.priority), [100, 100, 50]);
  assert.equal(canonicalConventionJson(reversed), canonicalConventionJson(forward));
});

test("incremental persistence rewrites only changed graph-dependent profiles and removes deleted scopes", () => {
  const stateDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-state-")));
  try {
    const leftFiles = [document("src/a/export.ts"), document("src/a/caller.ts")];
    const rightFiles = [document("src/b/export.ts"), document("src/b/caller.ts")];
    const leftExport = chunk("src/a/export.ts", "createAFactory");
    const leftCaller = chunk("src/a/caller.ts", "callA", { exported: false });
    const rightExport = chunk("src/b/export.ts", "createBFactory");
    const rightCaller = chunk("src/b/caller.ts", "callB", { exported: false });
    const modules = [moduleRecord("src/a", 2), moduleRecord("src/b", 2)];
    const base = fixtureData({
      files: [...leftFiles, ...rightFiles],
      chunks: [leftExport, leftCaller, rightExport, rightCaller],
      modules,
      relations: [
        ...leftFiles.map((file) => ({ from: "module:src/a", to: file.id, relation: "CONTAINS", note: "" })),
        ...rightFiles.map((file) => ({ from: "module:src/b", to: file.id, relation: "CONTAINS", note: "" })),
        { from: "module:src/a", to: leftExport.id, relation: "EXPORTS", note: "" },
        { from: "module:src/b", to: rightExport.id, relation: "EXPORTS", note: "" },
      ],
    });
    const first = persistConventionProfiles(buildConventionProfiles(base, { repository_id: "fixture" }), persistenceOptions(base, stateDir));
    assert.equal(first.changed_profile_ids.length, 2);

    const second = persistConventionProfiles(buildConventionProfiles(base, { repository_id: "fixture" }), persistenceOptions(base, stateDir));
    assert.equal(second.changed_profile_ids.length, 0);
    assert.equal(second.unchanged_profile_ids.length, 2);

    const changed = {
      ...base,
      chunks: base.chunks.map((item) => item.id === leftExport.id ? { ...item, signature: "createAFactory(input)" } : item),
    };
    const third = persistConventionProfiles(buildConventionProfiles(changed, { repository_id: "fixture" }), persistenceOptions(changed, stateDir));
    assert.equal(third.changed_profile_ids.length, 1);
    assert.equal(third.unchanged_profile_ids.length, 1);

    const withoutLeft = {
      ...changed,
      documents: changed.documents.filter((item) => !item.path.startsWith("src/a/")),
      chunks: changed.chunks.filter((item) => !item.file_id.startsWith("file:src/a/")),
      modules: changed.modules.filter((item) => item.id !== "module:src/a"),
      relations: changed.relations.filter((item) => !item.from.includes("src/a") && !item.to.includes("src/a")),
    };
    const fourth = persistConventionProfiles(buildConventionProfiles(withoutLeft, { repository_id: "fixture" }), persistenceOptions(withoutLeft, stateDir));
    assert.equal(fourth.removed_profile_ids.length, 1);
    assert.equal(fourth.manifest.profiles.length, 1);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("strict prior-limit migration rewrites retained profiles and removes deleted legacy scopes", () => {
  const stateDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-legacy-migrate-")));
  try {
    const data = pairedProfileData();
    const currentProfiles = buildConventionProfiles(data, { repository_id: "fixture" });
    const initial = persistConventionProfiles(currentProfiles, persistenceOptions(data, stateDir));
    const legacyProfiles = currentProfiles.map(priorLimitProfile);
    const legacyById = new Map(legacyProfiles.map((profile) => [profile.profile_id, profile]));
    for (const entry of initial.manifest.profiles) {
      fs.writeFileSync(
        path.join(stateDir, ...entry.relative_path.split("/")),
        canonicalConventionJson(legacyById.get(entry.profile_id)),
      );
    }
    const legacyManifest = priorLimitManifest(initial.manifest, legacyById);
    fs.writeFileSync(path.join(stateDir, "manifest.json"), canonicalConventionJson(legacyManifest));

    const removedProfile = currentProfiles.find((profile) => profile.subsystem.id === "module:src/a");
    const retainedProfile = currentProfiles.find((profile) => profile.subsystem.id === "module:src/b");
    const remainingData = {
      ...data,
      documents: data.documents.filter((item) => item.path.startsWith("src/b/")),
      chunks: data.chunks.filter((item) => item.file_id.startsWith("file:src/b/")),
      modules: data.modules.filter((item) => item.id === "module:src/b"),
      relations: data.relations.filter((item) => !item.from.includes("src/a") && !item.to.includes("src/a")),
    };
    const remainingProfiles = buildConventionProfiles(remainingData, { repository_id: "fixture" });
    const migrated = persistConventionProfiles(remainingProfiles, persistenceOptions(remainingData, stateDir));
    assert.deepEqual(migrated.changed_profile_ids, [retainedProfile.profile_id]);
    assert.deepEqual(migrated.removed_profile_ids, [removedProfile.profile_id]);
    assert.equal(migrated.manifest.profiles.length, 1);
    assert.equal(migrated.manifest.limits.max_repository_control_bytes, CONVENTION_LIMITS.max_repository_control_bytes);
    assert.equal(fs.existsSync(path.join(stateDir, ...initial.manifest.profiles.find((entry) => entry.profile_id === removedProfile.profile_id).relative_path.split("/"))), false);
    const retainedEntry = migrated.manifest.profiles[0];
    assert.equal(
      fs.readFileSync(path.join(stateDir, ...retainedEntry.relative_path.split("/")), "utf8"),
      canonicalConventionJson(remainingProfiles[0]),
    );
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("old-limit compatibility rejects every unrelated manifest failure", () => {
  const stateDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-legacy-negative-")));
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-legacy-negative-outside-")));
  const sentinel = path.join(outside, "sentinel.txt");
  try {
    fs.writeFileSync(sentinel, "outside-sentinel\n");
    const data = pairedProfileData();
    const profiles = buildConventionProfiles(data, { repository_id: "fixture" });
    const initial = persistConventionProfiles(profiles, persistenceOptions(data, stateDir));
    const legacy = priorLimitManifest(initial.manifest);
    const cases = [
      ["unknown root key", (value) => { value.unknown = true; }],
      ["missing root key", (value) => { delete value.repository_id; }],
      ["wrong schema", (value) => { value.schema_version = 2; }],
      ["wrong generator", (value) => { value.generator_version = "other"; }],
      ["wrong limit type", (value) => { value.limits.max_profile_bytes = "2000000"; }],
      ["bad index hash", (value) => { value.index_hash = "0".repeat(64); }],
      ["bad repository", (value) => { value.repository_id = "../outside"; }],
      ["malformed entries", (value) => { value.profiles = {}; }],
      ["reordered entries", (value) => { value.profiles.reverse(); rehashManifest(value); }],
      ["duplicate entries", (value) => { value.profiles[1] = structuredClone(value.profiles[0]); rehashManifest(value); }],
      ["bad profile ID", (value) => { value.profiles[0].profile_id = `convention:${"0".repeat(32)}`; rehashManifest(value); }],
      ["bad profile path", (value) => { value.profiles[0].relative_path = "profiles/../outside.json"; rehashManifest(value); }],
    ];
    for (const [label, mutate] of cases) {
      const malformed = structuredClone(legacy);
      mutate(malformed);
      fs.writeFileSync(path.join(stateDir, "manifest.json"), canonicalConventionJson(malformed));
      assert.throws(
        () => persistConventionProfiles(profiles, persistenceOptions(data, stateDir)),
        undefined,
        label,
      );
      assert.equal(fs.readFileSync(sentinel, "utf8"), "outside-sentinel\n", label);
    }
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("rejects unknown schema keys and tampered persisted hashes", () => {
  const stateDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-schema-")));
  try {
    const data = fixtureData();
    const profile = buildConventionProfiles(data, { repository_id: "fixture" })[0];
    assert.throws(() => validateConventionProfile({ ...profile, unknown_key: true }), /unknown or missing schema keys/);
    const result = persistConventionProfiles([profile], persistenceOptions(data, stateDir));
    const profilePath = path.join(stateDir, result.manifest.profiles[0].relative_path);
    const tampered = JSON.parse(fs.readFileSync(profilePath, "utf8"));
    tampered.language = "javascript";
    fs.writeFileSync(profilePath, JSON.stringify(tampered), "utf8");
    assert.throws(() => readConventionProfile(profilePath), /inconsistent|hash mismatch/);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("rejects rehashed profiles with invalid recursive schema and inconsistent identities", () => {
  const profile = buildConventionProfiles(fixtureData(), { repository_id: "fixture" })[0];
  const cases = [
    ["nested unknown key", (value) => { value.subsystem.unknown = true; }],
    ["nested missing key", (value) => { delete value.reusable_symbols[0].role; }],
    ["wrong container type", (value) => { value.reusable_symbols[0].relations = {}; }],
    ["wrong scalar type", (value) => { value.structural_facts[0].statement = 42; }],
    ["invalid scalar bound", (value) => { value.structural_facts[0].observed_count = -1; }],
    ["invalid versioned limit", (value) => { value.limits.max_reusable_relations += 1; }],
    ["non-canonical path", (value) => { value.subsystem.path = "src/../auth"; }],
    ["inconsistent profile ID", (value) => { value.profile_id = `convention:${"0".repeat(32)}`; }],
    ["unrelated reusable-symbol path", (value) => {
      value.reusable_symbols[0].path = "src/unrelated.ts";
      value.reusable_symbols[0].evidence[0].path = "src/unrelated.ts";
    }],
    ["substituted primary symbol evidence", (value) => { value.reusable_symbols[0].evidence[0].entity_id = "chunk:src/auth/factory.ts:other:1-2"; }],
    ["inconsistent file IDs", (value) => { value.file_ids[0] = "file:src/unrelated.ts"; value.file_ids.sort(); }],
    ["mismatched subsystem evidence", (value) => { value.subsystem.evidence[0].relation = "PATH_SCOPE"; value.subsystem.evidence.sort((a, b) => `${a.relation}:${a.entity_id}`.localeCompare(`${b.relation}:${b.entity_id}`)); }],
    ["mismatched authoritative evidence", (value) => { value.authoritative_evidence[0].evidence[0].entity_id = "rule.other"; }],
    ["mismatched authoritative type", (value) => { value.authoritative_evidence[0].entity_type = "ADR"; }],
  ];
  for (const [label, mutate] of cases) {
    const malformed = structuredClone(profile);
    mutate(malformed);
    rehashProfile(malformed);
    assert.throws(() => validateConventionProfile(malformed), undefined, label);
  }
});

test("context-aware validation rejects coherent rehashes the canonical builder could not produce", () => {
  const authFiles = [document("src/auth/factory.ts"), document("src/auth/factory.test.ts")];
  const otherFile = document("src/client/caller.ts");
  const factory = chunk(authFiles[0].path, "createFactory", { start: 10 });
  const siblingExport = chunk(authFiles[0].path, "createSibling", { start: 30 });
  const testCaller = chunk(authFiles[1].path, "factoryTest", { exported: false, start: 50 });
  const otherCaller = chunk(otherFile.path, "callFactory", { exported: false, start: 70 });
  const auth = moduleRecord("src/auth", authFiles.length);
  const client = moduleRecord("src/client", 1);
  const data = fixtureData({
    files: [...authFiles, otherFile],
    chunks: [factory, siblingExport, testCaller, otherCaller],
    modules: [auth, client],
    rules: [
      rule("rule.errors.high", "convention:error.mode=result", 100),
      rule("rule.errors.low", "convention:error.mode=exception", 80),
    ],
    relations: [
      ...authFiles.map((file) => ({ from: auth.id, to: file.id, relation: "CONTAINS", note: "" })),
      { from: client.id, to: otherFile.id, relation: "CONTAINS", note: "" },
      { from: auth.id, to: factory.id, relation: "EXPORTS", note: "" },
      { from: auth.id, to: siblingExport.id, relation: "EXPORTS", note: "" },
      { from: testCaller.id, to: factory.id, relation: "CALLS", note: "test" },
      { from: otherCaller.id, to: factory.id, relation: "CALLS", note: "cross" },
    ],
  });
  const profile = buildConventionProfiles(data, { repository_id: "fixture" })
    .find((item) => item.subsystem.id === auth.id);
  const cases = [
    ["empty structural evidence", (value) => { value.structural_facts[0].evidence = []; }],
    ["fabricated fact evidence", (value) => {
      value.structural_facts.find((item) => item.category === "exported_symbol_kind").evidence[0] = {
        entity_id: otherCaller.id,
        path: otherFile.path,
        start_line: otherCaller.start_line,
        end_line: otherCaller.end_line,
      };
    }],
    ["fabricated related evidence", (value) => {
      value.related_subsystems[0].evidence[0].relation.from = siblingExport.id;
      value.structural_facts.find((item) => item.category === "graph_connection").evidence = structuredClone(value.related_subsystems[0].evidence);
    }],
    ["fabricated caller evidence", (value) => {
      value.reusable_symbols.find((item) => item.entity_id === factory.id).representative_callers[0] = {
        entity_id: siblingExport.id,
        path: authFiles[0].path,
        start_line: siblingExport.start_line,
        end_line: siblingExport.end_line,
      };
    }],
    ["fabricated conflict source", (value) => {
      const claim = value.conflicts[0].claims[1];
      claim.source_id = "rule.fabricated";
      claim.evidence.entity_id = "rule.fabricated";
    }],
    ["impossible omission diagnostic", (value) => { value.diagnostics.related_subsystems_omitted = 1; }],
    ["subsystem type change", (value) => { value.subsystem.type = "project"; value.subsystem.evidence.forEach((item) => { item.relation = "INCLUDES_FILE"; }); }],
    ["subsystem path change", (value) => { value.subsystem.path = "src/client"; }],
    ["authority scope flip", (value) => { value.authoritative_evidence[0].scope = "subsystem"; }],
    ["unrelated exported-symbol citation", (value) => {
      const symbol = value.reusable_symbols.find((item) => item.entity_id === factory.id);
      symbol.evidence[0].entity_id = siblingExport.id;
    }],
  ];
  for (const [label, mutate] of cases) {
    const malformed = structuredClone(profile);
    mutate(malformed);
    rehashProfile(malformed);
    assert.throws(
      () => validateConventionProfilesAgainstContext([malformed], data, { repository_id: "fixture" }),
      undefined,
      label,
    );
  }
});

test("rejects rehashed manifests with recursive schema, path, ID, and uniqueness violations", () => {
  const stateDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-manifest-schema-")));
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-manifest-outside-")));
  const sentinel = path.join(outside, "sentinel.txt");
  try {
    fs.writeFileSync(sentinel, "outside-sentinel\n");
    const data = pairedProfileData();
    const profiles = buildConventionProfiles(data, { repository_id: "fixture" });
    persistConventionProfiles(profiles, persistenceOptions(data, stateDir));
    const manifestPath = path.join(stateDir, "manifest.json");
    const valid = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const cases = [
      ["nested unknown key", (value) => { value.profiles[0].unknown = true; }],
      ["nested missing key", (value) => { delete value.profiles[0].language; }],
      ["wrong container type", (value) => { value.profiles = {}; }],
      ["wrong scalar type", (value) => { value.profiles[0].source_hash = 42; }],
      ["invalid versioned limit", (value) => { value.limits.max_profile_count = 0; }],
      ["traversal path", (value) => { value.profiles[0].relative_path = "profiles/../outside.json"; }],
      ["mismatched ID and path", (value) => { value.profiles[0].profile_id = `convention:${"0".repeat(32)}`; }],
      ["fake internally consistent ID and path", (value) => {
        value.profiles[0].profile_id = `convention:${"0".repeat(32)}`;
        value.profiles[0].relative_path = `profiles/${"0".repeat(32)}.json`;
      }],
      ["reversed canonical profiles", (value) => { value.profiles.reverse(); }],
      ["duplicate profile path", (value) => { value.profiles[1] = structuredClone(value.profiles[0]); }],
    ];
    for (const [label, mutate] of cases) {
      const malformed = structuredClone(valid);
      mutate(malformed);
      if (Array.isArray(malformed.profiles)) rehashManifest(malformed);
      fs.writeFileSync(manifestPath, canonicalConventionJson(malformed), "utf8");
      assert.throws(() => persistConventionProfiles(profiles, persistenceOptions(data, stateDir)), undefined, label);
      assert.equal(fs.readFileSync(sentinel, "utf8"), "outside-sentinel\n");
    }
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("rejects oversized valid and malformed manifests from metadata before parsing", () => {
  const stateDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-manifest-cap-")));
  try {
    const data = fixtureData();
    const profiles = buildConventionProfiles(data, { repository_id: "fixture" });
    persistConventionProfiles(profiles, persistenceOptions(data, stateDir));
    const manifestPath = path.join(stateDir, "manifest.json");
    const valid = fs.readFileSync(manifestPath, "utf8");
    for (const contents of [
      `${valid}${" ".repeat(CONVENTION_LIMITS.max_manifest_bytes)}`,
      `{${"x".repeat(CONVENTION_LIMITS.max_manifest_bytes)}}`,
    ]) {
      fs.writeFileSync(manifestPath, contents, "utf8");
      assert.ok(fs.lstatSync(manifestPath).size > CONVENTION_LIMITS.max_manifest_bytes);
      assert.throws(
        () => persistConventionProfiles(profiles, persistenceOptions(data, stateDir)),
        /exceeds the maximum persisted manifest size/,
      );
    }
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("manifest and profile reads reject deterministic leaf and ancestor identity swaps", async (t) => {
  for (const scenario of ["manifest-leaf", "manifest-ancestor", "profile-leaf", "profile-ancestor"]) {
    await t.test(scenario, () => {
      const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cortex-conventions-read-swap-${scenario}-`)));
      const stateDir = path.join(root, "state");
      const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cortex-conventions-read-swap-outside-${scenario}-`)));
      const sentinel = path.join(outside, "sentinel.txt");
      try {
        fs.writeFileSync(sentinel, "outside-sentinel\n");
        const data = fixtureData();
        const profiles = buildConventionProfiles(data, { repository_id: "fixture" });
        const initial = persistConventionProfiles(profiles, persistenceOptions(data, stateDir));
        const manifestPath = path.join(stateDir, "manifest.json");
        const profilePath = path.join(stateDir, ...initial.manifest.profiles[0].relative_path.split("/"));
        const target = scenario.startsWith("manifest") ? manifestPath : profilePath;
        const action = scenario.startsWith("manifest")
          ? () => persistConventionProfiles(profiles, persistenceOptions(data, stateDir))
          : () => readConventionProfile(profilePath);
        assert.throws(() => withReadSwap(target, (bytes) => {
          if (scenario.endsWith("leaf")) {
            fs.renameSync(target, `${target}.before-swap`);
            fs.writeFileSync(target, bytes);
            return;
          }
          const parent = path.dirname(target);
          fs.renameSync(parent, `${parent}.before-swap`);
          fs.mkdirSync(parent);
          fs.writeFileSync(path.join(parent, path.basename(target)), bytes);
        }, action), /identity changed during read/);
        assert.equal(fs.readFileSync(sentinel, "utf8"), "outside-sentinel\n");
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });
  }
});

test("rejects a custom state path with a symlinked ancestor before creation", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-custom-ancestor-")));
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-custom-outside-")));
  const sentinel = path.join(outside, "sentinel.txt");
  try {
    fs.writeFileSync(sentinel, "outside-sentinel\n");
    fs.symlinkSync(outside, path.join(root, "linked"), "dir");
    const data = fixtureData();
    const profile = buildConventionProfiles(data, { repository_id: "fixture" })[0];
    assert.throws(
      () => persistConventionProfiles([profile], persistenceOptions(data, path.join(root, "linked", "new-state"))),
      /symlink or non-directory/,
    );
    assert.equal(fs.readFileSync(sentinel, "utf8"), "outside-sentinel\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("stale profile cleanup rejects descendant symlinks, special files, symlink leaves, and hard links", async (t) => {
  for (const kind of ["descendant-symlink", "special-file", "symlink-leaf", "hard-link"]) {
    await t.test(kind, () => {
      const stateDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cortex-conventions-cleanup-${kind}-`)));
      const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cortex-conventions-cleanup-outside-${kind}-`)));
      const sentinel = path.join(outside, "sentinel.txt");
      try {
        fs.writeFileSync(sentinel, "outside-sentinel\n");
        const data = pairedProfileData();
        const profiles = buildConventionProfiles(data, { repository_id: "fixture" });
        const first = persistConventionProfiles(profiles, persistenceOptions(data, stateDir));
        const removed = first.manifest.profiles[0];
        const remaining = profiles.filter((profile) => profile.profile_id !== removed.profile_id);
        const target = path.join(stateDir, ...removed.relative_path.split("/"));
        if (kind === "descendant-symlink") {
          fs.renameSync(path.join(stateDir, "profiles"), path.join(stateDir, "profiles-real"));
          fs.symlinkSync(outside, path.join(stateDir, "profiles"), "dir");
        } else {
          fs.unlinkSync(target);
          if (kind === "special-file") {
            const made = spawnSync("mkfifo", [target], { encoding: "utf8" });
            assert.equal(made.status, 0, made.stderr);
          } else if (kind === "symlink-leaf") {
            fs.symlinkSync(sentinel, target, "file");
          } else {
            fs.linkSync(sentinel, target);
          }
        }
        assert.throws(() => persistConventionProfiles(remaining, persistenceOptions({
          ...data,
          documents: data.documents.filter((item) => remaining.some((profile) => profile.file_ids.includes(item.id))),
          chunks: data.chunks.filter((item) => remaining.some((profile) => profile.file_ids.includes(item.file_id))),
          modules: data.modules.filter((item) => remaining.some((profile) => profile.subsystem.id === item.id)),
          relations: data.relations.filter((item) => !item.from.includes(removed.subsystem_id) && !item.to.includes(removed.subsystem_id)),
        }, stateDir)), /symlink|single-link regular file|directory component/);
        assert.equal(fs.readFileSync(sentinel, "utf8"), "outside-sentinel\n");
      } finally {
        fs.rmSync(stateDir, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });
  }
});

test("rejects symlinked convention state before writing outside local state", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-state-link-")));
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-state-outside-")));
  const linkedState = path.join(root, "state");
  try {
    fs.symlinkSync(outside, linkedState, "dir");
    const data = fixtureData();
    const profile = buildConventionProfiles(data, { repository_id: "fixture" })[0];
    assert.throws(
      () => persistConventionProfiles([profile], persistenceOptions(data, linkedState)),
      /symlink or non-directory/,
    );
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("drops oversized symbol records and removes deleted exported symbols", () => {
  const data = fixtureData();
  const oversized = chunk("src/auth/factory.ts", "x".repeat(257), { start: 50 });
  const withOversized = fixtureData({ chunks: [...data.chunks, oversized] });
  const profile = buildConventionProfiles(withOversized, { repository_id: "fixture" })[0];
  assert.equal(profile.diagnostics.oversized_records_dropped, 1);
  assert.equal(profile.reusable_symbols.some((symbol) => symbol.entity_id === oversized.id), false);

  const withoutFactory = fixtureData({
    chunks: data.chunks.filter((item) => item.name !== "createAuthFactory"),
    relations: data.relations.filter((item) => !item.from.includes("createAuthFactory") && !item.to.includes("createAuthFactory")),
  });
  const rebuilt = buildConventionProfiles(withoutFactory, { repository_id: "fixture" })[0];
  assert.equal(rebuilt.reusable_symbols.some((symbol) => symbol.name === "createAuthFactory"), false);
});

test("production repository identity reads reject unsafe controls without target disclosure", async (t) => {
  for (const scenario of ["safe", "symlink-ancestor", "symlink-leaf", "special-file", "hard-link"]) {
    await t.test(scenario, () => {
      const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cortex-conventions-control-${scenario}-`)));
      const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cortex-conventions-control-outside-${scenario}-`)));
      const sentinel = path.join(outside, "sentinel.yaml");
      try {
        fs.writeFileSync(sentinel, "repo_id: external-secret\nsecret: do-not-disclose\n", "utf8");
        if (scenario === "symlink-ancestor") {
          fs.symlinkSync(outside, path.join(repoRoot, ".context"), "dir");
        } else {
          fs.mkdirSync(path.join(repoRoot, ".context"));
          const config = path.join(repoRoot, ".context", "config.yaml");
          if (scenario === "safe") fs.writeFileSync(config, "repo_id: safe-repository\n", "utf8");
          if (scenario === "symlink-leaf") fs.symlinkSync(sentinel, config, "file");
          if (scenario === "special-file") {
            const made = spawnSync("mkfifo", [config], { encoding: "utf8" });
            assert.equal(made.status, 0, made.stderr);
          }
          if (scenario === "hard-link") fs.linkSync(sentinel, config);
        }

        if (scenario === "safe") {
          const profile = buildConventionProfiles(fixtureData(), { repo_root: repoRoot })[0];
          assert.equal(profile.repository_id, "safe-repository");
        } else {
          let caught;
          try {
            buildConventionProfiles(fixtureData(), { repo_root: repoRoot });
          } catch (error) {
            caught = error;
          }
          assert.ok(caught instanceof Error);
          assert.match(caught.message, /unsafe/);
          assert.equal(caught.message.includes(outside), false);
          assert.equal(caught.message.includes("external-secret"), false);
          assert.equal(caught.message.includes("do-not-disclose"), false);
        }
        assert.equal(fs.readFileSync(sentinel, "utf8"), "repo_id: external-secret\nsecret: do-not-disclose\n");
      } finally {
        fs.rmSync(repoRoot, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });
  }
});

test("rejects oversized valid and malformed repository controls before parsing or persistence", async () => {
  for (const [label, contents] of [
    ["valid", `repo_id: oversized\npadding: ${"x".repeat(CONVENTION_LIMITS.max_repository_control_bytes)}\n`],
    ["malformed", `{${"x".repeat(CONVENTION_LIMITS.max_repository_control_bytes)}}`],
  ]) {
    const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cortex-conventions-control-cap-${label}-`)));
    const stateDir = path.join(repoRoot, "state");
    try {
      fs.mkdirSync(path.join(repoRoot, ".context"));
      const config = path.join(repoRoot, ".context", "config.yaml");
      fs.writeFileSync(config, contents);
      assert.ok(fs.lstatSync(config).size > CONVENTION_LIMITS.max_repository_control_bytes);
      await assert.rejects(
        runConventions({ target: "src/auth/factory.ts" }, {
          data: fixtureData(),
          repo_root: repoRoot,
          state_dir: stateDir,
        }),
        /control file exceeds the version-1 byte limit/,
      );
      assert.equal(fs.existsSync(stateDir), false);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  }
});

test("reusable module and project relation endpoints require unique live safe backing", async (t) => {
  for (const endpointType of ["module", "project"]) {
    for (const scenario of ["safe", "missing", "duplicate", "symlink", "special", "hard-link", "identity"]) {
      await t.test(`${endpointType}-${scenario}`, async () => {
        const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cortex-conventions-relation-${endpointType}-${scenario}-`)));
        const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cortex-conventions-relation-outside-${endpointType}-${scenario}-`)));
        const sentinel = path.join(outside, "sentinel.txt");
        try {
          fs.writeFileSync(sentinel, "outside-sentinel\n");
          const file = document("src/scope/export.ts");
          const symbol = chunk(file.path, "exported", { start: 10 });
          const scope = moduleRecord("src/scope", 1);
          const endpointPath = "deps/endpoint";
          const endpoint = endpointType === "module"
            ? moduleRecord(endpointPath, 0)
            : projectRecord(endpointPath, 0);
          if (scenario === "identity") endpoint.id = `${endpointType}:deps/wrong`;
          const data = fixtureData({
            files: [file],
            chunks: [symbol],
            modules: endpointType === "module" ? [scope, endpoint] : [scope],
            rules: [],
            relations: [
              { from: scope.id, to: file.id, relation: "CONTAINS", note: "" },
              { from: endpoint.id, to: symbol.id, relation: "EXPORTS", note: "endpoint" },
            ],
          });
          if (endpointType === "project") data.projects = [endpoint];
          if (scenario === "duplicate") {
            if (endpointType === "module") data.modules.push(structuredClone(endpoint));
            else data.projects.push(structuredClone(endpoint));
          }
          materializeDocuments(repoRoot, data);
          const endpointAbsolute = path.join(repoRoot, ...endpointPath.split("/"));
          if (scenario === "safe" || scenario === "duplicate" || scenario === "identity") {
            fs.mkdirSync(endpointAbsolute, { recursive: true });
          } else if (scenario === "symlink") {
            fs.mkdirSync(path.dirname(endpointAbsolute), { recursive: true });
            fs.mkdirSync(path.join(outside, "endpoint"));
            fs.symlinkSync(path.join(outside, "endpoint"), endpointAbsolute, "dir");
          } else if (scenario === "special") {
            fs.mkdirSync(path.dirname(endpointAbsolute), { recursive: true });
            const made = spawnSync("mkfifo", [endpointAbsolute], { encoding: "utf8" });
            assert.equal(made.status, 0, made.stderr);
          } else if (scenario === "hard-link") {
            fs.mkdirSync(path.dirname(endpointAbsolute), { recursive: true });
            fs.linkSync(sentinel, endpointAbsolute);
          }

          const operation = runConventions({ target: file.path }, {
            data,
            repository_id: "fixture",
            repo_root: repoRoot,
            persist: false,
          });
          if (scenario === "safe") await operation;
          else await assert.rejects(operation, /unique indexed backing|missing or stale|symbolic-link|wrong type|identity/);
          assert.equal(fs.readFileSync(sentinel, "utf8"), "outside-sentinel\n");
        } finally {
          fs.rmSync(repoRoot, { recursive: true, force: true });
          fs.rmSync(outside, { recursive: true, force: true });
        }
      });
    }
  }
});

test("validates every path-bearing citation while preserving safe cross-subsystem evidence", async (t) => {
  const scenarios = [
    "safe",
    "missing",
    "duplicate-document",
    "duplicate-relation",
    "symlink-leaf",
    "symlink-ancestor",
    "special-file",
    "hard-link",
    "identity-mismatch",
    "missing-adr",
  ];
  for (const scenario of scenarios) {
    await t.test(scenario, async () => {
      const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cortex-conventions-citations-${scenario}-`)));
      const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cortex-conventions-citations-outside-${scenario}-`)));
      const sentinel = path.join(outside, "sentinel.txt");
      try {
        fs.writeFileSync(sentinel, "outside-sentinel\n", "utf8");
        const fixture = citationFixtureData();
        const { data, exportFile, callerFile, exported, caller, policy } = fixture;
        if (scenario === "identity-mismatch") data.documents.find((item) => item.id === callerFile.id).path = "src/client/other.ts";
        materializeDocuments(repoRoot, data);
        const adrPath = path.join(repoRoot, ...policy.path.split("/"));
        fs.mkdirSync(path.dirname(adrPath), { recursive: true });
        fs.writeFileSync(adrPath, "# Auth policy\n", "utf8");
        const callerPath = path.join(repoRoot, ...data.documents.find((item) => item.id === callerFile.id).path.split("/"));

        if (scenario === "missing") fs.unlinkSync(callerPath);
        if (scenario === "duplicate-document") data.documents.push(structuredClone(data.documents.find((item) => item.id === callerFile.id)));
        if (scenario === "duplicate-relation") data.relations.push(structuredClone(data.relations.find((item) => item.from === caller.id && item.to === exported.id)));
        if (scenario === "symlink-leaf") {
          fs.unlinkSync(callerPath);
          fs.symlinkSync(sentinel, callerPath, "file");
        }
        if (scenario === "symlink-ancestor") {
          const clientDir = path.dirname(callerPath);
          const outsideClient = path.join(outside, "client");
          fs.renameSync(clientDir, outsideClient);
          fs.symlinkSync(outsideClient, clientDir, "dir");
        }
        if (scenario === "special-file") {
          fs.unlinkSync(callerPath);
          const made = spawnSync("mkfifo", [callerPath], { encoding: "utf8" });
          assert.equal(made.status, 0, made.stderr);
        }
        if (scenario === "hard-link") {
          fs.unlinkSync(callerPath);
          fs.linkSync(sentinel, callerPath);
        }
        if (scenario === "missing-adr") fs.unlinkSync(adrPath);

        if (scenario === "safe") {
          const result = await runConventions({ target: exportFile.path }, {
            data,
            repository_id: "fixture",
            repo_root: repoRoot,
            persist: false,
          });
          const profile = result.profiles[0];
          assert.ok(profile.reusable_symbols[0].representative_callers.some((item) => item.entity_id === caller.id));
          assert.ok(profile.related_subsystems.some((item) => item.subsystem_id === "module:src/client"));
        } else {
          await assert.rejects(
            runConventions({ target: exportFile.path }, {
              data,
              repository_id: "fixture",
              repo_root: repoRoot,
              persist: false,
            }),
            /Convention/,
          );
        }
        assert.equal(fs.readFileSync(sentinel, "utf8"), "outside-sentinel\n");
      } finally {
        fs.rmSync(repoRoot, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });
  }
});

test("safe targets reject missing, symlinked, and special same-profile siblings", async (t) => {
  for (const targetKind of ["file", "chunk"]) {
    for (const scenario of ["missing", "symlink", "special"]) {
      await t.test(`${targetKind}-${scenario}`, async () => {
        const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cortex-conventions-sibling-${targetKind}-${scenario}-`)));
        const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cortex-conventions-sibling-outside-${scenario}-`)));
        const sentinel = path.join(outside, "sentinel.ts");
        try {
          fs.writeFileSync(sentinel, "outside-sentinel\n", "utf8");
          const data = fixtureData();
          materializeDocuments(repoRoot, data);
          const sibling = path.join(repoRoot, "src", "auth", "caller.ts");
          fs.unlinkSync(sibling);
          if (scenario === "symlink") fs.symlinkSync(sentinel, sibling, "file");
          if (scenario === "special") {
            const made = spawnSync("mkfifo", [sibling], { encoding: "utf8" });
            assert.equal(made.status, 0, made.stderr);
          }
          const factory = data.chunks.find((item) => item.name === "createAuthFactory");
          const target = targetKind === "file" ? factory.file_id : factory.id;
          await assert.rejects(
            runConventions({ target }, { data, repository_id: "fixture", repo_root: repoRoot, persist: false }),
            /missing or stale|symbolic-link|wrong type|unsafe file type/,
          );
          assert.equal(fs.readFileSync(sentinel, "utf8"), "outside-sentinel\n");
        } finally {
          fs.rmSync(repoRoot, { recursive: true, force: true });
          fs.rmSync(outside, { recursive: true, force: true });
        }
      });
    }
  }
});

test("module and project targets reject invalid descendants", async (t) => {
  for (const kind of ["module", "project"]) {
    await t.test(kind, async () => {
      const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cortex-conventions-descendant-${kind}-`)));
      try {
        const files = [document("src/scope/safe.ts"), document("src/scope/missing.ts")];
        const chunks = files.map((file, index) => chunk(file.path, `symbol${index}`));
        fs.mkdirSync(path.join(repoRoot, "src", "scope"), { recursive: true });
        fs.writeFileSync(path.join(repoRoot, "src", "scope", "safe.ts"), "safe\n", "utf8");
        const scope = kind === "module"
          ? moduleRecord("src/scope", 2)
          : { id: "project:src/scope", path: "src/scope", name: "scope", summary: "fixture", file_count: 2, updated_at: "2026-08-01T00:00:00.000Z", source_of_truth: false, trust_level: 75, status: "active" };
        const relation = kind === "module" ? "CONTAINS" : "INCLUDES_FILE";
        const data = fixtureData({ files, chunks, modules: kind === "module" ? [scope] : [], relations: files.map((file) => ({ from: scope.id, to: file.id, relation, note: "" })) });
        if (kind === "project") data.projects = [scope];
        await assert.rejects(
          runConventions({ target: scope.id }, { data, repository_id: "fixture", repo_root: repoRoot, persist: false }),
          /missing or stale/,
        );
      } finally {
        fs.rmSync(repoRoot, { recursive: true, force: true });
      }
    });
  }
});

test("global persistence validates unselected profiles before creating state", async () => {
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-global-backing-")));
  const stateDir = path.join(repoRoot, "state");
  try {
    const data = pairedProfileData();
    fs.mkdirSync(path.join(repoRoot, "src", "a"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "src", "a", "export.ts"), "safe\n", "utf8");
    await assert.rejects(
      runConventions({ target: "src/a/export.ts" }, { data, repository_id: "fixture", repo_root: repoRoot, state_dir: stateDir }),
      /missing or stale: src\/b\/export.ts/,
    );
    assert.equal(fs.existsSync(stateDir), false);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("runConventions rejects malformed, stale, non-code-backed, and symlink targets", async () => {
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-target-")));
  try {
    const data = fixtureData();
    materializeDocuments(repoRoot, data);
    fs.symlinkSync("factory.ts", path.join(repoRoot, "src", "auth", "link.ts"));
    data.documents.push(document("src/auth/link.ts"));
    data.relations.push({ from: "module:src/auth", to: "file:src/auth/link.ts", relation: "CONTAINS", note: "" });

    const result = await runConventions({ target: "src/auth/factory.ts" }, {
      data,
      repository_id: "fixture",
      repo_root: repoRoot,
      persist: false,
    });
    assert.equal(result.profile_count, 1);
    assert.equal(Object.hasOwn(result, "evidence_order"), false);
    assert.deepEqual(result.limits, CONVENTION_LIMITS);

    await assert.rejects(
      runConventions({ target: "../outside.ts" }, { data, repository_id: "fixture", repo_root: repoRoot, persist: false }),
      /Invalid repository-relative/,
    );
    await assert.rejects(
      runConventions({ target: "src/auth/stale.ts" }, { data, repository_id: "fixture", repo_root: repoRoot, persist: false }),
      /missing or stale/,
    );
    await assert.rejects(
      runConventions({ target: "rule.local" }, { data, repository_id: "fixture", repo_root: repoRoot, persist: false }),
      /not code-backed/,
    );
    await assert.rejects(
      runConventions({ target: "src/auth/link.ts" }, { data, repository_id: "fixture", repo_root: repoRoot, persist: false }),
      /symbolic-link/,
    );
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("file, chunk, module, and project entities reject missing and symlinked backing paths", async (t) => {
  for (const entityKind of ["file", "chunk", "module", "project"]) {
    for (const scenario of ["missing", "symlink-leaf", "symlink-ancestor"]) {
      await t.test(`${entityKind}-${scenario}`, async () => {
        const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cortex-conventions-target-${entityKind}-${scenario}-`)));
        const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cortex-conventions-target-outside-${entityKind}-${scenario}-`)));
        const sentinel = path.join(outside, "sentinel.txt");
        try {
          fs.writeFileSync(sentinel, "outside-sentinel\n");
          fs.mkdirSync(path.join(repoRoot, "real"), { recursive: true });
          fs.writeFileSync(path.join(repoRoot, "real", "file.ts"), "export const value = 1;\n");
          let backingPath;
          const expectsDirectory = entityKind === "module" || entityKind === "project";
          if (scenario === "missing") {
            backingPath = expectsDirectory ? "missing-dir" : "missing.ts";
          } else if (scenario === "symlink-leaf") {
            if (expectsDirectory) {
              fs.mkdirSync(path.join(outside, "target-dir"));
              fs.symlinkSync(path.join(outside, "target-dir"), path.join(repoRoot, "linked-dir"), "dir");
              backingPath = "linked-dir";
            } else {
              fs.writeFileSync(path.join(outside, "target.ts"), "outside\n");
              fs.symlinkSync(path.join(outside, "target.ts"), path.join(repoRoot, "linked.ts"), "file");
              backingPath = "linked.ts";
            }
          } else {
            fs.mkdirSync(path.join(outside, "ancestor"));
            if (expectsDirectory) fs.mkdirSync(path.join(outside, "ancestor", "target"));
            else fs.writeFileSync(path.join(outside, "ancestor", "target.ts"), "outside\n");
            fs.symlinkSync(path.join(outside, "ancestor"), path.join(repoRoot, "linked-parent"), "dir");
            backingPath = expectsDirectory ? "linked-parent/target" : "linked-parent/target.ts";
          }

          let data;
          let target;
          if (entityKind === "file" || entityKind === "chunk") {
            const file = document(backingPath);
            const symbol = chunk(backingPath, "targetSymbol");
            data = fixtureData({ files: [file], chunks: [symbol], modules: [], relations: [] });
            target = entityKind === "file" ? file.id : symbol.id;
          } else {
            const file = document("real/file.ts");
            const symbol = chunk("real/file.ts", "targetSymbol");
            if (entityKind === "module") {
              const module = moduleRecord(backingPath, 1);
              data = fixtureData({ files: [file], chunks: [symbol], modules: [module], relations: [{ from: module.id, to: file.id, relation: "CONTAINS", note: "" }] });
              target = module.id;
            } else {
              const project = { id: `project:${backingPath}`, path: backingPath, name: "fixture-project", summary: "fixture", file_count: 1, updated_at: "2026-08-01T00:00:00.000Z", source_of_truth: false, trust_level: 75, status: "active" };
              data = fixtureData({ files: [file], chunks: [symbol], modules: [], relations: [{ from: project.id, to: file.id, relation: "INCLUDES_FILE", note: "" }] });
              data.projects = [project];
              target = project.id;
            }
          }
          await assert.rejects(
            runConventions({ target }, { data, repository_id: "fixture", repo_root: repoRoot, persist: false }),
            /missing or stale|symbolic-link/,
          );
          assert.equal(fs.readFileSync(sentinel, "utf8"), "outside-sentinel\n");
        } finally {
          fs.rmSync(repoRoot, { recursive: true, force: true });
          fs.rmSync(outside, { recursive: true, force: true });
        }
      });
    }
  }
});

test("repeated persisted inspection is byte-identical for identical index inputs", async () => {
  const stateDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-output-")));
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-repo-")));
  try {
    const data = fixtureData();
    materializeDocuments(repoRoot, data);
    const options = {
      data,
      repository_id: "fixture",
      repo_root: repoRoot,
      state_dir: stateDir,
    };
    const first = await runConventions({ target: "src/auth/factory.ts" }, options);
    const second = await runConventions({ target: "src/auth/factory.ts" }, options);
    assert.equal(canonicalConventionJson(second), canonicalConventionJson(first));
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("rejects adversarial profile counts and aggregate profile growth deterministically", () => {
  const file = document("src/many.ts");
  const tooManyLanguages = [];
  for (let index = 0; index <= CONVENTION_LIMITS.max_profile_count; index += 1) {
    tooManyLanguages.push(chunk("src/many.ts", `symbol${index}`, { language: `lang${String(index).padStart(3, "0")}` }));
  }
  assert.throws(
    () => buildConventionProfiles(fixtureData({ files: [file], chunks: tooManyLanguages, modules: [], relations: [] }), { repository_id: "fixture" }),
    /profile count exceeds/,
  );

  const aggregateChunks = [];
  for (let language = 0; language < 40; language += 1) {
    for (let symbol = 0; symbol < CONVENTION_LIMITS.max_reusable_symbols; symbol += 1) {
      aggregateChunks.push(chunk("src/many.ts", `symbol${language}_${symbol}`, {
        language: `lang${String(language).padStart(2, "0")}`,
        signature: `f${symbol}(${"x".repeat(CONVENTION_LIMITS.max_signature_chars - 10)})`,
        start: 1 + language * 1000 + symbol * 5,
      }));
    }
  }
  assert.throws(
    () => buildConventionProfiles(fixtureData({ files: [file], chunks: aggregateChunks, modules: [], relations: [] }), { repository_id: "fixture" }),
    /aggregate byte limit/,
  );
});

test("public convention serialization allows exact limit and rejects one byte over", () => {
  const input = { target: "src/file.ts" };
  const baseData = { payload: "" };
  const baseBytes = Buffer.byteLength(serializeConventionPublicResponse(input, baseData));
  const exactData = { payload: "x".repeat(CONVENTION_LIMITS.max_response_bytes - baseBytes) };
  const exact = serializeConventionPublicResponse(input, exactData);
  assert.equal(Buffer.byteLength(exact), CONVENTION_LIMITS.max_response_bytes);
  assert.ok(Buffer.byteLength(serializeConventionPublicResponse(input, { payload: exactData.payload.slice(0, -1) })) < CONVENTION_LIMITS.max_response_bytes);
  assert.throws(
    () => serializeConventionPublicResponse(input, { payload: `${exactData.payload}x` }),
    /public response exceeds/,
  );
});

test("public convention errors use the exact bounded JSON envelope policy", () => {
  const near = { target: "x".repeat(CONVENTION_LIMITS.max_path_chars) };
  const serialized = serializeConventionPublicError(near, new Error("Convention target backing path is missing or stale"));
  assert.equal(serialized.endsWith("\n"), true);
  assert.ok(Buffer.byteLength(serialized) <= CONVENTION_LIMITS.max_response_bytes);
  assert.deepEqual(JSON.parse(serialized).input, near);

  const oversized = serializeConventionPublicError(
    { target: "x".repeat(CONVENTION_LIMITS.max_path_chars + 1) },
    new Error(`Convention rejected ${"secret".repeat(1000)}`),
  );
  const parsed = JSON.parse(oversized);
  assert.deepEqual(parsed.input, { target: "[rejected]" });
  assert.ok(parsed.error.message.length <= 512);
  assert.equal(oversized.includes("secret"), false);
});

test("oversized targets are rejected before context access or persistence", async () => {
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-oversized-target-")));
  const stateDir = path.join(repoRoot, "state");
  let dataReads = 0;
  const options = {
    get data() {
      dataReads += 1;
      return fixtureData();
    },
    repository_id: "fixture",
    repo_root: repoRoot,
    state_dir: stateDir,
  };
  try {
    await assert.rejects(
      runConventions({ target: "x".repeat(CONVENTION_LIMITS.max_path_chars + 1) }, options),
      /bounded path or entity identifier/,
    );
    assert.equal(dataReads, 0);
    assert.equal(fs.existsSync(stateDir), false);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("dot and colon rule and ADR entity IDs use the identifier limit before context access", async () => {
  for (const prefix of ["rule.", "rule:", "adr.", "adr:"]) {
    for (const size of [CONVENTION_LIMITS.max_identifier_chars - 1, CONVENTION_LIMITS.max_identifier_chars]) {
      let dataReads = 0;
      const target = `${prefix}${"x".repeat(size - prefix.length)}`;
      const options = {
        get data() {
          dataReads += 1;
          return fixtureData();
        },
        repository_id: "fixture",
        persist: false,
      };
      await assert.rejects(runConventions({ target }, options), /not code-backed|not found/);
      assert.equal(dataReads, 1, `${prefix} length ${size}`);
    }

    const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-entity-boundary-")));
    const stateDir = path.join(repoRoot, "state");
    let dataReads = 0;
    try {
      const target = `${prefix}${"x".repeat(CONVENTION_LIMITS.max_identifier_chars + 1 - prefix.length)}`;
      await assert.rejects(
        runConventions({ target }, {
          get data() {
            dataReads += 1;
            return fixtureData();
          },
          repository_id: "fixture",
          repo_root: repoRoot,
          state_dir: stateDir,
        }),
        /bounded path or entity identifier/,
      );
      assert.equal(dataReads, 0);
      assert.equal(fs.existsSync(stateDir), false);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  }
});

test("persisted inspection builds the canonical profile collection exactly once", async () => {
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-build-count-")));
  const stateDir = path.join(repoRoot, "state");
  let canonicalBuilds = 0;
  const traversals = { static: 0, context: 0, backing: 0 };
  try {
    const data = fixtureData();
    materializeDocuments(repoRoot, data);
    await runConventions({ target: "src/auth/factory.ts" }, {
      data,
      repository_id: "fixture",
      repo_root: repoRoot,
      state_dir: stateDir,
      on_canonical_build: () => { canonicalBuilds += 1; },
      on_validation_traversal: (kind) => { traversals[kind] += 1; },
    });
    assert.equal(canonicalBuilds, 1);
    assert.deepEqual(traversals, { static: 1, context: 1, backing: 1 });
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("empty profile persistence preserves the explicitly resolved repository identity", () => {
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-empty-repository-")));
  const stateDir = path.join(repoRoot, "custom", "state");
  try {
    const data = fixtureData({ files: [], chunks: [], modules: [], rules: [], adrs: [], relations: [] });
    const result = persistConventionProfiles([], {
      state_dir: stateDir,
      data,
      repository_id: "explicit-empty-repository",
      repo_root: repoRoot,
    });
    assert.equal(result.manifest.repository_id, "explicit-empty-repository");
    assert.equal(JSON.parse(fs.readFileSync(path.join(stateDir, "manifest.json"), "utf8")).repository_id, "explicit-empty-repository");
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("success JSON and text omit arbitrary runtime warnings and graph exception details", async () => {
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-public-warning-")));
  const stateDir = path.join(repoRoot, "state");
  const secrets = [
    "warning-secret-content",
    "/external/private/repository/file.ts",
    "../../symlink-target",
    "RyuGraph exception: raw query payload",
  ];
  try {
    const data = fixtureData();
    materializeDocuments(repoRoot, data);
    data.warning = secrets.join(" | ");
    const result = await runConventions({ target: "src/auth/factory.ts" }, {
      data,
      repository_id: "fixture",
      repo_root: repoRoot,
      state_dir: stateDir,
    });
    assert.equal(Object.hasOwn(result, "warning"), false);
    const json = serializeConventionPublicResponse({ target: "src/auth/factory.ts" }, {
      ...result,
      warning: data.warning,
    });
    const text = formatConventionPublicText({ ...result, warning: data.warning });
    for (const secret of secrets) {
      assert.equal(json.includes(secret), false);
      assert.equal(text.includes(secret), false);
    }
    assert.equal(JSON.parse(json).data.warning, undefined);
    assert.match(text, /^conventions: profiles=1/m);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("public JSON and text reject line, paragraph, terminal, and bidi controls without persistence or disclosure", async () => {
  const controls = ["\n", "\r", "\u0001", "\u007f", "\u001b[31m", "\u2028", "\u2029", "\u202e", "\u2066"];
  for (const [index, control] of controls.entries()) {
    const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cortex-conventions-public-control-${index}-`)));
    const stateDir = path.join(repoRoot, "state");
    try {
      const unsafePath = `src/control-${index}${control}.ts`;
      const file = document(unsafePath);
      const data = fixtureData({ files: [file], chunks: [], modules: [], rules: [], adrs: [], relations: [] });
      materializeDocuments(repoRoot, data);
      let failure;
      try {
        await runConventions({ target: unsafePath }, {
          data,
          repository_id: "fixture",
          repo_root: repoRoot,
          state_dir: stateDir,
        });
      } catch (error) {
        failure = error;
      }
      assert.ok(failure instanceof Error);
      const json = serializeConventionPublicError({ target: unsafePath }, failure);
      assert.deepEqual(JSON.parse(json).input, { target: "[rejected]" });
      assert.equal(json.includes(unsafePath), false);
      const text = sanitizeConventionPublicError(failure);
      assert.equal(text.includes(unsafePath), false);
      assert.equal(text.includes(control), false);
      assert.equal(fs.existsSync(stateDir), false);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  }

  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-public-context-control-")));
  const stateDir = path.join(repoRoot, "state");
  try {
    const data = fixtureData();
    materializeDocuments(repoRoot, data);
    data.source = "cache\u202esecret-context";
    await assert.rejects(
      runConventions({ target: "src/auth/factory.ts" }, {
        data,
        repository_id: "fixture",
        repo_root: repoRoot,
        state_dir: stateDir,
      }),
      /unsafe visible text/,
    );
    assert.equal(fs.existsSync(stateDir), false);

    data.source = "cache";
    const safe = await runConventions({ target: "src/auth/factory.ts" }, {
      data,
      repository_id: "fixture",
      repo_root: repoRoot,
      persist: false,
    });
    const json = serializeConventionPublicResponse({ target: "src/auth/factory.ts" }, safe);
    const text = formatConventionPublicText(safe);
    assert.equal(/[\p{Cc}\p{Zl}\p{Zp}\p{Bidi_Control}]/u.test(json.replace(/\n/gu, "")), false);
    assert.equal(/[\r\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(text), false);
    for (const control of controls) {
      assert.throws(
        () => formatConventionPublicText({ profiles: [{ language: `ts${control}`, subsystem: { id: "module:safe" }, reusable_symbols: [] }] }),
        /unsafe visible text/,
      );
    }
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("rejects aggregate serialized inspection responses before persistence", async () => {
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-response-limit-")));
  const stateDir = path.join(repoRoot, "state");
  try {
    fs.mkdirSync(path.join(repoRoot, "src"));
    fs.writeFileSync(path.join(repoRoot, "src", "many.ts"), "export const value = 1;\n");
    const file = document("src/many.ts");
    const chunks = [];
    for (let language = 0; language < 20; language += 1) {
      for (let symbol = 0; symbol < CONVENTION_LIMITS.max_reusable_symbols; symbol += 1) {
        chunks.push(chunk("src/many.ts", `symbol${language}_${symbol}`, {
          language: `lang${String(language).padStart(2, "0")}`,
          signature: `f${symbol}(${"x".repeat(CONVENTION_LIMITS.max_signature_chars - 10)})`,
          start: 1 + language * 1000 + symbol * 5,
        }));
      }
    }
    const data = fixtureData({ files: [file], chunks, modules: [], relations: [] });
    await assert.rejects(
      runConventions({ target: file.path }, { data, repository_id: "fixture", repo_root: repoRoot, state_dir: stateDir }),
      /inspection public response exceeds/,
    );
    assert.equal(fs.existsSync(stateDir), false);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("profile generation is local-only and never invokes fetch", async () => {
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-conventions-local-only-")));
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("network access is forbidden for convention profiles");
  };
  try {
    const data = fixtureData();
    materializeDocuments(repoRoot, data);
    await runConventions({ target: "src/auth/factory.ts" }, {
      data,
      repository_id: "fixture",
      repo_root: repoRoot,
      persist: false,
    });
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
