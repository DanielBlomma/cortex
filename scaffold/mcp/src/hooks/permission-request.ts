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
  isEnterpriseProject,
  normalizeToolCall,
  parseInput,
  readStdin,
  resolveDaemonEntry,
  sendHeartbeat,
  serializeForAudit,
  getStringField,
} from "./shared.js";

async function main(): Promise<void> {
  const raw = await readStdin();
  const input = parseInput(raw);
  const normalized = normalizeToolCall(input);
  const enterprise = isEnterpriseProject(normalized.cwd);

  ensureDaemon(resolveDaemonEntry(import.meta.url));

  if (normalized.sessionId) {
    void sendHeartbeat({
      cli: "codex",
      hook: "PermissionRequest",
      session_id: normalized.sessionId,
      cwd: normalized.cwd,
    });
  }

  const activeTaskId = process.env.CORTEX_ACTIVE_TASK_ID?.trim();
  if (activeTaskId) {
    try {
      const verdict = evaluateToolCall({
        cwd: normalized.cwd,
        taskId: activeTaskId,
        call: { toolName: normalized.toolName, toolInput: normalized.toolInput },
      });
      if (!verdict.allowed) {
        process.stderr.write(`[cortex] Permission denied by workflow: ${verdict.reason}\n`);
        process.exit(2);
      }
    } catch (err) {
      process.stderr.write(
        `[cortex] permission capability evaluation failed (${
          err instanceof Error ? err.message : String(err)
        }); deferring to policy.check\n`,
      );
    }
  }

  const policyPayload: PolicyCheckPayload = {
    tool: normalized.toolName,
    cwd: normalized.cwd,
    input: normalized.toolInput,
  };
  const policyRes = await call<PolicyCheckResult>("policy.check", policyPayload, {
    timeoutMs: 5000,
  });

  const approvalReason = getStringField(input, ["reason", "permission_reason", "permissionReason"]);
  const auditPayload: AuditLogPayload = {
    cwd: normalized.cwd,
    entry: {
      timestamp: new Date().toISOString(),
      tool: "permission.request",
      input: {
        tool_name: normalized.toolName,
        command: normalized.toolInput.command ?? null,
        prefix_rule: normalized.toolInput.prefix_rule ?? null,
        sandbox_permissions: normalized.toolInput.sandbox_permissions ?? null,
      },
      event_type: "session",
      evidence_level: "diagnostic",
      resource_type: "approval_request",
      session_id: normalized.sessionId,
      metadata: {
        tool_name: normalized.toolName,
        reason: approvalReason ?? null,
        command_preview: serializeForAudit(normalized.toolInput.command),
      },
      ...(policyRes.ok && !policyRes.result.allow
        ? {
            status: "error" as const,
          }
        : {}),
    },
  };
  void call<AuditLogResult>("audit.log", auditPayload, { timeoutMs: 3000 });

  if (policyRes.ok) {
    if (policyRes.result.allow) {
      process.exit(0);
    }
    process.stderr.write(
      `[cortex] Permission denied by policy: ${policyRes.result.reason ?? "unspecified"}\n`,
    );
    process.exit(2);
  }

  if (enterprise) {
    process.stderr.write(
      `[cortex] Enterprise daemon unreachable (${policyRes.error}). Denying permission per fail-closed policy.\n`,
    );
    process.exit(2);
  }

  process.stderr.write(
    `[cortex] Daemon unreachable (${policyRes.error}). Allowing permission request (community mode).\n`,
  );
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(
    `[cortex permission-request] error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(0);
});
