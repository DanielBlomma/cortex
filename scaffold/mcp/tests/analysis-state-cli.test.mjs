import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  REGISTERED_RULE_IDS,
  createAuthorityManifest,
  createObservation,
  createSourceAuthorityRegistry,
  sha256Canonical,
} from "../dist/core/analysis-state/engine.js";
import {
  ANALYSIS_AUTHORITY_MAX_BYTES,
  AnalysisQueryError,
  readTrustedAnalysisState,
} from "../dist/core/analysis-state/query-reader.js";
import { publishAnalysisState } from "../dist/core/analysis-state/store.js";

const PROJECT_ROOT = path.resolve(new URL("../../..", import.meta.url).pathname);
const RUNTIME_URL = pathToFileURL(path.join(PROJECT_ROOT, "scaffold", "mcp", "dist", "cli", "workflow-analysis.js")).href;
const TASK_ID = "wo058-test";
const SUBJECT = "WO-TEST";
const SOURCE = { path: "evidence/review.json", sha256: "a".repeat(64), selector: "review" };
const SOURCE_AUTHORITIES = createSourceAuthorityRegistry({
  [SOURCE.path]: { sha256: SOURCE.sha256, authorities: ["reviewer"] },
});

function makeRoot(prefix = "cortex-analysis-cli-") {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function observation() {
  return createObservation({
    schema_version: 1,
    subject: SUBJECT,
    predicate: "human_approval",
    object: true,
    operation: "assert",
    observed_at: "2026-08-30T10:00:00Z",
    authority: "reviewer",
    source: SOURCE,
    scope: { repository: "cortex", work_order: SUBJECT, phase: "review" },
    supersedes: [],
  });
}

function authorityPath(root) {
  return path.join(root, ".agents", TASK_ID, "analysis-authority.json");
}

function storePath(root, name) {
  return path.join(root, ".agents", TASK_ID, "analysis", name);
}

function bundlePayload(observations, extra = {}) {
  return {
    schema_version: 1,
    repository: "cortex",
    task_id: TASK_ID,
    primary_subject: SUBJECT,
    authority_manifest: createAuthorityManifest(observations),
    source_authorities: SOURCE_AUTHORITIES,
    ...extra,
  };
}

function writeBundle(root, payload) {
  const bundle = { ...payload, bundle_sha256: sha256Canonical(payload) };
  fs.writeFileSync(authorityPath(root), `${JSON.stringify(bundle)}\n`, { mode: 0o600 });
  fs.chmodSync(authorityPath(root), 0o600);
  return bundle;
}

function fixture(root = makeRoot()) {
  const observations = [observation()];
  const authorityManifest = createAuthorityManifest(observations);
  const persisted = publishAnalysisState({
    cwd: root,
    taskId: TASK_ID,
    repository: "cortex",
    input: { schema_version: 1, rule_ids: REGISTERED_RULE_IDS, observations },
    authorityManifest,
    sourceAuthorities: SOURCE_AUTHORITIES,
  });
  const bundle = writeBundle(root, bundlePayload(observations));
  return { root, observations, persisted, bundle };
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof AnalysisQueryError && error.code === code);
}

function runCli(root, args) {
  const source = `import { runWorkflowAnalysisCommand } from ${JSON.stringify(RUNTIME_URL)}; await runWorkflowAnalysisCommand(${JSON.stringify(args)});`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CORTEX_PROJECT_ROOT: root },
  });
}

function identity(root) {
  const targets = [
    path.join(root, ".agents"),
    path.join(root, ".agents", TASK_ID),
    path.join(root, ".agents", TASK_ID, "analysis"),
    authorityPath(root),
    ...["observations.jsonl", "snapshot.json", "changes.jsonl", "manifest.json"].map((name) => storePath(root, name)),
  ];
  return targets.map((target) => {
    const stat = fs.lstatSync(target, { bigint: true });
    return {
      target: path.relative(root, target),
      dev: stat.dev,
      ino: stat.ino,
      ctimeNs: stat.ctimeNs,
      mtimeNs: stat.mtimeNs,
      mode: stat.mode,
      nlink: stat.nlink,
      size: stat.size,
      entries: stat.isDirectory() ? fs.readdirSync(target).sort() : null,
      bytes: stat.isFile() ? fs.readFileSync(target).toString("base64") : null,
    };
  });
}

test("trusted reader binds independent authority and leaves every byte and identity unchanged", () => {
  const { root, persisted } = fixture();
  try {
    const before = identity(root);
    const first = readTrustedAnalysisState({ cwd: root, taskId: TASK_ID });
    const second = readTrustedAnalysisState({ cwd: root, taskId: TASK_ID });
    assert.equal(first.authority.primary_subject, SUBJECT);
    assert.equal(first.persisted.state.snapshotBytes, persisted.state.snapshotBytes);
    assert.equal(second.persisted.state.snapshotBytes, first.persisted.state.snapshotBytes);
    assert.deepEqual(identity(root), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("missing, malformed, oversized, and identity-drifted authority fails closed", () => {
  const empty = makeRoot();
  try {
    expectCode(() => readTrustedAnalysisState({ cwd: empty, taskId: TASK_ID }), "STATE_NOT_FOUND");
    expectCode(() => readTrustedAnalysisState({ cwd: empty, taskId: "../escape" }), "AUTHORITY_INVALID");
  } finally { fs.rmSync(empty, { recursive: true, force: true }); }

  for (const mutation of ["missing", "malformed", "utf8", "oversized", "identity"]) {
    const { root, observations } = fixture();
    try {
      if (mutation === "missing") fs.unlinkSync(authorityPath(root));
      if (mutation === "malformed") fs.writeFileSync(authorityPath(root), "{}\n", { mode: 0o600 });
      if (mutation === "utf8") fs.writeFileSync(authorityPath(root), Buffer.from([0xff, 0xfe]), { mode: 0o600 });
      if (mutation === "oversized") fs.writeFileSync(authorityPath(root), Buffer.alloc(ANALYSIS_AUTHORITY_MAX_BYTES + 1), { mode: 0o600 });
      if (mutation === "identity") writeBundle(root, bundlePayload(observations, { task_id: "wo058-other" }));
      expectCode(
        () => readTrustedAnalysisState({ cwd: root, taskId: TASK_ID }),
        mutation === "identity" ? "STATE_UNTRUSTED" : "AUTHORITY_INVALID",
      );
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test("authority containment rejects symlink, hard-link, FIFO, and wrong mode", (t) => {
  for (const mutation of ["symlink", "hardlink", "fifo", "mode"]) {
    const { root } = fixture();
    const outside = path.join(os.tmpdir(), `cortex-analysis-authority-${process.pid}-${mutation}`);
    try {
      if (mutation === "symlink") {
        fs.writeFileSync(outside, "{}\n", { mode: 0o600 });
        fs.unlinkSync(authorityPath(root));
        fs.symlinkSync(outside, authorityPath(root));
      } else if (mutation === "hardlink") {
        fs.linkSync(authorityPath(root), outside);
      } else if (mutation === "fifo") {
        fs.unlinkSync(authorityPath(root));
        const made = spawnSync("mkfifo", [authorityPath(root)], { encoding: "utf8" });
        if (made.error?.code === "ENOENT") {
          t.diagnostic("mkfifo unavailable; FIFO branch skipped");
          continue;
        }
        assert.equal(made.status, 0, made.stderr);
      } else {
        fs.chmodSync(authorityPath(root), 0o644);
      }
      expectCode(() => readTrustedAnalysisState({ cwd: root, taskId: TASK_ID }), "STATE_UNTRUSTED");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { force: true });
    }
  }
});

test("bundle, manifest, registry, partial state, observation chain, and snapshot tamper fails closed", () => {
  for (const mutation of ["bundle", "manifest", "registry", "partial", "observations", "snapshot"]) {
    const { root, observations, bundle } = fixture();
    try {
      if (mutation === "bundle") {
        fs.writeFileSync(authorityPath(root), `${JSON.stringify({ ...bundle, bundle_sha256: "f".repeat(64) })}\n`, { mode: 0o600 });
      } else if (mutation === "manifest") {
        writeBundle(root, bundlePayload(observations, { authority_manifest: createAuthorityManifest([]) }));
      } else if (mutation === "registry") {
        writeBundle(root, bundlePayload(observations, {
          source_authorities: createSourceAuthorityRegistry({
            [SOURCE.path]: { sha256: SOURCE.sha256, authorities: ["manager"] },
          }),
        }));
      } else if (mutation === "partial") {
        fs.unlinkSync(storePath(root, "changes.jsonl"));
      } else if (mutation === "observations") {
        const target = storePath(root, "observations.jsonl");
        fs.writeFileSync(target, fs.readFileSync(target, "utf8").replace('"reviewer"', '"manager"'), { mode: 0o600 });
      } else {
        fs.writeFileSync(storePath(root, "snapshot.json"), "{}\n", { mode: 0o600 });
      }
      expectCode(() => readTrustedAnalysisState({ cwd: root, taskId: TASK_ID }), "STATE_UNTRUSTED");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test("concurrent authority replacement is detected after replay", () => {
  const { root } = fixture();
  const target = authorityPath(root);
  const backup = `${target}.old`;
  try {
    expectCode(() => readTrustedAnalysisState({
      cwd: root,
      taskId: TASK_ID,
      hooks: {
        afterAuthorityRead() {
          fs.renameSync(target, backup);
          fs.copyFileSync(backup, target);
          fs.chmodSync(target, 0o600);
        },
      },
    }), "STATE_UNTRUSTED");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("an unrelated repository-root entry does not invalidate the task-local read", () => {
  const { root } = fixture();
  const unrelated = path.join(root, "unrelated.tmp");
  try {
    const trusted = readTrustedAnalysisState({
      cwd: root,
      taskId: TASK_ID,
      hooks: { afterAuthorityRead() { fs.writeFileSync(unrelated, "outside task state\n"); } },
    });
    assert.equal(trusted.authority.primary_subject, SUBJECT);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("all four runtime operations are deterministic, bounded, and use primary_subject", () => {
  const { root, persisted } = fixture();
  try {
    const factId = persisted.state.query(SUBJECT, "human_approval")[0].id;
    const cases = [
      ["state", TASK_ID, "--json"],
      ["why", TASK_ID, factId, "--json"],
      ["why-not", TASK_ID, "accepted", "--json"],
      ["changes", TASK_ID, "--since", "0", "--json"],
    ];
    for (const args of cases) {
      const first = runCli(root, args);
      const second = runCli(root, args);
      assert.equal(first.status, 0, first.stderr);
      assert.equal(second.status, 0, second.stderr);
      assert.equal(first.stdout, second.stdout);
      assert.ok(Buffer.byteLength(first.stdout) <= 65_536);
      assert.doesNotMatch(first.stdout, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
      const parsed = JSON.parse(first.stdout);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.schema_version, 1);
      assert.equal(parsed.generator_version, "maintained-analysis-cli-v1");
      assert.equal(parsed.data.binding.primary_subject, SUBJECT);
      if (args[0] === "why-not") assert.equal(parsed.data.explanation.subject, SUBJECT);
    }
    const text = runCli(root, ["state", TASK_ID]);
    assert.equal(text.status, 0, text.stderr);
    assert.equal(JSON.parse(text.stdout).data.binding.primary_subject, SUBJECT);
    const future = runCli(root, ["changes", TASK_ID, "--since", "2", "--json"]);
    assert.equal(future.status, 1);
    assert.equal(JSON.parse(future.stdout).error.code, "INVALID_ARGS");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("state output is byte-identical from an actual linked worktree", () => {
  const root = makeRoot("cortex-analysis-git-");
  const linked = makeRoot("cortex-analysis-linked-");
  fs.rmSync(linked, { recursive: true, force: true });
  try {
    assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
    fs.writeFileSync(path.join(root, "README.md"), "fixture\n");
    assert.equal(spawnSync("git", ["add", "README.md"], { cwd: root }).status, 0);
    assert.equal(spawnSync("git", ["-c", "user.name=Cortex", "-c", "user.email=cortex@example.invalid", "commit", "-qm", "fixture"], { cwd: root }).status, 0);
    assert.equal(spawnSync("git", ["worktree", "add", "-q", "-b", "linked", linked], { cwd: root }).status, 0);
    fixture(root);
    fixture(fs.realpathSync(linked));
    const primary = runCli(root, ["state", TASK_ID, "--json"]);
    const secondary = runCli(fs.realpathSync(linked), ["state", TASK_ID, "--json"]);
    assert.equal(primary.status, 0, primary.stderr);
    assert.equal(secondary.status, 0, secondary.stderr);
    assert.equal(primary.stdout, secondary.stdout);
  } finally {
    spawnSync("git", ["worktree", "remove", "--force", linked], { cwd: root });
    fs.rmSync(linked, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
