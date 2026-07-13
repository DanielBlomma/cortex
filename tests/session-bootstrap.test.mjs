import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  findContextDir,
  main,
  readStatus,
  renderBootstrap,
} from "../plugins/cortex/hooks/session-start.mjs";

const SCRIPT_PATH = fileURLToPath(
  new URL("../plugins/cortex/hooks/session-start.mjs", import.meta.url),
);

function makeContextRepo({ indexed = true, epochSeconds = null } = {}) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-session-"));
  const contextDir = path.join(repoRoot, ".context");
  fs.mkdirSync(path.join(contextDir, "hooks"), { recursive: true });
  if (indexed) {
    fs.mkdirSync(path.join(contextDir, "db"), { recursive: true });
    fs.writeFileSync(path.join(contextDir, "db", "graph.ryu"), "stub", "utf8");
  }
  if (epochSeconds !== null) {
    fs.writeFileSync(
      path.join(contextDir, "hooks", "last-update.epoch"),
      `${epochSeconds}\n`,
      "utf8",
    );
  }
  return { repoRoot, contextDir };
}

function runScript(cwd) {
  return spawnSync(process.execPath, [SCRIPT_PATH], {
    input: JSON.stringify({ cwd, hook_event_name: "SessionStart" }),
    encoding: "utf8",
  });
}

test("fresh index produces a bootstrap pointing at using-cortex", () => {
  const nowMs = 1_800_000_000_000;
  const { repoRoot } = makeContextRepo({ epochSeconds: Math.floor(nowMs / 1000) - 60 });
  try {
    const contextDir = findContextDir(repoRoot);
    const text = renderBootstrap(readStatus(contextDir, nowMs), nowMs);
    assert.match(text, /Cortex is active/);
    assert.match(text, /using-cortex/);
    assert.match(text, /cortex search/);
    assert.match(text, /Index last updated: \d{4}-\d{2}-\d{2}T/);
    assert.doesNotMatch(text, /cortex bootstrap|more than 7 days/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("stale index adds an update nudge", () => {
  const nowMs = 1_800_000_000_000;
  const eightDaysAgo = Math.floor(nowMs / 1000) - 8 * 24 * 60 * 60;
  const { repoRoot } = makeContextRepo({ epochSeconds: eightDaysAgo });
  try {
    const contextDir = findContextDir(repoRoot);
    const text = renderBootstrap(readStatus(contextDir, nowMs), nowMs);
    assert.match(text, /more than 7 days old/);
    assert.match(text, /cortex update/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("missing index warns and suggests cortex bootstrap", () => {
  const nowMs = 1_800_000_000_000;
  const { repoRoot } = makeContextRepo({ indexed: false });
  try {
    const contextDir = findContextDir(repoRoot);
    const text = renderBootstrap(readStatus(contextDir, nowMs), nowMs);
    assert.match(text, /WARNING: no Cortex index found/);
    assert.match(text, /cortex bootstrap/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("indexed repo without update marker reports unknown freshness", () => {
  const nowMs = 1_800_000_000_000;
  const { repoRoot } = makeContextRepo();
  try {
    const contextDir = findContextDir(repoRoot);
    const text = renderBootstrap(readStatus(contextDir, nowMs), nowMs);
    assert.match(text, /Index last updated: unknown\./);
    assert.doesNotMatch(text, /WARNING|more than 7 days/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("no .context directory yields no output and exit 0", () => {
  const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-session-plain-"));
  try {
    assert.equal(findContextDir(plainDir), null);
    assert.equal(main(JSON.stringify({ cwd: plainDir }), plainDir), null);
    const result = runScript(plainDir);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  } finally {
    fs.rmSync(plainDir, { recursive: true, force: true });
  }
});

test("fresh cache is trusted; corrupt cache falls back to recompute", () => {
  const nowMs = 1_800_000_000_000;
  const { repoRoot, contextDir } = makeContextRepo();
  const cachePath = path.join(contextDir, "cache", "session-status.json");
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(
      cachePath,
      JSON.stringify({ computed_at_ms: nowMs - 1000, indexed: false, last_update_ms: null }),
      "utf8",
    );
    assert.equal(readStatus(contextDir, nowMs).indexed, false);

    fs.writeFileSync(cachePath, "{not json", "utf8");
    assert.equal(readStatus(contextDir, nowMs).indexed, true);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("expired cache is recomputed", () => {
  const nowMs = 1_800_000_000_000;
  const { repoRoot, contextDir } = makeContextRepo();
  const cachePath = path.join(contextDir, "cache", "session-status.json");
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(
      cachePath,
      JSON.stringify({
        computed_at_ms: nowMs - 11 * 60 * 1000,
        indexed: false,
        last_update_ms: null,
      }),
      "utf8",
    );
    assert.equal(readStatus(contextDir, nowMs).indexed, true);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("stdin cwd wins over process cwd and nested dirs resolve upward", () => {
  const { repoRoot } = makeContextRepo({ epochSeconds: 1_700_000_000 });
  const nested = path.join(repoRoot, "src", "deep");
  fs.mkdirSync(nested, { recursive: true });
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-session-other-"));
  try {
    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: elsewhere,
      input: JSON.stringify({ cwd: nested }),
      encoding: "utf8",
    });
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(payload.hookSpecificOutput.additionalContext, /Cortex is active/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});
