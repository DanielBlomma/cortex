import { basename, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { hostname, platform, arch } from "node:os";
import {
  loadEnterpriseConfig,
  resolveEnterpriseActivation,
} from "../core/config.js";
import { pushMetrics } from "../enterprise/telemetry/sync.js";
import type { TelemetryMetrics } from "../core/telemetry/collector.js";

/**
 * Smoke-test the telemetry pipeline end-to-end.
 *
 *   $ cortex telemetry test
 *
 * Reads .context/enterprise.yml, builds a synthetic-but-valid metrics
 * payload, sends it to the configured endpoint, and reports the result
 * with actionable diagnostics on failure.
 *
 * This exists because the silent-failure path (push fails, dashboard
 * stays empty, no error surfaces anywhere) was the original v2.0.0
 * motivator. The smoke-test gives users a single command to verify
 * their entire pipeline.
 */

function readMachineId(contextDir: string): string {
  const path = join(contextDir, "telemetry", "machine_id");
  if (existsSync(path)) {
    try {
      const id = readFileSync(path, "utf8").trim();
      if (id) return id;
    } catch {
      // fall through to compute one
    }
  }
  return createHash("sha256")
    .update(`${hostname()}|${platform()}|${arch()}|test`)
    .digest("hex")
    .slice(0, 16);
}

function buildSyntheticMetrics(instanceId: string, version: string): TelemetryMetrics {
  const now = new Date();
  const periodStart = new Date(now.getTime() - 60_000).toISOString();
  const periodEnd = now.toISOString();
  return {
    period_start: periodStart,
    period_end: periodEnd,
    total_tool_calls: 1,
    successful_tool_calls: 1,
    failed_tool_calls: 0,
    total_duration_ms: 100,
    session_starts: 1,
    session_ends: 1,
    session_duration_ms_total: 100,
    searches: 1,
    related_lookups: 0,
    caller_lookups: 0,
    trace_lookups: 0,
    impact_analyses: 0,
    rule_lookups: 0,
    reloads: 0,
    total_results_returned: 1,
    estimated_tokens_saved: 100,
    estimated_tokens_total: 500,
    client_version: version,
    instance_id: instanceId,
    tool_metrics: {
      "telemetry.test": {
        calls: 1,
        failures: 0,
        total_duration_ms: 100,
        total_results_returned: 1,
        estimated_tokens_saved: 100,
      },
    },
  };
}

export async function runTelemetryTest(): Promise<number> {
  const projectRoot = process.env.CORTEX_PROJECT_ROOT?.trim() || process.cwd();
  const contextDir = join(projectRoot, ".context");

  if (!existsSync(contextDir)) {
    console.error(`No .context directory at ${projectRoot}`);
    console.error(`Run 'cortex init --bootstrap' first.`);
    return 1;
  }

  const config = loadEnterpriseConfig(contextDir);
  const activation = resolveEnterpriseActivation(config);

  console.log(`Project:           ${projectRoot}`);
  console.log(`Enterprise active: ${activation.active} (${activation.reason})`);

  if (!activation.active) {
    console.error("");
    console.error("Cannot run telemetry test in community mode.");
    console.error("Configure .context/enterprise.yml with valid api_key + endpoint.");
    return 1;
  }

  if (!config.telemetry.enabled) {
    console.error("");
    console.error("telemetry.enabled is false in enterprise.yml");
    return 1;
  }

  console.log(`Endpoint:          ${config.telemetry.endpoint}`);
  console.log(`API key prefix:    ${config.telemetry.api_key.slice(0, 8)}...`);

  const instanceId = readMachineId(contextDir);
  const version = process.env.CORTEX_VERSION ?? "telemetry-test";
  const metrics = buildSyntheticMetrics(instanceId, version);

  console.log("");
  console.log("Sending synthetic metrics...");

  const start = Date.now();
  const result = await pushMetrics(
    metrics,
    config.telemetry.endpoint,
    config.telemetry.api_key,
    { repo: basename(projectRoot) },
  );
  const elapsed = Date.now() - start;

  if (result.success) {
    console.log("");
    console.log(`✓ Push succeeded in ${elapsed}ms (HTTP ${result.status})`);
    console.log("");
    console.log("Next: open the dashboard. The synthetic event should appear within 60s.");
    console.log("If it does not, the issue is on the server (ingest or read path),");
    console.log("not the client.");
    return 0;
  }

  console.error("");
  console.error(`✗ Push failed after ${elapsed}ms: ${result.error ?? "unknown"}`);
  console.error("");
  if (result.status === 401) {
    console.error("  → API key was rejected. Check that the key in enterprise.yml");
    console.error("    matches a row in cortex-web's api_keys table and is not");
    console.error("    revoked or expired.");
  } else if (result.status === 403) {
    console.error("  → API key lacks 'telemetry' scope. Add the scope in cortex-web.");
  } else if (result.status === 400) {
    console.error("  → Payload schema rejected. Likely a client/server version skew.");
    console.error("    Check telemetryPushSchema vs TelemetryMetrics.");
  } else if (result.status && result.status >= 500) {
    console.error("  → Server error. Check cortex-web logs and DB connectivity.");
  } else {
    console.error("  → Network error. Verify endpoint is reachable from this machine.");
    console.error(`     curl -I ${config.telemetry.endpoint}`);
  }
  return 1;
}
