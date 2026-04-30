import { CortexDaemon } from "./server.js";
import type { PolicyCheckPayload, PolicyCheckResult, TelemetryFlushPayload, TelemetryFlushResult } from "./protocol.js";

/**
 * Daemon entry point. Run by `cortex daemon start` (or auto-spawned by
 * the first hook that needs it).
 *
 * MVP wiring: policy.check returns allow:true for everything in community
 * mode; enterprise wiring lives behind a license-gated dynamic import so
 * the daemon binary stays small for community users.
 */

async function policyCheck(
  payload: PolicyCheckPayload,
): Promise<PolicyCheckResult> {
  // v2.0.0 MVP: stub. Full enterprise policy evaluation lives in
  // src/enterprise/ — wire it here once enterprise is loaded.
  // Community mode = allow everything.
  void payload;
  return { allow: true };
}

async function telemetryFlush(
  payload: TelemetryFlushPayload,
): Promise<TelemetryFlushResult> {
  // v2.0.0 MVP: stub. Wire to enterprise/index.ts onSessionEnd path
  // once daemon owns the enterprise lifecycle.
  void payload;
  return { flushed: false, events_pushed: 0 };
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
