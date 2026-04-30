import { call } from "../daemon/client.js";
import type { TelemetryFlushPayload, TelemetryFlushResult } from "../daemon/protocol.js";
import {
  ensureDaemon,
  parseInput,
  readStdin,
  resolveDaemonEntry,
} from "./shared.js";

/**
 * Stop hook for Claude Code.
 *
 * Fires when Claude finishes responding. We use this to guarantee a
 * telemetry flush — historically metrics.json was lost when MCP exited
 * abruptly. The Stop hook runs in Claude Code's process tree, not the
 * MCP server's, so it survives MCP shutdown.
 *
 * Always exits 0 — telemetry failures must never block the user.
 */

type ClaudeStopInput = {
  session_id?: string;
};

async function main(): Promise<void> {
  const raw = await readStdin();
  const input = parseInput(raw) as ClaudeStopInput;

  ensureDaemon(resolveDaemonEntry(import.meta.url));

  const payload: TelemetryFlushPayload = {
    reason: "stop",
    session_id: input.session_id,
  };

  const res = await call<TelemetryFlushResult>("telemetry.flush", payload, {
    timeoutMs: 5000,
  });

  if (res.ok && res.result.flushed) {
    process.stderr.write(
      `[cortex] Telemetry flushed: ${res.result.events_pushed} events\n`,
    );
  } else if (!res.ok) {
    // Best-effort: silent in normal output. Daemon-reachability is logged
    // through other channels (PreToolUse warnings, daemon log).
    process.stderr.write(
      `[cortex] Telemetry flush skipped: ${res.error}\n`,
    );
  }

  process.exit(0);
}

main().catch(() => {
  // Telemetry must never block. Swallow all errors.
  process.exit(0);
});
