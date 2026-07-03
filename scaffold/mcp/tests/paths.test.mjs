import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("paths resolve the project root from cwd without duplicating .context", () => {
  const projectRoot = mkdtempSync(path.join(tmpdir(), "cortex-paths-"));
  const contextDir = path.join(projectRoot, ".context");
  const mcpDir = path.join(contextDir, "mcp");
  const pathsModuleUrl = pathToFileURL(path.resolve(__dirname, "..", "dist", "paths.js")).href;

  mkdirSync(mcpDir, { recursive: true });
  writeFileSync(path.join(contextDir, "config.yaml"), "source_paths:\n  - src\n");

  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { REPO_ROOT, CONTEXT_DIR, CACHE_DIR, DEFAULT_RANKING } from ${JSON.stringify(pathsModuleUrl)}; console.log(JSON.stringify({ REPO_ROOT, CONTEXT_DIR, CACHE_DIR, DEFAULT_RANKING }));`
    ],
    {
      cwd: mcpDir,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr);

  const parsed = JSON.parse(result.stdout.trim());
  const resolvedProjectRoot = realpathSync(projectRoot);
  assert.equal(parsed.REPO_ROOT, resolvedProjectRoot);
  assert.equal(parsed.CONTEXT_DIR, path.join(resolvedProjectRoot, ".context"));
  assert.equal(parsed.CACHE_DIR, path.join(resolvedProjectRoot, ".context", "cache"));
  assert.deepEqual(parsed.DEFAULT_RANKING, {
    semantic: 0.4,
    graph: 0.25,
    trust: 0.2,
    recency: 0.15
  });
});
