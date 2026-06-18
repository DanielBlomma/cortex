import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isScaffoldOutOfDate } from "../bin/cortex.mjs";

const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const NEW_CONTEXT_SH = `#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
COMMAND="\${1:-help}"
case "$COMMAND" in
  bootstrap)
    "$SCRIPT_DIR/bootstrap.sh" "$@"
    ;;
  doctor)
    "$SCRIPT_DIR/doctor.sh"
    ;;
  *)
    echo "Unknown command"
    exit 1
    ;;
esac
`;

const OLD_CONTEXT_SH = `#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
COMMAND="\${1:-help}"
case "$COMMAND" in
  bootstrap)
    "$SCRIPT_DIR/bootstrap.sh" "$@"
    ;;
  *)
    echo "Unknown command"
    exit 1
    ;;
esac
`;

function makeTempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-scaffold-test-"));
  fs.mkdirSync(path.join(root, ".context", "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, ".context", "mcp"), { recursive: true });
  return root;
}

function writeUpToDate(root) {
  fs.writeFileSync(path.join(root, ".context", "scripts", "context.sh"), NEW_CONTEXT_SH);
  fs.writeFileSync(path.join(root, ".context", "scripts", "doctor.sh"), "#!/usr/bin/env bash\necho ok\n");
  fs.writeFileSync(path.join(root, ".context", "mcp", "package.json"), "{}");
}

test("returns false when context.sh does not exist (not initialized)", () => {
  const root = makeTempProject();
  assert.equal(isScaffoldOutOfDate(root), false);
});

test("returns true when .context/scripts/doctor.sh is missing", () => {
  const root = makeTempProject();
  writeUpToDate(root);
  fs.rmSync(path.join(root, ".context", "scripts", "doctor.sh"));
  assert.equal(isScaffoldOutOfDate(root), true);
});

test("returns true when .context/mcp/package.json is missing", () => {
  const root = makeTempProject();
  writeUpToDate(root);
  fs.rmSync(path.join(root, ".context", "mcp", "package.json"));
  assert.equal(isScaffoldOutOfDate(root), true);
});

test("returns true when context.sh lacks a doctor subcommand case", () => {
  const root = makeTempProject();
  writeUpToDate(root);
  fs.writeFileSync(path.join(root, ".context", "scripts", "context.sh"), OLD_CONTEXT_SH);
  assert.equal(isScaffoldOutOfDate(root), true);
});

test("returns false when scaffold is fully up to date", () => {
  const root = makeTempProject();
  writeUpToDate(root);
  assert.equal(isScaffoldOutOfDate(root), false);
});

test("returns true when only legacy root scripts/context.sh exists", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-scaffold-legacy-"));
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "context.sh"), NEW_CONTEXT_SH);
  assert.equal(isScaffoldOutOfDate(root), true);
});

test("runtime naming keeps .context/mcp as the compatibility path", () => {
  const cli = fs.readFileSync(path.join(PROJECT_ROOT, "bin", "cortex.mjs"), "utf8");
  const bootstrap = fs.readFileSync(path.join(PROJECT_ROOT, "scaffold", "scripts", "bootstrap.sh"), "utf8");
  const embed = fs.readFileSync(path.join(PROJECT_ROOT, "scaffold", "scripts", "embed.sh"), "utf8");
  const graphLoad = fs.readFileSync(path.join(PROJECT_ROOT, "scaffold", "scripts", "load-ryu.sh"), "utf8");
  const doctor = fs.readFileSync(path.join(PROJECT_ROOT, "scaffold", "scripts", "doctor.sh"), "utf8");
  const rootBootstrap = fs.readFileSync(path.join(PROJECT_ROOT, "scripts", "bootstrap.sh"), "utf8");

  assert.match(cli, /const CONTEXT_RUNTIME_REL = MCP_PROJECT_REL;/);
  assert.match(cli, /function resolveProjectRuntimeDist\(\)/);
  assert.match(bootstrap, /CONTEXT_RUNTIME_DIR="\$REPO_ROOT\/\.context\/mcp"/);
  assert.match(embed, /CONTEXT_RUNTIME_DIR="\$REPO_ROOT\/\.context\/mcp"/);
  assert.match(graphLoad, /CONTEXT_RUNTIME_DIR="\$REPO_ROOT\/\.context\/mcp"/);
  assert.match(doctor, /CONTEXT_RUNTIME_DIR="\$CONTEXT_DIR\/mcp"/);
  assert.match(bootstrap, /MCP_DIR="\$CONTEXT_RUNTIME_DIR"/);
  assert.match(rootBootstrap, /CONTEXT_RUNTIME_DIR="\$REPO_ROOT\/\.context\/mcp"/);
  assert.match(rootBootstrap, /MCP_DIR="\$CONTEXT_RUNTIME_DIR"/);
});

test("memory scripts import shared helpers through the context runtime dist", () => {
  const memoryCompile = fs.readFileSync(path.join(PROJECT_ROOT, "scaffold", "scripts", "memory-compile.mjs"), "utf8");
  const memoryLint = fs.readFileSync(path.join(PROJECT_ROOT, "scaffold", "scripts", "memory-lint.mjs"), "utf8");
  const rootMemoryCompile = fs.readFileSync(path.join(PROJECT_ROOT, "scripts", "memory-compile.mjs"), "utf8");

  assert.match(memoryCompile, /const CONTEXT_RUNTIME_DIST = path\.resolve\(__dirname, "\.\.\/mcp\/dist"\);/);
  assert.match(memoryCompile, /pathToFileURL\(path\.join\(CONTEXT_RUNTIME_DIST, "frontmatter\.js"\)\)\.href/);
  assert.match(memoryLint, /const CONTEXT_RUNTIME_DIST = path\.resolve\(__dirname, "\.\.\/mcp\/dist"\);/);
  assert.match(memoryLint, /pathToFileURL\(path\.join\(CONTEXT_RUNTIME_DIST, "frontmatter\.js"\)\)\.href/);
  assert.match(rootMemoryCompile, /const CONTEXT_RUNTIME_DIST = path\.resolve\(__dirname, "\.\.\/\.context\/mcp\/dist"\);/);
});
