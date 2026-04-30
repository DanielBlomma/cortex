/**
 * Push policy violations to the Cortex Cloud API.
 *
 * Uses the same endpoint/api_key as policy sync since
 * violations require the "policy" scope.
 */

type ViolationItem = {
  rule_id: string;
  severity: "error" | "warning" | "info";
  message: string;
  file_path?: string;
  metadata?: string;
  occurred_at: string;
};

export type ViolationPushContext = {
  repo?: string;
  instance_id?: string;
  session_id?: string;
};

export type ViolationPushResult = {
  success: boolean;
  count: number;
  error?: string;
};

const pending: ViolationItem[] = [];
let activeContext: ViolationPushContext = {};

export function setViolationPushContext(context: ViolationPushContext): void {
  activeContext = { ...context };
}

/**
 * Queue a violation for the next push.
 */
export function queueViolation(item: ViolationItem): void {
  pending.push(item);
}

/**
 * Push all queued violations to cortex-web.
 * Fire-and-forget — errors are logged but do not throw.
 */
export async function pushViolations(
  endpoint: string,
  apiKey: string,
): Promise<ViolationPushResult> {
  if (pending.length === 0) {
    return { success: true, count: 0 };
  }

  if (!endpoint || !apiKey) {
    return { success: false, count: 0, error: "endpoint or api_key not configured" };
  }

  // Derive the violations endpoint from the policy endpoint.
  // policy endpoint:     https://host/api/v1/policies/sync
  // violations endpoint: https://host/api/v1/violations/push
  const violationsUrl = endpoint.replace(/\/policies\/sync\/?$/, "/violations/push");

  const batch = pending.splice(0, 100); // max 100 per push

  try {
    const response = await fetch(violationsUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        repo: activeContext.repo,
        instance_id: activeContext.instance_id,
        session_id: activeContext.session_id,
        violations: batch,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      // Put them back so they can be retried
      pending.unshift(...batch);
      return { success: false, count: 0, error: `HTTP ${response.status}` };
    }

    return { success: true, count: batch.length };
  } catch (err) {
    // Put them back for retry
    pending.unshift(...batch);
    return {
      success: false,
      count: 0,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}

/**
 * Return the current queue length (for diagnostics).
 */
export function pendingCount(): number {
  return pending.length;
}
