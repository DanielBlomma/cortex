import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyPatternEvidence,
  contextReferenceTimeMs,
  runDialectPatternEvidence,
  runLocalPatternEvidence,
  runPatternEvidence,
} from "../dist/patternEvidence.js";
import {
  DIALECT_LIMITS,
  canonicalJson,
  sha256,
  stableDialectObservationId,
} from "../../scripts/lib/dialect-observation-contract.mjs";
import {
  DIALECT_MANIFEST_FIELD,
  createDialectObservationFileRecord,
  serializeDialectObservationSidecar,
  summarizeDialectObservationSidecar,
} from "../../scripts/lib/ingest/pipeline-stages.mjs";

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

function dialectObservation(
  repositoryPath,
  chunkId,
  startLine,
  endLine,
  shape = "guarded-return",
  ordinal = 0,
) {
  const observation = {
    category: "control_flow",
    containing_chunk_id: chunkId,
    end_column: 2,
    end_line: endLine,
    family: "typescript",
    language_specific_shape: "statement",
    normalized_shape: shape,
    observation_id: "",
    ordinal,
    parser_backend: "acorn-typescript",
    repository_path: repositoryPath,
    schema_version: 1,
    start_column: 0,
    start_line: startLine,
    syntax_mode: ".ts",
  };
  observation.observation_id = stableDialectObservationId(observation);
  return observation;
}

function recurrenceFixture({ sameOwner = false, hashDrift = false } = {}) {
  const paths = ["src/a.ts", "src/b.ts"];
  const hashes = paths.map((repositoryPath) => sha256(`${repositoryPath}-source`));
  const chunkIds = sameOwner ? ["chunk:a", "chunk:a"] : ["chunk:a", "chunk:b"];
  const records = paths.map((repositoryPath, index) => createDialectObservationFileRecord({
    repositoryPath,
    sourceSha256: hashes[index],
    family: "typescript",
    syntaxMode: ".ts",
    observationEnvelope: {
      diagnostics: { message: null, observed_count: 1, omitted_count: 0 },
      observations: [dialectObservation(repositoryPath, chunkIds[index], 2 + index, 3 + index)],
      schema_version: 1,
      status: "ok",
    },
  }));
  const sidecar = serializeDialectObservationSidecar(records);
  const taskText = "find the local guarded return implementation shape";
  const sourceCatalog = paths.map((repositoryPath, index) => ({
    bytes: 100,
    line_count: 20,
    path: repositoryPath,
    source_sha256: hashDrift && index === 1 ? sha256("drift") : hashes[index],
  }));
  const taskBinding = {
    base_commit: "a".repeat(40),
    family: "typescript",
    source_scope: ["src"],
    task_bytes: Buffer.byteLength(taskText),
    task_id: "task-typescript",
    task_sha256: sha256(taskText),
  };
  const documents = paths.map((repositoryPath, index) =>
    document(`file:${repositoryPath}`, repositoryPath, "CODE", "guarded return implementation"));
  const chunks = [
    { ...chunk("chunk:a", documents[0].id, 1, 8), language: "typescript", name: "guardA" },
    { ...chunk("chunk:b", documents[1].id, 1, 9), language: "typescript", name: "guardB" },
  ];
  return {
    input: {
      task_binding: taskBinding,
      task_bytes: taskText,
      source_catalog: sourceCatalog,
      ingest_manifest: { [DIALECT_MANIFEST_FIELD]: summarizeDialectObservationSidecar(sidecar) },
      dialect_sidecar: sidecar.text,
    },
    data: contextData({ documents, chunks }),
  };
}

test("experimental dialect recurrence is deterministic, evaluator-compatible, and performs one bounded lexical search", async () => {
  const fixture = recurrenceFixture();
  const searchCalls = [];
  const search = async (params, options) => {
    searchCalls.push({ params, options });
    return { results: [{ id: "chunk:a" }, { id: "chunk:b" }] };
  };
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("network forbidden");
  };
  try {
    const first = await runDialectPatternEvidence(fixture.input, { data: fixture.data, search });
    const second = await runDialectPatternEvidence(fixture.input, {
      data: fixture.data,
      search: async () => ({ results: [{ id: "chunk:a" }, { id: "chunk:b" }] }),
    });
    assert.deepEqual(second, first);
    assert.equal(searchCalls.length, 1);
    assert.equal(searchCalls[0].params.top_k, 50);
    assert.equal(searchCalls[0].params.response_preset, "minimal");
    assert.equal(searchCalls[0].options.query_vector, null);
    assert.equal(searchCalls[0].options.embedding_index.model, null);
    assert.equal(fetchCalls, 0);
    assert.equal(first.claims.length, 1);
    assert.equal(first.claims[0].citations.length, 2);
    assert.deepEqual(
      first.claims[0].citations.map((citation) => citation.path).toSorted(),
      ["src/a.ts", "src/b.ts"],
    );
    assert.doesNotMatch(first.claims[0].statement, /\b(?:must|should|required|preferred)\b/i);
    assert.equal(first.rendered_output_bytes, Buffer.byteLength(first.rendered_output));
    assert.equal(first.rendered_output_sha256, sha256(first.rendered_output));
    assert.deepEqual(Object.keys(first).sort(), [
      "claims", "diagnostics", "rendered_output", "rendered_output_bytes", "rendered_output_sha256", "task_id",
    ]);
    assert.equal(canonicalJson(first.claims), canonicalJson(second.claims));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dialect recurrence rejects one-owner, hash-drift, family/window, and missing-sidecar evidence without positive claims", async () => {
  const oneOwner = recurrenceFixture();
  const oneOwnerHash = oneOwner.input.source_catalog[0].source_sha256;
  const oneOwnerRecord = createDialectObservationFileRecord({
    repositoryPath: "src/a.ts",
    sourceSha256: oneOwnerHash,
    family: "typescript",
    syntaxMode: ".ts",
    observationEnvelope: {
      diagnostics: { message: null, observed_count: 2, omitted_count: 0 },
      observations: [
        dialectObservation("src/a.ts", "chunk:a", 2, 3),
        dialectObservation("src/a.ts", "chunk:a", 5, 6),
      ],
      schema_version: 1,
      status: "ok",
    },
  });
  const oneOwnerSidecar = serializeDialectObservationSidecar([oneOwnerRecord]);
  oneOwner.input.source_catalog = oneOwner.input.source_catalog.slice(0, 1);
  oneOwner.input.dialect_sidecar = oneOwnerSidecar.text;
  oneOwner.input.ingest_manifest = {
    [DIALECT_MANIFEST_FIELD]: summarizeDialectObservationSidecar(oneOwnerSidecar),
  };
  oneOwner.data.documents = oneOwner.data.documents.slice(0, 1);
  oneOwner.data.chunks = oneOwner.data.chunks.slice(0, 1);
  const cases = [
    oneOwner,
    recurrenceFixture({ hashDrift: true }),
  ];
  for (const fixture of cases) {
    const result = await runDialectPatternEvidence(fixture.input, {
      data: fixture.data,
      search: async () => ({ results: fixture.data.chunks.map((entry) => ({ id: entry.id })) }),
    });
    assert.deepEqual(result.claims, []);
    assert.ok(result.diagnostics.length > 0);
  }

  const familyDrift = recurrenceFixture();
  familyDrift.input.task_binding.family = "javascript";
  const driftResult = await runDialectPatternEvidence(familyDrift.input, {
    data: familyDrift.data,
    search: async () => ({ results: [{ id: "chunk:a:window:0" }, { id: "chunk:b" }] }),
  });
  assert.deepEqual(driftResult.claims, []);

  const windowOnly = recurrenceFixture();
  const windowResult = await runDialectPatternEvidence(windowOnly.input, {
    data: windowOnly.data,
    search: async () => ({ results: [{ id: "chunk:a:window:0" }, { id: "chunk:b" }] }),
  });
  assert.deepEqual(windowResult.claims, []);

  const unsupported = recurrenceFixture();
  const unsupportedRecords = unsupported.input.source_catalog.map((source) =>
    createDialectObservationFileRecord({
      repositoryPath: source.path,
      sourceSha256: source.source_sha256,
      family: "typescript",
      syntaxMode: ".ts",
      observationEnvelope: {
        diagnostics: { message: "capability unavailable", observed_count: 0, omitted_count: 0 },
        observations: [],
        schema_version: 1,
        status: "unsupported",
      },
    }));
  const unsupportedSidecar = serializeDialectObservationSidecar(unsupportedRecords);
  unsupported.input.dialect_sidecar = unsupportedSidecar.text;
  unsupported.input.ingest_manifest = {
    [DIALECT_MANIFEST_FIELD]: summarizeDialectObservationSidecar(unsupportedSidecar),
  };
  const unsupportedResult = await runDialectPatternEvidence(unsupported.input, {
    data: unsupported.data,
    search: async () => ({ results: [{ id: "chunk:a" }, { id: "chunk:b" }] }),
  });
  assert.deepEqual(unsupportedResult.claims, []);

  const absent = recurrenceFixture();
  delete absent.input.dialect_sidecar;
  absent.input.ingest_manifest = JSON.stringify(absent.input.ingest_manifest);
  const missingResult = await runDialectPatternEvidence(absent.input, {
    data: absent.data,
    search: async () => {
      throw new Error("search must not run for missing sidecar");
    },
  });
  assert.deepEqual(missingResult.claims, []);
  assert.match(missingResult.diagnostics.join(" "), /unavailable/i);

  const invalidTask = recurrenceFixture();
  invalidTask.input.task_binding.task_id = "x".repeat(DIALECT_LIMITS.max_identifier_chars + 1);
  const invalidTaskResult = await runDialectPatternEvidence(invalidTask.input, {
    data: invalidTask.data,
    search: async () => {
      throw new Error("search must not run for an invalid task id");
    },
  });
  assert.equal(invalidTaskResult.task_id, "invalid-task");
  assert.deepEqual(invalidTaskResult.claims, []);

  const oversizedManifest = recurrenceFixture();
  oversizedManifest.input.ingest_manifest = " ".repeat(DIALECT_LIMITS.max_canonical_input_bytes + 1);
  const oversizedManifestResult = await runDialectPatternEvidence(oversizedManifest.input, {
    data: oversizedManifest.data,
    search: async () => {
      throw new Error("search must not run for an oversized manifest");
    },
  });
  assert.deepEqual(oversizedManifestResult.claims, []);
  assert.match(oversizedManifestResult.diagnostics.join(" "), /unavailable/i);

  const duplicate = recurrenceFixture();
  const duplicateRecords = duplicate.input.source_catalog.map((source, index) => {
    const observation = dialectObservation(
      source.path,
      index === 0 ? "chunk:a" : "chunk:b",
      2 + index,
      3 + index,
    );
    const observations = index === 0
      ? [observation, dialectObservation(source.path, "chunk:a", 2, 3, "guarded-return", 1)]
      : [observation];
    return createDialectObservationFileRecord({
      repositoryPath: source.path,
      sourceSha256: source.source_sha256,
      family: "typescript",
      syntaxMode: ".ts",
      observationEnvelope: {
        diagnostics: { message: null, observed_count: observations.length, omitted_count: 0 },
        observations,
        schema_version: 1,
        status: "ok",
      },
    });
  });
  const duplicateSidecar = serializeDialectObservationSidecar(duplicateRecords);
  duplicate.input.dialect_sidecar = duplicateSidecar.text;
  duplicate.input.ingest_manifest = {
    [DIALECT_MANIFEST_FIELD]: summarizeDialectObservationSidecar(duplicateSidecar),
  };
  const duplicateResult = await runDialectPatternEvidence(duplicate.input, {
    data: duplicate.data,
    search: async () => ({ results: [{ id: "chunk:a" }, { id: "chunk:b" }] }),
  });
  assert.deepEqual(duplicateResult.claims, []);
  assert.match(duplicateResult.diagnostics.join(" "), /duplicate/i);
});

test("explicit dialect evaluation does not mutate the existing public pattern-evidence output", async () => {
  const target = document("file:src/a.ts", "src/a.ts", "CODE", "shared convention");
  const fallback = document("file:docs/pattern.md", "docs/pattern.md", "DOC", "shared convention");
  const data = contextData({ documents: [target, fallback] });
  const input = { target: target.path, query: "shared convention", top_k: 1, include_deprecated: false };
  const before = await runLocalPatternEvidence(input, { data });
  const fixture = recurrenceFixture();
  await runDialectPatternEvidence(fixture.input, {
    data: fixture.data,
    search: async () => ({ results: [{ id: "chunk:a" }, { id: "chunk:b" }] }),
  });
  const after = await runLocalPatternEvidence(input, { data });
  assert.deepEqual(after, before);
});

test("dialect recurrence rejects frozen citation and claim cap overflow", async () => {
  const taskText = "find recurring capped local implementation shapes";
  const taskBinding = {
    base_commit: "b".repeat(40),
    family: "typescript",
    source_scope: ["src"],
    task_bytes: Buffer.byteLength(taskText),
    task_id: "task-typescript-caps",
    task_sha256: sha256(taskText),
  };

  const citationPaths = Array.from({ length: 12 }, (_, index) =>
    `src/citation-${String(index).padStart(2, "0")}.ts`);
  const citationRecords = citationPaths.map((repositoryPath, index) =>
    createDialectObservationFileRecord({
      repositoryPath,
      sourceSha256: sha256(`${repositoryPath}-source`),
      family: "typescript",
      syntaxMode: ".ts",
      observationEnvelope: {
        diagnostics: { message: null, observed_count: 1, omitted_count: 0 },
        observations: [dialectObservation(repositoryPath, `chunk:citation:${index}`, 2, 2)],
        schema_version: 1,
        status: "ok",
      },
    }));
  const citationSidecar = serializeDialectObservationSidecar(citationRecords);
  const citationDocuments = citationPaths.map((repositoryPath) =>
    document(`file:${repositoryPath}`, repositoryPath, "CODE", "guarded return"));
  const citationChunks = citationPaths.map((repositoryPath, index) => ({
    ...chunk(`chunk:citation:${index}`, `file:${repositoryPath}`, 1, 10),
    language: "typescript",
  }));
  const citationInput = {
    task_binding: taskBinding,
    task_bytes: taskText,
    source_catalog: citationPaths.map((repositoryPath) => ({
      bytes: 100,
      line_count: 20,
      path: repositoryPath,
      source_sha256: sha256(`${repositoryPath}-source`),
    })),
    ingest_manifest: { [DIALECT_MANIFEST_FIELD]: summarizeDialectObservationSidecar(citationSidecar) },
    dialect_sidecar: citationSidecar.text,
  };
  const citationResult = await runDialectPatternEvidence(citationInput, {
    data: contextData({ documents: citationDocuments, chunks: citationChunks }),
    search: async () => ({ results: citationChunks.map((entry) => ({ id: entry.id })) }),
  });
  assert.deepEqual(citationResult.claims, []);
  assert.match(citationResult.diagnostics.join(" "), /citation cap/i);

  const claimPaths = ["src/claims-a.ts", "src/claims-b.ts"];
  const claimRecords = claimPaths.map((repositoryPath, pathIndex) => {
    const observations = Array.from({ length: 101 }, (_, index) =>
      dialectObservation(
        repositoryPath,
        `chunk:claims:${pathIndex}`,
        index + 1,
        index + 1,
        `shape-${String(index).padStart(3, "0")}`,
      ));
    return createDialectObservationFileRecord({
      repositoryPath,
      sourceSha256: sha256(`${repositoryPath}-source`),
      family: "typescript",
      syntaxMode: ".ts",
      observationEnvelope: {
        diagnostics: { message: null, observed_count: observations.length, omitted_count: 0 },
        observations,
        schema_version: 1,
        status: "ok",
      },
    });
  });
  const claimSidecar = serializeDialectObservationSidecar(claimRecords);
  const claimDocuments = claimPaths.map((repositoryPath) =>
    document(`file:${repositoryPath}`, repositoryPath, "CODE", "many recurring shapes"));
  const claimChunks = claimPaths.map((repositoryPath, index) => ({
    ...chunk(`chunk:claims:${index}`, `file:${repositoryPath}`, 1, 200),
    language: "typescript",
  }));
  const claimInput = {
    task_binding: taskBinding,
    task_bytes: taskText,
    source_catalog: claimPaths.map((repositoryPath) => ({
      bytes: 1000,
      line_count: 200,
      path: repositoryPath,
      source_sha256: sha256(`${repositoryPath}-source`),
    })),
    ingest_manifest: { [DIALECT_MANIFEST_FIELD]: summarizeDialectObservationSidecar(claimSidecar) },
    dialect_sidecar: claimSidecar.text,
  };
  const claimResult = await runDialectPatternEvidence(claimInput, {
    data: contextData({ documents: claimDocuments, chunks: claimChunks }),
    search: async () => ({ results: claimChunks.map((entry) => ({ id: entry.id })) }),
  });
  assert.deepEqual(claimResult.claims, []);
  assert.match(claimResult.diagnostics.join(" "), /task cap/i);
});
