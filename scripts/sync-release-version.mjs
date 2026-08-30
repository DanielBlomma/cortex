#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  npmIntegrityForFile,
  readPackedManifest,
  registryTarballUrl,
} from "./release-artifacts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  let checkMode = false;
  let rootTarball;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") {
      checkMode = true;
      continue;
    }
    if (arg === "--root-tarball") {
      rootTarball = argv[index + 1];
      if (!rootTarball) throw new Error("--root-tarball requires a path");
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return { checkMode, rootTarball };
}

function readJson(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Missing required file: ${relativePath}`);
  }
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function readJsonIfExists(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function writeJson(relativePath, value) {
  const absolutePath = path.join(repoRoot, relativePath);
  fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function syncServerJson(serverJson, version, packageName) {
  const next = structuredClone(serverJson);
  next.version = version;
  if (!Array.isArray(next.packages)) {
    throw new Error("Invalid server.json: expected packages array");
  }
  let foundPackage = false;
  for (const pkg of next.packages) {
    if (pkg && pkg.identifier === packageName) {
      pkg.version = version;
      foundPackage = true;
    }
  }
  if (!foundPackage) {
    throw new Error(`server.json is missing package entry for ${packageName}`);
  }
  return next;
}

function syncPluginManifest(pluginManifest, version) {
  const next = structuredClone(pluginManifest);
  next.version = version;
  return next;
}

function syncDshCortexPackage(pluginPackage, version, packageName) {
  const next = structuredClone(pluginPackage);
  next.version = version;
  if (!next.dependencies || typeof next.dependencies !== "object") {
    throw new Error("Invalid plugins/dsh-cortex/package.json: expected dependencies object");
  }
  if (!Object.hasOwn(next.dependencies, packageName)) {
    throw new Error(`plugins/dsh-cortex/package.json is missing ${packageName}`);
  }
  next.dependencies[packageName] = version;
  return next;
}

export function syncDshCortexLock(
  packageLock,
  version,
  bundleName,
  rootPackage,
  rootArtifact,
) {
  const next = structuredClone(packageLock);
  const rootPackageName = rootPackage.name;
  const installedPath = `node_modules/${rootPackageName}`;
  const lockRoot = next.packages?.[""];
  const installedRoot = next.packages?.[installedPath];
  if (!lockRoot || !installedRoot) {
    throw new Error(
      `Invalid plugins/dsh-cortex/package-lock.json: missing root or ${installedPath}`,
    );
  }
  if (!lockRoot.dependencies || typeof lockRoot.dependencies !== "object") {
    throw new Error(
      "Invalid plugins/dsh-cortex/package-lock.json: missing root dependencies",
    );
  }
  if (!Object.hasOwn(lockRoot.dependencies, rootPackageName)) {
    throw new Error(
      `plugins/dsh-cortex/package-lock.json is missing ${rootPackageName}`,
    );
  }
  if (!rootArtifact && installedRoot.version !== version) {
    throw new Error(
      `A --root-tarball for ${rootPackageName}@${version} is required to replace the locked artifact integrity`,
    );
  }
  if (
    !rootArtifact &&
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(installedRoot.integrity ?? "")
  ) {
    throw new Error(
      `Invalid plugins/dsh-cortex/package-lock.json integrity for ${rootPackageName}`,
    );
  }

  next.name = bundleName;
  next.version = version;
  lockRoot.name = bundleName;
  lockRoot.version = version;
  lockRoot.dependencies[rootPackageName] = version;
  installedRoot.version = version;
  installedRoot.resolved = registryTarballUrl(rootPackageName, version);
  installedRoot.integrity = rootArtifact?.integrity ?? installedRoot.integrity;
  installedRoot.license = rootPackage.license;
  installedRoot.bin = structuredClone(rootPackage.bin);
  installedRoot.engines = structuredClone(rootPackage.engines);
  return next;
}

function syncMarketplace(marketplace, version) {
  const next = structuredClone(marketplace);
  if (!Array.isArray(next.plugins)) {
    throw new Error("Invalid .claude-plugin/marketplace.json: expected plugins array");
  }
  const plugin = next.plugins.find((entry) => entry?.name === "cortex");
  if (!plugin) {
    throw new Error("Missing cortex plugin in .claude-plugin/marketplace.json");
  }
  plugin.version = version;
  return next;
}

function syncMcpRegistrySubmission(submission, nodeEngine, packageName) {
  const next = structuredClone(submission);
  if (!next.requirements || typeof next.requirements !== "object") {
    throw new Error(
      "Invalid mcp-registry-submission.json: expected requirements object",
    );
  }
  next.npmPackage = packageName;
  next.requirements.node = nodeEngine;
  return next;
}

function syncPackageLock(packageLock, version, packageName) {
  const next = structuredClone(packageLock);
  next.name = packageName;
  next.version = version;
  if (
    !next.packages ||
    typeof next.packages !== "object" ||
    !next.packages[""]
  ) {
    throw new Error("Invalid package-lock.json: missing root package entry");
  }
  next.packages[""].name = packageName;
  next.packages[""].version = version;
  return next;
}

function isEqualJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function main() {
  const { checkMode, rootTarball } = parseArgs(process.argv.slice(2));
  const packageJson = readJson("package.json");
  const version = String(packageJson.version ?? "").trim();
  const packageName = String(packageJson.name ?? "").trim();
  const nodeEngine = String(packageJson.engines?.node ?? "").trim();

  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid package.json version: ${version}`);
  }
  if (!packageName) {
    throw new Error("Missing package.json name");
  }
  if (!nodeEngine) {
    throw new Error("Missing package.json engines.node");
  }

  let rootArtifact = null;
  if (rootTarball) {
    const absoluteTarball = path.resolve(rootTarball);
    const packedManifest = readPackedManifest(absoluteTarball);
    if (packedManifest.name !== packageName || packedManifest.version !== version) {
      throw new Error(
        `Root tarball must contain ${packageName}@${version}, got ${String(packedManifest.name)}@${String(packedManifest.version)}`,
      );
    }
    rootArtifact = {
      path: absoluteTarball,
      integrity: npmIntegrityForFile(absoluteTarball),
    };
  }

  const dshPackage = readJson("plugins/dsh-cortex/package.json");
  const dshPackageName = String(dshPackage.name ?? "").trim();
  if (!dshPackageName) {
    throw new Error("Missing plugins/dsh-cortex/package.json name");
  }

  const syncPlan = [
    {
      path: "package-lock.json",
      required: true,
      transform: (value) => syncPackageLock(value, version, packageName)
    },
    {
      path: "server.json",
      required: true,
      transform: (value) => syncServerJson(value, version, packageName)
    },
    {
      path: "mcp-registry-submission.json",
      required: true,
      transform: (value) =>
        syncMcpRegistrySubmission(value, nodeEngine, packageName)
    },
    {
      path: "plugins/cortex/.claude-plugin/plugin.json",
      required: true,
      transform: (value) => syncPluginManifest(value, version)
    },
    {
      path: "plugins/cortex/.codex-plugin/plugin.json",
      required: true,
      transform: (value) => syncPluginManifest(value, version)
    },
    {
      path: "plugins/dsh-cortex/package.json",
      required: true,
      transform: (value) => syncDshCortexPackage(value, version, packageName)
    },
    {
      path: "plugins/dsh-cortex/package-lock.json",
      required: true,
      transform: (value) =>
        syncDshCortexLock(
          value,
          version,
          dshPackageName,
          packageJson,
          rootArtifact,
        )
    },
    {
      path: ".claude-plugin/marketplace.json",
      required: false,
      transform: (value) => syncMarketplace(value, version)
    }
  ];

  const evaluatedPlan = [];
  for (const item of syncPlan) {
    const current = item.required ? readJson(item.path) : readJsonIfExists(item.path);
    if (current === null) {
      continue;
    }
    const next = item.transform(current);
    evaluatedPlan.push({ ...item, current, next });
  }

  const driftedFiles = evaluatedPlan
    .filter(({ current, next }) => !isEqualJson(current, next))
    .map(({ path: itemPath }) => itemPath);

  if (checkMode) {
    if (driftedFiles.length > 0) {
      throw new Error(
        `Release metadata drift detected for version ${version}: ${driftedFiles.join(", ")}`
      );
    }
    console.log(`[release] metadata is in sync for version ${version}`);
    return;
  }

  for (const item of evaluatedPlan) {
    if (!isEqualJson(item.current, item.next)) writeJson(item.path, item.next);
  }
  const updatedFiles = driftedFiles;

  if (updatedFiles.length > 0) {
    console.log(`[release] synchronized version ${version} in: ${updatedFiles.join(", ")}`);
  } else {
    console.log(`[release] metadata already in sync for version ${version}`);
  }
}

const invokedAsScript = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) main();
