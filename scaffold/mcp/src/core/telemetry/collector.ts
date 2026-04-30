import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { hostname, platform, arch } from "node:os";
import { join } from "node:path";

export type TelemetryMetrics = {
  period_start: string;
  period_end: string;
  total_tool_calls: number;
  successful_tool_calls: number;
  failed_tool_calls: number;
  total_duration_ms: number;
  session_starts: number;
  session_ends: number;
  session_duration_ms_total: number;
  searches: number;
  related_lookups: number;
  caller_lookups: number;
  trace_lookups: number;
  impact_analyses: number;
  rule_lookups: number;
  reloads: number;
  total_results_returned: number;
  estimated_tokens_saved: number;
  estimated_tokens_total: number;
  client_version: string;
  instance_id: string;
  tool_metrics: Record<string, {
    calls: number;
    failures: number;
    total_duration_ms: number;
    total_results_returned: number;
    estimated_tokens_saved: number;
  }>;
};

const AVG_TOKENS_PER_RESULT = 400;

function generateInstanceId(contextDir: string): string {
  const idPath = join(contextDir, "telemetry", "machine_id");
  if (existsSync(idPath)) {
    try {
      const existing = readFileSync(idPath, "utf8").trim();
      if (existing.length > 0) return existing;
    } catch (err) {
      process.stderr.write(`[cortex-enterprise] machine_id exists but is unreadable: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
  // Note: hostname|platform|arch may collide on machines with identical defaults.
  // Consider adding a random salt if fleet-wide uniqueness is critical.
  const fingerprint = `${hostname()}|${platform()}|${arch()}`;
  const id = createHash("sha256").update(fingerprint).digest("hex").slice(0, 16);
  try {
    mkdirSync(join(contextDir, "telemetry"), { recursive: true });
    writeFileSync(idPath, id, "utf8");
  } catch (err) {
    process.stderr.write(`[cortex-enterprise] Could not persist instance id: ${err instanceof Error ? err.message : String(err)}\n`);
  }
  return id;
}

function emptyMetrics(clientVersion: string, instanceId: string): TelemetryMetrics {
  const now = new Date().toISOString();
  return {
    period_start: now,
    period_end: now,
    total_tool_calls: 0,
    successful_tool_calls: 0,
    failed_tool_calls: 0,
    total_duration_ms: 0,
    session_starts: 0,
    session_ends: 0,
    session_duration_ms_total: 0,
    searches: 0,
    related_lookups: 0,
    caller_lookups: 0,
    trace_lookups: 0,
    impact_analyses: 0,
    rule_lookups: 0,
    reloads: 0,
    total_results_returned: 0,
    estimated_tokens_saved: 0,
    estimated_tokens_total: 0,
    client_version: clientVersion,
    instance_id: instanceId,
    tool_metrics: {},
  };
}

export type TelemetryEvent = {
  tool: string;
  phase: "success" | "error";
  result_count?: number;
  estimated_tokens_saved?: number;
  duration_ms?: number;
};

export class TelemetryCollector {
  private metrics: TelemetryMetrics;
  private readonly metricsPath: string;
  private readonly clientVersion: string;
  private readonly instanceId: string;
  private dirty = false;

  constructor(contextDir: string, clientVersion = "unknown") {
    this.clientVersion = clientVersion;
    this.instanceId = generateInstanceId(contextDir);
    const telemetryDir = join(contextDir, "telemetry");
    this.metricsPath = join(telemetryDir, "metrics.json");

    // Load existing metrics or start fresh
    try {
      const raw = readFileSync(this.metricsPath, "utf8");
      this.metrics = JSON.parse(raw);
      this.metrics.client_version = clientVersion;
      this.metrics.instance_id = this.instanceId;
    } catch {
      this.metrics = emptyMetrics(clientVersion, this.instanceId);
    }
  }

  private bucket(toolName: string) {
    if (!this.metrics.tool_metrics[toolName]) {
      this.metrics.tool_metrics[toolName] = {
        calls: 0,
        failures: 0,
        total_duration_ms: 0,
        total_results_returned: 0,
        estimated_tokens_saved: 0,
      };
    }
    return this.metrics.tool_metrics[toolName];
  }

  recordEvent(event: TelemetryEvent): void {
    const resultCount = event.result_count ?? 0;
    const tokensSaved = event.estimated_tokens_saved ?? 0;
    const durationMs = event.duration_ms ?? 0;
    const toolBucket = this.bucket(event.tool);

    this.metrics.total_tool_calls++;
    this.metrics.total_duration_ms += durationMs;
    this.metrics.period_end = new Date().toISOString();

    toolBucket.calls++;
    toolBucket.total_duration_ms += durationMs;

    if (event.phase === "error") {
      this.metrics.failed_tool_calls++;
      toolBucket.failures++;
      this.dirty = true;
      return;
    }

    this.metrics.successful_tool_calls++;

    switch (event.tool) {
      case "context.search":
        this.metrics.searches++;
        break;
      case "context.get_related":
        this.metrics.related_lookups++;
        break;
      case "context.find_callers":
        this.metrics.caller_lookups++;
        break;
      case "context.trace_calls":
        this.metrics.trace_lookups++;
        break;
      case "context.impact_analysis":
        this.metrics.impact_analyses++;
        break;
      case "context.get_rules":
        this.metrics.rule_lookups++;
        break;
      case "context.reload":
        this.metrics.reloads++;
        break;
    }

    this.metrics.total_results_returned += resultCount;
    this.metrics.estimated_tokens_saved += tokensSaved;
    this.metrics.estimated_tokens_total += tokensSaved + resultCount * AVG_TOKENS_PER_RESULT;

    toolBucket.total_results_returned += resultCount;
    toolBucket.estimated_tokens_saved += tokensSaved;
    this.dirty = true;
  }

  record(toolName: string, resultCount: number, tokensSaved: number): void {
    this.recordEvent({
      tool: toolName,
      phase: "success",
      result_count: resultCount,
      estimated_tokens_saved: tokensSaved,
      duration_ms: 0,
    });
  }

  recordSessionStart(): void {
    this.metrics.session_starts++;
    this.metrics.period_end = new Date().toISOString();
    this.dirty = true;
  }

  recordSessionEnd(durationMs: number): void {
    this.metrics.session_ends++;
    this.metrics.session_duration_ms_total += Math.max(0, durationMs);
    this.metrics.period_end = new Date().toISOString();
    this.dirty = true;
  }

  getMetrics(): TelemetryMetrics {
    return { ...this.metrics };
  }

  flush(): void {
    if (!this.dirty) return;

    try {
      const dir = join(this.metricsPath, "..");
      mkdirSync(dir, { recursive: true });
      writeFileSync(this.metricsPath, JSON.stringify(this.metrics, null, 2));
      this.dirty = false;
    } catch {
      process.stderr.write("[cortex-enterprise] Failed to flush telemetry metrics\n");
    }
  }

  reset(): void {
    this.metrics = emptyMetrics(this.clientVersion, this.instanceId);
    this.dirty = true;
  }
}
