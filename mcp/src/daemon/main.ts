import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CortexDaemon } from "./server.js";
import type {
  PolicyCheckPayload,
  PolicyCheckResult,
  TelemetryFlushPayload,
  TelemetryFlushResult,
} from "./protocol.js";
import { loadEnterpriseConfig, resolveEnterpriseActivation } from "../core/config.js";
import { pushMetrics } from "../enterprise/telemetry/sync.js";
import type { TelemetryMetrics } from "../core/telemetry/collector.js";

/**
 * Daemon entry point. Run by `cortex daemon start` (or auto-spawned by
 * the first hook that needs it).
 *
 * v2.0.0: policy.check is currently a stub allowing all calls (real policy
 * evaluation in subsequent commit). telemetry.flush is fully wired — the
 * Stop hook now reliably pushes metrics.json even if MCP died abruptly.
 */

async function policyCheck(
  payload: PolicyCheckPayload,
): Promise<PolicyCheckResult> {
  // v2.0.0 MVP stub: allow everything. Real policy enforcement
  // (rules.yaml + injection scan) wires in next commit.
  void payload;
  return { allow: true };
}

function readMetrics(contextDir: string): TelemetryMetrics | null {
  const path = join(contextDir, "telemetry", "metrics.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as TelemetryMetrics;
  } catch {
    return null;
  }
}

async function telemetryFlush(
  payload: TelemetryFlushPayload,
): Promise<TelemetryFlushResult> {
  const cwd = payload.cwd ?? process.cwd();
  const contextDir = join(cwd, ".context");

  if (!existsSync(contextDir)) {
    return { flushed: false, events_pushed: 0 };
  }

  const config = loadEnterpriseConfig(contextDir);
  const activation = resolveEnterpriseActivation(config);

  if (!activation.active || !config.telemetry.enabled) {
    // Community mode or telemetry disabled → nothing to push.
    return { flushed: false, events_pushed: 0 };
  }

  if (!config.telemetry.endpoint || !config.telemetry.api_key) {
    return { flushed: false, events_pushed: 0 };
  }

  const metrics = readMetrics(contextDir);
  if (!metrics) {
    // No metrics on disk yet — MCP probably hasn't flushed once. Nothing
    // to push from disk. (MCP's interval flush + session-end push handle
    // the in-memory case.)
    return { flushed: false, events_pushed: 0 };
  }

  const result = await pushMetrics(
    metrics,
    config.telemetry.endpoint,
    config.telemetry.api_key,
    { session_id: payload.session_id },
  );

  if (!result.success) {
    process.stderr.write(
      `[cortex-daemon] telemetry push failed: ${result.error ?? "unknown"}\n`,
    );
    return { flushed: false, events_pushed: 0 };
  }

  return {
    flushed: true,
    events_pushed: metrics.total_tool_calls,
  };
}

async function main(): Promise<void> {
  const daemon = new CortexDaemon({
    onPolicyCheck: policyCheck,
    onTelemetryFlush: telemetryFlush,
  });
  await daemon.start();
}

main().catch((err) => {
  process.stderr.write(
    `[cortex-daemon] fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
