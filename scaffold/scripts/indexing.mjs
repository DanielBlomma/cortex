#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function resolveRepoRoot() {
  const candidates = [
    process.env.CORTEX_PROJECT_ROOT?.trim() ? path.resolve(process.env.CORTEX_PROJECT_ROOT.trim()) : null,
    process.cwd(),
    path.resolve(SCRIPT_DIR, "../.."),
    path.resolve(SCRIPT_DIR, "..")
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (
      fs.existsSync(path.join(candidate, ".context", "mcp")) ||
      fs.existsSync(path.join(candidate, "scaffold", "mcp"))
    ) {
      return candidate;
    }
  }
  return path.resolve(SCRIPT_DIR, "../..");
}

const REPO_ROOT = resolveRepoRoot();
const MCP_DIR = path.join(REPO_ROOT, ".context", "mcp");
const EMBEDDINGS_DIR = path.join(REPO_ROOT, ".context", "embeddings");
const STATE_PATH = path.join(EMBEDDINGS_DIR, "indexing-state.json");
const CONTROL_PATH = path.join(EMBEDDINGS_DIR, "indexing-control.json");
const LOG_PATH = path.join(EMBEDDINGS_DIR, "indexing.log");
const LOCK_DIR = path.join(REPO_ROOT, ".context", "indexing.lock");
const LOCK_OWNER_PATH = path.join(LOCK_DIR, "owner.json");
const INGEST_MANIFEST_PATH = path.join(REPO_ROOT, ".context", "cache", "manifest.json");
const GRAPH_MANIFEST_PATH = path.join(REPO_ROOT, ".context", "cache", "graph-manifest.json");
const EMBEDDINGS_MANIFEST_PATH = path.join(EMBEDDINGS_DIR, "manifest.json");
const GRAPH_DB_PATH = path.join(REPO_ROOT, ".context", "db", "graph.ryu");
const LOCK_PARENT = path.dirname(LOCK_DIR);
const PRIVATE_LOCK_NAME = /^\.indexing\.lock\.(stage|release|reclaim)-(\d+)-([a-f0-9]{32})$/;
const INTERACTIVE_RESOURCES = Object.freeze({
  ingest_workers: 2,
  embedding_sessions: 1,
  embedding_threads: 4
});

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function ensureSecureDirectory(targetDir) {
  const root = path.resolve(REPO_ROOT);
  const target = path.resolve(targetDir);
  if (!isWithin(root, target)) throw new Error(`Managed directory escapes repository: ${target}`);
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Repository root is not a secure directory");
  let current = root;
  for (const segment of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(`Managed path has a symlink or non-directory component: ${current}`);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      fs.mkdirSync(current, { mode: 0o700 });
    }
  }
  if (!isWithin(fs.realpathSync(root), fs.realpathSync(target))) {
    throw new Error(`Managed directory resolves outside repository: ${target}`);
  }
}

function assertSecureDirectory(targetDir) {
  const root = path.resolve(REPO_ROOT);
  const target = path.resolve(targetDir);
  if (!isWithin(root, target)) throw new Error(`Managed directory escapes repository: ${target}`);
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Repository root is not a secure directory");
  let current = root;
  for (const segment of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Managed path has a symlink or non-directory component: ${current}`);
    }
  }
  if (!isWithin(fs.realpathSync(root), fs.realpathSync(target))) {
    throw new Error(`Managed directory resolves outside repository: ${target}`);
  }
}

function assertReplaceableFile(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) {
      throw new Error(`Managed file is not a private regular file: ${filePath}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function fsyncDirectory(directoryPath) {
  let fd;
  try {
    fd = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(fd);
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EISDIR", "EPERM"].includes(error?.code || "")) throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function atomicWriteJson(filePath, value) {
  ensureSecureDirectory(path.dirname(filePath));
  assertReplaceableFile(filePath);
  const tempPath = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    const fd = fs.openSync(tempPath, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tempPath, filePath);
    fs.chmodSync(filePath, 0o600);
    fsyncDirectory(path.dirname(filePath));
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function readJson(filePath) {
  try {
    assertSecureDirectory(path.dirname(filePath));
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) return null;
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    const fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
    try {
      const opened = fs.fstatSync(fd);
      if (!opened.isFile() || opened.nlink > 1 || opened.dev !== stat.dev || opened.ino !== stat.ino) return null;
      return JSON.parse(fs.readFileSync(fd, "utf8"));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function supportsProgressiveBackground(platform = process.platform) {
  return platform !== "win32";
}

function processMatchesProgressiveWorker(pid, runId) {
  if (!processAlive(pid) || typeof runId !== "string" || !runId) return false;
  if (!supportsProgressiveBackground()) return false;
  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  if (result.status !== 0) return false;
  const command = result.stdout || "";
  return command.includes("dist/embed.js") && command.includes(`--run-id ${runId}`);
}

function graphReadiness() {
  const ingest = readJson(INGEST_MANIFEST_PATH);
  const graph = readJson(GRAPH_MANIFEST_PATH);
  const ingestGeneration = ingest?.schema_version === 2 && typeof ingest.generation_id === "string"
    ? ingest.generation_id
    : "";
  let validDb = false;
  try {
    const dbPath = path.resolve(String(graph?.db_path || ""));
    const dbDir = path.resolve(path.dirname(GRAPH_DB_PATH));
    assertSecureDirectory(dbDir);
    if (path.dirname(dbPath) !== dbDir || !/^graph-[A-Za-z0-9-]+\.ryu$/.test(path.basename(dbPath))) {
      throw new Error("Graph manifest points outside the managed graph directory");
    }
    const stat = fs.lstatSync(dbPath);
    validDb =
      stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1;
  } catch {
    validDb = false;
  }
  const valid = Boolean(
    ingestGeneration &&
    graph?.schema_version === 2 &&
    typeof graph.generation_id === "string" && graph.generation_id &&
    graph.ingest_generation === ingestGeneration &&
    validDb &&
    Number.isInteger(graph?.counts?.files) && graph.counts.files === ingest?.counts?.files &&
    Number.isInteger(graph?.counts?.chunks) && graph.counts.chunks === ingest?.counts?.chunks
  );
  return {
    ready: valid,
    ingest_generation: ingestGeneration,
    graph_generation: valid ? graph.generation_id : ""
  };
}

function embeddingReadiness(graph) {
  const manifest = readJson(EMBEDDINGS_MANIFEST_PATH);
  const total = Number(manifest?.counts?.entities);
  const completed = Number(manifest?.counts?.output);
  const validCounts = Number.isInteger(total) && total >= 0 && Number.isInteger(completed) && completed >= 0 && completed <= total;
  if (
    !graph.ready ||
    manifest?.schema_version !== 2 ||
    manifest?.ingest_generation !== graph.ingest_generation ||
    (manifest?.progressive === true && manifest?.graph_generation !== graph.graph_generation) ||
    manifest?.readiness !== "full" ||
    !validCounts || completed !== total || Number(manifest?.counts?.failed || 0) !== 0 ||
    typeof manifest?.model !== "string" || !manifest.model ||
    !Number.isInteger(manifest?.dimensions) || manifest.dimensions <= 0 ||
    typeof manifest?.snapshot_file !== "string" ||
    !/^entities(?:\.progress-[A-Za-z0-9-]+)?\.jsonl$/.test(manifest.snapshot_file) ||
    path.basename(manifest.snapshot_file) !== manifest.snapshot_file ||
    !Number.isInteger(manifest?.snapshot_bytes) || manifest.snapshot_bytes < 0 ||
    typeof manifest?.snapshot_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(manifest.snapshot_sha256)
  ) {
    return { full: false, manifest, total: validCounts ? total : 0, completed: validCounts ? completed : 0 };
  }
  const snapshotPath = path.join(EMBEDDINGS_DIR, manifest.snapshot_file);
  try {
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    const fd = fs.openSync(snapshotPath, fs.constants.O_RDONLY | noFollow);
    let bytes;
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink > 1 || stat.size !== manifest.snapshot_bytes) {
        return { full: false, manifest, total, completed };
      }
      bytes = fs.readFileSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== manifest.snapshot_sha256) return { full: false, manifest, total, completed };
    let rows = 0;
    for (const line of bytes.toString("utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      const record = JSON.parse(line);
      if (record?.model !== manifest.model || !Array.isArray(record?.vector) || record.vector.length !== manifest.dimensions) {
        return { full: false, manifest, total, completed };
      }
      rows += 1;
    }
    return { full: rows === completed, manifest, total, completed };
  } catch {
    return { full: false, manifest, total, completed };
  }
}

function validLockOwner(value) {
  return Boolean(
    value?.schema_version === 1 &&
    typeof value.run_id === "string" && value.run_id &&
    Number.isInteger(value.pid) && value.pid > 0 &&
    ["foreground", "progressive"].includes(value.mode) &&
    typeof value.action === "string" && value.action &&
    typeof value.created_at === "string" && value.created_at &&
    typeof value.lock_token === "string" && /^[a-f0-9]{32}$/.test(value.lock_token)
  );
}

function readLockOwner(lockDir = LOCK_DIR) {
  const owner = readJson(path.join(lockDir, "owner.json"));
  return validLockOwner(owner) ? owner : null;
}

function lockOwnerActive(owner) {
  if (!validLockOwner(owner)) return false;
  return owner.mode === "progressive"
    ? processMatchesProgressiveWorker(owner.pid, owner.run_id)
    : processAlive(owner.pid);
}

function privateLockPath(kind) {
  return path.join(
    LOCK_PARENT,
    `.indexing.lock.${kind}-${process.pid}-${crypto.randomBytes(16).toString("hex")}`
  );
}

function validatePrivateLockDirectory(lockDir, expectedOwner) {
  const name = path.basename(lockDir);
  if (
    path.dirname(lockDir) !== LOCK_PARENT ||
    (name !== path.basename(LOCK_DIR) && !PRIVATE_LOCK_NAME.test(name))
  ) {
    throw new Error(`Refusing unsafe private lock cleanup: ${lockDir}`);
  }
  const stat = fs.lstatSync(lockDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Private lock path is unsafe: ${lockDir}`);
  }
  const entries = fs.readdirSync(lockDir);
  if (entries.length !== 1 || entries[0] !== "owner.json") {
    throw new Error(`Private lock directory has unexpected contents: ${lockDir}`);
  }
  const owner = readLockOwner(lockDir);
  if (
    !owner ||
    owner.run_id !== expectedOwner.run_id ||
    owner.lock_token !== expectedOwner.lock_token
  ) {
    throw new Error(`Private lock ownership changed: ${lockDir}`);
  }
}

function removePrivateLockDirectory(lockDir, expectedOwner) {
  validatePrivateLockDirectory(lockDir, expectedOwner);
  fs.rmSync(path.join(lockDir, "owner.json"));
  fs.rmdirSync(lockDir);
  fsyncDirectory(LOCK_PARENT);
}

function cleanupOrphanedPrivateLocks() {
  assertSecureDirectory(LOCK_PARENT);
  for (const entry of fs.readdirSync(LOCK_PARENT)) {
    const match = PRIVATE_LOCK_NAME.exec(entry);
    if (!match) continue;
    const privateDir = path.join(LOCK_PARENT, entry);
    let owner;
    try {
      owner = readLockOwner(privateDir);
      if (!owner || processAlive(owner.pid)) continue;
      validatePrivateLockDirectory(privateDir, owner);
      removePrivateLockDirectory(privateDir, owner);
    } catch {
      // Fail closed without touching malformed, live, or concurrently changed artifacts.
    }
  }
}

function assertLockOwned(expectedOwner) {
  assertSecureDirectory(LOCK_DIR);
  const owner = readLockOwner();
  if (
    !owner ||
    owner.run_id !== expectedOwner.run_id ||
    owner.lock_token !== expectedOwner.lock_token
  ) {
    throw new Error("Index mutation lock ownership changed before mutation.");
  }
  return owner;
}

function reclaimStalePublishedLock() {
  let lockStat;
  try {
    lockStat = fs.lstatSync(LOCK_DIR);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  if (!lockStat.isDirectory() || lockStat.isSymbolicLink()) {
    throw new Error(`Index lock path is unsafe: ${LOCK_DIR}`);
  }
  const owner = readLockOwner();
  if (!owner) {
    throw new Error("Index mutation lock has no fully published owner; refusing automatic reclaim.");
  }
  if (processAlive(owner.pid)) {
    if (lockOwnerActive(owner)) {
      throw new Error(`Index mutation is already active (${owner.action}, pid ${owner.pid}).`);
    }
    throw new Error(`Index mutation owner pid ${owner.pid} is live but its identity cannot be verified.`);
  }
  validatePrivateLockDirectory(LOCK_DIR, owner);
  const reclaimDir = privateLockPath("reclaim");
  fs.renameSync(LOCK_DIR, reclaimDir);
  fsyncDirectory(LOCK_PARENT);
  removePrivateLockDirectory(reclaimDir, owner);
  return true;
}

export function acquireLock(owner, { onStagingReady, onClaimCreated } = {}) {
  ensureSecureDirectory(LOCK_PARENT);
  cleanupOrphanedPrivateLocks();
  const claim = {
    ...owner,
    lock_token: typeof owner.lock_token === "string" && /^[a-f0-9]{32}$/.test(owner.lock_token)
      ? owner.lock_token
      : crypto.randomBytes(16).toString("hex")
  };
  if (!validLockOwner(claim)) throw new Error("Invalid index lock owner");
  const stagingDir = privateLockPath("stage");
  fs.mkdirSync(stagingDir, { mode: 0o700 });
  try {
    atomicWriteJson(path.join(stagingDir, "owner.json"), claim);
    fsyncDirectory(stagingDir);
    onStagingReady?.(stagingDir, claim);
    onClaimCreated?.(stagingDir, claim);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        fs.lstatSync(LOCK_DIR);
        reclaimStalePublishedLock();
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      try {
        fs.renameSync(stagingDir, LOCK_DIR);
        fsyncDirectory(LOCK_PARENT);
        assertLockOwned(claim);
        return claim;
      } catch (error) {
        if (!["EEXIST", "ENOTEMPTY", "EISDIR"].includes(error?.code || "")) throw error;
        if (attempt === 0 && reclaimStalePublishedLock()) continue;
        const existing = readLockOwner();
        if (existing && lockOwnerActive(existing)) {
          throw new Error(`Index mutation is already active (${existing.action}, pid ${existing.pid}).`);
        }
        throw new Error("Index mutation lock was claimed by another process.");
      }
    }
    throw new Error("Index mutation lock was claimed by another process.");
  } finally {
    try {
      removePrivateLockDirectory(stagingDir, claim);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function updateOwnedLock(expectedOwner, patch) {
  const current = assertLockOwned(expectedOwner);
  const next = { ...current, ...patch, run_id: current.run_id, lock_token: current.lock_token };
  if (!validLockOwner(next)) throw new Error("Invalid updated index lock owner");
  atomicWriteJson(LOCK_OWNER_PATH, next);
  assertLockOwned(next);
  return next;
}

function releaseLock(expectedOwner) {
  const current = assertLockOwned(expectedOwner);
  const releaseDir = privateLockPath("release");
  fs.renameSync(LOCK_DIR, releaseDir);
  fsyncDirectory(LOCK_PARENT);
  removePrivateLockDirectory(releaseDir, current);
}

function parseProfile(args) {
  const index = args.indexOf("--profile");
  const profile = index >= 0 ? args[index + 1] : "interactive";
  if (profile !== "interactive") {
    throw new Error(`Unsupported indexing profile: ${profile || "(missing)"}. Expected interactive.`);
  }
  return profile;
}

function statusPayload() {
  const state = readJson(STATE_PATH);
  const graph = graphReadiness();
  if (!state) {
    const embedding = embeddingReadiness(graph);
    const manifest = embedding.manifest;
    return {
      schema_version: 1,
      state: embedding.full ? "complete" : "idle",
      active: false,
      search_ready: graph.ready ? "lexical+graph" : "lexical",
      total_entities: embedding.full ? embedding.total : 0,
      completed_entities: embedding.full ? embedding.completed : 0,
      semantic_coverage_percent: embedding.full ? 100 : 0,
      active_profile: embedding.full ? "foreground" : null,
      model: typeof manifest?.model === "string" ? manifest.model : null,
      pid: null,
      last_checkpoint_at: null,
      ingest_generation: graph.ingest_generation || null,
      graph_generation: graph.graph_generation || null,
      log_path: LOG_PATH
    };
  }

  const terminal = ["complete", "complete_with_failures", "failed"].includes(state.state);
  const owner = readLockOwner();
  const identityMatches = Boolean(
    owner?.mode === "progressive" &&
    owner.run_id === state.run_id &&
    owner.pid === Number(state.pid)
  );
  const alive = !terminal && identityMatches && processMatchesProgressiveWorker(Number(state.pid), state.run_id);
  const completeReady = state.state !== "complete" || embeddingReadiness(graph).full;
  const effectiveState = state.state === "complete" && !completeReady
    ? "stale"
    : !terminal && !alive ? "interrupted" : state.state;
  return {
    ...state,
    state: effectiveState,
    ...(effectiveState === "stale" ? { completed_entities: 0, semantic_coverage_percent: 0 } : {}),
    active: alive,
    search_ready:
      graph.ready && graph.ingest_generation === state.ingest_generation && graph.graph_generation === state.graph_generation
        ? "lexical+graph"
        : "lexical",
    log_path: LOG_PATH
  };
}

function writeControlState(patch) {
  const state = readJson(STATE_PATH);
  if (!state?.run_id) throw new Error("No progressive indexing state found. Run cortex bootstrap --background --profile interactive.");
  const current = readJson(CONTROL_PATH);
  atomicWriteJson(CONTROL_PATH, {
    ...current,
    schema_version: 1,
    run_id: state.run_id,
    ...patch,
    updated_at: new Date().toISOString()
  });
}

function buildRuntime() {
  if (!fs.existsSync(path.join(MCP_DIR, "package.json"))) {
    throw new Error(`Missing ${path.join(MCP_DIR, "package.json")}. Run cortex bootstrap first.`);
  }
  const result = spawnSync("npm", ["--prefix", MCP_DIR, "run", "build", "--silent"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: { ...process.env, CORTEX_PROJECT_ROOT: REPO_ROOT }
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Context runtime build failed with exit ${result.status ?? "unknown"}`);
}

async function start(profile, { resume = false } = {}) {
  if (!supportsProgressiveBackground()) {
    throw new Error("Progressive background indexing is not supported on native Windows; use WSL or foreground bootstrap.");
  }
  const current = readJson(STATE_PATH);
  if (current && statusPayload().active && !["complete", "complete_with_failures", "failed"].includes(current.state)) {
    throw new Error(`Progressive indexing is already active (pid ${current.pid}).`);
  }

  const graph = graphReadiness();
  if (!graph.ready) {
    throw new Error("Lexical+graph index is not ready for the current ingest generation. Run cortex graph-load first.");
  }
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  let lockClaim = acquireLock({
    schema_version: 1,
    run_id: runId,
    pid: process.pid,
    mode: "foreground",
    action: resume ? "progressive-resume" : "progressive-start",
    created_at: now
  });
  try {
    assertLockOwned(lockClaim);
    buildRuntime();
    ensureSecureDirectory(EMBEDDINGS_DIR);
  } catch (error) {
    releaseLock(lockClaim);
    throw error;
  }
  assertLockOwned(lockClaim);
  const manifest = readJson(EMBEDDINGS_MANIFEST_PATH);
  const initialDesiredState = resume
    ? "running"
    : process.env.CORTEX_INDEXING_START_PAUSED === "1" ? "paused" : "running";
  if (manifest) {
    atomicWriteJson(EMBEDDINGS_MANIFEST_PATH, {
      ...manifest,
      progressive: true,
      readiness: "stale",
      active_profile: profile,
      semantic_coverage_percent: null
    });
  }
  atomicWriteJson(CONTROL_PATH, {
    schema_version: 1,
    run_id: runId,
    desired_state: initialDesiredState,
    updated_at: now
  });
  const resources = {
    ...INTERACTIVE_RESOURCES,
    logical_cpus: os.cpus().length,
    total_memory_bytes: os.totalmem(),
    platform: os.platform(),
    arch: os.arch()
  };
  const launchState = {
    schema_version: 1,
    state: "starting",
    desired_state: initialDesiredState,
    active_profile: profile,
    pid: 0,
    model: current?.model || manifest?.model || process.env.CORTEX_EMBED_MODEL || "",
    search_ready: "lexical+graph",
    total_entities: current?.total_entities || manifest?.counts?.entities || 0,
    completed_entities: resume ? current?.completed_entities || 0 : 0,
    semantic_coverage_percent: resume ? current?.semantic_coverage_percent || 0 : 0,
    embedded: resume ? current?.embedded || 0 : 0,
    reused: resume ? current?.reused || 0 : 0,
    failed: 0,
    started_at: resume && current?.started_at ? current.started_at : now,
    updated_at: now,
    last_checkpoint_at: resume ? current?.last_checkpoint_at || null : null,
    checkpoint_sequence: resume ? current?.checkpoint_sequence || 0 : 0,
    snapshot_file: resume ? current?.snapshot_file || null : null,
    run_id: runId,
    ingest_generation: graph.ingest_generation,
    graph_generation: graph.graph_generation,
    heartbeat_at: now,
    resources
  };
  atomicWriteJson(STATE_PATH, launchState);
  assertReplaceableFile(LOG_PATH);
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const logFd = fs.openSync(
    LOG_PATH,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | noFollow,
    0o600
  );
  const logStat = fs.fstatSync(logFd);
  if (!logStat.isFile() || logStat.nlink > 1) {
    fs.closeSync(logFd);
    releaseLock(lockClaim);
    throw new Error(`Indexing log is not a private regular file: ${LOG_PATH}`);
  }
  const entry = path.join(MCP_DIR, "dist", "embed.js");
  const ackPath = path.join(EMBEDDINGS_DIR, `.indexing-start-${runId}.ack.json`);
  assertReplaceableFile(ackPath);
  const child = spawn(process.execPath, [entry, "--progressive", "--profile", profile, "--run-id", runId], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ["ignore", logFd, logFd, "pipe"],
    env: {
      ...process.env,
      CORTEX_PROJECT_ROOT: REPO_ROOT,
      CORTEX_INDEXING_PROGRESSIVE: "1",
      CORTEX_INDEXING_PROFILE: profile,
      CORTEX_INDEXING_RUN_ID: runId,
      CORTEX_INDEXING_LOCK_TOKEN: lockClaim.lock_token,
      CORTEX_INDEXING_HANDSHAKE_FD: "3",
      CORTEX_INDEXING_ACK_PATH: ackPath,
      CORTEX_EMBED_POOL: String(INTERACTIVE_RESOURCES.embedding_sessions),
      CORTEX_EMBED_THREADS: String(INTERACTIVE_RESOURCES.embedding_threads)
    }
  });
  fs.closeSync(logFd);
  if (!child.pid) {
    releaseLock(lockClaim);
    throw new Error("Failed to start progressive embedding process");
  }
  const handshake = child.stdio[3];
  if (!handshake || typeof handshake.end !== "function") {
    child.kill("SIGTERM");
    releaseLock(lockClaim);
    throw new Error("Failed to establish progressive worker handshake");
  }
  try {
    lockClaim = updateOwnedLock(lockClaim, {
      pid: child.pid,
      mode: "progressive",
      action: "progressive-embed",
      created_at: now
    });
    const handoffAt = new Date().toISOString();
    atomicWriteJson(STATE_PATH, {
      ...launchState,
      pid: child.pid,
      updated_at: handoffAt,
      heartbeat_at: handoffAt
    });
    handshake.end(`${runId}\n`);
    handshake.unref?.();
    const configuredStartTimeout = Number(process.env.CORTEX_INDEXING_START_TIMEOUT_MS);
    const startTimeoutMs = Number.isFinite(configuredStartTimeout) && configuredStartTimeout >= 100
      ? Math.floor(configuredStartTimeout)
      : 15_000;
    const deadline = Date.now() + startTimeoutMs;
    let acknowledged = false;
    while (Date.now() < deadline) {
      const ack = readJson(ackPath);
      if (ack?.run_id === runId && ack?.pid === child.pid) {
        acknowledged = true;
        break;
      }
      if (!processAlive(child.pid)) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!acknowledged) {
      throw new Error(`Progressive worker did not acknowledge startup within ${startTimeoutMs} ms`);
    }
    const ackStat = fs.lstatSync(ackPath);
    if (!ackStat.isFile() || ackStat.isSymbolicLink() || ackStat.nlink > 1) {
      throw new Error("Progressive worker startup acknowledgement is unsafe");
    }
    fs.rmSync(ackPath);
  } catch (error) {
    handshake.destroy();
    child.kill("SIGTERM");
    fs.rmSync(ackPath, { force: true });
    releaseLock(lockClaim);
    throw error;
  }
  child.unref();
  return child.pid;
}

function printStatus(payload, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  console.log(`[indexing] state=${payload.state} active=${payload.active ? "yes" : "no"} pid=${payload.pid ?? "none"}`);
  console.log(`[indexing] search_ready=${payload.search_ready} semantic_coverage=${payload.completed_entities}/${payload.total_entities} (${payload.semantic_coverage_percent}%)`);
  console.log(`[indexing] profile=${payload.active_profile ?? "none"} embedded=${payload.embedded ?? 0} reused=${payload.reused ?? 0} failed=${payload.failed ?? 0}`);
  if (payload.resources) {
    console.log(`[indexing] resources ingest_workers=${payload.resources.ingest_workers} embedding_sessions=${payload.resources.embedding_sessions} embedding_threads=${payload.resources.embedding_threads} logical_cpus=${payload.resources.logical_cpus}`);
  }
  console.log(`[indexing] last_checkpoint=${payload.last_checkpoint_at ?? "none"}`);
  console.log(`[indexing] log=${payload.log_path}`);
}

async function pause() {
  const payload = statusPayload();
  if (!payload.active) throw new Error(`Progressive indexing is not active (state=${payload.state}).`);
  writeControlState({ desired_state: "paused" });
  const configuredTimeout = Number(process.env.CORTEX_INDEXING_PAUSE_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout >= 50
    ? Math.floor(configuredTimeout)
    : 15_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const next = statusPayload();
    if (next.state === "paused") {
      printStatus(next, false);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Pause was not checkpointed within ${timeoutMs} ms; indexing may still be running.`);
}

async function resume() {
  const payload = statusPayload();
  if (payload.active) {
    writeControlState({ desired_state: "running" });
    console.log(`[indexing] resumed pid=${payload.pid}`);
    return;
  }
  if (!["interrupted", "failed", "complete_with_failures"].includes(payload.state)) {
    throw new Error(`Progressive indexing cannot resume from state=${payload.state}.`);
  }
  const pid = await start(payload.active_profile || "interactive", { resume: true });
  console.log(`[indexing] resumed from checkpoint pid=${pid}`);
}

function runLocked(rest) {
  const separator = rest.indexOf("--");
  if (separator <= 0 || separator === rest.length - 1) {
    throw new Error("run-locked requires: run-locked <action> -- <command> [args...]");
  }
  const action = rest[0];
  const command = rest[separator + 1];
  const commandArgs = rest.slice(separator + 2);
  const inheritedRunId = process.env.CORTEX_INDEXING_RUN_ID || "";
  const inheritedLockToken = process.env.CORTEX_INDEXING_LOCK_TOKEN || "";
  const existing = readLockOwner();
  const nested = Boolean(
    inheritedRunId &&
    inheritedLockToken &&
    existing?.run_id === inheritedRunId &&
    existing.lock_token === inheritedLockToken &&
    lockOwnerActive(existing)
  );
  const runId = nested ? inheritedRunId : crypto.randomUUID();
  const lockClaim = nested
    ? existing
    : acquireLock({
      schema_version: 1,
      run_id: runId,
      pid: process.pid,
      mode: "foreground",
      action,
      created_at: new Date().toISOString()
    });
  try {
    assertLockOwned(lockClaim);
    const result = spawnSync(command, commandArgs, {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        CORTEX_INDEXING_RUN_ID: runId,
        CORTEX_INDEXING_LOCK_TOKEN: lockClaim.lock_token
      }
    });
    if (result.error) throw result.error;
    if (result.signal) throw new Error(`${action} terminated by signal ${result.signal}`);
    if (result.status !== 0) process.exitCode = result.status ?? 1;
  } finally {
    if (!nested) releaseLock(lockClaim);
  }
}

export async function runIndexingCommand(args = process.argv.slice(2)) {
  const [command = "status", ...rest] = args;
  if (command === "status") {
    printStatus(statusPayload(), rest.includes("--json"));
    return;
  }
  if (command === "start") {
    const profile = parseProfile(rest);
    const pid = await start(profile);
    console.log(`[indexing] started pid=${pid} profile=${profile}`);
    return;
  }
  if (command === "pause") {
    await pause();
    return;
  }
  if (command === "resume") {
    await resume();
    return;
  }
  if (command === "run-locked") {
    runLocked(rest);
    return;
  }
  throw new Error(`Unknown indexing subcommand: ${command}. Try status|pause|resume.`);
}

const invokedAsScript = process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invokedAsScript) {
  runIndexingCommand().catch((error) => {
    process.stderr.write(`[indexing] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
