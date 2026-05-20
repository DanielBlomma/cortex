import { DEFAULT_WORKFLOWS } from "./default-workflows.js";
import { loadSyncedWorkflows } from "./synced-registry.js";
import type { WorkflowDefinition } from "./schemas.js";

export type WorkflowSource = "bundled" | "synced" | "injected";

export type WorkflowResolutionWarning = {
  code: "bundled-workflow-fallback";
  workflow_id: string;
  message: string;
  bundled_available: boolean;
  synced_available: boolean;
};

export type WorkflowResolution = {
  workflow: WorkflowDefinition;
  source: WorkflowSource;
  warnings: WorkflowResolutionWarning[];
  bundled_ids: string[];
  synced_ids: string[];
  available_ids: string[];
};

type ResolveWorkflowOptions = {
  registry?: Record<string, WorkflowDefinition>;
  syncedDir?: string;
  emitBundledFallbackWarning?: boolean;
  bundledFallbackPolicy?: "allow" | "warn" | "block";
};

function sortIds(ids: Iterable<string>): string[] {
  return [...ids].sort((left, right) => left.localeCompare(right));
}

function formatIds(ids: string[]): string {
  return ids.length > 0 ? ids.join(", ") : "<none>";
}

export function resolveWorkflowDefinition(
  workflowId: string,
  options: ResolveWorkflowOptions = {},
): WorkflowResolution {
  if (options.registry) {
    const availableIds = sortIds(Object.keys(options.registry));
    const workflow = options.registry[workflowId];
    if (!workflow) {
      throw new Error(
        `Unknown workflow_id: ${workflowId}. Available injected: ${formatIds(availableIds)}`,
      );
    }
    return {
      workflow,
      source: "injected",
      warnings: [],
      bundled_ids: [],
      synced_ids: [],
      available_ids: availableIds,
    };
  }

  const bundled = DEFAULT_WORKFLOWS;
  const synced = loadSyncedWorkflows(options.syncedDir);
  const bundledIds = sortIds(Object.keys(bundled));
  const syncedIds = sortIds(Object.keys(synced));
  const merged = { ...bundled, ...synced };
  const availableIds = sortIds(Object.keys(merged));
  const workflow = merged[workflowId];

  if (!workflow) {
    throw new Error(
      `Unknown workflow_id: ${workflowId}. Available bundled: ${formatIds(bundledIds)}. ` +
        `Available synced: ${formatIds(syncedIds)}. Available all: ${formatIds(availableIds)}`,
    );
  }

  const source: WorkflowSource = Object.prototype.hasOwnProperty.call(synced, workflowId)
    ? "synced"
    : "bundled";
  const warnings: WorkflowResolutionWarning[] = [];
  const fallbackPolicy = options.bundledFallbackPolicy ?? "allow";

  if (source === "bundled" && fallbackPolicy === "block") {
    throw new Error(
      `Workflow "${workflowId}" is only available from the bundled registry, ` +
        "but enforced govern mode requires a synced org workflow. " +
        `Available synced: ${formatIds(syncedIds)}.`,
    );
  }

  if (
    source === "bundled" &&
    (options.emitBundledFallbackWarning || fallbackPolicy === "warn")
  ) {
    warnings.push({
      code: "bundled-workflow-fallback",
      workflow_id: workflowId,
      bundled_available: true,
      synced_available: syncedIds.length > 0,
      message:
        `Workflow "${workflowId}" was resolved from the bundled registry because ` +
        "no synced org workflow with that id exists in the local cache.",
    });
  }

  return {
    workflow,
    source,
    warnings,
    bundled_ids: bundledIds,
    synced_ids: syncedIds,
    available_ids: availableIds,
  };
}
