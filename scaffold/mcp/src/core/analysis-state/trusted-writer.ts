import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  assertSecureManagedDirectory,
  assertSecureManagedFile,
  atomicWriteText,
  fsyncDirectory,
} from "../../progressiveIndexing.js";
import {
  canonicalJson,
  createAuthorityManifest,
  evaluateAnalysisState,
  LIMITS,
  REGISTERED_RULE_IDS,
  sha256Canonical,
} from "./engine.js";
import {
  ANALYSIS_AUTHORITY_FILE,
  ANALYSIS_AUTHORITY_MAX_BYTES,
  ANALYSIS_TRANSACTION_INTENT_FILE,
  ANALYSIS_TRANSACTION_STAGE_FILE,
  createAnalysisAuthorityBundle,
  parseAnalysisAuthorityBundle,
  readTrustedAnalysisState,
  renderAnalysisAuthorityBundle,
  type AnalysisAuthorityBundle,
  type TrustedAnalysisState,
} from "./query-reader.js";
import type {
  AnalysisInput,
  AnalysisStateReader,
  AuthorityManifest,
  CanonicalValue,
  Observation,
  ObservationInput,
} from "./schemas.js";
import {
  publishAnalysisState,
  readAnalysisState,
  recoverAnalysisState,
  type PersistedAnalysisState,
} from "./store.js";
import { createWorkflowAnalysisObservation } from "../workflow/analysis-state-adapter.js";

const TASK_ID_RE = /^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$/;
const REPOSITORY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;
const OBSERVATION_ID_RE = /^obs:[0-9a-f]{64}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const LOCK_DIRECTORY = ".analysis-transaction.lock";
const LOCK_OWNER_FILE = "owner.json";
const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const MAX_INTENT_BYTES = 8 * 1024 * 1024;
const MAX_LOCK_OWNER_BYTES = 4 * 1024;
const FAILURE_POINTS = new Set<AnalysisAppendFailurePoint>([
  "intent", "authority_stage", "observations", "snapshot", "changes",
  "store", "authority", "intent_cleanup",
]);

export type AnalysisAppendFailurePoint =
  | "intent"
  | "authority_stage"
  | "observations"
  | "snapshot"
  | "changes"
  | "store"
  | "authority"
  | "intent_cleanup";

export type TrustedAnalysisAppendHooks = {
  failAfter?: AnalysisAppendFailurePoint;
};

export type TrustedAnalysisAppendOptions = {
  enabled: true;
  cwd: string;
  taskId: string;
  repository: string;
  expectedGeneration: number;
  expectedAuthorityBundleSha256: string;
  observation: ObservationInput;
  hooks?: TrustedAnalysisAppendHooks;
};

export type TrustedAnalysisRecoveryOptions = {
  enabled: true;
  cwd: string;
  taskId: string;
  repository: string;
};

export type TrustedAnalysisAppendResult = {
  schema_version: 1;
  generation: number;
  snapshot_sha256: string;
  observation_count: number;
  observation_head_sha256: string;
  authority_bundle_sha256: string;
  authority_manifest_sha256: string;
  source_authority_registry_sha256: string;
  appended_observation_id: string;
};

export type TrustedAnalysisRecoveryResult = TrustedAnalysisAppendResult & {
  outcome: "aborted" | "completed";
};

type TransactionIntentPayload = {
  schema_version: 1;
  repository: string;
  task_id: string;
  primary_subject: string;
  project_root_dev: string;
  project_root_ino: string;
  task_directory_dev: string;
  task_directory_ino: string;
  old_generation: number;
  old_authority_bundle_sha256: string;
  old_authority_file_sha256: string;
  appended_observation_id: string;
  appended_observation_payload_sha256: string;
  candidate_observations: Observation[];
  new_authority_bytes_base64: string;
  new_authority_file_sha256: string;
  new_authority_bundle_sha256: string;
  intended_generation: number;
  intended_snapshot_sha256: string;
  intended_observation_count: number;
  intended_observation_head_sha256: string;
  intended_authority_manifest_sha256: string;
  intended_source_authority_registry_sha256: string;
};

type TransactionIntent = TransactionIntentPayload & { intent_sha256: string };

type BoundFile = {
  dev: bigint;
  ino: bigint;
  ctimeNs: bigint;
  mtimeNs: bigint;
  mode: bigint;
  nlink: bigint;
  size: bigint;
  bytes: Buffer;
};

type BoundDirectory = {
  path: string;
  dev: bigint;
  ino: bigint;
  mode: bigint;
};

type PreparedAppend = {
  trusted: TrustedAnalysisState;
  observation: Observation;
  observations: Observation[];
  state: AnalysisStateReader;
  authority: AnalysisAuthorityBundle;
  authorityBytes: string;
};

type CoordinatorPaths = ReturnType<typeof coordinatorPaths>;

function fail(message: string): never {
  throw new Error(`trusted analysis writer: ${message}`);
}

function sha256Bytes(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[], label: string): void {
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(value).some((key) => !allowed.has(key))) fail(`${label} has an unknown key`);
  if (required.some((key) => !Object.hasOwn(value, key))) fail(`${label} is missing a key`);
}

function assertEnabled(options: unknown, label: string): asserts options is Record<string, unknown> & { enabled: true } {
  if (!isPlainObject(options) || options.enabled !== true) {
    fail(`${label} must be explicitly enabled`);
  }
}

function assertIdentity(taskId: unknown, repository: unknown): asserts taskId is string {
  if (typeof taskId !== "string" || !TASK_ID_RE.test(taskId)) fail("task ID is invalid");
  if (typeof repository !== "string" || !REPOSITORY_ID_RE.test(repository)) fail("repository identity is invalid");
}

function coordinatorPaths(cwd: string, taskId: string) {
  const projectRoot = path.resolve(cwd);
  const taskDir = path.join(projectRoot, ".agents", taskId);
  return {
    projectRoot,
    taskDir,
    authority: path.join(taskDir, ANALYSIS_AUTHORITY_FILE),
    intent: path.join(taskDir, ANALYSIS_TRANSACTION_INTENT_FILE),
    authorityStage: path.join(taskDir, ANALYSIS_TRANSACTION_STAGE_FILE),
    lockDir: path.join(taskDir, LOCK_DIRECTORY),
    lockOwner: path.join(taskDir, LOCK_DIRECTORY, LOCK_OWNER_FILE),
  };
}

function bindCoordinatorDirectories(paths: CoordinatorPaths): BoundDirectory[] {
  const directories = [paths.projectRoot, path.join(paths.projectRoot, ".agents"), paths.taskDir];
  return directories.map((directoryPath) => {
    const stat = fs.lstatSync(directoryPath, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail("coordinator ancestor is not a secure directory");
    if (fs.realpathSync(directoryPath) !== directoryPath) fail("coordinator ancestor identity is not canonical");
    return { path: directoryPath, dev: stat.dev, ino: stat.ino, mode: stat.mode };
  });
}

function assertCoordinatorDirectories(bound: BoundDirectory[]): void {
  for (const identity of bound) {
    let stat: fs.BigIntStats;
    try {
      stat = fs.lstatSync(identity.path, { bigint: true });
    } catch {
      fail("coordinator ancestor changed");
    }
    if (
      !stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== identity.dev ||
      stat.ino !== identity.ino || stat.mode !== identity.mode || fs.realpathSync(identity.path) !== identity.path
    ) fail("coordinator ancestor changed");
  }
}

function readPrivateFile(filePath: string, maximumBytes: number, label: string): BoundFile {
  let before: fs.BigIntStats;
  try {
    before = fs.lstatSync(filePath, { bigint: true });
  } catch {
    fail(`${label} is missing or unavailable`);
  }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) {
    fail(`${label} is not a private single-link regular file`);
  }
  if ((before.mode & 0o777n) !== BigInt(FILE_MODE)) fail(`${label} has wrong mode`);
  if (before.size > BigInt(maximumBytes)) fail(`${label} exceeds its byte bound`);
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (
      opened.dev !== before.dev || opened.ino !== before.ino || opened.ctimeNs !== before.ctimeNs ||
      opened.mode !== before.mode || opened.nlink !== before.nlink || !opened.isFile()
    ) fail(`${label} changed before open`);
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (
      opened.dev !== after.dev || opened.ino !== after.ino || opened.ctimeNs !== after.ctimeNs ||
      opened.mtimeNs !== after.mtimeNs || opened.mode !== after.mode || opened.nlink !== after.nlink ||
      opened.size !== after.size || BigInt(bytes.byteLength) !== after.size
    ) fail(`${label} changed during read`);
    return {
      dev: opened.dev,
      ino: opened.ino,
      ctimeNs: opened.ctimeNs,
      mtimeNs: opened.mtimeNs,
      mode: opened.mode,
      nlink: opened.nlink,
      size: opened.size,
      bytes,
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertSameFile(filePath: string, bound: BoundFile, label: string): void {
  const current = readPrivateFile(filePath, Math.max(bound.bytes.byteLength, 1), label);
  if (
    current.dev !== bound.dev || current.ino !== bound.ino || current.ctimeNs !== bound.ctimeNs ||
    current.mtimeNs !== bound.mtimeNs || current.mode !== bound.mode || current.nlink !== bound.nlink ||
    current.size !== bound.size || !current.bytes.equals(bound.bytes)
  ) fail(`${label} identity changed`);
}

function sortedObservations(observations: Observation[]): Observation[] {
  return [...observations].sort((left, right) => {
    const time = left.observed_at.localeCompare(right.observed_at);
    return time || left.id.localeCompare(right.id);
  });
}

function inputFor(observations: Observation[]): AnalysisInput {
  return { schema_version: 1, rule_ids: [...REGISTERED_RULE_IDS], observations };
}

function prepareAppend(options: TrustedAnalysisAppendOptions): PreparedAppend {
  const trusted = readTrustedAnalysisState({ cwd: options.cwd, taskId: options.taskId });
  if (trusted.authority.repository !== options.repository) fail("repository binding changed");
  if (trusted.persisted.manifest.generation !== options.expectedGeneration) {
    fail(`stale writer expected generation ${options.expectedGeneration}`);
  }
  if (trusted.authority.bundle_sha256 !== options.expectedAuthorityBundleSha256) {
    fail("stale writer authority bundle changed");
  }
  if (options.observation.scope?.repository !== trusted.authority.repository) {
    fail("observation repository scope changed");
  }
  if (options.observation.scope?.work_order !== trusted.authority.primary_subject) {
    fail("observation work-order scope changed");
  }
  const observation = createWorkflowAnalysisObservation(true, options.observation);
  if (trusted.persisted.observations.some((item) => item.id === observation.id)) {
    fail("duplicate observation ID");
  }
  const observations = sortedObservations([...trusted.persisted.observations, observation]);
  if (
    observations.at(-1)?.id !== observation.id ||
    canonicalJson(observations.slice(0, -1)) !== canonicalJson(trusted.persisted.observations)
  ) fail("observation is not an append to the committed order");
  if (observations.length > LIMITS.observations) fail("observation bound exceeded");
  const authorityManifest = createAuthorityManifest(observations) as AuthorityManifest;
  const state = evaluateAnalysisState(
    inputFor(observations),
    authorityManifest,
    trusted.authority.source_authorities,
  ) as AnalysisStateReader;
  const authority = createAnalysisAuthorityBundle({
    schema_version: 1,
    repository: trusted.authority.repository,
    task_id: trusted.authority.task_id,
    primary_subject: trusted.authority.primary_subject,
    authority_manifest: authorityManifest,
    source_authorities: trusted.authority.source_authorities,
  });
  return {
    trusted,
    observation,
    observations,
    state,
    authority,
    authorityBytes: renderAnalysisAuthorityBundle(authority),
  };
}

function validateAppendOptions(options: unknown): asserts options is TrustedAnalysisAppendOptions {
  assertEnabled(options, "append");
  exactKeys(options, [
    "enabled", "cwd", "taskId", "repository", "expectedGeneration",
    "expectedAuthorityBundleSha256", "observation",
  ], ["hooks"], "append options");
  assertIdentity(options.taskId, options.repository);
  if (typeof options.cwd !== "string" || path.resolve(options.cwd) !== options.cwd) fail("cwd must be absolute and canonical");
  if (!Number.isSafeInteger(options.expectedGeneration) || (options.expectedGeneration as number) < 0) {
    fail("expected generation must be a non-negative safe integer");
  }
  if (typeof options.expectedAuthorityBundleSha256 !== "string" || !SHA256_RE.test(options.expectedAuthorityBundleSha256)) {
    fail("expected authority bundle hash is invalid");
  }
  if (!isPlainObject(options.observation)) fail("observation must be a plain object");
  if (Object.hasOwn(options, "hooks")) {
    if (!isPlainObject(options.hooks)) fail("append hooks are invalid");
    exactKeys(options.hooks, [], ["failAfter"], "append hooks");
    if (
      Object.hasOwn(options.hooks, "failAfter") &&
      !FAILURE_POINTS.has(options.hooks.failAfter as AnalysisAppendFailurePoint)
    ) fail("append failure point is invalid");
  }
}

function validateRecoveryOptions(options: unknown): asserts options is TrustedAnalysisRecoveryOptions {
  assertEnabled(options, "recovery");
  exactKeys(options, ["enabled", "cwd", "taskId", "repository"], [], "recovery options");
  assertIdentity(options.taskId, options.repository);
  if (typeof options.cwd !== "string" || path.resolve(options.cwd) !== options.cwd) fail("cwd must be absolute and canonical");
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

function parseLockOwner(paths: CoordinatorPaths): { pid: number; token: string } {
  assertSecureManagedDirectory(paths.projectRoot, paths.lockDir);
  const stat = fs.lstatSync(paths.lockDir);
  if ((stat.mode & 0o777) !== DIRECTORY_MODE) fail("coordinator lock has wrong mode");
  if (canonicalJson(fs.readdirSync(paths.lockDir).sort()) !== canonicalJson([LOCK_OWNER_FILE])) {
    fail("coordinator lock has unexpected entries");
  }
  const raw = readPrivateFile(paths.lockOwner, MAX_LOCK_OWNER_BYTES, "coordinator owner").bytes.toString("utf8");
  let owner: unknown;
  try { owner = JSON.parse(raw); } catch { fail("coordinator owner is not JSON"); }
  if (!isPlainObject(owner)) fail("coordinator owner is invalid");
  exactKeys(owner, ["schema_version", "pid", "token"], [], "coordinator owner");
  if (
    owner.schema_version !== 1 || !Number.isSafeInteger(owner.pid) || (owner.pid as number) < 1 ||
    typeof owner.token !== "string" || !/^[0-9a-f]{32}$/u.test(owner.token)
  ) fail("coordinator owner identity is invalid");
  return { pid: owner.pid as number, token: owner.token };
}

function acquireCoordinator(paths: CoordinatorPaths, reclaimExited: boolean): string | null {
  assertSecureManagedDirectory(paths.projectRoot, paths.taskDir);
  const taskStat = fs.lstatSync(paths.taskDir);
  if ((taskStat.mode & 0o777) !== DIRECTORY_MODE) fail("task directory has wrong mode");
  try {
    fs.mkdirSync(paths.lockDir, { mode: DIRECTORY_MODE });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let owner: { pid: number; token: string };
    try {
      owner = parseLockOwner(paths);
    } catch (ownerError) {
      if (ownerError instanceof Error && /unexpected entries|missing or unavailable/u.test(ownerError.message)) {
        return null;
      }
      throw ownerError;
    }
    if (processIsAlive(owner.pid)) return null;
    if (!reclaimExited) fail("coordinator lock belongs to an exited writer; explicit recovery is required");
    const quarantine = path.join(paths.taskDir, `.analysis-transaction.stale-${crypto.randomBytes(16).toString("hex")}`);
    fs.renameSync(paths.lockDir, quarantine);
    const quarantinedPaths = { ...paths, lockDir: quarantine, lockOwner: path.join(quarantine, LOCK_OWNER_FILE) };
    const confirmed = parseLockOwner(quarantinedPaths);
    if (confirmed.pid !== owner.pid || confirmed.token !== owner.token || processIsAlive(confirmed.pid)) {
      fail("exited coordinator identity changed during reclaim");
    }
    fs.rmSync(quarantinedPaths.lockOwner);
    fs.rmdirSync(quarantine);
    fs.mkdirSync(paths.lockDir, { mode: DIRECTORY_MODE });
  }
  const token = crypto.randomBytes(16).toString("hex");
  try {
    fs.writeFileSync(
      paths.lockOwner,
      `${canonicalJson({ schema_version: 1, pid: process.pid, token })}\n`,
      { encoding: "utf8", flag: "wx", mode: FILE_MODE },
    );
    const descriptor = fs.openSync(paths.lockOwner, "r");
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fsyncDirectory(paths.lockDir);
    fsyncDirectory(paths.taskDir);
    return token;
  } catch (error) {
    fs.rmSync(paths.lockDir, { recursive: true, force: true });
    throw error;
  }
}

function releaseCoordinator(paths: CoordinatorPaths, token: string): void {
  const owner = parseLockOwner(paths);
  if (owner.pid !== process.pid || owner.token !== token) fail("coordinator lock ownership changed");
  fs.rmSync(paths.lockOwner);
  fs.rmdirSync(paths.lockDir);
  fsyncDirectory(paths.taskDir);
}

function waitForCoordinator(paths: CoordinatorPaths): void {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      const owner = parseLockOwner(paths);
      if (!processIsAlive(owner.pid)) fail("coordinator lock exited; explicit recovery is required");
    } catch (error) {
      if (!fs.existsSync(paths.lockDir)) return;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      if (error instanceof Error && /missing or unavailable|unexpected entries/u.test(error.message)) {
        if (!fs.existsSync(paths.lockDir)) return;
        Atomics.wait(signal, 0, 0, 10);
        continue;
      }
      throw error;
    }
    Atomics.wait(signal, 0, 0, 10);
  }
  fail("another writer holds the coordinator lock");
}

function maybeFail(hooks: TrustedAnalysisAppendHooks | undefined, point: AnalysisAppendFailurePoint): void {
  if (hooks?.failAfter === point) fail(`injected failure after ${point}`);
}

function buildIntent(
  prepared: PreparedAppend,
  oldAuthorityFileSha256: string,
  paths: CoordinatorPaths,
): TransactionIntent {
  const rootStat = fs.lstatSync(paths.projectRoot, { bigint: true });
  const taskStat = fs.lstatSync(paths.taskDir, { bigint: true });
  const payload: TransactionIntentPayload = {
    schema_version: 1,
    repository: prepared.authority.repository,
    task_id: prepared.authority.task_id,
    primary_subject: prepared.authority.primary_subject,
    project_root_dev: rootStat.dev.toString(10),
    project_root_ino: rootStat.ino.toString(10),
    task_directory_dev: taskStat.dev.toString(10),
    task_directory_ino: taskStat.ino.toString(10),
    old_generation: prepared.trusted.persisted.manifest.generation,
    old_authority_bundle_sha256: prepared.trusted.authority.bundle_sha256,
    old_authority_file_sha256: oldAuthorityFileSha256,
    appended_observation_id: prepared.observation.id,
    appended_observation_payload_sha256: prepared.observation.payload_sha256,
    candidate_observations: prepared.observations,
    new_authority_bytes_base64: Buffer.from(prepared.authorityBytes, "utf8").toString("base64"),
    new_authority_file_sha256: sha256Bytes(prepared.authorityBytes),
    new_authority_bundle_sha256: prepared.authority.bundle_sha256,
    intended_generation: prepared.trusted.persisted.manifest.generation + 1,
    intended_snapshot_sha256: prepared.state.snapshot.snapshot_sha256,
    intended_observation_count: prepared.state.statistics.observation_count,
    intended_observation_head_sha256: prepared.state.snapshot.observation_head_sha256,
    intended_authority_manifest_sha256: prepared.authority.authority_manifest.manifest_sha256,
    intended_source_authority_registry_sha256: sha256Canonical(prepared.authority.source_authorities),
  };
  return { ...payload, intent_sha256: sha256Canonical(payload) };
}

function renderIntent(intent: TransactionIntent): string {
  const rendered = `${canonicalJson(intent)}\n`;
  if (Buffer.byteLength(rendered, "utf8") > MAX_INTENT_BYTES) fail("transaction intent exceeds its byte bound");
  return rendered;
}

function parseIntent(paths: CoordinatorPaths): TransactionIntent {
  const bytes = readPrivateFile(paths.intent, MAX_INTENT_BYTES, "transaction intent").bytes;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("transaction intent is not UTF-8");
  }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { fail("transaction intent is not JSON"); }
  if (!isPlainObject(raw)) fail("transaction intent is invalid");
  exactKeys(raw, [
    "schema_version", "repository", "task_id", "primary_subject", "project_root_dev",
    "project_root_ino", "task_directory_dev", "task_directory_ino", "old_generation",
    "old_authority_bundle_sha256", "old_authority_file_sha256", "appended_observation_id",
    "appended_observation_payload_sha256", "candidate_observations", "new_authority_bytes_base64",
    "new_authority_file_sha256", "new_authority_bundle_sha256", "intended_generation",
    "intended_snapshot_sha256", "intended_observation_count", "intended_observation_head_sha256",
    "intended_authority_manifest_sha256", "intended_source_authority_registry_sha256", "intent_sha256",
  ], [], "transaction intent");
  const intent = raw as unknown as TransactionIntent;
  const { intent_sha256: claimed, ...payload } = intent;
  if (
    intent.schema_version !== 1 || !REPOSITORY_ID_RE.test(intent.repository) ||
    !TASK_ID_RE.test(intent.task_id) || !Number.isSafeInteger(intent.old_generation) || intent.old_generation < 1 ||
    intent.intended_generation !== intent.old_generation + 1 ||
    !Number.isSafeInteger(intent.intended_observation_count) || intent.intended_observation_count < 1 ||
    !OBSERVATION_ID_RE.test(intent.appended_observation_id) || !Array.isArray(intent.candidate_observations)
  ) fail("transaction intent identity is invalid");
  for (const identity of [
    intent.project_root_dev, intent.project_root_ino,
    intent.task_directory_dev, intent.task_directory_ino,
  ]) if (typeof identity !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(identity)) {
    fail("transaction filesystem identity is invalid");
  }
  for (const digest of [
    intent.old_authority_bundle_sha256, intent.old_authority_file_sha256,
    intent.appended_observation_payload_sha256, intent.new_authority_file_sha256,
    intent.new_authority_bundle_sha256, intent.intended_snapshot_sha256,
    intent.intended_observation_head_sha256, intent.intended_authority_manifest_sha256,
    intent.intended_source_authority_registry_sha256, claimed,
  ]) if (!SHA256_RE.test(digest)) fail("transaction intent has an invalid hash");
  if (sha256Canonical(payload) !== claimed) fail("transaction intent hash changed");
  if (text !== `${canonicalJson(intent)}\n`) fail("transaction intent bytes are not canonical");
  return intent;
}

function verifyIntent(
  intent: TransactionIntent,
  options: TrustedAnalysisRecoveryOptions,
): { oldAuthority: AnalysisAuthorityBundle; newAuthority: AnalysisAuthorityBundle; state: AnalysisStateReader } {
  if (intent.task_id !== options.taskId || intent.repository !== options.repository) {
    fail("transaction intent identity changed");
  }
  const paths = coordinatorPaths(options.cwd, options.taskId);
  const rootStat = fs.lstatSync(paths.projectRoot, { bigint: true });
  const taskStat = fs.lstatSync(paths.taskDir, { bigint: true });
  if (
    rootStat.dev.toString(10) !== intent.project_root_dev || rootStat.ino.toString(10) !== intent.project_root_ino ||
    taskStat.dev.toString(10) !== intent.task_directory_dev || taskStat.ino.toString(10) !== intent.task_directory_ino
  ) fail("transaction filesystem identity changed");
  let authorityBytes: Buffer;
  try { authorityBytes = Buffer.from(intent.new_authority_bytes_base64, "base64"); } catch { fail("staged authority encoding is invalid"); }
  if (authorityBytes.toString("base64") !== intent.new_authority_bytes_base64) fail("staged authority encoding is not canonical");
  if (sha256Bytes(authorityBytes) !== intent.new_authority_file_sha256) fail("staged authority bytes changed");
  const newAuthority = parseAnalysisAuthorityBundle(authorityBytes.toString("utf8"), options.taskId);
  if (
    newAuthority.bundle_sha256 !== intent.new_authority_bundle_sha256 ||
    newAuthority.repository !== intent.repository || newAuthority.primary_subject !== intent.primary_subject
  ) fail("staged authority binding changed");
  if (intent.candidate_observations.length !== intent.intended_observation_count) {
    fail("candidate observation count changed");
  }
  const appended = intent.candidate_observations.at(-1);
  if (
    !appended || appended.id !== intent.appended_observation_id ||
    appended.payload_sha256 !== intent.appended_observation_payload_sha256
  ) fail("appended observation binding changed");
  const expectedManifest = createAuthorityManifest(intent.candidate_observations);
  if (
    canonicalJson(expectedManifest) !== canonicalJson(newAuthority.authority_manifest) ||
    expectedManifest.manifest_sha256 !== intent.intended_authority_manifest_sha256 ||
    sha256Canonical(newAuthority.source_authorities) !== intent.intended_source_authority_registry_sha256
  ) fail("candidate authority binding changed");
  const state = evaluateAnalysisState(
    inputFor(intent.candidate_observations),
    newAuthority.authority_manifest,
    newAuthority.source_authorities,
  ) as AnalysisStateReader;
  if (
    state.snapshot.snapshot_sha256 !== intent.intended_snapshot_sha256 ||
    state.snapshot.observation_head_sha256 !== intent.intended_observation_head_sha256 ||
    state.statistics.observation_count !== intent.intended_observation_count
  ) fail("intended store binding changed");
  const oldObservations = intent.candidate_observations.slice(0, -1);
  const oldAuthority = createAnalysisAuthorityBundle({
    schema_version: 1,
    repository: newAuthority.repository,
    task_id: newAuthority.task_id,
    primary_subject: newAuthority.primary_subject,
    authority_manifest: createAuthorityManifest(oldObservations) as AuthorityManifest,
    source_authorities: newAuthority.source_authorities,
  });
  if (oldAuthority.bundle_sha256 !== intent.old_authority_bundle_sha256) {
    fail("old authority binding changed");
  }
  return { oldAuthority, newAuthority, state };
}

function assertPersistedBindings(persisted: PersistedAnalysisState, intent: TransactionIntent): void {
  if (
    persisted.manifest.generation !== intent.intended_generation ||
    persisted.manifest.observation_count !== intent.intended_observation_count ||
    persisted.manifest.snapshot_sha256 !== intent.intended_snapshot_sha256 ||
    persisted.manifest.observation_head_sha256 !== intent.intended_observation_head_sha256 ||
    persisted.manifest.authority_manifest_sha256 !== intent.intended_authority_manifest_sha256 ||
    persisted.manifest.source_authority_registry_sha256 !== intent.intended_source_authority_registry_sha256
  ) fail("published store differs from transaction intent");
}

function resultFor(
  persisted: PersistedAnalysisState,
  authority: AnalysisAuthorityBundle,
  appendedObservationId: string,
): TrustedAnalysisAppendResult {
  const result: TrustedAnalysisAppendResult = {
    schema_version: 1,
    generation: persisted.manifest.generation,
    snapshot_sha256: persisted.manifest.snapshot_sha256,
    observation_count: persisted.manifest.observation_count,
    observation_head_sha256: persisted.manifest.observation_head_sha256,
    authority_bundle_sha256: authority.bundle_sha256,
    authority_manifest_sha256: authority.authority_manifest.manifest_sha256,
    source_authority_registry_sha256: sha256Canonical(authority.source_authorities),
    appended_observation_id: appendedObservationId,
  };
  if (Buffer.byteLength(canonicalJson(result), "utf8") > LIMITS.rendered_bytes) fail("append result exceeds its bound");
  return result;
}

function removePrivateFile(paths: CoordinatorPaths, filePath: string, label: string, allowMissing = false): void {
  try {
    assertSecureManagedFile(paths.projectRoot, filePath);
    const stat = fs.lstatSync(filePath);
    if ((stat.mode & 0o777) !== FILE_MODE) fail(`${label} has wrong mode`);
    fs.rmSync(filePath);
    fsyncDirectory(paths.taskDir);
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

function commitAuthority(
  paths: CoordinatorPaths,
  intent: TransactionIntent,
  oldAuthorityBound?: BoundFile,
): void {
  if (!fs.existsSync(paths.authorityStage)) {
    const bytes = Buffer.from(intent.new_authority_bytes_base64, "base64").toString("utf8");
    atomicWriteText(paths.authorityStage, bytes, paths.projectRoot);
  }
  const staged = readPrivateFile(paths.authorityStage, ANALYSIS_AUTHORITY_MAX_BYTES, "staged authority");
  if (sha256Bytes(staged.bytes) !== intent.new_authority_file_sha256) fail("staged authority file changed");
  const current = readPrivateFile(paths.authority, ANALYSIS_AUTHORITY_MAX_BYTES, "current authority");
  if (oldAuthorityBound) assertSameFile(paths.authority, oldAuthorityBound, "current authority");
  if (sha256Bytes(current.bytes) !== intent.old_authority_file_sha256) fail("current authority bytes changed");
  const parsed = parseAnalysisAuthorityBundle(current.bytes.toString("utf8"), intent.task_id);
  if (parsed.bundle_sha256 !== intent.old_authority_bundle_sha256) fail("current authority binding changed");
  fs.renameSync(paths.authorityStage, paths.authority);
  fs.chmodSync(paths.authority, FILE_MODE);
  fsyncDirectory(paths.taskDir);
  const committed = readPrivateFile(paths.authority, ANALYSIS_AUTHORITY_MAX_BYTES, "committed authority");
  if (sha256Bytes(committed.bytes) !== intent.new_authority_file_sha256) fail("committed authority changed");
}

function appendWithCoordinator(
  options: TrustedAnalysisAppendOptions,
  prepared: PreparedAppend,
  paths: CoordinatorPaths,
  token: string,
): TrustedAnalysisAppendResult {
  try {
    const current = prepareAppend(options);
    const directories = bindCoordinatorDirectories(paths);
    if (
      current.observation.id !== prepared.observation.id ||
      current.authority.bundle_sha256 !== prepared.authority.bundle_sha256
    ) fail("append candidate changed after coordinator acquisition");
    assertCoordinatorDirectories(directories);
    const oldAuthority = readPrivateFile(paths.authority, ANALYSIS_AUTHORITY_MAX_BYTES, "current authority");
    const parsedOld = parseAnalysisAuthorityBundle(oldAuthority.bytes.toString("utf8"), options.taskId);
    if (parsedOld.bundle_sha256 !== current.trusted.authority.bundle_sha256) fail("current authority bytes are unbound");
    const intent = buildIntent(current, sha256Bytes(oldAuthority.bytes), paths);
    assertCoordinatorDirectories(directories);
    atomicWriteText(paths.intent, renderIntent(intent), paths.projectRoot);
    maybeFail(options.hooks, "intent");
    assertCoordinatorDirectories(directories);
    atomicWriteText(paths.authorityStage, current.authorityBytes, paths.projectRoot);
    maybeFail(options.hooks, "authority_stage");
    const failAfter = options.hooks?.failAfter;
    assertCoordinatorDirectories(directories);
    const persisted = publishAnalysisState({
      cwd: paths.projectRoot,
      taskId: options.taskId,
      repository: options.repository,
      input: inputFor(current.observations),
      authorityManifest: current.authority.authority_manifest,
      sourceAuthorities: current.authority.source_authorities,
      expectedGeneration: options.expectedGeneration,
      failAfter: failAfter === "observations" || failAfter === "snapshot" || failAfter === "changes"
        ? failAfter
        : undefined,
    });
    assertPersistedBindings(persisted, intent);
    maybeFail(options.hooks, "store");
    assertCoordinatorDirectories(directories);
    commitAuthority(paths, intent, oldAuthority);
    maybeFail(options.hooks, "authority");
    assertCoordinatorDirectories(directories);
    removePrivateFile(paths, paths.intent, "transaction intent");
    maybeFail(options.hooks, "intent_cleanup");
    return resultFor(persisted, current.authority, current.observation.id);
  } finally {
    releaseCoordinator(paths, token);
  }
}

export function appendTrustedAnalysisObservation(options: TrustedAnalysisAppendOptions): TrustedAnalysisAppendResult {
  validateAppendOptions(options);
  let prepared = prepareAppend(options);
  const paths = coordinatorPaths(options.cwd, options.taskId);
  for (;;) {
    const token = acquireCoordinator(paths, false);
    if (token) return appendWithCoordinator(options, prepared, paths, token);
    waitForCoordinator(paths);
    prepared = prepareAppend(options);
  }
}

function tryReadStore(
  paths: CoordinatorPaths,
  authority: AnalysisAuthorityBundle,
): PersistedAnalysisState | null {
  try {
    return readAnalysisState({
      cwd: paths.projectRoot,
      taskId: authority.task_id,
      repository: authority.repository,
      authorityManifest: authority.authority_manifest,
      sourceAuthorities: authority.source_authorities,
    });
  } catch {
    return null;
  }
}

export function recoverTrustedAnalysisObservation(
  options: TrustedAnalysisRecoveryOptions,
): TrustedAnalysisRecoveryResult {
  validateRecoveryOptions(options);
  const paths = coordinatorPaths(options.cwd, options.taskId);
  const token = acquireCoordinator(paths, true);
  if (!token) fail("another writer holds the coordinator lock");
  try {
    const directories = bindCoordinatorDirectories(paths);
    assertCoordinatorDirectories(directories);
    const intent = parseIntent(paths);
    const verified = verifyIntent(intent, options);
    if (fs.existsSync(paths.authorityStage)) {
      const staged = readPrivateFile(paths.authorityStage, ANALYSIS_AUTHORITY_MAX_BYTES, "staged authority");
      if (sha256Bytes(staged.bytes) !== intent.new_authority_file_sha256) {
        fail("staged authority file changed");
      }
    }
    const currentAuthorityFile = readPrivateFile(paths.authority, ANALYSIS_AUTHORITY_MAX_BYTES, "current authority");
    const currentAuthority = parseAnalysisAuthorityBundle(currentAuthorityFile.bytes.toString("utf8"), options.taskId);
    if (
      currentAuthority.bundle_sha256 !== verified.oldAuthority.bundle_sha256 &&
      currentAuthority.bundle_sha256 !== verified.newAuthority.bundle_sha256
    ) fail("current authority does not belong to the transaction");

    const oldStore = tryReadStore(paths, verified.oldAuthority);
    const newStore = tryReadStore(paths, verified.newAuthority);
    if (oldStore && newStore) fail("store is ambiguously bound to old and new authority");
    if (oldStore) {
      if (currentAuthority.bundle_sha256 !== verified.oldAuthority.bundle_sha256) {
        fail("new authority cannot precede the store commit");
      }
      if (
        oldStore.manifest.generation !== intent.old_generation ||
        oldStore.manifest.observation_count !== intent.candidate_observations.length - 1
      ) fail("old store binding changed");
      assertCoordinatorDirectories(directories);
      removePrivateFile(paths, paths.authorityStage, "staged authority", true);
      removePrivateFile(paths, paths.intent, "transaction intent");
      return {
        ...resultFor(oldStore, verified.oldAuthority, intent.appended_observation_id),
        outcome: "aborted",
      };
    }

    let persisted = newStore;
    if (!persisted) {
      if (currentAuthority.bundle_sha256 !== verified.oldAuthority.bundle_sha256) {
        fail("partial store has already replaced authority");
      }
      assertCoordinatorDirectories(directories);
      persisted = recoverAnalysisState({
        cwd: paths.projectRoot,
        taskId: options.taskId,
        repository: options.repository,
        input: inputFor(intent.candidate_observations),
        authorityManifest: verified.newAuthority.authority_manifest,
        sourceAuthorities: verified.newAuthority.source_authorities,
      });
    }
    assertPersistedBindings(persisted, intent);
    assertCoordinatorDirectories(directories);
    if (currentAuthority.bundle_sha256 === verified.oldAuthority.bundle_sha256) {
      commitAuthority(paths, intent);
    }
    assertCoordinatorDirectories(directories);
    removePrivateFile(paths, paths.authorityStage, "staged authority", true);
    removePrivateFile(paths, paths.intent, "transaction intent");
    return {
      ...resultFor(persisted, verified.newAuthority, intent.appended_observation_id),
      outcome: "completed",
    };
  } finally {
    releaseCoordinator(paths, token);
  }
}

export const ANALYSIS_TRANSACTION_LOCK_DIRECTORY = LOCK_DIRECTORY;
export const ANALYSIS_TRANSACTION_INTENT_MAX_BYTES = MAX_INTENT_BYTES;
