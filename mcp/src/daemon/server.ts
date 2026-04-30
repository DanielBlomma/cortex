import { createServer, type Server, type Socket } from "node:net";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { socketPath, pidFilePath } from "./paths.js";
import type {
  Request,
  Response,
  PolicyCheckPayload,
  PolicyCheckResult,
  TelemetryFlushPayload,
  TelemetryFlushResult,
} from "./protocol.js";

/**
 * The cortex daemon serves hooks (PreToolUse, Stop, etc.) over a Unix socket.
 * Long-lived per-user process. Hooks are thin shims; the daemon holds warm
 * state (graph, embeddings, license cache).
 *
 * v2.0.0 MVP: ping + policy.check + telemetry.flush + shutdown.
 * Future: full MCP-tool routing through the daemon (today MCP still runs
 * its own per-session stdio process — see plan Fas 3.6).
 */

const IDLE_SHUTDOWN_MS = 30 * 60 * 1000; // 30 min idle → shutdown

type DaemonOptions = {
  onPolicyCheck?: (payload: PolicyCheckPayload) => Promise<PolicyCheckResult>;
  onTelemetryFlush?: (
    payload: TelemetryFlushPayload,
  ) => Promise<TelemetryFlushResult>;
};

export class CortexDaemon {
  private server: Server | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly opts: DaemonOptions;

  constructor(opts: DaemonOptions = {}) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    const sockPath = socketPath();

    // Clean up stale socket from a prior crash.
    if (existsSync(sockPath)) {
      try {
        unlinkSync(sockPath);
      } catch {
        // ignore — listen() will surface the real error
      }
    }

    const server = createServer((socket) => this.handleConnection(socket));
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(sockPath, () => {
        server.off("error", reject);
        resolve();
      });
    });

    // Persist PID so cortex CLI can detect a running daemon.
    try {
      writeFileSync(pidFilePath(), String(process.pid), "utf8");
    } catch {
      // Non-fatal — clients can still connect via socket existence.
    }

    this.armIdleTimer();
    process.stderr.write(
      `[cortex-daemon] listening on ${sockPath} pid=${process.pid}\n`,
    );

    // Best-effort cleanup on shutdown signals.
    const cleanup = () => {
      this.stop().finally(() => process.exit(0));
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  }

  async stop(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.server) {
      const srv = this.server;
      this.server = null;
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
    try {
      unlinkSync(pidFilePath());
    } catch {
      // ignore
    }
    try {
      unlinkSync(socketPath());
    } catch {
      // ignore
    }
  }

  private armIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      process.stderr.write("[cortex-daemon] idle shutdown\n");
      this.stop().finally(() => process.exit(0));
    }, IDLE_SHUTDOWN_MS);
    this.idleTimer.unref();
  }

  private handleConnection(socket: Socket): void {
    this.armIdleTimer();
    let buffer = "";

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let nlIndex: number;
      while ((nlIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nlIndex);
        buffer = buffer.slice(nlIndex + 1);
        if (!line.trim()) continue;
        void this.handleLine(socket, line);
      }
    });

    socket.on("error", () => {
      // Suppress — clients dropping mid-write must not crash the daemon.
    });
  }

  private async handleLine(socket: Socket, line: string): Promise<void> {
    let req: Request;
    try {
      req = JSON.parse(line) as Request;
    } catch {
      this.sendError(socket, "<unknown>", "invalid_json");
      return;
    }

    try {
      switch (req.type) {
        case "ping":
          this.sendOk(socket, req.id, { pong: true, pid: process.pid });
          return;
        case "policy.check": {
          if (!this.opts.onPolicyCheck) {
            this.sendOk(socket, req.id, { allow: true } as PolicyCheckResult);
            return;
          }
          const result = await this.opts.onPolicyCheck(
            req.payload as PolicyCheckPayload,
          );
          this.sendOk(socket, req.id, result);
          return;
        }
        case "telemetry.flush": {
          if (!this.opts.onTelemetryFlush) {
            this.sendOk(socket, req.id, {
              flushed: false,
              events_pushed: 0,
            } as TelemetryFlushResult);
            return;
          }
          const result = await this.opts.onTelemetryFlush(
            req.payload as TelemetryFlushPayload,
          );
          this.sendOk(socket, req.id, result);
          return;
        }
        case "shutdown":
          this.sendOk(socket, req.id, { ok: true });
          setTimeout(() => this.stop().finally(() => process.exit(0)), 50);
          return;
        default:
          this.sendError(socket, req.id, `unknown_type: ${req.type}`);
      }
    } catch (err) {
      this.sendError(
        socket,
        req.id,
        err instanceof Error ? err.message : "unknown_error",
      );
    }
  }

  private sendOk(socket: Socket, id: string, result: unknown): void {
    const payload: Response = { id, ok: true, result };
    socket.write(`${JSON.stringify(payload)}\n`);
  }

  private sendError(socket: Socket, id: string, error: string): void {
    const payload: Response = { id, ok: false, error };
    socket.write(`${JSON.stringify(payload)}\n`);
  }
}
