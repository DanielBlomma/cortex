import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  NULL_IDENTITY,
  getRepoIdentity,
  normalizeRemoteUrl,
} from "../dist/core/telemetry/repo-identity.js";
import { runTelemetryTest } from "../dist/cli/telemetry-test.js";
import {
  pushWorkflowSnapshot,
  setWorkflowPushContext,
} from "../dist/enterprise/workflow/push.js";

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function createRepo(prefix, remote = `https://example.com/${prefix}.git`) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  git(dir, "init");
  git(dir, "config", "user.name", "Test User");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "remote", "add", "origin", remote);
  // Per-repo unique content + commit message so two fresh repos created in
  // the same test produce different HEAD SHAs (git commit hashes include
  // tree + parent + author/committer + message + timestamps; absent
  // distinct content the rest can collide at second-precision).
  writeFileSync(path.join(dir, "tracked.txt"), `${path.basename(dir)}\n`);
  git(dir, "add", "tracked.txt");
  git(dir, "commit", "-m", `initial ${path.basename(dir)}`);
  return dir;
}

test("normalizeRemoteUrl collapses clone styles to the same form", () => {
  const expected = "github.com/org/repo";
  assert.equal(normalizeRemoteUrl("git@github.com:org/repo.git"), expected);
  assert.equal(normalizeRemoteUrl("ssh://git@github.com/org/repo.git"), expected);
  assert.equal(normalizeRemoteUrl("https://github.com/org/repo.git"), expected);
  assert.equal(normalizeRemoteUrl("https://github.com/org/repo"), expected);
  assert.equal(normalizeRemoteUrl("https://user:token@github.com/org/repo"), expected);
  assert.equal(normalizeRemoteUrl("HTTPS://GitHub.com/Org/Repo.git/"), expected);
});

test("getRepoIdentity outside a git repo returns NULL_IDENTITY", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cortex-not-a-repo-"));
  const identity = getRepoIdentity(dir);
  assert.deepEqual(identity, NULL_IDENTITY);
});

test("getRepoIdentity returns null branch on detached HEAD", () => {
  const dir = createRepo("cortex-detached-");
  const sha = git(dir, "rev-parse", "HEAD");
  git(dir, "checkout", "--detach", sha);
  const identity = getRepoIdentity(dir);
  assert.equal(identity.repo_branch, null);
  assert.equal(identity.repo_head_sha, sha);
  assert.equal(identity.repo_dirty, false);
});

test("identical remotes from different clone styles produce identical hashes", () => {
  const repoA = createRepo("cortex-rem-a-", "git@github.com:org/repo.git");
  const repoB = createRepo("cortex-rem-b-", "https://github.com/org/repo");
  const identityA = getRepoIdentity(repoA);
  const identityB = getRepoIdentity(repoB);
  assert.ok(identityA.repo_remote_hash);
  assert.equal(identityA.repo_remote_hash, identityB.repo_remote_hash);
});

test("workflow pushes resolve repo identity from project_root on every send", async () => {
  const repoDir = createRepo("cortex-repo-");
  const endpoint = "https://example.com/api/v1/policies/sync";
  const apiKey = "ent_12345678";
  const originalFetch = globalThis.fetch;
  const payloads = [];

  globalThis.fetch = async (_url, init) => {
    payloads.push(JSON.parse(String(init.body)));
    return { ok: true, status: 200 };
  };

  setWorkflowPushContext({
    repo: path.basename(repoDir),
    instance_id: "instance-1",
    session_id: "session-1",
    project_root: repoDir,
  });

  try {
    await pushWorkflowSnapshot(endpoint, apiKey, { phase: "clean" });

    writeFileSync(path.join(repoDir, "tracked.txt"), "one\ntwo\n");
    await pushWorkflowSnapshot(endpoint, apiKey, { phase: "dirty" });

    git(repoDir, "add", "tracked.txt");
    git(repoDir, "commit", "-m", "second");
    await pushWorkflowSnapshot(endpoint, apiKey, { phase: "committed" });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(payloads.length, 3);
  assert.equal(payloads[0].repo_dirty, false);
  assert.equal(payloads[1].repo_dirty, true);
  assert.equal(payloads[2].repo_dirty, false);
  assert.notEqual(payloads[0].repo_head_sha, payloads[2].repo_head_sha);
  // Always-present, possibly-null shape: every push has all four fields.
  for (const p of payloads) {
    assert.ok("repo_remote_hash" in p);
    assert.ok("repo_branch" in p);
    assert.ok("repo_head_sha" in p);
    assert.ok("repo_dirty" in p);
  }
});

test("workflow push without project_root falls back to NULL_IDENTITY (still emits keys)", async () => {
  const endpoint = "https://example.com/api/v1/policies/sync";
  const apiKey = "ent_12345678";
  const originalFetch = globalThis.fetch;
  let payload = null;

  globalThis.fetch = async (_url, init) => {
    payload = JSON.parse(String(init.body));
    return { ok: true, status: 200 };
  };

  setWorkflowPushContext({
    repo: "no-root",
    instance_id: "instance-2",
    session_id: "session-2",
    // no project_root
  });

  try {
    await pushWorkflowSnapshot(endpoint, apiKey, { phase: "anything" });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(payload);
  assert.equal(payload.repo_remote_hash, null);
  assert.equal(payload.repo_branch, null);
  assert.equal(payload.repo_head_sha, null);
  assert.equal(payload.repo_dirty, null);
});

test("telemetry test uses CORTEX_PROJECT_ROOT for repo identity", async () => {
  const projectRoot = createRepo("cortex-project-");
  const shellCwd = createRepo("cortex-shell-");
  const contextDir = path.join(projectRoot, ".context");
  const originalProjectRoot = process.env.CORTEX_PROJECT_ROOT;
  const originalVersion = process.env.CORTEX_VERSION;
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;
  let payload = null;

  mkdirSync(path.join(contextDir, "telemetry"), { recursive: true });
  writeFileSync(
    path.join(contextDir, "enterprise.yml"),
    [
      "enterprise:",
      "  endpoint: https://example.com/api/v1/enterprise",
      "  api_key: ent_12345678",
      "telemetry:",
      "  enabled: true",
      "  endpoint: https://example.com/api/v1/telemetry/push",
    ].join("\n"),
  );
  writeFileSync(path.join(contextDir, "telemetry", "machine_id"), "machine-123\n");

  globalThis.fetch = async (_url, init) => {
    payload = JSON.parse(String(init.body));
    return { ok: true, status: 200 };
  };

  process.env.CORTEX_PROJECT_ROOT = projectRoot;
  process.env.CORTEX_VERSION = "test-version";
  process.chdir(shellCwd);

  try {
    const exitCode = await runTelemetryTest();
    assert.equal(exitCode, 0);
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
    if (originalProjectRoot === undefined) {
      delete process.env.CORTEX_PROJECT_ROOT;
    } else {
      process.env.CORTEX_PROJECT_ROOT = originalProjectRoot;
    }
    if (originalVersion === undefined) {
      delete process.env.CORTEX_VERSION;
    } else {
      process.env.CORTEX_VERSION = originalVersion;
    }
  }

  assert.ok(payload);
  const expected = getRepoIdentity(projectRoot);
  const shellIdentity = getRepoIdentity(shellCwd);

  assert.equal(payload.repo_remote_hash, expected.repo_remote_hash);
  assert.equal(payload.repo_branch, expected.repo_branch);
  assert.equal(payload.repo_head_sha, expected.repo_head_sha);
  assert.equal(payload.repo_dirty, expected.repo_dirty);
  assert.notEqual(payload.repo_head_sha, shellIdentity.repo_head_sha);
});
