import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { supportsProgressiveBackground } from "../scaffold/scripts/indexing.mjs";

const SOURCE = new URL("../scaffold/scripts/indexing.mjs", import.meta.url);

test("native Windows background indexing is explicitly unsupported", () => {
  assert.equal(supportsProgressiveBackground("win32"), false);
  assert.equal(supportsProgressiveBackground("linux"), true);
  assert.equal(supportsProgressiveBackground("darwin"), true);
});

function createProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-indexing-cli-"));
  const scripts = path.join(root, ".context", "scripts");
  fs.mkdirSync(path.join(root, ".context", "mcp"), { recursive: true });
  fs.mkdirSync(scripts, { recursive: true });
  fs.copyFileSync(SOURCE, path.join(scripts, "indexing.mjs"));
  return root;
}

function run(root, args, env = {}) {
  return spawnSync(process.execPath, [path.join(root, ".context", "scripts", "indexing.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

function writeReadyGraph(root, generation = "ingest-1") {
  const canonicalRoot = fs.realpathSync(root);
  const cache = path.join(canonicalRoot, ".context", "cache");
  const db = path.join(canonicalRoot, ".context", "db", "graph-graph-1.ryu");
  fs.mkdirSync(path.dirname(db), { recursive: true });
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(db, "graph", "utf8");
  fs.writeFileSync(path.join(cache, "manifest.json"), JSON.stringify({
    schema_version: 2,
    generation_id: generation,
    generated_at: "2026-08-19T00:00:00.000Z",
    counts: { files: 1, chunks: 1 }
  }), "utf8");
  fs.writeFileSync(path.join(cache, "graph-manifest.json"), JSON.stringify({
    schema_version: 2,
    generation_id: "graph-1",
    ingest_generation: generation,
    db_path: db,
    counts: { files: 1, chunks: 1 }
  }), "utf8");
}

test("a contender delayed beyond 1.1 seconds cannot reclaim a published live owner", () => {
  const root = createProject();
  try {
    const scriptPath = path.join(root, ".context", "scripts", "indexing.mjs");
    const mutationPath = path.join(root, "mutations.txt");
    const contenderArgs = [
      "run-locked", "contender", "--", process.execPath, "-e",
      `require("fs").appendFileSync(${JSON.stringify(mutationPath)}, "loser\\n")`
    ];
    const ownerPath = path.join(root, ".context", "indexing.lock", "owner.json");
    const program = [
      `import fs from "node:fs";`,
      `import { spawnSync } from "node:child_process";`,
      `import { pathToFileURL } from "node:url";`,
      `const { acquireLock } = await import(pathToFileURL(${JSON.stringify(scriptPath)}).href);`,
      `const claim = acquireLock({ schema_version: 1, run_id: "winner", pid: process.pid, mode: "foreground", action: "winner", created_at: new Date().toISOString() });`,
      `const before = fs.readFileSync(${JSON.stringify(ownerPath)}, "utf8");`,
      `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);`,
      `const loser = spawnSync(process.execPath, [${JSON.stringify(scriptPath)}, ...${JSON.stringify(contenderArgs)}], { cwd: ${JSON.stringify(root)}, encoding: "utf8" });`,
      `const after = fs.readFileSync(${JSON.stringify(ownerPath)}, "utf8");`,
      `fs.appendFileSync(${JSON.stringify(mutationPath)}, "winner\\n");`,
      `console.log(JSON.stringify({ status: loser.status, stderr: loser.stderr, claim, before, after }));`
    ].join("\n");
    const winner = spawnSync(process.execPath, ["--input-type=module", "--eval", program], {
      cwd: root,
      encoding: "utf8"
    });
    assert.equal(winner.status, 0, winner.stderr);
    const observed = JSON.parse(winner.stdout);
    assert.equal(observed.status, 1);
    assert.match(observed.stderr, /already active/);
    assert.equal(observed.before, observed.after);
    assert.equal(JSON.parse(observed.after).lock_token, observed.claim.lock_token);
    assert.equal(fs.readFileSync(mutationPath, "utf8"), "winner\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("simultaneous contenders allow exactly one mutation and preserve the winner owner", async () => {
  const root = createProject();
  try {
    const scriptPath = path.join(root, ".context", "scripts", "indexing.mjs");
    const mutationPath = path.join(root, "mutations.txt");
    const ownerPath = path.join(root, "winner-owner.json");
    const mutation = [
      `const fs = require("node:fs");`,
      `const lockOwnerPath = ${JSON.stringify(path.join(root, ".context", "indexing.lock", "owner.json"))};`,
      `const before = fs.readFileSync(lockOwnerPath, "utf8");`,
      `fs.appendFileSync(${JSON.stringify(mutationPath)}, "mutation\\n");`,
      `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);`,
      `const after = fs.readFileSync(lockOwnerPath, "utf8");`,
      `fs.writeFileSync(${JSON.stringify(ownerPath)}, JSON.stringify({ before, after }));`
    ].join("\n");
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => new Promise((resolve) => {
      const child = spawn(process.execPath, [
        scriptPath,
        "run-locked", `contender-${index}`, "--", process.execPath, "-e", mutation
      ], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("close", (status) => resolve({ status, stdout, stderr }));
    })));
    const winners = results.filter((result) => result.status === 0);
    const losers = results.filter((result) => result.status !== 0);
    assert.equal(winners.length, 1, JSON.stringify(results));
    assert.equal(losers.length, 7, JSON.stringify(results));
    assert.ok(losers.every((result) => /already active|claimed by another/.test(result.stderr)));
    assert.equal(fs.readFileSync(mutationPath, "utf8"), "mutation\n");
    const observed = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
    assert.equal(observed.before, observed.after);
    assert.equal(fs.existsSync(path.join(root, ".context", "indexing.lock")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a crash before publication leaves no canonical lock and orphan cleanup permits retry", () => {
  const root = createProject();
  try {
    const scriptPath = path.join(root, ".context", "scripts", "indexing.mjs");
    const crashProgram = [
      `import { pathToFileURL } from "node:url";`,
      `const { acquireLock } = await import(pathToFileURL(${JSON.stringify(scriptPath)}).href);`,
      `acquireLock({ schema_version: 1, run_id: "crash", pid: process.pid, mode: "foreground", action: "crash", created_at: new Date().toISOString() }, { onStagingReady() { process.exit(73); } });`
    ].join("\n");
    const crashed = spawnSync(process.execPath, ["--input-type=module", "--eval", crashProgram], {
      cwd: root,
      encoding: "utf8"
    });
    assert.equal(crashed.status, 73, crashed.stderr);
    assert.equal(fs.existsSync(path.join(root, ".context", "indexing.lock")), false);
    assert.equal(
      fs.readdirSync(path.join(root, ".context")).filter((entry) => entry.startsWith(".indexing.lock.stage-")).length,
      1
    );
    const marker = path.join(root, "recovered.txt");
    const recovered = run(root, [
      "run-locked", "recover", "--", process.execPath, "-e",
      `require("fs").writeFileSync(${JSON.stringify(marker)}, "ok")`
    ]);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(fs.readFileSync(marker, "utf8"), "ok");
    assert.deepEqual(
      fs.readdirSync(path.join(root, ".context")).filter((entry) => entry.startsWith(".indexing.lock.")),
      []
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("malformed canonical locks fail closed while a fully published dead owner is reclaimable", () => {
  const root = createProject();
  try {
    const lock = path.join(root, ".context", "indexing.lock");
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, "owner.json"), "{malformed", "utf8");
    const marker = path.join(root, "reclaimed.txt");
    const malformed = run(root, [
      "run-locked", "reclaim", "--", process.execPath, "-e",
      `require("fs").writeFileSync(${JSON.stringify(marker)}, "unsafe")`
    ]);
    assert.equal(malformed.status, 1);
    assert.match(malformed.stderr, /no fully published owner/);
    assert.equal(fs.existsSync(marker), false);
    const old = new Date(Date.now() - 10_000);
    fs.utimesSync(path.join(lock, "owner.json"), old, old);
    fs.utimesSync(lock, old, old);
    const stillMalformed = run(root, [
      "run-locked", "reclaim", "--", process.execPath, "-e",
      `require("fs").writeFileSync(${JSON.stringify(marker)}, "unsafe")`
    ]);
    assert.equal(stillMalformed.status, 1);
    assert.match(stillMalformed.stderr, /no fully published owner/);
    fs.rmSync(path.join(lock, "owner.json"));
    fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({
      schema_version: 1,
      run_id: "dead-owner",
      pid: 99_999_999,
      mode: "foreground",
      action: "dead",
      created_at: old.toISOString(),
      lock_token: "d".repeat(32)
    }), "utf8");
    const result = run(root, [
      "run-locked", "reclaim", "--", process.execPath, "-e",
      `require("fs").writeFileSync(${JSON.stringify(marker)}, "ok")`
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(marker, "utf8"), "ok");
    assert.equal(fs.existsSync(lock), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("indexing status --json makes lexical/graph and semantic coverage explicit", () => {
  const root = createProject();
  try {
    writeReadyGraph(root);
    const result = run(root, ["status", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const status = JSON.parse(result.stdout);
    assert.equal(status.state, "idle");
    assert.equal(status.search_ready, "lexical+graph");
    assert.equal(status.semantic_coverage_percent, 0);
    assert.equal(status.active, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("indexing status derives completed foreground coverage from the embedding manifest", () => {
  const root = createProject();
  try {
    writeReadyGraph(root);
    const embeddings = path.join(root, ".context", "embeddings");
    fs.mkdirSync(embeddings, { recursive: true });
    const snapshot = [0, 1, 2, 3]
      .map((index) => JSON.stringify({ id: `file:${index}`, model: "test/model", vector: [index, index + 1] }))
      .join("\n") + "\n";
    fs.writeFileSync(path.join(embeddings, "entities.jsonl"), snapshot, "utf8");
    fs.writeFileSync(path.join(embeddings, "manifest.json"), JSON.stringify({
      schema_version: 2,
      model: "test/model",
      dimensions: 2,
      readiness: "full",
      ingest_generation: "ingest-1",
      snapshot_file: "entities.jsonl",
      snapshot_bytes: Buffer.byteLength(snapshot),
      snapshot_sha256: crypto.createHash("sha256").update(snapshot).digest("hex"),
      counts: { entities: 4, output: 4, failed: 0 }
    }), "utf8");
    const result = run(root, ["status", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const status = JSON.parse(result.stdout);
    assert.equal(status.state, "complete");
    assert.equal(status.active_profile, "foreground");
    assert.equal(status.total_entities, 4);
    assert.equal(status.completed_entities, 4);
    assert.equal(status.semantic_coverage_percent, 100);
    assert.equal(status.search_ready, "lexical+graph");

    const embeddingManifest = path.join(embeddings, "manifest.json");
    const foregroundManifest = JSON.parse(fs.readFileSync(embeddingManifest, "utf8"));
    fs.writeFileSync(embeddingManifest, JSON.stringify({ ...foregroundManifest, progressive: true }), "utf8");
    assert.equal(JSON.parse(run(root, ["status", "--json"]).stdout).state, "idle");
    fs.writeFileSync(embeddingManifest, JSON.stringify({
      ...foregroundManifest,
      progressive: true,
      graph_generation: "graph-old"
    }), "utf8");
    assert.equal(JSON.parse(run(root, ["status", "--json"]).stdout).state, "idle");
    fs.writeFileSync(embeddingManifest, JSON.stringify({
      ...foregroundManifest,
      progressive: true,
      graph_generation: "graph-1"
    }), "utf8");
    assert.equal(JSON.parse(run(root, ["status", "--json"]).stdout).state, "complete");

    writeReadyGraph(root, "ingest-2");
    const stale = JSON.parse(run(root, ["status", "--json"]).stdout);
    assert.equal(stale.state, "idle");
    assert.equal(stale.semantic_coverage_percent, 0);
    assert.equal(stale.search_ready, "lexical+graph");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("indexing status rejects corrupt, stale, and missing graph generations", () => {
  const root = createProject();
  try {
    writeReadyGraph(root);
    const graphManifest = path.join(root, ".context", "cache", "graph-manifest.json");
    const graph = JSON.parse(fs.readFileSync(graphManifest, "utf8"));

    fs.writeFileSync(graphManifest, "{}\n", "utf8");
    assert.equal(JSON.parse(run(root, ["status", "--json"]).stdout).search_ready, "lexical");

    fs.writeFileSync(graphManifest, JSON.stringify({ ...graph, ingest_generation: "wrong" }), "utf8");
    assert.equal(JSON.parse(run(root, ["status", "--json"]).stdout).search_ready, "lexical");

    const ingestManifest = path.join(root, ".context", "cache", "manifest.json");
    fs.writeFileSync(ingestManifest, JSON.stringify({
      generated_at: "2026-08-19T00:00:00.000Z",
      counts: { files: 1, chunks: 1 }
    }), "utf8");
    fs.writeFileSync(graphManifest, JSON.stringify({
      ...graph,
      ingest_generation: "legacy:2026-08-19T00:00:00.000Z"
    }), "utf8");
    assert.equal(JSON.parse(run(root, ["status", "--json"]).stdout).search_ready, "lexical");

    writeReadyGraph(root);
    fs.writeFileSync(graphManifest, JSON.stringify(graph), "utf8");
    fs.rmSync(path.join(root, ".context", "db", "graph-graph-1.ryu"));
    assert.equal(JSON.parse(run(root, ["status", "--json"]).stdout).search_ready, "lexical");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("indexing status rejects redirected cache, DB, and embedding ancestors without external mutation", () => {
  if (process.platform === "win32") return;
  for (const redirected of ["cache", "db", "embeddings"]) {
    const root = createProject();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), `cortex-indexing-status-${redirected}-`));
    try {
      writeReadyGraph(root);
      const target = path.join(root, ".context", redirected);
      fs.rmSync(target, { recursive: true, force: true });
      fs.writeFileSync(path.join(outside, "canary"), "unchanged", "utf8");
      fs.symlinkSync(outside, target, "dir");
      const result = run(root, ["status", "--json"]);
      assert.equal(result.status, 0, result.stderr);
      const status = JSON.parse(result.stdout);
      if (redirected === "cache" || redirected === "db") assert.equal(status.search_ready, "lexical");
      assert.deepEqual(fs.readdirSync(outside), ["canary"]);
      assert.equal(fs.readFileSync(path.join(outside, "canary"), "utf8"), "unchanged");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  }
});

test("indexing status reports a dead nonterminal worker as resumable interruption", () => {
  const root = createProject();
  try {
    const embeddings = path.join(root, ".context", "embeddings");
    fs.mkdirSync(embeddings, { recursive: true });
    fs.writeFileSync(path.join(embeddings, "indexing-state.json"), JSON.stringify({
      schema_version: 1,
      state: "running",
      desired_state: "running",
      active_profile: "interactive",
      pid: 99999999,
      search_ready: "lexical+graph",
      total_entities: 100,
      completed_entities: 25,
      semantic_coverage_percent: 25,
      last_checkpoint_at: "2026-08-19T00:00:00.000Z"
    }), "utf8");
    const result = run(root, ["status", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const status = JSON.parse(result.stdout);
    assert.equal(status.state, "interrupted");
    assert.equal(status.completed_entities, 25);
    assert.equal(status.active_profile, "interactive");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("indexing status rejects a live reused PID without the Cortex run identity", () => {
  const root = createProject();
  try {
    writeReadyGraph(root);
    const embeddings = path.join(root, ".context", "embeddings");
    const lock = path.join(root, ".context", "indexing.lock");
    fs.mkdirSync(embeddings, { recursive: true });
    fs.mkdirSync(lock, { recursive: true });
    const state = {
      schema_version: 1,
      state: "running",
      desired_state: "running",
      active_profile: "interactive",
      pid: process.pid,
      run_id: "reused-run-id",
      ingest_generation: "ingest-1",
      graph_generation: "graph-1",
      search_ready: "lexical+graph",
      total_entities: 10,
      completed_entities: 2,
      semantic_coverage_percent: 20
    };
    fs.writeFileSync(path.join(embeddings, "indexing-state.json"), JSON.stringify(state), "utf8");
    fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({
      schema_version: 1,
      run_id: state.run_id,
      pid: process.pid,
      mode: "progressive",
      action: "stale-worker",
      created_at: new Date().toISOString(),
      lock_token: "e".repeat(32)
    }), "utf8");
    const status = JSON.parse(run(root, ["status", "--json"]).stdout);
    assert.equal(status.state, "interrupted");
    assert.equal(status.active, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("background worker returns control and pause/resume crosses a verified state", () => {
  const root = createProject();
  try {
    writeReadyGraph(root);
    const runtime = path.join(root, ".context", "mcp");
    const dist = path.join(runtime, "dist");
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(runtime, "package.json"), JSON.stringify({
      type: "module",
      scripts: { build: "node -e \"process.exit(0)\"" }
    }), "utf8");
    fs.writeFileSync(path.join(dist, "embed.js"), [
      'import fs from "node:fs";',
      'import crypto from "node:crypto";',
      'import path from "node:path";',
      'const handshake = fs.readFileSync(Number(process.env.CORTEX_INDEXING_HANDSHAKE_FD), "utf8").trim();',
      'if (handshake !== process.env.CORTEX_INDEXING_RUN_ID) process.exit(2);',
      'fs.writeFileSync(process.env.CORTEX_INDEXING_ACK_PATH, JSON.stringify({ run_id: process.env.CORTEX_INDEXING_RUN_ID, pid: process.pid }));',
      'const statePath = path.join(process.env.CORTEX_PROJECT_ROOT, ".context", "embeddings", "indexing-state.json");',
      'const controlPath = path.join(process.env.CORTEX_PROJECT_ROOT, ".context", "embeddings", "indexing-control.json");',
      'const writeJson = (target, value) => { const temp = `${target}.${process.pid}.tmp`; fs.writeFileSync(temp, JSON.stringify(value)); fs.renameSync(temp, target); };',
      'const state0 = JSON.parse(fs.readFileSync(statePath, "utf8"));',
      'writeJson(statePath, { ...state0, pid: process.pid, state: "running", run_id: process.env.CORTEX_INDEXING_RUN_ID });',
      'let observedPause = false;',
      'setInterval(() => {',
      '  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));',
      '  const control = JSON.parse(fs.readFileSync(controlPath, "utf8"));',
      '  if (control.desired_state === "paused") {',
      '    observedPause = true;',
      '    writeJson(statePath, { ...state, state: "paused", last_checkpoint_at: new Date().toISOString(), observed_pool: process.env.CORTEX_EMBED_POOL, observed_threads: process.env.CORTEX_EMBED_THREADS });',
      '  } else if (observedPause) {',
      '    const output = JSON.stringify({ id: "file:done", model: "test/model", vector: [1] }) + "\\n";',
      '    fs.writeFileSync(path.join(process.env.CORTEX_PROJECT_ROOT, ".context", "embeddings", "entities.jsonl"), output);',
      '    fs.writeFileSync(path.join(process.env.CORTEX_PROJECT_ROOT, ".context", "embeddings", "manifest.json"), JSON.stringify({ schema_version: 2, model: "test/model", dimensions: 1, readiness: "full", ingest_generation: "ingest-1", graph_generation: "graph-1", snapshot_file: "entities.jsonl", snapshot_bytes: Buffer.byteLength(output), snapshot_sha256: crypto.createHash("sha256").update(output).digest("hex"), counts: { entities: 1, output: 1, failed: 0 } }));',
      '    writeJson(statePath, { ...state, state: "complete", desired_state: "running", pid: process.pid, observed_pool: process.env.CORTEX_EMBED_POOL, observed_threads: process.env.CORTEX_EMBED_THREADS });',
      '    process.exit(0);',
      '  }',
      '}, 25);',
      ''
    ].join("\n"), "utf8");

    const startedAt = Date.now();
    const started = run(root, ["start", "--profile", "interactive"]);
    assert.equal(started.status, 0, started.stderr);
    assert.match(started.stdout, /started pid=\d+ profile=interactive/);
    assert.ok(Date.now() - startedAt < 5000, "background start should return control promptly");
    const startingStatus = JSON.parse(run(root, ["status", "--json"]).stdout);
    assert.ok(["starting", "running"].includes(startingStatus.state));
    assert.equal(startingStatus.active, true);

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const current = JSON.parse(run(root, ["status", "--json"]).stdout);
      if (current.active) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }

    const conflictingUpdate = run(root, [
      "run-locked",
      "update",
      "--",
      process.execPath,
      "-e",
      "process.exit(0)"
    ]);
    assert.equal(conflictingUpdate.status, 1);
    assert.match(conflictingUpdate.stderr, /Index mutation is already active/);

    const paused = run(root, ["pause"]);
    assert.equal(paused.status, 0, paused.stderr);
    assert.match(paused.stdout, /state=paused/);
    const pausedStatus = JSON.parse(run(root, ["status", "--json"]).stdout);
    assert.equal(pausedStatus.state, "paused");
    assert.ok(pausedStatus.last_checkpoint_at);

    const resumed = run(root, ["resume"]);
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.match(resumed.stdout, /resumed pid=/);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    const completed = JSON.parse(run(root, ["status", "--json"]).stdout);
    assert.equal(completed.state, "complete");
    assert.equal(completed.observed_pool, "1");
    assert.equal(completed.observed_threads, "4");
    assert.deepEqual(completed.resources, {
      ingest_workers: 2,
      embedding_sessions: 1,
      embedding_threads: 4,
      logical_cpus: completed.resources.logical_cpus,
      total_memory_bytes: completed.resources.total_memory_bytes,
      platform: completed.resources.platform,
      arch: completed.resources.arch
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pause fails nonzero when the worker does not checkpoint before the deadline", () => {
  const root = createProject();
  let workerPid = 0;
  try {
    writeReadyGraph(root);
    const runtime = path.join(root, ".context", "mcp");
    const dist = path.join(runtime, "dist");
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(runtime, "package.json"), JSON.stringify({
      type: "module",
      scripts: { build: "node -e \"process.exit(0)\"" }
    }), "utf8");
    fs.writeFileSync(path.join(dist, "embed.js"), [
      'import fs from "node:fs";',
      'import crypto from "node:crypto";',
      'import path from "node:path";',
      'const handshake = fs.readFileSync(Number(process.env.CORTEX_INDEXING_HANDSHAKE_FD), "utf8").trim();',
      'if (handshake !== process.env.CORTEX_INDEXING_RUN_ID) process.exit(2);',
      'const root = process.env.CORTEX_PROJECT_ROOT;',
      'fs.writeFileSync(process.env.CORTEX_INDEXING_ACK_PATH, JSON.stringify({ run_id: process.env.CORTEX_INDEXING_RUN_ID, pid: process.pid }));',
      'const statePath = path.join(root, ".context", "embeddings", "indexing-state.json");',
      'const state = JSON.parse(fs.readFileSync(statePath, "utf8"));',
      'fs.writeFileSync(statePath, JSON.stringify({ ...state, state: "running", pid: process.pid, run_id: process.env.CORTEX_INDEXING_RUN_ID }));',
      'setInterval(() => {}, 1000);',
      ''
    ].join("\n"), "utf8");

    const started = run(root, ["start", "--profile", "interactive"]);
    assert.equal(started.status, 0, started.stderr);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const current = JSON.parse(run(root, ["status", "--json"]).stdout);
      workerPid = current.pid || workerPid;
      if (current.active) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
    const paused = run(root, ["pause"], { CORTEX_INDEXING_PAUSE_TIMEOUT_MS: "100" });
    assert.equal(paused.status, 1);
    assert.match(paused.stderr, /not checkpointed within 100 ms/);
  } finally {
    if (workerPid) {
      try { process.kill(workerPid, "SIGTERM"); } catch {}
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("interrupted resume continues from the published snapshot without duplicates", () => {
  const root = createProject();
  let workerPid = 0;
  try {
    writeReadyGraph(root);
    const runtime = path.join(root, ".context", "mcp");
    const dist = path.join(runtime, "dist");
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(runtime, "package.json"), JSON.stringify({
      type: "module",
      scripts: { build: "node -e \"process.exit(0)\"" }
    }), "utf8");
    fs.writeFileSync(path.join(dist, "embed.js"), [
      'import fs from "node:fs";',
      'import crypto from "node:crypto";',
      'import path from "node:path";',
      'const handshake = fs.readFileSync(Number(process.env.CORTEX_INDEXING_HANDSHAKE_FD), "utf8").trim();',
      'if (handshake !== process.env.CORTEX_INDEXING_RUN_ID) process.exit(2);',
      'const root = process.env.CORTEX_PROJECT_ROOT;',
      'fs.writeFileSync(process.env.CORTEX_INDEXING_ACK_PATH, JSON.stringify({ run_id: process.env.CORTEX_INDEXING_RUN_ID, pid: process.pid }));',
      'const dir = path.join(root, ".context", "embeddings");',
      'const statePath = path.join(dir, "indexing-state.json");',
      'const controlPath = path.join(dir, "indexing-control.json");',
      'const marker = path.join(dir, "resume-marker");',
      'const snapshot = path.join(dir, "entities.progress-resume-1.jsonl");',
      'const state = JSON.parse(fs.readFileSync(statePath, "utf8"));',
      'if (!fs.existsSync(marker)) {',
      '  fs.writeFileSync(marker, "first");',
      '  fs.writeFileSync(snapshot, JSON.stringify({ id: "a", vector: [1] }) + "\\n");',
      '  fs.writeFileSync(statePath, JSON.stringify({ ...state, state: "running", pid: process.pid, run_id: process.env.CORTEX_INDEXING_RUN_ID, total_entities: 2, completed_entities: 1, semantic_coverage_percent: 50, snapshot_file: path.basename(snapshot), checkpoint_sequence: 1, last_checkpoint_at: new Date().toISOString() }));',
      '  setInterval(() => {}, 1000);',
      '} else {',
      '  const resumedFrom = state.completed_entities;',
      '  const rows = fs.readFileSync(snapshot, "utf8").trim().split("\\n").filter(Boolean).map(JSON.parse);',
      '  rows.push({ id: "b", model: "test/model", vector: [2] });',
      '  rows.sort((a, b) => a.id.localeCompare(b.id));',
      '  const unique = [...new Map(rows.map((row) => [row.id, row])).values()];',
      '  const output = unique.map((row) => JSON.stringify({ ...row, model: "test/model" })).join("\\n") + "\\n";',
      '  fs.writeFileSync(path.join(dir, "entities.jsonl"), output);',
      '  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ schema_version: 2, model: "test/model", dimensions: 1, readiness: "full", ingest_generation: "ingest-1", graph_generation: "graph-1", snapshot_file: "entities.jsonl", snapshot_bytes: Buffer.byteLength(output), snapshot_sha256: crypto.createHash("sha256").update(output).digest("hex"), counts: { entities: 2, output: 2, failed: 0 } }));',
      '  const resumedDesiredState = JSON.parse(fs.readFileSync(controlPath, "utf8")).desired_state;',
      '  fs.writeFileSync(statePath, JSON.stringify({ ...state, state: "complete", pid: process.pid, run_id: process.env.CORTEX_INDEXING_RUN_ID, total_entities: 2, completed_entities: 2, semantic_coverage_percent: 100, resumed_from: resumedFrom, resumed_desired_state: resumedDesiredState, output_ids: unique.map((row) => row.id) }));',
      '}',
      ''
    ].join("\n"), "utf8");

    const startPausedEnv = { CORTEX_INDEXING_START_PAUSED: "1" };
    assert.equal(run(root, ["start", "--profile", "interactive"], startPausedEnv).status, 0);
    let checkpoint;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      checkpoint = JSON.parse(run(root, ["status", "--json"]).stdout);
      workerPid = checkpoint.pid || workerPid;
      if (checkpoint.active && checkpoint.completed_entities === 1) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
    assert.equal(checkpoint.completed_entities, 1);
    process.kill(workerPid, "SIGTERM");
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const stopped = JSON.parse(run(root, ["status", "--json"]).stdout);
      if (stopped.state === "interrupted") break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }

    const resumed = run(root, ["resume"], startPausedEnv);
    assert.equal(resumed.status, 0, resumed.stderr);
    let completed;
    const observedCompleted = [];
    for (let attempt = 0; attempt < 100; attempt += 1) {
      completed = JSON.parse(run(root, ["status", "--json"]).stdout);
      observedCompleted.push(completed.completed_entities);
      if (completed.state === "complete") break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
    assert.ok(observedCompleted.every((count) => count >= 1), `resume coverage regressed: ${observedCompleted.join(",")}`);
    assert.equal(completed.state, "complete");
    assert.equal(completed.resumed_from, 1);
    assert.equal(completed.resumed_desired_state, "running");
    assert.deepEqual(completed.output_ids, ["a", "b"]);
    const output = fs.readFileSync(path.join(root, ".context", "embeddings", "entities.jsonl"), "utf8");
    assert.deepEqual(output.trim().split("\n").map(JSON.parse).map((row) => row.id), ["a", "b"]);
  } finally {
    if (workerPid) {
      try { process.kill(workerPid, "SIGTERM"); } catch {}
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("worker failure preserves graph readiness and the last published snapshot", () => {
  const root = createProject();
  try {
    writeReadyGraph(root);
    const runtime = path.join(root, ".context", "mcp");
    const dist = path.join(runtime, "dist");
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(runtime, "package.json"), JSON.stringify({
      type: "module",
      scripts: { build: "node -e \"process.exit(0)\"" }
    }), "utf8");
    fs.writeFileSync(path.join(dist, "embed.js"), [
      'import fs from "node:fs";',
      'import path from "node:path";',
      'const handshake = fs.readFileSync(Number(process.env.CORTEX_INDEXING_HANDSHAKE_FD), "utf8").trim();',
      'if (handshake !== process.env.CORTEX_INDEXING_RUN_ID) process.exit(2);',
      'const root = process.env.CORTEX_PROJECT_ROOT;',
      'fs.writeFileSync(process.env.CORTEX_INDEXING_ACK_PATH, JSON.stringify({ run_id: process.env.CORTEX_INDEXING_RUN_ID, pid: process.pid }));',
      'const dir = path.join(root, ".context", "embeddings");',
      'const statePath = path.join(dir, "indexing-state.json");',
      'const snapshot = path.join(dir, "entities.progress-failure-1.jsonl");',
      'const state = JSON.parse(fs.readFileSync(statePath, "utf8"));',
      'fs.writeFileSync(snapshot, JSON.stringify({ id: "safe", vector: [1] }) + "\\n");',
      'fs.writeFileSync(statePath, JSON.stringify({ ...state, state: "failed", pid: process.pid, run_id: process.env.CORTEX_INDEXING_RUN_ID, total_entities: 2, completed_entities: 1, semantic_coverage_percent: 50, snapshot_file: path.basename(snapshot), checkpoint_sequence: 1, error: "forced failure" }));',
      'process.exit(1);',
      ''
    ].join("\n"), "utf8");

    assert.equal(run(root, ["start", "--profile", "interactive"]).status, 0);
    let failed;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      failed = JSON.parse(run(root, ["status", "--json"]).stdout);
      if (failed.state === "failed") break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
    assert.equal(failed.state, "failed");
    assert.equal(failed.search_ready, "lexical+graph");
    assert.equal(failed.completed_entities, 1);
    assert.equal(fs.existsSync(path.join(root, ".context", "embeddings", failed.snapshot_file)), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("background start requires a matching worker acknowledgement", () => {
  const root = createProject();
  try {
    writeReadyGraph(root);
    const runtime = path.join(root, ".context", "mcp");
    const dist = path.join(runtime, "dist");
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(runtime, "package.json"), JSON.stringify({
      type: "module",
      scripts: { build: "node -e \"process.exit(0)\"" }
    }), "utf8");
    fs.writeFileSync(path.join(dist, "embed.js"), "setInterval(() => {}, 1000);\n", "utf8");

    const result = run(root, ["start", "--profile", "interactive"], {
      CORTEX_INDEXING_START_TIMEOUT_MS: "100"
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /did not acknowledge startup within 100 ms/);
    assert.equal(fs.existsSync(path.join(root, ".context", "indexing.lock")), false);
    const status = JSON.parse(run(root, ["status", "--json"]).stdout);
    assert.equal(status.active, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("background start rejects a symlinked embeddings directory", () => {
  const root = createProject();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-indexing-outside-"));
  try {
    writeReadyGraph(root);
    const runtime = path.join(root, ".context", "mcp");
    fs.writeFileSync(path.join(runtime, "package.json"), JSON.stringify({
      type: "module",
      scripts: { build: "node -e \"process.exit(0)\"" }
    }), "utf8");
    fs.symlinkSync(outside, path.join(root, ".context", "embeddings"), "dir");
    const result = run(root, ["start", "--profile", "interactive"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /symlink or non-directory component/);
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
