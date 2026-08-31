import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  atomicWriteText,
  ensureSecureManagedDirectory,
  fsyncDirectory,
} from "../../progressiveIndexing.js";
import {
  canonicalJson,
  createAuthorityManifest,
  createObservation,
  createSourceAuthorityRegistry,
  LIMITS,
  REGISTERED_RULE_IDS,
  sha256Canonical,
} from "./engine.js";
import {
  ANALYSIS_AUTHORITY_FILE,
  ANALYSIS_AUTHORITY_MAX_BYTES,
  createAnalysisAuthorityBundle,
  readTrustedAnalysisState,
  renderAnalysisAuthorityBundle,
  type TrustedAnalysisState,
} from "./query-reader.js";
import {
  ANALYSIS_DIRECTORY_NAME,
  ANALYSIS_STORE_FILES,
  type AnalysisInput,
  type AuthorityManifest,
  type CanonicalValue,
  type Observation,
  type ObservationInput,
  type SourceAuthorityRegistry,
} from "./schemas.js";
import { publishAnalysisState } from "./store.js";

const GENERATOR = "maintained-analysis-git-provisioning-v1";
const RECEIPT_FILE = "analysis-provisioning.json";
const OWNER_FILE = "owner.json";
const STAGE_PREFIX = ".analysis-provision-";
const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const MAX_SEED_BYTES = 512 * 1024;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_OWNER_BYTES = 16 * 1024;
const MAX_RECEIPT_BYTES = 64 * 1024;
const MAX_STAGE_FILE_BYTES = 8 * 1024 * 1024;
const TASK_ID_RE = /^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$/;
const REPOSITORY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;
const SUBJECT_RE = /^(?:WO|wo|review|task|fixture|test)[A-Za-z0-9:-]{1,119}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const TOKEN_RE = /^[0-9a-f]{32}$/;
const PORTABLE_PATH_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const FAILURE_POINTS = new Set<ProvisioningFailurePoint>([
  "owner", "observations", "snapshot", "changes", "store", "authority",
  "receipt", "candidate_fsync", "validation", "before_rename", "after_rename", "cleanup",
]);

export type ProvisioningFailurePoint =
  | "owner"
  | "observations"
  | "snapshot"
  | "changes"
  | "store"
  | "authority"
  | "receipt"
  | "candidate_fsync"
  | "validation"
  | "before_rename"
  | "after_rename"
  | "cleanup";

export type TrackedAnalysisProvisioningHooks = {
  failAfter?: ProvisioningFailurePoint;
  afterGitBinding?: () => void;
  afterStageOwner?: () => void;
  beforeRename?: () => void;
};

export type TrackedAnalysisProvisioningOptions = {
  enabled: true;
  cwd: string;
  seedPath: string;
  hooks?: TrackedAnalysisProvisioningHooks;
};

export type TrackedAnalysisProvisioningResult = {
  schema_version: 1;
  generator: typeof GENERATOR;
  outcome: "created" | "already_provisioned";
  repository: string;
  task_id: string;
  primary_subject: string;
  head_oid: string;
  tree_oid: string;
  seed_blob_oid: string;
  seed_sha256: string;
  generation: number;
  observation_count: number;
  snapshot_sha256: string;
  authority_bundle_sha256: string;
  authority_manifest_sha256: string;
  source_authority_registry_sha256: string;
};

export type AnalysisProvisioningErrorCode =
  | "PROVISIONING_INVALID"
  | "PROVISIONING_CONFLICT"
  | "PROVISIONING_UNTRUSTED";

export class AnalysisProvisioningError extends Error {
  readonly code: AnalysisProvisioningErrorCode;

  constructor(code: AnalysisProvisioningErrorCode, message: string) {
    super(message);
    this.name = "AnalysisProvisioningError";
    this.code = code;
  }
}

type BoundFile = {
  relativePath: string;
  mode: "100644" | "100755";
  blobOid: string;
  bytes: Buffer;
  sha256: string;
  dev: bigint;
  ino: bigint;
  ctimeNs: bigint;
  mtimeNs: bigint;
  fsMode: bigint;
  nlink: bigint;
  size: bigint;
  ancestors: BoundDirectory[];
};

type BoundDirectory = {
  absolutePath: string;
  dev: bigint;
  ino: bigint;
  mode: bigint;
};

type GitContext = {
  root: string;
  rootDev: bigint;
  rootIno: bigint;
  rootMode: bigint;
  gitDir: string;
  gitDirDev: bigint;
  gitDirIno: bigint;
  oidLength: number;
  headOid: string;
  treeOid: string;
};

type ClosedSeed = {
  repository: string;
  taskId: string;
  primarySubject: string;
  seedSha256: string;
  observations: Observation[];
  sourceAuthorities: SourceAuthorityRegistry;
  authorityManifest: AuthorityManifest;
};

type PreparedProvision = {
  git: GitContext;
  seedPath: string;
  seedFile: BoundFile;
  sourceFiles: BoundFile[];
  seed: ClosedSeed;
};

type ProvisioningReceiptPayload = {
  schema_version: 1;
  generator: typeof GENERATOR;
  repository: string;
  task_id: string;
  primary_subject: string;
  head_oid: string;
  tree_oid: string;
  seed_path: string;
  seed_blob_oid: string;
  seed_sha256: string;
  generation: number;
  observation_count: number;
  snapshot_sha256: string;
  authority_bundle_sha256: string;
  authority_manifest_sha256: string;
  source_authority_registry_sha256: string;
};

type ProvisioningReceipt = ProvisioningReceiptPayload & { receipt_sha256: string };

type OwnerRecord = {
  schema_version: 1;
  generator: typeof GENERATOR;
  pid: number;
  process_started_ms: number;
  token: string;
  project_root_dev: string;
  project_root_ino: string;
  repository: string;
  task_id: string;
  head_oid: string;
  tree_oid: string;
  seed_path: string;
  seed_blob_oid: string;
  seed_sha256: string;
  intended: ProvisioningReceipt | null;
};

function provisioningError(code: AnalysisProvisioningErrorCode, message: string): never {
  throw new AnalysisProvisioningError(code, `tracked analysis provisioning: ${message}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}

function sha256Bytes(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function assertPortablePath(value: unknown, label: "seed" | "source"): asserts value is string {
  if (
    typeof value !== "string" || value.length < 1 || value.length > 512 ||
    !PORTABLE_PATH_RE.test(value) || path.posix.normalize(value) !== value ||
    value.split("/").some((component) => component === "." || component === "..")
  ) provisioningError("PROVISIONING_INVALID", `${label} path is invalid`);
  const first = value.split("/")[0];
  if (first === ".git" || first === ".agents" || first.startsWith(STAGE_PREFIX)) {
    provisioningError("PROVISIONING_INVALID", `${label} path is reserved`);
  }
}

function validateOptions(value: unknown): asserts value is TrackedAnalysisProvisioningOptions {
  if (!isPlainObject(value) || !exactKeys(value, ["enabled", "cwd", "seedPath"], ["hooks"])) {
    provisioningError("PROVISIONING_INVALID", "options are not closed");
  }
  if (value.enabled !== true) provisioningError("PROVISIONING_INVALID", "provisioning is not enabled");
  if (typeof value.cwd !== "string" || path.resolve(value.cwd) !== value.cwd) {
    provisioningError("PROVISIONING_INVALID", "cwd is not an absolute canonical path");
  }
  assertPortablePath(value.seedPath, "seed");
  if (Object.hasOwn(value, "hooks")) {
    if (!isPlainObject(value.hooks) || !exactKeys(value.hooks, [], ["failAfter", "afterGitBinding", "afterStageOwner", "beforeRename"])) {
      provisioningError("PROVISIONING_INVALID", "test hooks are invalid");
    }
    if (Object.hasOwn(value.hooks, "failAfter") && !FAILURE_POINTS.has(value.hooks.failAfter as ProvisioningFailurePoint)) {
      provisioningError("PROVISIONING_INVALID", "test failure point is invalid");
    }
    for (const name of ["afterGitBinding", "afterStageOwner", "beforeRename"] as const) {
      if (Object.hasOwn(value.hooks, name) && typeof value.hooks[name] !== "function") {
        provisioningError("PROVISIONING_INVALID", "test race hook is invalid");
      }
    }
  }
}

function maybeFail(hooks: TrackedAnalysisProvisioningHooks | undefined, point: ProvisioningFailurePoint): void {
  if (hooks?.failAfter === point) provisioningError("PROVISIONING_UNTRUSTED", "injected boundary failure");
}

function runGit(root: string, args: string[], maximumBytes = 1024 * 1024, acceptedStatuses = [0]): Buffer {
  const gitEnvironment = { ...process.env };
  for (const name of Object.keys(gitEnvironment)) {
    if (name.startsWith("GIT_")) delete gitEnvironment[name];
  }
  const result = spawnSync(
    "git",
    [
      "--no-pager",
      "-c", "core.hooksPath=/dev/null",
      "-c", "core.fsmonitor=false",
      "-c", "core.untrackedCache=false",
      "-c", "core.attributesFile=/dev/null",
      "-c", "credential.helper=",
      "-c", "core.pager=cat",
      ...args,
    ],
    {
      cwd: root,
      encoding: null,
      maxBuffer: maximumBytes,
      timeout: 15_000,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...gitEnvironment,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
        GIT_PAGER: "cat",
        GIT_EDITOR: "true",
        GIT_SEQUENCE_EDITOR: "true",
        GIT_NO_REPLACE_OBJECTS: "1",
        GIT_LITERAL_PATHSPECS: "1",
        LC_ALL: "C",
      },
    },
  );
  if (result.error || result.signal || result.status === null || !acceptedStatuses.includes(result.status)) {
    provisioningError("PROVISIONING_UNTRUSTED", "Git binding failed");
  }
  const stdout = result.stdout ?? Buffer.alloc(0);
  const stderr = result.stderr ?? Buffer.alloc(0);
  if (stdout.length > maximumBytes || stderr.length > 64 * 1024) {
    provisioningError("PROVISIONING_UNTRUSTED", "Git output exceeded its bound");
  }
  return stdout;
}

function oneLine(bytes: Buffer, label: string): string {
  const value = bytes.toString("utf8");
  if (!value.endsWith("\n") || value.slice(0, -1).includes("\n") || value.includes("\0")) {
    provisioningError("PROVISIONING_UNTRUSTED", `${label} binding is invalid`);
  }
  return value.slice(0, -1);
}

function bindGitContext(root: string): GitContext {
  let physical: string;
  try { physical = fs.realpathSync(root); } catch { provisioningError("PROVISIONING_UNTRUSTED", "repository root is unavailable"); }
  if (physical !== root) provisioningError("PROVISIONING_UNTRUSTED", "repository root is not physical");
  const rootStat = fs.lstatSync(root, { bigint: true });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) provisioningError("PROVISIONING_UNTRUSTED", "repository root type is unsafe");
  const top = oneLine(runGit(root, ["rev-parse", "--show-toplevel"]), "repository root");
  let topPhysical: string;
  try { topPhysical = fs.realpathSync(top); } catch { provisioningError("PROVISIONING_UNTRUSTED", "Git repository root is unavailable"); }
  if (top !== root || topPhysical !== root) provisioningError("PROVISIONING_UNTRUSTED", "cwd is not the selected repository root");
  const gitDir = oneLine(runGit(root, ["rev-parse", "--absolute-git-dir"]), "Git directory");
  if (gitDir !== path.join(root, ".git")) provisioningError("PROVISIONING_UNTRUSTED", "linked Git indirection is unsupported");
  const gitStat = fs.lstatSync(gitDir, { bigint: true });
  if (!gitStat.isDirectory() || gitStat.isSymbolicLink()) provisioningError("PROVISIONING_UNTRUSTED", "Git directory type is unsafe");
  for (const forbidden of [path.join(gitDir, "info", "grafts"), path.join(gitDir, "objects", "info", "alternates")]) {
    if (fs.existsSync(forbidden)) provisioningError("PROVISIONING_UNTRUSTED", "external Git object indirection is unsupported");
  }
  if (runGit(root, ["for-each-ref", "--format=%(refname)", "refs/replace"]).length !== 0) {
    provisioningError("PROVISIONING_UNTRUSTED", "Git replacement objects are unsupported");
  }
  if (runGit(root, ["config", "--local", "--get-regexp", "^remote\\..*\\.promisor$"], 64 * 1024, [0, 1]).length !== 0) {
    provisioningError("PROVISIONING_UNTRUSTED", "partial Git objects are unsupported");
  }
  const objectFormat = oneLine(runGit(root, ["rev-parse", "--show-object-format"]), "Git object format");
  const oidLength = objectFormat === "sha1" ? 40 : objectFormat === "sha256" ? 64 : 0;
  if (oidLength === 0) provisioningError("PROVISIONING_UNTRUSTED", "Git object format is unsupported");
  const headOid = oneLine(runGit(root, ["rev-parse", "--verify", "HEAD^{commit}"]), "HEAD");
  const treeOid = oneLine(runGit(root, ["rev-parse", "--verify", "HEAD^{tree}"]), "tree");
  const oid = new RegExp(`^[0-9a-f]{${oidLength}}$`);
  if (!oid.test(headOid) || !oid.test(treeOid)) provisioningError("PROVISIONING_UNTRUSTED", "Git object identity is invalid");
  return {
    root, rootDev: rootStat.dev, rootIno: rootStat.ino, rootMode: rootStat.mode,
    gitDir, gitDirDev: gitStat.dev, gitDirIno: gitStat.ino,
    oidLength, headOid, treeOid,
  };
}

function bindAncestors(root: string, relativePath: string): BoundDirectory[] {
  const output: BoundDirectory[] = [];
  let current = root;
  for (const component of relativePath.split("/").slice(0, -1)) {
    current = path.join(current, component);
    let stat: fs.BigIntStats;
    try { stat = fs.lstatSync(current, { bigint: true }); } catch { provisioningError("PROVISIONING_UNTRUSTED", "tracked file ancestor is unavailable"); }
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(current) !== current) {
      provisioningError("PROVISIONING_UNTRUSTED", "tracked file ancestor is redirected");
    }
    output.push({ absolutePath: current, dev: stat.dev, ino: stat.ino, mode: stat.mode });
  }
  return output;
}

function parseTreeEntry(bytes: Buffer, relativePath: string, oidLength: number): { mode: "100644" | "100755"; oid: string } {
  const text = bytes.toString("utf8");
  const match = /^(100644|100755) blob ([0-9a-f]+)\t([^\0]+)\0$/.exec(text);
  if (!match || match[3] !== relativePath || match[2].length !== oidLength) {
    provisioningError("PROVISIONING_UNTRUSTED", "tracked file is not an exact HEAD blob");
  }
  return { mode: match[1] as "100644" | "100755", oid: match[2] };
}

function parseIndexEntry(bytes: Buffer, relativePath: string, oidLength: number): { mode: string; oid: string } {
  const text = bytes.toString("utf8");
  const match = /^(100644|100755) ([0-9a-f]+) 0\t([^\0]+)\0$/.exec(text);
  if (!match || match[3] !== relativePath || match[2].length !== oidLength) {
    provisioningError("PROVISIONING_UNTRUSTED", "tracked file index binding is invalid");
  }
  return { mode: match[1], oid: match[2] };
}

function bindTrackedFile(git: GitContext, relativePath: string, maximumBytes: number): BoundFile {
  assertPortablePath(relativePath, "source");
  const tree = parseTreeEntry(runGit(git.root, ["ls-tree", "-z", "HEAD", "--", relativePath]), relativePath, git.oidLength);
  const index = parseIndexEntry(runGit(git.root, ["ls-files", "-s", "-z", "--", relativePath]), relativePath, git.oidLength);
  if (tree.mode !== index.mode || tree.oid !== index.oid) provisioningError("PROVISIONING_UNTRUSTED", "tracked file index differs from HEAD");
  const objectBytes = runGit(git.root, ["cat-file", "blob", tree.oid], maximumBytes);
  const absolutePath = path.join(git.root, ...relativePath.split("/"));
  const ancestors = bindAncestors(git.root, relativePath);
  let before: fs.BigIntStats;
  try { before = fs.lstatSync(absolutePath, { bigint: true }); } catch { provisioningError("PROVISIONING_UNTRUSTED", "tracked file is unavailable"); }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > BigInt(maximumBytes)) {
    provisioningError("PROVISIONING_UNTRUSTED", "tracked file type or size is unsafe");
  }
  const permission = Number(before.mode & 0o777n);
  if ((permission & 0o022) !== 0 || ((permission & 0o111) !== 0) !== (tree.mode === "100755")) {
    provisioningError("PROVISIONING_UNTRUSTED", "tracked file mode differs from HEAD");
  }
  let descriptor: number | undefined;
  let worktreeBytes: Buffer;
  try {
    descriptor = fs.openSync(absolutePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.ctimeNs !== before.ctimeNs || opened.mode !== before.mode || opened.nlink !== 1n) {
      provisioningError("PROVISIONING_UNTRUSTED", "tracked file changed before open");
    }
    worktreeBytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (
      after.dev !== opened.dev || after.ino !== opened.ino || after.ctimeNs !== opened.ctimeNs ||
      after.mtimeNs !== opened.mtimeNs || after.mode !== opened.mode || after.nlink !== opened.nlink ||
      after.size !== opened.size || BigInt(worktreeBytes.length) !== opened.size
    ) provisioningError("PROVISIONING_UNTRUSTED", "tracked file changed during read");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  if (!worktreeBytes.equals(objectBytes)) provisioningError("PROVISIONING_UNTRUSTED", "worktree bytes differ from HEAD");
  return {
    relativePath, mode: tree.mode, blobOid: tree.oid, bytes: worktreeBytes,
    sha256: sha256Bytes(worktreeBytes), dev: before.dev, ino: before.ino,
    ctimeNs: before.ctimeNs, mtimeNs: before.mtimeNs, fsMode: before.mode,
    nlink: before.nlink, size: before.size, ancestors,
  };
}

function assertGitUnchanged(prepared: PreparedProvision): void {
  const current = bindGitContext(prepared.git.root);
  if (
    current.headOid !== prepared.git.headOid || current.treeOid !== prepared.git.treeOid ||
    current.gitDir !== prepared.git.gitDir || current.rootDev !== prepared.git.rootDev ||
    current.rootIno !== prepared.git.rootIno || current.rootMode !== prepared.git.rootMode ||
    current.gitDirDev !== prepared.git.gitDirDev || current.gitDirIno !== prepared.git.gitDirIno
  ) {
    provisioningError("PROVISIONING_UNTRUSTED", "HEAD changed during provisioning");
  }
  for (const original of [prepared.seedFile, ...prepared.sourceFiles]) {
    const currentFile = bindTrackedFile(current, original.relativePath, Math.max(original.bytes.length, 1));
    if (
      currentFile.blobOid !== original.blobOid || currentFile.mode !== original.mode ||
      currentFile.dev !== original.dev || currentFile.ino !== original.ino ||
      currentFile.ctimeNs !== original.ctimeNs || currentFile.mtimeNs !== original.mtimeNs ||
      currentFile.fsMode !== original.fsMode || currentFile.nlink !== original.nlink ||
      currentFile.size !== original.size || !currentFile.bytes.equals(original.bytes) ||
      canonicalJson(currentFile.ancestors.map((item) => [item.absolutePath, item.dev.toString(), item.ino.toString(), item.mode.toString()])) !==
        canonicalJson(original.ancestors.map((item) => [item.absolutePath, item.dev.toString(), item.ino.toString(), item.mode.toString()]))
    ) provisioningError("PROVISIONING_UNTRUSTED", "tracked file identity changed during provisioning");
  }
}

function parseCanonicalSeed(file: BoundFile): Record<string, unknown> {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes); } catch { provisioningError("PROVISIONING_INVALID", "seed is not UTF-8"); }
  if (!text.endsWith("\n") || text.endsWith("\n\n") || text.includes("\r")) provisioningError("PROVISIONING_INVALID", "seed newline form is invalid");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { provisioningError("PROVISIONING_INVALID", "seed is not JSON"); }
  if (!isPlainObject(parsed) || !exactKeys(parsed, [
    "schema_version", "repository", "task_id", "primary_subject", "observations", "source_authorities", "seed_sha256",
  ])) provisioningError("PROVISIONING_INVALID", "seed schema is not closed");
  if (`${canonicalJson(parsed as CanonicalValue)}\n` !== text) provisioningError("PROVISIONING_INVALID", "seed JSON is not canonical");
  return parsed;
}

function prepareSeed(git: GitContext, seedPath: string): PreparedProvision {
  const seedFile = bindTrackedFile(git, seedPath, MAX_SEED_BYTES);
  const raw = parseCanonicalSeed(seedFile);
  if (
    raw.schema_version !== 1 || typeof raw.repository !== "string" || !REPOSITORY_ID_RE.test(raw.repository) ||
    typeof raw.task_id !== "string" || !TASK_ID_RE.test(raw.task_id) || typeof raw.primary_subject !== "string" ||
    typeof raw.seed_sha256 !== "string" || !SHA256_RE.test(raw.seed_sha256) || !Array.isArray(raw.observations)
  ) provisioningError("PROVISIONING_INVALID", "seed identity is invalid");
  if (raw.observations.length < 1 || raw.observations.length > LIMITS.observations) {
    provisioningError("PROVISIONING_INVALID", "seed observation count is invalid");
  }
  const payload = { ...raw };
  delete payload.seed_sha256;
  if (sha256Canonical(payload as CanonicalValue) !== raw.seed_sha256) provisioningError("PROVISIONING_INVALID", "seed hash is invalid");
  let sourceAuthorities: SourceAuthorityRegistry;
  let observations: Observation[];
  try {
    sourceAuthorities = createSourceAuthorityRegistry(raw.source_authorities) as SourceAuthorityRegistry;
    observations = raw.observations.map((item) => createObservation(item) as Observation);
  } catch {
    provisioningError("PROVISIONING_INVALID", "seed semantics are invalid");
  }
  const paths = Object.keys(sourceAuthorities).sort();
  const used = new Map<string, Set<string>>();
  for (const observation of observations) {
    if (observation.scope.repository !== raw.repository || observation.scope.work_order !== raw.primary_subject) {
      provisioningError("PROVISIONING_INVALID", "observation scope differs from seed identity");
    }
    const authorities = used.get(observation.source.path) ?? new Set<string>();
    authorities.add(observation.authority);
    used.set(observation.source.path, authorities);
  }
  if (!observations.some((item) => item.subject === raw.primary_subject) || canonicalJson([...used.keys()].sort()) !== canonicalJson(paths)) {
    provisioningError("PROVISIONING_INVALID", "seed subject or source set is incomplete");
  }
  for (const sourcePath of paths) {
    assertPortablePath(sourcePath, "source");
    if (canonicalJson([...used.get(sourcePath)!].sort()) !== canonicalJson([...sourceAuthorities[sourcePath].authorities])) {
      provisioningError("PROVISIONING_INVALID", "seed has unused source authority");
    }
  }
  const sorted = [...observations].sort((left, right) => left.observed_at.localeCompare(right.observed_at) || left.id.localeCompare(right.id));
  if (canonicalJson(observations as unknown as CanonicalValue) !== canonicalJson(sorted as unknown as CanonicalValue)) {
    provisioningError("PROVISIONING_INVALID", "seed observations are not in canonical store order");
  }
  const sourceFiles: BoundFile[] = [];
  let total = 0;
  for (const sourcePath of paths) {
    const bound = bindTrackedFile(git, sourcePath, MAX_SOURCE_BYTES);
    total += bound.bytes.length;
    if (total > MAX_TOTAL_SOURCE_BYTES || bound.sha256 !== sourceAuthorities[sourcePath].sha256) {
      provisioningError("PROVISIONING_UNTRUSTED", "source bytes do not match the seed registry");
    }
    sourceFiles.push(bound);
  }
  const authorityManifest = createAuthorityManifest(observations) as AuthorityManifest;
  const input: AnalysisInput = { schema_version: 1, rule_ids: [...REGISTERED_RULE_IDS], observations };
  try {
    createAnalysisAuthorityBundle({
      schema_version: 1, repository: raw.repository, task_id: raw.task_id,
      primary_subject: raw.primary_subject, authority_manifest: authorityManifest,
      source_authorities: sourceAuthorities,
    });
    // The store is the sole evaluator; this local shape only proves the accepted input contract.
    void input;
  } catch {
    provisioningError("PROVISIONING_INVALID", "seed authority is invalid");
  }
  return {
    git, seedPath, seedFile, sourceFiles,
    seed: {
      repository: raw.repository, taskId: raw.task_id, primarySubject: raw.primary_subject,
      seedSha256: raw.seed_sha256, observations, sourceAuthorities, authorityManifest,
    },
  };
}

function receiptPayload(prepared: PreparedProvision, trusted: TrustedAnalysisState): ProvisioningReceiptPayload {
  return {
    schema_version: 1,
    generator: GENERATOR,
    repository: prepared.seed.repository,
    task_id: prepared.seed.taskId,
    primary_subject: prepared.seed.primarySubject,
    head_oid: prepared.git.headOid,
    tree_oid: prepared.git.treeOid,
    seed_path: prepared.seedPath,
    seed_blob_oid: prepared.seedFile.blobOid,
    seed_sha256: prepared.seed.seedSha256,
    generation: trusted.persisted.manifest.generation,
    observation_count: trusted.persisted.manifest.observation_count,
    snapshot_sha256: trusted.persisted.manifest.snapshot_sha256,
    authority_bundle_sha256: trusted.authority.bundle_sha256,
    authority_manifest_sha256: trusted.authority.authority_manifest.manifest_sha256,
    source_authority_registry_sha256: trusted.persisted.manifest.source_authority_registry_sha256,
  };
}

function makeReceipt(payload: ProvisioningReceiptPayload): ProvisioningReceipt {
  return { ...payload, receipt_sha256: sha256Canonical(payload as unknown as CanonicalValue) };
}

function readPrivateJson(filePath: string, maximumBytes: number): Record<string, unknown> {
  let before: fs.BigIntStats;
  try { before = fs.lstatSync(filePath, { bigint: true }); } catch { provisioningError("PROVISIONING_UNTRUSTED", "private metadata is unavailable"); }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || (before.mode & 0o777n) !== BigInt(FILE_MODE) || before.size > BigInt(maximumBytes)) {
    provisioningError("PROVISIONING_UNTRUSTED", "private metadata type is unsafe");
  }
  const bytes = fs.readFileSync(filePath);
  const after = fs.lstatSync(filePath, { bigint: true });
  if (after.dev !== before.dev || after.ino !== before.ino || after.ctimeNs !== before.ctimeNs || after.mtimeNs !== before.mtimeNs || after.size !== before.size) {
    provisioningError("PROVISIONING_UNTRUSTED", "private metadata changed during read");
  }
  let raw: unknown;
  try { raw = JSON.parse(bytes.toString("utf8")); } catch { provisioningError("PROVISIONING_UNTRUSTED", "private metadata is invalid"); }
  if (!isPlainObject(raw) || `${canonicalJson(raw as CanonicalValue)}\n` !== bytes.toString("utf8")) {
    provisioningError("PROVISIONING_UNTRUSTED", "private metadata is not canonical");
  }
  return raw;
}

function validateReceiptObject(raw: Record<string, unknown>): ProvisioningReceipt {
  const keys = [
    "schema_version", "generator", "repository", "task_id", "primary_subject", "head_oid", "tree_oid",
    "seed_path", "seed_blob_oid", "seed_sha256", "generation", "observation_count", "snapshot_sha256",
    "authority_bundle_sha256", "authority_manifest_sha256", "source_authority_registry_sha256", "receipt_sha256",
  ];
  if (!exactKeys(raw, keys) || raw.schema_version !== 1 || raw.generator !== GENERATOR || typeof raw.receipt_sha256 !== "string" || !SHA256_RE.test(raw.receipt_sha256)) {
    provisioningError("PROVISIONING_UNTRUSTED", "provisioning receipt schema is invalid");
  }
  if (
    typeof raw.repository !== "string" || !REPOSITORY_ID_RE.test(raw.repository) ||
    typeof raw.task_id !== "string" || !TASK_ID_RE.test(raw.task_id) ||
    typeof raw.primary_subject !== "string" || !SUBJECT_RE.test(raw.primary_subject) ||
    typeof raw.head_oid !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(raw.head_oid) ||
    typeof raw.tree_oid !== "string" || raw.tree_oid.length !== raw.head_oid.length || !/^[0-9a-f]+$/.test(raw.tree_oid) ||
    typeof raw.seed_blob_oid !== "string" || raw.seed_blob_oid.length !== raw.head_oid.length || !/^[0-9a-f]+$/.test(raw.seed_blob_oid) ||
    typeof raw.seed_sha256 !== "string" || !SHA256_RE.test(raw.seed_sha256) || raw.generation !== 1 ||
    !Number.isSafeInteger(raw.observation_count) || (raw.observation_count as number) < 1 ||
    typeof raw.snapshot_sha256 !== "string" || !SHA256_RE.test(raw.snapshot_sha256) ||
    typeof raw.authority_bundle_sha256 !== "string" || !SHA256_RE.test(raw.authority_bundle_sha256) ||
    typeof raw.authority_manifest_sha256 !== "string" || !SHA256_RE.test(raw.authority_manifest_sha256) ||
    typeof raw.source_authority_registry_sha256 !== "string" || !SHA256_RE.test(raw.source_authority_registry_sha256)
  ) provisioningError("PROVISIONING_UNTRUSTED", "provisioning receipt binding is invalid");
  assertPortablePath(raw.seed_path, "seed");
  const payload = { ...raw };
  delete payload.receipt_sha256;
  if (sha256Canonical(payload as CanonicalValue) !== raw.receipt_sha256) provisioningError("PROVISIONING_UNTRUSTED", "provisioning receipt hash is invalid");
  return raw as ProvisioningReceipt;
}

function parseReceipt(filePath: string): ProvisioningReceipt {
  return validateReceiptObject(readPrivateJson(filePath, MAX_RECEIPT_BYTES));
}

function resultFor(receipt: ProvisioningReceipt, outcome: "created" | "already_provisioned"): TrackedAnalysisProvisioningResult {
  return {
    schema_version: 1, generator: GENERATOR, outcome,
    repository: receipt.repository, task_id: receipt.task_id, primary_subject: receipt.primary_subject,
    head_oid: receipt.head_oid, tree_oid: receipt.tree_oid, seed_blob_oid: receipt.seed_blob_oid,
    seed_sha256: receipt.seed_sha256, generation: receipt.generation,
    observation_count: receipt.observation_count, snapshot_sha256: receipt.snapshot_sha256,
    authority_bundle_sha256: receipt.authority_bundle_sha256,
    authority_manifest_sha256: receipt.authority_manifest_sha256,
    source_authority_registry_sha256: receipt.source_authority_registry_sha256,
  };
}

function expectedReceipt(prepared: PreparedProvision, trusted: TrustedAnalysisState): ProvisioningReceipt {
  return makeReceipt(receiptPayload(prepared, trusted));
}

function verifyExactTarget(root: string, prepared: PreparedProvision): TrackedAnalysisProvisioningResult {
  const agentsDirectory = path.join(root, ".agents");
  const taskDirectory = path.join(agentsDirectory, prepared.seed.taskId);
  assertPrivateDirectory(agentsDirectory);
  assertExactTaskInventory(taskDirectory);
  let trusted: TrustedAnalysisState;
  try { trusted = readTrustedAnalysisState({ cwd: root, taskId: prepared.seed.taskId }); } catch { provisioningError("PROVISIONING_CONFLICT", "existing task is not the exact trusted target"); }
  const receipt = parseReceipt(path.join(root, ".agents", prepared.seed.taskId, RECEIPT_FILE));
  const expectedAuthority = createAnalysisAuthorityBundle({
    schema_version: 1, repository: prepared.seed.repository, task_id: prepared.seed.taskId,
    primary_subject: prepared.seed.primarySubject, authority_manifest: prepared.seed.authorityManifest,
    source_authorities: prepared.seed.sourceAuthorities,
  });
  const expected = expectedReceipt(prepared, trusted);
  if (
    canonicalJson(receipt as unknown as CanonicalValue) !== canonicalJson(expected as unknown as CanonicalValue) ||
    canonicalJson(trusted.persisted.observations as unknown as CanonicalValue) !== canonicalJson(prepared.seed.observations as unknown as CanonicalValue) ||
    canonicalJson(trusted.authority as unknown as CanonicalValue) !== canonicalJson(expectedAuthority as unknown as CanonicalValue) ||
    trusted.persisted.manifest.generation !== 1
  ) provisioningError("PROVISIONING_CONFLICT", "existing task does not match the tracked seed");
  assertGitUnchanged(prepared);
  return resultFor(receipt, "already_provisioned");
}

function ownerFor(prepared: PreparedProvision, token: string, intended: ProvisioningReceipt | null): OwnerRecord {
  const root = fs.lstatSync(prepared.git.root, { bigint: true });
  return {
    schema_version: 1, generator: GENERATOR, pid: process.pid,
    process_started_ms: Math.max(0, Math.floor(Date.now() - process.uptime() * 1000)), token,
    project_root_dev: root.dev.toString(10), project_root_ino: root.ino.toString(10),
    repository: prepared.seed.repository, task_id: prepared.seed.taskId,
    head_oid: prepared.git.headOid, tree_oid: prepared.git.treeOid, seed_path: prepared.seedPath,
    seed_blob_oid: prepared.seedFile.blobOid, seed_sha256: prepared.seed.seedSha256, intended,
  };
}

function parseOwner(stageRoot: string): OwnerRecord {
  const raw = readPrivateJson(path.join(stageRoot, OWNER_FILE), MAX_OWNER_BYTES);
  const keys = [
    "schema_version", "generator", "pid", "process_started_ms", "token", "project_root_dev", "project_root_ino",
    "repository", "task_id", "head_oid", "tree_oid", "seed_path", "seed_blob_oid", "seed_sha256", "intended",
  ];
  if (
    !exactKeys(raw, keys) || raw.schema_version !== 1 || raw.generator !== GENERATOR ||
    !Number.isSafeInteger(raw.pid) || (raw.pid as number) < 1 || !Number.isSafeInteger(raw.process_started_ms) ||
    (raw.process_started_ms as number) < 0 || typeof raw.token !== "string" || !TOKEN_RE.test(raw.token) ||
    typeof raw.project_root_dev !== "string" || !/^\d+$/.test(raw.project_root_dev) ||
    typeof raw.project_root_ino !== "string" || !/^\d+$/.test(raw.project_root_ino) ||
    typeof raw.repository !== "string" || !REPOSITORY_ID_RE.test(raw.repository) ||
    typeof raw.task_id !== "string" || !TASK_ID_RE.test(raw.task_id) ||
    typeof raw.head_oid !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(raw.head_oid) ||
    typeof raw.tree_oid !== "string" || raw.tree_oid.length !== raw.head_oid.length || !/^[0-9a-f]+$/.test(raw.tree_oid) ||
    typeof raw.seed_blob_oid !== "string" || raw.seed_blob_oid.length !== raw.head_oid.length || !/^[0-9a-f]+$/.test(raw.seed_blob_oid) ||
    typeof raw.seed_sha256 !== "string" || !SHA256_RE.test(raw.seed_sha256)
  ) provisioningError("PROVISIONING_UNTRUSTED", "staging owner is invalid");
  assertPortablePath(raw.seed_path, "seed");
  if (raw.intended !== null) {
    if (!isPlainObject(raw.intended)) provisioningError("PROVISIONING_UNTRUSTED", "staging intent is invalid");
    const intended = validateReceiptObject(raw.intended);
    if (
      intended.repository !== raw.repository || intended.task_id !== raw.task_id ||
      intended.head_oid !== raw.head_oid || intended.tree_oid !== raw.tree_oid ||
      intended.seed_path !== raw.seed_path || intended.seed_blob_oid !== raw.seed_blob_oid ||
      intended.seed_sha256 !== raw.seed_sha256
    ) provisioningError("PROVISIONING_UNTRUSTED", "staging intent binding is invalid");
  }
  return raw as OwnerRecord;
}

function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM") return true;
    if (code === "ESRCH") return false;
    provisioningError("PROVISIONING_UNTRUSTED", "staging owner status is unavailable");
  }
}

function validateStageInventory(stageRoot: string, taskId: string, token: string): string[] {
  const stageStat = fs.lstatSync(stageRoot);
  if (!stageStat.isDirectory() || stageStat.isSymbolicLink() || (stageStat.mode & 0o777) !== DIRECTORY_MODE) {
    provisioningError("PROVISIONING_UNTRUSTED", "staging root type is unsafe");
  }
  const owner = parseOwner(stageRoot);
  const projectRoot = path.dirname(stageRoot);
  const rootStat = fs.lstatSync(projectRoot, { bigint: true });
  if (
    owner.task_id !== taskId || owner.token !== token ||
    owner.project_root_dev !== rootStat.dev.toString(10) || owner.project_root_ino !== rootStat.ino.toString(10) ||
    path.basename(stageRoot) !== `${STAGE_PREFIX}${taskId}`
  ) provisioningError("PROVISIONING_UNTRUSTED", "staging ownership changed");
  const allowedDirectories = new Set([
    ".agents", `.agents/${taskId}`, `.agents/${taskId}/${ANALYSIS_DIRECTORY_NAME}`, `.agents/${taskId}/.analysis.lock`,
  ]);
  const allowedFiles = new Set([
    OWNER_FILE, `.agents/${taskId}/${ANALYSIS_AUTHORITY_FILE}`, `.agents/${taskId}/${RECEIPT_FILE}`,
    ...ANALYSIS_STORE_FILES.map((name) => `.agents/${taskId}/${ANALYSIS_DIRECTORY_NAME}/${name}`),
    `.agents/${taskId}/.analysis.lock/owner.json`,
  ]);
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const name of fs.readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const relative = path.relative(stageRoot, absolute).split(path.sep).join("/");
      const stat = fs.lstatSync(absolute);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        if (!allowedDirectories.has(relative) || (stat.mode & 0o777) !== DIRECTORY_MODE) provisioningError("PROVISIONING_UNTRUSTED", "staging directory inventory is unsafe");
        walk(absolute);
      } else if (stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= MAX_STAGE_FILE_BYTES) {
        const withoutTemp = relative.replace(/\.tmp-\d+-[0-9a-f]{12}$/, "");
        if ((!allowedFiles.has(relative) && !allowedFiles.has(withoutTemp)) || (stat.mode & 0o777) !== FILE_MODE) {
          provisioningError("PROVISIONING_UNTRUSTED", "staging file inventory is unsafe");
        }
        const maximum = withoutTemp.endsWith(`/${ANALYSIS_AUTHORITY_FILE}`)
          ? ANALYSIS_AUTHORITY_MAX_BYTES
          : withoutTemp.endsWith(`/${RECEIPT_FILE}`)
            ? MAX_RECEIPT_BYTES
            : withoutTemp === OWNER_FILE || withoutTemp.endsWith("/.analysis.lock/owner.json")
              ? MAX_OWNER_BYTES
              : MAX_STAGE_FILE_BYTES;
        if (stat.size > maximum) provisioningError("PROVISIONING_UNTRUSTED", "staging file size is unsafe");
        files.push(absolute);
      } else provisioningError("PROVISIONING_UNTRUSTED", "staging entry type is unsafe");
    }
  };
  walk(stageRoot);
  const receiptPath = path.join(stageRoot, ".agents", taskId, RECEIPT_FILE);
  if (owner.intended !== null && fs.existsSync(receiptPath)) {
    const receipt = parseReceipt(receiptPath);
    if (canonicalJson(receipt as unknown as CanonicalValue) !== canonicalJson(owner.intended as unknown as CanonicalValue)) {
      provisioningError("PROVISIONING_UNTRUSTED", "staging intent changed");
    }
  }
  return files;
}

function removeOwnedStage(stageRoot: string, taskId: string, token: string): void {
  const files = validateStageInventory(stageRoot, taskId, token);
  for (const file of files.sort((left, right) => right.length - left.length)) fs.unlinkSync(file);
  const directories = [
    path.join(stageRoot, ".agents", taskId, ".analysis.lock"),
    path.join(stageRoot, ".agents", taskId, ANALYSIS_DIRECTORY_NAME),
    path.join(stageRoot, ".agents", taskId), path.join(stageRoot, ".agents"), stageRoot,
  ];
  for (const directory of directories) {
    try { fs.rmdirSync(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  fsyncDirectory(path.dirname(stageRoot));
}

function acquireStage(prepared: PreparedProvision): { stageRoot: string; token: string } {
  const stageRoot = path.join(prepared.git.root, `${STAGE_PREFIX}${prepared.seed.taskId}`);
  const signal = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      fs.mkdirSync(stageRoot, { mode: DIRECTORY_MODE });
      const token = crypto.randomBytes(16).toString("hex");
      try {
        atomicWriteText(path.join(stageRoot, OWNER_FILE), `${canonicalJson(ownerFor(prepared, token, null) as unknown as CanonicalValue)}\n`, stageRoot);
        return { stageRoot, token };
      } catch (error) {
        try { fs.rmdirSync(stageRoot); } catch { /* fail closed through the original fixed error */ }
        throw error;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let owner: OwnerRecord;
      try { owner = parseOwner(stageRoot); } catch {
        Atomics.wait(signal, 0, 0, 10);
        continue;
      }
      if (processIsAlive(owner.pid)) {
        Atomics.wait(signal, 0, 0, 10);
        continue;
      }
      removeOwnedStage(stageRoot, owner.task_id, owner.token);
    }
  }
  provisioningError("PROVISIONING_CONFLICT", "another provisioner still owns the task stage");
}

function assertPrivateDirectory(directory: string): void {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== DIRECTORY_MODE) {
    provisioningError("PROVISIONING_UNTRUSTED", "managed directory is not private");
  }
}

function assertExactTaskInventory(taskDirectory: string): void {
  assertPrivateDirectory(taskDirectory);
  const entries = fs.readdirSync(taskDirectory).sort();
  if (canonicalJson(entries) !== canonicalJson([ANALYSIS_DIRECTORY_NAME, ANALYSIS_AUTHORITY_FILE, RECEIPT_FILE].sort())) {
    provisioningError("PROVISIONING_CONFLICT", "task inventory is not exact");
  }
  assertPrivateDirectory(path.join(taskDirectory, ANALYSIS_DIRECTORY_NAME));
  for (const name of [ANALYSIS_AUTHORITY_FILE, RECEIPT_FILE]) {
    const stat = fs.lstatSync(path.join(taskDirectory, name));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o777) !== FILE_MODE) {
      provisioningError("PROVISIONING_UNTRUSTED", "task metadata is not private");
    }
  }
}

function publishTaskDirectoryNoReplace(stageTask: string, targetAgents: string, targetTask: string): boolean {
  const source = fs.lstatSync(stageTask, { bigint: true });
  if (!source.isDirectory() || source.isSymbolicLink()) {
    provisioningError("PROVISIONING_UNTRUSTED", "candidate task directory changed");
  }
  const result = spawnSync("/bin/mv", ["-n", stageTask, targetAgents], {
    encoding: null,
    maxBuffer: 64 * 1024,
    timeout: 15_000,
    stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
  });
  if (result.error || result.signal || result.status !== 0 || (result.stdout?.length ?? 0) > 64 * 1024 || (result.stderr?.length ?? 0) > 64 * 1024) {
    provisioningError("PROVISIONING_UNTRUSTED", "atomic task publication failed safely");
  }
  if (fs.existsSync(stageTask)) return false;
  let target: fs.BigIntStats;
  try { target = fs.lstatSync(targetTask, { bigint: true }); } catch { provisioningError("PROVISIONING_UNTRUSTED", "published task is unavailable"); }
  if (
    !target.isDirectory() || target.isSymbolicLink() ||
    target.dev !== source.dev || target.ino !== source.ino || target.mode !== source.mode
  ) provisioningError("PROVISIONING_UNTRUSTED", "published task identity changed");
  return true;
}

function provisionNew(
  prepared: PreparedProvision,
  options: TrackedAnalysisProvisioningOptions,
): TrackedAnalysisProvisioningResult {
  const { stageRoot, token } = acquireStage(prepared);
  const stageTask = path.join(stageRoot, ".agents", prepared.seed.taskId);
  const targetAgents = path.join(prepared.git.root, ".agents");
  const targetTask = path.join(targetAgents, prepared.seed.taskId);
  let renamed = false;
  try {
    options.hooks?.afterStageOwner?.();
    if (fs.existsSync(targetTask)) {
      removeOwnedStage(stageRoot, prepared.seed.taskId, token);
      return verifyExactTarget(prepared.git.root, prepared);
    }
    maybeFail(options.hooks, "owner");
    const authority = createAnalysisAuthorityBundle({
      schema_version: 1, repository: prepared.seed.repository, task_id: prepared.seed.taskId,
      primary_subject: prepared.seed.primarySubject, authority_manifest: prepared.seed.authorityManifest,
      source_authorities: prepared.seed.sourceAuthorities,
    });
    const failAfter = options.hooks?.failAfter;
    publishAnalysisState({
      cwd: stageRoot, taskId: prepared.seed.taskId, repository: prepared.seed.repository,
      input: { schema_version: 1, rule_ids: [...REGISTERED_RULE_IDS], observations: prepared.seed.observations },
      authorityManifest: prepared.seed.authorityManifest, sourceAuthorities: prepared.seed.sourceAuthorities,
      expectedGeneration: 0,
      failAfter: failAfter === "observations" || failAfter === "snapshot" || failAfter === "changes" ? failAfter : undefined,
    });
    maybeFail(options.hooks, "store");
    atomicWriteText(path.join(stageTask, ANALYSIS_AUTHORITY_FILE), renderAnalysisAuthorityBundle(authority), stageRoot);
    maybeFail(options.hooks, "authority");
    const candidate = readTrustedAnalysisState({ cwd: stageRoot, taskId: prepared.seed.taskId });
    const receipt = expectedReceipt(prepared, candidate);
    atomicWriteText(path.join(stageTask, RECEIPT_FILE), `${canonicalJson(receipt as unknown as CanonicalValue)}\n`, stageRoot);
    maybeFail(options.hooks, "receipt");
    atomicWriteText(path.join(stageRoot, OWNER_FILE), `${canonicalJson(ownerFor(prepared, token, receipt) as unknown as CanonicalValue)}\n`, stageRoot);
    for (const directory of [path.join(stageTask, ANALYSIS_DIRECTORY_NAME), stageTask, path.join(stageRoot, ".agents"), stageRoot]) fsyncDirectory(directory);
    maybeFail(options.hooks, "candidate_fsync");
    const validated = readTrustedAnalysisState({ cwd: stageRoot, taskId: prepared.seed.taskId });
    const validatedReceipt = parseReceipt(path.join(stageTask, RECEIPT_FILE));
    assertExactTaskInventory(stageTask);
    if (canonicalJson(validatedReceipt as unknown as CanonicalValue) !== canonicalJson(expectedReceipt(prepared, validated) as unknown as CanonicalValue)) {
      provisioningError("PROVISIONING_UNTRUSTED", "candidate receipt changed");
    }
    maybeFail(options.hooks, "validation");
    assertGitUnchanged(prepared);
    ensureSecureManagedDirectory(prepared.git.root, targetAgents);
    assertPrivateDirectory(targetAgents);
    const agentsIdentity = fs.lstatSync(targetAgents, { bigint: true });
    if (fs.existsSync(targetTask)) {
      removeOwnedStage(stageRoot, prepared.seed.taskId, token);
      return verifyExactTarget(prepared.git.root, prepared);
    }
    maybeFail(options.hooks, "before_rename");
    options.hooks?.beforeRename?.();
    if (!publishTaskDirectoryNoReplace(stageTask, targetAgents, targetTask)) {
      removeOwnedStage(stageRoot, prepared.seed.taskId, token);
      return verifyExactTarget(prepared.git.root, prepared);
    }
    renamed = true;
    fsyncDirectory(targetAgents);
    const currentAgentsIdentity = fs.lstatSync(targetAgents, { bigint: true });
    if (
      currentAgentsIdentity.dev !== agentsIdentity.dev || currentAgentsIdentity.ino !== agentsIdentity.ino ||
      currentAgentsIdentity.mode !== agentsIdentity.mode
    ) provisioningError("PROVISIONING_UNTRUSTED", "managed root changed during publication");
    assertExactTaskInventory(targetTask);
    const published = readTrustedAnalysisState({ cwd: prepared.git.root, taskId: prepared.seed.taskId });
    const publishedReceipt = parseReceipt(path.join(targetTask, RECEIPT_FILE));
    if (canonicalJson(publishedReceipt as unknown as CanonicalValue) !== canonicalJson(expectedReceipt(prepared, published) as unknown as CanonicalValue)) {
      provisioningError("PROVISIONING_UNTRUSTED", "published receipt changed");
    }
    assertGitUnchanged(prepared);
    maybeFail(options.hooks, "after_rename");
    removeOwnedStage(stageRoot, prepared.seed.taskId, token);
    maybeFail(options.hooks, "cleanup");
    return resultFor(publishedReceipt, "created");
  } catch (error) {
    if (fs.existsSync(stageRoot)) {
      try { removeOwnedStage(stageRoot, prepared.seed.taskId, token); } catch { provisioningError("PROVISIONING_UNTRUSTED", "owned staging cleanup failed safely"); }
    }
    if (error instanceof AnalysisProvisioningError) throw error;
    if (renamed) provisioningError("PROVISIONING_UNTRUSTED", "publication completed but final verification failed");
    provisioningError("PROVISIONING_UNTRUSTED", "provisioning failed safely");
  }
}

export function provisionTrackedAnalysisState(options: TrackedAnalysisProvisioningOptions): TrackedAnalysisProvisioningResult {
  try {
    validateOptions(options);
    const git = bindGitContext(options.cwd);
    const prepared = prepareSeed(git, options.seedPath);
    options.hooks?.afterGitBinding?.();
    assertGitUnchanged(prepared);
    const targetTask = path.join(git.root, ".agents", prepared.seed.taskId);
    if (fs.existsSync(targetTask)) return verifyExactTarget(git.root, prepared);
    const result = provisionNew(prepared, options);
    return result;
  } catch (error) {
    if (error instanceof AnalysisProvisioningError) throw error;
    provisioningError("PROVISIONING_UNTRUSTED", "provisioning failed safely");
  }
}

export const ANALYSIS_PROVISIONING_RECEIPT_FILE = RECEIPT_FILE;
export const ANALYSIS_PROVISIONING_GENERATOR = GENERATOR;
