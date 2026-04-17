import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

const FORBIDDEN_PATTERNS = [
  /(?<!scaffold\/)scripts\/parsers\//,
  /(?<!scaffold\/)scripts\/ingest\.mjs/
];

const SEARCH_DIRS = ["tests", "benchmark", "scripts", ".github", ".githooks"];
const SEARCH_EXTS = new Set([".mjs", ".js", ".cjs", ".sh", ".yml", ".yaml"]);
const EXEMPT_FILES = new Set([
  path.join(__dirname, "no-legacy-paths.test.mjs"),
  // context-regressions writes its own scripts/ingest.mjs INSIDE temp fixtures.
  // The string literal refers to fixture-local paths, not cortex's deleted files.
  path.join(__dirname, "context-regressions.test.mjs")
]);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".npm-cache")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (SEARCH_EXTS.has(path.extname(entry.name)) && !EXEMPT_FILES.has(full)) out.push(full);
  }
  return out;
}

test("no references to deleted scripts/parsers or scripts/ingest.mjs paths", () => {
  const violations = [];
  for (const dir of SEARCH_DIRS) {
    const absDir = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(absDir)) continue;
    for (const file of walk(absDir)) {
      const content = fs.readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN_PATTERNS) {
        const match = content.match(pattern);
        if (match) {
          violations.push(`${path.relative(REPO_ROOT, file)}: matches ${pattern}`);
        }
      }
    }
  }
  assert.deepEqual(violations, [], `Legacy path references found:\n${violations.join("\n")}`);
});
