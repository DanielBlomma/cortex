import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { loadEnterpriseConfig } from "../core/config.js";
import {
  capabilityDefinitionSchema,
  type CapabilityDefinition,
} from "../core/workflow/capabilities.js";
import { writeHostAuditEvent } from "./ungoverned-scanner.js";
import { daemonDir } from "./paths.js";

/**
 * Org-capability sync flow — daemon side.
 *
 * The daemon polls cortex-web /api/v1/govern/capabilities/manifest each
 * tick to learn what capabilities the org has authored. It diffs against
 * a local state file, fetches changed full definitions, and caches them
 * locally. The pre-tool-use hook's evaluateToolCall consults the merged
 * registry via loadSyncedCapabilities() with synced taking precedence
 * over bundled DEFAULT_CAPABILITIES on name collisions.
 *
 * Three audit outcomes per tick:
 *  - capabilities_unchanged   — manifest matches local state
 *  - capabilities_synced      — at least one capability was added /
 *                               changed / removed (metadata: counts)
 *  - capabilities_sync_failed — network / auth / parse error
 */

const STATE_FILENAME = "capabilities.local.json";

type ManifestEntry = {
  capability_name: string;
  updated_at: string;
};

type FetchedCapability = {
  capability_name: string;
  description: string;
  definition: CapabilityDefinition;
  updated_at: string;
};

type LocalCapabilityRecord = {
  capability_name: string;
  updated_at: string;
  definition: CapabilityDefinition;
};

type LocalCapabilitiesState = {
  capabilities: Record<string, LocalCapabilityRecord>;
  last_synced_at?: string;
};

export type CapabilitySyncOutcome =
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

function readSyncedCapabilitiesState(): LocalCapabilitiesState {
  const path = stateFilePath();
  if (!existsSync(path)) return { capabilities: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as LocalCapabilitiesState;
    return {
      capabilities: parsed.capabilities ?? {},
      last_synced_at: parsed.last_synced_at,
    };
  } catch {
    return { capabilities: {} };
  }
}

function writeSyncedCapabilitiesState(state: LocalCapabilitiesState): void {
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
    baseUrl.replace(/\/$/, "") + "/api/v1/govern/capabilities/manifest",
  );
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { capabilities?: ManifestEntry[] };
  return body.capabilities ?? [];
}

async function fetchCapability(
  baseUrl: string,
  apiKey: string,
  capabilityName: string,
): Promise<FetchedCapability> {
  const url = new URL(
    baseUrl.replace(/\/$/, "") +
      "/api/v1/govern/capabilities/" +
      encodeURIComponent(capabilityName),
  );
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { capability?: FetchedCapability };
  if (!body.capability) {
    throw new Error(`Response for ${capabilityName} missing 'capability' field`);
  }
  return body.capability;
}

export async function runCapabilitySyncOnce(
  cwd: string,
): Promise<CapabilitySyncOutcome> {
  const config = loadEnterpriseConfig(join(cwd, ".context"));
  const apiKey = config.enterprise.api_key.trim();
  const baseUrl = (config.enterprise.base_url || config.enterprise.endpoint).trim();
  if (!apiKey || !baseUrl) {
    const outcome: CapabilitySyncOutcome = {
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
    const outcome: CapabilitySyncOutcome = {
      kind: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
    await writeAudit(cwd, outcome);
    return outcome;
  }

  const state = readSyncedCapabilitiesState();
  const remoteByName = new Map(manifest.map((e) => [e.capability_name, e]));

  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];

  for (const entry of manifest) {
    const local = state.capabilities[entry.capability_name];
    const isNew = !local;
    const isChanged =
      Boolean(local) && local.updated_at !== entry.updated_at;
    if (!isNew && !isChanged) continue;

    let fetched: FetchedCapability;
    try {
      fetched = await fetchCapability(baseUrl, apiKey, entry.capability_name);
    } catch (err) {
      const outcome: CapabilitySyncOutcome = {
        kind: "failed",
        error:
          err instanceof Error
            ? `fetch ${entry.capability_name}: ${err.message}`
            : `fetch ${entry.capability_name}: ${String(err)}`,
      };
      await writeAudit(cwd, outcome);
      return outcome;
    }

    let validated: CapabilityDefinition;
    try {
      validated = capabilityDefinitionSchema.parse(fetched.definition);
    } catch (err) {
      const outcome: CapabilitySyncOutcome = {
        kind: "failed",
        error:
          err instanceof Error
            ? `validate ${entry.capability_name}: ${err.message}`
            : `validate ${entry.capability_name}: ${String(err)}`,
      };
      await writeAudit(cwd, outcome);
      return outcome;
    }

    state.capabilities[entry.capability_name] = {
      capability_name: entry.capability_name,
      updated_at: fetched.updated_at,
      definition: validated,
    };
    (isNew ? added : changed).push(entry.capability_name);
  }

  for (const name of Object.keys(state.capabilities)) {
    if (remoteByName.has(name)) continue;
    delete state.capabilities[name];
    removed.push(name);
  }

  const totalChanged = added.length + changed.length + removed.length;
  if (totalChanged === 0) {
    const outcome: CapabilitySyncOutcome = {
      kind: "unchanged",
      count: manifest.length,
    };
    await writeAudit(cwd, outcome);
    return outcome;
  }

  state.last_synced_at = new Date().toISOString();
  writeSyncedCapabilitiesState(state);
  const outcome: CapabilitySyncOutcome = {
    kind: "synced",
    added,
    changed,
    removed,
  };
  await writeAudit(cwd, outcome);
  return outcome;
}

async function writeAudit(cwd: string, outcome: CapabilitySyncOutcome): Promise<void> {
  const eventBase = {
    timestamp: new Date().toISOString(),
    host_id: hostname(),
  };
  if (outcome.kind === "unchanged") {
    await writeHostAuditEvent(cwd, {
      ...eventBase,
      event_type: "capabilities_unchanged",
      count: outcome.count,
    }).catch(() => undefined);
  } else if (outcome.kind === "synced") {
    await writeHostAuditEvent(cwd, {
      ...eventBase,
      event_type: "capabilities_synced",
      added: outcome.added,
      changed: outcome.changed,
      removed: outcome.removed,
    }).catch(() => undefined);
  } else {
    await writeHostAuditEvent(cwd, {
      ...eventBase,
      event_type: "capabilities_sync_failed",
      error: outcome.error,
    }).catch(() => undefined);
  }
}

export type CapabilitySyncTimerHandle = {
  stop(): void;
};

export function startCapabilitySyncTimer(
  cwd: string,
  intervalMs: number,
): CapabilitySyncTimerHandle {
  const tick = () => {
    void runCapabilitySyncOnce(cwd).catch((err) => {
      process.stderr.write(
        `[cortex-daemon] capability sync failed: ${
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
