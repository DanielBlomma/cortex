import { call } from "../daemon/client.js";
import type { PolicyCheckPayload, PolicyCheckResult } from "../daemon/protocol.js";
import {
  ensureDaemon,
  isEnterpriseProject,
  parseInput,
  readStdin,
  resolveDaemonEntry,
  sendHeartbeat,
} from "./shared.js";

/**
 * PreToolUse hook for Claude Code.
 *
 * Reads the tool invocation from stdin, asks the daemon if policy permits,
 * exits 0 (allow) or 2 (block).
 *
 * Failure modes (Alt A, beslutat 2026-04-30):
 *   community + daemon down → fail-open (exit 0)
 *   enterprise + daemon down → fail-closed (exit 2)
 */

type ClaudePreToolUseInput = {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
  session_id?: string;
};

async function main(): Promise<void> {
  const raw = await readStdin();
  const input = parseInput(raw) as ClaudePreToolUseInput;
  const cwd = input.cwd || process.cwd();
  const tool = input.tool_name || "unknown";
  const enterprise = isEnterpriseProject(cwd);

  // Try to bring the daemon up if it's not already.
  ensureDaemon(resolveDaemonEntry(import.meta.url));

  if (input.session_id) {
    void sendHeartbeat({
      cli: "claude",
      hook: "PreToolUse",
      session_id: input.session_id,
      cwd,
    });
  }

  const payload: PolicyCheckPayload = {
    tool,
    cwd,
    input: input.tool_input ?? {},
  };

  const res = await call<PolicyCheckResult>("policy.check", payload, {
    timeoutMs: 5000,
  });

  if (res.ok) {
    if (res.result.allow) {
      process.exit(0);
    } else {
      // Hook spec: exit 2 + stderr message → Claude Code blocks the tool.
      process.stderr.write(
        `[cortex] Blocked by policy: ${res.result.reason ?? "unspecified"}\n`,
      );
      process.exit(2);
    }
  }

  // Daemon unreachable — apply split fail-mode.
  if (enterprise) {
    process.stderr.write(
      `[cortex] Enterprise daemon unreachable (${res.error}). Blocking tool per fail-closed policy.\n`,
    );
    process.stderr.write(
      "[cortex] Start the daemon with: cortex daemon start\n",
    );
    process.exit(2);
  } else {
    process.stderr.write(
      `[cortex] Daemon unreachable (${res.error}). Allowing tool (community mode).\n`,
    );
    process.exit(0);
  }
}

main().catch((err) => {
  process.stderr.write(
    `[cortex pre-tool-use] error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  // Hook errors should not block the user — fail-open on internal exceptions
  // regardless of mode. The split fail-mode applies only to the explicit
  // "daemon unreachable" path above.
  process.exit(0);
});
