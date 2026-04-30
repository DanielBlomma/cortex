import { call } from "../daemon/client.js";
import type { AuditLogPayload, AuditLogResult } from "../daemon/protocol.js";
import {
  ensureDaemon,
  parseInput,
  readStdin,
  resolveDaemonEntry,
} from "./shared.js";

/**
 * PreCompact hook. Fires just before Claude Code compresses session
 * context. Ideal moment to snapshot session-summary for audit so we
 * preserve a record of activity that's about to be truncated from
 * Claude's working memory.
 */

type ClaudePreCompactInput = {
  session_id?: string;
  cwd?: string;
  // Claude Code may send context size hints; we record what we get.
  context_size_tokens?: number;
};

async function main(): Promise<void> {
  const raw = await readStdin();
  const input = parseInput(raw) as ClaudePreCompactInput;
  const cwd = input.cwd ?? process.cwd();

  ensureDaemon(resolveDaemonEntry(import.meta.url));

  const payload: AuditLogPayload = {
    cwd,
    entry: {
      timestamp: new Date().toISOString(),
      tool: "session.pre_compact",
      input: {
        session_id: input.session_id ?? null,
        context_size_tokens: input.context_size_tokens ?? null,
      },
      event_type: "session",
      evidence_level: "diagnostic",
      resource_type: "session",
      session_id: input.session_id,
      metadata: {
        context_size_tokens: input.context_size_tokens ?? null,
      },
    },
  };

  await call<AuditLogResult>("audit.log", payload, { timeoutMs: 3000 });
  process.exit(0);
}

main().catch(() => process.exit(0));
