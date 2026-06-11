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
import { parseBootstrapTimings } from "../stats.mjs";

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
  let partial = { stdout: "", stderr: "" };

  const recordLine = (text) => {
    const ts = Date.now();
    lines.push({ ts, text });
    logStream.write(`${ts} ${text}\n`);
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

  child.stdout.on("data", handleChunk("stdout"));
  child.stderr.on("data", handleChunk("stderr"));

  child.on("error", (error) => {
    recordLine(`[run-bootstrap] spawn error: ${error.message}`);
    writeJson(timingsPath, parseBootstrapTimings(lines));
    logStream.end(() => process.exit(1));
  });

  child.on("close", (code) => {
    for (const channel of ["stdout", "stderr"]) {
      if (partial[channel]) {
        recordLine(partial[channel]);
      }
    }
    recordLine(`[run-bootstrap] cortex bootstrap exited with code ${code}`);
    writeJson(timingsPath, parseBootstrapTimings(lines));
    logStream.end(() => process.exit(code ?? 1));
  });
}

try {
  main();
} catch (error) {
  console.error(`[run-bootstrap] ${error.message}`);
  process.exit(error?.isUsageError ? 2 : 1);
}
