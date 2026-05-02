import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { TelemetryCollector } from "../dist/core/telemetry/collector.js";

function createContextDir(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

test("TelemetryCollector counts context.impact as an impact analysis", () => {
  const contextDir = createContextDir("cortex-telemetry-");
  const collector = new TelemetryCollector(contextDir, "test-version");

  collector.recordEvent({
    tool: "context.impact",
    phase: "success",
    result_count: 2,
    estimated_tokens_saved: 800,
    duration_ms: 15,
  });

  const metrics = collector.getMetrics();
  assert.equal(metrics.total_tool_calls, 1);
  assert.equal(metrics.successful_tool_calls, 1);
  assert.equal(metrics.impact_analyses, 1);
  assert.equal(metrics.tool_metrics["context.impact"].calls, 1);
});
