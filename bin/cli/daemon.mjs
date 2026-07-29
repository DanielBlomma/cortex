import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  callDaemon,
  probeVerifiedDaemon,
  stopVerifiedDaemon,
} from "../daemon-control.mjs";
import { resolveDaemonEntry } from "./project-runtime.mjs";

function daemonDirPath() {
  return path.join(process.env.HOME || os.homedir(), ".cortex");
}

function daemonPidFilePath() {
  return path.join(daemonDirPath(), "daemon.pid");
}

function pidFileExists() {
  return fs.existsSync(daemonPidFilePath());
}

function readPid() {
  try {
    const raw = fs.readFileSync(daemonPidFilePath(), "utf8").trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err && typeof err === "object" && err.code === "EPERM") {
      return true;
    }
    return false;
  }
}

async function daemonControlDeps() {
  return {
    readPid,
    isPidAlive,
    call: callDaemon,
  };
}

async function waitForVerifiedDaemon(deps, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probe = await probeVerifiedDaemon(deps, 250);
    if (probe.verified) return probe;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return probeVerifiedDaemon(deps, 250);
}

export async function runDaemonCommand(args, options = {}) {
  const sub = args[0] || "status";
  const projectRoot = options.projectRoot || process.cwd();
  const deps = await daemonControlDeps();
  if (sub === "start") {
    const existing = await probeVerifiedDaemon(deps);
    if (existing.verified) {
      console.log("Daemon already running.");
      return;
    }
    if (existing.running) {
      throw new Error(
        `Refusing to replace unverified live pid ${existing.pid} (${existing.reason}).`,
      );
    }
    const daemonDir = daemonDirPath();
    fs.mkdirSync(daemonDir, { recursive: true });
    const entry = resolveDaemonEntry(projectRoot);
    if (!fs.existsSync(entry)) {
      throw new Error(`Daemon entry not found: ${entry}. Build cortex first.`);
    }
    const logFd = fs.openSync(path.join(daemonDir, "daemon.log"), "a");
    const child = spawn(process.execPath, [entry], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      cwd: projectRoot,
      env: { ...process.env, CORTEX_PROJECT_ROOT: projectRoot },
    });
    child.unref();
    fs.closeSync(logFd);
    const started = await waitForVerifiedDaemon(deps);
    if (!started.verified) {
      throw new Error(
        `Daemon did not complete its verified socket handshake (${started.reason}).`,
      );
    }
    console.log(
      `Daemon started (pid=${started.pid}). Log: ${path.join(daemonDir, "daemon.log")}`,
    );
    return;
  }
  if (sub === "stop") {
    const result = await stopVerifiedDaemon(deps);
    if (!result.stopped) {
      console.log("Daemon not running.");
      return;
    }
    console.log(`Daemon stopped (verified pid=${result.pid}).`);
    return;
  }
  if (sub === "restart") {
    await stopVerifiedDaemon(deps);
    await runDaemonCommand(["start"], { projectRoot });
    return;
  }
  if (sub === "status") {
    const probe = await probeVerifiedDaemon(deps);
    if (probe.verified) {
      console.log(`Daemon running (verified pid=${probe.pid})`);
    } else if (probe.running) {
      console.log(
        `Daemon state unsafe: live pid=${probe.pid}, identity not verified (${probe.reason}).`,
      );
    } else {
      console.log("Daemon not running.");
      if (pidFileExists()) {
        console.log(`(stale pid file at ${daemonPidFilePath()})`);
      }
    }
    return;
  }
  throw new Error(
    `Unknown daemon subcommand: ${sub}. Try start|stop|restart|status`,
  );
}

export async function restartDaemonAfterRuntimeUpgrade(projectRoot) {
  const daemonEntry = resolveDaemonEntry(projectRoot);
  if (!fs.existsSync(daemonEntry)) return;
  const deps = await daemonControlDeps();
  const probe = await probeVerifiedDaemon(deps);
  if (!probe.running) return;
  if (!probe.verified) {
    throw new Error(
      `Runtime upgraded, but live pid ${probe.pid} could not be verified. ` +
        "Refusing to signal it; stop it manually after confirming ownership.",
    );
  }
  console.log(
    `[cortex] restarting verified daemon pid=${probe.pid} to activate the upgraded runtime`,
  );
  await runDaemonCommand(["restart"], { projectRoot });
}
