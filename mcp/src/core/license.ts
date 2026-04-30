import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export type LicenseVerification =
  | {
      valid: true;
      edition: string;
      features: string[];
      expires_at: string;
      max_repos: number;
      verified_at: string;
      source: "remote" | "cache";
    }
  | {
      valid: false;
      reason: string;
      verified_at: string;
      source: "remote" | "cache" | "grace_expired";
    };

type CacheEntry = {
  result: LicenseVerification;
  // ISO timestamp for cache freshness window
  cached_at: string;
};

const CACHE_FILE = "license_cache.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h fresh
const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7d grace if endpoint unreachable
const REQUEST_TIMEOUT_MS = 5000;

function cachePath(contextDir: string): string {
  return join(contextDir, "telemetry", CACHE_FILE);
}

function readCache(contextDir: string): CacheEntry | null {
  const path = cachePath(contextDir);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as CacheEntry;
  } catch {
    return null;
  }
}

function writeCache(contextDir: string, entry: CacheEntry): void {
  const path = cachePath(contextDir);
  try {
    mkdirSync(join(contextDir, "telemetry"), { recursive: true });
    writeFileSync(path, JSON.stringify(entry, null, 2), "utf8");
  } catch {
    // Cache failures are non-fatal — license check just won't be cached.
  }
}

function ageMs(isoTimestamp: string): number {
  return Date.now() - new Date(isoTimestamp).getTime();
}

async function fetchLicense(
  endpoint: string,
  apiKey: string,
  instanceId: string | undefined,
  clientVersion: string | undefined,
): Promise<LicenseVerification | null> {
  const url = `${endpoint.replace(/\/$/, "")}/api/v1/license/verify`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        instance_id: instanceId,
        client_version: clientVersion,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      // 401/429/5xx — treat as transient, surface null so caller can fall back.
      return null;
    }

    const json = (await res.json()) as Record<string, unknown>;
    const verifiedAt = new Date().toISOString();

    if (json.valid === true) {
      return {
        valid: true,
        edition: String(json.edition ?? "unknown"),
        features: Array.isArray(json.features) ? json.features.map(String) : [],
        expires_at: String(json.expires_at ?? ""),
        max_repos: typeof json.max_repos === "number" ? json.max_repos : 0,
        verified_at: verifiedAt,
        source: "remote",
      };
    }

    return {
      valid: false,
      reason: String(json.reason ?? "unknown"),
      verified_at: verifiedAt,
      source: "remote",
    };
  } catch {
    // Network error, timeout, JSON parse error — treat as transient.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Verify the license for the given api_key. Layered fallback:
 *   1. If cache is fresh (<24h) → use cache
 *   2. Otherwise try remote endpoint
 *      - On success → write cache, return result
 *      - On transient failure → fall back to cache if within grace period (7d)
 *   3. If no usable cache and endpoint unreachable → return invalid (grace_expired)
 *
 * The caller decides what to do based on the result. Typically:
 *   - valid:true  → activate enterprise hooks
 *   - valid:false → community mode (no enterprise)
 */
export async function verifyLicense(
  contextDir: string,
  endpoint: string,
  apiKey: string,
  options: { instance_id?: string; client_version?: string } = {},
): Promise<LicenseVerification> {
  const cached = readCache(contextDir);

  // Fresh cache: skip remote.
  if (cached && ageMs(cached.cached_at) < CACHE_TTL_MS) {
    return { ...cached.result, source: "cache" };
  }

  const remote = await fetchLicense(
    endpoint,
    apiKey,
    options.instance_id,
    options.client_version,
  );

  if (remote) {
    writeCache(contextDir, {
      result: remote,
      cached_at: new Date().toISOString(),
    });
    return remote;
  }

  // Remote failed. Fall back to cache if within grace period.
  if (cached && ageMs(cached.cached_at) < GRACE_PERIOD_MS) {
    return { ...cached.result, source: "cache" };
  }

  return {
    valid: false,
    reason: "endpoint_unreachable_grace_expired",
    verified_at: new Date().toISOString(),
    source: "grace_expired",
  };
}
