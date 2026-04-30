import { join } from "node:path";
import { homedir, tmpdir, userInfo } from "node:os";
import { mkdirSync } from "node:fs";

/**
 * Resolves filesystem locations the daemon and hooks share.
 * Per-user, not per-project — one daemon serves all projects so warm graph
 * + embeddings stay loaded across switches.
 */

function safeUid(): string {
  try {
    const info = userInfo();
    if (typeof info.uid === "number" && info.uid >= 0) {
      return String(info.uid);
    }
    return info.username || "anon";
  } catch {
    return "anon";
  }
}

export function daemonDir(): string {
  const dir = join(homedir(), ".cortex");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function pidFilePath(): string {
  return join(daemonDir(), "daemon.pid");
}

export function logFilePath(): string {
  return join(daemonDir(), "daemon.log");
}

export function socketPath(): string {
  // Keep socket in tmpdir per-user — Linux has 108-char path limit on
  // sockaddr_un.sun_path so we avoid putting it under $HOME.
  return join(tmpdir(), `cortex-${safeUid()}.sock`);
}
