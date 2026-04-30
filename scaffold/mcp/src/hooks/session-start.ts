import { call } from "../daemon/client.js";
import type { AuditLogPayload, AuditLogResult } from "../daemon/protocol.js";
import {
  ensureDaemon,
  parseInput,
  readStdin,
  resolveDaemonEntry,
} from "./shared.js";

/**
 * SessionStart hook for Claude Code.
 *
 * Logs a session_start audit event so compliance can correlate later
 * activity to a session. Best-effort — telemetry/audit failures must
 * never block session startup.
 */

type ClaudeSessionStartInput = {
  session_id?: string;
  cwd?: string;
};

async function main(): Promise<void> {
  const raw = await readStdin();
  const input = parseInput(raw) as ClaudeSessionStartInput;
  const cwd = input.cwd ?? process.cwd();

  ensureDaemon(resolveDaemonEntry(import.meta.url));

  const payload: AuditLogPayload = {
    cwd,
    entry: {
      timestamp: new Date().toISOString(),
      tool: "session.start",
      input: { session_id: input.session_id ?? null },
      event_type: "session",
      evidence_level: "diagnostic",
      resource_type: "session",
      session_id: input.session_id,
    },
  };

  await call<AuditLogResult>("audit.log", payload, { timeoutMs: 3000 });
  process.exit(0);
}

main().catch(() => process.exit(0));
