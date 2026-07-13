import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI_PATH = fileURLToPath(new URL("../bin/cortex.mjs", import.meta.url));

test("top-level query commands dispatch to the project query CLI runtime", () => {
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
        "  process.stdout.write(JSON.stringify({ args, root: process.env.CORTEX_PROJECT_ROOT }) + '\\n');",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [CLI_PATH, "search", "rule.source_of_truth", "--json"],
      { cwd: repoRoot, encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(parsed.args, ["search", "rule.source_of_truth", "--json"]);
    assert.equal(fs.realpathSync(parsed.root), fs.realpathSync(repoRoot));

    const patternResult = spawnSync(
      process.execPath,
      [CLI_PATH, "pattern-evidence", "bin/cortex.mjs", "--json"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    assert.equal(patternResult.status, 0, patternResult.stderr);
    const patternParsed = JSON.parse(patternResult.stdout);
    assert.deepEqual(patternParsed.args, ["pattern-evidence", "bin/cortex.mjs", "--json"]);
    assert.equal(fs.realpathSync(patternParsed.root), fs.realpathSync(repoRoot));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
