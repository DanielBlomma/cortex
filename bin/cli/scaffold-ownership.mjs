import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const OWNERSHIP_SCHEMA_VERSION = 1;
const OWNERSHIP_DIR_REL = path.join("scaffold", "ownership");
const CURRENT_MANIFEST_REL = path.join(OWNERSHIP_DIR_REL, "current.json");
const INSTALLED_STATE_REL = ".context/scaffold-state.json";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const BASELINE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const REQUIRED_PROTECTED_FILES = [
  ".context/config.yaml",
  ".context/enterprise.yaml",
  ".context/enterprise.yml",
  ".context/ontology.cypher",
  ".context/rules.yaml",
  "AGENTS.md",
  "CLAUDE.md",
];

function readJsonFile(filePath, label) {
  let contents;
  try {
    contents = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`Unable to read ${label} at ${filePath}: ${error.message}`);
  }
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`Invalid JSON in ${label} at ${filePath}: ${error.message}`);
  }
}

function assertPlainObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(`${label} must be an object`);
  }
}

function normalizePortableRelative(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  if (
    value.includes("\\") ||
    value.includes("\0") ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    /^[A-Za-z]:/.test(value)
  ) {
    throw new Error(`${label} must be a portable relative path: ${value}`);
  }
  const normalized = path.posix.normalize(value);
  if (
    normalized !== value ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error(`${label} escapes or broadens its managed root: ${value}`);
  }
  return normalized;
}

function joinPortable(...parts) {
  return parts.filter((part) => part !== ".").join("/");
}

function normalizeManagedFile(file, label) {
  if (typeof file === "string") {
    const normalized = normalizePortableRelative(file, label);
    return { source: normalized, target: normalized, optional: false };
  }
  assertPlainObject(file, label);
  const source = normalizePortableRelative(file.source, `${label}.source`);
  const target = normalizePortableRelative(file.target, `${label}.target`);
  if (file.optional !== undefined && typeof file.optional !== "boolean") {
    throw new Error(`${label}.optional must be a boolean`);
  }
  return { source, target, optional: file.optional === true };
}

export function validateOwnershipManifest(rawManifest, expectedVersion) {
  assertPlainObject(rawManifest, "Scaffold ownership manifest");
  if (rawManifest.schemaVersion !== OWNERSHIP_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported scaffold ownership schema: ${rawManifest.schemaVersion}`,
    );
  }
  if (
    !Number.isSafeInteger(rawManifest.manifestVersion) ||
    rawManifest.manifestVersion < 1
  ) {
    throw new Error("Scaffold manifestVersion must be a positive integer");
  }
  if (
    expectedVersion !== undefined &&
    rawManifest.manifestVersion !== expectedVersion
  ) {
    throw new Error(
      `Scaffold ownership manifest version mismatch: expected ${expectedVersion}, got ${rawManifest.manifestVersion}`,
    );
  }
  if (
    !Array.isArray(rawManifest.managedRoots) ||
    rawManifest.managedRoots.length === 0
  ) {
    throw new Error("Scaffold ownership manifest must define managedRoots");
  }
  if (!Array.isArray(rawManifest.protectedFiles)) {
    throw new Error("Scaffold ownership manifest must define protectedFiles");
  }
  if (!Array.isArray(rawManifest.preservedFiles)) {
    throw new Error("Scaffold ownership manifest must define preservedFiles");
  }
  if (
    rawManifest.preStateBaselines !== undefined &&
    !Array.isArray(rawManifest.preStateBaselines)
  ) {
    throw new Error(
      "Scaffold ownership manifest preStateBaselines must be an array",
    );
  }

  const protectedFiles = rawManifest.protectedFiles.map((file, index) =>
    normalizePortableRelative(file, `protectedFiles[${index}]`),
  );
  if (new Set(protectedFiles).size !== protectedFiles.length) {
    throw new Error("Scaffold ownership manifest has duplicate protected files");
  }
  const protectedSet = new Set(protectedFiles);
  for (const requiredPath of REQUIRED_PROTECTED_FILES) {
    if (!protectedSet.has(requiredPath)) {
      throw new Error(
        `Scaffold ownership manifest must protect ${requiredPath}`,
      );
    }
  }
  const targetSet = new Set();
  const managedRoots = rawManifest.managedRoots.map((root, rootIndex) => {
    const label = `managedRoots[${rootIndex}]`;
    assertPlainObject(root, label);
    const source = normalizePortableRelative(root.source, `${label}.source`);
    const target = normalizePortableRelative(root.target, `${label}.target`);
    if (
      root.optionalPrefixes !== undefined &&
      !Array.isArray(root.optionalPrefixes)
    ) {
      throw new Error(`${label}.optionalPrefixes must be an array`);
    }
    const optionalPrefixes =
      root.optionalPrefixes === undefined
        ? []
        : root.optionalPrefixes.map((prefix, prefixIndex) =>
            normalizePortableRelative(
              prefix,
              `${label}.optionalPrefixes[${prefixIndex}]`,
            ),
          );
    if (!Array.isArray(root.files) || root.files.length === 0) {
      throw new Error(`${label}.files must be a non-empty array`);
    }
    const files = root.files.map((file, fileIndex) => {
      const normalized = normalizeManagedFile(
        file,
        `${label}.files[${fileIndex}]`,
      );
      const targetPath = joinPortable(target, normalized.target);
      if (targetPath === INSTALLED_STATE_REL) {
        throw new Error(
          `Installed scaffold state cannot be a managed source: ${targetPath}`,
        );
      }
      if (protectedSet.has(targetPath)) {
        throw new Error(
          `Managed scaffold target is protected and cannot be owned: ${targetPath}`,
        );
      }
      if (targetSet.has(targetPath)) {
        throw new Error(`Duplicate managed scaffold target: ${targetPath}`);
      }
      targetSet.add(targetPath);
      return {
        ...normalized,
        optional:
          normalized.optional ||
          optionalPrefixes.some(
            (prefix) =>
              normalized.source === prefix ||
              normalized.source.startsWith(`${prefix}/`),
          ),
      };
    });
    return { source, target, optionalPrefixes, files };
  });

  if (
    rawManifest.legacyRoots !== undefined &&
    !Array.isArray(rawManifest.legacyRoots)
  ) {
    throw new Error("Scaffold ownership manifest legacyRoots must be an array");
  }
  const managedRootTargets = new Set(
    managedRoots.map((root) => root.target),
  );
  const legacyTargetSet = new Set();
  const legacyRoots = (rawManifest.legacyRoots ?? []).map(
    (root, rootIndex) => {
      const label = `legacyRoots[${rootIndex}]`;
      assertPlainObject(root, label);
      const sourceManagedRoot = normalizePortableRelative(
        root.sourceManagedRoot,
        `${label}.sourceManagedRoot`,
      );
      const target = normalizePortableRelative(root.target, `${label}.target`);
      if (!managedRootTargets.has(sourceManagedRoot)) {
        throw new Error(
          `${label}.sourceManagedRoot must reference a managed root`,
        );
      }
      if (legacyTargetSet.has(target)) {
        throw new Error(`Duplicate legacy scaffold target root: ${target}`);
      }
      legacyTargetSet.add(target);
      return { sourceManagedRoot, target };
    },
  );
  const expandedLegacyTargetSet = new Set();
  const managedRootsByTarget = new Map(
    managedRoots.map((root) => [root.target, root]),
  );
  for (const legacyRoot of legacyRoots) {
    const sourceRoot = managedRootsByTarget.get(
      legacyRoot.sourceManagedRoot,
    );
    for (const file of sourceRoot.files) {
      const legacyTarget = joinPortable(legacyRoot.target, file.target);
      if (
        targetSet.has(legacyTarget) ||
        protectedSet.has(legacyTarget) ||
        legacyTarget === INSTALLED_STATE_REL
      ) {
        throw new Error(
          `Legacy scaffold target collides with a live target: ${legacyTarget}`,
        );
      }
      if (expandedLegacyTargetSet.has(legacyTarget)) {
        throw new Error(`Duplicate legacy scaffold target: ${legacyTarget}`);
      }
      expandedLegacyTargetSet.add(legacyTarget);
    }
  }

  const preStateBaselines = (rawManifest.preStateBaselines ?? []).map(
    (baselineId, index) => {
      if (
        typeof baselineId !== "string" ||
        !BASELINE_ID_PATTERN.test(baselineId)
      ) {
        throw new Error(
          `preStateBaselines[${index}] must be a portable baseline identifier`,
        );
      }
      return baselineId;
    },
  );
  if (new Set(preStateBaselines).size !== preStateBaselines.length) {
    throw new Error("Scaffold ownership manifest has duplicate baselines");
  }

  const preservedTargetSet = new Set();
  const preservedFiles = rawManifest.preservedFiles.map((file, index) => {
    const label = `preservedFiles[${index}]`;
    assertPlainObject(file, label);
    const source = normalizePortableRelative(file.source, `${label}.source`);
    const target = normalizePortableRelative(file.target, `${label}.target`);
    if (target === INSTALLED_STATE_REL) {
      throw new Error(
        `Installed scaffold state cannot be a preserved source: ${target}`,
      );
    }
    if (!protectedSet.has(target)) {
      throw new Error(`Preserved scaffold target must be protected: ${target}`);
    }
    if (preservedTargetSet.has(target)) {
      throw new Error(`Duplicate preserved scaffold target: ${target}`);
    }
    preservedTargetSet.add(target);
    return { source, target };
  });

  return {
    schemaVersion: OWNERSHIP_SCHEMA_VERSION,
    manifestVersion: rawManifest.manifestVersion,
    managedRoots,
    legacyRoots,
    preStateBaselines,
    protectedFiles,
    preservedFiles,
  };
}

function validateCurrentPointer(rawPointer) {
  assertPlainObject(rawPointer, "Current scaffold ownership pointer");
  if (rawPointer.schemaVersion !== OWNERSHIP_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported scaffold ownership pointer schema: ${rawPointer.schemaVersion}`,
    );
  }
  if (
    !Number.isSafeInteger(rawPointer.manifestVersion) ||
    rawPointer.manifestVersion < 1
  ) {
    throw new Error(
      "Current scaffold ownership pointer must contain a positive manifestVersion",
    );
  }
  return rawPointer.manifestVersion;
}

function ownershipManifestPath(packageRoot, manifestVersion) {
  return path.join(
    packageRoot,
    OWNERSHIP_DIR_REL,
    `v${manifestVersion}.json`,
  );
}

export function loadOwnershipManifest(packageRoot, manifestVersion) {
  const manifestPath = ownershipManifestPath(packageRoot, manifestVersion);
  return validateOwnershipManifest(
    readJsonFile(manifestPath, "scaffold ownership manifest"),
    manifestVersion,
  );
}

export function loadCurrentOwnershipManifest(packageRoot) {
  const pointerPath = path.join(packageRoot, CURRENT_MANIFEST_REL);
  const manifestVersion = validateCurrentPointer(
    readJsonFile(pointerPath, "current scaffold ownership pointer"),
  );
  return loadOwnershipManifest(packageRoot, manifestVersion);
}

export function expandManagedFiles(manifest) {
  return manifest.managedRoots.flatMap((root) =>
    root.files.map((file) => ({
      source: joinPortable(root.source, file.source),
      target: joinPortable(root.target, file.target),
      managedRoot: root.target,
      optional: file.optional,
    })),
  );
}

export function expandLegacyFiles(manifest) {
  const rootsByTarget = new Map(
    manifest.managedRoots.map((root) => [root.target, root]),
  );
  return manifest.legacyRoots.flatMap((legacyRoot) => {
    const sourceRoot = rootsByTarget.get(legacyRoot.sourceManagedRoot);
    return sourceRoot.files.map((file) => ({
      source: joinPortable(sourceRoot.source, file.source),
      target: joinPortable(legacyRoot.target, file.target),
      optional: file.optional,
    }));
  });
}

function validatePreStateBaseline(rawBaseline, expectedId) {
  assertPlainObject(rawBaseline, "Pre-state scaffold ownership baseline");
  if (rawBaseline.schemaVersion !== OWNERSHIP_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported pre-state ownership schema: ${rawBaseline.schemaVersion}`,
    );
  }
  if (
    rawBaseline.baselineId !== expectedId ||
    !BASELINE_ID_PATTERN.test(rawBaseline.baselineId)
  ) {
    throw new Error(
      `Pre-state ownership baseline identifier mismatch: ${rawBaseline.baselineId}`,
    );
  }
  if (
    typeof rawBaseline.sourceCommit !== "string" ||
    !/^[a-f0-9]{40}$/.test(rawBaseline.sourceCommit)
  ) {
    throw new Error(
      "Pre-state ownership baseline must identify a full source commit",
    );
  }
  if (!Array.isArray(rawBaseline.files) || rawBaseline.files.length === 0) {
    throw new Error("Pre-state ownership baseline must define files");
  }
  const targetSet = new Set();
  return {
    schemaVersion: OWNERSHIP_SCHEMA_VERSION,
    baselineId: expectedId,
    sourceCommit: rawBaseline.sourceCommit,
    files: rawBaseline.files.map((file, index) => {
      const label = `Pre-state baseline files[${index}]`;
      assertPlainObject(file, label);
      const target = normalizePortableRelative(
        file.target,
        `${label}.target`,
      );
      if (!SHA256_PATTERN.test(file.sha256)) {
        throw new Error(`${label}.sha256 must be a SHA-256 fingerprint`);
      }
      const legacyTarget =
        file.legacyTarget === undefined
          ? null
          : normalizePortableRelative(
              file.legacyTarget,
              `${label}.legacyTarget`,
            );
      if (targetSet.has(target)) {
        throw new Error(`Duplicate pre-state baseline target: ${target}`);
      }
      targetSet.add(target);
      return { target, sha256: file.sha256, legacyTarget };
    }),
  };
}

function addBaselineHash(hashMap, target, hash) {
  const hashes = hashMap.get(target) ?? new Set();
  hashes.add(hash);
  hashMap.set(target, hashes);
}

export function loadPreStateOwnershipBaselines(packageRoot, manifest) {
  const managedTargets = new Set(
    expandManagedFiles(manifest).map((entry) => entry.target),
  );
  const legacyTargets = new Set(
    expandLegacyFiles(manifest).map((entry) => entry.target),
  );
  const managedHashes = new Map();
  const legacyHashes = new Map();
  for (const baselineId of manifest.preStateBaselines) {
    const baselinePath = path.join(
      packageRoot,
      OWNERSHIP_DIR_REL,
      `baseline-${baselineId}.json`,
    );
    const baseline = validatePreStateBaseline(
      readJsonFile(baselinePath, "pre-state scaffold ownership baseline"),
      baselineId,
    );
    for (const file of baseline.files) {
      if (!managedTargets.has(file.target)) {
        throw new Error(
          `Pre-state baseline target is not currently managed: ${file.target}`,
        );
      }
      addBaselineHash(managedHashes, file.target, file.sha256);
      if (file.legacyTarget !== null) {
        if (!legacyTargets.has(file.legacyTarget)) {
          throw new Error(
            `Pre-state legacy target is not declared for migration: ${file.legacyTarget}`,
          );
        }
        addBaselineHash(legacyHashes, file.legacyTarget, file.sha256);
      }
    }
  }
  return { managedHashes, legacyHashes };
}

function assertContained(rootPath, candidatePath, label) {
  const relative = path.relative(rootPath, candidatePath);
  if (
    relative.length === 0 ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} is outside its expected root: ${candidatePath}`);
  }
}

function lstatWithoutSymlinks(rootPath, relativePath, label) {
  const portable = normalizePortableRelative(relativePath, label);
  const candidatePath = path.resolve(
    rootPath,
    ...portable.split("/"),
  );
  assertContained(rootPath, candidatePath, label);
  let currentPath = rootPath;
  const segments = portable.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    currentPath = path.join(currentPath, segments[index]);
    let stat;
    try {
      stat = fs.lstatSync(currentPath);
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        return { path: candidatePath, stat: null };
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing symlinked ${label}: ${currentPath}`);
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new Error(`Non-directory ancestor for ${label}: ${currentPath}`);
    }
    if (index === segments.length - 1) {
      return { path: candidatePath, stat };
    }
  }
  throw new Error(`Unable to resolve ${label}: ${relativePath}`);
}

function requireRegularSource(scaffoldRoot, entry) {
  const source = lstatWithoutSymlinks(
    scaffoldRoot,
    entry.source,
    `scaffold source ${entry.source}`,
  );
  if (source.stat === null) {
    if (entry.optional) return null;
    throw new Error(`Required scaffold source is missing: ${source.path}`);
  }
  if (!source.stat.isFile()) {
    throw new Error(`Scaffold source is not a regular file: ${source.path}`);
  }
  return source;
}

function preflightTarget(targetRoot, relativePath, label) {
  const target = lstatWithoutSymlinks(targetRoot, relativePath, label);
  if (target.stat !== null && !target.stat.isFile()) {
    throw new Error(`${label} is not a regular file: ${target.path}`);
  }
  return target;
}

function sha256File(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function validateInstalledState(rawState) {
  assertPlainObject(rawState, "Installed scaffold state");
  if (rawState.schemaVersion !== OWNERSHIP_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported installed scaffold state schema: ${rawState.schemaVersion}`,
    );
  }
  if (
    !Number.isSafeInteger(rawState.manifestVersion) ||
    rawState.manifestVersion < 1
  ) {
    throw new Error(
      "Installed scaffold state must contain a positive manifestVersion",
    );
  }
  assertPlainObject(rawState.fileHashes, "Installed scaffold fileHashes");
  const fileHashes = Object.create(null);
  for (const [relativePath, hash] of Object.entries(rawState.fileHashes)) {
    const normalized = normalizePortableRelative(
      relativePath,
      `Installed scaffold hash path ${relativePath}`,
    );
    if (normalized !== relativePath || !SHA256_PATTERN.test(hash)) {
      throw new Error(
        `Invalid installed scaffold fingerprint for ${relativePath}`,
      );
    }
    fileHashes[normalized] = hash;
  }
  return {
    schemaVersion: OWNERSHIP_SCHEMA_VERSION,
    manifestVersion: rawState.manifestVersion,
    fileHashes,
  };
}

function readInstalledState(targetRoot) {
  const state = lstatWithoutSymlinks(
    targetRoot,
    INSTALLED_STATE_REL,
    "installed scaffold state",
  );
  if (state.stat === null) return null;
  if (!state.stat.isFile()) {
    throw new Error(`Installed scaffold state is not a file: ${state.path}`);
  }
  return validateInstalledState(
    readJsonFile(state.path, "installed scaffold state"),
  );
}

function prepareObsoleteCleanup(
  packageRoot,
  targetRoot,
  currentManifest,
  installedState,
) {
  if (
    installedState === null ||
    installedState.manifestVersion === currentManifest.manifestVersion
  ) {
    return [];
  }
  const priorManifest = loadOwnershipManifest(
    packageRoot,
    installedState.manifestVersion,
  );
  const currentTargets = new Set(
    expandManagedFiles(currentManifest).map((entry) => entry.target),
  );
  const protectedTargets = new Set(currentManifest.protectedFiles);
  const obsolete = expandManagedFiles(priorManifest)
    .filter((entry) => !currentTargets.has(entry.target))
    .sort((left, right) => left.target.localeCompare(right.target));
  const prepared = [];
  for (const entry of obsolete) {
    if (protectedTargets.has(entry.target)) {
      throw new Error(
        `Refusing to remove protected obsolete scaffold path: ${entry.target}`,
      );
    }
    const candidate = preflightTarget(
      targetRoot,
      entry.target,
      `obsolete scaffold file ${entry.target}`,
    );
    if (candidate.stat === null) continue;
    const installedHash = installedState.fileHashes[entry.target];
    if (!installedHash) {
      throw new Error(
        `Refusing to remove obsolete scaffold file without an installed fingerprint: ${entry.target}`,
      );
    }
    if (sha256File(candidate.path) !== installedHash) {
      throw new Error(
        `Refusing to remove locally modified obsolete scaffold file: ${entry.target}`,
      );
    }
    prepared.push({
      ...entry,
      path: candidate.path,
      installedHash,
      dev: candidate.stat.dev,
      ino: candidate.stat.ino,
    });
  }
  return prepared;
}

function copyRegularFile(sourcePath, targetPath, beforeRename) {
  const targetDirectory = path.dirname(targetPath);
  fs.mkdirSync(targetDirectory, { recursive: true });
  const temporaryPath = path.join(
    targetDirectory,
    `.${path.basename(targetPath)}.tmp-${process.pid}-${crypto.randomUUID()}`,
  );
  try {
    fs.copyFileSync(sourcePath, temporaryPath, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(temporaryPath, fs.statSync(sourcePath).mode);
    beforeRename();
    fs.renameSync(temporaryPath, targetPath);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // Best effort cleanup for an incomplete atomic replacement.
    }
    throw error;
  }
}

function priorOwnedTargets(packageRoot, installedState) {
  if (installedState === null) return new Set();
  const priorManifest = loadOwnershipManifest(
    packageRoot,
    installedState.manifestVersion,
  );
  return new Set(
    expandManagedFiles(priorManifest)
      .filter((entry) => installedState.fileHashes[entry.target])
      .map((entry) => entry.target),
  );
}

function assertTargetUnchanged(targetRoot, entry, initialTarget) {
  const currentTarget = preflightTarget(
    targetRoot,
    entry.target,
    `managed scaffold target ${entry.target}`,
  );
  if (initialTarget.stat === null) {
    if (currentTarget.stat !== null) {
      throw new Error(
        `Managed scaffold target appeared during install: ${entry.target}`,
      );
    }
    return currentTarget;
  }
  if (
    currentTarget.stat === null ||
    currentTarget.stat.dev !== initialTarget.stat.dev ||
    currentTarget.stat.ino !== initialTarget.stat.ino
  ) {
    throw new Error(
      `Managed scaffold target changed during install: ${entry.target}`,
    );
  }
  return currentTarget;
}

function removePreparedObsolete(targetRoot, entry) {
  const candidate = preflightTarget(
    targetRoot,
    entry.target,
    `obsolete scaffold file ${entry.target}`,
  );
  if (candidate.stat === null) return false;
  if (
    candidate.stat.dev !== entry.dev ||
    candidate.stat.ino !== entry.ino ||
    sha256File(candidate.path) !== entry.installedHash
  ) {
    throw new Error(
      `Refusing to remove obsolete scaffold file changed during cleanup: ${entry.target}`,
    );
  }
  fs.unlinkSync(candidate.path);
  return true;
}

function writeInstalledState(targetRoot, manifest, installedHashes) {
  const fileHashes = {};
  for (const entry of expandManagedFiles(manifest).sort((left, right) =>
    left.target.localeCompare(right.target),
  )) {
    const installedHash = installedHashes.get(entry.target);
    if (!installedHash) continue;
    const target = preflightTarget(
      targetRoot,
      entry.target,
      `installed scaffold file ${entry.target}`,
    );
    if (target.stat === null) {
      throw new Error(
        `Installed scaffold file disappeared before state persistence: ${entry.target}`,
      );
    }
    fileHashes[entry.target] =
      installedHash === true ? sha256File(target.path) : installedHash;
  }
  const statePath = path.join(
    targetRoot,
    ...INSTALLED_STATE_REL.split("/"),
  );
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  preflightTarget(targetRoot, INSTALLED_STATE_REL, "installed scaffold state");
  const temporaryPath = `${statePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(
      temporaryPath,
      `${JSON.stringify(
        {
          schemaVersion: OWNERSHIP_SCHEMA_VERSION,
          manifestVersion: manifest.manifestVersion,
          fileHashes,
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o644 },
    );
    fs.renameSync(temporaryPath, statePath);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // Best effort cleanup for an incomplete state write.
    }
    throw error;
  }
}

export function installManagedScaffold(
  packageRoot,
  targetDir,
  { force, manifestVersion } = {},
) {
  const packageRootReal = fs.realpathSync(packageRoot);
  const scaffoldRoot = fs.realpathSync(path.join(packageRootReal, "scaffold"));
  const targetRoot = fs.realpathSync(targetDir);
  const currentManifest =
    manifestVersion === undefined
      ? loadCurrentOwnershipManifest(packageRootReal)
      : loadOwnershipManifest(packageRootReal, manifestVersion);
  const managedFiles = expandManagedFiles(currentManifest);
  const sources = new Map();
  const initialTargets = new Map();
  const initialPreservedTargets = new Map();

  for (const entry of managedFiles) {
    sources.set(entry.target, requireRegularSource(scaffoldRoot, entry));
    initialTargets.set(
      entry.target,
      preflightTarget(
        targetRoot,
        entry.target,
        `managed scaffold target ${entry.target}`,
      ),
    );
  }
  for (const entry of currentManifest.preservedFiles) {
    const source = requireRegularSource(scaffoldRoot, {
      source: entry.source,
      optional: false,
    });
    sources.set(entry.target, source);
    initialPreservedTargets.set(
      entry.target,
      preflightTarget(
        targetRoot,
        entry.target,
        `preserved scaffold target ${entry.target}`,
      ),
    );
  }

  const installedState = readInstalledState(targetRoot);
  const ownedTargets = priorOwnedTargets(packageRootReal, installedState);
  const preStateOwnership = loadPreStateOwnershipBaselines(
    packageRootReal,
    currentManifest,
  );
  if (force === true) {
    for (const entry of managedFiles) {
      const source = sources.get(entry.target);
      const target = initialTargets.get(entry.target);
      if (source === null || target.stat === null) continue;
      if (installedState !== null) {
        if (!ownedTargets.has(entry.target)) {
          throw new Error(
            `Refusing to overwrite unowned scaffold collision: ${entry.target}`,
          );
        }
      } else {
        const targetHash = sha256File(target.path);
        const matchesBaseline =
          preStateOwnership.managedHashes
            .get(entry.target)
            ?.has(targetHash) === true;
        if (!matchesBaseline) {
          throw new Error(
            `Refusing to overwrite unowned scaffold collision: ${entry.target}`,
          );
        }
      }
    }
  }
  const obsolete =
    force === true
      ? prepareObsoleteCleanup(
          packageRootReal,
          targetRoot,
          currentManifest,
          installedState,
        )
      : [];

  const removed = [];
  for (const entry of obsolete) {
    if (removePreparedObsolete(targetRoot, entry)) {
      removed.push(entry.target);
    }
  }

  let copied = 0;
  const installedHashes = new Map();
  for (const entry of managedFiles) {
    const source = sources.get(entry.target);
    const targetPath = path.join(targetRoot, ...entry.target.split("/"));
    if (source === null) {
      const priorHash = installedState?.fileHashes[entry.target];
      if (priorHash && fs.existsSync(targetPath)) {
        installedHashes.set(entry.target, priorHash);
      }
      continue;
    }
    const initialTarget = initialTargets.get(entry.target);
    if (force !== true && initialTarget.stat !== null) {
      const priorHash = installedState?.fileHashes[entry.target];
      if (priorHash && ownedTargets.has(entry.target)) {
        installedHashes.set(entry.target, priorHash);
      }
      continue;
    }
    copyRegularFile(source.path, targetPath, () =>
      assertTargetUnchanged(targetRoot, entry, initialTarget),
    );
    installedHashes.set(entry.target, true);
    copied += 1;
  }
  for (const entry of currentManifest.preservedFiles) {
    const targetPath = path.join(targetRoot, ...entry.target.split("/"));
    const initialTarget = initialPreservedTargets.get(entry.target);
    if (initialTarget.stat !== null) continue;
    copyRegularFile(sources.get(entry.target).path, targetPath, () =>
      assertTargetUnchanged(targetRoot, entry, initialTarget),
    );
    copied += 1;
  }

  writeInstalledState(targetRoot, currentManifest, installedHashes);
  return {
    manifest: currentManifest,
    copied,
    removed,
  };
}

export const scaffoldOwnershipConstants = Object.freeze({
  schemaVersion: OWNERSHIP_SCHEMA_VERSION,
  installedStateRelativePath: INSTALLED_STATE_REL,
});
