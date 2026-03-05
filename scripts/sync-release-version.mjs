#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const checkMode = process.argv.includes("--check");

function readJson(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Missing required file: ${relativePath}`);
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

function isEqualJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function main() {
  const packageJson = readJson("package.json");
  const version = String(packageJson.version ?? "").trim();
  const packageName = String(packageJson.name ?? "").trim();

  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid package.json version: ${version}`);
  }
  if (!packageName) {
    throw new Error("Missing package.json name");
  }

  const syncPlan = [
    {
      path: "server.json",
      transform: (value) => syncServerJson(value, version, packageName)
    },
    {
      path: "plugins/cortex/.claude-plugin/plugin.json",
      transform: (value) => syncPluginManifest(value, version)
    },
    {
      path: ".claude-plugin/marketplace.json",
      transform: (value) => syncMarketplace(value, version)
    }
  ];

  const driftedFiles = [];
  const updatedFiles = [];

  for (const item of syncPlan) {
    const current = readJson(item.path);
    const next = item.transform(current);
    if (!isEqualJson(current, next)) {
      if (checkMode) {
        driftedFiles.push(item.path);
      } else {
        writeJson(item.path, next);
        updatedFiles.push(item.path);
      }
    }
  }

  if (checkMode) {
    if (driftedFiles.length > 0) {
      throw new Error(
        `Release metadata drift detected for version ${version}: ${driftedFiles.join(", ")}`
      );
    }
    console.log(`[release] metadata is in sync for version ${version}`);
    return;
  }

  if (updatedFiles.length > 0) {
    console.log(`[release] synchronized version ${version} in: ${updatedFiles.join(", ")}`);
  } else {
    console.log(`[release] metadata already in sync for version ${version}`);
  }
}

main();
