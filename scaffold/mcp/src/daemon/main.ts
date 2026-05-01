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
import { PolicyStore } from "../core/policy/store.js";
import {
  enforceInjectionPolicy,
  isInjectionDefenseActive,
} from "../core/policy/enforce.js";
import { syncFromCloud } from "../enterprise/policy/sync.js";
import { startUngovernedScanner } from "./ungoverned-scanner.js";
import {
  HeartbeatTracker,
  writeTamperLock,
  emitTamperAudit,
} from "./heartbeat-tracker.js";
import { startSyncTimer } from "./sync-checker.js";
import { startHostEventsPusher } from "./host-events-pusher.js";
import { startEgressProxy } from "./egress-proxy.js";
import { startHeartbeatPusher } from "./heartbeat-pusher.js";
import type { HeartbeatPayload, HeartbeatResult } from "./protocol.js";

/**
 * Daemon entry point. Run by `cortex daemon start` (or auto-spawned by
 * the first hook that needs it).
 *
 * v2.0.0: policy.check is currently a stub allowing all calls (real policy
 * evaluation in subsequent commit). telemetry.flush is fully wired — the
 * Stop hook now reliably pushes metrics.json even if MCP died abruptly.
 */

function extractStringFields(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) extractStringFields(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      extractStringFields(v, out);
    }
  }
  return out;
}

async function policyCheck(
  payload: PolicyCheckPayload,
): Promise<PolicyCheckResult> {
  if (!payload.cwd) return { allow: true };
  const contextDir = join(payload.cwd, ".context");
  if (!existsSync(contextDir)) return { allow: true };

  const store = new PolicyStore(contextDir);
  const policies = store.getMergedPolicies();
  if (!isInjectionDefenseActive(policies)) {
    return { allow: true };
  }

  const haystack = extractStringFields(payload.input).join("\n");
  if (!haystack) return { allow: true };

  const result = enforceInjectionPolicy(haystack, policies);
  if (result.allowed) return { allow: true };

  const topMatch = result.scan.matches[0];
  const reason = topMatch
    ? `prompt-injection-defense: ${topMatch.category} (${topMatch.matched.slice(0, 80)})`
    : "prompt-injection-defense: flagged";
  return { allow: false, reason };
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
  // Phase 6: hook heartbeat tracker (per-session activity record + tamper detect).
  const tracker = new HeartbeatTracker();
  async function heartbeat(payload: HeartbeatPayload): Promise<HeartbeatResult> {
    return tracker.recordHeartbeat(payload);
  }

  const daemon = new CortexDaemon({
    onPolicyCheck: policyCheck,
    onTelemetryFlush: telemetryFlush,
    onAuditLog: auditLog,
    onHeartbeat: heartbeat,
  });
  await daemon.start();

  // Phase 5: Tier 3 ungoverned-session detection. Periodic process scan, audit
  // emit per finding, optional SIGTERM in enforced mode (same-user only).
  const scanInterval = parseInt(process.env.CORTEX_UNGOVERNED_SCAN_MS ?? "", 10);
  const intervalMs = Number.isFinite(scanInterval) && scanInterval > 0 ? scanInterval : 60_000;
  if (process.env.CORTEX_DISABLE_UNGOVERNED_SCAN !== "1") {
    startUngovernedScanner({ cwd: process.cwd(), intervalMs });
  }

  // Phase 6: periodic tamper-checker. For each active session that had at
  // least one tool-fired hook then went silent past missing_threshold_seconds,
  // write .cortex-tamper.lock + audit event. The next SessionStart in
  // enforced mode will refuse to register tools until 'cortex enterprise
  // repair' clears the lock.
  const tamperThreshold = parseInt(process.env.CORTEX_TAMPER_MISSING_THRESHOLD_S ?? "", 10);
  const missingThresholdSeconds =
    Number.isFinite(tamperThreshold) && tamperThreshold > 0 ? tamperThreshold : 300;
  const tamperCheckInterval = parseInt(process.env.CORTEX_TAMPER_CHECK_MS ?? "", 10);
  const tamperCheckMs =
    Number.isFinite(tamperCheckInterval) && tamperCheckInterval > 0 ? tamperCheckInterval : 60_000;
  // Phase 7: periodic sync-version-check + host-events push to cortex-web.
  // Daemon runs as the user post-Fas-3 privilege drop, so sync only checks
  // version availability (writes a notification + audit). Re-applying
  // managed-settings still requires 'sudo cortex enterprise sync'.
  const syncIntervalRaw = parseInt(process.env.CORTEX_SYNC_CHECK_MS ?? "", 10);
  const syncIntervalMs =
    Number.isFinite(syncIntervalRaw) && syncIntervalRaw > 0 ? syncIntervalRaw : 60 * 60 * 1000;
  const pushIntervalRaw = parseInt(process.env.CORTEX_HOST_EVENTS_PUSH_MS ?? "", 10);
  const pushIntervalMs =
    Number.isFinite(pushIntervalRaw) && pushIntervalRaw > 0 ? pushIntervalRaw : 5 * 60 * 1000;
  if (process.env.CORTEX_DISABLE_SYNC_CHECK !== "1") {
    startSyncTimer(process.cwd(), syncIntervalMs);
  }
  if (process.env.CORTEX_DISABLE_HOST_EVENTS_PUSH !== "1") {
    startHostEventsPusher(process.cwd(), pushIntervalMs);
  }

  // Govern host heartbeat — fills host_enrollment on cortex-web so the
  // dashboard at /dashboard/govern actually shows this host.
  const heartbeatRaw = parseInt(process.env.CORTEX_HEARTBEAT_PUSH_MS ?? "", 10);
  const heartbeatMs =
    Number.isFinite(heartbeatRaw) && heartbeatRaw > 0 ? heartbeatRaw : 5 * 60 * 1000;
  if (process.env.CORTEX_DISABLE_HEARTBEAT_PUSH !== "1") {
    startHeartbeatPusher(process.cwd(), heartbeatMs);
  }

  // Phase 4 task 19: cortex egress proxy. Logs SNI + destination per
  // outbound connection (no TLS termination). cortex run sets
  // HTTPS_PROXY/HTTP_PROXY for the Copilot wrap; other AI CLIs respect
  // these env vars too if a developer wires them in.
  const proxyPortRaw = parseInt(process.env.CORTEX_EGRESS_PROXY_PORT ?? "", 10);
  const proxyPort = Number.isFinite(proxyPortRaw) && proxyPortRaw > 0 ? proxyPortRaw : 18888;
  if (process.env.CORTEX_DISABLE_EGRESS_PROXY !== "1") {
    startEgressProxy({ cwd: process.cwd(), port: proxyPort })
      .then((handle) => {
        process.stderr.write(
          `[cortex-daemon] egress proxy listening on 127.0.0.1:${handle.port}\n`,
        );
      })
      .catch((err) => {
        process.stderr.write(
          `[cortex-daemon] egress proxy failed to start: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      });
  }

  if (process.env.CORTEX_DISABLE_TAMPER_CHECK !== "1") {
    const checkTimer = setInterval(() => {
      const detected = tracker.detectTamper({
        cwds: [process.cwd()],
        missingThresholdSeconds,
      });
      for (const entry of detected) {
        try {
          writeTamperLock(entry.cwd, entry);
        } catch (err) {
          process.stderr.write(
            `[cortex-daemon] failed to write tamper lock: ${err instanceof Error ? err.message : String(err)}\n`,
          );
        }
        void emitTamperAudit(entry.cwd, entry).catch((err) => {
          process.stderr.write(
            `[cortex-daemon] failed to emit tamper audit: ${err instanceof Error ? err.message : String(err)}\n`,
          );
        });
      }
    }, tamperCheckMs);
    if (typeof checkTimer.unref === "function") checkTimer.unref();
  }
}

main().catch((err) => {
  process.stderr.write(
    `[cortex-daemon] fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
