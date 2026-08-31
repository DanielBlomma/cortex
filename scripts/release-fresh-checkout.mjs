#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const trackedContext = new Set([
  ".context/config.yaml",
  ".context/ontology.cypher",
  ".context/rules.yaml",
  "scaffold/.context/config.yaml",
  "scaffold/.context/ontology.cypher",
  "scaffold/.context/rules.yaml",
]);

function fail(message) {
  throw new Error(`Fresh-checkout release regression failed: ${message}`);
}

function filesBelow(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.status !== 0) fail(`${command} ${args.join(" ")} exited ${result.status}`);
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

const initial = [
  ...filesBelow(path.join(root, ".context")),
  ...filesBelow(path.join(root, "scaffold", ".context")),
].sort();
const unexpected = initial.filter((file) => !trackedContext.has(file));
if (unexpected.length > 0) {
  fail(`checkout already contains generated context state: ${unexpected.join(", ")}`);
}

run(process.execPath, ["scripts/release-artifacts.mjs", "root-context"]);
const rootOutput = run("npm", ["test"]);
run(process.execPath, ["scripts/release-artifacts.mjs", "mcp-context"]);
const mcpOutput = run("npm", ["--prefix", "scaffold/mcp", "run", "test:ci"]);

if (!/81 passed, 0 failed/.test(rootOutput)) {
  fail("context regression suite did not report 81/81");
}
if (!/^# tests 417$/m.test(rootOutput)) {
  fail("root node:test suite did not report 417/417");
}
if (!/^# tests 6$/m.test(rootOutput)) {
  fail("DeepSeek Harness bundle suite did not report 6/6");
}
if (!/^ℹ tests 426$/m.test(mcpOutput)) fail("MCP compatibility suite did not report 426/426");

process.stdout.write(`${JSON.stringify({
  ok: true,
  context: "81/81",
  root: "417/417",
  deepseekHarnessBundle: "6/6",
  mcp: "426/426",
})}\n`);
