import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  assertSecureManagedDirectory,
  assertSecureManagedFile,
  atomicWriteText,
  ensureSecureManagedDirectory,
  fsyncDirectory,
} from "../../progressiveIndexing.js";
import {
  canonicalJson,
  createAuthorityManifest,
  createSourceAuthorityRegistry,
  evaluateAnalysisState,
  LIMITS,
  REGISTERED_RULE_IDS,
  sha256Canonical,
} from "./engine.js";
import {
  ANALYSIS_DIRECTORY_NAME,
  ANALYSIS_STORE_FILES,
  ANALYSIS_STORE_SCHEMA_VERSION,
  type AnalysisInput,
  type AnalysisStateReader,
  type AuthorityManifest,
  type CanonicalValue,
  type Observation,
  type SourceAuthorityRegistry,
} from "./schemas.js";

const TASK_ID_RE = /^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$/;
const REPOSITORY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const ZERO_SHA256 = "0".repeat(64);
const STORE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const FACT_ID_RE = /^(?:base:obs|fact):[0-9a-f]{64}$/;
const MAX_STORE_BYTES = Object.freeze({
  observations: 4 * 1024 * 1024,
  snapshot: 4 * 1024 * 1024,
  changes: 8 * 1024 * 1024,
  manifest: 64 * 1024,
  lockOwner: 4 * 1024,
});

type ObservationLogRecord = {
  schema_version: 1;
  repository: string;
  task_id: string;
  sequence: number;
  previous_record_sha256: string;
  observation: Observation;
  record_sha256: string;
};

type LockOwner = {
  schema_version: 1;
  pid: number;
  token: string;
};

export type AnalysisChangeRecord = {
  schema_version: 1;
  repository: string;
  task_id: string;
  generation: number;
  previous_snapshot_sha256: string;
  snapshot_sha256: string;
  observation_count: number;
  observation_head_sha256: string;
  added_fact_ids: string[];
  retracted_fact_ids: string[];
  active_fact_ids: string[];
  payload_sha256: string;
};

export type AnalysisStoreManifest = {
  schema_version: 1;
  repository: string;
  task_id: string;
  generation: number;
  observation_count: number;
  observation_log_sha256: string;
  observation_head_sha256: string;
  head_record_sha256: string;
  snapshot_file_sha256: string;
  snapshot_sha256: string;
  changes_file_sha256: string;
  ruleset_sha256: string;
  authority_manifest_sha256: string;
  source_authority_registry_sha256: string;
  previous_manifest_sha256: string;
  manifest_sha256: string;
};

export type AnalysisStoreOptions = {
  cwd: string;
  taskId: string;
  repository: string;
  input: AnalysisInput;
  authorityManifest: AuthorityManifest;
  sourceAuthorities: SourceAuthorityRegistry;
  expectedGeneration?: number;
  failAfter?: "observations" | "snapshot" | "changes";
};

export type AnalysisStoreReadOptions = Omit<
  AnalysisStoreOptions,
  "input" | "expectedGeneration" | "failAfter"
>;

export type PersistedAnalysisState = {
  manifest: AnalysisStoreManifest;
  changes: AnalysisChangeRecord[];
  observations: Observation[];
  state: AnalysisStateReader;
};

function fail(message: string): never {
  throw new Error(`analysis-state store: ${message}`);
}

function sha256Bytes(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function assertIdentity(taskId: string, repository: string): void {
  if (!TASK_ID_RE.test(taskId)) fail("task ID is not a canonical path component");
  if (!REPOSITORY_ID_RE.test(repository)) fail("repository identity is invalid");
}

function storePaths(cwd: string, taskId: string) {
  const projectRoot = path.resolve(cwd);
  const taskDir = path.join(projectRoot, ".agents", taskId);
  const analysisDir = path.join(taskDir, ANALYSIS_DIRECTORY_NAME);
  return {
    projectRoot,
    taskDir,
    analysisDir,
    lockDir: path.join(taskDir, ".analysis.lock"),
    observations: path.join(analysisDir, "observations.jsonl"),
    snapshot: path.join(analysisDir, "snapshot.json"),
    changes: path.join(analysisDir, "changes.jsonl"),
    manifest: path.join(analysisDir, "manifest.json"),
  };
}

function assertMode(filePath: string, expectedMode: number, kind: "file" | "directory"): void {
  const stat = fs.lstatSync(filePath);
  if (kind === "file") {
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
      fail(`managed path is not a private regular file: ${filePath}`);
    }
  } else if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail(`managed path is not a private directory: ${filePath}`);
  }
  if ((stat.mode & 0o777) !== expectedMode) {
    fail(`managed ${kind} has wrong mode: ${filePath}`);
  }
}

function prepareDirectories(paths: ReturnType<typeof storePaths>): void {
  ensureSecureManagedDirectory(paths.projectRoot, paths.analysisDir);
  assertSecureManagedDirectory(paths.projectRoot, paths.analysisDir);
  assertMode(paths.analysisDir, DIRECTORY_MODE, "directory");
}

function validateStoreEntries(paths: ReturnType<typeof storePaths>, allowEmpty = false): void {
  assertSecureManagedDirectory(paths.projectRoot, paths.analysisDir);
  assertMode(paths.analysisDir, DIRECTORY_MODE, "directory");
  const entries = fs.readdirSync(paths.analysisDir).sort();
  if (allowEmpty && entries.length === 0) return;
  if (canonicalJson(entries) !== canonicalJson([...ANALYSIS_STORE_FILES])) {
    fail(`analysis directory has missing or unexpected entries: ${entries.join(",")}`);
  }
  for (const filePath of [paths.observations, paths.snapshot, paths.changes, paths.manifest]) {
    assertSecureManagedFile(paths.projectRoot, filePath);
    assertMode(filePath, STORE_MODE, "file");
  }
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail(`${label} must be an object`);
  return parsed as Record<string, unknown>;
}

function readBoundedText(filePath: string, maximumBytes: number, label: string): string {
  const size = fs.lstatSync(filePath).size;
  if (size > maximumBytes) fail(`${label} exceeds the ${maximumBytes}-byte bound`);
  return fs.readFileSync(filePath, "utf8");
}

function parseJsonl(
  text: string,
  label: string,
  maximumRecords: number,
): Record<string, unknown>[] {
  if (!text.endsWith("\n")) fail(`${label} is not newline terminated`);
  const lines = text.split("\n");
  lines.pop();
  if (lines.length > maximumRecords) fail(`${label} exceeds the ${maximumRecords}-record bound`);
  return lines.map((line, index) => parseJsonObject(line, `${label}:${index + 1}`));
}

function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) {
    fail(`${label} has unknown or missing keys`);
  }
}

function observationRecordPayload(record: Omit<ObservationLogRecord, "record_sha256">) {
  return record;
}

function buildObservationRecords(
  observations: Observation[],
  repository: string,
  taskId: string,
): ObservationLogRecord[] {
  let previous = ZERO_SHA256;
  return observations.map((observation, index) => {
    const payload = {
      schema_version: ANALYSIS_STORE_SCHEMA_VERSION,
      repository,
      task_id: taskId,
      sequence: index + 1,
      previous_record_sha256: previous,
      observation,
    } as const;
    const record = { ...payload, record_sha256: sha256Canonical(payload) };
    previous = record.record_sha256;
    return record;
  });
}

function validateObservationRecords(
  raw: Record<string, unknown>[],
  repository: string,
  taskId: string,
): ObservationLogRecord[] {
  const records = raw as unknown as ObservationLogRecord[];
  let previous = ZERO_SHA256;
  for (const [index, record] of records.entries()) {
    exactKeys(record as unknown as Record<string, unknown>, [
      "schema_version", "repository", "task_id", "sequence",
      "previous_record_sha256", "observation", "record_sha256",
    ], `observation record ${index + 1}`);
    if (
      record.schema_version !== ANALYSIS_STORE_SCHEMA_VERSION ||
      record.repository !== repository || record.task_id !== taskId ||
      record.sequence !== index + 1 || record.previous_record_sha256 !== previous ||
      !SHA256_RE.test(record.record_sha256)
    ) fail(`observation record ${index + 1} identity or chain changed`);
    const payload = observationRecordPayload({
      schema_version: record.schema_version,
      repository: record.repository,
      task_id: record.task_id,
      sequence: record.sequence,
      previous_record_sha256: record.previous_record_sha256,
      observation: record.observation,
    });
    if (sha256Canonical(payload) !== record.record_sha256) {
      fail(`observation record ${index + 1} hash changed`);
    }
    previous = record.record_sha256;
  }
  return records;
}

function manifestPayload(manifest: Omit<AnalysisStoreManifest, "manifest_sha256">) {
  return manifest;
}

function validateManifest(
  raw: Record<string, unknown>,
  repository: string,
  taskId: string,
): AnalysisStoreManifest {
  exactKeys(raw, [
    "schema_version", "repository", "task_id", "generation",
    "observation_count", "observation_log_sha256", "observation_head_sha256",
    "head_record_sha256", "snapshot_file_sha256", "snapshot_sha256",
    "changes_file_sha256", "ruleset_sha256", "authority_manifest_sha256",
    "source_authority_registry_sha256", "previous_manifest_sha256", "manifest_sha256",
  ], "manifest");
  const manifest = raw as unknown as AnalysisStoreManifest;
  if (
    manifest.schema_version !== ANALYSIS_STORE_SCHEMA_VERSION ||
    manifest.repository !== repository || manifest.task_id !== taskId ||
    !Number.isSafeInteger(manifest.generation) || manifest.generation < 1 ||
    manifest.generation > LIMITS.observations ||
    !Number.isSafeInteger(manifest.observation_count) || manifest.observation_count < 1 ||
    manifest.observation_count > LIMITS.observations ||
    manifest.generation > manifest.observation_count
  ) fail("manifest identity or counters changed");
  for (const key of Object.keys(manifest).filter((key) => key.endsWith("sha256"))) {
    if (!SHA256_RE.test(manifest[key as keyof AnalysisStoreManifest] as string)) {
      fail(`manifest ${key} is not a SHA-256`);
    }
  }
  const { manifest_sha256: claimed, ...payload } = manifest;
  if (sha256Canonical(manifestPayload(payload)) !== claimed) fail("manifest hash changed");
  return manifest;
}

function changePayload(change: Omit<AnalysisChangeRecord, "payload_sha256">) {
  return change;
}

function validateChanges(
  raw: Record<string, unknown>[],
  repository: string,
  taskId: string,
): AnalysisChangeRecord[] {
  const changes = raw as unknown as AnalysisChangeRecord[];
  for (const [index, change] of changes.entries()) {
    exactKeys(change as unknown as Record<string, unknown>, [
      "schema_version", "repository", "task_id", "generation",
      "previous_snapshot_sha256", "snapshot_sha256", "observation_count",
      "observation_head_sha256", "added_fact_ids", "retracted_fact_ids",
      "active_fact_ids", "payload_sha256",
    ], `change record ${index + 1}`);
    if (
      change.schema_version !== 1 || change.repository !== repository ||
      change.task_id !== taskId || change.generation !== index + 1 ||
      !Number.isSafeInteger(change.observation_count) || change.observation_count < 1 ||
      change.observation_count > LIMITS.observations ||
      !SHA256_RE.test(change.previous_snapshot_sha256) ||
      !SHA256_RE.test(change.snapshot_sha256) ||
      !SHA256_RE.test(change.observation_head_sha256) ||
      !SHA256_RE.test(change.payload_sha256)
    ) fail(`change record ${index + 1} identity changed`);
    const { payload_sha256: claimed, ...payload } = change;
    if (sha256Canonical(changePayload(payload)) !== claimed) fail(`change record ${index + 1} hash changed`);
    for (const key of ["added_fact_ids", "retracted_fact_ids", "active_fact_ids"] as const) {
      if (
        !Array.isArray(change[key]) || change[key].length > LIMITS.change_facts ||
        change[key].some((id) => typeof id !== "string" || !FACT_ID_RE.test(id)) ||
        new Set(change[key]).size !== change[key].length ||
        canonicalJson(change[key]) !== canonicalJson([...change[key]].sort())
      ) {
        fail(`change record ${index + 1} ${key} is not sorted`);
      }
    }
  }
  return changes;
}

function readCommittedFiles(paths: ReturnType<typeof storePaths>, repository: string, taskId: string) {
  validateStoreEntries(paths);
  const observationsText = readBoundedText(paths.observations, MAX_STORE_BYTES.observations, "observations");
  const snapshotText = readBoundedText(paths.snapshot, MAX_STORE_BYTES.snapshot, "snapshot");
  const changesText = readBoundedText(paths.changes, MAX_STORE_BYTES.changes, "changes");
  const manifestText = readBoundedText(paths.manifest, MAX_STORE_BYTES.manifest, "manifest");
  const manifest = validateManifest(parseJsonObject(manifestText, "manifest"), repository, taskId);
  if (
    sha256Bytes(observationsText) !== manifest.observation_log_sha256 ||
    sha256Bytes(snapshotText) !== manifest.snapshot_file_sha256 ||
    sha256Bytes(changesText) !== manifest.changes_file_sha256
  ) fail("published file hash does not match manifest");
  const records = validateObservationRecords(
    parseJsonl(observationsText, "observations", LIMITS.observations), repository, taskId,
  );
  const changes = validateChanges(
    parseJsonl(changesText, "changes", LIMITS.observations), repository, taskId,
  );
  if (
    records.length !== manifest.observation_count ||
    (records.at(-1)?.record_sha256 ?? ZERO_SHA256) !== manifest.head_record_sha256 ||
    changes.length !== manifest.generation ||
    changes.at(-1)?.snapshot_sha256 !== manifest.snapshot_sha256
  ) fail("manifest counts or heads do not match published files");
  return { observationsText, snapshotText, changesText, manifest, records, changes };
}

function readLockOwner(
  projectRoot: string,
  lockDir: string,
): LockOwner {
  assertSecureManagedDirectory(projectRoot, lockDir);
  assertMode(lockDir, DIRECTORY_MODE, "directory");
  const entries = fs.readdirSync(lockDir);
  if (entries.length !== 1 || entries[0] !== "owner.json") fail("analysis lock has unexpected entries");
  const ownerPath = path.join(lockDir, "owner.json");
  assertSecureManagedFile(projectRoot, ownerPath);
  assertMode(ownerPath, STORE_MODE, "file");
  const owner = parseJsonObject(
    readBoundedText(ownerPath, MAX_STORE_BYTES.lockOwner, "lock owner"),
    "lock owner",
  );
  exactKeys(owner, ["schema_version", "pid", "token"], "lock owner");
  if (
    owner.schema_version !== ANALYSIS_STORE_SCHEMA_VERSION ||
    !Number.isSafeInteger(owner.pid) || (owner.pid as number) < 1 ||
    typeof owner.token !== "string" || !/^[0-9a-f]{32}$/u.test(owner.token)
  ) fail("analysis lock owner is invalid");
  return owner as LockOwner;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM") return true;
    if (code === "ESRCH") return false;
    throw error;
  }
}

function reclaimStaleLock(paths: ReturnType<typeof storePaths>): number {
  const owner = readLockOwner(paths.projectRoot, paths.lockDir);
  if (processIsAlive(owner.pid)) fail("another writer holds the analysis lock");
  const quarantine = path.join(paths.taskDir, `.analysis.stale-${crypto.randomBytes(16).toString("hex")}`);
  try {
    fs.renameSync(paths.lockDir, quarantine);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      fail("analysis lock changed during stale-lock recovery");
    }
    throw error;
  }
  readLockOwner(paths.projectRoot, quarantine);
  fs.rmSync(path.join(quarantine, "owner.json"));
  fs.rmdirSync(quarantine);
  fsyncDirectory(paths.taskDir);
  return owner.pid;
}

function cleanStaleAtomicFiles(paths: ReturnType<typeof storePaths>, stalePid: number): void {
  if (!fs.existsSync(paths.analysisDir)) return;
  assertSecureManagedDirectory(paths.projectRoot, paths.analysisDir);
  assertMode(paths.analysisDir, DIRECTORY_MODE, "directory");
  const pattern = new RegExp(
    `^(?:snapshot\\.json|changes\\.jsonl|manifest\\.json)\\.tmp-${stalePid}-[0-9a-f]{12}$`,
    "u",
  );
  let removed = false;
  for (const entry of fs.readdirSync(paths.analysisDir)) {
    if (!pattern.test(entry)) continue;
    const filePath = path.join(paths.analysisDir, entry);
    assertSecureManagedFile(paths.projectRoot, filePath);
    assertMode(filePath, STORE_MODE, "file");
    fs.rmSync(filePath);
    removed = true;
  }
  if (removed) fsyncDirectory(paths.analysisDir);
}

function acquireLock(paths: ReturnType<typeof storePaths>, reclaimStale = false): string {
  ensureSecureManagedDirectory(paths.projectRoot, paths.taskDir);
  const token = crypto.randomBytes(16).toString("hex");
  let stalePid: number | null = null;
  try {
    fs.mkdirSync(paths.lockDir, { mode: DIRECTORY_MODE });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      if (!reclaimStale) fail("another writer holds the analysis lock");
      stalePid = reclaimStaleLock(paths);
      try {
        fs.mkdirSync(paths.lockDir, { mode: DIRECTORY_MODE });
      } catch (retryError) {
        if ((retryError as NodeJS.ErrnoException).code === "EEXIST") {
          fail("another writer acquired the analysis lock during recovery");
        }
        throw retryError;
      }
    } else {
      throw error;
    }
  }
  try {
    assertSecureManagedDirectory(paths.projectRoot, paths.lockDir);
    assertMode(paths.lockDir, DIRECTORY_MODE, "directory");
    const ownerPath = path.join(paths.lockDir, "owner.json");
    const owner = `${canonicalJson({ schema_version: 1, pid: process.pid, token })}\n`;
    fs.writeFileSync(ownerPath, owner, { encoding: "utf8", flag: "wx", mode: STORE_MODE });
    const fd = fs.openSync(ownerPath, "r");
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fsyncDirectory(paths.lockDir);
    fsyncDirectory(paths.taskDir);
    if (stalePid !== null) cleanStaleAtomicFiles(paths, stalePid);
    return token;
  } catch (error) {
    fs.rmSync(paths.lockDir, { recursive: true, force: true });
    throw error;
  }
}

function releaseLock(paths: ReturnType<typeof storePaths>, token: string): void {
  const ownerPath = path.join(paths.lockDir, "owner.json");
  const owner = readLockOwner(paths.projectRoot, paths.lockDir);
  if (owner.token !== token || owner.pid !== process.pid) fail("analysis lock ownership changed");
  fs.rmSync(ownerPath);
  fs.rmdirSync(paths.lockDir);
  fsyncDirectory(paths.taskDir);
}

function sortedObservations(observations: Observation[]): Observation[] {
  return [...observations].sort((left, right) => {
    const time = left.observed_at.localeCompare(right.observed_at);
    return time || left.id.localeCompare(right.id);
  });
}

function renderJsonl(values: CanonicalValue[]): string {
  return values.map((value) => canonicalJson(value)).join("\n") + (values.length ? "\n" : "");
}

function appendObservationRecords(
  paths: ReturnType<typeof storePaths>,
  existing: ObservationLogRecord[],
  all: ObservationLogRecord[],
): void {
  const additions = all.slice(existing.length);
  if (additions.length === 0) fail("publication adds no observations");
  if (!fs.existsSync(paths.observations)) {
    const text = renderJsonl(additions as unknown as CanonicalValue[]);
    fs.writeFileSync(paths.observations, text, { encoding: "utf8", flag: "wx", mode: STORE_MODE });
  } else {
    assertSecureManagedFile(paths.projectRoot, paths.observations);
    assertMode(paths.observations, STORE_MODE, "file");
    const fd = fs.openSync(paths.observations, fs.constants.O_WRONLY | fs.constants.O_APPEND);
    try {
      fs.writeSync(fd, renderJsonl(additions as unknown as CanonicalValue[]), undefined, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }
  fs.chmodSync(paths.observations, STORE_MODE);
  fsyncDirectory(paths.analysisDir);
}

function activeFactIds(state: AnalysisStateReader): string[] {
  const snapshot = state.snapshot;
  const derived = snapshot.derived_facts.map((fact) => fact.id);
  const base = state.observationHistory()
    .filter((observation) => observation.active && observation.operation === "assert")
    .map((observation) => `base:${observation.id}`);
  return [...base, ...derived].sort();
}

function makeChange(
  repository: string,
  taskId: string,
  generation: number,
  previousSnapshot: string,
  state: AnalysisStateReader,
  previousFactIds: string[],
): AnalysisChangeRecord {
  const current = activeFactIds(state);
  const before = new Set(previousFactIds);
  const after = new Set(current);
  const payload = {
    schema_version: ANALYSIS_STORE_SCHEMA_VERSION,
    repository,
    task_id: taskId,
    generation,
    previous_snapshot_sha256: previousSnapshot,
    snapshot_sha256: state.snapshot.snapshot_sha256,
    observation_count: state.statistics.observation_count,
    observation_head_sha256: state.snapshot.observation_head_sha256,
    added_fact_ids: current.filter((id) => !before.has(id)),
    retracted_fact_ids: [...before].filter((id) => !after.has(id)).sort(),
    active_fact_ids: current,
  } as const;
  return { ...payload, payload_sha256: sha256Canonical(payload) };
}

function publishDerivedFiles(
  paths: ReturnType<typeof storePaths>,
  repository: string,
  taskId: string,
  state: AnalysisStateReader,
  records: ObservationLogRecord[],
  previousManifest: AnalysisStoreManifest | null,
  previousChanges: AnalysisChangeRecord[],
  authorityManifest: AuthorityManifest,
  sourceAuthorities: SourceAuthorityRegistry,
  failAfter?: AnalysisStoreOptions["failAfter"],
): AnalysisStoreManifest {
  const generation = (previousManifest?.generation ?? 0) + 1;
  const previousFacts = previousChanges.at(-1)?.active_fact_ids ?? [];
  const change = makeChange(
    repository,
    taskId,
    generation,
    previousManifest?.snapshot_sha256 ?? ZERO_SHA256,
    state,
    previousFacts,
  );
  const changes = [...previousChanges, change];
  const snapshotText = state.snapshotBytes;
  const changesText = renderJsonl(changes as unknown as CanonicalValue[]);

  atomicWriteText(paths.snapshot, snapshotText, paths.projectRoot);
  if (failAfter === "snapshot") fail("injected failure after snapshot publication");
  atomicWriteText(paths.changes, changesText, paths.projectRoot);
  if (failAfter === "changes") fail("injected failure after changes publication");

  const observationText = readBoundedText(
    paths.observations,
    MAX_STORE_BYTES.observations,
    "observations",
  );
  const payload = {
    schema_version: ANALYSIS_STORE_SCHEMA_VERSION,
    repository,
    task_id: taskId,
    generation,
    observation_count: records.length,
    observation_log_sha256: sha256Bytes(observationText),
    observation_head_sha256: state.snapshot.observation_head_sha256,
    head_record_sha256: records.at(-1)?.record_sha256 ?? ZERO_SHA256,
    snapshot_file_sha256: sha256Bytes(snapshotText),
    snapshot_sha256: state.snapshot.snapshot_sha256,
    changes_file_sha256: sha256Bytes(changesText),
    ruleset_sha256: state.snapshot.ruleset_sha256,
    authority_manifest_sha256: authorityManifest.manifest_sha256,
    source_authority_registry_sha256: sha256Canonical(sourceAuthorities),
    previous_manifest_sha256: previousManifest?.manifest_sha256 ?? ZERO_SHA256,
  } as const;
  const manifest = { ...payload, manifest_sha256: sha256Canonical(payload) };
  atomicWriteText(paths.manifest, `${canonicalJson(manifest)}\n`, paths.projectRoot);
  return manifest;
}

function evaluate(
  input: AnalysisInput,
  authorityManifest: AuthorityManifest,
  sourceAuthorities: SourceAuthorityRegistry,
): AnalysisStateReader {
  return evaluateAnalysisState(
    input,
    authorityManifest,
    createSourceAuthorityRegistry(sourceAuthorities),
  ) as AnalysisStateReader;
}

export function readAnalysisState(options: AnalysisStoreReadOptions): PersistedAnalysisState | null {
  assertIdentity(options.taskId, options.repository);
  const paths = storePaths(options.cwd, options.taskId);
  if (!fs.existsSync(paths.analysisDir)) return null;
  const committed = readCommittedFiles(paths, options.repository, options.taskId);
  const observations = committed.records.map((record) => record.observation);
  const input: AnalysisInput = {
    schema_version: 1,
    rule_ids: [...REGISTERED_RULE_IDS],
    observations,
  };
  const state = evaluate(input, options.authorityManifest, options.sourceAuthorities);
  if (
    state.snapshotBytes !== committed.snapshotText ||
    state.snapshot.snapshot_sha256 !== committed.manifest.snapshot_sha256 ||
    state.snapshot.ruleset_sha256 !== committed.manifest.ruleset_sha256 ||
    options.authorityManifest.manifest_sha256 !== committed.manifest.authority_manifest_sha256 ||
    sha256Canonical(createSourceAuthorityRegistry(options.sourceAuthorities)) !== committed.manifest.source_authority_registry_sha256
  ) fail("replayed analysis state does not match committed manifest");
  return {
    manifest: committed.manifest,
    changes: committed.changes,
    observations,
    state,
  };
}

export function publishAnalysisState(options: AnalysisStoreOptions): PersistedAnalysisState {
  assertIdentity(options.taskId, options.repository);
  const paths = storePaths(options.cwd, options.taskId);
  const token = acquireLock(paths);
  try {
    prepareDirectories(paths);
    let previous: ReturnType<typeof readCommittedFiles> | null = null;
    if (fs.existsSync(paths.manifest)) {
      previous = readCommittedFiles(paths, options.repository, options.taskId);
    } else {
      validateStoreEntries(paths, true);
    }
    const currentGeneration = previous?.manifest.generation ?? 0;
    if (options.expectedGeneration !== undefined && options.expectedGeneration !== currentGeneration) {
      fail(`stale writer expected generation ${options.expectedGeneration}, current is ${currentGeneration}`);
    }

    const observations = sortedObservations(options.input.observations);
    const normalizedInput: AnalysisInput = { ...options.input, observations };
    const state = evaluate(normalizedInput, options.authorityManifest, options.sourceAuthorities);
    const records = buildObservationRecords(observations, options.repository, options.taskId);
    const existing = previous?.records ?? [];
    for (let index = 0; index < existing.length; index += 1) {
      if (canonicalJson(existing[index]) !== canonicalJson(records[index])) {
        fail(`append-only observation prefix changed at sequence ${index + 1}`);
      }
    }
    appendObservationRecords(paths, existing, records);
    if (options.failAfter === "observations") fail("injected failure after observation append");
    publishDerivedFiles(
      paths,
      options.repository,
      options.taskId,
      state,
      records,
      previous?.manifest ?? null,
      previous?.changes ?? [],
      options.authorityManifest,
      createSourceAuthorityRegistry(options.sourceAuthorities),
      options.failAfter,
    );
  } finally {
    releaseLock(paths, token);
  }
  const persisted = readAnalysisState(options);
  if (!persisted) fail("published analysis state is missing");
  return persisted;
}

export function recoverAnalysisState(options: AnalysisStoreOptions): PersistedAnalysisState {
  assertIdentity(options.taskId, options.repository);
  const paths = storePaths(options.cwd, options.taskId);
  const token = acquireLock(paths, true);
  try {
    prepareDirectories(paths);
    if (!fs.existsSync(paths.observations)) fail("recovery requires an observation log");
    assertSecureManagedFile(paths.projectRoot, paths.observations);
    assertMode(paths.observations, STORE_MODE, "file");
    const observationText = readBoundedText(
      paths.observations,
      MAX_STORE_BYTES.observations,
      "observations",
    );
    const records = validateObservationRecords(
      parseJsonl(observationText, "observations", LIMITS.observations),
      options.repository,
      options.taskId,
    );
    const observations = records.map((record) => record.observation);
    const expected = sortedObservations(options.input.observations);
    if (canonicalJson(observations) !== canonicalJson(expected)) {
      fail("recovery input does not exactly match the hash-chained observation log");
    }
    const state = evaluate({ ...options.input, observations }, options.authorityManifest, options.sourceAuthorities);
    const sourceAuthorities = createSourceAuthorityRegistry(options.sourceAuthorities);

    let previousManifest: AnalysisStoreManifest | null = null;
    let previousChanges: AnalysisChangeRecord[] = [];
    if (fs.existsSync(paths.manifest)) {
      assertSecureManagedFile(paths.projectRoot, paths.manifest);
      assertMode(paths.manifest, STORE_MODE, "file");
      previousManifest = validateManifest(
        parseJsonObject(
          readBoundedText(paths.manifest, MAX_STORE_BYTES.manifest, "manifest"),
          "manifest",
        ),
        options.repository,
        options.taskId,
      );
    }
    if (fs.existsSync(paths.changes)) {
      assertSecureManagedFile(paths.projectRoot, paths.changes);
      assertMode(paths.changes, STORE_MODE, "file");
      previousChanges = validateChanges(
        parseJsonl(
          readBoundedText(paths.changes, MAX_STORE_BYTES.changes, "changes"),
          "changes",
          LIMITS.observations,
        ),
        options.repository,
        options.taskId,
      );
    }
    if (previousManifest) {
      const committedRecords = records.slice(0, previousManifest.observation_count);
      const committedChanges = previousChanges.slice(0, previousManifest.generation);
      const committedAuthorityManifest = createAuthorityManifest(
        committedRecords.map((record) => record.observation),
      );
      if (
        previousManifest.observation_count > records.length ||
        previousChanges.length < previousManifest.generation ||
        sha256Bytes(renderJsonl(committedRecords as unknown as CanonicalValue[])) !== previousManifest.observation_log_sha256 ||
        (committedRecords.at(-1)?.record_sha256 ?? ZERO_SHA256) !== previousManifest.head_record_sha256 ||
        committedChanges.at(-1)?.snapshot_sha256 !== previousManifest.snapshot_sha256 ||
        (previousManifest.observation_count === records.length &&
          state.snapshot.snapshot_sha256 !== previousManifest.snapshot_sha256) ||
        committedAuthorityManifest.manifest_sha256 !== previousManifest.authority_manifest_sha256 ||
        sha256Canonical(sourceAuthorities) !== previousManifest.source_authority_registry_sha256 ||
        state.snapshot.ruleset_sha256 !== previousManifest.ruleset_sha256
      ) fail("recovery base, authority, or ruleset drifted from the committed manifest");
    }
    const alreadyCovered = previousManifest?.observation_count === records.length;
    if (alreadyCovered && previousChanges.length === previousManifest?.generation) {
      atomicWriteText(paths.snapshot, state.snapshotBytes, paths.projectRoot);
      atomicWriteText(paths.changes, renderJsonl(previousChanges as unknown as CanonicalValue[]), paths.projectRoot);
      const payload = {
        ...previousManifest,
        observation_log_sha256: sha256Bytes(observationText),
        snapshot_file_sha256: sha256Bytes(state.snapshotBytes),
        snapshot_sha256: state.snapshot.snapshot_sha256,
        changes_file_sha256: sha256Bytes(renderJsonl(previousChanges as unknown as CanonicalValue[])),
        ruleset_sha256: state.snapshot.ruleset_sha256,
        authority_manifest_sha256: options.authorityManifest.manifest_sha256,
        source_authority_registry_sha256: sha256Canonical(sourceAuthorities),
      };
      const { manifest_sha256: _old, ...withoutHash } = payload;
      const repaired = { ...withoutHash, manifest_sha256: sha256Canonical(withoutHash) };
      atomicWriteText(paths.manifest, `${canonicalJson(repaired)}\n`, paths.projectRoot);
    } else {
      const usableChanges = previousManifest
        ? previousChanges.slice(0, Math.min(previousManifest.generation, previousChanges.length))
        : [];
      publishDerivedFiles(
        paths,
        options.repository,
        options.taskId,
        state,
        records,
        previousManifest,
        usableChanges,
        options.authorityManifest,
        sourceAuthorities,
      );
    }
  } finally {
    releaseLock(paths, token);
  }
  const persisted = readAnalysisState(options);
  if (!persisted) fail("recovered analysis state is missing");
  return persisted;
}
