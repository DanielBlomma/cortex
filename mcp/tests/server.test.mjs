import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MCP_DIR = path.resolve(__dirname, "..");

function writeJsonl(filePath, records) {
  const payload = records.map((record) => JSON.stringify(record)).join("\n");
  fs.writeFileSync(filePath, payload ? `${payload}\n` : "", "utf8");
}

function buildWindowChunkSearchFixture() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-window-search-"));
  const contextDir = path.join(fixtureRoot, ".context");
  const cacheDir = path.join(contextDir, "cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  const now = new Date().toISOString();
  const fileId = "file:src/large.ts";
  const baseChunkId = "chunk:src/large.ts:LargeChunk:10-329";
  const windowChunkId = `${baseChunkId}:window:4:250-329`;

  fs.writeFileSync(
    path.join(contextDir, "config.yaml"),
    `repo_id: fixture
source_paths:
  - src
ranking:
  semantic: 0.40
  graph: 0.25
  trust: 0.20
  recency: 0.15
`,
    "utf8"
  );
  fs.writeFileSync(path.join(contextDir, "rules.yaml"), "rules:\n", "utf8");

  writeJsonl(path.join(cacheDir, "documents.jsonl"), [
    {
      id: fileId,
      path: "src/large.ts",
      kind: "CODE",
      updated_at: now,
      source_of_truth: false,
      trust_level: 80,
      status: "active",
      excerpt: "Large chunk fixture",
      content: "export function LargeChunk() { return 1; }"
    }
  ]);

  writeJsonl(path.join(cacheDir, "entities.rule.jsonl"), []);
  writeJsonl(path.join(cacheDir, "entities.adr.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.constrains.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.implements.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.supersedes.jsonl"), []);

  writeJsonl(path.join(cacheDir, "entities.chunk.jsonl"), [
    {
      id: baseChunkId,
      file_id: fileId,
      name: "LargeChunk",
      kind: "function",
      signature: "LargeChunk()",
      body: "line-0001-prefix-only\nline-0002-prefix-only",
      start_line: 10,
      end_line: 329,
      language: "typescript",
      updated_at: now,
      source_of_truth: false,
      trust_level: 80,
      status: "active"
    },
    {
      id: windowChunkId,
      file_id: fileId,
      name: "LargeChunk#window4",
      kind: "function",
      signature: "LargeChunk() [window 4]",
      body: "windowtailonlytokenzqv993 appears only in this overlap window",
      start_line: 250,
      end_line: 329,
      language: "typescript",
      updated_at: now,
      source_of_truth: false,
      trust_level: 80,
      status: "active"
    }
  ]);

  return {
    fixtureRoot,
    fileId,
    baseChunkId,
    windowChunkId
  };
}

async function withClient(fn, options = {}) {
  const mergedEnv = {
    ...process.env,
    ...(options.env ?? {})
  };

  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/server.js"],
    cwd: MCP_DIR,
    stderr: "pipe",
    env: mergedEnv
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

test("context.search filters out zero-relevance noise", async () => {
  const { fixtureRoot } = buildWindowChunkSearchFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.search",
          arguments: { query: "zzzxxyyqqqnonexistingterm", top_k: 10 }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.ok(Array.isArray(result.structuredContent.results));
        assert.equal(result.structuredContent.results.length, 0);
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.search retrieves terms that only exist in overlap window chunks", async () => {
  const { fixtureRoot, baseChunkId, windowChunkId } = buildWindowChunkSearchFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.search",
          arguments: { query: "windowtailonlytokenzqv993", top_k: 10, include_content: true }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.ok(Array.isArray(result.structuredContent.results));

        const ids = result.structuredContent.results.map((item) => String(item.id));
        assert.ok(ids.includes(windowChunkId));
        assert.ok(!ids.includes(baseChunkId));

        const windowResult = result.structuredContent.results.find((item) => item.id === windowChunkId);
        assert.equal(windowResult?.entity_type, "Chunk");
        assert.ok(String(windowResult?.content ?? "").includes("windowtailonlytokenzqv993"));
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.get_related accepts chunk ids returned by context.search", async () => {
  const { fixtureRoot, fileId, windowChunkId } = buildWindowChunkSearchFixture();
  try {
    await withClient(
      async (client) => {
        const searchResult = await client.callTool({
          name: "context.search",
          arguments: { query: "windowtailonlytokenzqv993", top_k: 10 }
        });
        assert.notEqual(searchResult.isError, true);
        assert.ok(searchResult.structuredContent);
        assert.ok(Array.isArray(searchResult.structuredContent.results));

        const chunkResult = searchResult.structuredContent.results.find((item) => item.id === windowChunkId);
        assert.ok(chunkResult);

        const relatedResult = await client.callTool({
          name: "context.get_related",
          arguments: { entity_id: windowChunkId, depth: 1, include_edges: true }
        });
        assert.notEqual(relatedResult.isError, true);
        assert.ok(relatedResult.structuredContent);
        assert.notEqual(relatedResult.structuredContent.warning, "Entity not found in indexed context.");
        assert.ok(Array.isArray(relatedResult.structuredContent.related));
        assert.ok(Array.isArray(relatedResult.structuredContent.edges));

        const relatedIds = relatedResult.structuredContent.related.map((item) => String(item.id));
        assert.ok(relatedIds.includes(fileId));

        const partOfEdge = relatedResult.structuredContent.edges.find(
          (edge) => edge.from === windowChunkId && edge.to === fileId && edge.relation === "PART_OF"
        );
        assert.ok(partOfEdge);
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
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
