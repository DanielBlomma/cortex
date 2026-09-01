import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseReviewArgs } from "../scaffold/mcp/dist/cli/query.js";

const CLI = fileURLToPath(new URL("../bin/cortex.mjs", import.meta.url));

function environment(root) {
  const home = path.join(root, ".home");
  fs.mkdirSync(home, { recursive: true });
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, ".config") };
  for (const key of ["CORTEX_AUTO_BOOTSTRAP_ON_MCP", "CORTEX_AUTO_MIGRATE", "CORTEX_DAEMON_SOCKET_PATH", "CORTEX_PROJECT_ROOT"]) delete env[key];
  return env;
}

function run(root, args) {
  return spawnSync(process.execPath, [CLI, "review", ...args], { cwd: root, encoding: "utf8", env: environment(root) });
}

function runtime(root, source) {
  const runtimeRoot = path.join(root, ".context", "mcp");
  fs.mkdirSync(path.join(runtimeRoot, "dist", "cli"), { recursive: true });
  fs.writeFileSync(path.join(runtimeRoot, "package.json"), JSON.stringify({ type: "module" }));
  fs.writeFileSync(path.join(runtimeRoot, "dist", "cli", "query.js"), source);
}

test("review root and runtime parsers accept only one --diff and optional one --json", () => {
  assert.deepEqual(parseReviewArgs(["--diff"]), { input: { diff: true }, json: false });
  assert.deepEqual(parseReviewArgs(["--json", "--diff"]), { input: { diff: true }, json: true });
  for (const args of [[], ["--json"], ["target"], ["--diff", "target"], ["--diff", "--diff"], ["--diff", "--json", "--json"], ["--diff", "--unknown"]]) assert.throws(() => parseReviewArgs(args));
});

test("review root preflight rejects malformed forms before runtime import or repository reads", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-review-preflight-"));
  const sentinel = path.join(root, "runtime-imported");
  try {
    runtime(root, `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(sentinel)}, "bad"); export async function runQueryCommand() {}`);
    for (const args of [[], ["--json"], ["target", "--json"], ["--diff", "target", "--json"], ["--diff", "--diff", "--json"], ["--diff", "--unknown", "--json"]]) {
      const result = run(root, args);
      assert.equal(result.status, 1);
      assert.equal(fs.existsSync(sentinel), false);
      if (args.includes("--json")) {
        assert.equal(result.stderr, "");
        const parsed = JSON.parse(result.stdout);
        assert.equal(parsed.ok, false);
        assert.equal(parsed.command, "review");
        assert.equal(parsed.generator_version, "repo-diff-review-v1");
        assert.equal(parsed.error.message, "Review failed safely");
      } else {
        assert.match(result.stderr, /Review failed safely/u);
      }
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("review root shim forwards exact valid arguments and sanitizes missing or broken runtimes", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-review-loader-"));
  try {
    const valid = path.join(sandbox, "valid"); fs.mkdirSync(valid);
    runtime(valid, "export async function runQueryCommand(args) { process.stdout.write(JSON.stringify({ok:true,command:args[0],args}) + '\\n'); }");
    for (const args of [["--diff"], ["--diff", "--json"], ["--json", "--diff"]]) {
      const result = run(valid, args); assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout).args, ["review", ...args]);
    }

    for (const mode of ["missing", "broken"]) {
      const root = path.join(sandbox, `private-${mode}-\n\u001b[31m`); fs.mkdirSync(root);
      if (mode === "broken") runtime(root, "throw new Error('private loader secret');");
      const json = run(root, ["--diff", "--json"]); assert.equal(json.status, 1); assert.equal(json.stderr, "");
      const parsed = JSON.parse(json.stdout); assert.equal(parsed.error.message, "Review failed safely"); assert.doesNotMatch(json.stdout, /private|secret|tmp/u);
      const text = run(root, ["--diff"]); assert.equal(text.status, 1); assert.match(text.stderr, /Review failed safely/u); assert.doesNotMatch(text.stderr, /private loader secret/u);
      assert.equal(fs.existsSync(path.join(root, ".context", "cache")), false);
    }
  } finally { fs.rmSync(sandbox, { recursive: true, force: true }); }
});
