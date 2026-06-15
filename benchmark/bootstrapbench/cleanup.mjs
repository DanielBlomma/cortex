#!/usr/bin/env node
/**
 * Cleans stale bootstrapbench artifacts so disk stays bounded across many runs.
 * Ports the self-cleaning idea from agentstackbench's run_suites_cleanup.py:
 * dry-run by default (prints what it would remove); pass --apply to delete.
 *
 * What it cleans:
 *   results/<run-id>/   keep the N newest run dirs, remove older (--keep-latest)
 *   bb-* containers     stopped eval containers left by a crashed/SIGKILLed run
 *                       (normal runs self-remove via `docker run --rm`)  [--docker]
 *   docker images/cache dangling (untagged) images + build cache         [--docker]
 *
 * Repos are cloned INSIDE --rm containers, so per-item repo data is already
 * ephemeral — this handles the artifacts that outlive a run.
 *
 * Usage:
 *   node benchmark/bootstrapbench/cleanup.mjs [--results-dir <dir>] [--keep-latest N] [--apply] [--docker]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { hasFlag, parseFlag, runCommand, usageError } from "./lib.mjs";

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_RESULTS_DIR = path.join(HARNESS_DIR, "results");
const CONTAINER_PREFIX = "bb-";
const STOPPED_STATUSES = ["created", "exited", "dead"];

/**
 * Newest-first by mtime; returns the run-dir paths beyond the keep-latest
 * window. Pure for testability (mirrors stale_resolution_dirs upstream).
 */
export function selectStaleRunDirs(entries, keepLatest) {
  const keep = Math.max(0, Math.floor(keepLatest));
  return [...entries]
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(keep)
    .map((entry) => entry.path);
}

/**
 * Parses `docker ps -a --format "{{.Names}} {{.Status}}"` output into the names
 * of stopped eval containers (bb-* prefix, created/exited/dead status). Pure.
 */
export function stoppedEvalContainers(psOutput) {
  const names = [];
  for (const line of String(psOutput ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [name, ...rest] = trimmed.split(/\s+/);
    const status = rest.join(" ").toLowerCase();
    if (!name.startsWith(CONTAINER_PREFIX)) continue;
    if (STOPPED_STATUSES.some((prefix) => status.startsWith(prefix))) {
      names.push(name);
    }
  }
  return names;
}

function listRunDirs(resultsDir) {
  if (!fs.existsSync(resultsDir)) return [];
  return fs
    .readdirSync(resultsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const full = path.join(resultsDir, entry.name);
      return { path: full, mtimeMs: fs.statSync(full).mtimeMs };
    });
}

async function main() {
  const args = process.argv.slice(2);
  const resultsDir = path.resolve(parseFlag(args, "--results-dir", DEFAULT_RESULTS_DIR));
  const keepLatest = Number.parseInt(parseFlag(args, "--keep-latest", "3"), 10);
  const apply = hasFlag(args, "--apply");
  const docker = hasFlag(args, "--docker");
  if (!Number.isInteger(keepLatest) || keepLatest < 0) {
    throw usageError("--keep-latest must be an integer >= 0");
  }

  const verb = apply ? "removing" : "would remove";

  const stale = selectStaleRunDirs(listRunDirs(resultsDir), keepLatest);
  for (const dir of stale) {
    console.log(`[cleanup] ${verb} results dir ${dir}`);
    if (apply) fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`[cleanup] ${stale.length} stale run dir(s) (kept newest ${keepLatest})`);

  if (docker) {
    const ps = await runCommand({
      command: "docker",
      args: ["ps", "-a", "--format", "{{.Names}} {{.Status}}"],
      timeoutMs: 30 * 1000
    });
    if (!ps.ok) {
      console.error(`[cleanup] docker ps failed: ${(ps.stderr || ps.stdout || "").trim().slice(0, 200)}`);
    } else {
      const containers = stoppedEvalContainers(ps.stdout);
      for (const name of containers) {
        console.log(`[cleanup] ${verb} container ${name}`);
      }
      if (apply && containers.length > 0) {
        await runCommand({ command: "docker", args: ["rm", "--force", ...containers], timeoutMs: 60 * 1000 });
      }
      console.log(`[cleanup] ${containers.length} stopped ${CONTAINER_PREFIX}* container(s)`);
    }
    // Only dangling (untagged) images + regenerable build cache — never the
    // tagged cortex-bootstrapbench images a run depends on.
    if (apply) {
      await runCommand({ command: "docker", args: ["image", "prune", "-f"], timeoutMs: 120 * 1000 });
      await runCommand({ command: "docker", args: ["builder", "prune", "-f"], timeoutMs: 120 * 1000 });
      console.log("[cleanup] pruned dangling images + build cache");
    } else {
      console.log("[cleanup] would prune dangling images + build cache");
    }
  }

  if (!apply) {
    console.log("[cleanup] dry run — pass --apply to delete");
  }
}

// Run only when invoked directly; stays importable (run.mjs reuses the pure
// helpers for its startup sweep) without executing main().
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[cleanup] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(error?.isUsageError ? 2 : 1);
  });
}
