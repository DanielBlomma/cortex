import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { configuredEnterpriseCredentialId } from "../enterprise-identity.js";
import {
  capabilityDefinitionSchema,
  type CapabilityDefinition,
} from "./capabilities.js";

/**
 * Read side of the org-capability sync cache. The daemon's
 * capability-sync-checker writes ~/.cortex/capabilities.local.json;
 * this module reads it. Kept in core/workflow/ rather than daemon/ so
 * enforcement.ts can consult the cache without depending on daemon code.
 *
 * Each entry is validated against capabilityDefinitionSchema before being
 * surfaced — if the cache file is corrupt or contains stale shapes from
 * an older daemon, those entries are silently dropped rather than
 * crashing the read.
 */

export const SYNCED_CAPABILITIES_FILENAME = "capabilities.local.json";

type LocalCapabilityRecord = {
  capability_name: string;
  updated_at: string;
  definition: unknown;
};

type LocalCapabilitiesState = {
  credential_id?: string;
  capabilities?: Record<string, LocalCapabilityRecord>;
};

export function syncedCapabilitiesCachePath(dir?: string): string {
  return join(dir ?? join(homedir(), ".cortex"), SYNCED_CAPABILITIES_FILENAME);
}

/**
 * Returns the synced org-authored capabilities keyed by capability name.
 * Empty object when the cache is missing, unreadable, malformed, or
 * contains no valid entries. The optional `dir` argument is for tests;
 * production callers leave it unset.
 */
export function loadSyncedCapabilities(
  dir?: string,
  expectedCredentialId?: string,
): Record<string, CapabilityDefinition> {
  const path = syncedCapabilitiesCachePath(dir);
  if (!existsSync(path)) return {};

  let parsed: LocalCapabilitiesState;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as LocalCapabilitiesState;
  } catch {
    return {};
  }
  const requiredCredentialId =
    expectedCredentialId ??
    (dir ? undefined : configuredEnterpriseCredentialId(process.cwd()));
  if (!dir && !requiredCredentialId) {
    return {};
  }
  if (
    requiredCredentialId &&
    parsed.credential_id !== requiredCredentialId
  ) {
    return {};
  }
  const records = parsed.capabilities;
  if (!records || typeof records !== "object") return {};

  const out: Record<string, CapabilityDefinition> = {};
  for (const [name, record] of Object.entries(records)) {
    if (!record || typeof record !== "object") continue;
    const result = capabilityDefinitionSchema.safeParse(record.definition);
    if (!result.success) continue;
    out[name] = result.data;
  }
  return out;
}
