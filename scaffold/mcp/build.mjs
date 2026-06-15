#!/usr/bin/env node
/**
 * Builds the MCP server only when its TypeScript inputs changed.
 *
 * Every embed/graph-load/test invocation used to run a full `tsc` compile
 * even with untouched sources — twice per bootstrap, on every `cortex
 * update`. This guard hashes the inputs (src/**, tsconfig.json,
 * package-lock.json) and skips the compiler when the previous build is
 * current. `--force` rebuilds unconditionally.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, "dist");
const SRC = path.join(ROOT, "src");
const MARKER = path.join(DIST, ".cortex-build-hash");
const TSBUILDINFO = path.join(DIST, ".tsbuildinfo");

function collectSources(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSources(absolute, files);
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(absolute);
    }
  }
  return files;
}

function inputHash() {
  const hash = crypto.createHash("sha256");
  const inputs = [
    path.join(ROOT, "tsconfig.json"),
    path.join(ROOT, "package.json"),
    path.join(ROOT, "package-lock.json")
  ];
  const srcDir = path.join(ROOT, "src");
  if (fs.existsSync(srcDir)) {
    inputs.push(...collectSources(srcDir));
  }
  for (const file of inputs) {
    if (!fs.existsSync(file)) {
      continue;
    }
    hash.update(path.relative(ROOT, file));
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

// Every emitting source must have its compiled output, or a partially
// deleted dist would pass as fresh and crash at import time. .d.ts files emit
// nothing, so they are excluded.
function allOutputsPresent() {
  if (!fs.existsSync(SRC)) {
    return true;
  }
  for (const file of collectSources(SRC)) {
    if (file.endsWith(".d.ts")) {
      continue;
    }
    const rel = path.relative(SRC, file).replace(/\.ts$/, ".js");
    if (!fs.existsSync(path.join(DIST, rel))) {
      return false;
    }
  }
  return true;
}

const force = process.argv.includes("--force");
const current = inputHash();

if (!force && allOutputsPresent() && fs.existsSync(MARKER)) {
  try {
    if (fs.readFileSync(MARKER, "utf8").trim() === current) {
      console.log("[build] dist is up to date (sources unchanged)");
      process.exit(0);
    }
  } catch {
    // unreadable marker -> rebuild
  }
}

// A stale incremental state can convince tsc nothing needs re-emitting even
// though dist files are missing; reset it whenever we decided to rebuild.
try {
  fs.rmSync(TSBUILDINFO, { force: true });
} catch {
  // best effort
}

const tscLocal = path.join(ROOT, "node_modules", ".bin", "tsc");
if (!fs.existsSync(tscLocal)) {
  console.error("[build] TypeScript not installed; run npm install in this directory first");
  process.exit(1);
}
const result = spawnSync(tscLocal, ["-p", "tsconfig.json"], { cwd: ROOT, stdio: "inherit" });
if (result.error) {
  console.error(`[build] failed to launch tsc: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

try {
  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(MARKER, `${current}\n`);
} catch {
  // A missing marker only means the next run rebuilds; never fail the build.
}
