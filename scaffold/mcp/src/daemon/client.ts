import { connect, type Socket } from "node:net";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { socketPath, pidFilePath, logFilePath } from "./paths.js";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  type Request,
  type RequestType,
  type Response,
} from "./protocol.js";

/**
 * Hook-side client for talking to the cortex daemon.
 * Handles auto-start, connect, request/response, and timeouts.
 */

export type CallOptions = {
  timeoutMs?: number;
  autoStart?: boolean;
};

export type CallResult<T> =
  | { ok: true; result: T }
  | { ok: false; error: string };

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readDaemonPid(): number | null {
  if (!existsSync(pidFilePath())) return null;
  try {
    const raw = readFileSync(pidFilePath(), "utf8").trim();
    const pid = Number.parseInt(raw, 10);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    return pid;
  } catch {
    return null;
  }
}

export function isDaemonRunning(): boolean {
  const pid = readDaemonPid();
  if (pid === null) return false;
  return isProcessAlive(pid);
}

/**
 * Spawn the daemon as a detached process. Returns immediately — caller is
 * responsible for waiting until socket is ready (typically via retry loop).
 */
export function spawnDaemon(daemonEntryAbsPath: string): void {
  const out = (() => {
    try {
      // openSync returns an fd we can pass to spawn for stdio redirection.
      // Append-only — the daemon log accumulates across runs.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("node:fs") as typeof import("node:fs");
      return fs.openSync(logFilePath(), "a");
    } catch {
      return "ignore" as const;
    }
  })();

  const child = spawn(process.execPath, [daemonEntryAbsPath], {
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, CORTEX_DAEMON_AUTOSTART: "1" },
  });
  child.unref();
}

async function connectWithRetry(timeoutMs: number): Promise<Socket | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const sock = await new Promise<Socket | null>((resolve) => {
      const s = connect(socketPath());
      s.once("connect", () => resolve(s));
      s.once("error", () => {
        s.destroy();
        resolve(null);
      });
    });
    if (sock) return sock;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

export async function call<T>(
  type: RequestType,
  payload: unknown,
  options: CallOptions = {},
): Promise<CallResult<T>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const id = randomUUID();

  const sock = await connectWithRetry(timeoutMs);
  if (!sock) {
    return { ok: false, error: "daemon_unreachable" };
  }

  return new Promise<CallResult<T>>((resolve) => {
    let buffer = "";
    let settled = false;

    const finish = (r: CallResult<T>) => {
      if (settled) return;
      settled = true;
      sock.end();
      resolve(r);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: "timeout" });
    }, timeoutMs);
    timer.unref();

    sock.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const nl = buffer.indexOf("\n");
      if (nl === -1) return;
      const line = buffer.slice(0, nl);
      try {
        const resp = JSON.parse(line) as Response;
        if (resp.id !== id) return; // not ours; ignore
        clearTimeout(timer);
        if (resp.ok) {
          finish({ ok: true, result: resp.result as T });
        } else {
          finish({ ok: false, error: resp.error ?? "unknown_error" });
        }
      } catch {
        finish({ ok: false, error: "invalid_response" });
      }
    });

    sock.on("error", (err) => {
      clearTimeout(timer);
      finish({ ok: false, error: `socket_error: ${err.message}` });
    });

    const request: Request = { id, type, payload };
    sock.write(`${JSON.stringify(request)}\n`);
  });
}
