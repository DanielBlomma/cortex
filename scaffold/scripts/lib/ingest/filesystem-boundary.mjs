import fs from "node:fs";
import path from "node:path";

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

function truncateScalars(value, limit = 256) {
  const scalars = [...String(value)];
  if (scalars.length <= limit) return scalars.join("");
  return `${scalars.slice(0, Math.max(0, limit - 1)).join("")}…`;
}

function normalizeSubject(subjectKind, subject) {
  if (subjectKind === "project") return "<project-root>";
  return truncateScalars(subject);
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
  return `cortex: filesystem policy denied [${error.code}] ${error.phase} ${error.subject_kind}=${JSON.stringify(error.subject)} reason=${error.reason}`;
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
  if (
    original.startsWith("/") ||
    original.includes("\\") ||
    /^[A-Za-z]:/.test(original)
  ) {
    return null;
  }
  const parts = original.split("/");
  if (parts.includes("..")) return null;
  const normalizedParts = parts.filter((part) => part !== "" && part !== ".");
  const normalized = normalizedParts.join("/");
  if (normalized === "" && !parts.every((part) => part === "" || part === ".")) return null;
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

export function createFilesystemBoundary(selectedProjectRoot) {
  const selected = path.resolve(String(selectedProjectRoot));
  let selectedStats;
  try {
    selectedStats = fs.statSync(selected);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      policyError(pathDetails("CORTEX_FS_PROJECT", "project", "project", "<project-root>", "missing"));
    }
    throw error;
  }
  if (!selectedStats.isDirectory()) {
    policyError(pathDetails("CORTEX_FS_PROJECT", "project", "project", "<project-root>", "not_directory"));
  }

  let root;
  try {
    root = fs.realpathSync.native(selected);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      policyError(pathDetails("CORTEX_FS_PROJECT", "project", "project", "<project-root>", "missing"));
    }
    throw error;
  }

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
    const normalized = normalizeRepositoryIdentity(identity, details);
    const deniedSubject = subjectKind === "configured_source" ? subject : normalized.identity;
    const components = normalized.hostRelative.split(path.sep).filter(Boolean);
    let current = root;
    let finalStats = null;

    for (let index = 0; index < components.length; index += 1) {
      current = path.join(current, components[index]);
      const isFinal = index === components.length - 1;
      let stats;
      try {
        stats = fs.lstatSync(current);
      } catch (error) {
        if ((error?.code === "ENOENT" || error?.code === "ENOTDIR") && allowMissing) {
          return { ...normalized, exists: false, stats: null, kind: "missing" };
        }
        if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
          policyError({ ...details, subject: deniedSubject, reason: "missing" });
        }
        throw error;
      }
      if (stats.isSymbolicLink()) {
        if (isFinal && allowFinalSymlink) {
          return { ...normalized, exists: true, stats, kind: "symlink" };
        }
        policyError({ ...details, subject: deniedSubject, reason: "symlink_component" });
      }
      if (!isFinal && !stats.isDirectory()) {
        policyError({ ...details, subject: deniedSubject, reason: "not_directory" });
      }
      if (isFinal) finalStats = stats;
    }

    const reason = typeReason(finalStats, expected);
    if (reason) {
      policyError({ ...details, subject: deniedSubject, reason });
    }
    try {
      const realCandidate = fs.realpathSync.native(normalized.absolutePath);
      if (!isInside(root, realCandidate)) {
        policyError({ ...details, subject: deniedSubject, reason: "outside_project" });
      }
    } catch (error) {
      if (isFilesystemPolicyError(error)) throw error;
      if ((error?.code === "ENOENT" || error?.code === "ENOTDIR") && allowMissing) {
        return { ...normalized, exists: false, stats: null, kind: "missing" };
      }
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
        policyError({ ...details, subject: deniedSubject, reason: "path_replaced" });
      }
      throw error;
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
      return { original, normalized, identity: "", absolutePath: root, exists: true, kind: "directory", stats: selectedStats };
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
    const components = controlName.split("/");
    let current = root;
    for (let index = 0; index < components.length; index += 1) {
      current = path.join(current, components[index]);
      const isFinal = index === components.length - 1;
      let stats;
      try {
        stats = fs.lstatSync(current);
      } catch (error) {
        if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
          policyError({ ...details, reason: "missing" });
        }
        throw error;
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
    const controlPath = validateControl(controlName);
    try {
      return fs.readFileSync(controlPath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR" || error?.code === "EISDIR") {
        policyError({ ...controlDetails(controlName), reason: "path_replaced" });
      }
      throw error;
    }
  }

  function statRepositoryFile(identity, phase = "direct_read") {
    return inspectRepositoryPath(identity, { phase, expected: "file" });
  }

  function readRepositoryFile(identity, phase = "direct_read", encoding = null) {
    const inspected = inspectRepositoryPath(identity, { phase, expected: "file" });
    try {
      return fs.readFileSync(inspected.absolutePath, encoding ?? undefined);
    } catch (error) {
      if (["ENOENT", "ENOTDIR", "EISDIR"].includes(error?.code)) {
        policyError(pathDetails(
          "CORTEX_FS_SOURCE",
          phase,
          "repository_path",
          inspected.identity,
          "path_replaced"
        ));
      }
      throw error;
    }
  }

  function readOptionalRepositoryFile(identity, phase = "secondary_read", encoding = "utf8") {
    const inspected = inspectRepositoryPath(identity, {
      phase,
      expected: "file",
      allowMissing: true
    });
    if (!inspected.exists) return null;
    try {
      return readRepositoryFile(inspected.identity, phase, encoding);
    } catch (error) {
      if (isFilesystemPolicyError(error)) throw error;
      return null;
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

  return {
    root,
    childIdentity,
    inspectRepositoryPath,
    readControl,
    readOptionalRepositoryFile,
    readRepositoryFile,
    statRepositoryFile,
    validateConfiguredSources,
    validateControl
  };
}

export const FILESYSTEM_POLICY_FIELDS = Object.freeze({
  codes: Object.freeze([...POLICY_CODES]),
  phases: Object.freeze([...POLICY_PHASES]),
  subjectKinds: Object.freeze([...POLICY_SUBJECT_KINDS]),
  reasons: Object.freeze([...POLICY_REASONS])
});
