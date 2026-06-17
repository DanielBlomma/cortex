#!/usr/bin/env node
/**
 * Runs `cortex bootstrap` for a project while timestamping every output line,
 * then derives per-phase timings from the step markers bootstrap.sh prints.
 *
 * Writes:
 *   --log      full bootstrap log, each line prefixed with epoch ms
 *   --timings  JSON phase durations {deps, ingest, embed, graph_load, status, total}
 *
 * Exits with the bootstrap process exit code so callers can branch on failure
 * while still having timings for the phases that completed.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { parseFlag, usageError, writeJson } from "../lib.mjs";
import { detectBootstrapPhase, parseBootstrapTimings, summarizeBootstrapMemory } from "../stats.mjs";

function readProcessRssKb(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

function readChildPids(pid) {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim();
    return raw ? raw.split(/\s+/).map((value) => Number(value)).filter(Number.isFinite) : [];
  } catch {
    return [];
  }
}

function readProcessTreeRssKb(rootPid) {
  const pending = [rootPid];
  const seen = new Set();
  let total = 0;
  while (pending.length > 0) {
    const pid = pending.pop();
    if (!Number.isFinite(pid) || seen.has(pid)) {
      continue;
    }
    seen.add(pid);
    total += readProcessRssKb(pid);
    pending.push(...readChildPids(pid));
  }
  return total;
}

function main() {
  const args = process.argv.slice(2);
  const projectDir = parseFlag(args, "--project");
  const logPath = parseFlag(args, "--log");
  const timingsPath = parseFlag(args, "--timings");
  if (!projectDir || !logPath || !timingsPath) {
    throw usageError("run-bootstrap.mjs requires --project, --log and --timings");
  }

  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logStream = fs.createWriteStream(logPath, { flags: "w" });
  const lines = [];
  const memorySamples = [];
  let partial = { stdout: "", stderr: "" };
  let currentPhase = null;
  let memoryTimer = null;

  const recordLine = (text) => {
    const ts = Date.now();
    const phase = detectBootstrapPhase(text);
    if (phase) {
      currentPhase = phase;
    }
    lines.push({ ts, text });
    logStream.write(`${ts} ${text}\n`);
  };

  const writeTimings = () => {
    writeJson(timingsPath, {
      ...parseBootstrapTimings(lines),
      memory: summarizeBootstrapMemory(memorySamples)
    });
  };

  const handleChunk = (channel) => (chunk) => {
    partial[channel] += chunk.toString();
    const pieces = partial[channel].split("\n");
    partial = { ...partial, [channel]: pieces.pop() ?? "" };
    for (const piece of pieces) {
      recordLine(piece);
    }
  };

  const child = spawn("cortex", ["bootstrap"], {
    cwd: projectDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const sampleIntervalMs = Math.max(250, Number(process.env.BB_RSS_SAMPLE_MS) || 1000);
  const sampleMemory = () => {
    const rssKb = readProcessTreeRssKb(child.pid);
    if (rssKb > 0) {
      memorySamples.push({ ts: Date.now(), phase: currentPhase, rss_kb: rssKb });
    }
  };
  sampleMemory();
  memoryTimer = setInterval(sampleMemory, sampleIntervalMs);
  memoryTimer.unref?.();

  child.stdout.on("data", handleChunk("stdout"));
  child.stderr.on("data", handleChunk("stderr"));

  child.on("error", (error) => {
    if (memoryTimer) {
      clearInterval(memoryTimer);
    }
    recordLine(`[run-bootstrap] spawn error: ${error.message}`);
    writeTimings();
    logStream.end(() => process.exit(1));
  });

  child.on("close", (code) => {
    if (memoryTimer) {
      clearInterval(memoryTimer);
    }
    sampleMemory();
    for (const channel of ["stdout", "stderr"]) {
      if (partial[channel]) {
        recordLine(partial[channel]);
      }
    }
    recordLine(`[run-bootstrap] cortex bootstrap exited with code ${code}`);
    writeTimings();
    logStream.end(() => process.exit(code ?? 1));
  });
}

try {
  main();
} catch (error) {
  console.error(`[run-bootstrap] ${error.message}`);
  process.exit(error?.isUsageError ? 2 : 1);
}
