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

export const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
