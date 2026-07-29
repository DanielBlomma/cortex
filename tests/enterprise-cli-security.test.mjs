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
import {
  hardenEnterpriseConfigPermissions,
  runEnterpriseInstall,
} from "../bin/cortex.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "cortex.mjs");
const installDriver = path.join(
  repoRoot,
  "tests",
  "fixtures",
  "enterprise-install-driver.mjs",
);
const trustedInstallDriver = path.join(
  repoRoot,
  "tests",
  "fixtures",
  "enterprise-trusted-install-driver.mjs",
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
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Positional enterprise API keys are not accepted/);
  assert.doesNotMatch(result.stderr, new RegExp(secret));
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
  assert.equal(result.stderr, "");
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
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /enterprise install --api-key-stdin/);
});

test("enterprise CLI: malformed status options exit 1 on stderr before runtime import", () => {
  const result = spawnSync(
    process.execPath,
    [cli, "enterprise", "status", "--not-a-status-option"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown enterprise status option/);
});

test("enterprise CLI: never imports a repository-controlled Enterprise runtime", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-hostile-runtime-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-hostile-home-"));
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
    const result = spawnSync(
      process.execPath,
      [cli, "enterprise", "status", "--json"],
      {
      cwd,
      encoding: "utf8",
        env: {
          ...process.env,
          HOME: home,
          CORTEX_PROJECT_ROOT: cwd,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const status = JSON.parse(result.stdout);
    assert.equal(status.cwd, fs.realpathSync(cwd));
    assert.equal(status.mode_effective, "off");
    assert.equal(
      fs.existsSync(marker),
      false,
      "project runtime code must never execute on the Enterprise control path",
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("enterprise CLI: missing package-owned runtime fails closed", () => {
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-missing-trusted-runtime-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-missing-trusted-home-"));
  fs.cpSync(path.join(repoRoot, "bin"), path.join(packageRoot, "bin"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: "cortex-test", version: "2.4.1", type: "module" }),
    "utf8",
  );

  try {
    const result = spawnSync(
      process.execPath,
      [path.join(packageRoot, "bin", "cortex.mjs"), "enterprise", "status", "--json"],
      {
        cwd: packageRoot,
        encoding: "utf8",
        env: { ...process.env, HOME: home },
      },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /missing its trusted Enterprise runtime/);
  } finally {
    fs.rmSync(packageRoot, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("enterprise CLI: install resolves package-owned trusted runtimes", () => {
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-trusted-install-"));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-hostile-install-"));
  const packageCli = path.join(packageRoot, "bin", "cortex.mjs");
  const trustedCliDir = path.join(packageRoot, "scaffold", "mcp", "dist", "cli");
  const hostileCliDir = path.join(projectRoot, ".context", "mcp", "dist", "cli");
  const hostileMarker = path.join(projectRoot, "project-install-runtime-executed");
  fs.cpSync(path.join(repoRoot, "bin"), path.join(packageRoot, "bin"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: "cortex-test", version: "2.4.1", type: "module" }),
    "utf8",
  );
  fs.mkdirSync(trustedCliDir, { recursive: true });
  fs.writeFileSync(
    path.join(trustedCliDir, "enterprise-setup.js"),
    [
      "export async function runEnterpriseSetup() {",
      "  process.stdout.write('trusted-enterprise-setup\\n');",
      "  return { ok: true, message: 'configured', configPath: '/private/tmp/cortex-enterprise-test.yml', edition: 'enterprise', expiresAt: '2099-01-01T00:00:00.000Z' };",
      "}",
      "export async function bindEnterpriseIdentity() {",
      "  process.stdout.write('trusted-enterprise-identity\\n');",
      "  return true;",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(trustedCliDir, "govern.js"),
    [
      "export async function runGovernInstall() {",
      "  process.stdout.write('trusted-govern-install\\n');",
      "  return { ok: true, message: 'installed' };",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.mkdirSync(hostileCliDir, { recursive: true });
  fs.writeFileSync(
    path.join(hostileCliDir, "enterprise-setup.js"),
    [
      "import fs from 'node:fs';",
      `fs.writeFileSync(${JSON.stringify(hostileMarker)}, 'executed');`,
      "throw new Error('project-controlled install runtime executed');",
      "",
    ].join("\n"),
    "utf8",
  );

  try {
    const secret = "ent_trusted_install_12345678";
    const result = spawnSync(
      process.execPath,
      [trustedInstallDriver, packageCli],
      {
        cwd: projectRoot,
        encoding: "utf8",
        input: `${secret}\n`,
      },
    );
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 0, output);
    assert.match(output, /trusted-enterprise-setup/);
    assert.match(output, /trusted-enterprise-identity/);
    assert.match(output, /trusted-govern-install/);
    assert.doesNotMatch(output, new RegExp(secret));
    assert.equal(fs.existsSync(hostileMarker), false);
  } finally {
    fs.rmSync(packageRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("enterprise CLI: install requires the explicit stdin flag", () => {
  const secret = "ent_missing_flag_12345678";
  const result = spawnSync(process.execPath, [cli, "enterprise", "install"], {
    cwd: repoRoot,
    encoding: "utf8",
    input: `${secret}\n`,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /requires --api-key-stdin/);
  assert.doesNotMatch(result.stderr, new RegExp(secret));
});

test("enterprise CLI: TTY stdin is rejected before reading or echoing a key", async () => {
  const secret = "ent_tty_secure_12345678";
  let readAttempted = false;
  const stdin = {
    isTTY: true,
    [Symbol.asyncIterator]() {
      readAttempted = true;
      throw new Error(`must not read ${secret}`);
    },
  };
  await assert.rejects(
    () => runEnterpriseInstall(["--api-key-stdin"], { stdin }),
    /interactive echo is disabled for secrets/,
  );
  assert.equal(readAttempted, false, "TTY input must be rejected before iteration");
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
  for (const event of [
    "install-event:identity-bound",
    "install-event:govern-install",
    "install-event:privileges-dropped",
  ]) {
    assert.match(output, new RegExp(event));
  }
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
  ["leading blank line", "\nent_leading_blank_12345678\n", /exactly one enterprise API key/i],
  ["trailing blank line", "ent_trailing_blank_12345678\n\n", /exactly one enterprise API key/i],
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

test("init --force preserves user-owned configuration and repairs Enterprise modes to 0600", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-config-mode-"));
  const contextDir = path.join(target, ".context");
  fs.mkdirSync(contextDir);
  const preserved = new Map([
    [path.join(contextDir, "config.yaml"), "repo_id: preserved\nsource_paths:\n  - custom\n"],
    [path.join(contextDir, "rules.yaml"), "rules:\n  - id: rule.preserved\n"],
    [path.join(contextDir, "enterprise.yml"), "enterprise:\n  api_key: ent_preserved_12345678\n"],
    [path.join(contextDir, "enterprise.yaml"), "enterprise:\n  api_key: ent_preserved_87654321\n"],
    [path.join(target, "AGENTS.md"), "# Preserved agent instructions\n"],
    [path.join(target, "CLAUDE.md"), "# Preserved Claude instructions\n"],
  ]);
  for (const [file, content] of preserved) {
    fs.writeFileSync(file, content, { encoding: "utf8", mode: 0o644 });
  }
  for (const file of [
    path.join(contextDir, "enterprise.yml"),
    path.join(contextDir, "enterprise.yaml"),
  ]) {
    fs.chmodSync(file, 0o644);
    assert.equal(
      fs.statSync(file).mode & 0o777,
      0o644,
      "the test must begin from a permissive Enterprise config",
    );
  }

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
    assert.equal(result.stderr, "");
    for (const [file, content] of preserved) {
      const actual = fs.readFileSync(file, "utf8");
      if (path.basename(file) === "AGENTS.md") {
        assert.ok(actual.startsWith(content), "existing AGENTS.md instructions must remain intact");
        assert.equal((actual.match(/<!-- cortex:auto:start -->/g) ?? []).length, 1);
      } else {
        assert.equal(actual, content, `${file} must remain byte-identical`);
      }
    }
    for (const file of [
      path.join(contextDir, "enterprise.yml"),
      path.join(contextDir, "enterprise.yaml"),
    ]) {
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    }
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("Enterprise permission hardening rejects symlinks and non-regular files", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-config-type-"));
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-config-external-"));
  const contextDir = path.join(target, ".context");
  const externalConfig = path.join(external, "enterprise.yml");
  fs.mkdirSync(contextDir);
  fs.writeFileSync(externalConfig, "enterprise:\n  api_key: untouched\n", "utf8");
  fs.chmodSync(externalConfig, 0o644);
  const externalMode = fs.statSync(externalConfig).mode & 0o777;
  fs.symlinkSync(externalConfig, path.join(contextDir, "enterprise.yml"));
  fs.mkdirSync(path.join(contextDir, "enterprise.yaml"));

  try {
    assert.throws(
      () => hardenEnterpriseConfigPermissions(target),
      /Refusing symlinked Enterprise configuration/,
    );
    assert.equal(
      fs.readFileSync(externalConfig, "utf8"),
      "enterprise:\n  api_key: untouched\n",
    );
    assert.equal(
      fs.statSync(externalConfig).mode & 0o777,
      externalMode,
      "symlink rejection must not chmod the external target",
    );

    fs.unlinkSync(path.join(contextDir, "enterprise.yml"));
    assert.throws(
      () => hardenEnterpriseConfigPermissions(target),
      /Enterprise configuration is not a regular file/,
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
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
