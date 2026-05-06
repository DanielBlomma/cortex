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
import { evaluateToolCall } from "../core/workflow/enforcement.js";

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

  // Workflow capability gate. Runs before policy.check so harness-level
  // restrictions block before the daemon's general policy machinery sees
  // the call. No-op when CORTEX_ACTIVE_TASK_ID is unset.
  const activeTaskId = process.env.CORTEX_ACTIVE_TASK_ID?.trim();
  if (activeTaskId) {
    try {
      const verdict = evaluateToolCall({
        cwd,
        taskId: activeTaskId,
        call: { toolName: tool, toolInput: input.tool_input ?? {} },
      });
      if (!verdict.allowed) {
        process.stderr.write(
          `[cortex] Blocked by harness capability: ${verdict.reason}\n`,
        );
        process.exit(2);
      }
    } catch (err) {
      // Capability evaluation should never crash the hook — if it does,
      // log and fall through to the existing policy.check rather than
      // accidentally blocking a legitimate tool.
      process.stderr.write(
        `[cortex] capability evaluation failed (${
          err instanceof Error ? err.message : String(err)
        }); deferring to policy.check\n`,
      );
    }
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
