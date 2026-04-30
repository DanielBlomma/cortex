import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  loadEnterpriseConfig,
  resolveEnterpriseActivation,
  type EnterpriseConfig,
} from "../core/config.js";
import { deployBundledModel } from "./model/deploy.js";
import { TelemetryCollector } from "../core/telemetry/collector.js";
import { pushMetrics } from "./telemetry/sync.js";
import { AuditWriter, type AuditEntry } from "../core/audit/writer.js";
import { pushAuditEvents, queueAuditEvent, setAuditPushContext } from "./audit/push.js";
import { PolicyStore } from "../core/policy/store.js";
import { syncFromCloud, syncFromLocal } from "./policy/sync.js";
import { registerEnterpriseTools } from "./tools/enterprise.js";
import { pushViolations, setViolationPushContext } from "./violations/push.js";
import { pushReviewResults, setReviewPushContext } from "./reviews/push.js";
import { setWorkflowPushContext } from "./workflow/push.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

export const name = "cortex-enterprise";
export const version: string = pkg.version;

const timers: NodeJS.Timeout[] = [];
let activeCollector: TelemetryCollector | null = null;
let activeConfig: EnterpriseConfig | null = null;
let activeAuditWriter: AuditWriter | null = null;
let activeInstanceId: string | null = null;
let activeSessionId: string | null = null;
let activeRepo: string | null = null;

async function flushComplianceQueues(
  config: EnterpriseConfig,
  reason: "periodic" | "shutdown",
): Promise<void> {
  if (!config.policy.endpoint || !config.policy.api_key) return;

  try {
    const result = await pushAuditEvents(config.policy.endpoint, config.policy.api_key);
    if (!result.success) {
      process.stderr.write(`[cortex-enterprise] ${reason} audit push failed: ${result.error}\n`);
    }
  } catch (err) {
    process.stderr.write(`[cortex-enterprise] ${reason} audit push error: ${err}\n`);
  }

  try {
    const result = await pushViolations(config.policy.endpoint, config.policy.api_key);
    if (!result.success) {
      process.stderr.write(`[cortex-enterprise] ${reason} violations push failed: ${result.error}\n`);
    }
  } catch (err) {
    process.stderr.write(`[cortex-enterprise] ${reason} violations push error: ${err}\n`);
  }

  try {
    const result = await pushReviewResults(config.policy.endpoint, config.policy.api_key);
    if (!result.success) {
      process.stderr.write(`[cortex-enterprise] ${reason} reviews push failed: ${result.error}\n`);
    }
  } catch (err) {
    process.stderr.write(`[cortex-enterprise] ${reason} reviews push error: ${err}\n`);
  }
}

type ToolExecutionEvent = {
  phase: "start" | "success" | "error";
  tool: string;
  timestamp: string;
  input: Record<string, unknown>;
  query?: string;
  query_length?: number;
  result_count?: number;
  estimated_tokens_saved?: number;
  entities_returned?: string[];
  rules_applied?: string[];
  duration_ms?: number;
  error?: string;
};

type SessionCallRecord = {
  tool: string;
  query?: string;
  resultCount: number;
  time: string;
  outcome?: "success" | "error";
  duration_ms?: number;
  error?: string;
};

type SessionEvent = {
  phase: "start" | "end";
  timestamp: string;
  duration_ms?: number;
  tool_calls?: number;
  successful_tool_calls?: number;
  failed_tool_calls?: number;
  calls?: SessionCallRecord[];
};

export function shutdown(): void {
  for (const t of timers) clearInterval(t);
  timers.length = 0;
  activeCollector = null;
  activeConfig = null;
  activeAuditWriter = null;
  activeInstanceId = null;
  activeSessionId = null;
  activeRepo = null;
  setAuditPushContext({});
  setViolationPushContext({});
  setReviewPushContext({});
  setWorkflowPushContext({});
}

/**
 * Telemetry hook called by cortex core after each tool execution.
 * Wired up via the CortexPlugin.onToolCall interface.
 */
export function onToolCall(toolName: string, resultCount: number, tokensSaved: number): void {
  activeCollector?.record(toolName, resultCount, tokensSaved);
}

export function onToolEvent(event: ToolExecutionEvent): void {
  if (event.phase === "success" || event.phase === "error") {
    activeCollector?.recordEvent({
      tool: event.tool,
      phase: event.phase,
      result_count: event.result_count,
      estimated_tokens_saved: event.estimated_tokens_saved,
      duration_ms: event.duration_ms,
    });
  }

  if ((event.phase === "success" || event.phase === "error") && activeAuditWriter) {
      activeAuditWriter.log({
        timestamp: event.timestamp,
        tool: event.tool,
        input: event.input,
        result_count: event.result_count ?? 0,
      entities_returned: event.entities_returned ?? [],
      rules_applied: event.rules_applied ?? [],
        duration_ms: event.duration_ms ?? 0,
        status: event.phase,
        error: event.error,
        event_type: "tool_call",
        evidence_level: "diagnostic",
        resource_type: "context_tool",
        repo: activeRepo ?? undefined,
        instance_id: activeInstanceId ?? undefined,
        session_id: activeSessionId ?? undefined,
        metadata:
          event.query_length !== undefined
            ? {
                query_present: true,
                query_length: event.query_length,
              }
            : undefined,
      });
    }
  }

/**
 * Unified entry point for enterprise-tool activity. Replaces the previous
 * `auditWriter.log({...})` pattern: records the same audit entry AND bumps
 * the telemetry collector so dashboard counters move. Callers pass the
 * existing audit-shape object plus an optional `tokens_saved` (defaults 0).
 */
export type ToolActivity = AuditEntry & {
  tokens_saved?: number;
};

export function recordToolActivity(activity: ToolActivity): void {
  const status = activity.status ?? "success";

  activeAuditWriter?.log({
    ...activity,
    status,
    repo: activity.repo ?? activeRepo ?? undefined,
    instance_id: activity.instance_id ?? activeInstanceId ?? undefined,
    session_id: activity.session_id ?? activeSessionId ?? undefined,
  });

  activeCollector?.recordEvent({
    tool: activity.tool,
    phase: status,
    result_count: activity.result_count,
    estimated_tokens_saved: activity.tokens_saved ?? 0,
    duration_ms: activity.duration_ms,
  });
}

/**
 * Session-end hook called by cortex core on shutdown.
 * Awaited with a timeout — this is the reliable telemetry push path.
 */
export async function onSessionEnd(): Promise<void> {
  if (!activeConfig) return;
  const config = activeConfig;
  if (config.telemetry.enabled && config.telemetry.endpoint && activeCollector) {
    activeCollector.flush();
    try {
      const result = await pushMetrics(
        activeCollector.getMetrics(),
        config.telemetry.endpoint,
        config.telemetry.api_key,
        { session_id: activeSessionId ?? undefined },
      );
      if (!result.success) {
        process.stderr.write(`[cortex-enterprise] Shutdown telemetry push failed: ${result.error}\n`);
      }
    } catch (err) {
      process.stderr.write(`[cortex-enterprise] Shutdown telemetry push error: ${err}\n`);
    }
  }

  await flushComplianceQueues(config, "shutdown");
}

export async function onSessionEvent(event: SessionEvent): Promise<void> {
  if (event.phase === "start") {
    activeCollector?.recordSessionStart();
    return;
  }

  if (event.phase === "end") {
    activeCollector?.recordSessionEnd(event.duration_ms ?? 0);
    if (activeAuditWriter) {
      activeAuditWriter.log({
        timestamp: event.timestamp,
        tool: "session.summary",
        input: {
          tool_calls: event.tool_calls ?? 0,
          successful_tool_calls: event.successful_tool_calls ?? 0,
          failed_tool_calls: event.failed_tool_calls ?? 0,
        },
        result_count: event.tool_calls ?? 0,
        entities_returned: [],
        rules_applied: [],
        duration_ms: event.duration_ms ?? 0,
        status: "success",
        event_type: "session",
        evidence_level: "diagnostic",
        resource_type: "session",
        repo: activeRepo ?? undefined,
        instance_id: activeInstanceId ?? undefined,
        session_id: activeSessionId ?? undefined,
      });
    }
  }
}

export async function register(server: McpServer): Promise<void> {
  const projectRoot = process.env.CORTEX_PROJECT_ROOT?.trim() || process.cwd();
  const contextDir = path.join(projectRoot, ".context");

  const config = loadEnterpriseConfig(contextDir);
  const activation = resolveEnterpriseActivation(config);
  if (!activation.active) {
    process.stderr.write(
      `[cortex-enterprise] cloud features inactive: ${activation.reason}\n`
    );
  }

  activeConfig = config;

  // Deploy bundled embedding model if not already cached
  const modelDeployed = deployBundledModel(contextDir);
  if (modelDeployed) {
    process.stderr.write(`[cortex-enterprise] Bundled embedding model deployed\n`);
  }

  // Initialize subsystems
  const collector = new TelemetryCollector(contextDir, version);
  activeCollector = collector;
  activeInstanceId = collector.getMetrics().instance_id;
  activeSessionId = randomUUID();
  activeRepo = path.basename(projectRoot);
  const auditWriter = config.audit.enabled
    ? new AuditWriter(contextDir, {
        onEntry(entry) {
          queueAuditEvent(entry);
        },
      })
    : null;
  activeAuditWriter = auditWriter;
  const policyStore = new PolicyStore(contextDir);

  setAuditPushContext({
    repo: activeRepo ?? undefined,
    instance_id: activeInstanceId ?? undefined,
    session_id: activeSessionId ?? undefined,
  });
  setViolationPushContext({
    repo: activeRepo ?? undefined,
    instance_id: activeInstanceId ?? undefined,
    session_id: activeSessionId ?? undefined,
  });
  setReviewPushContext({
    repo: activeRepo ?? undefined,
    instance_id: activeInstanceId ?? undefined,
    session_id: activeSessionId ?? undefined,
  });
  setWorkflowPushContext({
    repo: activeRepo ?? undefined,
    instance_id: activeInstanceId ?? undefined,
    session_id: activeSessionId ?? undefined,
  });

  // Initial policy sync
  if (config.policy.enabled) {
    if (config.policy.endpoint && config.policy.api_key) {
      await syncFromCloud(config.policy.endpoint, config.policy.api_key, policyStore, {
        instance_id: activeInstanceId ?? undefined,
        session_id: activeSessionId ?? undefined,
      });
      process.stderr.write(`[cortex-enterprise] Policy sync: cloud\n`);
    } else {
      syncFromLocal(policyStore);
      const orgCount = policyStore.loadOrgPolicies().length;
      if (orgCount > 0) {
        process.stderr.write(`[cortex-enterprise] Policy sync: ${orgCount} org rules loaded\n`);
      }
    }
  }

  registerEnterpriseTools(server, collector, auditWriter, config, contextDir, policyStore, version);

  // v2.0.0: globalThis.__cortexContextToolHook bridge removed.
  // Enterprise is now in-process with cortex-mcp; tool events flow via
  // plugin.ts's onToolEvent hook directly through activation.ts.

  process.stderr.write(`[cortex-enterprise] v${version}\n`);

  // Log active features
  const features: string[] = [];
  if (config.telemetry.enabled) features.push("telemetry");
  if (config.audit.enabled) features.push("audit");
  if (config.policy.enabled) features.push("policy");
  if (config.rbac.enabled) features.push(`rbac(${config.rbac.default_role})`);
  if (features.length > 0) {
    process.stderr.write(`[cortex-enterprise] Active: ${features.join(", ")}\n`);
  }

  // Schedule telemetry flush + push
  if (config.telemetry.enabled) {
    // Push any accumulated metrics from previous sessions on startup
    if (config.telemetry.endpoint) {
      pushMetrics(collector.getMetrics(), config.telemetry.endpoint, config.telemetry.api_key, {
        session_id: activeSessionId ?? undefined,
      })
        .then((r) => { if (!r.success) process.stderr.write(`[cortex-enterprise] Startup telemetry push failed: ${r.error}\n`); })
        .catch((err) => { process.stderr.write(`[cortex-enterprise] Startup telemetry push error: ${err}\n`); });
    }

    const intervalMs = config.telemetry.interval_minutes * 60000;
    const timer = setInterval(async () => {
      try {
        collector.flush();
        if (config.telemetry.endpoint) {
          await pushMetrics(collector.getMetrics(), config.telemetry.endpoint, config.telemetry.api_key, {
            session_id: activeSessionId ?? undefined,
          });
        }
      } catch (err) {
        process.stderr.write(`[cortex-enterprise] Telemetry flush error: ${err}\n`);
      }
    }, intervalMs);
    timer.unref();
    timers.push(timer);
  }

  // Schedule compliance queue flushes independently from telemetry so
  // policy evidence is still delivered when metrics collection is off.
  if (config.policy.enabled && config.policy.endpoint && config.policy.api_key) {
    const intervalMs =
      (config.telemetry.enabled
        ? config.telemetry.interval_minutes
        : config.policy.sync_interval_minutes) * 60000;
    const timer = setInterval(async () => {
      await flushComplianceQueues(config, "periodic");
    }, intervalMs);
    timer.unref();
    timers.push(timer);
  }

  // Schedule policy sync
  if (config.policy.enabled && config.policy.endpoint && config.policy.api_key) {
    const intervalMs = config.policy.sync_interval_minutes * 60000;
    const timer = setInterval(async () => {
      try {
        await syncFromCloud(config.policy.endpoint, config.policy.api_key, policyStore, {
          instance_id: activeInstanceId ?? undefined,
          session_id: activeSessionId ?? undefined,
        });
      } catch (err) {
        process.stderr.write(`[cortex-enterprise] Policy sync error: ${err}\n`);
      }
    }, intervalMs);
    timer.unref();
    timers.push(timer);
  }

}
