import { z } from "zod";
import type { OrgPolicy, PolicyStore } from "../../core/policy/store.js";

const CloudPolicySchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(200).optional(),
  kind: z.enum(["predefined", "custom"]).optional(),
  status: z.enum(["draft", "active", "disabled", "archived"]).optional(),
  severity: z.enum(["info", "warning", "error", "block"]).optional(),
  description: z.string().max(1000).default(""),
  priority: z.number().int().min(0).max(1000).default(50),
  scope: z.string().max(200).default("global"),
  enforce: z.boolean().default(true),
  type: z.string().min(1).max(100).nullable().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
});

const CloudResponseSchema = z.object({
  rules: z.array(CloudPolicySchema).default([]),
});

export type SyncResult = {
  success: boolean;
  synced: number;
  source: "cloud" | "local";
  timestamp: string;
  error?: string;
};

let lastSync: SyncResult | null = null;

export type SyncContext = {
  instance_id?: string;
  session_id?: string;
};

export function getLastSync(): SyncResult | null {
  return lastSync;
}

/**
 * Pull org-wide policies from the Cortex Cloud API (connected edition).
 * The actual cloud API is built in Phase 4 — this sends a GET
 * and expects a JSON array of policy objects.
 */
export async function syncFromCloud(
  endpoint: string,
  apiKey: string,
  store: PolicyStore,
  context: SyncContext = {},
): Promise<SyncResult> {
  if (!endpoint || !apiKey) {
    const result: SyncResult = {
      success: false,
      synced: 0,
      source: "cloud",
      timestamp: new Date().toISOString(),
      error: "endpoint or api_key not configured",
    };
    lastSync = result;
    return result;
  }

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "application/json",
        ...(context.instance_id
          ? { "x-cortex-instance-id": context.instance_id }
          : {}),
        ...(context.session_id
          ? { "x-cortex-session-id": context.session_id }
          : {}),
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const result: SyncResult = {
        success: false,
        synced: 0,
        source: "cloud",
        timestamp: new Date().toISOString(),
        error: `HTTP ${response.status}`,
      };
      lastSync = result;
      return result;
    }

    const raw = await response.json();
    const data = CloudResponseSchema.parse(raw);
    const policies: OrgPolicy[] = data.rules.map((r) => ({
      id: r.id,
      title: r.title ?? r.id,
      kind: r.kind ?? null,
      status: r.status ?? "active",
      severity: r.severity ?? "block",
      description: r.description,
      priority: r.priority,
      scope: r.scope,
      enforce: r.enforce,
      type: r.type ?? null,
      config: r.config ?? null,
      source: "org" as const,
    }));

    store.writeOrgPolicies(policies);

    const result: SyncResult = {
      success: true,
      synced: policies.length,
      source: "cloud",
      timestamp: new Date().toISOString(),
    };
    lastSync = result;
    return result;
  } catch (err) {
    const result: SyncResult = {
      success: false,
      synced: 0,
      source: "cloud",
      timestamp: new Date().toISOString(),
      error: err instanceof Error ? err.message : "unknown error",
    };
    lastSync = result;
    return result;
  }
}

/**
 * For air-gapped: just reload from local org-rules.yaml file.
 * Returns the count of policies found.
 */
export function syncFromLocal(store: PolicyStore): SyncResult {
  const policies = store.loadOrgPolicies();
  const result: SyncResult = {
    success: true,
    synced: policies.length,
    source: "local",
    timestamp: new Date().toISOString(),
  };
  lastSync = result;
  return result;
}
