import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI_PATH = fileURLToPath(new URL("../bin/cortex.mjs", import.meta.url));

function makeRepo(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runInit(targetDir) {
  const result = spawnSync(
    process.execPath,
    [CLI_PATH, "init", targetDir, "--no-connect", "--no-watch"],
    { encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(
      `cortex init failed with code ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
}

test("cortex init scaffolds AGENTS.md for Codex-compatible repos", () => {
  const repoRoot = makeRepo("cortex-init-agents-");

  try {
    runInit(repoRoot);

    const agentsPath = path.join(repoRoot, "AGENTS.md");
    const contents = fs.readFileSync(agentsPath, "utf8");

    assert.match(contents, /## Required: Always use Cortex MCP tools/);
    assert.match(contents, /<!-- cortex:auto:start -->[\s\S]*Run `cortex update`/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("cortex init preserves existing AGENTS.md content while ensuring the Cortex block exists", () => {
  const repoRoot = makeRepo("cortex-init-agents-existing-");
  const agentsPath = path.join(repoRoot, "AGENTS.md");

  try {
    fs.writeFileSync(
      agentsPath,
      "# Project Agent Rules\n\n- Keep changes minimal.\n",
      "utf8",
    );

    runInit(repoRoot);

    const contents = fs.readFileSync(agentsPath, "utf8");

    assert.match(contents, /# Project Agent Rules/);
    assert.match(contents, /Keep changes minimal\./);
    assert.equal((contents.match(/<!-- cortex:auto:start -->/g) ?? []).length, 1);
    assert.match(contents, /Run `cortex update` before completing substantial code changes\./);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
