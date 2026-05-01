/**
 * Wire protocol between cortex hooks and the cortex daemon.
 * Newline-delimited JSON over a Unix socket.
 *
 * Each request: { id, type, payload }
 * Each response: { id, ok, result?, error? }
 */

export type RequestType =
  | "ping"
  | "policy.check"
  | "telemetry.flush"
  | "audit.log"
  | "heartbeat"
  | "shutdown";

export type Request<T extends RequestType = RequestType> = {
  id: string;
  type: T;
  payload: unknown;
};

export type Response = {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export type PolicyCheckPayload = {
  tool: string;
  cwd: string;
  // Tool-specific input — Claude Code sends this verbatim from PreToolUse
  input: Record<string, unknown>;
};

export type PolicyCheckResult = {
  allow: boolean;
  reason?: string;
  // Optional context to inject when allowing (rules, ADRs)
  inject?: string[];
};

export type TelemetryFlushPayload = {
  reason: "stop" | "session_end" | "interval";
  session_id?: string;
  // Working directory of the project whose telemetry should flush.
  // Hook scripts pass Claude Code's cwd through here.
  cwd?: string;
};

export type TelemetryFlushResult = {
  flushed: boolean;
  events_pushed: number;
};

export type AuditLogPayload = {
  cwd: string;
  // Subset of AuditEntry — daemon fills in date-based file routing.
  // Caller passes only the event-shaped fields; daemon writes them
  // as-is to the per-day audit log.
  entry: {
    timestamp: string;
    tool: string;
    input: Record<string, unknown>;
    result_count?: number;
    duration_ms?: number;
    status?: "success" | "error";
    event_type?: string;
    evidence_level?: "required" | "diagnostic";
    resource_type?: string;
    session_id?: string;
    metadata?: Record<string, unknown>;
  };
};

export type AuditLogResult = {
  written: boolean;
};

export type HeartbeatPayload = {
  cli: "claude" | "codex" | "copilot";
  hook:
    | "PreToolUse"
    | "UserPromptSubmit"
    | "SessionStart"
    | "SessionEnd"
    | "Stop"
    | "PreCompact";
  session_id: string;
  instance_id?: string;
  cwd: string;
  ts: string;
};

export type HeartbeatResult = {
  recorded: boolean;
  tamper_lock_active?: boolean;
};

export const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
