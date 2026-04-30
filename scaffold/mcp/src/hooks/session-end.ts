import { call } from "../daemon/client.js";
import type {
  AuditLogPayload,
  AuditLogResult,
  TelemetryFlushPayload,
  TelemetryFlushResult,
} from "../daemon/protocol.js";
import {
  ensureDaemon,
  parseInput,
  readStdin,
  resolveDaemonEntry,
} from "./shared.js";

/**
 * SessionEnd hook. Final telemetry push + audit log when Claude Code's
 * session terminates entirely (more authoritative than Stop, which fires
 * each turn).
 */

type ClaudeSessionEndInput = {
  session_id?: string;
  cwd?: string;
};

async function main(): Promise<void> {
  const raw = await readStdin();
  const input = parseInput(raw) as ClaudeSessionEndInput;
  const cwd = input.cwd ?? process.cwd();

  ensureDaemon(resolveDaemonEntry(import.meta.url));

  // Audit first — even if telemetry push fails, we want the session-end
  // record locally so cortex-web can later derive missing data.
  const auditPayload: AuditLogPayload = {
    cwd,
    entry: {
      timestamp: new Date().toISOString(),
      tool: "session.end",
      input: { session_id: input.session_id ?? null },
      event_type: "session",
      evidence_level: "diagnostic",
      resource_type: "session",
      session_id: input.session_id,
    },
  };
  await call<AuditLogResult>("audit.log", auditPayload, { timeoutMs: 3000 });

  // Final flush — best-effort, may have nothing on disk if MCP already
  // flushed during shutdown.
  const flushPayload: TelemetryFlushPayload = {
    reason: "session_end",
    session_id: input.session_id,
    cwd,
  };
  await call<TelemetryFlushResult>("telemetry.flush", flushPayload, {
    timeoutMs: 5000,
  });

  process.exit(0);
}

main().catch(() => process.exit(0));
