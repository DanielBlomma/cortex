import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

function readJson(relative) {
  return JSON.parse(
    fs.readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8"),
  );
}

const version = readJson("package.json").version;

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

test("session hook is wired for startup, resume, clear, and compact", () => {
  const hooks = readJson("plugins/cortex/hooks/hooks.json");
  const entries = hooks.hooks.SessionStart;
  assert.ok(Array.isArray(entries) && entries.length > 0);
  const matcher = entries[0].matcher;
  for (const source of ["startup", "resume", "clear", "compact"]) {
    assert.ok(matcher.includes(source), `SessionStart matcher must include ${source}`);
  }
  assert.match(entries[0].hooks[0].command, /session-start\.mjs/);
});

test("mcp config runs the workspace-following npx command", () => {
  const mcp = readJson("plugins/cortex/.mcp.json");
  assert.ok(mcp.mcpServers.cortex, "cortex MCP server must be defined");
});

test("codex mcp config is a direct server map the codex schema accepts", () => {
  const codex = readJson("plugins/cortex/.codex-plugin/plugin.json");
  const codexMcp = readJson("plugins/cortex/.codex-plugin/mcp.json");
  assert.match(codex.mcpServers, /mcp\.json$/);
  assert.ok(codexMcp.cortex, "direct server map must define the cortex server");
  assert.equal(codexMcp.cortex.command, "npx");
  assert.equal("mcpServers" in codexMcp, false, "codex file must not use the camelCase wrapper");
});
