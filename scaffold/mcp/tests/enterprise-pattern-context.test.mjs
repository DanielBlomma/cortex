import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  buildPatternReviewContext,
  createLocalPatternRunner,
  PATTERN_REVIEW_QUESTION,
} from "../dist/enterprise/reviews/pattern-context.js";
import {
  buildContextReviewAuditInput,
  registerEnterpriseTools,
} from "../dist/enterprise/tools/enterprise.js";

function evidence(overrides = {}) {
  return {
    query: "error handling",
    query_source: "explicit",
    local_pattern_found: false,
    fallback_used: false,
    evidence_order: ["same_file", "same_module", "same_feature_area", "repo_wide"],
    tiers: [
      { name: "same_file", evidence: [] },
      { name: "same_module", evidence: [] },
      { name: "same_feature_area", evidence: [] },
      { name: "repo_wide", evidence: [] },
    ],
    ...overrides,
  };
}

test("composes deterministic non-blocking pattern context without inventing pass or fail", async () => {
  const runner = async ({ target }) => {
    if (target === "missing.ts") {
      throw new Error("Pattern target was not found in indexed context: /private/repo/missing.ts");
    }
    if (target === "error.ts") {
      throw new Error("secret internal stack detail");
    }
    if (target === "a.ts") {
      return evidence({
        local_pattern_found: true,
        tiers: [
          {
            name: "same_file",
            evidence: [{ id: "chunk:a", path: "a.ts", start_line: 2, end_line: 8 }],
          },
        ],
      });
    }
    if (target === "b.ts") {
      return evidence({
        fallback_used: true,
        tiers: [
          {
            name: "repo_wide",
            evidence: [{ id: "file:docs/review.md", path: "docs/review.md" }],
          },
        ],
      });
    }
    return evidence();
  };

  const result = await buildPatternReviewContext({
    files: ["z.ts", "a.ts", "b.ts", "a.ts", "../secret.ts", "c.ts", "missing.ts", "error.ts"],
    enabled: true,
    query: "error handling",
    topK: 2,
    limit: 10,
    runner,
  });

  assert.equal(result.enabled, true);
  assert.equal(result.non_blocking, true);
  assert.equal(result.affects_policy_summary, false);
  assert.equal(result.review_question, PATTERN_REVIEW_QUESTION);
  assert.deepEqual(result.targets.map((target) => target.path), [
    "a.ts",
    "b.ts",
    "c.ts",
    "error.ts",
    "missing.ts",
    "z.ts",
  ]);
  assert.deepEqual(result.targets.map((target) => target.status), [
    "local_evidence",
    "repo_fallback",
    "no_evidence",
    "error",
    "not_indexed",
    "no_evidence",
  ]);
  assert.equal(result.targets[0].tiers[0].evidence[0].start_line, 2);
  assert.equal(result.targets[3].message, "Pattern evidence could not be produced for this target.");
  assert.equal(result.targets[3].local_pattern_found, false);
  assert.equal(result.targets[3].fallback_used, false);
  assert.equal(result.targets[3].tiers.length, 4);
  assert.equal(result.targets[4].query, "error handling");
  const targetKeys = Object.keys(result.targets[0]).sort();
  for (const target of result.targets) {
    assert.deepEqual(Object.keys(target).sort(), targetKeys);
  }
  assert.doesNotMatch(JSON.stringify(result), /secret internal stack detail|\/private\/repo/u);
  assert.deepEqual(result.summary, {
    requested: 8,
    eligible: 6,
    analyzed: 6,
    local_evidence: 1,
    repo_fallback: 1,
    no_evidence: 2,
    not_indexed: 1,
    errors: 1,
    omitted: 0,
    invalid_paths: 1,
  });
});

test("sanitizes runtime warnings and unsafe citation paths", async () => {
  const result = await buildPatternReviewContext({
    files: ["src/a.ts"],
    enabled: true,
    topK: 5,
    limit: 1,
    runner: async () => evidence({
      warning: "model cache failed at /Users/alice/private/model and C:\\Users\\alice\\model",
      tiers: [
        {
          name: "same_file",
          evidence: [
            { id: "chunk:src/a.ts:run", path: "src/a.ts", start_line: 1, end_line: 3 },
            { id: "chunk:/Users/alice/private", path: "/Users/alice/private/a.ts" },
            { id: "chunk:C:/Users/alice/private", path: "C:\\Users\\alice\\private\\a.ts" },
            { id: "chunk:../secret", path: "../secret.ts" },
          ],
        },
      ],
    }),
  });

  assert.equal(result.targets[0].status, "local_evidence");
  assert.equal(result.targets[0].tiers[0].evidence.length, 1);
  assert.equal(result.targets[0].citations_dropped, 3);
  assert.equal(result.targets[0].warning, "Pattern evidence completed with local runtime warnings.");
  assert.doesNotMatch(JSON.stringify(result), /Users[\\/]alice|\.\.\/secret/u);
});

test("audit projection records query size but not query text", () => {
  const input = buildContextReviewAuditInput({
    scope: "changed",
    include_passed: true,
    include_pattern_evidence: true,
    pattern_query: "SECRET_API_KEY=do-not-retain",
    pattern_top_k: 2,
    pattern_limit: 10,
  });

  assert.equal(input.pattern_query_present, true);
  assert.equal(input.pattern_query_length, 28);
  assert.equal("pattern_query" in input, false);
  assert.doesNotMatch(JSON.stringify(input), /SECRET_API_KEY/u);
});

test("bounds review targets after normalized deterministic ordering", async () => {
  const calls = [];
  const result = await buildPatternReviewContext({
    files: ["z.ts", "./b.ts", "a.ts", "b.ts"],
    enabled: true,
    topK: 1,
    limit: 2,
    runner: async ({ target }) => {
      calls.push(target);
      return evidence();
    },
  });

  assert.deepEqual(calls, ["a.ts", "b.ts"]);
  assert.equal(result.summary.requested, 4);
  assert.equal(result.summary.eligible, 3);
  assert.equal(result.summary.analyzed, 2);
  assert.equal(result.summary.omitted, 1);
});

test("default local pattern runner loads context data once across targets", async () => {
  const document = (id, filePath) => ({
    id,
    path: filePath,
    kind: "CODE",
    updated_at: "2026-07-12T00:00:00.000Z",
    source_of_truth: false,
    trust_level: 60,
    status: "active",
    excerpt: "export const value = 1;",
    content: "export const value = 1;",
  });
  const data = {
    documents: [document("file:src/a.ts", "src/a.ts"), document("file:src/b.ts", "src/b.ts")],
    chunks: [],
    rules: [],
    adrs: [],
    modules: [],
    projects: [],
    relations: [],
    ranking: { semantic: 0.4, graph: 0.25, trust: 0.2, recency: 0.15 },
    source: "cache",
  };
  let loads = 0;
  const runner = createLocalPatternRunner(async () => {
    loads += 1;
    return data;
  });

  await runner({ target: "src/a.ts", top_k: 1 });
  await runner({ target: "src/b.ts", top_k: 1 });

  assert.equal(loads, 1);
});

test("disabled mode does not invoke pattern retrieval", async () => {
  let called = false;
  const result = await buildPatternReviewContext({
    files: ["a.ts", "b.ts"],
    enabled: false,
    topK: 2,
    limit: 10,
    runner: async () => {
      called = true;
      return evidence();
    },
  });

  assert.equal(called, false);
  assert.equal(result.enabled, false);
  assert.equal(result.affects_policy_summary, false);
  assert.equal(result.summary.requested, 2);
  assert.deepEqual(result.targets, []);
});

test("context.review includes pattern context without changing validator summary", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-pattern-review-tool-"));
  const contextDir = path.join(projectRoot, ".context");
  const previousProjectRoot = process.env.CORTEX_PROJECT_ROOT;
  fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".gitignore"), ".context/\nignored.ts\n", "utf8");
  execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
  execFileSync("git", ["add", ".gitignore"], { cwd: projectRoot, stdio: "ignore" });
  execFileSync("git", ["-c", "user.name=Cortex Test", "-c", "user.email=cortex@example.invalid", "commit", "-m", "fixture"], {
    cwd: projectRoot,
    stdio: "ignore",
  });
  fs.mkdirSync(contextDir, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "src", "new-file.ts"), "export const value = 1;\n", "utf8");
  fs.writeFileSync(path.join(projectRoot, "ignored.ts"), "ignored\n", "utf8");
  process.env.CORTEX_PROJECT_ROOT = projectRoot;

  try {
    const tools = new Map();
    const server = {
      registerTool(name, definition, handler) {
        tools.set(name, { definition, handler });
      },
    };
    const config = {
      enterprise: { endpoint: "", api_key: "", base_url: "" },
      telemetry: { enabled: false, endpoint: "", api_key: "", interval_minutes: 10 },
      audit: { enabled: false, retention_days: 90 },
      policy: { enabled: false, endpoint: "", api_key: "", sync_interval_minutes: 240 },
      rbac: { enabled: false, default_role: "developer" },
      validators: {},
      compliance: { frameworks: [], eu_addons: false },
      govern: {
        mode: "off",
        sync_on_startup: false,
        sync_interval_minutes: 60,
        tier_claude: "prevent",
        tier_codex: "prevent",
        tier_copilot: "wrap",
        detect_ungoverned: false,
        govern_endpoint: "",
      },
    };
    registerEnterpriseTools(
      server,
      {},
      null,
      config,
      contextDir,
      { getMergedPolicies: () => [] },
      "2.3.0",
    );

    const reviewTool = tools.get("context.review");
    assert.ok(reviewTool);
    const result = await reviewTool.handler({
      scope: "changed",
      include_passed: true,
    });
    const output = result.structuredContent;

    assert.equal(output.summary.total, 0);
    assert.equal("pattern_analyzed" in output.summary, false);
    assert.equal(output.pattern_review.enabled, true);
    assert.equal(output.pattern_review.affects_policy_summary, false);
    assert.equal(output.pattern_review.limit, 10);
    assert.equal(output.pattern_review.top_k_per_tier, 2);
    assert.equal(output.pattern_review.summary.analyzed, 1);
    assert.equal(output.pattern_review.targets[0].path, "src/new-file.ts");
    assert.equal(output.pattern_review.targets[0].status, "not_indexed");
    assert.equal(output.pattern_review.targets[0].local_pattern_found, false);
    assert.equal(output.pattern_review.targets[0].fallback_used, false);
    assert.equal(output.pattern_review.targets[0].tiers.length, 4);
  } finally {
    if (previousProjectRoot === undefined) {
      delete process.env.CORTEX_PROJECT_ROOT;
    } else {
      process.env.CORTEX_PROJECT_ROOT = previousProjectRoot;
    }
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
