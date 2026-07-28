import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  probeVerifiedDaemon,
  stopVerifiedDaemon,
} from "../bin/daemon-control.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "cortex.mjs");
const installDriver = path.join(
  repoRoot,
  "tests",
  "fixtures",
  "enterprise-install-driver.mjs",
);

test("enterprise CLI: positional API keys are rejected without echoing the secret", () => {
  const secret = "ent_do_not_echo_12345678";
  const result = spawnSync(
    process.execPath,
    [cli, "enterprise", secret],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  const output = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(output, /Positional enterprise API keys are not accepted/);
  assert.doesNotMatch(output, new RegExp(secret));
});

test("enterprise CLI: help documents stdin-only onboarding", () => {
  const result = spawnSync(
    process.execPath,
    [cli, "enterprise", "help"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0);
  assert.match(result.stdout, /enterprise install --api-key-stdin/);
  assert.doesNotMatch(result.stdout, /enterprise <api-key>/);
});

test("enterprise CLI: install --help is accepted", () => {
  const result = spawnSync(
    process.execPath,
    [cli, "enterprise", "install", "--help"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0);
  assert.match(result.stdout, /enterprise install --api-key-stdin/);
});

test("enterprise CLI: never imports a repository-controlled Enterprise runtime", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-hostile-runtime-"));
  const maliciousCliDir = path.join(cwd, ".context", "mcp", "dist", "cli");
  const marker = path.join(cwd, "project-runtime-executed");
  fs.mkdirSync(maliciousCliDir, { recursive: true });
  fs.writeFileSync(
    path.join(maliciousCliDir, "govern.js"),
    [
      "import fs from 'node:fs';",
      `fs.writeFileSync(${JSON.stringify(marker)}, 'executed');`,
      "export function runGovernStatus() {}",
      "",
    ].join("\n"),
  );
  try {
    spawnSync(process.execPath, [cli, "enterprise", "status"], {
      cwd,
      encoding: "utf8",
    });
    assert.equal(
      fs.existsSync(marker),
      false,
      "project runtime code must never execute on the Enterprise control path",
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("enterprise CLI: stdin-only success never echoes the key", () => {
  const secret = "ent_stdin_secure_12345678";
  const result = spawnSync(process.execPath, [installDriver], {
    cwd: repoRoot,
    encoding: "utf8",
    input: `${secret}\n`,
  });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0, output);
  assert.match(output, /Cortex is running/);
  assert.doesNotMatch(output, new RegExp(secret));
  assert.ok(
    output.indexOf("install-event:identity-bound") <
      output.indexOf("install-event:govern-install"),
    "verified identity must be bound before host-global govern writes",
  );
  assert.ok(
    output.indexOf("install-event:govern-install") <
      output.indexOf("install-event:privileges-dropped"),
    "govern writes must finish before the permanent privilege drop",
  );
});

test("enterprise CLI: identity conflict fails before host-global govern writes", () => {
  const secret = "ent_conflict_secure_12345678";
  const result = spawnSync(process.execPath, [installDriver], {
    cwd: repoRoot,
    encoding: "utf8",
    input: `${secret}\n`,
    env: {
      ...process.env,
      CORTEX_TEST_FAIL_IDENTITY: "1",
    },
  });
  const output = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(output, /different endpoint is already enrolled/);
  assert.match(output, /install-event:identity-bound/);
  assert.doesNotMatch(output, /install-event:govern-install/);
  assert.doesNotMatch(output, new RegExp(secret));
});

for (const [name, input, pattern] of [
  ["empty", "", /exactly one enterprise API key/i],
  ["multiline", "ent_first_12345678\nent_second_12345678\n", /exactly one enterprise API key/i],
  ["oversized", `ent_${"a".repeat(5000)}\n`, /too large/i],
]) {
  test(`enterprise CLI: ${name} stdin is rejected without echo`, () => {
    const result = spawnSync(process.execPath, [installDriver], {
      cwd: repoRoot,
      encoding: "utf8",
      input,
    });
    const output = `${result.stdout}${result.stderr}`;
    assert.notEqual(result.status, 0);
    assert.match(output, pattern);
    for (const line of input.trim().split(/\r?\n/).filter(Boolean)) {
      assert.doesNotMatch(output, new RegExp(line));
    }
  });
}

test("init --force preserves Enterprise config contents and repairs mode to 0600", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-config-mode-"));
  const contextDir = path.join(target, ".context");
  const configPath = path.join(contextDir, "enterprise.yml");
  const content = "enterprise:\n  api_key: ent_preserved_12345678\n";
  fs.mkdirSync(contextDir);
  fs.writeFileSync(configPath, content, { encoding: "utf8", mode: 0o644 });
  fs.chmodSync(configPath, 0o644);

  try {
    const result = spawnSync(
      process.execPath,
      [
        cli,
        "init",
        target,
        "--force",
        "--no-watch",
        "--no-connect",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(fs.readFileSync(configPath, "utf8"), content);
    assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("daemon control: refuses a live PID that does not answer the Cortex handshake", async () => {
  const deps = {
    readPid: () => 44,
    isPidAlive: (pid) => pid === 44,
    call: async () => ({ ok: false, error: "daemon_unreachable" }),
  };
  const probe = await probeVerifiedDaemon(deps);
  assert.deepEqual(probe, {
    running: true,
    verified: false,
    pid: 44,
    reason: "live_pid_without_daemon_handshake",
  });
  await assert.rejects(
    () => stopVerifiedDaemon(deps),
    /Refusing to signal an unverified process/,
  );
});

test("daemon control: verified shutdown waits for process exit", async () => {
  let alive = true;
  const calls = [];
  const deps = {
    readPid: () => 55,
    isPidAlive: (pid) => pid === 55 && alive,
    call: async (type) => {
      calls.push(type);
      if (type === "ping") {
        return { ok: true, result: { pong: true, pid: 55 } };
      }
      if (type === "shutdown") {
        return { ok: true, result: { ok: true } };
      }
      return { ok: false, error: "unexpected" };
    },
  };
  const result = await stopVerifiedDaemon(deps, {
    wait: async () => {
      alive = false;
    },
  });
  assert.deepEqual(result, { stopped: true, pid: 55 });
  assert.deepEqual(calls, ["ping", "shutdown"]);
});

test("daemon control: a live socket PID with a stale different PID file fails closed", async () => {
  const deps = {
    readPid: () => 44,
    isPidAlive: (pid) => pid === 55,
    call: async () => ({
      ok: true,
      result: { pong: true, pid: 55 },
    }),
  };
  assert.deepEqual(await probeVerifiedDaemon(deps), {
    running: true,
    verified: false,
    pid: 55,
    reason: "pid_file_socket_mismatch",
  });
  await assert.rejects(
    () => stopVerifiedDaemon(deps),
    /Refusing to signal an unverified process/,
  );
});

test("enterprise CLI: guardrail activation invokes restart and propagates restart failure", () => {
  const secret = "ent_restart_secure_12345678";
  const success = spawnSync(process.execPath, [installDriver], {
    cwd: repoRoot,
    encoding: "utf8",
    input: `${secret}\n`,
    env: {
      ...process.env,
      CORTEX_TEST_EXERCISE_DAEMON: "1",
    },
  });
  assert.equal(success.status, 0, `${success.stdout}${success.stderr}`);
  assert.match(success.stdout, /daemon-command:restart/);
  assert.doesNotMatch(`${success.stdout}${success.stderr}`, new RegExp(secret));

  const failure = spawnSync(process.execPath, [installDriver], {
    cwd: repoRoot,
    encoding: "utf8",
    input: `${secret}\n`,
    env: {
      ...process.env,
      CORTEX_TEST_EXERCISE_DAEMON: "1",
      CORTEX_TEST_FAIL_DAEMON: "1",
    },
  });
  const output = `${failure.stdout}${failure.stderr}`;
  assert.notEqual(failure.status, 0);
  assert.match(output, /injected daemon restart failure/);
  assert.doesNotMatch(output, /Cortex is running/);
  assert.doesNotMatch(output, new RegExp(secret));
});

test("daemon status remains available outside an initialized project", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-daemon-status-"));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-daemon-home-"));
  const socketPath = path.join(
    os.tmpdir(),
    `cortex-missing-${process.pid}-${Date.now()}.sock`,
  );
  try {
    const result = spawnSync(
      process.execPath,
      [cli, "daemon", "status"],
      {
        cwd,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homeDir,
          CORTEX_DAEMON_SOCKET_PATH: socketPath,
        },
      },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /Daemon not running/);
    assert.doesNotMatch(
      `${result.stdout}${result.stderr}`,
      /Daemon client not found|Build cortex first/,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});
