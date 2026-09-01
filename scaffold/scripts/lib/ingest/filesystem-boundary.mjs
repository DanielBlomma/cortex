import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const PRIOR_CACHE_IDENTITIES = Object.freeze([
  ".context/cache/manifest.json",
  ".context/cache/dialect-observations.v1.jsonl",
  ".context/cache/entities.file.jsonl",
  ".context/cache/entities.adr.jsonl",
  ".context/cache/entities.chunk.jsonl",
  ".context/cache/relations.defines.jsonl",
  ".context/cache/relations.calls.jsonl",
  ".context/cache/relations.imports.jsonl",
  ".context/cache/relations.calls_sql.jsonl"
]);

export const INGEST_JSONL_OUTPUT_IDENTITIES = Object.freeze([
  ".context/cache/dialect-observations.v1.jsonl",
  ".context/cache/documents.jsonl",
  ".context/cache/entities.file.jsonl",
  ".context/cache/entities.adr.jsonl",
  ".context/cache/entities.rule.jsonl",
  ".context/cache/entities.chunk.jsonl",
  ".context/cache/entities.module.jsonl",
  ".context/cache/entities.project.jsonl",
  ".context/cache/relations.supersedes.jsonl",
  ".context/cache/relations.constrains.jsonl",
  ".context/cache/relations.implements.jsonl",
  ".context/cache/relations.defines.jsonl",
  ".context/cache/relations.calls.jsonl",
  ".context/cache/relations.imports.jsonl",
  ".context/cache/relations.calls_sql.jsonl",
  ".context/cache/relations.uses_config_key.jsonl",
  ".context/cache/relations.uses_resource_key.jsonl",
  ".context/cache/relations.uses_setting_key.jsonl",
  ".context/cache/relations.contains.jsonl",
  ".context/cache/relations.contains_module.jsonl",
  ".context/cache/relations.exports.jsonl",
  ".context/cache/relations.includes_file.jsonl",
  ".context/cache/relations.uses_resource.jsonl",
  ".context/cache/relations.uses_setting.jsonl",
  ".context/cache/relations.uses_config.jsonl",
  ".context/cache/relations.transforms_config.jsonl",
  ".context/cache/relations.references_project.jsonl"
]);

export const INGEST_TSV_OUTPUT_IDENTITIES = Object.freeze([
  ".context/db/import/file_nodes.tsv",
  ".context/db/import/rule_nodes.tsv",
  ".context/db/import/adr_nodes.tsv",
  ".context/db/import/chunk_nodes.tsv",
  ".context/db/import/project_nodes.tsv",
  ".context/db/import/constrains_rel.tsv",
  ".context/db/import/implements_rel.tsv",
  ".context/db/import/supersedes_rel.tsv",
  ".context/db/import/defines_rel.tsv",
  ".context/db/import/calls_rel.tsv",
  ".context/db/import/imports_rel.tsv",
  ".context/db/import/calls_sql_rel.tsv",
  ".context/db/import/uses_config_key_rel.tsv",
  ".context/db/import/uses_resource_key_rel.tsv",
  ".context/db/import/uses_setting_key_rel.tsv",
  ".context/db/import/includes_file_rel.tsv",
  ".context/db/import/references_project_rel.tsv",
  ".context/db/import/uses_resource_rel.tsv",
  ".context/db/import/uses_setting_rel.tsv",
  ".context/db/import/uses_config_rel.tsv",
  ".context/db/import/transforms_config_rel.tsv"
]);

export const INGEST_MANIFEST_OUTPUT_IDENTITY = ".context/cache/manifest.json";
export const DIALECT_OBSERVATION_OUTPUT_IDENTITY = ".context/cache/dialect-observations.v1.jsonl";
export const INGEST_OUTPUT_IDENTITIES = Object.freeze([
  ...INGEST_JSONL_OUTPUT_IDENTITIES,
  ...INGEST_TSV_OUTPUT_IDENTITIES,
  INGEST_MANIFEST_OUTPUT_IDENTITY
]);

export const DASHBOARD_DATA_IDENTITIES = Object.freeze([
  ".context/cache",
  ".context/embeddings",
  ".context/cache/manifest.json",
  ".context/cache/graph-manifest.json",
  ".context/embeddings/manifest.json",
  ".context/cache/relations.constrains.jsonl",
  ".context/cache/relations.implements.jsonl",
  ".context/cache/relations.supersedes.jsonl",
  ".context/cache/relations.defines.jsonl",
  ".context/cache/relations.calls.jsonl",
  ".context/cache/relations.imports.jsonl",
  ".context/cache/npm-cache"
]);

const INGEST_OUTPUT_IDENTITY_SET = new Set(INGEST_OUTPUT_IDENTITIES);
const PRIOR_CACHE_IDENTITY_SET = new Set(PRIOR_CACHE_IDENTITIES);
const DASHBOARD_FILE_IDENTITY_SET = new Set(DASHBOARD_DATA_IDENTITIES.slice(2, -1));
const DASHBOARD_DIRECTORY_IDENTITY_SET = new Set([
  ".context/cache",
  ".context/embeddings",
  ".context/cache/npm-cache"
]);

const POLICY_CODES = new Set([
  "CORTEX_FS_PROJECT",
  "CORTEX_FS_CONTROL",
  "CORTEX_FS_SOURCE",
  "CORTEX_FS_CACHE",
  "CORTEX_FS_DASHBOARD",
  "CORTEX_FS_OUTPUT"
]);
const POLICY_PHASES = new Set([
  "project",
  "control",
  "discovery",
  "direct_read",
  "worker_read",
  "secondary_read",
  "dashboard_data",
  "output_preflight",
  "output_commit"
]);
const POLICY_SUBJECT_KINDS = new Set([
  "project",
  "control",
  "configured_source",
  "repository_path",
  "cache_path",
  "dashboard_path",
  "output_path"
]);
const POLICY_REASONS = new Set([
  "missing",
  "not_directory",
  "not_regular_file",
  "invalid_syntax",
  "outside_project",
  "symlink_component",
  "path_replaced",
  "special_file",
  "worker_protocol"
]);

const MAX_DIAGNOSTIC_SCALARS = 256;
const PROJECT_DETAILS = Object.freeze({
  code: "CORTEX_FS_PROJECT",
  phase: "project",
  subject_kind: "project",
  subject: "<project-root>",
  reason: "path_replaced"
});

function truncateScalars(value, limit = 256) {
  const scalars = [...String(value)];
  if (scalars.length <= limit) return scalars.join("");
  return `${scalars.slice(0, Math.max(0, limit - 1)).join("")}…`;
}

function normalizeSubject(subjectKind, subject) {
  if (subjectKind === "project") return "<project-root>";
  return truncateScalars(subject, MAX_DIAGNOSTIC_SCALARS);
}

export class CortexFilesystemPolicyError extends Error {
  constructor({ code, phase, subject_kind: subjectKind, subject, reason }) {
    const normalizedSubject = normalizeSubject(subjectKind, subject);
    super(`filesystem policy denied: ${code} ${phase} ${subjectKind} ${reason}`);
    this.name = "CortexFilesystemPolicyError";
    this.code = code;
    this.phase = phase;
    this.subject_kind = subjectKind;
    this.subject = normalizedSubject;
    this.reason = reason;
  }
}

export function isFilesystemPolicyError(error) {
  return error instanceof CortexFilesystemPolicyError;
}

export function renderFilesystemPolicyError(error) {
  const prefix = `cortex: filesystem policy denied [${error.code}] ${error.phase} ${error.subject_kind}=`;
  const suffix = ` reason=${error.reason}`;
  const available = MAX_DIAGNOSTIC_SCALARS - [...prefix].length - [...suffix].length;
  const subjectScalars = [...String(error.subject)];
  let encodedSubject = JSON.stringify(error.subject);
  if ([...encodedSubject].length > available) {
    let low = 0;
    let high = subjectScalars.length;
    while (low < high) {
      const midpoint = Math.ceil((low + high) / 2);
      const candidate = JSON.stringify(`${subjectScalars.slice(0, midpoint).join("")}…`);
      if ([...candidate].length <= available) low = midpoint;
      else high = midpoint - 1;
    }
    encodedSubject = JSON.stringify(`${subjectScalars.slice(0, low).join("")}…`);
  }
  return `${prefix}${encodedSubject}${suffix}`;
}

export function createDashboardPolicyHandler({
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  restoreOutput = ""
} = {}) {
  const timers = new Set();
  const listeners = [];
  let cursorHidden = false;
  let rawMode = false;
  let finished = false;
  let fatal = false;

  function teardown({ exitCode, newline }) {
    for (const timer of timers) clearInterval(timer);
    timers.clear();
    for (const { emitter, event, listener } of listeners) {
      emitter.off(event, listener);
    }
    listeners.length = 0;
    if (rawMode && stdin?.isTTY && typeof stdin.setRawMode === "function") {
      try {
        stdin.setRawMode(false);
      } catch {
        // Best-effort terminal restoration only.
      }
    }
    if (typeof stdin?.pause === "function") stdin.pause();
    if (cursorHidden && restoreOutput) {
      stdout.write(`${restoreOutput}${newline ? "\n" : ""}`);
    }
    process.exitCode = exitCode;
  }

  function fail(error) {
    if (!isFilesystemPolicyError(error)) throw error;
    if (finished) return;
    finished = true;
    fatal = true;
    teardown({ exitCode: 1, newline: false });
    stderr.write(`${renderFilesystemPolicyError(error)}\n`);
  }

  return {
    addListener(emitter, event, listener) {
      emitter.on(event, listener);
      listeners.push({ emitter, event, listener });
    },
    addTimer(timer) {
      timers.add(timer);
    },
    cleanup() {
      if (finished) return;
      finished = true;
      teardown({ exitCode: 0, newline: true });
    },
    get failed() {
      return fatal;
    },
    guard(action) {
      if (finished) return undefined;
      try {
        return action();
      } catch (error) {
        fail(error);
        return undefined;
      }
    },
    markCursorHidden() {
      cursorHidden = true;
    },
    markRawMode() {
      rawMode = true;
    }
  };
}

export function policyErrorEnvelope(error) {
  return {
    type: "policy_error",
    error: {
      code: error.code,
      phase: error.phase,
      subject_kind: error.subject_kind,
      subject: error.subject,
      reason: error.reason
    }
  };
}

function policyError(details) {
  throw new CortexFilesystemPolicyError(details);
}

function filesystemErrorReason(error, {
  missingReason = "missing",
  notDirectoryReason = "not_directory",
  defaultReason = "path_replaced"
} = {}) {
  if (error?.code === "ENOENT") return missingReason;
  if (error?.code === "ENOTDIR") return notDirectoryReason;
  if (error?.code === "ELOOP") return "symlink_component";
  if (error?.code === "ENAMETOOLONG" || error?.code === "EINVAL") return "invalid_syntax";
  if (error?.code === "EISDIR") return "not_regular_file";
  return defaultReason;
}

function denyFilesystemError(error, details, options) {
  if (isFilesystemPolicyError(error)) throw error;
  policyError({
    ...details,
    reason: filesystemErrorReason(error, options)
  });
}

function rootIdentity(stats) {
  return {
    dev: String(stats.dev),
    ino: String(stats.ino)
  };
}

function isSerializedProjectAnchor(anchor) {
  return Boolean(
    anchor &&
    typeof anchor === "object" &&
    !Array.isArray(anchor) &&
    Object.keys(anchor).length === 4 &&
    anchor.version === 1 &&
    typeof anchor.root === "string" &&
    path.isAbsolute(anchor.root) &&
    typeof anchor.dev === "string" &&
    /^\d+$/.test(anchor.dev) &&
    typeof anchor.ino === "string" &&
    /^\d+$/.test(anchor.ino)
  );
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function toSerializedPath(value) {
  return value.split(path.sep).join("/");
}

function safeRepositorySubject(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || path.isAbsolute(value)) {
    return "<repository-path>";
  }
  const parts = value.split(/[\\/]/);
  if (parts.includes("..") || (process.platform === "win32" && /^[A-Za-z]:/.test(value))) {
    return "<repository-path>";
  }
  return toSerializedPath(path.normalize(value));
}

function typeReason(stats, expected) {
  if (stats.isSymbolicLink()) return "symlink_component";
  if (expected === "directory" && !stats.isDirectory()) {
    return stats.isFile() ? "not_directory" : "special_file";
  }
  if (expected === "file" && !stats.isFile()) {
    return stats.isDirectory() ? "not_regular_file" : "special_file";
  }
  if (expected === "any" && !stats.isFile() && !stats.isDirectory()) return "special_file";
  return null;
}

function pathDetails(code, phase, subjectKind, subject, reason) {
  return { code, phase, subject_kind: subjectKind, subject, reason };
}

function parseConfiguredSourceValue(original) {
  if (typeof original !== "string" || original.trim().length === 0 || original.includes("\0")) {
    return null;
  }
  if (original.startsWith("/") || original.includes("\\")) {
    return null;
  }
  const parts = original.split("/");
  if (parts.includes("..")) return null;
  const normalizedParts = parts.filter((part) => part !== "" && part !== ".");
  const normalized = normalizedParts.join("/");
  if (normalized === "" && !parts.every((part) => part === "" || part === ".")) return null;
  if (/^[A-Za-z]:/.test(normalized)) return null;
  return normalized;
}

export function normalizeConfiguredSource(original) {
  const normalized = parseConfiguredSourceValue(original);
  if (normalized === null) {
    policyError(pathDetails(
      "CORTEX_FS_SOURCE",
      "discovery",
      "configured_source",
      typeof original === "string" ? original : String(original ?? ""),
      "invalid_syntax"
    ));
  }
  return normalized;
}

export function workerPolicyErrorFromMessage(message, expectedSubject) {
  const payload = message?.error;
  const normalizedExpectedSubject = truncateScalars(expectedSubject);
  const valid =
    message?.type === "policy_error" &&
    payload &&
    typeof payload === "object" &&
    Object.keys(message).length === 2 &&
    Object.keys(payload).length === 5 &&
    POLICY_CODES.has(payload.code) &&
    POLICY_PHASES.has(payload.phase) &&
    POLICY_SUBJECT_KINDS.has(payload.subject_kind) &&
    typeof payload.subject === "string" &&
    POLICY_REASONS.has(payload.reason) &&
    payload.code === "CORTEX_FS_SOURCE" &&
    payload.phase === "worker_read" &&
    payload.subject_kind === "repository_path" &&
    payload.subject === normalizedExpectedSubject &&
    payload.reason !== "worker_protocol";

  if (!valid) {
    return new CortexFilesystemPolicyError(pathDetails(
      "CORTEX_FS_SOURCE",
      "worker_read",
      "repository_path",
      normalizedExpectedSubject,
      "worker_protocol"
    ));
  }
  return new CortexFilesystemPolicyError(payload);
}

export function createWorkerProtocolError(subject, reason = "worker_protocol") {
  return new CortexFilesystemPolicyError(pathDetails(
    "CORTEX_FS_SOURCE",
    "worker_read",
    "repository_path",
    safeRepositorySubject(subject),
    reason
  ));
}

function createBoundaryFromEstablishedAnchor(projectAnchor, initialDetails = PROJECT_DETAILS) {
  const root = projectAnchor.root;

  function assertProjectAnchor(details = PROJECT_DETAILS) {
    let stats;
    try {
      stats = fs.lstatSync(root, { bigint: true });
    } catch (error) {
      denyFilesystemError(error, details, {
        missingReason: "path_replaced",
        notDirectoryReason: "path_replaced",
        defaultReason: "path_replaced"
      });
    }
    if (stats.isSymbolicLink()) {
      policyError({ ...details, reason: "symlink_component" });
    }
    if (!stats.isDirectory()) {
      policyError({ ...details, reason: "path_replaced" });
    }
    const identity = rootIdentity(stats);
    if (identity.dev !== projectAnchor.dev || identity.ino !== projectAnchor.ino) {
      policyError({ ...details, reason: "path_replaced" });
    }
    return stats;
  }

  assertProjectAnchor(initialDetails);

  function normalizeRepositoryIdentity(identity, details) {
    if (typeof identity !== "string" || identity.length === 0 || identity.includes("\0")) {
      policyError({ ...details, reason: "invalid_syntax" });
    }
    if (path.isAbsolute(identity) || (process.platform === "win32" && /^[A-Za-z]:/.test(identity))) {
      policyError({ ...details, reason: "outside_project" });
    }
    const hostParts = identity.split(path.sep);
    if (hostParts.includes("..")) {
      policyError({ ...details, reason: "outside_project" });
    }
    const absolutePath = path.resolve(root, identity);
    if (!isInside(root, absolutePath) || absolutePath === root) {
      policyError({ ...details, reason: "outside_project" });
    }
    const hostRelative = path.relative(root, absolutePath);
    return {
      absolutePath,
      hostRelative,
      identity: toSerializedPath(hostRelative)
    };
  }

  function inspectRepositoryPath(identity, {
    code = "CORTEX_FS_SOURCE",
    phase = "discovery",
    subjectKind = "repository_path",
    allowMissing = false,
    expected = "any",
    allowFinalSymlink = false,
    subject: subjectOverride
  } = {}) {
    const rawSubject = typeof identity === "string" ? identity : String(identity ?? "");
    const subject = subjectOverride ?? (
      subjectKind === "repository_path" ? safeRepositorySubject(rawSubject) : rawSubject
    );
    const details = pathDetails(code, phase, subjectKind, subject, "invalid_syntax");
    assertProjectAnchor(details);
    const normalized = normalizeRepositoryIdentity(identity, details);
    const deniedSubject = subjectKind === "configured_source" ? subject : normalized.identity;
    const operationDetails = { ...details, subject: deniedSubject };
    const components = normalized.hostRelative.split(path.sep).filter(Boolean);
    let current = root;
    let finalStats = null;

    for (let index = 0; index < components.length; index += 1) {
      current = path.join(current, components[index]);
      const isFinal = index === components.length - 1;
      assertProjectAnchor(operationDetails);
      let stats;
      try {
        stats = fs.lstatSync(current);
      } catch (error) {
        if (error?.code === "ENOENT" && allowMissing) {
          return { ...normalized, exists: false, stats: null, kind: "missing" };
        }
        denyFilesystemError(error, operationDetails);
      }
      if (stats.isSymbolicLink()) {
        if (isFinal && allowFinalSymlink) {
          return { ...normalized, exists: true, stats, kind: "symlink" };
        }
        policyError({ ...operationDetails, reason: "symlink_component" });
      }
      if (!isFinal && !stats.isDirectory()) {
        policyError({ ...operationDetails, reason: "not_directory" });
      }
      if (isFinal) finalStats = stats;
    }

    const reason = typeReason(finalStats, expected);
    if (reason) {
      policyError({ ...operationDetails, reason });
    }
    assertProjectAnchor(operationDetails);
    try {
      const realCandidate = fs.realpathSync.native(normalized.absolutePath);
      if (!isInside(root, realCandidate)) {
        policyError({ ...operationDetails, reason: "outside_project" });
      }
    } catch (error) {
      denyFilesystemError(error, operationDetails, {
        missingReason: "path_replaced",
        notDirectoryReason: "path_replaced"
      });
    }
    return {
      ...normalized,
      exists: true,
      stats: finalStats,
      kind: finalStats.isDirectory() ? "directory" : "file"
    };
  }

  function inspectConfiguredSource(original, normalized) {
    if (normalized === "") {
      const stats = assertProjectAnchor(pathDetails(
        "CORTEX_FS_SOURCE",
        "discovery",
        "configured_source",
        original,
        "path_replaced"
      ));
      return { original, normalized, identity: "", absolutePath: root, exists: true, kind: "directory", stats };
    }
    const inspected = inspectRepositoryPath(normalized, {
      phase: "discovery",
      subjectKind: "configured_source",
      subject: original,
      allowMissing: true,
      expected: "any"
    });
    return { original, normalized, ...inspected };
  }

  function validateConfiguredSources(values) {
    const syntax = values.map((original) => ({ original, normalized: normalizeConfiguredSource(original) }));
    return syntax.map(({ original, normalized }) => inspectConfiguredSource(original, normalized));
  }

  function controlDetails(controlName) {
    return pathDetails("CORTEX_FS_CONTROL", "control", "control", controlName, "invalid_syntax");
  }

  function validateControl(controlName) {
    if (![".context/config.yaml", ".context/rules.yaml"].includes(controlName)) {
      policyError({ ...controlDetails(controlName), reason: "invalid_syntax" });
    }
    const details = controlDetails(controlName);
    assertProjectAnchor(details);
    const components = controlName.split("/");
    let current = root;
    for (let index = 0; index < components.length; index += 1) {
      current = path.join(current, components[index]);
      const isFinal = index === components.length - 1;
      assertProjectAnchor(details);
      let stats;
      try {
        stats = fs.lstatSync(current);
      } catch (error) {
        denyFilesystemError(error, details);
      }
      if (stats.isSymbolicLink()) policyError({ ...details, reason: "symlink_component" });
      if (!isFinal && !stats.isDirectory()) policyError({ ...details, reason: "not_directory" });
      if (isFinal) {
        const reason = typeReason(stats, "file");
        if (reason) policyError({ ...details, reason });
      }
    }
    return path.join(root, ...components);
  }

  function readControl(controlName) {
    const details = controlDetails(controlName);
    const controlPath = validateControl(controlName);
    assertProjectAnchor(details);
    try {
      return fs.readFileSync(controlPath, "utf8");
    } catch (error) {
      denyFilesystemError(error, details, {
        missingReason: "path_replaced",
        notDirectoryReason: "path_replaced"
      });
    }
  }

  function statRepositoryFile(identity, phase = "direct_read") {
    return inspectRepositoryPath(identity, { phase, expected: "file" });
  }

  function readRepositoryFile(identity, phase = "direct_read", encoding = null) {
    const inspected = inspectRepositoryPath(identity, { phase, expected: "file" });
    const details = pathDetails(
      "CORTEX_FS_SOURCE",
      phase,
      "repository_path",
      inspected.identity,
      "path_replaced"
    );
    assertProjectAnchor(details);
    try {
      return fs.readFileSync(inspected.absolutePath, encoding ?? undefined);
    } catch (error) {
      denyFilesystemError(error, details, {
        missingReason: "path_replaced",
        notDirectoryReason: "path_replaced"
      });
    }
  }

  function readOptionalRepositoryFile(identity, phase = "secondary_read", encoding = "utf8") {
    const inspected = inspectRepositoryPath(identity, {
      phase,
      expected: "file",
      allowMissing: true
    });
    if (!inspected.exists) return null;
    const details = pathDetails(
      "CORTEX_FS_SOURCE",
      phase,
      "repository_path",
      inspected.identity,
      "path_replaced"
    );
    assertProjectAnchor(details);
    try {
      return fs.readFileSync(inspected.absolutePath, encoding);
    } catch (error) {
      if (["ENOENT", "ENOTDIR", "EISDIR", "ELOOP", "ENAMETOOLONG", "EINVAL"].includes(error?.code)) {
        denyFilesystemError(error, details, {
          missingReason: "path_replaced",
          notDirectoryReason: "path_replaced"
        });
      }
      return null;
    }
  }

  function readRepositoryDirectory(identity = "", phase = "discovery") {
    const details = pathDetails(
      "CORTEX_FS_SOURCE",
      phase,
      "repository_path",
      identity === "" ? "." : safeRepositorySubject(identity),
      "path_replaced"
    );
    const directory = identity === ""
      ? { absolutePath: root, identity: "", stats: assertProjectAnchor(details) }
      : inspectRepositoryPath(identity, { phase, expected: "directory" });
    assertProjectAnchor(details);
    try {
      return {
        ...directory,
        entries: fs.readdirSync(directory.absolutePath, { withFileTypes: true })
      };
    } catch (error) {
      denyFilesystemError(error, details, {
        missingReason: "path_replaced",
        notDirectoryReason: "path_replaced"
      });
    }
  }

  function childIdentity(parentIdentity, entryName) {
    const parentHost = parentIdentity ? parentIdentity.split("/").join(path.sep) : "";
    const absolutePath = path.join(root, parentHost, entryName);
    if (!isInside(root, absolutePath)) {
      policyError(pathDetails("CORTEX_FS_SOURCE", "discovery", "repository_path", parentIdentity, "outside_project"));
    }
    return toSerializedPath(path.relative(root, absolutePath));
  }

  function inspectKnownPath(identity, {
    code,
    phase,
    subjectKind,
    expected,
    allowMissing = true
  }) {
    const details = pathDetails(code, phase, subjectKind, identity, "path_replaced");
    assertProjectAnchor(details);
    const components = identity.split("/");
    let current = root;
    for (let index = 0; index < components.length; index += 1) {
      current = path.join(current, components[index]);
      const isFinal = index === components.length - 1;
      assertProjectAnchor(details);
      let stats;
      try {
        stats = fs.lstatSync(current, { bigint: true });
      } catch (error) {
        if (error?.code === "ENOENT" && allowMissing) {
          return { absolutePath: path.join(root, ...components), exists: false, stats: null };
        }
        denyFilesystemError(error, details);
      }
      if (stats.isSymbolicLink()) {
        policyError({ ...details, reason: "symlink_component" });
      }
      if (!isFinal && !stats.isDirectory()) {
        policyError({
          ...details,
          reason: stats.isFile() ? "not_directory" : "special_file"
        });
      }
      if (isFinal) {
        const reason = typeReason(stats, expected);
        if (reason) policyError({ ...details, reason });
        return { absolutePath: current, exists: true, stats };
      }
    }
    policyError({ ...details, reason: "invalid_syntax" });
  }

  function snapshotOf(inspected) {
    if (!inspected.exists) return Object.freeze({ exists: false });
    const kind = inspected.stats.isDirectory() ? "directory" : "file";
    return Object.freeze({
      exists: true,
      dev: String(inspected.stats.dev),
      ino: String(inspected.stats.ino),
      ctimeNs: kind === "file" ? String(inspected.stats.ctimeNs) : null,
      kind
    });
  }

  function snapshotsEqual(left, right) {
    return left.exists === right.exists && (
      !left.exists || (
        left.dev === right.dev &&
        left.ino === right.ino &&
        (left.kind !== "file" || left.ctimeNs === right.ctimeNs) &&
        left.kind === right.kind
      )
    );
  }

  function assertSnapshot(identity, expectedSnapshot, options) {
    const current = snapshotOf(inspectKnownPath(identity, options));
    if (!snapshotsEqual(current, expectedSnapshot)) {
      policyError(pathDetails(
        options.code,
        options.phase,
        options.subjectKind,
        identity,
        "path_replaced"
      ));
    }
  }

  function parseJsonlText(text) {
    if (text === null) return [];
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((record) => record !== null);
  }

  function preflightPriorCache({ testHooks = {} } = {}) {
    const options = {
      code: "CORTEX_FS_CACHE",
      phase: "discovery",
      subjectKind: "cache_path",
      expected: "file",
      allowMissing: true
    };
    const cacheOptions = { ...options, expected: "directory" };
    const snapshots = new Map();
    snapshots.set(
      ".context/cache",
      snapshotOf(inspectKnownPath(".context/cache", cacheOptions))
    );
    for (const identity of PRIOR_CACHE_IDENTITIES) {
      const inspected = inspectKnownPath(identity, options);
      if (inspected.exists && inspected.stats.nlink !== 1n) {
        policyError(pathDetails(
          "CORTEX_FS_CACHE",
          "discovery",
          "cache_path",
          identity,
          "path_replaced"
        ));
      }
      snapshots.set(identity, snapshotOf(inspected));
    }

    function assertCompleteSnapshot() {
      assertSnapshot(".context/cache", snapshots.get(".context/cache"), cacheOptions);
      for (const identity of PRIOR_CACHE_IDENTITIES) {
        assertSnapshot(identity, snapshots.get(identity), options);
      }
    }

    return Object.freeze({
      readText(identity, maxBytes = Number.MAX_SAFE_INTEGER) {
        if (!PRIOR_CACHE_IDENTITY_SET.has(identity) ||
            !Number.isSafeInteger(maxBytes) || maxBytes < 0) {
          policyError(pathDetails(
            "CORTEX_FS_CACHE",
            "discovery",
            "cache_path",
            typeof identity === "string" ? identity : String(identity ?? ""),
            "invalid_syntax"
          ));
        }
        assertCompleteSnapshot();
        const inspected = inspectKnownPath(identity, options);
        if (!inspected.exists) return null;
        if (inspected.stats.size > BigInt(maxBytes)) {
          throw new RangeError(`prior cache exceeds byte cap: ${identity}`);
        }
        const details = pathDetails(
          "CORTEX_FS_CACHE",
          "discovery",
          "cache_path",
          identity,
          "path_replaced"
        );
        assertProjectAnchor(details);
        testHooks.beforeReadTextOpen?.(identity, inspected.absolutePath);
        let descriptor;
        try {
          descriptor = fs.openSync(
            inspected.absolutePath,
            fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
          );
        } catch (error) {
          denyFilesystemError(error, details, {
            missingReason: "path_replaced",
            notDirectoryReason: "path_replaced"
          });
        }
        try {
          const before = fs.fstatSync(descriptor, { bigint: true });
          if (!before.isFile() || before.nlink !== 1n ||
              !snapshotsEqual(snapshotOf({ exists: true, stats: before }), snapshots.get(identity))) {
            policyError(details);
          }
          if (before.size > BigInt(maxBytes)) {
            throw new RangeError(`prior cache exceeds byte cap: ${identity}`);
          }
          const text = fs.readFileSync(descriptor, "utf8");
          const after = fs.fstatSync(descriptor, { bigint: true });
          if (before.dev !== after.dev || before.ino !== after.ino ||
              before.ctimeNs !== after.ctimeNs || before.size !== after.size) {
            policyError(details);
          }
          assertProjectAnchor(details);
          assertCompleteSnapshot();
          return text;
        } catch (error) {
          if (isFilesystemPolicyError(error) || error instanceof RangeError) throw error;
          denyFilesystemError(error, details, {
            missingReason: "path_replaced",
            notDirectoryReason: "path_replaced"
          });
        } finally {
          fs.closeSync(descriptor);
        }
      },
      read(identity) {
        if (!PRIOR_CACHE_IDENTITY_SET.has(identity)) {
          policyError(pathDetails(
            "CORTEX_FS_CACHE",
            "discovery",
            "cache_path",
            typeof identity === "string" ? identity : String(identity ?? ""),
            "invalid_syntax"
          ));
        }
        assertCompleteSnapshot();
        const inspected = inspectKnownPath(identity, options);
        if (!inspected.exists) return [];
        const details = pathDetails(
          "CORTEX_FS_CACHE",
          "discovery",
          "cache_path",
          identity,
          "path_replaced"
        );
        assertProjectAnchor(details);
        try {
          return parseJsonlText(fs.readFileSync(inspected.absolutePath, "utf8"));
        } catch (error) {
          denyFilesystemError(error, details, {
            missingReason: "path_replaced",
            notDirectoryReason: "path_replaced"
          });
        }
      }
    });
  }

  function createKnownDirectory(identity, details) {
    const components = identity.split("/");
    let current = root;
    for (const component of components) {
      current = path.join(current, component);
      assertProjectAnchor(details);
      let stats;
      try {
        stats = fs.lstatSync(current, { bigint: true });
      } catch (error) {
        if (error?.code !== "ENOENT") denyFilesystemError(error, details);
        try {
          fs.mkdirSync(current);
        } catch (mkdirError) {
          denyFilesystemError(mkdirError, details);
        }
        assertProjectAnchor(details);
        try {
          stats = fs.lstatSync(current, { bigint: true });
        } catch (lstatError) {
          denyFilesystemError(lstatError, details, {
            missingReason: "path_replaced",
            notDirectoryReason: "path_replaced"
          });
        }
      }
      if (stats.isSymbolicLink()) policyError({ ...details, reason: "symlink_component" });
      if (!stats.isDirectory()) {
        policyError({
          ...details,
          reason: stats.isFile() ? "not_directory" : "special_file"
        });
      }
    }
  }

  function prepareIngestOutputSet({ testHooks = {} } = {}) {
    const preflightOptions = {
      code: "CORTEX_FS_OUTPUT",
      phase: "output_preflight",
      subjectKind: "output_path",
      expected: "file",
      allowMissing: true
    };

    // Complete static preflight must finish before even missing output
    // directories are created.
    for (const identity of INGEST_OUTPUT_IDENTITIES) {
      inspectKnownPath(identity, preflightOptions);
    }

    const directoryDetails = pathDetails(
      "CORTEX_FS_OUTPUT",
      "output_preflight",
      "output_path",
      ".context",
      "path_replaced"
    );
    createKnownDirectory(".context/cache", directoryDetails);
    createKnownDirectory(".context/db/import", directoryDetails);

    const finalSnapshots = new Map();
    for (const identity of INGEST_OUTPUT_IDENTITIES) {
      finalSnapshots.set(identity, snapshotOf(inspectKnownPath(identity, preflightOptions)));
    }
    const parentOptions = { ...preflightOptions, expected: "directory", allowMissing: false };
    const parentSnapshots = new Map();
    for (const identity of [".context/cache", ".context/db/import"]) {
      parentSnapshots.set(identity, snapshotOf(inspectKnownPath(identity, parentOptions)));
    }

    const stages = new Map();
    let finished = false;
    let commitStarted = false;

    function outputDetails(identity) {
      return pathDetails(
        "CORTEX_FS_OUTPUT",
        "output_commit",
        "output_path",
        identity,
        "path_replaced"
      );
    }

    function parentIdentityFor(identity) {
      return identity.startsWith(".context/cache/")
        ? ".context/cache"
        : ".context/db/import";
    }

    function assertParent(identity) {
      const parentIdentity = parentIdentityFor(identity);
      assertSnapshot(parentIdentity, parentSnapshots.get(parentIdentity), {
        code: "CORTEX_FS_OUTPUT",
        phase: "output_commit",
        subjectKind: "output_path",
        expected: "directory",
        allowMissing: false
      });
    }

    function assertFinal(identity) {
      assertSnapshot(identity, finalSnapshots.get(identity), {
        code: "CORTEX_FS_OUTPUT",
        phase: "output_commit",
        subjectKind: "output_path",
        expected: "file",
        allowMissing: true
      });
    }

    function assertStage(identity) {
      const stageRecord = stages.get(identity);
      const stageStats = fs.lstatSync(stageRecord.path, { bigint: true });
      if (
        stageStats.isSymbolicLink() ||
        !stageStats.isFile() ||
        String(stageStats.dev) !== stageRecord.dev ||
        String(stageStats.ino) !== stageRecord.ino ||
        String(stageStats.ctimeNs) !== stageRecord.ctimeNs
      ) {
        policyError({ ...outputDetails(identity), reason: "path_replaced" });
      }
    }

    function removeOwnedStageAt(candidatePath, stageRecord) {
      try {
        const stats = fs.lstatSync(candidatePath, { bigint: true });
        if (
          stats.isSymbolicLink() ||
          !stats.isFile() ||
          String(stats.dev) !== stageRecord.dev ||
          String(stats.ino) !== stageRecord.ino ||
          String(stats.ctimeNs) !== stageRecord.ctimeNs
        ) {
          return false;
        }
        fs.rmSync(candidatePath);
        return true;
      } catch {
        return false;
      }
    }

    function findRelocatedParent(expectedSnapshot) {
      const pending = [{ directory: path.join(root, ".context"), depth: 0 }];
      while (pending.length > 0) {
        const { directory, depth } = pending.shift();
        let entries;
        try {
          entries = fs.readdirSync(directory, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
          const candidate = path.join(directory, entry.name);
          let stats;
          try {
            stats = fs.lstatSync(candidate, { bigint: true });
          } catch {
            continue;
          }
          if (
            String(stats.dev) === expectedSnapshot.dev &&
            String(stats.ino) === expectedSnapshot.ino
          ) {
            return candidate;
          }
          if (depth < 2) pending.push({ directory: candidate, depth: depth + 1 });
        }
      }
      return null;
    }

    function discardUncommitted() {
      for (const stageRecord of stages.values()) {
        if (stageRecord.committed) continue;
        if (removeOwnedStageAt(stageRecord.path, stageRecord)) continue;
        const relocatedParent = findRelocatedParent(
          parentSnapshots.get(stageRecord.parentIdentity)
        );
        if (relocatedParent) {
          removeOwnedStageAt(path.join(relocatedParent, stageRecord.basename), stageRecord);
        }
      }
    }

    function fail(error, identity) {
      finished = true;
      discardUncommitted();
      if (isFilesystemPolicyError(error)) throw error;
      policyError({
        ...outputDetails(identity),
        reason: filesystemErrorReason(error, {
          missingReason: "path_replaced",
          notDirectoryReason: "path_replaced",
          defaultReason: "path_replaced"
        })
      });
    }

    function stage(identity, write) {
      if (finished || commitStarted || !INGEST_OUTPUT_IDENTITY_SET.has(identity) || stages.has(identity)) {
        fail(new CortexFilesystemPolicyError({
          ...outputDetails(typeof identity === "string" ? identity : String(identity ?? "")),
          reason: "invalid_syntax"
        }), typeof identity === "string" ? identity : String(identity ?? ""));
      }
      const finalPath = path.join(root, ...identity.split("/"));
      const parentPath = path.dirname(finalPath);
      const basename = path.basename(finalPath);
      let stagePath = null;
      let descriptor = null;
      let ownsStage = false;
      try {
        assertParent(identity);
        assertFinal(identity);
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const token = typeof testHooks.stageToken === "function"
            ? String(testHooks.stageToken(identity, attempt))
            : crypto.randomBytes(16).toString("hex");
          stagePath = path.join(parentPath, `.${basename}.${token}.tmp`);
          testHooks.beforeStageCreate?.(identity, attempt, stagePath);
          try {
            descriptor = fs.openSync(stagePath, "wx", 0o600);
            ownsStage = true;
            break;
          } catch (error) {
            if (error?.code !== "EEXIST" || attempt === 7) throw error;
          }
        }
        testHooks.beforeStageWrite?.(identity, descriptor);
        write(descriptor);
        const stats = fs.fstatSync(descriptor, { bigint: true });
        if (!stats.isFile()) policyError({ ...outputDetails(identity), reason: "special_file" });
        fs.closeSync(descriptor);
        descriptor = null;
        stages.set(identity, {
          path: stagePath,
          basename: path.basename(stagePath),
          parentIdentity: parentIdentityFor(identity),
          dev: String(stats.dev),
          ino: String(stats.ino),
          ctimeNs: String(stats.ctimeNs),
          committed: false
        });
      } catch (error) {
        if (descriptor !== null) {
          try { fs.closeSync(descriptor); } catch {}
        }
        if (ownsStage && stagePath) {
          try { fs.rmSync(stagePath, { force: true }); } catch {}
        }
        fail(error, identity);
      }
    }

    function commit() {
      if (finished || commitStarted) {
        fail(new CortexFilesystemPolicyError({
          ...outputDetails(INGEST_MANIFEST_OUTPUT_IDENTITY),
          reason: "invalid_syntax"
        }), INGEST_MANIFEST_OUTPUT_IDENTITY);
      }
      commitStarted = true;
      const missingIdentity = INGEST_OUTPUT_IDENTITIES.find((identity) => !stages.has(identity));
      if (missingIdentity) {
        fail(new Error("incomplete output set"), missingIdentity);
      }
      try {
        testHooks.beforePreCommit?.();
        for (const parentIdentity of parentSnapshots.keys()) {
          assertSnapshot(parentIdentity, parentSnapshots.get(parentIdentity), {
            code: "CORTEX_FS_OUTPUT",
            phase: "output_commit",
            subjectKind: "output_path",
            expected: "directory",
            allowMissing: false
          });
        }
        for (const identity of INGEST_OUTPUT_IDENTITIES) assertFinal(identity);
        for (const identity of INGEST_OUTPUT_IDENTITIES) assertStage(identity);
        for (let index = 0; index < INGEST_OUTPUT_IDENTITIES.length; index += 1) {
          const identity = INGEST_OUTPUT_IDENTITIES[index];
          const stageRecord = stages.get(identity);
          testHooks.beforeCommit?.(identity, index);
          assertParent(identity);
          assertFinal(identity);
          assertStage(identity);
          fs.renameSync(stageRecord.path, path.join(root, ...identity.split("/")));
          stageRecord.committed = true;
        }
        finished = true;
      } catch (error) {
        fail(
          error,
          INGEST_OUTPUT_IDENTITIES.find((identity) => !stages.get(identity)?.committed) ??
            INGEST_MANIFEST_OUTPUT_IDENTITY
        );
      }
    }

    return Object.freeze({
      commit,
      discard() {
        if (finished) return;
        discardUncommitted();
        finished = true;
      },
      stage
    });
  }

  function preflightDashboardData() {
    const baseOptions = {
      code: "CORTEX_FS_DASHBOARD",
      phase: "dashboard_data",
      subjectKind: "dashboard_path",
      allowMissing: true
    };
    const snapshots = new Map();
    for (const identity of DASHBOARD_DATA_IDENTITIES) {
      const expected = DASHBOARD_DIRECTORY_IDENTITY_SET.has(identity) ? "directory" : "file";
      snapshots.set(
        identity,
        snapshotOf(inspectKnownPath(identity, { ...baseOptions, expected }))
      );
    }

    function assertCompleteSnapshot() {
      for (const identity of DASHBOARD_DATA_IDENTITIES) {
        const expected = DASHBOARD_DIRECTORY_IDENTITY_SET.has(identity) ? "directory" : "file";
        assertSnapshot(identity, snapshots.get(identity), { ...baseOptions, expected });
      }
    }

    function readText(identity) {
      if (!DASHBOARD_FILE_IDENTITY_SET.has(identity)) {
        policyError(pathDetails(
          "CORTEX_FS_DASHBOARD",
          "dashboard_data",
          "dashboard_path",
          typeof identity === "string" ? identity : String(identity ?? ""),
          "invalid_syntax"
        ));
      }
      assertCompleteSnapshot();
      const inspected = inspectKnownPath(identity, { ...baseOptions, expected: "file" });
      if (!inspected.exists) return null;
      const details = pathDetails(
        "CORTEX_FS_DASHBOARD",
        "dashboard_data",
        "dashboard_path",
        identity,
        "path_replaced"
      );
      assertProjectAnchor(details);
      try {
        return fs.readFileSync(inspected.absolutePath, "utf8");
      } catch (error) {
        if (["ENOENT", "ENOTDIR", "EISDIR", "ELOOP", "ENAMETOOLONG", "EINVAL"].includes(error?.code)) {
          denyFilesystemError(error, details, {
            missingReason: "path_replaced",
            notDirectoryReason: "path_replaced"
          });
        }
        return null;
      }
    }

    return Object.freeze({
      npmCachePath() {
        assertCompleteSnapshot();
        return path.join(root, ".context", "cache", "npm-cache");
      },
      readJson(identity) {
        const text = readText(identity);
        if (text === null) return null;
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      },
      readJsonl(identity) {
        return parseJsonlText(readText(identity));
      }
    });
  }

  return Object.freeze({
    root,
    anchor: Object.freeze({ ...projectAnchor }),
    assertProjectAnchor,
    childIdentity,
    inspectRepositoryPath,
    preflightDashboardData,
    preflightPriorCache,
    prepareIngestOutputSet,
    readControl,
    readOptionalRepositoryFile,
    readRepositoryDirectory,
    readRepositoryFile,
    statRepositoryFile,
    validateConfiguredSources,
    validateControl
  });
}

export function createFilesystemBoundary(selectedProjectRoot) {
  let selected;
  try {
    selected = path.resolve(String(selectedProjectRoot));
  } catch (error) {
    denyFilesystemError(error, { ...PROJECT_DETAILS, reason: "invalid_syntax" }, {
      defaultReason: "invalid_syntax"
    });
  }
  let selectedStats;
  try {
    selectedStats = fs.statSync(selected, { bigint: true });
  } catch (error) {
    denyFilesystemError(error, PROJECT_DETAILS);
  }
  if (!selectedStats.isDirectory()) {
    policyError(pathDetails("CORTEX_FS_PROJECT", "project", "project", "<project-root>", "not_directory"));
  }

  let root;
  try {
    root = fs.realpathSync.native(selected);
  } catch (error) {
    denyFilesystemError(error, PROJECT_DETAILS);
  }
  let rootStats;
  try {
    rootStats = fs.lstatSync(root, { bigint: true });
  } catch (error) {
    denyFilesystemError(error, PROJECT_DETAILS);
  }
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    policyError({
      ...PROJECT_DETAILS,
      reason: rootStats.isSymbolicLink() ? "symlink_component" : "not_directory"
    });
  }
  const selectedIdentity = rootIdentity(selectedStats);
  const identity = rootIdentity(rootStats);
  if (selectedIdentity.dev !== identity.dev || selectedIdentity.ino !== identity.ino) {
    policyError({ ...PROJECT_DETAILS, reason: "path_replaced" });
  }
  return createBoundaryFromEstablishedAnchor(Object.freeze({
    version: 1,
    root,
    dev: identity.dev,
    ino: identity.ino
  }));
}

export function createFilesystemBoundaryFromAnchor(projectAnchor, failureDetails = PROJECT_DETAILS) {
  if (!isSerializedProjectAnchor(projectAnchor)) {
    policyError({ ...failureDetails, reason: "worker_protocol" });
  }
  return createBoundaryFromEstablishedAnchor(Object.freeze({
    version: 1,
    root: projectAnchor.root,
    dev: projectAnchor.dev,
    ino: projectAnchor.ino
  }), failureDetails);
}

export const FILESYSTEM_POLICY_FIELDS = Object.freeze({
  codes: Object.freeze([...POLICY_CODES]),
  phases: Object.freeze([...POLICY_PHASES]),
  subjectKinds: Object.freeze([...POLICY_SUBJECT_KINDS]),
  reasons: Object.freeze([...POLICY_REASONS])
});
