import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MCP_DIR = path.resolve(__dirname, "..");

async function withClient(fn) {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/server.js"],
    cwd: MCP_DIR,
    stderr: "pipe"
  });

  const client = new Client({ name: "cortex-test-client", version: "0.1.0" });
  await client.connect(transport);
  try {
    await fn(client);
  } finally {
    await client.close();
  }
}

test("context.get_rules accepts missing arguments", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "context.get_rules" });
    assert.notEqual(result.isError, true);
    assert.ok(result.structuredContent);
    assert.ok(Array.isArray(result.structuredContent.rules));
  });
});

test("context.search returns unified entity types", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "context.search",
      arguments: { query: "rule.source_of_truth", top_k: 10 }
    });
    assert.notEqual(result.isError, true);
    assert.ok(result.structuredContent);
    assert.ok(Array.isArray(result.structuredContent.results));
    const types = new Set(result.structuredContent.results.map((item) => item.entity_type));
    assert.ok(types.has("Rule"));
  });
});

test("context.reload returns reload metadata", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "context.reload" });
    assert.notEqual(result.isError, true);
    assert.ok(result.structuredContent);
    assert.equal(typeof result.structuredContent.reloaded, "boolean");
    assert.ok(["ryu", "cache"].includes(String(result.structuredContent.context_source)));
  });
});
