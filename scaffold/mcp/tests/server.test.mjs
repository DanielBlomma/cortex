import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  REGISTERED_RULE_IDS,
  createAuthorityManifest,
  createObservation,
  createSourceAuthorityRegistry,
  sha256Canonical,
} from "../dist/core/analysis-state/engine.js";
import { publishAnalysisState } from "../dist/core/analysis-state/store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MCP_DIR = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(MCP_DIR, "../..");
const WORKFLOW_RUNTIME = path.join(MCP_DIR, "dist", "cli", "workflow-analysis.js");
const TASK_ID = "wo059-mcp";
const SUBJECT = "WO-MCP";
const SOURCE = { path: "evidence/mcp-review.json", sha256: "b".repeat(64), selector: "review" };
const SOURCE_AUTHORITIES = createSourceAuthorityRegistry({
  [SOURCE.path]: { sha256: SOURCE.sha256, authorities: ["reviewer"] },
});
const COMMUNITY_TOOLS = [
  "context.get_related",
  "context.get_rules",
  "context.impact",
  "context.reload",
  "context.search",
];
const ANALYSIS_TOOLS = [
  "context.analysis_changes",
  "context.analysis_state",
  "context.analysis_why",
  "context.analysis_why_not",
];

async function withClient(fn, options = {}) {
  const env = { ...process.env, CORTEX_PROJECT_ROOT: options.root ?? PROJECT_ROOT };
  delete env.CORTEX_MAINTAINED_ANALYSIS_MCP;
  if (options.flag !== undefined) env.CORTEX_MAINTAINED_ANALYSIS_MCP = options.flag;
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/server.js"],
    cwd: MCP_DIR,
    env,
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

function makeRoot() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-analysis-mcp-")));
}

function createFixture() {
  const root = makeRoot();
  const observation = createObservation({
    schema_version: 1,
    subject: SUBJECT,
    predicate: "human_approval",
    object: true,
    operation: "assert",
    observed_at: "2026-08-31T10:00:00Z",
    authority: "reviewer",
    source: SOURCE,
    scope: { repository: "cortex", work_order: SUBJECT, phase: "review" },
    supersedes: [],
  });
  const observations = [observation];
  const authorityManifest = createAuthorityManifest(observations);
  const persisted = publishAnalysisState({
    cwd: root,
    taskId: TASK_ID,
    repository: "cortex",
    input: { schema_version: 1, rule_ids: REGISTERED_RULE_IDS, observations },
    authorityManifest,
    sourceAuthorities: SOURCE_AUTHORITIES,
  });
  const payload = {
    schema_version: 1,
    repository: "cortex",
    task_id: TASK_ID,
    primary_subject: SUBJECT,
    authority_manifest: authorityManifest,
    source_authorities: SOURCE_AUTHORITIES,
  };
  const authority = path.join(root, ".agents", TASK_ID, "analysis-authority.json");
  fs.writeFileSync(authority, `${JSON.stringify({ ...payload, bundle_sha256: sha256Canonical(payload) })}\n`, { mode: 0o600 });
  fs.chmodSync(authority, 0o600);
  return { root, persisted, authority };
}

function runCli(root, args) {
  const source = `import { runWorkflowAnalysisCommand } from ${JSON.stringify(WORKFLOW_RUNTIME)}; await runWorkflowAnalysisCommand(${JSON.stringify(args)});`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CORTEX_PROJECT_ROOT: root },
  });
}

function stateIdentity(root) {
  const analysis = path.join(root, ".agents", TASK_ID, "analysis");
  return [
    path.join(root, ".agents"),
    path.join(root, ".agents", TASK_ID),
    analysis,
    path.join(root, ".agents", TASK_ID, "analysis-authority.json"),
    ...["observations.jsonl", "snapshot.json", "changes.jsonl", "manifest.json"].map((name) => path.join(analysis, name)),
  ].map((target) => {
    const stat = fs.lstatSync(target, { bigint: true });
    return {
      target: path.relative(root, target),
      dev: stat.dev,
      ino: stat.ino,
      ctimeNs: stat.ctimeNs,
      mtimeNs: stat.mtimeNs,
      mode: stat.mode,
      nlink: stat.nlink,
      entries: stat.isDirectory() ? fs.readdirSync(target).sort() : null,
      bytes: stat.isFile() ? fs.readFileSync(target).toString("base64") : null,
    };
  });
}

function assertClosedError(result, code) {
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, {
    ok: false,
    command: "workflow",
    schema_version: 1,
    generator_version: "maintained-analysis-cli-v1",
    error: {
      code,
      message: {
        INVALID_ARGS: "Workflow analysis arguments are invalid",
        STATE_NOT_FOUND: "Maintained analysis state was not found",
        AUTHORITY_INVALID: "Maintained analysis authority is invalid",
        STATE_UNTRUSTED: "Maintained analysis state is untrusted",
      }[code],
    },
  });
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  assert.ok(Buffer.byteLength(result.content[0].text) <= 65_536);
}

test("maintained analysis tools are default-off and require the exact opt-in value", async () => {
  let defaultTools;
  await withClient(async (client) => {
    defaultTools = (await client.listTools()).tools;
    const names = defaultTools.map((tool) => tool.name).sort();
    assert.deepEqual(names, COMMUNITY_TOOLS);
  });
  await withClient(async (client) => {
    const tools = (await client.listTools()).tools;
    const names = tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, COMMUNITY_TOOLS);
    assert.deepEqual(tools, defaultTools);
  }, { flag: "true" });
});

test("maintained analysis tools advertise exact closed input schemas", async () => {
  await withClient(async (client) => {
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [...COMMUNITY_TOOLS, ...ANALYSIS_TOOLS].sort());
    const expectedKeys = {
      "context.analysis_state": ["task_id"],
      "context.analysis_why": ["fact_id", "task_id"],
      "context.analysis_why_not": ["predicate", "task_id"],
      "context.analysis_changes": ["since", "task_id"],
    };
    for (const [name, keys] of Object.entries(expectedKeys)) {
      const schema = tools.find((tool) => tool.name === name).inputSchema;
      assert.equal(schema.type, "object");
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(Object.keys(schema.properties).sort(), keys);
      assert.deepEqual([...schema.required].sort(), keys);
    }
    const since = tools.find((tool) => tool.name === "context.analysis_changes").inputSchema.properties.since;
    assert.deepEqual(since, { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
  }, { flag: "1" });
});

test("all maintained analysis MCP queries are deterministic, read-only, bounded, and CLI-identical", async () => {
  const { root, persisted } = createFixture();
  try {
    const factId = persisted.state.query(SUBJECT, "human_approval")[0].id;
    const cases = [
      ["context.analysis_state", { task_id: TASK_ID }, ["state", TASK_ID, "--json"]],
      ["context.analysis_why", { task_id: TASK_ID, fact_id: factId }, ["why", TASK_ID, factId, "--json"]],
      ["context.analysis_why_not", { task_id: TASK_ID, predicate: "accepted" }, ["why-not", TASK_ID, "accepted", "--json"]],
      ["context.analysis_changes", { task_id: TASK_ID, since: 0 }, ["changes", TASK_ID, "--since", "0", "--json"]],
    ];
    const before = stateIdentity(root);
    const firstResults = [];
    await withClient(async (client) => {
      for (const [name, args] of cases) {
        firstResults.push(await client.callTool({ name, arguments: args }));
      }
    }, { flag: "1", root });
    await withClient(async (client) => {
      for (const [index, [name, args, cliArgs]] of cases.entries()) {
        const first = firstResults[index];
        const second = await client.callTool({ name, arguments: args });
        const cli = runCli(root, cliArgs);
        assert.notEqual(first.isError, true);
        assert.equal(cli.status, 0, cli.stderr);
        assert.deepEqual(first, second);
        assert.deepEqual(first.structuredContent, JSON.parse(cli.stdout));
        assert.equal(first.content[0].text, cli.stdout);
        assert.ok(Buffer.byteLength(first.content[0].text) <= 65_536);
        assert.doesNotMatch(first.content[0].text, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
      }
    }, { flag: "1", root });
    assert.deepEqual(stateIdentity(root), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("maintained analysis MCP failures are domain-closed and do not disclose rejected values", async () => {
  const { root, authority } = createFixture();
  const authorityBytes = fs.readFileSync(authority);
  const rejected = "REJECTED_SECRET_VALUE";
  try {
    await withClient(async (client) => {
      const invalidCalls = [
        ["context.analysis_state", {}],
        ["context.analysis_state", { task_id: "../unsafe", extra: rejected }],
        ["context.analysis_state", { task_id: "wo059-\u202eunsafe" }],
        ["context.analysis_why", { task_id: TASK_ID, fact_id: rejected }],
        ["context.analysis_why_not", { task_id: TASK_ID, predicate: rejected }],
        ["context.analysis_changes", { task_id: TASK_ID, since: -1 }],
        ["context.analysis_changes", { task_id: TASK_ID, since: 1.5 }],
        ["context.analysis_changes", { task_id: TASK_ID, since: Number.MAX_SAFE_INTEGER + 1 }],
      ];
      for (const [name, args] of invalidCalls) {
        const result = await client.callTool({ name, arguments: args });
        assertClosedError(result, "INVALID_ARGS");
        assert.doesNotMatch(result.content[0].text, /REJECTED_SECRET_VALUE|Zod|validation|Invalid arguments|\.\.\/unsafe/u);
      }
      const unknownFact = await client.callTool({
        name: "context.analysis_why",
        arguments: { task_id: TASK_ID, fact_id: `fact:${"f".repeat(64)}` },
      });
      assert.equal(unknownFact.structuredContent.error.code, "STATE_NOT_FOUND");
      assert.equal(unknownFact.isError, true);

      const future = await client.callTool({
        name: "context.analysis_changes",
        arguments: { task_id: TASK_ID, since: 2 },
      });
      assert.equal(future.structuredContent.error.code, "INVALID_ARGS");
      assert.equal(future.isError, true);
    }, { flag: "1", root });

    const missing = makeRoot();
    try {
      await withClient(async (client) => {
        const result = await client.callTool({ name: "context.analysis_state", arguments: { task_id: TASK_ID } });
        const cli = runCli(missing, ["state", TASK_ID, "--json"]);
        assert.equal(result.structuredContent.error.code, "STATE_NOT_FOUND");
        assert.equal(result.isError, true);
        assert.equal(cli.status, 1);
        assert.deepEqual(result.structuredContent, JSON.parse(cli.stdout));
        assert.equal(result.content[0].text, cli.stdout);
        assert.doesNotMatch(result.content[0].text, new RegExp(missing.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
      }, { flag: "1", root: missing });
    } finally {
      fs.rmSync(missing, { recursive: true, force: true });
    }

    fs.writeFileSync(authority, "{}\n", { mode: 0o600 });
    await withClient(async (client) => {
      const result = await client.callTool({ name: "context.analysis_state", arguments: { task_id: TASK_ID } });
      assert.equal(result.structuredContent.error.code, "AUTHORITY_INVALID");
      assert.equal(result.isError, true);
      assert.doesNotMatch(result.content[0].text, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
    }, { flag: "1", root });

    fs.writeFileSync(authority, authorityBytes, { mode: 0o600 });
    fs.chmodSync(authority, 0o644);
    await withClient(async (client) => {
      const result = await client.callTool({ name: "context.analysis_state", arguments: { task_id: TASK_ID } });
      assert.equal(result.structuredContent.error.code, "STATE_UNTRUSTED");
      assert.equal(result.isError, true);
      assert.doesNotMatch(result.content[0].text, /analysis-authority|mode|permission/u);
    }, { flag: "1", root });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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
