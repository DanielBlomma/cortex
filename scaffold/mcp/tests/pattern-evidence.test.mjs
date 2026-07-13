import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyPatternEvidence,
  contextReferenceTimeMs,
  runLocalPatternEvidence,
  runPatternEvidence,
} from "../dist/patternEvidence.js";

function chunk(id, fileId, startLine, endLine) {
  return {
    id,
    file_id: fileId,
    name: id,
    kind: "function",
    signature: "",
    body: "",
    description: "",
    start_line: startLine,
    end_line: endLine,
    language: "typescript",
    exported: false,
    updated_at: "2026-07-12T00:00:00.000Z",
    source_of_truth: false,
    trust_level: 60,
    status: "active",
  };
}

function document(id, filePath, kind, content = "") {
  return {
    id,
    path: filePath,
    kind,
    updated_at: "2026-07-12T00:00:00.000Z",
    source_of_truth: false,
    trust_level: kind === "DOC" ? 80 : 60,
    status: "active",
    excerpt: content,
    content,
  };
}

function contextData({ documents, chunks = [] }) {
  return {
    documents,
    chunks,
    rules: [],
    adrs: [],
    modules: [],
    projects: [],
    relations: [],
    ranking: { semantic: 0.4, graph: 0.25, trust: 0.2, recency: 0.15 },
    source: "cache",
  };
}

test("classifies helper, error, and config evidence in local-first order with line citations", () => {
  const target = {
    input: "src/features/auth/controller.ts",
    entity_id: "file:src/features/auth/controller.ts",
    entity_type: "File",
    path: "src/features/auth/controller.ts",
  };
  const results = [
    {
      id: target.entity_id,
      entity_type: "File",
      kind: "CODE",
      title: target.path,
      path: target.path,
      excerpt: "target must not cite itself",
      score: 0.99,
    },
    {
      id: "chunk:helper",
      entity_type: "Chunk",
      kind: "function",
      title: "normalizeUser",
      path: "src\\features\\auth\\controller.ts",
      excerpt: "file-local helper shape",
      score: 0.9,
      matched_rules: ["rule.repo_local_pattern_review", "rule.repo_local_pattern_review"],
    },
    {
      id: "chunk:error",
      entity_type: "Chunk",
      kind: "function",
      title: "toAuthError",
      path: "src/features/auth/errors.ts",
      excerpt: "module-local error handling",
      score: 0.8,
    },
    {
      id: "chunk:config",
      entity_type: "Chunk",
      kind: "function",
      title: "parseFeatureEnv",
      path: "src/features/config/env.ts",
      excerpt: "feature-local config parsing",
      score: 0.7,
    },
    {
      id: "file:docs/conventions.md",
      entity_type: "File",
      kind: "DOC",
      title: "docs/conventions.md",
      path: "docs/conventions.md",
      excerpt: "repository fallback",
      score: 0.6,
    },
  ];
  const chunks = [
    chunk("chunk:helper", "file:src/features/auth/controller.ts", 10, 18),
    chunk("chunk:error", "file:src/features/auth/errors.ts", 4, 12),
    chunk("chunk:config", "file:src/features/config/env.ts", 20, 31),
  ];

  const classified = classifyPatternEvidence({ target, results, chunks, topK: 3 });

  assert.deepEqual(classified.tiers.map((tier) => tier.name), [
    "same_file",
    "same_module",
    "same_feature_area",
    "repo_wide",
  ]);
  assert.deepEqual(classified.tiers.map((tier) => tier.evidence.map((item) => item.id)), [
    ["chunk:helper"],
    ["chunk:error"],
    ["chunk:config"],
    ["file:docs/conventions.md"],
  ]);
  assert.equal(classified.tiers[0].evidence[0].path, "src/features/auth/controller.ts");
  assert.equal(classified.tiers[0].evidence[0].start_line, 10);
  assert.equal(classified.tiers[0].evidence[0].end_line, 18);
  assert.deepEqual(classified.tiers[0].evidence[0].matched_rules, ["rule.repo_local_pattern_review"]);
  assert.equal(classified.localPatternFound, true);
  assert.equal(classified.fallbackUsed, false);
});

test("reports repository fallback without claiming a local pattern", () => {
  const classified = classifyPatternEvidence({
    target: {
      input: "src/isolated.ts",
      entity_id: "file:src/isolated.ts",
      entity_type: "File",
      path: "src/isolated.ts",
    },
    results: [
      {
        id: "file:docs/general-practices.md",
        entity_type: "File",
        kind: "DOC",
        title: "docs/general-practices.md",
        path: "docs/general-practices.md",
        excerpt: "general fallback only",
      },
    ],
    chunks: [],
    topK: 3,
  });

  assert.equal(classified.localPatternFound, false);
  assert.equal(classified.fallbackUsed, true);
  assert.deepEqual(classified.tiers.slice(0, 3).flatMap((tier) => tier.evidence), []);
  assert.equal(classified.tiers[3].evidence.length, 1);
});

test("filters chunk evidence when indexed line bounds are missing or invalid", () => {
  const target = {
    input: "src/a.ts",
    entity_id: "file:src/a.ts",
    entity_type: "File",
    path: "src/a.ts",
  };
  const results = [
    {
      id: "chunk:missing",
      entity_type: "Chunk",
      kind: "function",
      title: "missing",
      path: "src/b.ts",
      excerpt: "missing metadata",
    },
    {
      id: "chunk:invalid",
      entity_type: "Chunk",
      kind: "function",
      title: "invalid",
      path: "src/c.ts",
      excerpt: "invalid metadata",
    },
  ];

  const classified = classifyPatternEvidence({
    target,
    results,
    chunks: [chunk("chunk:invalid", "file:src/c.ts", 0, 0)],
    topK: 3,
  });

  assert.deepEqual(classified.tiers.flatMap((tier) => tier.evidence), []);
  assert.equal(classified.localPatternFound, false);
  assert.equal(classified.fallbackUsed, false);
});

test("retrieves each locality tier before cutoff and stays deterministic", async () => {
  const target = document("file:src/auth/handler.ts", "src/auth/handler.ts", "CODE");
  const localFile = document("file:src/auth/config.ts", "src/auth/config.ts", "CODE");
  const localChunk = {
    ...chunk("chunk:local-config", localFile.id, 7, 14),
    name: "parseLocalSetting",
    body: "environment",
    description: "module-local environment parsing",
  };
  const repoDocuments = Array.from({ length: 60 }, (_, index) =>
    document(
      `file:docs/pattern-${index}.md`,
      `docs/pattern-${index}.md`,
      "DOC",
      "environment variable parsing configuration pattern",
    ));
  const data = contextData({ documents: [target, localFile, ...repoDocuments], chunks: [localChunk] });
  const input = {
    target: target.path,
    query: "environment variable parsing configuration pattern",
    top_k: 2,
    include_deprecated: false,
  };

  const first = await runPatternEvidence(input, { data });
  const second = await runPatternEvidence(input, { data });
  const moduleTier = first.tiers.find((tier) => tier.name === "same_module");

  assert.ok(moduleTier.evidence.some((evidence) => evidence.id === localChunk.id));
  assert.equal(first.local_pattern_found, true);
  assert.equal(first.ranking_reference_time, "2026-07-12T00:00:00.000Z");
  assert.deepEqual(second, first);
});

test("runtime response exposes repository-only fallback and warning", async () => {
  const target = document("file:src/isolated.ts", "src/isolated.ts", "CODE");
  const fallback = document(
    "file:docs/general-practices.md",
    "docs/general-practices.md",
    "DOC",
    "general retry convention",
  );
  const result = await runPatternEvidence({
    target: target.path,
    query: "general retry convention",
    top_k: 2,
    include_deprecated: false,
  }, {
    data: contextData({ documents: [target, fallback] }),
  });

  assert.equal(result.local_pattern_found, false);
  assert.equal(result.fallback_used, true);
  assert.match(result.warning, /No applicable file-local, module-local, or feature-local pattern/);
  assert.equal(result.tiers[3].evidence[0].id, fallback.id);
});

test("reference time calculation stays bounded for large indexes", () => {
  const documents = Array.from({ length: 200_000 }, (_, index) => ({
    updated_at: index === 199_999 ? "2026-07-13T00:00:00.000Z" : "2026-07-12T00:00:00.000Z",
  }));
  const data = contextData({ documents });

  assert.equal(contextReferenceTimeMs(data), Date.parse("2026-07-13T00:00:00.000Z"));
});

test("equal-score evidence is stable across reversed source order", async () => {
  const target = document("file:src/isolated.ts", "src/isolated.ts", "CODE");
  const a = document("file:docs/a.md", "docs/a.md", "DOC", "shared convention");
  const b = document("file:docs/b.md", "docs/b.md", "DOC", "shared convention");
  const input = {
    target: target.path,
    query: "shared convention",
    top_k: 1,
    include_deprecated: false,
  };

  const forward = await runPatternEvidence(input, {
    data: contextData({ documents: [target, a, b] }),
  });
  const reversed = await runPatternEvidence(input, {
    data: contextData({ documents: [target, b, a] }),
  });

  assert.deepEqual(reversed, forward);
  assert.equal(forward.tiers[3].evidence[0].id, a.id);
});

test("local-only pattern evidence uses lexical search without network fetch", async () => {
  const target = document("file:src/a.ts", "src/a.ts", "CODE");
  const fallback = document("file:docs/pattern.md", "docs/pattern.md", "DOC", "shared retry convention");
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("network access is forbidden in local review");
  };

  try {
    const result = await runLocalPatternEvidence({
      target: target.path,
      query: "shared retry convention",
      top_k: 1,
      include_deprecated: false,
    }, {
      data: contextData({ documents: [target, fallback] }),
    });

    assert.equal(fetchCalls, 0);
    assert.equal(result.semantic_engine, "lexical-only");
    assert.equal(result.fallback_used, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
