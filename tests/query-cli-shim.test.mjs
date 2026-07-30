import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI_PATH = fileURLToPath(new URL("../bin/cortex.mjs", import.meta.url));

function isolatedEnv(root) {
  const home = path.join(root, ".test-home");
  fs.mkdirSync(home, { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
  };
  for (const name of [
    "CORTEX_AUTO_BOOTSTRAP_ON_MCP",
    "CORTEX_AUTO_MIGRATE",
    "CORTEX_DAEMON_SOCKET_PATH",
    "CORTEX_PROJECT_ROOT",
  ]) {
    delete env[name];
  }
  return env;
}

test("top-level query commands preserve arguments and JSON envelope streams", () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-query-cli-shim-"));
  try {
    const runtimeDir = path.join(repoRoot, ".context", "mcp");
    const cliDir = path.join(runtimeDir, "dist", "cli");
    fs.mkdirSync(cliDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, "package.json"), JSON.stringify({ type: "module" }), "utf8");
    fs.writeFileSync(
      path.join(cliDir, "query.js"),
      [
        "export async function runQueryCommand(args) {",
        "  const [command] = args;",
        "  process.stdout.write(JSON.stringify({",
        "    ok: true,",
        "    command,",
        "    input: { args, root: process.env.CORTEX_PROJECT_ROOT },",
        "    context_source: 'fixture',",
        "    data: { results: [] },",
        "  }) + '\\n');",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    for (const args of [
      ["search", "rule.source_of_truth", "--json"],
      ["related", "file:bin/cortex.mjs", "--depth", "2", "--json"],
      ["impact", "file:bin/cortex.mjs", "--json"],
      ["rules", "--json"],
      ["explain", "file:bin/cortex.mjs", "--json"],
      ["pattern-evidence", "bin/cortex.mjs", "--top-k", "2", "--json"],
    ]) {
      const result = spawnSync(
        process.execPath,
        [CLI_PATH, ...args],
        { cwd: repoRoot, encoding: "utf8", env: isolatedEnv(repoRoot) },
      );

      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.command, args[0]);
      assert.deepEqual(parsed.input.args, args);
      assert.equal(fs.realpathSync(parsed.input.root), fs.realpathSync(repoRoot));
      assert.equal(parsed.context_source, "fixture");
      assert.ok(Array.isArray(parsed.data.results));
    }
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("top-level query shim preserves JSON error status and stdout ownership", () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-query-cli-error-"));
  try {
    const runtimeDir = path.join(repoRoot, ".context", "mcp");
    const cliDir = path.join(runtimeDir, "dist", "cli");
    fs.mkdirSync(cliDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, "package.json"), JSON.stringify({ type: "module" }), "utf8");
    fs.writeFileSync(
      path.join(cliDir, "query.js"),
      [
        "export async function runQueryCommand(args) {",
        "  process.stdout.write(JSON.stringify({",
        "    ok: false,",
        "    command: args[0],",
        "    error: { code: 'INVALID_ARGS', message: 'fixture validation error' },",
        "  }) + '\\n');",
        "  process.exitCode = 1;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [CLI_PATH, "impact", "--json"],
      { cwd: repoRoot, encoding: "utf8", env: isolatedEnv(repoRoot) },
    );

    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: false,
      command: "impact",
      error: {
        code: "INVALID_ARGS",
        message: "fixture validation error",
      },
    });
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
