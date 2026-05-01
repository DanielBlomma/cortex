import { call } from "../daemon/client.js";
import type { AuditLogPayload, AuditLogResult } from "../daemon/protocol.js";
import {
  ensureDaemon,
  isEnforcedMode,
  parseInput,
  readStdin,
  readTamperLockJson,
  resolveDaemonEntry,
  sendHeartbeat,
} from "./shared.js";

/**
 * SessionStart hook for Claude Code.
 *
 * Phase 6 additions:
 *  - In enforced mode, refuses session start if a tamper-lock exists.
 *    The user must run `cortex enterprise repair` (sudo) to clear it.
 *  - Always sends a heartbeat so the daemon's tamper-tracker can spot
 *    silent post-startup hook removal.
 *
 * Audit/telemetry/heartbeat failures must never block legitimate session
 * startup — only the explicit tamper-lock check does.
 */

type ClaudeSessionStartInput = {
  session_id?: string;
  cwd?: string;
};

async function main(): Promise<void> {
  const raw = await readStdin();
  const input = parseInput(raw) as ClaudeSessionStartInput;
  const cwd = input.cwd ?? process.cwd();
  const sessionId = input.session_id ?? "";

  // Tamper-lock check happens BEFORE we spawn the daemon. We don't want
  // a tampered project to keep getting fresh daemons started.
  const lock = readTamperLockJson(cwd);
  if (lock && isEnforcedMode(cwd)) {
    process.stderr.write(
      "[cortex] Govern enforced: session blocked because hook tampering was detected.\n" +
        "        Run 'sudo cortex enterprise repair' to verify managed-settings\n" +
        "        integrity and clear .context/.cortex-tamper.lock, then retry.\n",
    );
    process.exit(2);
  }

  ensureDaemon(resolveDaemonEntry(import.meta.url));

  const payload: AuditLogPayload = {
    cwd,
    entry: {
      timestamp: new Date().toISOString(),
      tool: "session.start",
      input: { session_id: sessionId || null },
      event_type: "session",
      evidence_level: "diagnostic",
      resource_type: "session",
      session_id: sessionId,
    },
  };

  await call<AuditLogResult>("audit.log", payload, { timeoutMs: 3000 });

  if (sessionId) {
    await sendHeartbeat({
      cli: "claude",
      hook: "SessionStart",
      session_id: sessionId,
      cwd,
    });
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
