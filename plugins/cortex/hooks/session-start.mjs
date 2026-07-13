#!/usr/bin/env node
// Claude Code SessionStart hook. Emits a short Cortex bootstrap as
// additionalContext when the session starts inside a Cortex-enabled
// repository. Exits silently (code 0, no output) everywhere else and on
// every error: this hook must never break or delay a session.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const CACHE_RELATIVE_PATH = path.join("cache", "session-status.json");
const CACHE_TTL_MS = 10 * 60 * 1000;
const STALE_INDEX_MS = 7 * 24 * 60 * 60 * 1000;

export function findContextDir(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, ".context");
    try {
      if (fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // not here: keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

export function computeStatus(contextDir, nowMs) {
  const indexed =
    fs.existsSync(path.join(contextDir, "db", "graph.ryu")) ||
    fs.existsSync(path.join(contextDir, "embeddings", "entities.jsonl"));
  let lastUpdateMs = null;
  try {
    const epoch = Number.parseInt(
      fs.readFileSync(path.join(contextDir, "hooks", "last-update.epoch"), "utf8").trim(),
      10,
    );
    if (Number.isFinite(epoch) && epoch > 0) {
      lastUpdateMs = epoch * 1000;
    }
  } catch {
    // no update marker: freshness stays unknown
  }
  return { computed_at_ms: nowMs, indexed, last_update_ms: lastUpdateMs };
}

export function readStatus(contextDir, nowMs) {
  const cachePath = path.join(contextDir, CACHE_RELATIVE_PATH);
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    const age = nowMs - cached?.computed_at_ms;
    if (typeof cached?.indexed === "boolean" && age >= 0 && age < CACHE_TTL_MS) {
      return cached;
    }
  } catch {
    // missing or corrupt cache: recompute
  }
  const status = computeStatus(contextDir, nowMs);
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, `${JSON.stringify(status)}\n`, "utf8");
  } catch {
    // cache writes are best effort
  }
  return status;
}

export function renderBootstrap(status, nowMs) {
  const lines = [
    "Cortex is active in this repository.",
    "- Use the `using-cortex` skill before answering code questions.",
    '- Search first: `cortex search "<query>" --json`; never answer from memory.',
    '- Check `cortex rules --json` before suggesting changes and `cortex impact "<query>" --json` before refactors.',
    "- Review changed files with `cortex pattern-evidence <file> --json`.",
  ];
  if (!status.indexed) {
    lines.push(
      "WARNING: no Cortex index found. Run `cortex bootstrap` before relying on context.",
    );
  } else if (status.last_update_ms === null) {
    lines.push("Index last updated: unknown.");
  } else {
    lines.push(`Index last updated: ${new Date(status.last_update_ms).toISOString()}.`);
    if (nowMs - status.last_update_ms > STALE_INDEX_MS) {
      lines.push("The index is more than 7 days old. Run `cortex update`.");
    }
  }
  return lines.join("\n");
}

export function main(stdinText, fallbackCwd) {
  let startDir = fallbackCwd;
  try {
    const input = JSON.parse(stdinText);
    if (typeof input?.cwd === "string" && input.cwd.length > 0) {
      startDir = input.cwd;
    }
  } catch {
    // no/invalid stdin payload: fall back to the process cwd
  }
  const contextDir = findContextDir(startDir);
  if (!contextDir) {
    return null;
  }
  const nowMs = Date.now();
  const status = readStatus(contextDir, nowMs);
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: renderBootstrap(status, nowMs),
    },
  });
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  try {
    let stdinText = "";
    try {
      stdinText = fs.readFileSync(0, "utf8");
    } catch {
      // stdin unavailable (manual run)
    }
    const output = main(stdinText, process.cwd());
    if (output) {
      process.stdout.write(`${output}\n`);
    }
  } catch {
    // never fail the session
  }
  process.exit(0);
}
