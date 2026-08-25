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
      ["conventions", "bin/cortex.mjs", "--json"],
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

test("conventions root shim sanitizes missing and broken runtime loader failures", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-query-loader-"));
  const secret = "loader-secret-do-not-expose";
  const controlRoot = path.join(sandbox, `project-${secret}-\n\u001b[31m`);
  fs.mkdirSync(controlRoot);
  const stateRoot = path.join(controlRoot, ".context", "cache", "conventions");

  try {
    for (const mode of ["missing", "broken"]) {
      const runtimeDir = path.join(controlRoot, ".context", "mcp");
      fs.rmSync(runtimeDir, { recursive: true, force: true });
      if (mode === "broken") {
        const cliDir = path.join(runtimeDir, "dist", "cli");
        fs.mkdirSync(cliDir, { recursive: true });
        fs.writeFileSync(path.join(runtimeDir, "package.json"), JSON.stringify({ type: "module" }), "utf8");
        fs.writeFileSync(
          path.join(cliDir, "query.js"),
          `throw new Error(${JSON.stringify(`${secret}\n\u001b[31m raw import failure`)});\n`,
          "utf8",
        );
      }

      const requestedTarget = mode === "missing"
        ? "bin/cortex.mjs"
        : `target-${secret}-\n`;
      const publicTarget = mode === "missing" ? requestedTarget : "[rejected]";

      const json = spawnSync(
        process.execPath,
        [CLI_PATH, "conventions", "--target", requestedTarget, "--json"],
        { cwd: controlRoot, encoding: "utf8", env: isolatedEnv(controlRoot) },
      );
      assert.equal(json.status, 1);
      assert.equal(json.stderr, "");
      assert.deepEqual(JSON.parse(json.stdout), {
        ok: false,
        command: "conventions",
        input: { target: publicTarget },
        error: {
          code: "INVALID_ARGS",
          message: "Convention inspection failed safely",
        },
      });
      assert.equal(json.stdout, `${JSON.stringify(JSON.parse(json.stdout), null, 2)}\n`);
      assert.equal(json.stdout.includes(secret), false);
      assert.equal(/[\u0000-\u0009\u000b-\u001f\u007f]/u.test(json.stdout), false);
      assert.ok(Buffer.byteLength(json.stdout) < 1024);

      const text = spawnSync(
        process.execPath,
        [CLI_PATH, "conventions", "--target", requestedTarget],
        { cwd: controlRoot, encoding: "utf8", env: isolatedEnv(controlRoot) },
      );
      assert.equal(text.status, 1);
      assert.equal(text.stdout, "");
      assert.match(text.stderr, /Convention inspection failed safely/u);
      assert.equal(text.stderr.includes(secret), false);
      assert.equal(text.stderr.includes(controlRoot), false);
      assert.equal(text.stderr.includes("raw import failure"), false);
      assert.equal(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text.stderr), false);
      assert.ok(Buffer.byteLength(text.stderr) < 1024);
      assert.equal(fs.existsSync(stateRoot), false);
    }
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test("non-conventions query commands preserve root runtime loader failures", () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-query-loader-other-"));
  try {
    const result = spawnSync(
      process.execPath,
      [CLI_PATH, "search", "fixture", "--json"],
      { cwd: repoRoot, encoding: "utf8", env: isolatedEnv(repoRoot) },
    );

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Build the project's context runtime first \(missing /u);
    assert.match(result.stderr, /Run 'cortex bootstrap' in the project root/u);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
