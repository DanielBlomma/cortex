import fs from "node:fs";
import path from "node:path";
import type { SessionCallRecord } from "./plugin.js";

const MIN_CALLS_FOR_CAPTURE = 3;

function sanitizeYamlString(value: string): string {
  return value.replace(/["\\]/g, "\\$&").replace(/\n/g, " ");
}

function topQueries(calls: SessionCallRecord[], limit: number): string[] {
  const queryCount = new Map<string, number>();
  for (const call of calls) {
    if (!call.query) continue;
    queryCount.set(call.query, (queryCount.get(call.query) ?? 0) + 1);
  }
  return [...queryCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([q]) => q);
}

function primaryTopic(calls: SessionCallRecord[]): string {
  const queries = topQueries(calls, 1);
  if (queries.length > 0) {
    const q = queries[0];
    return q.length > 60 ? q.slice(0, 57) + "..." : q;
  }
  const toolCounts = new Map<string, number>();
  for (const call of calls) {
    toolCounts.set(call.tool, (toolCounts.get(call.tool) ?? 0) + 1);
  }
  const topTool = [...toolCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  return topTool ? topTool[0] : "general exploration";
}

export function captureSession(calls: SessionCallRecord[], contextDir: string): boolean {
  if (calls.length < MIN_CALLS_FOR_CAPTURE) {
    return false;
  }

  const topic = primaryTopic(calls);
  const queries = topQueries(calls, 5);
  const totalResults = calls.reduce((sum, c) => sum + c.resultCount, 0);
  const toolSummary = new Map<string, number>();
  for (const call of calls) {
    toolSummary.set(call.tool, (toolSummary.get(call.tool) ?? 0) + 1);
  }

  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dateLabel = now.toISOString().split("T")[0];

  const toolLines = [...toolSummary.entries()]
    .map(([tool, count]) => `${tool}: ${count}`)
    .join(", ");

  const queryLines = queries
    .map((q, i) => `${i + 1}. ${q}`)
    .join("\n");

  const safeTopic = sanitizeYamlString(topic);

  const content = `---
title: "Session ${dateLabel} — ${safeTopic}"
type: note
summary: "${calls.length} tool calls, ${totalResults} results returned. Primary focus: ${safeTopic}"
status: draft
trust_level: 40
updated_at: ${now.toISOString()}
---

## Session Overview

- **Tool calls:** ${calls.length}
- **Results returned:** ${totalResults}
- **Tools used:** ${toolLines}
- **Duration:** ${calls.length > 1 ? timeDiff(calls[0].time, calls[calls.length - 1].time) : "single call"}

## Top Queries

${queryLines || "No text queries recorded."}
`;

  const rawDir = path.join(contextDir, "memory", "raw");
  fs.mkdirSync(rawDir, { recursive: true });
  const filePath = path.join(rawDir, `auto-session-${timestamp}.md`);
  fs.writeFileSync(filePath, content, "utf8");
  return true;
}

function timeDiff(start: string, end: string): string {
  const diffMs = new Date(end).getTime() - new Date(start).getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) return "unknown";
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "<1 min";
  if (mins < 60) return `${mins} min`;
  return `${Math.round(mins / 60)}h ${mins % 60}m`;
}
