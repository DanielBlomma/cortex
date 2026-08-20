import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type IndexingState = {
  schema_version: 1;
  state: "starting" | "running" | "paused" | "complete" | "complete_with_failures" | "failed";
  desired_state: "running" | "paused";
  active_profile: string;
  pid: number;
  model: string;
  search_ready: "lexical+graph";
  total_entities: number;
  completed_entities: number;
  semantic_coverage_percent: number;
  embedded: number;
  reused: number;
  failed: number;
  started_at: string;
  updated_at: string;
  last_checkpoint_at: string | null;
  checkpoint_sequence: number;
  snapshot_file: string | null;
  run_id: string;
  ingest_generation: string;
  graph_generation: string;
  heartbeat_at: string;
  resources: {
    ingest_workers: number;
    embedding_sessions: number;
    embedding_threads: number;
    logical_cpus: number;
    total_memory_bytes: number;
    platform: string;
    arch: string;
  };
  error?: string;
};

export type PublishedEmbeddingManifest = {
  schema_version?: unknown;
  snapshot_file?: unknown;
};

export type IndexingLockOwner = {
  schema_version: 1;
  run_id: string;
  pid: number;
  mode: "foreground" | "progressive";
  action: string;
  created_at: string;
  lock_token: string;
};

export type AtomicJsonlResult = {
  count: number;
  bytes: number;
  sha256: string;
};

function temporaryPath(filePath: string): string {
  return `${filePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

export function ensureSecureManagedDirectory(rootDir: string, targetDir: string): void {
  const root = path.resolve(rootDir);
  const target = path.resolve(targetDir);
  if (!isWithin(root, target)) {
    throw new Error(`Managed directory escapes project root: ${target}`);
  }

  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`Project root is not a secure directory: ${root}`);
  }

  let current = root;
  const relative = path.relative(root, target);
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment);
    try {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(`Managed directory contains a symlink or non-directory component: ${current}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      fs.mkdirSync(current, { mode: 0o700 });
      const created = fs.lstatSync(current);
      if (!created.isDirectory() || created.isSymbolicLink()) {
        throw new Error(`Managed directory was replaced during creation: ${current}`);
      }
    }
  }

  const realTarget = fs.realpathSync(target);
  const realRoot = fs.realpathSync(root);
  if (!isWithin(realRoot, realTarget)) {
    throw new Error(`Managed directory resolves outside project root: ${target}`);
  }
}

export function assertSecureManagedDirectory(rootDir: string, targetDir: string): void {
  const root = path.resolve(rootDir);
  const target = path.resolve(targetDir);
  if (!isWithin(root, target)) {
    throw new Error(`Managed directory escapes project root: ${target}`);
  }
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`Project root is not a secure directory: ${root}`);
  }
  let current = root;
  for (const segment of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Managed directory contains a symlink or non-directory component: ${current}`);
    }
  }
  if (!isWithin(fs.realpathSync(root), fs.realpathSync(target))) {
    throw new Error(`Managed directory resolves outside project root: ${target}`);
  }
}

export function assertSecureManagedFile(
  rootDir: string,
  filePath: string,
  options: { allowMissing?: boolean } = {}
): void {
  assertSecureManagedDirectory(rootDir, path.dirname(filePath));
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) {
      throw new Error(`Managed file is not a private regular file: ${filePath}`);
    }
  } catch (error) {
    if (options.allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

function assertReplaceableManagedFile(filePath: string): void {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) {
      throw new Error(`Managed file is not a private regular file: ${filePath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function fsyncDirectory(directoryPath: string): void {
  let fd: number | undefined;
  try {
    fd = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(fd);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!["EINVAL", "ENOTSUP", "EISDIR", "EPERM"].includes(code ?? "")) throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export function atomicWriteText(filePath: string, text: string, rootDir?: string): void {
  if (rootDir) ensureSecureManagedDirectory(rootDir, path.dirname(filePath));
  else fs.mkdirSync(path.dirname(filePath), { recursive: true });
  assertReplaceableManagedFile(filePath);
  const tempPath = temporaryPath(filePath);
  try {
    fs.writeFileSync(tempPath, text, { encoding: "utf8", mode: 0o600 });
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

export function atomicWriteJson(filePath: string, value: unknown, rootDir?: string): void {
  atomicWriteText(filePath, `${JSON.stringify(value, null, 2)}\n`, rootDir);
}

export function atomicWriteJsonl(
  filePath: string,
  records: Iterable<unknown>,
  rootDir?: string
): AtomicJsonlResult {
  if (rootDir) ensureSecureManagedDirectory(rootDir, path.dirname(filePath));
  else fs.mkdirSync(path.dirname(filePath), { recursive: true });
  assertReplaceableManagedFile(filePath);
  const tempPath = temporaryPath(filePath);
  const hash = crypto.createHash("sha256");
  let count = 0;
  let bytes = 0;
  const fd = fs.openSync(tempPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try {
    for (const record of records) {
      const line = `${JSON.stringify(record)}\n`;
      const buffer = Buffer.from(line, "utf8");
      fs.writeSync(fd, buffer);
      hash.update(buffer);
      count += 1;
      bytes += buffer.length;
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  try {
    fs.renameSync(tempPath, filePath);
    fs.chmodSync(filePath, 0o600);
    fsyncDirectory(path.dirname(filePath));
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
  return { count, bytes, sha256: hash.digest("hex") };
}

export function readIndexingState(filePath: string, rootDir?: string): IndexingState | null {
  try {
    if (rootDir) assertSecureManagedFile(rootDir, filePath);
    const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<IndexingState>;
    return value.schema_version === 1 ? value as IndexingState : null;
  } catch {
    return null;
  }
}

export function writeIndexingState(filePath: string, state: IndexingState, rootDir?: string): void {
  atomicWriteJson(filePath, state, rootDir);
}

export function writeProgressiveFailureIfOwned(
  statePath: string,
  lockDir: string,
  runId: string,
  pid: number,
  lockToken: string,
  errorMessage: string,
  rootDir?: string
): boolean {
  const state = readIndexingState(statePath, rootDir);
  const owner = readIndexingLock(lockDir, rootDir);
  if (
    state?.run_id !== runId ||
    owner?.run_id !== runId ||
    owner.pid !== pid ||
    owner.lock_token !== lockToken ||
    owner.mode !== "progressive"
  ) return false;
  const now = new Date().toISOString();
  writeIndexingState(statePath, {
    ...state,
    state: "failed",
    pid,
    updated_at: now,
    heartbeat_at: now,
    error: errorMessage
  }, rootDir);
  return true;
}

export function readIndexingLock(lockDir: string, rootDir?: string): IndexingLockOwner | null {
  try {
    if (rootDir) {
      assertSecureManagedDirectory(rootDir, lockDir);
      assertSecureManagedFile(rootDir, path.join(lockDir, "owner.json"));
    }
    const value = JSON.parse(fs.readFileSync(path.join(lockDir, "owner.json"), "utf8")) as Partial<IndexingLockOwner>;
    if (
      value.schema_version !== 1 ||
      typeof value.run_id !== "string" || !value.run_id ||
      !Number.isInteger(value.pid) || Number(value.pid) <= 0 ||
      typeof value.lock_token !== "string" || !/^[a-f0-9]{32}$/.test(value.lock_token)
    ) return null;
    return value as IndexingLockOwner;
  } catch {
    return null;
  }
}

export function acquireIndexingLock(
  lockDir: string,
  owner: Omit<IndexingLockOwner, "lock_token"> & { lock_token?: string }
): IndexingLockOwner {
  const rootDir = path.dirname(path.dirname(lockDir));
  const lockParent = path.dirname(lockDir);
  ensureSecureManagedDirectory(rootDir, lockParent);
  const claim: IndexingLockOwner = {
    ...owner,
    lock_token: typeof owner.lock_token === "string" && /^[a-f0-9]{32}$/.test(owner.lock_token)
      ? owner.lock_token
      : crypto.randomBytes(16).toString("hex")
  };
  const existing = readIndexingLock(lockDir, rootDir);
  if (existing) {
    if (existing.run_id !== claim.run_id || existing.lock_token !== claim.lock_token) {
      throw new Error(`Index mutation is already active (${existing.action}, pid ${existing.pid})`);
    }
    atomicWriteJson(path.join(lockDir, "owner.json"), claim, rootDir);
    const updated = readIndexingLock(lockDir, rootDir);
    if (updated?.run_id !== claim.run_id || updated.lock_token !== claim.lock_token) {
      throw new Error("Index mutation lock ownership changed during handoff");
    }
    return claim;
  }

  try {
    const stat = fs.lstatSync(lockDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Index lock path is unsafe: ${lockDir}`);
    }
    throw new Error("Index mutation lock has no fully published owner; refusing automatic reclaim");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const stagingDir = path.join(
    lockParent,
    `.indexing.lock.stage-${process.pid}-${crypto.randomBytes(16).toString("hex")}`
  );
  fs.mkdirSync(stagingDir, { mode: 0o700 });
  try {
    atomicWriteJson(path.join(stagingDir, "owner.json"), claim, rootDir);
    fsyncDirectory(stagingDir);
    try {
      fs.lstatSync(lockDir);
      throw new Error("Index mutation lock was claimed by another process");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    fs.renameSync(stagingDir, lockDir);
    fsyncDirectory(lockParent);
    const published = readIndexingLock(lockDir, rootDir);
    if (published?.run_id !== claim.run_id || published.lock_token !== claim.lock_token) {
      throw new Error("Index mutation lock ownership changed during publication");
    }
    return claim;
  } catch (error) {
    if (["EEXIST", "ENOTEMPTY", "EISDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) {
      throw new Error("Index mutation lock was claimed by another process");
    }
    throw error;
  } finally {
    try {
      const stagedOwner = readIndexingLock(stagingDir, rootDir);
      if (stagedOwner?.run_id === claim.run_id && stagedOwner.lock_token === claim.lock_token) {
        fs.rmSync(path.join(stagingDir, "owner.json"));
        fs.rmdirSync(stagingDir);
        fsyncDirectory(lockParent);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export function releaseIndexingLock(lockDir: string, runId: string, lockToken: string): void {
  const rootDir = path.dirname(path.dirname(lockDir));
  const owner = readIndexingLock(lockDir, rootDir);
  if (!owner || owner.run_id !== runId || owner.lock_token !== lockToken) {
    throw new Error("Index mutation lock ownership changed before release");
  }
  const releaseDir = path.join(
    path.dirname(lockDir),
    `.indexing.lock.release-${process.pid}-${crypto.randomBytes(16).toString("hex")}`
  );
  fs.renameSync(lockDir, releaseDir);
  fsyncDirectory(path.dirname(lockDir));
  const movedOwner = readIndexingLock(releaseDir, rootDir);
  if (!movedOwner || movedOwner.run_id !== runId || movedOwner.lock_token !== lockToken) {
    throw new Error("Index mutation lock ownership changed during release");
  }
  fs.rmSync(path.join(releaseDir, "owner.json"));
  try {
    fs.rmdirSync(releaseDir);
    fsyncDirectory(path.dirname(lockDir));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function coveragePercent(completed: number, total: number): number {
  if (total <= 0) return 100;
  return Number(((Math.max(0, Math.min(completed, total)) / total) * 100).toFixed(1));
}

export function resolvePublishedEmbeddingsPath(
  embeddingsDir: string,
  canonicalPath: string,
  manifest: PublishedEmbeddingManifest | null
): string {
  if (typeof manifest?.snapshot_file !== "string" || !manifest.snapshot_file) {
    return canonicalPath;
  }
  const fileName = manifest.snapshot_file;
  if (path.basename(fileName) !== fileName || !/^entities(?:\.progress-[A-Za-z0-9-]+)?\.jsonl$/.test(fileName)) {
    throw new Error("Embedding manifest snapshot_file is invalid");
  }
  return path.join(embeddingsDir, fileName);
}

export function sha256File(filePath: string): string {
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const fd = fs.openSync(filePath, "r");
  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

export function removeOldProgressSnapshots(
  embeddingsDir: string,
  keepFiles: Iterable<string>,
  rootDir?: string
): void {
  if (rootDir) assertSecureManagedDirectory(rootDir, embeddingsDir);
  const keep = new Set(Array.from(keepFiles, (file) => path.basename(file)));
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(embeddingsDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (/^entities\.progress-[A-Za-z0-9-]+\.jsonl$/.test(entry) && !keep.has(entry)) {
      const candidate = path.join(embeddingsDir, entry);
      if (rootDir) assertSecureManagedFile(rootDir, candidate);
      const stat = fs.lstatSync(candidate);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) {
        throw new Error(`Refusing to remove unsafe progressive snapshot: ${candidate}`);
      }
      fs.rmSync(candidate);
    }
  }
}
