import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parseWorkflowAnalysisArgs as parseRootArgs } from "../bin/cli/workflow-command.mjs";
import { parseWorkflowAnalysisArgs as parseRuntimeArgs } from "../scaffold/mcp/dist/cli/workflow-analysis.js";
import { REGISTERED_PREDICATES } from "../scaffold/mcp/dist/core/analysis-state/engine.js";

const CLI = fileURLToPath(new URL("../bin/cortex.mjs", import.meta.url));
const FACT_ID = `fact:${"a".repeat(64)}`;

function environment(root) {
  const taskHome = path.join(root, ".home");
  fs.mkdirSync(taskHome, { recursive: true });
  const env = { ...process.env, HOME: taskHome, XDG_CONFIG_HOME: path.join(taskHome, ".config") };
  for (const key of ["CORTEX_AUTO_BOOTSTRAP_ON_MCP", "CORTEX_AUTO_MIGRATE", "CORTEX_DAEMON_SOCKET_PATH", "CORTEX_PROJECT_ROOT"]) delete env[key];
  return env;
}

function run(root, args) {
  return spawnSync(process.execPath, [CLI, "workflow", ...args], {
    cwd: root,
    encoding: "utf8",
    env: environment(root),
  });
}

function runtime(root, source) {
  const runtimeRoot = path.join(root, ".context", "mcp");
  fs.mkdirSync(path.join(runtimeRoot, "dist", "cli"), { recursive: true });
  fs.writeFileSync(path.join(runtimeRoot, "package.json"), JSON.stringify({ type: "module" }));
  fs.writeFileSync(path.join(runtimeRoot, "dist", "cli", "workflow-analysis.js"), source);
}

test("workflow root and runtime parsers accept the same closed grammar", () => {
  const valid = [
    ["state", "wo058-test"],
    ["state", "wo058-test", "--json"],
    ["why", "wo058-test", FACT_ID, "--json"],
    ["why-not", "wo058-test", "accepted", "--json"],
    ["changes", "wo058-test", "--since", "0", "--json"],
    ["--json", "changes", "wo058-test", "--since", "12"],
  ];
  for (const args of valid) assert.deepEqual(parseRootArgs(args), parseRuntimeArgs(args), args.join(" "));
  for (const predicate of REGISTERED_PREDICATES) {
    const args = ["why-not", "wo058-test", predicate, "--json"];
    assert.deepEqual(parseRootArgs(args), parseRuntimeArgs(args), predicate);
  }

  const invalid = [
    [], ["state"], ["state", "WO-TEST"], ["state", "../escape"],
    ["state", "wo058-test", "extra"], ["state", "wo058-test", "--json", "--json"],
    ["why", "wo058-test", "fact:bad"], ["why-not", "wo058-test", "unknown"],
    ["changes", "wo058-test", "0"], ["changes", "wo058-test", "--since", "-1"],
    ["changes", "wo058-test", "--since", "1.5"], ["state", "wo058-\u202etest"],
    ["state", `w${"o".repeat(1_100)}`], ["state", "wo058-test", "--unknown"],
  ];
  for (const args of invalid) {
    assert.throws(() => parseRootArgs(args), args.join(" "));
    assert.throws(() => parseRuntimeArgs(args), args.join(" "));
  }
});

test("workflow preflight rejects malformed forms before runtime import", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-workflow-preflight-")));
  const sentinel = path.join(root, "runtime-imported");
  try {
    runtime(root, `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(sentinel)}, "bad"); export async function runWorkflowAnalysisCommand() {}`);
    for (const args of [[], ["state"], ["state", "../escape", "--json"], ["why", "wo058-test", "bad", "--json"], ["why-not", "wo058-test", "unknown", "--json"], ["changes", "wo058-test", "--since", "-1", "--json"]]) {
      const result = run(root, args);
      assert.equal(result.status, 1, result.stderr);
      assert.equal(fs.existsSync(sentinel), false);
      if (args.includes("--json")) {
        assert.equal(result.stderr, "");
        const parsed = JSON.parse(result.stdout);
        assert.equal(parsed.error.code, "INVALID_ARGS");
        assert.equal(parsed.generator_version, "maintained-analysis-cli-v1");
      } else {
        assert.match(result.stderr, /Workflow analysis arguments are invalid/u);
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow shim forwards exact valid arguments and sanitizes runtime failures", () => {
  const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-workflow-loader-")));
  try {
    const valid = path.join(sandbox, "valid");
    fs.mkdirSync(valid);
    runtime(valid, "export async function runWorkflowAnalysisCommand(args) { process.stdout.write(JSON.stringify({ok:true,command:'workflow',args}) + '\\n'); }");
    for (const args of [["state", "wo058-test"], ["why", "wo058-test", FACT_ID, "--json"], ["why-not", "wo058-test", "accepted", "--json"], ["changes", "wo058-test", "--since", "0", "--json"]]) {
      const result = run(valid, args);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout).args, args);
    }

    for (const mode of ["missing", "broken"]) {
      const root = path.join(sandbox, `${mode}-private-\n\u001b[31m`);
      fs.mkdirSync(root);
      if (mode === "broken") runtime(root, "export async function runWorkflowAnalysisCommand() { throw new Error('private runtime secret'); }");
      const json = run(root, ["state", "wo058-test", "--json"]);
      assert.equal(json.status, 1);
      assert.equal(json.stderr, "");
      const parsed = JSON.parse(json.stdout);
      assert.equal(parsed.error.code, "RUNTIME_UNAVAILABLE");
      assert.equal(parsed.error.message, "Workflow analysis runtime is unavailable");
      assert.doesNotMatch(json.stdout, /private|secret|tmp/u);
      const text = run(root, ["state", "wo058-test"]);
      assert.equal(text.status, 1);
      assert.match(text.stderr, /Workflow analysis runtime is unavailable/u);
      assert.doesNotMatch(text.stderr, /private runtime secret/u);
      assert.equal(fs.existsSync(path.join(root, ".context", "cache")), false);
    }
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});
