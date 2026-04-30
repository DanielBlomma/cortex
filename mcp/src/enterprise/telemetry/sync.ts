import type { TelemetryMetrics } from "../../core/telemetry/collector.js";
import { buildTelemetryPushPayload } from "../privacy/boundary.js";

export type PushResult = {
  success: boolean;
  status?: number;
  error?: string;
  pushed_at?: string;
};

export type PushContext = {
  session_id?: string;
};

let lastPush: PushResult | null = null;

export function getLastPush(): PushResult | null {
  return lastPush;
}

/**
 * Push aggregated metrics to the Cortex Cloud API.
 * Connected edition only. Returns success/failure.
 *
 * The actual cloud API is built in Phase 4 — this sends a POST
 * with JSON body and expects a 2xx response.
 */
export async function pushMetrics(
  metrics: TelemetryMetrics,
  endpoint: string,
  apiKey: string,
  context: PushContext = {},
): Promise<PushResult> {
  if (!endpoint || !apiKey) {
    const result: PushResult = { success: false, error: "endpoint or api_key not configured" };
    lastPush = result;
    return result;
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildTelemetryPushPayload(metrics, context)),
      signal: AbortSignal.timeout(10000),
    });

    const result: PushResult = {
      success: response.ok,
      status: response.status,
      pushed_at: new Date().toISOString(),
    };

    if (!response.ok) {
      result.error = `HTTP ${response.status}`;
    }

    lastPush = result;
    return result;
  } catch (err) {
    const result: PushResult = {
      success: false,
      error: err instanceof Error ? err.message : "unknown error",
    };
    lastPush = result;
    return result;
  }
}
