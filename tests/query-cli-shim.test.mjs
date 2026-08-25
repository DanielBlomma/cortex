import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateGuidanceTargetSyntax } from "../scaffold/mcp/dist/guidance.js";

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
      ["guidance", "bin/cortex.mjs", "--task", "add query routing", "--json"],
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

test("guidance root shim sanitizes missing and broken runtime loader failures", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-guidance-loader-"));
  const secret = "guidance-loader-secret-do-not-expose";
  const controlRoot = path.join(sandbox, `project-${secret}-\n\u001b[31m`);
  fs.mkdirSync(controlRoot);
  try {
    for (const mode of ["missing", "broken"]) {
      const runtimeDir = path.join(controlRoot, ".context", "mcp");
      fs.rmSync(runtimeDir, { recursive: true, force: true });
      if (mode === "broken") {
        const cliDir = path.join(runtimeDir, "dist", "cli");
        fs.mkdirSync(cliDir, { recursive: true });
        fs.writeFileSync(path.join(runtimeDir, "package.json"), JSON.stringify({ type: "module" }), "utf8");
        fs.writeFileSync(path.join(cliDir, "query.js"), `throw new Error(${JSON.stringify(`${secret}\n raw import failure`)});\n`, "utf8");
      }
      const task = mode === "missing" ? "add safe loader handling" : `${secret}\nunsafe`;
      const json = spawnSync(
        process.execPath,
        [CLI_PATH, "guidance", "bin/cortex.mjs", "--task", task, "--json"],
        { cwd: controlRoot, encoding: "utf8", env: isolatedEnv(controlRoot) },
      );
      assert.equal(json.status, 1);
      assert.equal(json.stderr, "");
      const parsed = JSON.parse(json.stdout);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.command, "guidance");
      assert.equal(parsed.schema_version, 1);
      assert.equal(parsed.generator_version, "repo-guidance-v1");
      assert.equal(json.stdout.includes(secret), false);
      assert.equal(json.stdout.includes("raw import failure"), false);
      assert.ok(Buffer.byteLength(json.stdout) < 1_024);

      const text = spawnSync(
        process.execPath,
        [CLI_PATH, "guidance", "bin/cortex.mjs", "--task", task],
        { cwd: controlRoot, encoding: "utf8", env: isolatedEnv(controlRoot) },
      );
      assert.equal(text.status, 1);
      assert.equal(text.stdout, "");
      assert.match(text.stderr, /Guidance failed safely/u);
      assert.equal(text.stderr.includes(secret), false);
      assert.equal(text.stderr.includes(controlRoot), false);
    }
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test("guidance root shim rejects strict flags and malformed targets before runtime or state reads", () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-guidance-preflight-"));
  const secret = "root-preflight-secret";
  try {
    const stateRoot = path.join(repoRoot, ".context");
    for (const args of [
      ["guidance", "--target", "bin/cortex.mjs", "--task", secret, "--json"],
      ["guidance", "bin/cortex.mjs", "--target", "README.md", "--task", secret, "--json"],
      ["guidance", "file:/private/secret.ts", "--task", secret, "--json"],
      ["guidance", "chunk:../secret.ts:name:1-2", "--task", secret, "--json"],
      ["guidance", "chunk:src/x.ts:name:2-1", "--task", secret, "--json"],
      ["guidance", "chunk:src/x.ts::1-2", "--task", secret, "--json"],
      ["guidance", "src//x.ts", "--task", secret, "--json"],
    ]) {
      const result = spawnSync(process.execPath, [CLI_PATH, ...args], { cwd: repoRoot, encoding: "utf8", env: isolatedEnv(repoRoot) });
      assert.equal(result.status, 1, args.join(" "));
      assert.equal(result.stderr, "");
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.input.target, "[rejected]");
      assert.ok(parsed.input.task_hash === "[rejected]" || /^[a-f0-9]{64}$/u.test(parsed.input.task_hash));
      assert.equal(result.stdout.includes(secret), false);
      assert.equal(fs.existsSync(stateRoot), false);
    }
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("guidance root preflight and runtime classifier share the full target grammar matrix", () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-guidance-target-differential-"));
  const runtimeDir = path.join(repoRoot, ".context", "mcp");
  const cliDir = path.join(runtimeDir, "dist", "cli");
  fs.mkdirSync(cliDir, { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, "package.json"), JSON.stringify({ type: "module" }), "utf8");
  fs.writeFileSync(path.join(cliDir, "query.js"), "export async function runQueryCommand() { process.stdout.write('runtime-accepted\\n'); }\n", "utf8");
  const valid = [
    "src/x.ts", "file:src/x.ts", "chunk:src/x.ts:name:1-2", "module:src", "module:.",
    "project:src/app.csproj", "project:.", "rule.alpha", "rule:alpha", "adr.alpha", "adr:alpha",
  ];
  const invalid = [
    "", "/src/x.ts", "C:/src/x.ts", "C:\\src\\x.ts", "../x.ts", "./src/x.ts", "src/./x.ts",
    "src/../x.ts", "src//x.ts", "src/x.ts/", "file:", "file:/src/x.ts", "file:src//x.ts",
    "module:", "project:", "rule:", "rule.", "adr:", "adr.", "unknown:value",
    "chunk:/src/x.ts:name:1-2", "chunk:src/x.ts::1-2", "chunk:src/x.ts:name:0-2",
    "chunk:src/x.ts:name:2-1", "chunk:src/x.ts:name:01-2", "chunk:src/x.ts:name:1-2-extra",
  ];
  try {
    for (const target of valid) {
      assert.doesNotThrow(() => validateGuidanceTargetSyntax(target), target);
      const result = spawnSync(process.execPath, [CLI_PATH, "guidance", target, "--task", "safe task"], {
        cwd: repoRoot, encoding: "utf8", env: isolatedEnv(repoRoot),
      });
      assert.equal(result.status, 0, target);
      assert.equal(result.stdout, "runtime-accepted\n");
    }
    for (const target of invalid) {
      assert.throws(() => validateGuidanceTargetSyntax(target), undefined, target);
      const result = spawnSync(process.execPath, [CLI_PATH, "guidance", target, "--task", "safe task", "--json"], {
        cwd: repoRoot, encoding: "utf8", env: isolatedEnv(repoRoot),
      });
      assert.equal(result.status, 1, target);
      assert.equal(result.stderr, "", target);
      assert.equal(JSON.parse(result.stdout).input.target, "[rejected]", target);
    }
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("empty-name chunk is rejected before missing, broken, or import-capable runtime access", () => {
  const target = "chunk:src/x.ts::1-2";
  for (const mode of ["missing", "broken", "import-capable"]) {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `cortex-guidance-empty-chunk-${mode}-`));
    const sentinel = path.join(repoRoot, "runtime-imported.sentinel");
    try {
      if (mode !== "missing") {
        const runtimeDir = path.join(repoRoot, ".context", "mcp");
        const cliDir = path.join(runtimeDir, "dist", "cli");
        fs.mkdirSync(cliDir, { recursive: true });
        fs.writeFileSync(path.join(runtimeDir, "package.json"), JSON.stringify({ type: "module" }), "utf8");
        fs.writeFileSync(path.join(cliDir, "query.js"), [
          "import fs from 'node:fs';",
          `fs.writeFileSync(${JSON.stringify(sentinel)}, 'imported');`,
          mode === "broken" ? "throw new Error('private broken runtime detail');" : "export async function runQueryCommand() {}",
          "",
        ].join("\n"), "utf8");
      }
      for (const json of [false, true]) {
        const result = spawnSync(process.execPath, [CLI_PATH, "guidance", target, "--task", "safe task", ...(json ? ["--json"] : [])], {
          cwd: repoRoot, encoding: "utf8", env: isolatedEnv(repoRoot),
        });
        assert.equal(result.status, 1, `${mode}/${json}`);
        assert.equal(fs.existsSync(sentinel), false, `${mode}/${json}`);
        if (json) {
          assert.equal(result.stderr, "");
          assert.equal(JSON.parse(result.stdout).input.target, "[rejected]");
        } else {
          assert.equal(result.stdout, "");
          assert.match(result.stderr, /Guidance failed safely/u);
          assert.equal(result.stderr.includes("private broken runtime detail"), false);
        }
      }
      if (mode === "missing") assert.equal(fs.existsSync(path.join(repoRoot, ".context")), false);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  }
});
