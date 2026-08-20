import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

function readJson(relative) {
  return JSON.parse(
    fs.readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8"),
  );
}

function readText(relative) {
  return fs.readFileSync(
    fileURLToPath(new URL(`../${relative}`, import.meta.url)),
    "utf8",
  );
}

const packageJson = readJson("package.json");
const version = packageJson.version;

test("claude and codex plugin manifests exist and share the release version", () => {
  const claude = readJson("plugins/cortex/.claude-plugin/plugin.json");
  const codex = readJson("plugins/cortex/.codex-plugin/plugin.json");
  assert.equal(claude.name, "cortex");
  assert.equal(codex.name, "cortex");
  assert.equal(claude.version, version);
  assert.equal(codex.version, version);
});

test("marketplace entry lists the cortex plugin at the release version", () => {
  const marketplace = readJson(".claude-plugin/marketplace.json");
  const plugin = marketplace.plugins.find((entry) => entry.name === "cortex");
  assert.ok(plugin, "marketplace must list the cortex plugin");
  assert.equal(plugin.version, version);
  assert.equal(plugin.source, "./plugins/cortex");
});

test("MCP registry submission matches the package runtime contract", () => {
  const submission = readJson("mcp-registry-submission.json");
  assert.equal(submission.npmPackage, packageJson.name);
  assert.equal(submission.requirements.node, packageJson.engines.node);
});

for (const [label, relative, rootStep] of [
  ["release bump", ".github/workflows/release-bump.yml", "Validate root tests"],
  ["release publish", ".github/workflows/release-publish.yml", "Run root tests"],
]) {
  test(`${label} builds the trusted runtime before root security tests`, () => {
    const workflow = readText(relative);
    const installIndex = workflow.indexOf(
      "- name: Install context runtime dependencies",
    );
    const buildIndex = workflow.indexOf("- name: Build trusted context runtime");
    const rootTestIndex = workflow.indexOf(`- name: ${rootStep}`);
    assert.ok(installIndex >= 0, `${label} must install MCP dependencies`);
    assert.ok(
      buildIndex > installIndex,
      `${label} trusted runtime build must follow install`,
    );
    assert.ok(
      rootTestIndex > buildIndex,
      `${label} root security tests must run after the trusted runtime build`,
    );
  });
}

test("session hook is wired for startup, resume, clear, and compact", () => {
  const hooks = readJson("plugins/cortex/hooks/hooks.json");
  const entries = hooks.hooks.SessionStart;
  assert.ok(Array.isArray(entries) && entries.length > 0);
  const matcher = entries[0].matcher;
  for (const source of ["startup", "resume", "clear", "compact"]) {
    assert.ok(matcher.includes(source), `SessionStart matcher must include ${source}`);
  }
  assert.equal(entries[0].hooks[0].type, "command");
  assert.match(entries[0].hooks[0].command, /session-start\.mjs/);
});

test("release publish rejects branch dispatches and non-semver tags before checkout", () => {
  const workflow = readText(".github/workflows/release-publish.yml");
  const guardIndex = workflow.indexOf("- name: Verify immutable release tag ref");
  const checkoutIndex = workflow.indexOf("- name: Checkout");
  assert.ok(guardIndex >= 0 && guardIndex < checkoutIndex, "release ref guard must run before checkout");
  assert.match(workflow, /GITHUB_REF_TYPE: \$\{\{ github\.ref_type \}\}/);
  assert.match(workflow, /GITHUB_REF_TYPE\}" != "tag"/);
  assert.match(workflow, /\^v\(0\|\[1-9\]\[0-9\]\*\)\\\.\(0\|\[1-9\]\[0-9\]\*\)\\\.\(0\|\[1-9\]\[0-9\]\*\)\$/);
  assert.ok(
    workflow.indexOf('if [ "${TAG_VERSION}" != "${PACKAGE_VERSION}" ]') < workflow.indexOf("- name: Install parser dependencies"),
    "tag/package equality must be checked before install and publish steps"
  );
});

test("mcp config runs the workspace-following npx command", () => {
  const mcp = readJson("plugins/cortex/.mcp.json");
  assert.ok(mcp.mcpServers.cortex, "cortex MCP server must be defined");
  assert.equal(mcp.mcpServers.cortex.command, "npx");
});

test("codex mcp config is a direct server map the codex schema accepts", () => {
  const codex = readJson("plugins/cortex/.codex-plugin/plugin.json");
  const codexMcp = readJson("plugins/cortex/.codex-plugin/mcp.json");
  assert.match(codex.mcpServers, /mcp\.json$/);
  assert.ok(codexMcp.cortex, "direct server map must define the cortex server");
  assert.equal(codexMcp.cortex.command, "npx");
  const claudeMcp = readJson("plugins/cortex/.mcp.json");
  assert.deepEqual(
    codexMcp.cortex,
    claudeMcp.mcpServers.cortex,
    "codex and claude MCP server definitions must be identical",
  );
  assert.equal("mcpServers" in codexMcp, false, "codex file must not use the camelCase wrapper");
});
