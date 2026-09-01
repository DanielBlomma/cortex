import fs from "node:fs";
import path from "node:path";

import {
  canonicalJson,
  createSourceAuthorityRegistry,
  LIMITS,
  sha256Canonical,
} from "./engine.js";
import {
  readAnalysisState,
  type PersistedAnalysisState,
} from "./store.js";
import type {
  AuthorityManifest,
  SourceAuthorityRegistry,
} from "./schemas.js";

const TASK_ID_RE = /^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$/;
const REPOSITORY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;
const SUBJECT_RE = /^(?:WO|wo|review|task|fixture|test)[A-Za-z0-9:-]{1,119}$/;
const OBSERVATION_ID_RE = /^obs:[0-9a-f]{64}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const AUTHORITY_FILE = "analysis-authority.json";
const TRANSACTION_INTENT_FILE = ".analysis-append.intent.json";
const TRANSACTION_STAGE_FILE = ".analysis-authority.next";
const AUTHORITY_MODE = 0o600;
const MAX_AUTHORITY_BYTES = 512 * 1024;

export type AnalysisQueryErrorCode =
  | "STATE_NOT_FOUND"
  | "AUTHORITY_INVALID"
  | "STATE_UNTRUSTED";

export class AnalysisQueryError extends Error {
  readonly code: AnalysisQueryErrorCode;

  constructor(code: AnalysisQueryErrorCode, message: string) {
    super(message);
    this.name = "AnalysisQueryError";
    this.code = code;
  }
}

export type AnalysisAuthorityBundle = {
  schema_version: 1;
  repository: string;
  task_id: string;
  primary_subject: string;
  authority_manifest: AuthorityManifest;
  source_authorities: SourceAuthorityRegistry;
  bundle_sha256: string;
};

export type TrustedAnalysisState = {
  authority: AnalysisAuthorityBundle;
  persisted: PersistedAnalysisState;
};

type BoundIdentity = {
  path: string;
  kind: "directory" | "file";
  strict: boolean;
  dev: bigint;
  ino: bigint;
  ctimeNs: bigint;
  mtimeNs: bigint;
  mode: bigint;
  nlink: bigint;
  size: bigint;
};

export type AnalysisQueryReadHooks = {
  afterAuthorityRead?: () => void;
};

export type TrustedAnalysisReadOptions = {
  cwd: string;
  taskId: string;
  hooks?: AnalysisQueryReadHooks;
};

function queryError(code: AnalysisQueryErrorCode, message: string): never {
  throw new AnalysisQueryError(code, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...expected].sort())) {
    queryError("AUTHORITY_INVALID", `${label} has unknown or missing keys`);
  }
}

function bindPath(
  target: string,
  kind: "directory" | "file",
  missingCode: AnalysisQueryErrorCode,
  strict = true,
): BoundIdentity {
  let stats: fs.BigIntStats;
  try {
    stats = fs.lstatSync(target, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      queryError(missingCode, "maintained analysis path is missing");
    }
    queryError("STATE_UNTRUSTED", "maintained analysis path could not be bound");
  }
  if (stats.isSymbolicLink() || (kind === "directory" ? !stats.isDirectory() : !stats.isFile())) {
    queryError("STATE_UNTRUSTED", "maintained analysis path has an unsafe type");
  }
  if (kind === "file" && stats.nlink !== 1n) {
    queryError("STATE_UNTRUSTED", "maintained analysis file is not single-link");
  }
  return {
    path: target,
    kind,
    strict,
    dev: stats.dev,
    ino: stats.ino,
    ctimeNs: stats.ctimeNs,
    mtimeNs: stats.mtimeNs,
    mode: stats.mode,
    nlink: stats.nlink,
    size: stats.size,
  };
}

function sameIdentity(before: BoundIdentity, after: BoundIdentity): boolean {
  if (
    before.kind !== after.kind || before.dev !== after.dev || before.ino !== after.ino ||
    before.mode !== after.mode
  ) return false;
  if (!before.strict && before.kind === "directory") return true;
  if (before.nlink !== after.nlink) return false;
  return before.ctimeNs === after.ctimeNs && before.mtimeNs === after.mtimeNs && before.size === after.size;
}

function bindTransaction(projectRoot: string, taskId: string): BoundIdentity[] {
  const agentsDir = path.join(projectRoot, ".agents");
  const taskDir = path.join(agentsDir, taskId);
  const analysisDir = path.join(taskDir, "analysis");
  const authorityPath = path.join(taskDir, AUTHORITY_FILE);
  const paths: Array<[string, "directory" | "file", AnalysisQueryErrorCode, boolean]> = [
    [projectRoot, "directory", "STATE_NOT_FOUND", false],
    [agentsDir, "directory", "STATE_NOT_FOUND", true],
    [taskDir, "directory", "STATE_NOT_FOUND", true],
    [analysisDir, "directory", "STATE_NOT_FOUND", true],
    [path.join(analysisDir, "observations.jsonl"), "file", "STATE_UNTRUSTED", true],
    [path.join(analysisDir, "snapshot.json"), "file", "STATE_UNTRUSTED", true],
    [path.join(analysisDir, "changes.jsonl"), "file", "STATE_UNTRUSTED", true],
    [path.join(analysisDir, "manifest.json"), "file", "STATE_UNTRUSTED", true],
  ];
  const state = paths.map(([target, kind, missingCode, strict]) => bindPath(target, kind, missingCode, strict));
  try {
    state.push(bindPath(authorityPath, "file", "AUTHORITY_INVALID"));
  } catch (error) {
    throw error;
  }
  return state;
}

function assertTransactionUnchanged(before: BoundIdentity[]): void {
  for (const identity of before) {
    let after: BoundIdentity;
    try {
      after = bindPath(identity.path, identity.kind, "STATE_UNTRUSTED", identity.strict);
    } catch {
      queryError("STATE_UNTRUSTED", "maintained analysis state changed during read");
    }
    if (!sameIdentity(identity, after)) {
      queryError("STATE_UNTRUSTED", "maintained analysis state changed during read");
    }
  }
}

function readAuthorityBytes(identity: BoundIdentity): string {
  const descriptor = fs.openSync(
    identity.path,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (
      !before.isFile() || before.nlink !== 1n ||
      (before.mode & 0o777n) !== BigInt(AUTHORITY_MODE) ||
      before.dev !== identity.dev || before.ino !== identity.ino || before.ctimeNs !== identity.ctimeNs
    ) {
      queryError("STATE_UNTRUSTED", "maintained analysis authority failed containment policy");
    }
    if (before.size > BigInt(MAX_AUTHORITY_BYTES)) {
      queryError("AUTHORITY_INVALID", "maintained analysis authority exceeds its byte bound");
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (
      before.dev !== after.dev || before.ino !== after.ino || before.ctimeNs !== after.ctimeNs ||
      before.mtimeNs !== after.mtimeNs || before.mode !== after.mode || before.nlink !== after.nlink ||
      before.size !== after.size || BigInt(bytes.byteLength) !== after.size
    ) {
      queryError("STATE_UNTRUSTED", "maintained analysis authority changed during read");
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      queryError("AUTHORITY_INVALID", "maintained analysis authority is not UTF-8");
    }
    return text;
  } finally {
    fs.closeSync(descriptor);
  }
}

function validateAuthorityManifest(raw: unknown): AuthorityManifest {
  if (!isPlainObject(raw)) queryError("AUTHORITY_INVALID", "authority manifest must be an object");
  exactKeys(raw, ["schema_version", "claims", "manifest_sha256"], "authority manifest");
  if (raw.schema_version !== 1 || !Array.isArray(raw.claims) || raw.claims.length > LIMITS.observations) {
    queryError("AUTHORITY_INVALID", "authority manifest shape is invalid");
  }
  let previous = "";
  const claims = raw.claims.map((item) => {
    if (!isPlainObject(item)) queryError("AUTHORITY_INVALID", "authority claim must be an object");
    exactKeys(item, ["observation_id", "claim_sha256"], "authority claim");
    if (
      typeof item.observation_id !== "string" || !OBSERVATION_ID_RE.test(item.observation_id) ||
      typeof item.claim_sha256 !== "string" || !SHA256_RE.test(item.claim_sha256) ||
      item.observation_id <= previous
    ) {
      queryError("AUTHORITY_INVALID", "authority claims are not canonical");
    }
    previous = item.observation_id;
    return { observation_id: item.observation_id, claim_sha256: item.claim_sha256 };
  });
  if (typeof raw.manifest_sha256 !== "string" || !SHA256_RE.test(raw.manifest_sha256)) {
    queryError("AUTHORITY_INVALID", "authority manifest hash is invalid");
  }
  if (sha256Canonical({ schema_version: 1, claims }) !== raw.manifest_sha256) {
    queryError("STATE_UNTRUSTED", "authority manifest hash changed");
  }
  return { schema_version: 1, claims, manifest_sha256: raw.manifest_sha256 };
}

export function parseAnalysisAuthorityBundle(text: string, taskId: string): AnalysisAuthorityBundle {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    queryError("AUTHORITY_INVALID", "maintained analysis authority is not JSON");
  }
  if (!isPlainObject(raw)) queryError("AUTHORITY_INVALID", "authority bundle must be an object");
  exactKeys(raw, [
    "schema_version", "repository", "task_id", "primary_subject",
    "authority_manifest", "source_authorities", "bundle_sha256",
  ], "authority bundle");
  if (
    raw.schema_version !== 1 || typeof raw.repository !== "string" ||
    !REPOSITORY_ID_RE.test(raw.repository) || typeof raw.task_id !== "string" ||
    !TASK_ID_RE.test(raw.task_id) || typeof raw.primary_subject !== "string" ||
    !SUBJECT_RE.test(raw.primary_subject) || typeof raw.bundle_sha256 !== "string" ||
    !SHA256_RE.test(raw.bundle_sha256)
  ) {
    queryError("AUTHORITY_INVALID", "authority bundle identity is invalid");
  }
  if (raw.task_id !== taskId) queryError("STATE_UNTRUSTED", "authority bundle task identity changed");
  const authorityManifest = validateAuthorityManifest(raw.authority_manifest);
  let sourceAuthorities: SourceAuthorityRegistry;
  try {
    sourceAuthorities = createSourceAuthorityRegistry(raw.source_authorities) as SourceAuthorityRegistry;
  } catch {
    queryError("AUTHORITY_INVALID", "source authority registry is invalid");
  }
  const payload = {
    schema_version: 1 as const,
    repository: raw.repository,
    task_id: raw.task_id,
    primary_subject: raw.primary_subject,
    authority_manifest: authorityManifest,
    source_authorities: sourceAuthorities,
  };
  if (sha256Canonical(payload) !== raw.bundle_sha256) {
    queryError("STATE_UNTRUSTED", "authority bundle hash changed");
  }
  return Object.freeze({ ...payload, bundle_sha256: raw.bundle_sha256 });
}

export function createAnalysisAuthorityBundle(
  input: Omit<AnalysisAuthorityBundle, "bundle_sha256">,
): AnalysisAuthorityBundle {
  const payload = {
    schema_version: input.schema_version,
    repository: input.repository,
    task_id: input.task_id,
    primary_subject: input.primary_subject,
    authority_manifest: input.authority_manifest,
    source_authorities: input.source_authorities,
  };
  return parseAnalysisAuthorityBundle(
    `${canonicalJson({ ...payload, bundle_sha256: sha256Canonical(payload) })}\n`,
    input.task_id,
  );
}

export function renderAnalysisAuthorityBundle(bundle: AnalysisAuthorityBundle): string {
  return `${canonicalJson(bundle)}\n`;
}

function assertNoAnalysisTransaction(taskDir: string): void {
  for (const name of [TRANSACTION_INTENT_FILE, TRANSACTION_STAGE_FILE]) {
    try {
      fs.lstatSync(path.join(taskDir, name));
      queryError("STATE_UNTRUSTED", "maintained analysis transaction is incomplete");
    } catch (error) {
      if (error instanceof AnalysisQueryError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        queryError("STATE_UNTRUSTED", "maintained analysis transaction could not be bound");
      }
    }
  }
}

export function readTrustedAnalysisState(options: TrustedAnalysisReadOptions): TrustedAnalysisState {
  if (!TASK_ID_RE.test(options.taskId)) queryError("AUTHORITY_INVALID", "task ID is invalid");
  const resolved = path.resolve(options.cwd);
  let projectRoot: string;
  try {
    projectRoot = fs.realpathSync(resolved);
  } catch {
    queryError("STATE_UNTRUSTED", "project root is unavailable");
  }
  if (projectRoot !== resolved) queryError("STATE_UNTRUSTED", "project root identity is not canonical");

  assertNoAnalysisTransaction(path.join(projectRoot, ".agents", options.taskId));
  const transaction = bindTransaction(projectRoot, options.taskId);
  const authorityIdentity = transaction.at(-1)!;
  const authority = parseAnalysisAuthorityBundle(readAuthorityBytes(authorityIdentity), options.taskId);
  options.hooks?.afterAuthorityRead?.();

  let persisted: PersistedAnalysisState | null;
  try {
    persisted = readAnalysisState({
      cwd: projectRoot,
      taskId: options.taskId,
      repository: authority.repository,
      authorityManifest: authority.authority_manifest,
      sourceAuthorities: authority.source_authorities,
    });
  } catch {
    queryError("STATE_UNTRUSTED", "maintained analysis replay failed");
  }
  if (!persisted) queryError("STATE_NOT_FOUND", "maintained analysis state is missing");
  assertTransactionUnchanged(transaction);
  return { authority, persisted };
}

export const ANALYSIS_AUTHORITY_FILE = AUTHORITY_FILE;
export const ANALYSIS_AUTHORITY_MAX_BYTES = MAX_AUTHORITY_BYTES;
export const ANALYSIS_TRANSACTION_INTENT_FILE = TRANSACTION_INTENT_FILE;
export const ANALYSIS_TRANSACTION_STAGE_FILE = TRANSACTION_STAGE_FILE;
