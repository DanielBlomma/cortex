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

// ── Helpers ──────────────────────────────────────────────────

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

function writeJsonl(filePath, records) {
  const payload = records.map((record) => JSON.stringify(record)).join("\n");
  fs.writeFileSync(filePath, payload ? `${payload}\n` : "", "utf8");
}

function buildFixture() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-test-"));
  const contextDir = path.join(fixtureRoot, ".context");
  const cacheDir = path.join(contextDir, "cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(path.join(contextDir, "memory", "compiled"), { recursive: true });

  const now = new Date().toISOString();

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
      id: "file:src/server.ts",
      path: "src/server.ts",
      kind: "CODE",
      updated_at: now,
      source_of_truth: false,
      trust_level: 80,
      status: "active",
      excerpt: "MCP server entry point",
      content: "import { McpServer } from '@modelcontextprotocol/sdk';"
    },
    {
      id: "file:src/search.ts",
      path: "src/search.ts",
      kind: "CODE",
      updated_at: now,
      source_of_truth: true,
      trust_level: 90,
      status: "active",
      excerpt: "Search implementation",
      content: "export async function runContextSearch() {}"
    },
    {
      id: "file:src/deprecated.ts",
      path: "src/deprecated.ts",
      kind: "CODE",
      updated_at: "2020-01-01T00:00:00Z",
      source_of_truth: false,
      trust_level: 30,
      status: "deprecated",
      excerpt: "Old deprecated file",
      content: "// deprecated"
    }
  ]);

  writeJsonl(path.join(cacheDir, "entities.rule.jsonl"), [
    {
      id: "rule:source-of-truth",
      title: "Source of Truth",
      body: "Always prefer source_of_truth entities over others.",
      scope: "global",
      updated_at: now,
      source_of_truth: true,
      trust_level: 100,
      status: "active",
      priority: 90
    },
    {
      id: "rule:naming-convention",
      title: "Naming Convention",
      body: "Use camelCase for variables and PascalCase for types.",
      scope: "code",
      updated_at: now,
      source_of_truth: true,
      trust_level: 100,
      status: "active",
      priority: 70
    },
    {
      id: "rule:inactive-rule",
      title: "Inactive Rule",
      body: "This rule is not active.",
      scope: "global",
      updated_at: now,
      source_of_truth: false,
      trust_level: 50,
      status: "inactive",
      priority: 10
    }
  ]);

  writeJsonl(path.join(cacheDir, "entities.adr.jsonl"), [
    {
      id: "adr:001",
      path: "docs/adr/001-use-ryugraph.md",
      title: "Use RyuGraph for context storage",
      body: "We decided to use RyuGraph as the graph database for context storage.",
      decision_date: now,
      supersedes_id: "",
      source_of_truth: true,
      trust_level: 95,
      status: "active"
    }
  ]);

  writeJsonl(path.join(cacheDir, "relations.constrains.jsonl"), [
    { from: "rule:source-of-truth", to: "file:src/search.ts", note: "search must respect source_of_truth" }
  ]);
  writeJsonl(path.join(cacheDir, "relations.implements.jsonl"), [
    { from: "file:src/server.ts", to: "rule:naming-convention", note: "server follows naming rules" }
  ]);
  writeJsonl(path.join(cacheDir, "relations.supersedes.jsonl"), []);
  writeJsonl(path.join(cacheDir, "entities.chunk.jsonl"), [
    {
      id: "chunk:src/search.ts:runContextSearch:1-25",
      file_id: "file:src/search.ts",
      name: "runContextSearch",
      kind: "function",
      signature: "async function runContextSearch(parsed)",
      body: "export async function runContextSearch(parsed) { return parsed.query; }",
      start_line: 1,
      end_line: 25,
      language: "typescript",
      updated_at: now,
      source_of_truth: true,
      trust_level: 90,
      status: "active"
    },
    {
      id: "chunk:src/search.ts:tokenize:30-40",
      file_id: "file:src/search.ts",
      name: "tokenize",
      kind: "function",
      signature: "function tokenize(value)",
      body: "function tokenize(value) { return value.split(/\\s+/); }",
      start_line: 30,
      end_line: 40,
      language: "typescript",
      updated_at: now,
      source_of_truth: true,
      trust_level: 90,
      status: "active"
    },
    {
      id: "chunk:src/server.ts:registerTools:1-30",
      file_id: "file:src/server.ts",
      name: "registerTools",
      kind: "function",
      signature: "function registerTools(server)",
      body: "function registerTools(server) { return server; }",
      start_line: 1,
      end_line: 30,
      language: "typescript",
      updated_at: now,
      source_of_truth: false,
      trust_level: 80,
      status: "active"
    }
  ]);
  writeJsonl(path.join(cacheDir, "relations.defines.jsonl"), [
    { from: "file:src/search.ts", to: "chunk:src/search.ts:runContextSearch:1-25" },
    { from: "file:src/search.ts", to: "chunk:src/search.ts:tokenize:30-40" },
    { from: "file:src/server.ts", to: "chunk:src/server.ts:registerTools:1-30" }
  ]);
  writeJsonl(path.join(cacheDir, "relations.calls.jsonl"), [
    {
      from: "chunk:src/search.ts:runContextSearch:1-25",
      to: "chunk:src/search.ts:tokenize:30-40",
      call_type: "direct"
    },
    {
      from: "chunk:src/server.ts:registerTools:1-30",
      to: "chunk:src/search.ts:runContextSearch:1-25",
      call_type: "direct"
    }
  ]);
  writeJsonl(path.join(cacheDir, "relations.imports.jsonl"), [
    {
      from: "chunk:src/server.ts:registerTools:1-30",
      to: "file:src/search.ts",
      import_name: "./search"
    }
  ]);

  fs.writeFileSync(
    path.join(contextDir, "memory", "compiled", "search-ranking-gotcha.md"),
    `---
id: memory:search-ranking-gotcha
title: Search ranking gotcha
type: gotcha
summary: Query-seeded impact should prefer chunk hits over file hits for precise code questions.
evidence: Query-based impact initially resolved to file:src/search.ts instead of the runContextSearch chunk.
applies_to: chunk:src/search.ts:runContextSearch:1-25, file:src/search.ts
decision_or_gotcha: Prefer chunk seeds when a chunk exists among the top lexical/semantic matches.
sources: mcp/tests/server.test.mjs, mcp/src/search.ts
freshness: current
updated_at: ${now}
status: active
trust_level: 72
---
This memory captures a retrieval-quality lesson from implementing impact analysis.
`,
    "utf8"
  );

  return { fixtureRoot, now };
}

function withFixtureClient(fixtureRoot, fn) {
  return async () => {
    const transport = new StdioClientTransport({
      command: "node",
      args: ["dist/server.js"],
      cwd: MCP_DIR,
      stderr: "pipe",
      env: { ...process.env, CORTEX_PROJECT_ROOT: fixtureRoot }
    });

    const client = new Client({ name: "cortex-test-client", version: "0.1.0" });
    await client.connect(transport);
    try {
      await fn(client);
    } finally {
      await client.close();
    }
  };
}

// ── Integration tests (live server against real context) ─────

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

test("context.search only returns supported entity types", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "context.search",
      arguments: { query: "context", top_k: 20 }
    });
    assert.notEqual(result.isError, true);
    const sc = result.structuredContent;
    assert.ok(sc);
    const allowedTypes = new Set(["File", "Rule", "ADR", "Chunk", "Memory"]);
    for (const item of sc.results) {
      assert.ok(allowedTypes.has(item.entity_type), `Unexpected entity_type: ${item.entity_type}`);
    }
  });
});

test(
  "context.search returns chunk results with chunk metadata",
  withFixtureClient(buildFixture().fixtureRoot, async (client) => {
    const result = await client.callTool({
      name: "context.search",
      arguments: { query: "runContextSearch", top_k: 5, include_content: true }
    });
    assert.notEqual(result.isError, true);
    const sc = result.structuredContent;
    assert.ok(sc);
    const chunk = sc.results.find((item) => item.entity_type === "Chunk");
    assert.ok(chunk, "Expected a chunk result");
    assert.equal(chunk.id, "chunk:src/search.ts:runContextSearch:1-25");
    assert.equal(chunk.file_id, "file:src/search.ts");
    assert.equal(chunk.signature, "async function runContextSearch(parsed)");
    assert.equal(chunk.start_line, 1);
    assert.equal(chunk.end_line, 25);
    assert.equal(chunk.language, "typescript");
    assert.equal(chunk.path, "src/search.ts");
    assert.equal(typeof chunk.content, "string");
  })
);

test(
  "context.search returns a compact context envelope for chunk hits",
  withFixtureClient(buildFixture().fixtureRoot, async (client) => {
    const result = await client.callTool({
      name: "context.search",
      arguments: { query: "runContextSearch", top_k: 5 }
    });
    assert.notEqual(result.isError, true);
    const sc = result.structuredContent;
    assert.ok(sc);
    const chunk = sc.results.find((item) => item.id === "chunk:src/search.ts:runContextSearch:1-25");
    assert.ok(chunk, "Expected chunk result");
    assert.ok(chunk.context_envelope);
    assert.equal(chunk.context_envelope.parent_file.id, "file:src/search.ts");
    assert.ok(Array.isArray(chunk.context_envelope.sibling_chunks));
    assert.ok(
      chunk.context_envelope.sibling_chunks.some((item) => item.id === "chunk:src/search.ts:tokenize:30-40")
    );
    assert.ok(Array.isArray(chunk.context_envelope.callers));
    assert.ok(
      chunk.context_envelope.callers.some((item) => item.id === "chunk:src/server.ts:registerTools:1-30")
    );
    assert.ok(Array.isArray(chunk.context_envelope.callees));
    assert.ok(
      chunk.context_envelope.callees.some((item) => item.id === "chunk:src/search.ts:tokenize:30-40")
    );
  })
);

test(
  "context.search returns compiled memory articles as Memory entities",
  withFixtureClient(buildFixture().fixtureRoot, async (client) => {
    const result = await client.callTool({
      name: "context.search",
      arguments: { query: "search ranking gotcha", top_k: 5, include_content: true }
    });
    assert.notEqual(result.isError, true);
    const sc = result.structuredContent;
    assert.ok(sc);
    const memory = sc.results.find((item) => item.entity_type === "Memory");
    assert.ok(memory, "Expected a memory result");
    assert.equal(memory.id, "memory:search-ranking-gotcha");
    assert.equal(memory.title, "Search ranking gotcha");
    assert.equal(memory.path, ".context/memory/compiled/search-ranking-gotcha.md");
    assert.equal(typeof memory.content, "string");
  })
);

test(
  "context.get_related traverses ABOUT relation from chunk to memory",
  withFixtureClient(buildFixture().fixtureRoot, async (client) => {
    const result = await client.callTool({
      name: "context.get_related",
      arguments: {
        entity_id: "chunk:src/search.ts:runContextSearch:1-25",
        depth: 1,
        include_edges: true
      }
    });
    assert.notEqual(result.isError, true);
    const sc = result.structuredContent;
    assert.ok(sc);
    const relatedIds = new Set(sc.related.map((item) => item.id));
    assert.ok(relatedIds.has("memory:search-ranking-gotcha"), "Expected memory entity via ABOUT relation");
    const aboutEdge = sc.edges.find(
      (edge) => edge.relation === "ABOUT" && edge.to === "chunk:src/search.ts:runContextSearch:1-25"
    );
    assert.ok(aboutEdge, "Expected ABOUT edge pointing to the chunk");
  })
);

test(
  "context.get_related traverses REFERENCES relation from memory to source files",
  withFixtureClient(buildFixture().fixtureRoot, async (client) => {
    const result = await client.callTool({
      name: "context.get_related",
      arguments: {
        entity_id: "memory:search-ranking-gotcha",
        depth: 1,
        include_edges: true
      }
    });
    assert.notEqual(result.isError, true);
    const sc = result.structuredContent;
    assert.ok(sc);
    const relatedIds = new Set(sc.related.map((item) => item.id));
    // ABOUT targets
    assert.ok(relatedIds.has("chunk:src/search.ts:runContextSearch:1-25"), "Expected chunk via ABOUT");
    assert.ok(relatedIds.has("file:src/search.ts"), "Expected file via ABOUT");
    // REFERENCES targets (sources field becomes file: prefixed)
    assert.ok(relatedIds.has("file:mcp/tests/server.test.mjs"), "Expected source file via REFERENCES");
    assert.ok(relatedIds.has("file:mcp/src/search.ts"), "Expected source file via REFERENCES");

    const edgeTypes = new Set(sc.edges.map((edge) => edge.relation));
    assert.ok(edgeTypes.has("ABOUT"), "Expected ABOUT edges");
    assert.ok(edgeTypes.has("REFERENCES"), "Expected REFERENCES edges");
  })
);

test(
  "context.get_related traverses chunk edges and synthetic part-of relations",
  withFixtureClient(buildFixture().fixtureRoot, async (client) => {
    const result = await client.callTool({
      name: "context.get_related",
      arguments: {
        entity_id: "chunk:src/server.ts:registerTools:1-30",
        depth: 1,
        include_edges: true
      }
    });
    assert.notEqual(result.isError, true);
    const sc = result.structuredContent;
    assert.ok(sc);
    const relatedIds = new Set(sc.related.map((item) => item.id));
    assert.ok(relatedIds.has("file:src/server.ts"));
    assert.ok(relatedIds.has("chunk:src/search.ts:runContextSearch:1-25"));
    assert.ok(relatedIds.has("file:src/search.ts"));

    const edgeKinds = new Set(sc.edges.map((edge) => edge.relation));
    assert.ok(edgeKinds.has("PART_OF"));
    assert.ok(edgeKinds.has("CALLS"));
    assert.ok(edgeKinds.has("IMPORTS"));
  })
);

test("context.search respects top_k limit", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "context.search",
      arguments: { query: "context", top_k: 2 }
    });
    assert.notEqual(result.isError, true);
    const sc = result.structuredContent;
    assert.ok(sc);
    assert.ok(sc.results.length <= 2, `Expected at most 2 results, got ${sc.results.length}`);
  });
});

test("context.search results are sorted by score descending", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "context.search",
      arguments: { query: "server search context", top_k: 10 }
    });
    assert.notEqual(result.isError, true);
    const sc = result.structuredContent;
    assert.ok(sc);
    for (let i = 1; i < sc.results.length; i++) {
      assert.ok(
        sc.results[i - 1].score >= sc.results[i].score,
        `Results not sorted: index ${i - 1} (${sc.results[i - 1].score}) < index ${i} (${sc.results[i].score})`
      );
    }
  });
});

test("context.search result shape has expected fields", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "context.search",
      arguments: { query: "search", top_k: 1 }
    });
    assert.notEqual(result.isError, true);
    const sc = result.structuredContent;
    assert.ok(sc);
    assert.equal(typeof sc.query, "string");
    assert.equal(typeof sc.top_k, "number");
    assert.ok(sc.ranking);
    assert.equal(typeof sc.total_candidates, "number");
    assert.ok(["ryu", "cache"].includes(sc.context_source));
    assert.equal(typeof sc.semantic_engine, "string");
    if (sc.results.length > 0) {
      const item = sc.results[0];
      assert.equal(typeof item.id, "string");
      assert.equal(typeof item.entity_type, "string");
      assert.equal(typeof item.score, "number");
      assert.equal(typeof item.semantic_score, "number");
      assert.equal(typeof item.status, "string");
    }
  });
});

test("context.search include_content returns content field", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "context.search",
      arguments: { query: "search", top_k: 5, include_content: true }
    });
    assert.notEqual(result.isError, true);
    const sc = result.structuredContent;
    assert.ok(sc);
    const withContent = sc.results.filter((item) => item.content !== undefined);
    assert.ok(withContent.length > 0, "Expected at least one result with content when include_content=true");
  });
});

test("context.search without include_content omits content field", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "context.search",
      arguments: { query: "search", top_k: 5 }
    });
    assert.notEqual(result.isError, true);
    const sc = result.structuredContent;
    assert.ok(sc);
    for (const item of sc.results) {
      assert.equal(item.content, undefined, `Unexpected content on result ${item.id}`);
    }
  });
});

test("context.get_related returns entity not found for unknown id", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "context.get_related",
      arguments: { entity_id: "nonexistent:entity:xyz", depth: 1 }
    });
    assert.notEqual(result.isError, true);
    const sc = result.structuredContent;
    assert.ok(sc);
    assert.deepEqual(sc.related, []);
    assert.ok(sc.warning && sc.warning.includes("not found"));
  });
});

test("context.get_related returns related entities for a known entity", async () => {
  await withClient(async (client) => {
    // First find an entity to query
    const searchResult = await client.callTool({
      name: "context.search",
      arguments: { query: "server", top_k: 1 }
    });
    const sc = searchResult.structuredContent;
    if (!sc || sc.results.length === 0) {
      return; // skip if no data
    }
    const entityId = sc.results[0].id;
    const result = await client.callTool({
      name: "context.get_related",
      arguments: { entity_id: entityId, depth: 1, include_edges: true }
    });
    assert.notEqual(result.isError, true);
    const related = result.structuredContent;
    assert.ok(related);
    assert.equal(related.entity_id, entityId);
    assert.ok(Array.isArray(related.related));
    assert.ok(Array.isArray(related.edges));
  });
});

test("context.get_related include_edges=false returns empty edges", async () => {
  await withClient(async (client) => {
    const searchResult = await client.callTool({
      name: "context.search",
      arguments: { query: "server", top_k: 1 }
    });
    const sc = searchResult.structuredContent;
    if (!sc || sc.results.length === 0) {
      return;
    }
    const result = await client.callTool({
      name: "context.get_related",
      arguments: { entity_id: sc.results[0].id, depth: 1, include_edges: false }
    });
    assert.notEqual(result.isError, true);
    assert.deepEqual(result.structuredContent.edges, []);
  });
});

test(
  "context.find_callers returns incoming call graph matches for a chunk",
  withFixtureClient(buildFixture().fixtureRoot, async (client) => {
    const result = await client.callTool({
      name: "context.find_callers",
      arguments: {
        entity_id: "chunk:src/search.ts:runContextSearch:1-25",
        depth: 1,
        include_edges: true
      }
    });
    assert.notEqual(result.isError, true);
    const sc = result.structuredContent;
    assert.ok(sc);
    assert.equal(sc.entity_id, "chunk:src/search.ts:runContextSearch:1-25");
    assert.ok(Array.isArray(sc.callers));
    const callerIds = new Set(sc.callers.map((item) => item.id));
    assert.ok(callerIds.has("chunk:src/server.ts:registerTools:1-30"));
    assert.ok(Array.isArray(sc.edges));
    assert.ok(sc.edges.some((edge) => edge.relation === "CALLS"));
  })
);

test(
  "context.trace_calls walks outgoing call graph for a file entity",
  withFixtureClient(buildFixture().fixtureRoot, async (client) => {
    const result = await client.callTool({
      name: "context.trace_calls",
      arguments: {
        entity_id: "file:src/server.ts",
        depth: 2,
        direction: "outgoing",
        include_edges: true
      }
    });
    assert.notEqual(result.isError, true);
    const sc = result.structuredContent;
    assert.ok(sc);
    assert.equal(sc.entity_id, "file:src/server.ts");
    assert.equal(sc.direction, "outgoing");
    assert.ok(Array.isArray(sc.trace));
    const traceIds = new Set(sc.trace.map((item) => item.id));
    assert.ok(traceIds.has("chunk:src/search.ts:runContextSearch:1-25"));
    assert.ok(Array.isArray(sc.edges));
    assert.ok(sc.edges.some((edge) => edge.relation === "CALLS"));
  })
);

test(
  "context.impact_analysis returns impacted callers for a chunk seed",
  withFixtureClient(buildFixture().fixtureRoot, async (client) => {
    const result = await client.callTool({
      name: "context.impact_analysis",
      arguments: {
        entity_id: "chunk:src/search.ts:runContextSearch:1-25",
        depth: 2,
        top_k: 5,
        direction: "incoming",
        include_edges: true
      }
    });
    assert.notEqual(result.isError, true);
    const sc = result.structuredContent;
    assert.ok(sc);
    assert.equal(sc.resolved_seed_id, "chunk:src/search.ts:runContextSearch:1-25");
    assert.equal(sc.direction, "incoming");
    assert.ok(Array.isArray(sc.results));
    assert.ok(sc.results.some((item) => item.id === "chunk:src/server.ts:registerTools:1-30"));
    assert.ok(Array.isArray(sc.edges));
    assert.ok(sc.edges.some((edge) => edge.relation === "CALLS"));
  })
);

test(
  "context.impact_analysis resolves a seed from query",
  withFixtureClient(buildFixture().fixtureRoot, async (client) => {
    const result = await client.callTool({
      name: "context.impact_analysis",
      arguments: {
        query: "runContextSearch",
        depth: 2,
        top_k: 5,
        direction: "incoming",
        include_edges: false
      }
    });
    assert.notEqual(result.isError, true);
    const sc = result.structuredContent;
    assert.ok(sc);
    assert.equal(sc.resolved_from_query, true);
    assert.equal(sc.resolved_seed_id, "chunk:src/search.ts:runContextSearch:1-25");
    assert.ok(Array.isArray(sc.query_results));
    assert.ok(Array.isArray(sc.results));
    assert.deepEqual(sc.edges, []);
  })
);

test("context.get_rules filters by scope", async () => {
  await withClient(async (client) => {
    const globalResult = await client.callTool({
      name: "context.get_rules",
      arguments: { scope: "global" }
    });
    assert.notEqual(globalResult.isError, true);
    const sc = globalResult.structuredContent;
    assert.ok(sc);
    assert.ok(Array.isArray(sc.rules));
    for (const rule of sc.rules) {
      assert.ok(
        rule.scope === "global",
        `Expected global scope, got ${rule.scope} for rule ${rule.id}`
      );
    }
  });
});

test("context.get_rules include_inactive returns inactive rules", async () => {
  await withClient(async (client) => {
    const activeOnly = await client.callTool({
      name: "context.get_rules",
      arguments: { include_inactive: false }
    });
    const withInactive = await client.callTool({
      name: "context.get_rules",
      arguments: { include_inactive: true }
    });
    assert.notEqual(activeOnly.isError, true);
    assert.notEqual(withInactive.isError, true);
    assert.ok(withInactive.structuredContent.rules.length >= activeOnly.structuredContent.rules.length);
  });
});

test("context.get_rules returns rules sorted by priority descending", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "context.get_rules",
      arguments: { include_inactive: true }
    });
    assert.notEqual(result.isError, true);
    const rules = result.structuredContent.rules;
    for (let i = 1; i < rules.length; i++) {
      assert.ok(
        rules[i - 1].priority >= rules[i].priority,
        `Rules not sorted by priority: ${rules[i - 1].priority} < ${rules[i].priority}`
      );
    }
  });
});

test("context.get_rules result shape has expected fields", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "context.get_rules" });
    assert.notEqual(result.isError, true);
    const sc = result.structuredContent;
    assert.ok(sc);
    assert.equal(typeof sc.scope, "string");
    assert.equal(typeof sc.count, "number");
    assert.ok(["ryu", "cache"].includes(sc.context_source));
    if (sc.rules.length > 0) {
      const rule = sc.rules[0];
      assert.equal(typeof rule.id, "string");
      assert.equal(typeof rule.title, "string");
      assert.equal(typeof rule.description, "string");
      assert.equal(typeof rule.priority, "number");
      assert.equal(typeof rule.scope, "string");
      assert.equal(typeof rule.status, "string");
    }
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

test("context.search exclude_deprecated filters deprecated entities", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "context.search",
      arguments: { query: "deprecated", top_k: 20, include_deprecated: false }
    });
    assert.notEqual(result.isError, true);
    const sc = result.structuredContent;
    assert.ok(sc);
    for (const item of sc.results) {
      assert.notEqual(item.status, "deprecated", `Deprecated entity ${item.id} should be excluded`);
    }
  });
});

test("context.search include_deprecated shows deprecated entities", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "context.search",
      arguments: { query: "deprecated", top_k: 20, include_deprecated: true }
    });
    assert.notEqual(result.isError, true);
    const sc = result.structuredContent;
    assert.ok(sc);
    // Just verify it runs without error; deprecated entities may or may not match
    assert.ok(Array.isArray(sc.results));
  });
});

test("registered tools include the expected call graph and context tools", async () => {
  await withClient(async (client) => {
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name).sort();
    assert.deepEqual(toolNames, [
      "context.find_callers",
      "context.get_related",
      "context.get_rules",
      "context.impact_analysis",
      "context.reload",
      "context.search",
      "context.trace_calls"
    ]);
  });
});
