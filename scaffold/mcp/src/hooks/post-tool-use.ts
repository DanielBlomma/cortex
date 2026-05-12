import { call } from "../daemon/client.js";
import type {
  AuditLogPayload,
  AuditLogResult,
  PolicyCheckPayload,
  PolicyCheckResult,
} from "../daemon/protocol.js";
import { evaluateToolCall } from "../core/workflow/enforcement.js";
import {
  ensureDaemon,
  getBooleanField,
  getNumberField,
  getRecordField,
  getStringField,
  isEnterpriseProject,
  normalizeToolCall,
  parseInput,
  readStdin,
  resolveDaemonEntry,
  sendHeartbeat,
  serializeForAudit,
} from "./shared.js";

function extractToolOutput(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const record =
    getRecordField(input, ["tool_output", "toolOutput", "tool_result", "toolResult", "result"]) ??
    {};

  const outputText = getStringField(input, ["output", "stdout", "stderr"]);
  if (outputText && record.output === undefined) {
    record.output = outputText;
  }

  const success = getBooleanField(input, ["success"]);
  if (success !== undefined && record.success === undefined) {
    record.success = success;
  }

  const exitCode = getNumberField(input, ["exit_code", "exitCode"]);
  if (exitCode !== undefined && record.exit_code === undefined) {
    record.exit_code = exitCode;
  }

  return record;
}

async function main(): Promise<void> {
  const raw = await readStdin();
  const input = parseInput(raw);
  const normalized = normalizeToolCall(input);
  const enterprise = isEnterpriseProject(normalized.cwd);
  const toolOutput = extractToolOutput(input);

  ensureDaemon(resolveDaemonEntry(import.meta.url));

  if (normalized.sessionId) {
    void sendHeartbeat({
      cli: "codex",
      hook: "PostToolUse",
      session_id: normalized.sessionId,
      cwd: normalized.cwd,
    });
  }

  const success =
    getBooleanField(input, ["success"]) ??
    (typeof toolOutput.exit_code === "number" ? toolOutput.exit_code === 0 : undefined);
  const durationMs = getNumberField(input, ["duration_ms", "durationMs"]);

  const auditPayload: AuditLogPayload = {
    cwd: normalized.cwd,
    entry: {
      timestamp: new Date().toISOString(),
      tool: normalized.toolName,
      input: normalized.toolInput,
      event_type: "tool",
      evidence_level: "diagnostic",
      resource_type: "tool_result",
      session_id: normalized.sessionId,
      ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
      ...(success !== undefined
        ? { status: success ? ("success" as const) : ("error" as const) }
        : {}),
      metadata: {
        hook: "PostToolUse",
        tool_output_preview: serializeForAudit(toolOutput),
      },
    },
  };
  void call<AuditLogResult>("audit.log", auditPayload, { timeoutMs: 3000 });

  const activeTaskId = process.env.CORTEX_ACTIVE_TASK_ID?.trim();
  if (activeTaskId) {
    try {
      const verdict = evaluateToolCall({
        cwd: normalized.cwd,
        taskId: activeTaskId,
        call: { toolName: normalized.toolName, toolInput: normalized.toolInput },
      });
      if (!verdict.allowed) {
        process.stderr.write(`[cortex] Blocked after tool execution: ${verdict.reason}\n`);
        process.exit(2);
      }
    } catch (err) {
      process.stderr.write(
        `[cortex] post-tool capability evaluation failed (${
          err instanceof Error ? err.message : String(err)
        }); deferring to policy.check\n`,
      );
    }
  }

  if (Object.keys(toolOutput).length === 0) {
    process.exit(0);
  }

  const policyPayload: PolicyCheckPayload = {
    tool: `${normalized.toolName}.result`,
    cwd: normalized.cwd,
    input: toolOutput,
  };
  const policyRes = await call<PolicyCheckResult>("policy.check", policyPayload, {
    timeoutMs: 5000,
  });

  if (policyRes.ok) {
    if (policyRes.result.allow) {
      process.exit(0);
    }
    process.stderr.write(
      `[cortex] Blocked after tool execution by policy: ${policyRes.result.reason ?? "unspecified"}\n`,
    );
    process.exit(2);
  }

  if (enterprise) {
    process.stderr.write(
      `[cortex] Enterprise daemon unreachable (${policyRes.error}). Blocking continuation per fail-closed policy.\n`,
    );
    process.exit(2);
  }

  process.stderr.write(
    `[cortex] Daemon unreachable (${policyRes.error}). Allowing continuation (community mode).\n`,
  );
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(
    `[cortex post-tool-use] error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(0);
});
