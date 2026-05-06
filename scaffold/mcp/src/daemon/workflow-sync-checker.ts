import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { loadEnterpriseConfig } from "../core/config.js";
import { workflowDefinitionSchema, type WorkflowDefinition } from "../core/workflow/schemas.js";
import { writeHostAuditEvent } from "./ungoverned-scanner.js";
import { daemonDir } from "./paths.js";

/**
 * Org-workflow sync flow — daemon side.
 *
 * The daemon polls cortex-web /api/v1/govern/workflows/manifest each tick
 * to learn what workflows the org has authored. It diffs against a local
 * state file, fetches changed full definitions, and caches them locally.
 * cortex.workflow.start (and the cortex stage CLI) read the cache via
 * loadSyncedWorkflows() and merge with bundled DEFAULT_WORKFLOWS, with
 * org definitions taking precedence on workflow_id collisions.
 *
 * Three audit outcomes per tick:
 *  - workflows_unchanged   — manifest matches local state
 *  - workflows_synced      — at least one workflow was added / changed /
 *                            removed (metadata: counts)
 *  - workflows_sync_failed — network / auth / parse error
 *
 * Unlike skills, there is no on-disk artifact to write per workflow —
 * the cached JSON is the only product. No "restart Claude Code"
 * notification is needed because workflow lookup happens at run-start.
 */

const STATE_FILENAME = "workflows.local.json";

type ManifestEntry = {
  workflow_id: string;
  version: number;
  updated_at: string;
};

type FetchedWorkflow = {
  workflow_id: string;
  description: string;
  version: number;
  definition: WorkflowDefinition;
  updated_at: string;
};

type LocalWorkflowRecord = {
  workflow_id: string;
  version: number;
  updated_at: string;
  definition: WorkflowDefinition;
};

type LocalWorkflowsState = {
  workflows: Record<string, LocalWorkflowRecord>;
  last_synced_at?: string;
};

export type WorkflowSyncOutcome =
  | { kind: "unchanged"; count: number }
  | {
      kind: "synced";
      added: string[];
      changed: string[];
      removed: string[];
    }
  | { kind: "failed"; error: string };

function stateFilePath(): string {
  return join(daemonDir(), STATE_FILENAME);
}

export function readSyncedWorkflowsState(): LocalWorkflowsState {
  const path = stateFilePath();
  if (!existsSync(path)) return { workflows: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as LocalWorkflowsState;
    return {
      workflows: parsed.workflows ?? {},
      last_synced_at: parsed.last_synced_at,
    };
  } catch {
    return { workflows: {} };
  }
}

function writeSyncedWorkflowsState(state: LocalWorkflowsState): void {
  writeFileSync(
    stateFilePath(),
    JSON.stringify(state, null, 2) + "\n",
    "utf8",
  );
}

async function fetchManifest(
  baseUrl: string,
  apiKey: string,
): Promise<ManifestEntry[]> {
  const url = new URL(
    baseUrl.replace(/\/$/, "") + "/api/v1/govern/workflows/manifest",
  );
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { workflows?: ManifestEntry[] };
  return body.workflows ?? [];
}

async function fetchWorkflow(
  baseUrl: string,
  apiKey: string,
  workflowId: string,
): Promise<FetchedWorkflow> {
  const url = new URL(
    baseUrl.replace(/\/$/, "") +
      "/api/v1/govern/workflows/" +
      encodeURIComponent(workflowId),
  );
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { workflow?: FetchedWorkflow };
  if (!body.workflow) {
    throw new Error(`Response for ${workflowId} missing 'workflow' field`);
  }
  return body.workflow;
}

export async function runWorkflowSyncOnce(
  cwd: string,
): Promise<WorkflowSyncOutcome> {
  const config = loadEnterpriseConfig(join(cwd, ".context"));
  const apiKey = config.enterprise.api_key.trim();
  const baseUrl = (config.enterprise.base_url || config.enterprise.endpoint).trim();
  if (!apiKey || !baseUrl) {
    const outcome: WorkflowSyncOutcome = {
      kind: "failed",
      error: "enterprise not configured",
    };
    await writeAudit(cwd, outcome);
    return outcome;
  }

  let manifest: ManifestEntry[];
  try {
    manifest = await fetchManifest(baseUrl, apiKey);
  } catch (err) {
    const outcome: WorkflowSyncOutcome = {
      kind: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
    await writeAudit(cwd, outcome);
    return outcome;
  }

  const state = readSyncedWorkflowsState();
  const remoteByName = new Map(manifest.map((e) => [e.workflow_id, e]));

  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];

  for (const entry of manifest) {
    const local = state.workflows[entry.workflow_id];
    const isNew = !local;
    const isChanged =
      Boolean(local) &&
      (local.updated_at !== entry.updated_at || local.version !== entry.version);
    if (!isNew && !isChanged) continue;

    let fetched: FetchedWorkflow;
    try {
      fetched = await fetchWorkflow(baseUrl, apiKey, entry.workflow_id);
    } catch (err) {
      const outcome: WorkflowSyncOutcome = {
        kind: "failed",
        error:
          err instanceof Error
            ? `fetch ${entry.workflow_id}: ${err.message}`
            : `fetch ${entry.workflow_id}: ${String(err)}`,
      };
      await writeAudit(cwd, outcome);
      return outcome;
    }

    let validated: WorkflowDefinition;
    try {
      validated = workflowDefinitionSchema.parse(fetched.definition);
    } catch (err) {
      const outcome: WorkflowSyncOutcome = {
        kind: "failed",
        error:
          err instanceof Error
            ? `validate ${entry.workflow_id}: ${err.message}`
            : `validate ${entry.workflow_id}: ${String(err)}`,
      };
      await writeAudit(cwd, outcome);
      return outcome;
    }

    state.workflows[entry.workflow_id] = {
      workflow_id: entry.workflow_id,
      version: fetched.version,
      updated_at: fetched.updated_at,
      definition: validated,
    };
    (isNew ? added : changed).push(entry.workflow_id);
  }

  for (const name of Object.keys(state.workflows)) {
    if (remoteByName.has(name)) continue;
    delete state.workflows[name];
    removed.push(name);
  }

  const totalChanged = added.length + changed.length + removed.length;
  if (totalChanged === 0) {
    const outcome: WorkflowSyncOutcome = {
      kind: "unchanged",
      count: manifest.length,
    };
    await writeAudit(cwd, outcome);
    return outcome;
  }

  state.last_synced_at = new Date().toISOString();
  writeSyncedWorkflowsState(state);
  const outcome: WorkflowSyncOutcome = {
    kind: "synced",
    added,
    changed,
    removed,
  };
  await writeAudit(cwd, outcome);
  return outcome;
}

async function writeAudit(cwd: string, outcome: WorkflowSyncOutcome): Promise<void> {
  const eventBase = {
    timestamp: new Date().toISOString(),
    host_id: hostname(),
  };
  if (outcome.kind === "unchanged") {
    await writeHostAuditEvent(cwd, {
      ...eventBase,
      event_type: "workflows_unchanged",
      count: outcome.count,
    }).catch(() => undefined);
  } else if (outcome.kind === "synced") {
    await writeHostAuditEvent(cwd, {
      ...eventBase,
      event_type: "workflows_synced",
      added: outcome.added,
      changed: outcome.changed,
      removed: outcome.removed,
    }).catch(() => undefined);
  } else {
    await writeHostAuditEvent(cwd, {
      ...eventBase,
      event_type: "workflows_sync_failed",
      error: outcome.error,
    }).catch(() => undefined);
  }
}

export type WorkflowSyncTimerHandle = {
  stop(): void;
};

export function startWorkflowSyncTimer(
  cwd: string,
  intervalMs: number,
): WorkflowSyncTimerHandle {
  const tick = () => {
    void runWorkflowSyncOnce(cwd).catch((err) => {
      process.stderr.write(
        `[cortex-daemon] workflow sync failed: ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
    });
  };

  void Promise.resolve().then(tick);
  const handle = setInterval(tick, intervalMs);
  if (typeof handle.unref === "function") handle.unref();
  return {
    stop() {
      clearInterval(handle);
    },
  };
}
