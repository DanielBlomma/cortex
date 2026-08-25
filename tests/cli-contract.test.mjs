import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO_ROOT, "bin", "cortex.mjs");
const PACKAGE_VERSION = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
).version;

function isolatedEnv(homeDir, overrides = {}) {
  const env = { ...process.env, HOME: homeDir, ...overrides };
  for (const name of [
    "CORTEX_AUTO_BOOTSTRAP_ON_MCP",
    "CORTEX_AUTO_MIGRATE",
    "CORTEX_DAEMON_SOCKET_PATH",
    "CORTEX_PROJECT_ROOT",
  ]) {
    if (!Object.prototype.hasOwnProperty.call(overrides, name)) {
      delete env[name];
    }
  }
  return env;
}

function runCli(args, { cwd = REPO_ROOT, homeDir, env = {}, input } = {}) {
  const ownedHome = homeDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "cortex-cli-home-"));
  try {
    return spawnSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: "utf8",
      env: isolatedEnv(ownedHome, env),
      input,
    });
  } finally {
    if (homeDir === undefined) {
      fs.rmSync(ownedHome, { recursive: true, force: true });
    }
  }
}

function writeRuntimeFile(root, relativePath, contents, mode = 0o644) {
  const target = path.join(root, ".context", "mcp", relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, { encoding: "utf8", mode });
  return target;
}

test("CLI help aliases preserve status and stdout/stderr ownership", () => {
  const results = [
    runCli([]),
    runCli(["help"]),
    runCli(["--help"]),
    runCli(["-h"]),
  ];

  for (const result of results) {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /^CORTEX CLI/m);
    assert.match(result.stdout, /^USAGE$/m);
  }
  for (const result of results.slice(1)) {
    assert.equal(result.stdout, results[0].stdout);
  }
});

test("CLI help inventories the public top-level command surface", () => {
  const result = runCli(["help"]);
  assert.equal(result.status, 0, result.stderr);

  for (const command of [
    "init",
    "connect",
    "bootstrap",
    "indexing",
    "update",
    "status",
    "doctor",
    "ingest",
    "embed",
    "graph-load",
    "search",
    "related",
    "impact",
    "rules",
    "explain",
    "pattern-evidence",
    "conventions",
    "guidance",
    "dashboard",
    "memory-compile",
    "memory-lint",
    "watch",
    "enterprise",
    "run",
    "daemon",
    "hooks",
    "telemetry",
    "stage",
    "mcp",
    "version",
    "help",
  ]) {
    assert.match(result.stdout, new RegExp(`(^|\\s)${command.replaceAll("-", "\\-")}(\\s|$)`, "m"));
  }
});

test("CLI version aliases emit only the package version on stdout", () => {
  for (const args of [["version"], ["--version"], ["-V"]]) {
    const result = runCli(args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${PACKAGE_VERSION}\n`);
    assert.equal(result.stderr, "");
  }
});

for (const [name, args, message] of [
  ["unknown command", ["not-a-command"], /Unknown command: not-a-command/],
  ["unknown init flag", ["init", "--not-an-init-option"], /Unknown init option/],
  ["unknown connect flag", ["connect", "--not-a-connect-option"], /Unknown connect option/],
  [
    "unknown Enterprise status flag",
    ["enterprise", "status", "--not-a-status-option"],
    /Unknown enterprise status option/,
  ],
  ["unknown daemon subcommand", ["daemon", "unknown"], /Unknown daemon subcommand/],
  ["unknown hooks subcommand", ["hooks", "unknown"], /Unknown hooks subcommand/],
  ["unknown telemetry subcommand", ["telemetry", "unknown"], /Unknown telemetry subcommand/],
]) {
  test(`CLI ${name} exits 1 and writes the diagnostic to stderr`, () => {
    const result = runCli(args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, message);
  });
}

test("commands that require a project runtime fail with stable stderr diagnostics", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-cli-missing-runtime-"));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-cli-missing-home-"));
  try {
    for (const [args, message] of [
      [["search", "source of truth", "--json"], /Build the project's context runtime first/],
      [["stage", "status", "--task-id", "missing"], /Build the project's context runtime first/],
      [["run", "codex", "--version"], /Build the project's context runtime first/],
      [["telemetry", "test"], /Build the project's context runtime first/],
      [["connect"], /Run 'cortex init --bootstrap' first/],
      [["mcp"], /Run 'cortex init --bootstrap' first/],
      [["status"], /Run 'cortex init' first/],
    ]) {
      const result = runCli(args, {
        cwd,
        homeDir,
        env: {
          CORTEX_AUTO_BOOTSTRAP_ON_MCP: "0",
          CORTEX_AUTO_MIGRATE: "0",
        },
      });
      assert.equal(result.status, 1, `${args.join(" ")}\n${result.stderr}`);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, message);
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test("runtime-backed handlers preserve arguments, streams, and exit behavior", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-cli-runtime-handlers-"));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-cli-runtime-home-"));
  writeRuntimeFile(cwd, "package.json", '{"type":"module"}\n');
  writeRuntimeFile(
    cwd,
    "dist/cli/run.js",
    [
      "export async function runAiCli({ cli, args }) {",
      "  process.stdout.write(JSON.stringify({ handler: 'run', cli, args }) + '\\n');",
      "  process.stderr.write('run-stderr\\n');",
      "  return 6;",
      "}",
      "",
    ].join("\n"),
  );
  writeRuntimeFile(
    cwd,
    "dist/cli/stage.js",
    [
      "export async function runStageCommand(args) {",
      "  process.stdout.write(JSON.stringify({ handler: 'stage', args, root: process.env.CORTEX_PROJECT_ROOT }) + '\\n');",
      "  process.stderr.write('stage-stderr\\n');",
      "  process.exitCode = 5;",
      "}",
      "",
    ].join("\n"),
  );
  writeRuntimeFile(
    cwd,
    "dist/cli/telemetry-test.js",
    [
      "export async function runTelemetryTest() {",
      "  process.stdout.write('telemetry-stdout\\n');",
      "  process.stderr.write('telemetry-stderr\\n');",
      "  return 4;",
      "}",
      "",
    ].join("\n"),
  );
  writeRuntimeFile(
    cwd,
    "dist/hooks/fixture.js",
    [
      "let input = '';",
      "for await (const chunk of process.stdin) input += chunk;",
      "process.stdout.write(`hook-stdout:${input}`);",
      "process.stderr.write('hook-stderr\\n');",
      "process.exit(3);",
      "",
    ].join("\n"),
  );
  writeRuntimeFile(
    cwd,
    "dist/server.js",
    [
      "process.stdout.write('mcp-stdout\\n');",
      "process.stderr.write('mcp-stderr\\n');",
      "process.exit(2);",
      "",
    ].join("\n"),
  );

  try {
    const runResult = runCli(["run", "codex", "--sentinel", "value"], {
      cwd,
      homeDir,
    });
    assert.equal(runResult.status, 6);
    assert.equal(runResult.stderr, "run-stderr\n");
    assert.deepEqual(JSON.parse(runResult.stdout), {
      handler: "run",
      cli: "codex",
      args: ["--sentinel", "value"],
    });

    const stageResult = runCli(
      ["stage", "status", "--task-id", "task-17"],
      { cwd, homeDir },
    );
    assert.equal(stageResult.status, 5);
    assert.equal(stageResult.stderr, "stage-stderr\n");
    assert.deepEqual(JSON.parse(stageResult.stdout), {
      handler: "stage",
      args: ["status", "--task-id", "task-17"],
      root: fs.realpathSync(cwd),
    });

    const telemetryResult = runCli(["telemetry", "test"], { cwd, homeDir });
    assert.equal(telemetryResult.status, 4);
    assert.equal(telemetryResult.stdout, "telemetry-stdout\n");
    assert.equal(telemetryResult.stderr, "telemetry-stderr\n");

    const hookResult = runCli(
      ["hook", "fixture", "--ignored-compatibility-argument"],
      { cwd, homeDir, input: "hook-input\n" },
    );
    assert.equal(hookResult.status, 3);
    assert.equal(hookResult.stdout, "hook-stdout:hook-input\n");
    assert.equal(hookResult.stderr, "hook-stderr\n");

    const mcpResult = runCli(["mcp"], {
      cwd,
      homeDir,
      env: {
        CORTEX_AUTO_BOOTSTRAP_ON_MCP: "0",
        CORTEX_AUTO_MIGRATE: "0",
      },
    });
    assert.equal(mcpResult.status, 1);
    assert.equal(mcpResult.stdout, "mcp-stdout\n");
    assert.match(mcpResult.stderr, /\[cortex\] starting MCP stdio server/);
    assert.match(mcpResult.stderr, /mcp-stderr/);
    assert.match(mcpResult.stderr, /node exited with code 2/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test("hooks project status preserves defaults and stream ownership", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-cli-hooks-status-"));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-cli-hooks-home-"));
  try {
    const result = runCli(["hooks", "status", "--project"], {
      cwd,
      homeDir,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(
      result.stdout,
      new RegExp(
        `Settings file: ${path.join(fs.realpathSync(cwd), ".claude", "settings.json")}`,
      ),
    );
    for (const hook of [
      "pre-tool-use",
      "stop",
      "session-start",
      "session-end",
      "user-prompt-submit",
      "pre-compact",
    ]) {
      assert.match(result.stdout, new RegExp(hook));
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test("connect preserves client arguments and reports successful registrations", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-cli-connect-success-"));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-cli-connect-home-"));
  const clientBin = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-cli-connect-bin-"));
  writeRuntimeFile(cwd, "package.json", '{"type":"module"}\n');
  writeRuntimeFile(cwd, "dist/server.js", "process.exit(0);\n");
  const clientStub = [
    "#!/usr/bin/env node",
    "const path = require('node:path');",
    "if (process.argv[2] === '--version') process.exit(0);",
    "process.stdout.write(`client:${path.basename(process.argv[1])}:${process.argv.slice(2).join('|')}\\n`);",
    "",
  ].join("\n");
  for (const name of ["codex", "claude"]) {
    const target = path.join(clientBin, name);
    fs.writeFileSync(target, clientStub, { encoding: "utf8", mode: 0o755 });
    fs.chmodSync(target, 0o755);
  }

  try {
    const result = runCli(["connect", "--skip-build"], {
      cwd,
      homeDir,
      env: { PATH: `${clientBin}${path.delimiter}${process.env.PATH}` },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(
      result.stdout,
      /client:codex:mcp\|add\|cortex-cortex-cli-connect-success-[^|]+\|--\|node\|/,
    );
    assert.match(
      result.stdout,
      /client:claude:mcp\|add\|-s\|project\|cortex\|--\|node\|\.context\/mcp\/dist\/server\.js/,
    );
    assert.match(result.stdout, /connected Codex MCP server/);
    assert.match(result.stdout, /connected Claude Code MCP server/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(clientBin, { recursive: true, force: true });
  }
});

test("context passthrough commands preserve arguments and child streams", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-cli-passthrough-"));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-cli-passthrough-home-"));
  const scriptsDir = path.join(cwd, ".context", "scripts");
  const runtimeDir = path.join(cwd, ".context", "mcp");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(
    path.join(scriptsDir, "context.sh"),
    [
      "#!/usr/bin/env bash",
      "# doctor)",
      "# indexing)",
      "printf 'runtime-stdout:%s\\n' \"$*\"",
      "printf 'runtime-stderr:%s\\n' \"$*\" >&2",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(path.join(scriptsDir, "doctor.sh"), "#!/usr/bin/env bash\n", "utf8");
  fs.writeFileSync(path.join(scriptsDir, "indexing.mjs"), "// indexing lifecycle\n", "utf8");
  fs.writeFileSync(path.join(runtimeDir, "package.json"), "{}\n", "utf8");

  try {
    for (const command of [
      "bootstrap",
      "indexing",
      "update",
      "status",
      "ingest",
      "embed",
      "graph-load",
      "dashboard",
      "watch",
      "refresh",
      "memory-compile",
      "memory-lint",
      "doctor",
    ]) {
      const result = runCli([command, "--sentinel", "value"], {
        cwd,
        homeDir,
        env: { CORTEX_AUTO_MIGRATE: "0" },
      });
      assert.equal(result.status, 0, `${command}\n${result.stderr}`);
      assert.equal(result.stdout, `runtime-stdout:${command} --sentinel value\n`);
      assert.equal(result.stderr, `runtime-stderr:${command} --sentinel value\n`);
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});
