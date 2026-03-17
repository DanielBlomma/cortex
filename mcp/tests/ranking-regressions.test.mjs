import test from "node:test";
import assert from "node:assert/strict";

import { buildImpactResults } from "../dist/impactResults.js";
import { buildSearchResults } from "../dist/searchResults.js";

test("buildSearchResults keeps internal scores for window dedup when output scores are hidden", () => {
  const baseChunkId = "chunk:src/example.ts:SearchTarget:1-40";
  const weakWindowId = `${baseChunkId}:window:1:1-20`;
  const strongWindowId = `${baseChunkId}:window:2:21-40`;

  const results = buildSearchResults({
    candidates: [
      {
        id: weakWindowId,
        entity_type: "Chunk",
        kind: "function",
        label: "SearchTarget#window1",
        path: "src/example.ts",
        source_of_truth: false,
        status: "active",
        updated_at: "2026-01-01T00:00:00.000Z",
        snippet: "weak excerpt",
        content: "weak match",
        text: "weak match",
        trust_level: 60,
        matched_rules: []
      },
      {
        id: strongWindowId,
        entity_type: "Chunk",
        kind: "function",
        label: "SearchTarget#window2",
        path: "src/example.ts",
        source_of_truth: false,
        status: "active",
        updated_at: "2026-01-01T00:00:00.000Z",
        snippet: "strong excerpt",
        content: "strong match",
        text: "strong match",
        trust_level: 60,
        matched_rules: []
      },
      {
        id: baseChunkId,
        entity_type: "Chunk",
        kind: "function",
        label: "SearchTarget",
        path: "src/example.ts",
        source_of_truth: false,
        status: "active",
        updated_at: "2026-01-01T00:00:00.000Z",
        snippet: "base excerpt",
        content: "base content",
        text: "base content",
        trust_level: 60,
        matched_rules: []
      }
    ],
    degreeByEntity: new Map(),
    queryTokens: ["strong"],
    queryPhrase: "strong",
    ranking: {
      semantic: 1,
      graph: 0,
      trust: 0,
      recency: 0
    },
    includeScores: false,
    includeMatchedRules: false,
    includeContent: false,
    queryVector: null,
    embeddingVectors: new Map(),
    topK: 1,
    minLexicalRelevance: 0.1,
    minVectorRelevance: 0,
    semanticScorer: (_queryTokens, _queryPhrase, text) =>
      text.includes("strong") ? 0.95 : text.includes("weak") ? 0.2 : 0,
    vectorScorer: () => 0,
    recencyScorer: () => 0,
    legacyDataAccessBooster: () => 0
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].id, baseChunkId);
  assert.equal(results[0].excerpt, "strong excerpt");
  assert.equal("score" in results[0], false);
});

test("buildImpactResults keeps internal ranking fields when output scores are hidden", () => {
  const seedId = "file:src/seed.ts";
  const configId = "chunk:App.config:DatabaseKey:1-1";
  const directCodeId = "file:src/direct.ts";
  const sqlId = "chunk:db/StoredProc.sql:dbo.RunReport:1-5";

  const results = buildImpactResults({
    visited: new Map([
      [
        configId,
        {
          hops: 1,
          via_relation: "USES_CONFIG_KEY",
          direction: "outgoing",
          via_entity: seedId,
          via_note: "DatabaseKey"
        }
      ],
      [
        directCodeId,
        {
          hops: 1,
          via_relation: "CALLS",
          direction: "outgoing",
          via_entity: seedId
        }
      ],
      [
        sqlId,
        {
          hops: 2,
          via_relation: "CALLS_SQL",
          direction: "outgoing",
          via_entity: configId,
          via_note: "critical query"
        }
      ]
    ]),
    seedId,
    catalog: new Map([
      [seedId, { id: seedId, type: "File", label: "Seed", path: "src/seed.ts", status: "active" }],
      [configId, { id: configId, type: "Chunk", label: "DatabaseKey", path: "App.config", status: "active" }],
      [directCodeId, { id: directCodeId, type: "File", label: "DirectCode", path: "src/direct.ts", status: "active" }],
      [sqlId, { id: sqlId, type: "Chunk", label: "RunReport", path: "db/StoredProc.sql", status: "active" }]
    ]),
    searchEntities: new Map([
      [
        seedId,
        {
          id: seedId,
          entity_type: "File",
          kind: "",
          label: "Seed",
          path: "src/seed.ts",
          text: "seed entry point",
          snippet: "seed entry point",
          status: "active",
          source_of_truth: false,
          trust_level: 50,
          updated_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      [
        configId,
        {
          id: configId,
          entity_type: "Chunk",
          kind: "connection_string",
          label: "DatabaseKey",
          path: "App.config",
          text: "database key",
          snippet: "database key",
          status: "active",
          source_of_truth: false,
          trust_level: 100,
          updated_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      [
        directCodeId,
        {
          id: directCodeId,
          entity_type: "File",
          kind: "",
          label: "DirectCode",
          path: "src/direct.ts",
          text: "small helper",
          snippet: "small helper",
          status: "active",
          source_of_truth: false,
          trust_level: 10,
          updated_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      [
        sqlId,
        {
          id: sqlId,
          entity_type: "Chunk",
          kind: "procedure",
          label: "RunReport",
          path: "db/StoredProc.sql",
          text: "critical query",
          snippet: "critical query",
          status: "active",
          source_of_truth: false,
          trust_level: 100,
          updated_at: "2026-01-01T00:00:00.000Z"
        }
      ]
    ]),
    degreeByEntity: new Map([
      [directCodeId, 0],
      [sqlId, 4]
    ]),
    queryTokens: ["critical", "query"],
    queryPhrase: "critical query",
    hasQuery: true,
    profile: "config_to_sql",
    includeReasons: false,
    includeScores: false,
    verbosePaths: false,
    maxPathHopsShown: 2,
    resultDomains: new Set(["sql", "code"]),
    resultEntityTypes: null,
    pathMustInclude: null,
    pathMustExclude: null,
    sortBy: "impact_score",
    topK: 2,
    semanticScorer: (_queryTokens, queryPhrase, text) => (text.includes(queryPhrase) ? 1 : 0)
  });

  assert.equal(results[0].id, sqlId);
  assert.equal(results[1].id, directCodeId);
  assert.equal("impact_score" in results[0], false);
  assert.equal("semantic_score" in results[0], false);
});
