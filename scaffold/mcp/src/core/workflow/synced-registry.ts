import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { workflowDefinitionSchema, type WorkflowDefinition } from "./schemas.js";

/**
 * Read side of the org-workflow sync cache. The daemon's
 * workflow-sync-checker writes ~/.cortex/workflows.local.json; this
 * module reads it. Kept in core/workflow/ rather than daemon/ so
 * mcp-tools.ts can consult the cache without depending on daemon code.
 *
 * Each entry is validated against workflowDefinitionSchema before being
 * surfaced — if the cache file is corrupt or contains stale shapes from
 * an older daemon, those entries are silently dropped rather than
 * crashing the read.
 */

export const SYNCED_WORKFLOWS_FILENAME = "workflows.local.json";

type LocalWorkflowRecord = {
  workflow_id: string;
  version: number;
  updated_at: string;
  definition: unknown;
};

type LocalWorkflowsState = {
  workflows?: Record<string, LocalWorkflowRecord>;
};

export function syncedWorkflowsCachePath(dir?: string): string {
  return join(dir ?? join(homedir(), ".cortex"), SYNCED_WORKFLOWS_FILENAME);
}

/**
 * Returns the synced org-authored workflows keyed by `workflow_id`.
 * Empty object when the cache is missing, unreadable, malformed, or
 * contains no valid entries. The optional `dir` argument is for tests;
 * production callers leave it unset.
 */
export function loadSyncedWorkflows(
  dir?: string,
): Record<string, WorkflowDefinition> {
  const path = syncedWorkflowsCachePath(dir);
  if (!existsSync(path)) return {};

  let parsed: LocalWorkflowsState;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as LocalWorkflowsState;
  } catch {
    return {};
  }
  const records = parsed.workflows;
  if (!records || typeof records !== "object") return {};

  const out: Record<string, WorkflowDefinition> = {};
  for (const [id, record] of Object.entries(records)) {
    if (!record || typeof record !== "object") continue;
    const result = workflowDefinitionSchema.safeParse(record.definition);
    if (!result.success) continue;
    out[id] = result.data;
  }
  return out;
}
