import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  atomicWriteJson,
  atomicWriteJsonl,
  coveragePercent,
  readIndexingState,
  resolvePublishedEmbeddingsPath,
  writeProgressiveFailureIfOwned,
  writeIndexingState
} from "../dist/progressiveIndexing.js";

test("progressive snapshots replace JSONL atomically and expose deterministic metadata", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-progressive-snapshot-"));
  try {
    const target = path.join(root, "entities.progress-test-1.jsonl");
    const first = atomicWriteJsonl(target, [{ id: "b", vector: [2] }, { id: "c", vector: [3] }]);
    assert.equal(first.count, 2);
    assert.equal(first.bytes, fs.statSync(target).size);
    assert.match(first.sha256, /^[a-f0-9]{64}$/);

    const second = atomicWriteJsonl(target, [{ id: "a", vector: [1] }]);
    assert.equal(second.count, 1);
    assert.equal(fs.readFileSync(target, "utf8"), '{"id":"a","vector":[1]}\n');
    assert.deepEqual(fs.readdirSync(root), ["entities.progress-test-1.jsonl"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("published snapshot resolution is manifest-driven and rejects traversal", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-progressive-resolve-"));
  try {
    const canonical = path.join(root, "entities.jsonl");
    const manifest = path.join(root, "manifest.json");
    fs.writeFileSync(canonical, "", "utf8");
    atomicWriteJson(manifest, { snapshot_file: "entities.progress-run-2.jsonl" });
    assert.equal(
      resolvePublishedEmbeddingsPath(root, canonical, { snapshot_file: "entities.progress-run-2.jsonl" }),
      path.join(root, "entities.progress-run-2.jsonl")
    );
    assert.throws(
      () => resolvePublishedEmbeddingsPath(root, canonical, { snapshot_file: "../outside.jsonl" }),
      /snapshot_file is invalid/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("indexing state round-trips atomically with bounded coverage", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-progressive-state-"));
  try {
    const statePath = path.join(root, "indexing-state.json");
    const state = {
      schema_version: 1,
      state: "running",
      desired_state: "running",
      active_profile: "interactive",
      pid: 42,
      model: "model",
      search_ready: "lexical+graph",
      total_entities: 4,
      completed_entities: 1,
      semantic_coverage_percent: 25,
      embedded: 1,
      reused: 0,
      failed: 0,
      started_at: "2026-08-19T00:00:00.000Z",
      updated_at: "2026-08-19T00:00:01.000Z",
      last_checkpoint_at: "2026-08-19T00:00:01.000Z",
      checkpoint_sequence: 1,
      snapshot_file: "entities.progress-test-1.jsonl"
    };
    writeIndexingState(statePath, state);
    assert.deepEqual(readIndexingState(statePath), state);
    assert.equal(coveragePercent(1, 4), 25);
    assert.equal(coveragePercent(9, 4), 100);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a late failure cannot overwrite a successor run after ownership changes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-progressive-successor-"));
  try {
    const statePath = path.join(root, "indexing-state.json");
    const lockDir = path.join(root, "indexing.lock");
    fs.mkdirSync(lockDir);
    const successor = {
      schema_version: 1,
      state: "running",
      desired_state: "running",
      active_profile: "interactive",
      pid: 222,
      model: "model",
      search_ready: "lexical+graph",
      total_entities: 4,
      completed_entities: 2,
      semantic_coverage_percent: 50,
      embedded: 1,
      reused: 1,
      failed: 0,
      started_at: "2026-08-20T00:00:00.000Z",
      updated_at: "2026-08-20T00:00:01.000Z",
      last_checkpoint_at: "2026-08-20T00:00:01.000Z",
      checkpoint_sequence: 2,
      snapshot_file: "entities.progress-run-b.jsonl",
      run_id: "run-b",
      ingest_generation: "ingest-b",
      graph_generation: "graph-b",
      heartbeat_at: "2026-08-20T00:00:01.000Z",
      resources: {
        ingest_workers: 2,
        embedding_sessions: 1,
        embedding_threads: 4,
        logical_cpus: 8,
        total_memory_bytes: 16_000_000_000,
        platform: "test",
        arch: "test"
      }
    };
    writeIndexingState(statePath, successor);
    atomicWriteJson(path.join(lockDir, "owner.json"), {
      schema_version: 1,
      run_id: "run-b",
      pid: 222,
      mode: "progressive",
      action: "progressive-embed",
      created_at: "2026-08-20T00:00:01.000Z",
      lock_token: "b".repeat(32)
    });
    const before = fs.readFileSync(statePath, "utf8");

    assert.equal(
      writeProgressiveFailureIfOwned(
        statePath,
        lockDir,
        "run-a",
        111,
        "a".repeat(32),
        "late run-a failure"
      ),
      false
    );
    assert.equal(fs.readFileSync(statePath, "utf8"), before);
    assert.deepEqual(readIndexingState(statePath), successor);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function loadIndexInSubprocess(root) {
  const moduleUrl = pathToFileURL(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/embeddings.js")
  ).href;
  const script = `import { loadEmbeddingIndex } from ${JSON.stringify(moduleUrl)}; const value = loadEmbeddingIndex(); console.log(JSON.stringify({ model: value.model, size: value.vectors.size, warning: value.warning }));`;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8",
    env: { ...process.env, CORTEX_PROJECT_ROOT: root }
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function loadContextInSubprocess(root) {
  const moduleUrl = pathToFileURL(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/graph.js")
  ).href;
  return spawnSync(process.execPath, ["--input-type=module", "--eval", `import { loadContextData } from ${JSON.stringify(moduleUrl)}; await loadContextData();`], {
    encoding: "utf8",
    env: { ...process.env, CORTEX_PROJECT_ROOT: root }
  });
}

test("semantic and search readers reject redirected managed ancestors without external mutation", () => {
  if (process.platform === "win32") return;
  for (const redirected of ["cache", "embeddings"]) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), `cortex-reader-redirect-${redirected}-`));
    const root = path.join(base, "project");
    const context = path.join(root, ".context");
    const outside = path.join(base, "outside");
    try {
      fs.mkdirSync(context, { recursive: true });
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(context, "config.yaml"), "source_paths:\n  - .\n", "utf8");
      fs.mkdirSync(path.join(context, redirected === "cache" ? "embeddings" : "cache"));
      fs.writeFileSync(path.join(outside, "canary"), "unchanged", "utf8");
      fs.symlinkSync(outside, path.join(context, redirected), "dir");
      const semantic = loadIndexInSubprocess(root);
      assert.equal(semantic.model, null);
      assert.match(semantic.warning, /symlink or non-directory component/);
      const search = loadContextInSubprocess(root);
      if (redirected === "cache") assert.notEqual(search.status, 0);
      assert.deepEqual(fs.readdirSync(outside), ["canary"]);
      assert.equal(fs.readFileSync(path.join(outside, "canary"), "utf8"), "unchanged");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  }
});

test("cold foreground embedding accepts a missing canonical snapshot and publishes an empty index", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-embed-cold-missing-"));
  try {
    const context = path.join(root, ".context");
    const cache = path.join(context, "cache");
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(context, "config.yaml"), "source_paths:\n  - .\n", "utf8");
    for (const name of ["documents.jsonl", "entities.rule.jsonl", "entities.adr.jsonl"]) {
      fs.writeFileSync(path.join(cache, name), "", "utf8");
    }
    atomicWriteJson(path.join(cache, "manifest.json"), { schema_version: 2, generation_id: "ingest-cold" });
    const entry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/embed.js");
    const result = spawnSync(process.execPath, [entry], {
      encoding: "utf8",
      env: { ...process.env, CORTEX_PROJECT_ROOT: root },
      timeout: 30_000
    });
    assert.equal(result.status, 0, result.stderr);
    const embeddings = path.join(context, "embeddings");
    assert.equal(fs.readFileSync(path.join(embeddings, "entities.jsonl"), "utf8"), "");
    const manifest = JSON.parse(fs.readFileSync(path.join(embeddings, "manifest.json"), "utf8"));
    assert.deepEqual(manifest.counts, { entities: 0, embedded: 0, reused: 0, output: 0, failed: 0 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("embedding loader exposes partial coverage and rejects model-mismatched snapshots", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-progressive-loader-"));
  try {
    const dir = path.join(root, ".context", "embeddings");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(root, ".context", "config.yaml"), "source_paths:\n  - .\n", "utf8");
    fs.mkdirSync(path.join(root, ".context", "cache"), { recursive: true });
    atomicWriteJson(path.join(root, ".context", "cache", "manifest.json"), {
      schema_version: 2,
      generation_id: "ingest-1"
    });
    atomicWriteJson(path.join(root, ".context", "cache", "graph-manifest.json"), {
      schema_version: 2,
      generation_id: "graph-1"
    });
    const snapshot = path.join(dir, "entities.progress-test-1.jsonl");
    const record = { id: "file:a", model: "test/model", dimensions: 2, vector: [0.1, 0.2] };
    const metadata = atomicWriteJsonl(snapshot, [record]);
    atomicWriteJson(path.join(dir, "manifest.json"), {
      schema_version: 2,
      model: "test/model",
      dimensions: 2,
      readiness: "partial",
      semantic_coverage_percent: 50,
      snapshot_file: path.basename(snapshot),
      snapshot_bytes: metadata.bytes,
      snapshot_sha256: metadata.sha256,
      ingest_generation: "ingest-1",
      progressive: true,
      graph_generation: "graph-1",
      counts: { entities: 2, output: 1 }
    });

    const partial = loadIndexInSubprocess(root);
    assert.equal(partial.model, "test/model");
    assert.equal(partial.size, 1);
    assert.match(partial.warning, /Semantic coverage incomplete: 1\/2 \(50\.0%\)/);

    atomicWriteJson(path.join(dir, "manifest.json"), {
      schema_version: 2,
      model: "test/model",
      dimensions: 2,
      readiness: "stale",
      semantic_coverage_percent: null,
      snapshot_file: path.basename(snapshot),
      snapshot_bytes: metadata.bytes,
      snapshot_sha256: metadata.sha256,
      ingest_generation: "ingest-1",
      progressive: true,
      graph_generation: "graph-1",
      counts: { entities: 1, output: 1 }
    });
    const stale = loadIndexInSubprocess(root);
    assert.equal(stale.size, 1);
    assert.match(stale.warning, /being refreshed.*may be stale/);

    const mismatchMetadata = atomicWriteJsonl(snapshot, [{ ...record, model: "wrong/model" }]);
    atomicWriteJson(path.join(dir, "manifest.json"), {
      schema_version: 2,
      model: "test/model",
      dimensions: 2,
      readiness: "partial",
      semantic_coverage_percent: 50,
      snapshot_file: path.basename(snapshot),
      snapshot_bytes: mismatchMetadata.bytes,
      snapshot_sha256: mismatchMetadata.sha256,
      ingest_generation: "ingest-1",
      progressive: true,
      graph_generation: "graph-1",
      counts: { entities: 2, output: 1 }
    });
    const mismatch = loadIndexInSubprocess(root);
    assert.equal(mismatch.model, null);
    assert.equal(mismatch.size, 0);
    assert.match(mismatch.warning, /model mismatch/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("embedding loader fails closed for malformed metadata and snapshot integrity mismatches", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-progressive-loader-negative-"));
  try {
    const dir = path.join(root, ".context", "embeddings");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(root, ".context", "config.yaml"), "source_paths:\n  - .\n", "utf8");
    fs.mkdirSync(path.join(root, ".context", "cache"), { recursive: true });
    const ingestManifestPath = path.join(root, ".context", "cache", "manifest.json");
    atomicWriteJson(ingestManifestPath, { schema_version: 2, generation_id: "ingest-1" });
    const graphManifestPath = path.join(root, ".context", "cache", "graph-manifest.json");
    atomicWriteJson(graphManifestPath, { schema_version: 2, generation_id: "graph-1" });
    const snapshot = path.join(dir, "entities.progress-negative-1.jsonl");
    const manifestPath = path.join(dir, "manifest.json");
    const record = { id: "file:a", model: "test/model", dimensions: 2, vector: [0.1, 0.2] };
    const metadata = atomicWriteJsonl(snapshot, [record]);
    const manifest = (overrides = {}) => ({
      schema_version: 2,
      model: "test/model",
      dimensions: 2,
      readiness: "partial",
      semantic_coverage_percent: 50,
      snapshot_file: path.basename(snapshot),
      snapshot_bytes: metadata.bytes,
      snapshot_sha256: metadata.sha256,
      ingest_generation: "ingest-1",
      progressive: true,
      graph_generation: "graph-1",
      counts: { entities: 2, output: 1 },
      ...overrides
    });

    atomicWriteJson(manifestPath, manifest({ snapshot_file: "entities.progress-missing-1.jsonl" }));
    assert.match(loadIndexInSubprocess(root).warning, /snapshot missing/);

    atomicWriteJson(manifestPath, manifest({ snapshot_bytes: metadata.bytes + 1 }));
    assert.match(loadIndexInSubprocess(root).warning, /size mismatch/);

    atomicWriteJson(manifestPath, manifest({ snapshot_sha256: "0".repeat(64) }));
    assert.match(loadIndexInSubprocess(root).warning, /hash mismatch/);

    atomicWriteJson(manifestPath, manifest({ counts: { entities: 3, output: 2 } }));
    assert.match(loadIndexInSubprocess(root).warning, /count mismatch/);

    atomicWriteJson(manifestPath, manifest({ dimensions: 3 }));
    assert.match(loadIndexInSubprocess(root).warning, /dimension mismatch/);

    atomicWriteJson(manifestPath, manifest({ ingest_generation: "ingest-old" }));
    assert.match(loadIndexInSubprocess(root).warning, /does not match the current ingest generation/);

    atomicWriteJson(manifestPath, manifest({ graph_generation: undefined }));
    assert.match(loadIndexInSubprocess(root).warning, /does not match the current graph generation/);

    atomicWriteJson(manifestPath, manifest({ graph_generation: "graph-old" }));
    assert.match(loadIndexInSubprocess(root).warning, /does not match the current graph generation/);

    atomicWriteJson(graphManifestPath, { schema_version: 2, generation_id: "graph-2" });
    atomicWriteJson(manifestPath, manifest());
    assert.match(loadIndexInSubprocess(root).warning, /does not match the current graph generation/);
    atomicWriteJson(graphManifestPath, { schema_version: 2, generation_id: "graph-1" });

    atomicWriteJson(manifestPath, manifest({ progressive: false, graph_generation: undefined }));
    const foreground = loadIndexInSubprocess(root);
    assert.equal(foreground.model, "test/model");
    assert.equal(foreground.size, 1);

    atomicWriteJson(manifestPath, { ...manifest(), schema_version: undefined });
    assert.match(loadIndexInSubprocess(root).warning, /missing embedding manifest schema/);

    atomicWriteJson(manifestPath, manifest({ snapshot_file: "../outside.jsonl" }));
    assert.match(loadIndexInSubprocess(root).warning, /invalid snapshot integrity metadata/);

    fs.writeFileSync(manifestPath, "{not-json", "utf8");
    assert.match(loadIndexInSubprocess(root).warning, /unreadable or malformed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
