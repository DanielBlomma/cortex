import { call } from "../daemon/client.js";
import type { AuditLogPayload, AuditLogResult } from "../daemon/protocol.js";
import {
  ensureDaemon,
  parseInput,
  readStdin,
  resolveDaemonEntry,
} from "./shared.js";

/**
 * UserPromptSubmit hook. Fires when the user submits a prompt to Claude.
 *
 * v2.0.0 MVP: logs the event for audit. A future commit will use this
 * hook to inject mandatory rules / ADRs as system context so Claude
 * cannot proceed without seeing them.
 */

type ClaudeUserPromptInput = {
  session_id?: string;
  cwd?: string;
  // Claude passes the prompt — we only log length, not contents, to
  // avoid logging sensitive user input by default.
  prompt?: string;
};

async function main(): Promise<void> {
  const raw = await readStdin();
  const input = parseInput(raw) as ClaudeUserPromptInput;
  const cwd = input.cwd ?? process.cwd();

  ensureDaemon(resolveDaemonEntry(import.meta.url));

  const promptLen = typeof input.prompt === "string" ? input.prompt.length : 0;

  const payload: AuditLogPayload = {
    cwd,
    entry: {
      timestamp: new Date().toISOString(),
      tool: "user.prompt",
      input: { prompt_length: promptLen },
      event_type: "session",
      evidence_level: "diagnostic",
      resource_type: "user_input",
      session_id: input.session_id,
      metadata: { prompt_length: promptLen },
    },
  };

  await call<AuditLogResult>("audit.log", payload, { timeoutMs: 3000 });
  process.exit(0);
}

main().catch(() => process.exit(0));
