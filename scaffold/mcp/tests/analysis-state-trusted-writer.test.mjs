import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import {
  REGISTERED_RULE_IDS,
  createAuthorityManifest,
  createObservation,
  createSourceAuthorityRegistry,
  sha256Canonical,
} from "../dist/core/analysis-state/engine.js";
import {
  ANALYSIS_TRANSACTION_INTENT_FILE,
  ANALYSIS_TRANSACTION_STAGE_FILE,
  readTrustedAnalysisState,
} from "../dist/core/analysis-state/query-reader.js";
import { publishAnalysisState } from "../dist/core/analysis-state/store.js";
import {
  ANALYSIS_TRANSACTION_LOCK_DIRECTORY,
  appendTrustedAnalysisObservation,
  recoverTrustedAnalysisObservation,
} from "../dist/core/analysis-state/trusted-writer.js";

const TASK_ID = "wo060-test";
const SUBJECT = "WO-TEST";
const REPOSITORY = "cortex";
const SOURCE = { path: "evidence/review.json", sha256: "a".repeat(64), selector: "review" };
const SOURCE_AUTHORITIES = createSourceAuthorityRegistry({
  [SOURCE.path]: { sha256: SOURCE.sha256, authorities: ["reviewer"] },
});
const WRITER_URL = pathToFileURL(
  path.resolve(new URL("../dist/core/analysis-state/trusted-writer.js", import.meta.url).pathname),
).href;
const MCP_DIR = path.resolve(new URL("..", import.meta.url).pathname);
const CLI_URL = pathToFileURL(path.join(MCP_DIR, "dist", "cli", "workflow-analysis.js")).href;

function makeRoot() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-analysis-writer-")));
}

function observationInput(overrides = {}) {
  return {
    schema_version: 1,
    subject: SUBJECT,
    predicate: "blocker_active",
    object: "review_blocker",
    operation: "assert",
    observed_at: "2026-08-31T10:01:00Z",
    authority: "reviewer",
    source: SOURCE,
    scope: { repository: REPOSITORY, work_order: SUBJECT, phase: "review" },
    supersedes: [],
    ...overrides,
  };
}

function initialObservation() {
  return createObservation({
    ...observationInput({
      predicate: "human_approval",
      object: true,
      observed_at: "2026-08-31T10:00:00Z",
    }),
  });
}

function taskPath(root, name) {
  return path.join(root, ".agents", TASK_ID, name);
}

function authorityPath(root) {
  return taskPath(root, "analysis-authority.json");
}

function writeAuthority(root, observations) {
  const payload = {
    schema_version: 1,
    repository: REPOSITORY,
    task_id: TASK_ID,
    primary_subject: SUBJECT,
    authority_manifest: createAuthorityManifest(observations),
    source_authorities: SOURCE_AUTHORITIES,
  };
  const bundle = { ...payload, bundle_sha256: sha256Canonical(payload) };
  fs.writeFileSync(authorityPath(root), `${JSON.stringify(bundle)}\n`, { mode: 0o600 });
  fs.chmodSync(authorityPath(root), 0o600);
  return bundle;
}

function fixture() {
  const root = makeRoot();
  const observations = [initialObservation()];
  const persisted = publishAnalysisState({
    cwd: root,
    taskId: TASK_ID,
    repository: REPOSITORY,
    input: { schema_version: 1, rule_ids: REGISTERED_RULE_IDS, observations },
    authorityManifest: createAuthorityManifest(observations),
    sourceAuthorities: SOURCE_AUTHORITIES,
  });
  const authority = writeAuthority(root, observations);
  return { root, persisted, authority };
}

function appendOptions(root, authority, extra = {}) {
  return {
    enabled: true,
    cwd: root,
    taskId: TASK_ID,
    repository: REPOSITORY,
    expectedGeneration: 1,
    expectedAuthorityBundleSha256: authority.bundle_sha256,
    observation: observationInput(),
    ...extra,
  };
}

function recoveryOptions(root) {
  return { enabled: true, cwd: root, taskId: TASK_ID, repository: REPOSITORY };
}

function identityTree(root, target) {
  const targets = [];
  function visit(current) {
    const stat = fs.lstatSync(current, { bigint: true });
    targets.push({
      path: path.relative(root, current) || ".",
      dev: stat.dev,
      ino: stat.ino,
      ctimeNs: stat.ctimeNs,
      mtimeNs: stat.mtimeNs,
      mode: stat.mode,
      nlink: stat.nlink,
      size: stat.size,
      bytes: stat.isFile() ? fs.readFileSync(current).toString("base64") : null,
      entries: stat.isDirectory() ? fs.readdirSync(current).sort() : null,
    });
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current).sort()) visit(path.join(current, entry));
    }
  }
  visit(target);
  return targets;
}

function identity(root) {
  return identityTree(root, path.join(root, ".agents"));
}

function runCli(root, args) {
  const source = `import { runWorkflowAnalysisCommand } from ${JSON.stringify(CLI_URL)}; await runWorkflowAnalysisCommand(${JSON.stringify(args)});`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CORTEX_PROJECT_ROOT: root },
  });
}

async function withAnalysisClient(root, callback) {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/server.js"],
    cwd: MCP_DIR,
    env: {
      ...process.env,
      CORTEX_PROJECT_ROOT: root,
      CORTEX_MAINTAINED_ANALYSIS_MCP: "1",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "wo060-writer-test", version: "0.1.0" });
  await client.connect(transport);
  try {
    await callback(client);
  } finally {
    await client.close();
  }
}

test("trusted append rotates authority and fresh CLI/MCP reads see the exact generation", async () => {
  const { root, authority } = fixture();
  try {
    const result = appendTrustedAnalysisObservation(appendOptions(root, authority));
    assert.equal(result.generation, 2);
    assert.equal(result.observation_count, 2);
    assert.match(result.appended_observation_id, /^obs:[0-9a-f]{64}$/u);
    const fresh = readTrustedAnalysisState({ cwd: root, taskId: TASK_ID });
    assert.equal(fresh.authority.bundle_sha256, result.authority_bundle_sha256);
    assert.equal(fresh.persisted.manifest.snapshot_sha256, result.snapshot_sha256);
    assert.equal(fresh.persisted.state.query(SUBJECT, "blocked").length, 1);
    assert.equal(fresh.persisted.changes.length, 2);
    const cli = runCli(root, ["changes", TASK_ID, "--since", "0", "--json"]);
    assert.equal(cli.status, 0, cli.stderr);
    const cliResult = JSON.parse(cli.stdout);
    assert.equal(cliResult.data.binding.generation, 2);
    assert.ok(cliResult.data.changes.length > 0);
    await withAnalysisClient(root, async (client) => {
      const mcp = await client.callTool({
        name: "context.analysis_changes",
        arguments: { task_id: TASK_ID, since: 0 },
      });
      assert.notEqual(mcp.isError, true);
      assert.deepEqual(mcp.structuredContent, cliResult);
      assert.equal(mcp.content[0].text, cli.stdout);
    });
    assert.equal(fs.existsSync(taskPath(root, ANALYSIS_TRANSACTION_INTENT_FILE)), false);
    assert.equal(fs.existsSync(taskPath(root, ANALYSIS_TRANSACTION_STAGE_FILE)), false);
    assert.equal(fs.existsSync(taskPath(root, ANALYSIS_TRANSACTION_LOCK_DIRECTORY)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("disabled, stale, duplicate, malformed, wrong-scope, unauthorized, invalid closure, and nonappend inputs are neutral", () => {
  const cases = [
    (root, authority) => ({ ...appendOptions(root, authority), enabled: false }),
    (root, authority) => ({ ...appendOptions(root, authority), expectedGeneration: 0 }),
    (root, authority) => ({ ...appendOptions(root, authority), observation: observationInput({
      predicate: "human_approval",
      object: true,
      observed_at: "2026-08-31T10:00:00Z",
    }) }),
    (root, authority) => ({ ...appendOptions(root, authority), observation: { ...observationInput(), extra: true } }),
    (root, authority) => ({ ...appendOptions(root, authority), observation: observationInput({
      scope: { repository: "other", work_order: SUBJECT, phase: "review" },
    }) }),
    (root, authority) => ({ ...appendOptions(root, authority), observation: observationInput({ authority: "manager" }) }),
    (root, authority) => ({ ...appendOptions(root, authority), observation: observationInput({
      operation: "retract",
      target_observation_id: `obs:${"b".repeat(64)}`,
      supersedes: [],
    }) }),
    (root, authority) => ({ ...appendOptions(root, authority), observation: observationInput({
      observed_at: "2026-08-31T09:59:00Z",
    }) }),
  ];
  for (const makeOptions of cases) {
    const { root, authority } = fixture();
    try {
      const before = identity(root);
      assert.throws(() => appendTrustedAnalysisObservation(makeOptions(root, authority)));
      assert.deepEqual(identity(root), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("explicit recovery aborts pre-store intents and completes every changed-store boundary", () => {
  for (const point of ["intent", "authority_stage", "observations", "snapshot", "changes", "store", "authority"]) {
    const { root, authority, persisted: initial } = fixture();
    try {
      assert.throws(
        () => appendTrustedAnalysisObservation(appendOptions(root, authority, { hooks: { failAfter: point } })),
        /injected failure/u,
        point,
      );
      assert.throws(
        () => readTrustedAnalysisState({ cwd: root, taskId: TASK_ID }),
        /transaction is incomplete/u,
        point,
      );
      const recovered = recoverTrustedAnalysisObservation(recoveryOptions(root));
      const changedStore = !["intent", "authority_stage"].includes(point);
      assert.equal(recovered.outcome, changedStore ? "completed" : "aborted", point);
      assert.equal(recovered.generation, changedStore ? 2 : 1, point);
      const fresh = readTrustedAnalysisState({ cwd: root, taskId: TASK_ID });
      assert.equal(fresh.persisted.manifest.generation, changedStore ? 2 : initial.manifest.generation, point);
      assert.equal(fs.existsSync(taskPath(root, ANALYSIS_TRANSACTION_INTENT_FILE)), false, point);
      assert.equal(fs.existsSync(taskPath(root, ANALYSIS_TRANSACTION_STAGE_FILE)), false, point);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  const { root, authority } = fixture();
  try {
    assert.throws(
      () => appendTrustedAnalysisObservation(appendOptions(root, authority, { hooks: { failAfter: "intent_cleanup" } })),
      /injected failure/u,
    );
    assert.equal(readTrustedAnalysisState({ cwd: root, taskId: TASK_ID }).persisted.manifest.generation, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function leaveIntent(root, authority, point = "intent") {
  assert.throws(
    () => appendTrustedAnalysisObservation(appendOptions(root, authority, { hooks: { failAfter: point } })),
    /injected failure/u,
  );
}

test("intent and staged authority containment rejects links, special files, directories, modes, and replay", () => {
  for (const mutation of ["symlink", "hardlink", "fifo", "directory", "mode"]) {
    const { root, authority } = fixture();
    const intent = taskPath(root, ANALYSIS_TRANSACTION_INTENT_FILE);
    const outside = path.join(os.tmpdir(), `cortex-wo060-intent-${process.pid}-${mutation}`);
    try {
      leaveIntent(root, authority);
      if (mutation === "symlink") {
        fs.renameSync(intent, outside);
        fs.symlinkSync(outside, intent);
      } else if (mutation === "hardlink") {
        fs.linkSync(intent, outside);
      } else if (mutation === "fifo") {
        fs.rmSync(intent);
        const made = spawnSync("mkfifo", [intent], { encoding: "utf8" });
        if (made.error?.code === "ENOENT") continue;
        assert.equal(made.status, 0, made.stderr);
      } else if (mutation === "directory") {
        fs.rmSync(intent);
        fs.mkdirSync(intent, { mode: 0o700 });
      } else {
        fs.chmodSync(intent, 0o644);
      }
      assert.throws(() => recoverTrustedAnalysisObservation(recoveryOptions(root)));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { force: true });
    }
  }

  const first = fixture();
  const second = fixture();
  try {
    leaveIntent(first.root, first.authority);
    fs.copyFileSync(
      taskPath(first.root, ANALYSIS_TRANSACTION_INTENT_FILE),
      taskPath(second.root, ANALYSIS_TRANSACTION_INTENT_FILE),
    );
    fs.chmodSync(taskPath(second.root, ANALYSIS_TRANSACTION_INTENT_FILE), 0o600);
    const before = fs.readFileSync(authorityPath(second.root));
    assert.throws(
      () => recoverTrustedAnalysisObservation(recoveryOptions(second.root)),
      /filesystem identity changed/u,
    );
    assert.deepEqual(fs.readFileSync(authorityPath(second.root)), before);
  } finally {
    fs.rmSync(first.root, { recursive: true, force: true });
    fs.rmSync(second.root, { recursive: true, force: true });
  }

  const staged = fixture();
  const stagedOutside = path.join(os.tmpdir(), `cortex-wo060-stage-${process.pid}`);
  try {
    leaveIntent(staged.root, staged.authority, "authority_stage");
    const stagePath = taskPath(staged.root, ANALYSIS_TRANSACTION_STAGE_FILE);
    fs.renameSync(stagePath, stagedOutside);
    fs.symlinkSync(stagedOutside, stagePath);
    assert.throws(() => recoverTrustedAnalysisObservation(recoveryOptions(staged.root)));
  } finally {
    fs.rmSync(staged.root, { recursive: true, force: true });
    fs.rmSync(stagedOutside, { force: true });
  }
});

test("socket transaction targets fail closed where local sockets are supported", async (t) => {
  const { root, authority } = fixture();
  const intent = taskPath(root, ANALYSIS_TRANSACTION_INTENT_FILE);
  const server = net.createServer();
  try {
    leaveIntent(root, authority);
    fs.rmSync(intent);
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(intent, resolve);
    });
    assert.throws(() => recoverTrustedAnalysisObservation(recoveryOptions(root)));
  } catch (error) {
    if (["EAFNOSUPPORT", "EPROTONOSUPPORT", "ENOTSUP"].includes(error?.code)) {
      t.diagnostic(`local sockets unsupported: ${error.code}`);
      return;
    }
    throw error;
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("live/exited coordinator ownership and concurrent authority replacement fail closed", () => {
  const live = fixture();
  try {
    leaveIntent(live.root, live.authority);
    const lock = taskPath(live.root, ANALYSIS_TRANSACTION_LOCK_DIRECTORY);
    fs.mkdirSync(lock, { mode: 0o700 });
    fs.writeFileSync(
      path.join(lock, "owner.json"),
      `${JSON.stringify({ schema_version: 1, pid: process.pid, token: "a".repeat(32) })}\n`,
      { mode: 0o600 },
    );
    assert.throws(
      () => recoverTrustedAnalysisObservation(recoveryOptions(live.root)),
      /another writer holds/u,
    );
    fs.rmSync(lock, { recursive: true });
    assert.equal(recoverTrustedAnalysisObservation(recoveryOptions(live.root)).outcome, "aborted");
  } finally {
    fs.rmSync(live.root, { recursive: true, force: true });
  }

  const exited = fixture();
  try {
    leaveIntent(exited.root, exited.authority);
    const lock = taskPath(exited.root, ANALYSIS_TRANSACTION_LOCK_DIRECTORY);
    const source = [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'const lock = process.argv[1];',
      'fs.mkdirSync(lock, { mode: 0o700 });',
      'fs.writeFileSync(path.join(lock, "owner.json"), `${JSON.stringify({ schema_version: 1, pid: process.pid, token: "b".repeat(32) })}\\n`, { mode: 0o600 });',
    ].join("\n");
    const child = spawnSync(process.execPath, ["-e", source, lock], { encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(recoverTrustedAnalysisObservation(recoveryOptions(exited.root)).outcome, "aborted");
    assert.equal(fs.existsSync(lock), false);
  } finally {
    fs.rmSync(exited.root, { recursive: true, force: true });
  }

  const replaced = fixture();
  try {
    leaveIntent(replaced.root, replaced.authority, "store");
    const raw = JSON.parse(fs.readFileSync(authorityPath(replaced.root), "utf8"));
    const { bundle_sha256: _old, ...oldPayload } = raw;
    const payload = { ...oldPayload, repository: "other" };
    fs.writeFileSync(
      authorityPath(replaced.root),
      `${JSON.stringify({ ...payload, bundle_sha256: sha256Canonical(payload) })}\n`,
      { mode: 0o600 },
    );
    assert.throws(
      () => recoverTrustedAnalysisObservation(recoveryOptions(replaced.root)),
      /does not belong to the transaction/u,
    );
  } finally {
    fs.rmSync(replaced.root, { recursive: true, force: true });
  }
});

test("ancestor redirection and task-directory mode changes fail before mutation", () => {
  const { root, authority } = fixture();
  const agents = path.join(root, ".agents");
  const outside = `${agents}.outside`;
  try {
    fs.renameSync(agents, outside);
    fs.symlinkSync(outside, agents);
    const before = identityTree(root, outside);
    assert.throws(() => appendTrustedAnalysisObservation(appendOptions(root, authority)));
    assert.deepEqual(identityTree(root, outside), before);
  } finally {
    fs.rmSync(agents, { force: true });
    fs.renameSync(outside, agents);
    fs.rmSync(root, { recursive: true, force: true });
  }

  const wrongMode = fixture();
  try {
    fs.chmodSync(taskPath(wrongMode.root, ""), 0o755);
    const before = identity(wrongMode.root);
    assert.throws(() => appendTrustedAnalysisObservation(appendOptions(wrongMode.root, wrongMode.authority)));
    assert.deepEqual(identity(wrongMode.root), before);
  } finally {
    fs.rmSync(wrongMode.root, { recursive: true, force: true });
  }

  const replaced = fixture();
  const originalTask = `${taskPath(replaced.root, "")}.original`;
  try {
    leaveIntent(replaced.root, replaced.authority, "store");
    fs.renameSync(taskPath(replaced.root, ""), originalTask);
    fs.cpSync(originalTask, taskPath(replaced.root, ""), { recursive: true });
    fs.chmodSync(taskPath(replaced.root, ""), 0o700);
    const before = identityTree(replaced.root, originalTask);
    assert.throws(
      () => recoverTrustedAnalysisObservation(recoveryOptions(replaced.root)),
      /filesystem identity changed/u,
    );
    assert.deepEqual(identityTree(replaced.root, originalTask), before);
  } finally {
    fs.rmSync(replaced.root, { recursive: true, force: true });
  }
});

function runWorker(options, barrier, index) {
  const readyPath = path.join(barrier, `ready-${index}`);
  const releasePath = path.join(barrier, "release");
  const source = [
    `import fs from "node:fs";`,
    `import { appendTrustedAnalysisObservation } from ${JSON.stringify(WRITER_URL)};`,
    `const mkdir = fs.mkdirSync;`,
    `let prepared = false;`,
    `fs.mkdirSync = function (target, ...args) {`,
    `  if (!prepared && target === ${JSON.stringify(taskPath(options.cwd, ANALYSIS_TRANSACTION_LOCK_DIRECTORY))}) {`,
    `    prepared = true;`,
    `    fs.writeFileSync(${JSON.stringify(readyPath)}, "ready", { flag: "wx" });`,
    `    const deadline = Date.now() + 5000;`,
    `    const pause = new Int32Array(new SharedArrayBuffer(4));`,
    `    while (!fs.existsSync(${JSON.stringify(releasePath)})) {`,
    `      if (Date.now() >= deadline) throw new Error("writer rendezvous timed out");`,
    `      Atomics.wait(pause, 0, 0, 10);`,
    `    }`,
    `  }`,
    `  return mkdir.call(this, target, ...args);`,
    `};`,
    `try { const value = appendTrustedAnalysisObservation(${JSON.stringify(options)}); process.stdout.write(JSON.stringify({ ok: true, value })); }`,
    `catch (error) { process.stdout.write(JSON.stringify({ ok: false, message: error.message })); process.exitCode = 1; }`,
  ].join("\n");
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    cwd: options.cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const worker = { child, readyPath, closed: false, result: null };
  worker.result = new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", (error) => { stderr += error.message; });
    child.on("close", (status) => {
      worker.closed = true;
      resolve({ status, stdout, stderr });
    });
  });
  return worker;
}

test("two writers with one expected generation produce one commit and one stale loser", async () => {
  const { root, authority } = fixture();
  const workers = [];
  let barrier;
  let timer;
  try {
    barrier = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-writer-rendezvous-"));
    const options = appendOptions(root, authority);
    workers.push(runWorker(options, barrier, 0));
    workers.push(runWorker(options, barrier, 1));
    const results = await Promise.race([
      (async () => {
        // Both optimistic reads must finish before either real coordinator mkdir.
        // Otherwise a valid commit can make the overlapping reader fail closed.
        while (!workers.every((worker) => fs.existsSync(worker.readyPath))) {
          const exited = workers.find((worker) => worker.closed);
          if (exited) throw new Error(`writer exited before rendezvous: ${JSON.stringify(await exited.result)}`);
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        fs.writeFileSync(path.join(barrier, "release"), "release", { flag: "wx" });
        return Promise.all(workers.map((worker) => worker.result));
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("writer rendezvous or append timed out")), 5000);
      }),
    ]);
    assert.deepEqual(results.map((item) => item.status).sort(), [0, 1]);
    assert.deepEqual(results.map((item) => item.stderr), ["", ""]);
    const winner = JSON.parse(results.find((item) => item.status === 0).stdout);
    const loser = JSON.parse(results.find((item) => item.status === 1).stdout);
    assert.equal(winner.ok, true);
    assert.equal(loser.ok, false);
    assert.match(loser.message, /stale writer/u);
    const fresh = readTrustedAnalysisState({ cwd: root, taskId: TASK_ID });
    assert.equal(fresh.persisted.manifest.generation, 2);
    assert.equal(fresh.persisted.manifest.observation_count, 2);
    assert.equal(winner.value.generation, fresh.persisted.manifest.generation);
    assert.equal(winner.value.observation_count, fresh.persisted.manifest.observation_count);
    assert.equal(winner.value.snapshot_sha256, fresh.persisted.manifest.snapshot_sha256);
    assert.equal(winner.value.observation_head_sha256, fresh.persisted.manifest.observation_head_sha256);
    assert.equal(winner.value.authority_bundle_sha256, fresh.authority.bundle_sha256);
    assert.equal(winner.value.authority_manifest_sha256, fresh.authority.authority_manifest.manifest_sha256);
    assert.equal(winner.value.source_authority_registry_sha256, sha256Canonical(fresh.authority.source_authorities));
    assert.equal(winner.value.appended_observation_id, fresh.persisted.observations.at(-1).id);
    assert.equal(winner.value.appended_observation_id, createObservation(options.observation).id);
  } finally {
    clearTimeout(timer);
    for (const worker of workers) {
      if (!worker.closed) worker.child.kill("SIGKILL");
    }
    await Promise.all(workers.map((worker) => worker.result));
    if (barrier) fs.rmSync(barrier, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
