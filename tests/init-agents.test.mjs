import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { renderBootstrap } from "../plugins/cortex/hooks/session-start.mjs";

const CLI_PATH = fileURLToPath(new URL("../bin/cortex.mjs", import.meta.url));

function makeRepo(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runInit(targetDir, extraArgs = [], options = {}) {
  const result = spawnSync(
    process.execPath,
    [CLI_PATH, "init", targetDir, ...extraArgs, "--no-watch"],
    { encoding: "utf8", ...options },
  );

  if (result.status !== 0) {
    throw new Error(
      `cortex init failed with code ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result;
}

test("cortex init scaffolds AGENTS.md for Codex-compatible repos", () => {
  const repoRoot = makeRepo("cortex-init-agents-");

  try {
    runInit(repoRoot, ["--no-connect"]);

    const agentsPath = path.join(repoRoot, "AGENTS.md");
    const contents = fs.readFileSync(agentsPath, "utf8");

    assert.match(contents, /## Required: Always use Cortex context/);
    assert.match(contents, /<!-- cortex:auto:start -->[\s\S]*Run `cortex update`/);
    assert.match(contents, /using-cortex/);
    assert.match(contents, /cortex search "<query>" --json/);
    assert.match(contents, /cortex pattern-evidence/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("AGENTS.md section covers every command in the session bootstrap hook", () => {
  const nowMs = Date.now();
  const bootstrap = renderBootstrap({ indexed: true, last_update_ms: nowMs }, nowMs);
  const commands = bootstrap.match(/`cortex [^`]+`/g) ?? [];
  assert.ok(commands.length >= 3, "bootstrap must name concrete cortex commands");

  const repoRoot = makeRepo("cortex-init-agents-parity-");
  try {
    runInit(repoRoot, ["--no-connect"]);
    const contents = fs.readFileSync(path.join(repoRoot, "AGENTS.md"), "utf8");
    for (const command of commands) {
      assert.ok(contents.includes(command), `${command} missing from the AGENTS.md section`);
    }
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

    runInit(repoRoot, ["--no-connect"]);

    const contents = fs.readFileSync(agentsPath, "utf8");

    assert.match(contents, /# Project Agent Rules/);
    assert.match(contents, /Keep changes minimal\./);
    assert.equal((contents.match(/<!-- cortex:auto:start -->/g) ?? []).length, 1);
    assert.match(contents, /Run `cortex update` before completing substantial code changes\./);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("cortex init installs Cortex scripts under .context without touching project scripts", () => {
  const repoRoot = makeRepo("cortex-init-script-layout-");
  const projectScripts = path.join(repoRoot, "scripts");
  const projectScript = path.join(projectScripts, "build.sh");

  try {
    fs.mkdirSync(projectScripts, { recursive: true });
    fs.writeFileSync(projectScript, "#!/usr/bin/env bash\necho project build\n", "utf8");

    runInit(repoRoot, ["--no-connect"]);

    assert.equal(fs.readFileSync(projectScript, "utf8"), "#!/usr/bin/env bash\necho project build\n");
    assert.equal(fs.existsSync(path.join(repoRoot, ".context", "scripts", "context.sh")), true);
    assert.equal(fs.existsSync(path.join(projectScripts, "context.sh")), false);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("cortex init cleans up legacy Cortex root scripts but keeps project scripts", () => {
  const repoRoot = makeRepo("cortex-init-legacy-script-cleanup-");
  const projectScripts = path.join(repoRoot, "scripts");

  try {
    fs.mkdirSync(projectScripts, { recursive: true });
    fs.writeFileSync(path.join(projectScripts, "build.sh"), "#!/usr/bin/env bash\necho project build\n", "utf8");
    fs.writeFileSync(
      path.join(projectScripts, "context.sh"),
      "case \"$1\" in\n  bootstrap)\n    ;;\n  graph-load)\n    ;;\n  memory-lint)\n    ;;\nesac\n",
      "utf8",
    );
    fs.mkdirSync(path.join(projectScripts, "parsers"), { recursive: true });
    fs.writeFileSync(path.join(projectScripts, "parsers", "package.json"), "{}\n", "utf8");

    runInit(repoRoot, ["--no-connect"]);

    assert.equal(fs.existsSync(path.join(repoRoot, ".context", "scripts", "context.sh")), true);
    assert.equal(fs.existsSync(path.join(projectScripts, "context.sh")), false);
    assert.equal(fs.existsSync(path.join(projectScripts, "parsers")), false);
    assert.equal(fs.existsSync(path.join(projectScripts, "build.sh")), true);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("cortex init skips MCP client registration by default", () => {
  const repoRoot = makeRepo("cortex-init-connect-default-");

  try {
    const result = runInit(repoRoot);

    assert.match(result.stdout, /MCP connect skipped/);
    assert.doesNotMatch(result.stdout, /MCP connect: Codex \+ Claude Code/);
    assert.equal(fs.existsSync(path.join(repoRoot, ".context", "mcp", "package.json")), true);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("cortex init --connect keeps MCP client registration as an explicit compatibility path", () => {
  const repoRoot = makeRepo("cortex-init-connect-explicit-");
  const fakeBin = makeRepo("cortex-empty-path-");

  try {
    const result = runInit(repoRoot, ["--connect"], {
      env: {
        ...process.env,
        PATH: fakeBin,
      },
    });

    assert.match(result.stdout, /MCP connect: Codex \+ Claude Code/);
    assert.match(result.stdout, /codex CLI not found, skipping Codex MCP registration/);
    assert.match(result.stdout, /claude CLI not found, skipping Claude Code MCP registration/);
    assert.match(result.stdout, /no MCP clients connected/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(fakeBin, { recursive: true, force: true });
  }
});
