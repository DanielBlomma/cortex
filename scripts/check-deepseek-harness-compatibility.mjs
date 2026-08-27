#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MANIFEST = path.join(
  REPO_ROOT,
  "tests",
  "fixtures",
  "deepseek-harness-compatibility.json",
);

function fail(message) {
  throw new Error(`DeepSeek Harness compatibility check failed: ${message}`);
}

function readManifest(manifestPath) {
  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (parsed?.schema_version !== 1) fail("unsupported manifest schema");
  if (!/^[0-9a-f]{40}$/.test(parsed?.upstream?.commit ?? "")) {
    fail("manifest upstream.commit must be a full Git SHA");
  }
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
    fail("manifest files must be a non-empty array");
  }
  return parsed;
}

function resolveContainedFile(checkoutRoot, relativePath) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath)
  ) {
    fail(`invalid relative file path: ${String(relativePath)}`);
  }
  const normalized = path.normalize(relativePath);
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    fail(`file path escapes checkout: ${relativePath}`);
  }
  const candidate = path.resolve(checkoutRoot, normalized);
  const relative = path.relative(checkoutRoot, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
    fail(`file path escapes checkout: ${relativePath}`);
  }
  const stat = fs.lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail(`expected a regular non-symlink file: ${relativePath}`);
  }
  const realCandidate = fs.realpathSync(candidate);
  const realRelative = path.relative(checkoutRoot, realCandidate);
  if (realRelative === ".." || realRelative.startsWith(`..${path.sep}`)) {
    fail(`resolved file path escapes checkout: ${relativePath}`);
  }
  return realCandidate;
}

export function verifyFileHashes(checkout, files) {
  const checkoutRoot = fs.realpathSync(checkout);
  const mismatches = [];
  for (const entry of files) {
    if (!/^[0-9a-f]{64}$/.test(entry?.sha256 ?? "")) {
      fail(`invalid SHA-256 for ${String(entry?.path)}`);
    }
    let absolutePath;
    try {
      absolutePath = resolveContainedFile(checkoutRoot, entry.path);
    } catch (error) {
      mismatches.push(`${entry.path}: ${error.message}`);
      continue;
    }
    const actual = crypto
      .createHash("sha256")
      .update(fs.readFileSync(absolutePath))
      .digest("hex");
    if (actual !== entry.sha256) {
      mismatches.push(`${entry.path}: expected ${entry.sha256}, got ${actual}`);
    }
  }
  if (mismatches.length > 0) fail(mismatches.join("; "));
  return files.length;
}

export function verifyCompatibility({ checkout, manifestPath = DEFAULT_MANIFEST }) {
  if (!checkout) fail("pass --checkout <deepseek-harness checkout>");
  const checkoutRoot = fs.realpathSync(checkout);
  if (!fs.statSync(checkoutRoot).isDirectory()) fail("checkout is not a directory");
  const manifest = readManifest(manifestPath);
  const git = spawnSync("git", ["-C", checkoutRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  if (git.status !== 0) fail("checkout is not a readable Git worktree");
  const actualCommit = git.stdout.trim();
  if (actualCommit !== manifest.upstream.commit) {
    fail(`expected commit ${manifest.upstream.commit}, got ${actualCommit}`);
  }
  const checkedFiles = verifyFileHashes(checkoutRoot, manifest.files);
  return { commit: actualCommit, checkedFiles };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg !== "--checkout" && arg !== "--manifest") fail(`unknown option ${arg}`);
    const value = argv[index + 1];
    if (!value) fail(`${arg} requires a value`);
    result[arg.slice(2)] = value;
    index += 1;
  }
  return result;
}

const invokedAsScript = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  const args = parseArgs(process.argv.slice(2));
  const result = verifyCompatibility({
    checkout: args.checkout,
    manifestPath: args.manifest ? path.resolve(args.manifest) : DEFAULT_MANIFEST,
  });
  process.stdout.write(
    `[harness-compat] pinned commit ${result.commit}; ${result.checkedFiles} files verified\n`,
  );
}
