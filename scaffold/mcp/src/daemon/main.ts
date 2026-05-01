import { readFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { CortexDaemon } from "./server.js";
import type {
  PolicyCheckPayload,
  PolicyCheckResult,
  TelemetryFlushPayload,
  TelemetryFlushResult,
  AuditLogPayload,
  AuditLogResult,
} from "./protocol.js";
import { loadEnterpriseConfig, resolveEnterpriseActivation } from "../core/config.js";
import { pushMetrics } from "../enterprise/telemetry/sync.js";
import type { TelemetryMetrics } from "../core/telemetry/collector.js";
import { AuditWriter, type AuditEntry } from "../core/audit/writer.js";
import { startUngovernedScanner } from "./ungoverned-scanner.js";

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
    {
      repo: basename(cwd),
      session_id: payload.session_id,
    },
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

// Per-cwd AuditWriter cache. Daemon serves multiple projects so we don't
// want to instantiate (and lose buffered state) on every audit.log call.
const auditWriters = new Map<string, AuditWriter>();

function getAuditWriter(cwd: string): AuditWriter {
  const contextDir = join(cwd, ".context");
  let writer = auditWriters.get(contextDir);
  if (!writer) {
    writer = new AuditWriter(contextDir);
    auditWriters.set(contextDir, writer);
  }
  return writer;
}

async function auditLog(payload: AuditLogPayload): Promise<AuditLogResult> {
  if (!payload.cwd || !payload.entry) {
    return { written: false };
  }

  const contextDir = join(payload.cwd, ".context");
  if (!existsSync(contextDir)) {
    return { written: false };
  }

  const writer = getAuditWriter(payload.cwd);
  const entry: AuditEntry = {
    timestamp: payload.entry.timestamp,
    tool: payload.entry.tool,
    input: payload.entry.input,
    result_count: payload.entry.result_count ?? 0,
    entities_returned: [],
    rules_applied: [],
    duration_ms: payload.entry.duration_ms ?? 0,
    status: payload.entry.status,
    event_type: payload.entry.event_type as AuditEntry["event_type"],
    evidence_level: payload.entry.evidence_level,
    resource_type: payload.entry.resource_type,
    session_id: payload.entry.session_id,
    metadata: payload.entry.metadata,
  };

  writer.log(entry);
  return { written: true };
}

async function main(): Promise<void> {
  const daemon = new CortexDaemon({
    onPolicyCheck: policyCheck,
    onTelemetryFlush: telemetryFlush,
    onAuditLog: auditLog,
  });
  await daemon.start();

  // Phase 5: Tier 3 ungoverned-session detection. Periodic process scan, audit
  // emit per finding, optional SIGTERM in enforced mode (same-user only).
  const scanInterval = parseInt(process.env.CORTEX_UNGOVERNED_SCAN_MS ?? "", 10);
  const intervalMs = Number.isFinite(scanInterval) && scanInterval > 0 ? scanInterval : 60_000;
  if (process.env.CORTEX_DISABLE_UNGOVERNED_SCAN !== "1") {
    startUngovernedScanner({ cwd: process.cwd(), intervalMs });
  }
}

main().catch((err) => {
  process.stderr.write(
    `[cortex-daemon] fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
