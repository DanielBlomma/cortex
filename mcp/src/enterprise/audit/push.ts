import type { AuditEntry } from "../../core/audit/writer.js";
import { sanitizeAuditEntryForPush } from "../privacy/boundary.js";

export type AuditPushContext = {
  repo?: string;
  instance_id?: string;
  session_id?: string;
};

export type AuditPushResult = {
  success: boolean;
  count: number;
  error?: string;
};

const pending: AuditEntry[] = [];
let activeContext: AuditPushContext = {};

export function setAuditPushContext(context: AuditPushContext): void {
  activeContext = { ...context };
}

export function queueAuditEvent(entry: AuditEntry): void {
  pending.push(sanitizeAuditEntryForPush({
    ...entry,
    repo: entry.repo ?? activeContext.repo,
    instance_id: entry.instance_id ?? activeContext.instance_id,
    session_id: entry.session_id ?? activeContext.session_id,
  }));
}

export function pendingCount(): number {
  return pending.length;
}

export async function pushAuditEvents(
  endpoint: string,
  apiKey: string,
): Promise<AuditPushResult> {
  if (pending.length === 0) {
    return { success: true, count: 0 };
  }

  const auditUrl = endpoint.replace(/\/policies\/sync\/?$/, "/audit/push");
  let pushedCount = 0;

  while (pending.length > 0) {
    const batch = pending.splice(0, 100);

    try {
      const response = await fetch(auditUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          repo: activeContext.repo,
          instance_id: activeContext.instance_id,
          session_id: activeContext.session_id,
          events: batch,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        pending.unshift(...batch);
        return { success: false, count: pushedCount, error: `HTTP ${response.status}` };
      }

      pushedCount += batch.length;
    } catch (err) {
      pending.unshift(...batch);
      return {
        success: false,
        count: pushedCount,
        error: err instanceof Error ? err.message : "unknown error",
      };
    }
  }

  return { success: true, count: pushedCount };
}
