import { randomUUID } from "node:crypto";
import { connect } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

function daemonSocketPath() {
  if (process.env.CORTEX_DAEMON_SOCKET_PATH?.trim()) {
    return process.env.CORTEX_DAEMON_SOCKET_PATH.trim();
  }
  let uid = "anon";
  try {
    const info = userInfo();
    uid =
      typeof info.uid === "number" && info.uid >= 0
        ? String(info.uid)
        : info.username || uid;
  } catch {
    // Keep anonymous fallback.
  }
  return join(tmpdir(), `cortex-${uid}.sock`);
}

export async function callDaemon(
  type,
  payload,
  options = {},
) {
  const timeoutMs = options.timeoutMs ?? 750;
  const id = randomUUID();
  return new Promise((resolve) => {
    const socket = connect(daemonSocketPath());
    let buffer = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ ok: false, error: "timeout" }),
      timeoutMs,
    );
    timer.unref();
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ id, type, payload })}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        const response = JSON.parse(buffer.slice(0, newline));
        if (response.id !== id) {
          finish({ ok: false, error: "invalid_response" });
        } else if (response.ok) {
          finish({ ok: true, result: response.result });
        } else {
          finish({ ok: false, error: response.error ?? "unknown_error" });
        }
      } catch {
        finish({ ok: false, error: "invalid_response" });
      }
    });
    socket.once("error", () => {
      finish({ ok: false, error: "daemon_unreachable" });
    });
  });
}

export async function probeVerifiedDaemon(deps, timeoutMs = 750) {
  const pidFromFile = deps.readPid();
  let response;
  try {
    response = await deps.call("ping", {}, { timeoutMs, autoStart: false });
  } catch {
    response = { ok: false, error: "daemon_unreachable" };
  }

  const socketPid =
    response?.ok &&
    response.result?.pong === true &&
    Number.isInteger(response.result?.pid) &&
    response.result.pid > 0
      ? response.result.pid
      : null;
  if (socketPid && deps.isPidAlive(socketPid)) {
    if (pidFromFile && pidFromFile !== socketPid) {
      return {
        running: true,
        verified: false,
        pid: socketPid,
        reason: "pid_file_socket_mismatch",
      };
    }
    return {
      running: true,
      verified: true,
      pid: socketPid,
      reason: null,
    };
  }

  if (pidFromFile && deps.isPidAlive(pidFromFile)) {
    return {
      running: true,
      verified: false,
      pid: pidFromFile,
      reason: socketPid
        ? "pid_file_socket_mismatch"
        : "live_pid_without_daemon_handshake",
    };
  }
  return {
    running: false,
    verified: false,
    pid: null,
    reason: pidFromFile ? "stale_pid_file" : "not_running",
  };
}

export async function stopVerifiedDaemon(
  deps,
  options = {},
) {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const pollMs = options.pollMs ?? 50;
  const probe = await probeVerifiedDaemon(deps);
  if (!probe.running) return { stopped: false, pid: null };
  if (!probe.verified || !probe.pid) {
    throw new Error(
      `Refusing to signal an unverified process (${probe.reason ?? "unknown identity"}).`,
    );
  }

  const response = await deps.call(
    "shutdown",
    {},
    { timeoutMs: Math.min(timeoutMs, 1_000), autoStart: false },
  );
  if (!response?.ok) {
    throw new Error(
      `Daemon rejected the authenticated shutdown request: ${response?.error ?? "unknown error"}`,
    );
  }

  const deadline = Date.now() + timeoutMs;
  while (deps.isPidAlive(probe.pid) && Date.now() < deadline) {
    await (options.wait ?? defaultWait)(pollMs);
  }
  if (deps.isPidAlive(probe.pid)) {
    throw new Error(
      `Verified daemon pid ${probe.pid} did not stop within ${timeoutMs}ms.`,
    );
  }
  return { stopped: true, pid: probe.pid };
}

function defaultWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
