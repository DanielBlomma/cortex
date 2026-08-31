import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  canonicalJson,
  createObservation,
  sha256Canonical,
} from "../dist/core/analysis-state/engine.js";
import {
  readTrustedAnalysisState,
} from "../dist/core/analysis-state/query-reader.js";
import {
  analysisChangesSince,
  explainAnalysisFact,
  explainMissingAnalysisFact,
  queryAnalysisState,
} from "../dist/core/analysis-state/queries.js";
import { renderTrustedAnalysisCurrentState } from "../dist/core/analysis-state/current-state.js";
import {
  ANALYSIS_PROVISIONING_RECEIPT_FILE,
  AnalysisProvisioningError,
  provisionTrackedAnalysisState,
} from "../dist/core/analysis-state/provisioning.js";

const TASK_ID = "wo062-test";
const SUBJECT = "WO-062";
const REPOSITORY = "cortex-fixture";
const SEED_PATH = "fixtures/analysis-seed.json";
const SOURCE_PATH = "evidence/review.json";
const PROVISIONING_URL = pathToFileURL(
  path.resolve(new URL("../dist/core/analysis-state/provisioning.js", import.meta.url).pathname),
).href;

function hashBytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function runGit(root, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-08-31T08:00:00Z",
      GIT_COMMITTER_DATE: "2026-08-31T08:00:00Z",
    },
    ...options,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function baseObservation(sourceSha256) {
  return {
    schema_version: 1,
    subject: SUBJECT,
    predicate: "human_approval",
    object: true,
    operation: "assert",
    observed_at: "2026-08-31T08:00:00Z",
    authority: "reviewer",
    source: { path: SOURCE_PATH, sha256: sourceSha256, selector: "approval" },
    scope: { repository: REPOSITORY, work_order: SUBJECT, phase: "bootstrap" },
    supersedes: [],
  };
}

function seedPayload(sourceBytes) {
  const sourceSha256 = hashBytes(sourceBytes);
  return {
    schema_version: 1,
    repository: REPOSITORY,
    task_id: TASK_ID,
    primary_subject: SUBJECT,
    observations: [baseObservation(sourceSha256)],
    source_authorities: {
      [SOURCE_PATH]: { sha256: sourceSha256, authorities: ["reviewer"] },
    },
  };
}

function closeSeed(payload, seedSha256 = sha256Canonical(payload)) {
  return { ...payload, seed_sha256: seedSha256 };
}

function writeCanonical(filePath, value, mode = 0o644) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o755 });
  fs.writeFileSync(filePath, `${canonicalJson(value)}\n`, { mode });
  fs.chmodSync(filePath, mode);
}

function makeRepository(options = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-provision-")));
  runGit(root, ["init", "-q"]);
  runGit(root, ["config", "user.name", "Cortex Fixture"]);
  runGit(root, ["config", "user.email", "cortex@example.invalid"]);
  const sourceBytes = Buffer.from('{"review":"GO"}\n', "utf8");
  const sourcePath = path.join(root, SOURCE_PATH);
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, sourceBytes, { mode: 0o644 });
  let payload = seedPayload(sourceBytes);
  if (options.mutatePayload) payload = options.mutatePayload(structuredClone(payload));
  let seed = closeSeed(payload);
  if (options.mutateClosedSeed) seed = options.mutateClosedSeed(structuredClone(seed));
  writeCanonical(path.join(root, SEED_PATH), seed);
  const addPaths = options.untrackedSeed ? [SOURCE_PATH] : [SOURCE_PATH, SEED_PATH];
  runGit(root, ["add", "--", ...addPaths]);
  runGit(root, ["commit", "-qm", "fixture"]);
  return { root, sourceBytes, head: runGit(root, ["rev-parse", "HEAD"]), tree: runGit(root, ["rev-parse", "HEAD^{tree}"]) };
}

function commitPaths(root, paths, message = "mutation") {
  runGit(root, ["add", "-A", "--", ...paths]);
  runGit(root, ["commit", "-qm", message]);
}

function provision(root, hooks) {
  return provisionTrackedAnalysisState({ enabled: true, cwd: root, seedPath: SEED_PATH, ...(hooks ? { hooks } : {}) });
}

function taskPath(root, name = "") {
  return path.join(root, ".agents", TASK_ID, name);
}

function stagePath(root) {
  return path.join(root, `.analysis-provision-${TASK_ID}`);
}

function assertFixedError(action, code) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof AnalysisProvisioningError);
    assert.equal(error.code, code);
    assert.match(error.message, /^tracked analysis provisioning: [A-Za-z0-9 -]+$/u);
    assert.doesNotMatch(error.message, /\/tmp\/|fatal:|\.git/u);
    return true;
  });
}

test("tracked generation 1 is atomic, trusted, queryable, projected, and retry exact", () => {
  const { root, head, tree } = makeRepository();
  const created = provision(root);
  assert.equal(created.outcome, "created");
  assert.equal(created.head_oid, head);
  assert.equal(created.tree_oid, tree);
  assert.equal(created.generation, 1);
  assert.equal(created.observation_count, 1);
  assert.equal(fs.existsSync(stagePath(root)), false);

  const trusted = readTrustedAnalysisState({ cwd: root, taskId: TASK_ID });
  assert.equal(trusted.persisted.manifest.snapshot_sha256, created.snapshot_sha256);
  const facts = queryAnalysisState(trusted.persisted.state, SUBJECT, "human_approval");
  assert.equal(facts.length, 1);
  assert.equal(explainAnalysisFact(trusted.persisted.state, facts[0].id).fact.id, facts[0].id);
  assert.equal(explainMissingAnalysisFact(trusted.persisted.state, SUBJECT, "review_ready").derivable, false);
  assert.equal(analysisChangesSince(trusted.persisted.state, 0).length, 1);
  const current = renderTrustedAnalysisCurrentState({ enabled: true, cwd: root, taskId: TASK_ID });
  assert.equal(current.generation, 1);
  assert.equal(current.snapshot_sha256, created.snapshot_sha256);

  const managedBefore = new Map(
    fs.readdirSync(path.join(taskPath(root), "analysis")).map((name) => [name, fs.readFileSync(taskPath(root, `analysis/${name}`))]),
  );
  const retried = provision(root);
  assert.deepEqual(retried, { ...created, outcome: "already_provisioned" });
  for (const [name, bytes] of managedBefore) assert.ok(fs.readFileSync(taskPath(root, `analysis/${name}`)).equals(bytes));
});

test("two independent repositories with the same commit produce identical managed bytes and bindings", () => {
  const first = makeRepository();
  const second = makeRepository();
  assert.equal(first.head, second.head);
  assert.equal(first.tree, second.tree);
  const left = provision(first.root);
  const right = provision(second.root);
  assert.deepEqual(left, right);
  const names = [
    "analysis/changes.jsonl", "analysis/manifest.json", "analysis/observations.jsonl", "analysis/snapshot.json",
    "analysis-authority.json", ANALYSIS_PROVISIONING_RECEIPT_FILE,
  ];
  for (const name of names) assert.ok(fs.readFileSync(taskPath(first.root, name)).equals(fs.readFileSync(taskPath(second.root, name))), name);
});

test("closed options, seed schema, hashes, semantics, and tracked-path policy fail closed", () => {
  const valid = makeRepository();
  for (const options of [
    { enabled: false, cwd: valid.root, seedPath: SEED_PATH },
    { enabled: true, cwd: valid.root, seedPath: "../seed.json" },
    { enabled: true, cwd: valid.root, seedPath: ".git/config" },
    { enabled: true, cwd: valid.root, seedPath: ".agents/seed.json" },
    { enabled: true, cwd: valid.root, seedPath: SEED_PATH, repository: REPOSITORY },
  ]) assertFixedError(() => provisionTrackedAnalysisState(options), "PROVISIONING_INVALID");

  const cases = [
    { mutatePayload: (payload) => ({ ...payload, unknown: true }) },
    { mutateClosedSeed: (seed) => ({ ...seed, seed_sha256: "0".repeat(64) }) },
    { mutatePayload: (payload) => ({ ...payload, observations: [] }) },
    { mutatePayload: (payload) => ({ ...payload, primary_subject: "WO-MISSING" }) },
    { mutatePayload: (payload) => ({ ...payload, observations: [{ ...payload.observations[0], scope: { ...payload.observations[0].scope, repository: "other" } }] }) },
    { mutatePayload: (payload) => ({ ...payload, source_authorities: { ...payload.source_authorities, "evidence/unused.json": { sha256: "a".repeat(64), authorities: ["test"] } } }) },
    { mutatePayload: (payload) => ({ ...payload, source_authorities: { [SOURCE_PATH]: { ...payload.source_authorities[SOURCE_PATH], authorities: ["reviewer", "test"] } } }) },
  ];
  for (const recipe of cases) {
    const fixture = makeRepository(recipe);
    assertFixedError(() => provision(fixture.root), "PROVISIONING_INVALID");
    assert.equal(fs.existsSync(taskPath(fixture.root)), false);
  }
  const untracked = makeRepository({ untrackedSeed: true });
  assertFixedError(() => provision(untracked.root), "PROVISIONING_UNTRUSTED");
});

test("canonical UTF-8/LF bounds and hostile seed values fail before staging", () => {
  const malformedCases = [
    (root) => fs.writeFileSync(path.join(root, SEED_PATH), "{}"),
    (root) => fs.writeFileSync(path.join(root, SEED_PATH), "{\n}\n"),
    (root) => fs.writeFileSync(path.join(root, SEED_PATH), Buffer.from([0xff, 0x0a])),
  ];
  for (const mutate of malformedCases) {
    const fixture = makeRepository();
    mutate(fixture.root);
    commitPaths(fixture.root, [SEED_PATH]);
    assertFixedError(() => provision(fixture.root), "PROVISIONING_INVALID");
    assert.equal(fs.existsSync(stagePath(fixture.root)), false);
  }
  const overLimit = makeRepository({
    mutatePayload: (payload) => ({ ...payload, observations: Array.from({ length: 257 }, () => structuredClone(payload.observations[0])) }),
  });
  assertFixedError(() => provision(overLimit.root), "PROVISIONING_INVALID");
  const hostile = makeRepository({
    mutatePayload: (payload) => ({ ...payload, observations: [{ ...payload.observations[0], subject: "<script>" }] }),
  });
  assertFixedError(() => provision(hostile.root), "PROVISIONING_INVALID");
});

test("HEAD, index, worktree, file type, link, mode, and repository indirection are bound", () => {
  const dirty = makeRepository();
  fs.appendFileSync(path.join(dirty.root, SOURCE_PATH), "dirty\n");
  assertFixedError(() => provision(dirty.root), "PROVISIONING_UNTRUSTED");

  const staged = makeRepository();
  fs.appendFileSync(path.join(staged.root, SOURCE_PATH), "staged\n");
  runGit(staged.root, ["add", "--", SOURCE_PATH]);
  assertFixedError(() => provision(staged.root), "PROVISIONING_UNTRUSTED");

  const hardLinked = makeRepository();
  const source = path.join(hardLinked.root, SOURCE_PATH);
  const peer = path.join(hardLinked.root, "evidence/peer.json");
  fs.linkSync(source, peer);
  assertFixedError(() => provision(hardLinked.root), "PROVISIONING_UNTRUSTED");

  const wrongMode = makeRepository();
  fs.chmodSync(path.join(wrongMode.root, SOURCE_PATH), 0o666);
  assertFixedError(() => provision(wrongMode.root), "PROVISIONING_UNTRUSTED");

  const linked = makeRepository();
  const linkedPath = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-provision-linked-")));
  fs.rmdirSync(linkedPath);
  runGit(linked.root, ["worktree", "add", "-q", "-b", "linked", linkedPath]);
  assertFixedError(() => provision(linkedPath), "PROVISIONING_UNTRUSTED");
  runGit(linked.root, ["worktree", "remove", "--force", linkedPath]);
});

test("symlink, gitlink, FIFO, directory, redirected ancestor, and missing object fail closed", () => {
  const seedSymlink = makeRepository();
  fs.unlinkSync(path.join(seedSymlink.root, SEED_PATH));
  fs.symlinkSync("../evidence/review.json", path.join(seedSymlink.root, SEED_PATH));
  commitPaths(seedSymlink.root, [SEED_PATH]);
  assertFixedError(() => provision(seedSymlink.root), "PROVISIONING_UNTRUSTED");

  const gitlink = makeRepository();
  fs.unlinkSync(path.join(gitlink.root, SEED_PATH));
  runGit(gitlink.root, ["rm", "--cached", "-q", "--", SEED_PATH]);
  runGit(gitlink.root, ["update-index", "--add", "--cacheinfo", `160000,${gitlink.head},${SEED_PATH}`]);
  runGit(gitlink.root, ["commit", "-qm", "gitlink"]);
  assertFixedError(() => provision(gitlink.root), "PROVISIONING_UNTRUSTED");

  const fifo = makeRepository();
  fs.unlinkSync(path.join(fifo.root, SOURCE_PATH));
  assert.equal(spawnSync("mkfifo", [path.join(fifo.root, SOURCE_PATH)]).status, 0);
  assertFixedError(() => provision(fifo.root), "PROVISIONING_UNTRUSTED");

  const directory = makeRepository();
  fs.unlinkSync(path.join(directory.root, SOURCE_PATH));
  fs.mkdirSync(path.join(directory.root, SOURCE_PATH));
  assertFixedError(() => provision(directory.root), "PROVISIONING_UNTRUSTED");

  const redirected = makeRepository();
  const evidence = path.join(redirected.root, "evidence");
  const realEvidence = path.join(redirected.root, "real-evidence");
  fs.renameSync(evidence, realEvidence);
  fs.symlinkSync(realEvidence, evidence);
  assertFixedError(() => provision(redirected.root), "PROVISIONING_UNTRUSTED");

  const missing = makeRepository();
  const sourceOid = runGit(missing.root, ["rev-parse", `HEAD:${SOURCE_PATH}`]);
  fs.unlinkSync(path.join(missing.root, ".git", "objects", sourceOid.slice(0, 2), sourceOid.slice(2)));
  assertFixedError(() => provision(missing.root), "PROVISIONING_UNTRUSTED");
});

test("alternates, replacement refs, inherited Git overrides, and identity races are handled safely", () => {
  const alternates = makeRepository();
  fs.mkdirSync(path.join(alternates.root, ".git/objects/info"), { recursive: true });
  fs.writeFileSync(path.join(alternates.root, ".git/objects/info/alternates"), "");
  assertFixedError(() => provision(alternates.root), "PROVISIONING_UNTRUSTED");

  const replacement = makeRepository();
  const replacementPath = path.join(replacement.root, ".git", "refs", "replace", replacement.head);
  fs.mkdirSync(path.dirname(replacementPath), { recursive: true });
  fs.writeFileSync(replacementPath, `${replacement.head}\n`);
  assertFixedError(() => provision(replacement.root), "PROVISIONING_UNTRUSTED");

  const inherited = makeRepository();
  const previousGitDir = process.env.GIT_DIR;
  const previousIndex = process.env.GIT_INDEX_FILE;
  process.env.GIT_DIR = "/definitely/not/the/repository";
  process.env.GIT_INDEX_FILE = "/definitely/not/the/index";
  try { assert.equal(provision(inherited.root).outcome, "created"); } finally {
    if (previousGitDir === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = previousGitDir;
    if (previousIndex === undefined) delete process.env.GIT_INDEX_FILE; else process.env.GIT_INDEX_FILE = previousIndex;
  }

  const changedSource = makeRepository();
  assertFixedError(() => provisionTrackedAnalysisState({
    enabled: true,
    cwd: changedSource.root,
    seedPath: SEED_PATH,
    hooks: { afterGitBinding: () => fs.appendFileSync(path.join(changedSource.root, SOURCE_PATH), "race\n") },
  }), "PROVISIONING_UNTRUSTED");
  assert.equal(fs.existsSync(taskPath(changedSource.root)), false);

  const targetRace = makeRepository();
  let foreignIdentity;
  assertFixedError(() => provisionTrackedAnalysisState({
    enabled: true,
    cwd: targetRace.root,
    seedPath: SEED_PATH,
    hooks: {
      beforeRename: () => {
        fs.mkdirSync(taskPath(targetRace.root), { recursive: true, mode: 0o700 });
        foreignIdentity = fs.lstatSync(taskPath(targetRace.root));
      },
    },
  }), "PROVISIONING_CONFLICT");
  assert.equal(fs.lstatSync(taskPath(targetRace.root)).ino, foreignIdentity.ino);
  assert.deepEqual(fs.readdirSync(taskPath(targetRace.root)), []);
});

test("every injected boundary is retry safe and preserves atomic visibility", () => {
  const beforeRename = ["owner", "observations", "snapshot", "changes", "store", "authority", "receipt", "candidate_fsync", "validation", "before_rename"];
  for (const point of beforeRename) {
    const { root } = makeRepository();
    assertFixedError(() => provision(root, { failAfter: point }), "PROVISIONING_UNTRUSTED");
    assert.equal(fs.existsSync(taskPath(root)), false, point);
    assert.equal(fs.existsSync(stagePath(root)), false, point);
    assert.equal(provision(root).outcome, "created", point);
  }
  for (const point of ["after_rename", "cleanup"]) {
    const { root } = makeRepository();
    assertFixedError(() => provision(root, { failAfter: point }), "PROVISIONING_UNTRUSTED");
    assert.equal(readTrustedAnalysisState({ cwd: root, taskId: TASK_ID }).persisted.manifest.generation, 1, point);
    assert.equal(provision(root).outcome, "already_provisioned", point);
  }
});

test("concurrent fresh processes yield one created and one exact already-provisioned result", async () => {
  const { root } = makeRepository();
  const program = `
    import { provisionTrackedAnalysisState } from ${JSON.stringify(PROVISIONING_URL)};
    try {
      const value = provisionTrackedAnalysisState({ enabled: true, cwd: process.argv[1], seedPath: ${JSON.stringify(SEED_PATH)} });
      process.stdout.write(JSON.stringify(value));
    } catch (error) {
      process.stderr.write(String(error?.message ?? error));
      process.exitCode = 1;
    }
  `;
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", program, root], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (value) => { stdout += value; });
    child.stderr.setEncoding("utf8").on("data", (value) => { stderr += value; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr)));
  });
  const results = await Promise.all([run(), run()]);
  assert.deepEqual(results.map((item) => item.outcome).sort(), ["already_provisioned", "created"]);
  assert.deepEqual({ ...results[0], outcome: "same" }, { ...results[1], outcome: "same" });
});

test("exited-owner staging is reclaimed only with an exact private inventory", () => {
  const crashProgram = `
    import { provisionTrackedAnalysisState } from ${JSON.stringify(PROVISIONING_URL)};
    provisionTrackedAnalysisState({
      enabled: true,
      cwd: process.argv[1],
      seedPath: ${JSON.stringify(SEED_PATH)},
      hooks: { afterStageOwner: () => process.exit(73) },
    });
  `;
  const crash = (root) => spawnSync(process.execPath, ["--input-type=module", "-e", crashProgram, root], { encoding: "utf8" });

  const reclaimable = makeRepository();
  assert.equal(crash(reclaimable.root).status, 73);
  assert.equal(fs.existsSync(stagePath(reclaimable.root)), true);
  assert.equal(provision(reclaimable.root).outcome, "created");
  assert.equal(fs.existsSync(stagePath(reclaimable.root)), false);

  const tampered = makeRepository();
  assert.equal(crash(tampered.root).status, 73);
  const foreign = path.join(stagePath(tampered.root), "foreign.txt");
  fs.writeFileSync(foreign, "foreign\n", { mode: 0o600 });
  assertFixedError(() => provision(tampered.root), "PROVISIONING_UNTRUSTED");
  assert.equal(fs.readFileSync(foreign, "utf8"), "foreign\n");
  assert.equal(fs.existsSync(taskPath(tampered.root)), false);
});

test("exact retry is neutral while tampered or partial existing targets are never replaced", () => {
  const exact = makeRepository();
  provision(exact.root);
  const receiptPath = taskPath(exact.root, ANALYSIS_PROVISIONING_RECEIPT_FILE);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  writeCanonical(receiptPath, { ...receipt, seed_sha256: "f".repeat(64) }, 0o600);
  const before = fs.readFileSync(receiptPath);
  assertFixedError(() => provision(exact.root), "PROVISIONING_UNTRUSTED");
  assert.ok(fs.readFileSync(receiptPath).equals(before));

  const partial = makeRepository();
  fs.mkdirSync(taskPath(partial.root), { recursive: true, mode: 0o700 });
  fs.writeFileSync(taskPath(partial.root, "foreign.txt"), "foreign\n", { mode: 0o600 });
  assertFixedError(() => provision(partial.root), "PROVISIONING_CONFLICT");
  assert.equal(fs.readFileSync(taskPath(partial.root, "foreign.txt"), "utf8"), "foreign\n");
});
