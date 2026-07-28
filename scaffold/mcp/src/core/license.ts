import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { resolveTelemetryStateDir, telemetryStatePath } from "./telemetry/state-dir.js";
import { isAllowedEnterpriseEndpoint } from "./secure-endpoint.js";

export { isAllowedEnterpriseEndpoint as isAllowedLicenseEndpoint };

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
  version: 2;
  endpoint: string;
  api_key_sha256: string;
  result: LicenseVerification;
  // ISO timestamp for cache freshness window
  cached_at: string;
};

const CACHE_FILE = "license_cache.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h fresh
const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7d grace if endpoint unreachable
const REQUEST_TIMEOUT_MS = 5000;

function cachePath(contextDir: string): string {
  return telemetryStatePath(contextDir, CACHE_FILE);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function readCache(contextDir: string): CacheEntry | null {
  const path = cachePath(contextDir);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<CacheEntry>;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.version !== 2 ||
      typeof parsed.endpoint !== "string" ||
      !parsed.endpoint ||
      typeof parsed.api_key_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(parsed.api_key_sha256) ||
      !parsed.result ||
      typeof parsed.result !== "object" ||
      typeof parsed.result.valid !== "boolean" ||
      !isIsoTimestamp(parsed.cached_at)
    ) {
      deleteCache(contextDir);
      return null;
    }
    if (parsed.result.valid) {
      if (
        typeof parsed.result.edition !== "string" ||
        !Array.isArray(parsed.result.features) ||
        !parsed.result.features.every((feature) => typeof feature === "string") ||
        !isIsoTimestamp(parsed.result.expires_at) ||
        typeof parsed.result.max_repos !== "number" ||
        !Number.isFinite(parsed.result.max_repos) ||
        parsed.result.max_repos < 0 ||
        !isIsoTimestamp(parsed.result.verified_at) ||
        !["remote", "cache"].includes(parsed.result.source)
      ) {
        deleteCache(contextDir);
        return null;
      }
    } else if (
      typeof parsed.result.reason !== "string" ||
      !isIsoTimestamp(parsed.result.verified_at) ||
      !["remote", "cache", "grace_expired"].includes(parsed.result.source)
    ) {
      deleteCache(contextDir);
      return null;
    }
    return parsed as CacheEntry;
  } catch {
    deleteCache(contextDir);
    return null;
  }
}

function writeCache(contextDir: string, entry: CacheEntry): void {
  const path = cachePath(contextDir);
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    mkdirSync(resolveTelemetryStateDir(contextDir), { recursive: true });
    writeFileSync(
      temporaryPath,
      JSON.stringify(entry, null, 2) + "\n",
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, path);
    chmodSync(path, 0o600);
  } catch {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // Best effort.
    }
    // Cache failures are non-fatal — license check just won't be cached.
  }
}

function deleteCache(contextDir: string): void {
  const path = cachePath(contextDir);
  if (!existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch {
    // ignore — best-effort
  }
}

function ageMs(isoTimestamp: string): number {
  return Date.now() - new Date(isoTimestamp).getTime();
}

export function normalizeLicenseEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "");
}

function apiKeyFingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey, "utf8").digest("hex");
}

function cacheMatchesCredential(
  cached: CacheEntry,
  endpoint: string,
  apiKey: string,
): boolean {
  return (
    cached.version === 2 &&
    cached.endpoint === normalizeLicenseEndpoint(endpoint) &&
    cached.api_key_sha256 === apiKeyFingerprint(apiKey)
  );
}

export function enterpriseCredentialId(
  endpoint: string,
  apiKey: string,
): string {
  return createHash("sha256")
    .update(normalizeLicenseEndpoint(endpoint), "utf8")
    .update("\0", "utf8")
    .update(apiKey, "utf8")
    .digest("hex");
}

function cacheResultIsUnexpired(cached: CacheEntry): boolean {
  if (!cached.result.valid) return false;
  const expiresAt = new Date(cached.result.expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function cacheAgeIsWithin(cached: CacheEntry, limitMs: number): boolean {
  const age = ageMs(cached.cached_at);
  return Number.isFinite(age) && age >= 0 && age < limitMs;
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

    if (res.status === 401 || res.status === 403) {
      return {
        valid: false,
        reason: "authentication_rejected",
        verified_at: new Date().toISOString(),
        source: "remote",
      };
    }

    if (!res.ok) {
      // Rate limiting, server failures, and other transport-level responses
      // may use an identity-matched positive cache during the grace period.
      return null;
    }

    const json = (await res.json()) as Record<string, unknown>;
    const verifiedAt = new Date().toISOString();

    if (
      json.valid === true &&
      typeof json.edition === "string" &&
      Array.isArray(json.features) &&
      json.features.every((feature) => typeof feature === "string") &&
      isIsoTimestamp(json.expires_at) &&
      new Date(json.expires_at).getTime() > Date.now() &&
      typeof json.max_repos === "number" &&
      Number.isFinite(json.max_repos) &&
      json.max_repos >= 0
    ) {
      return {
        valid: true,
        edition: json.edition,
        features: json.features,
        expires_at: json.expires_at,
        max_repos: json.max_repos,
        verified_at: verifiedAt,
        source: "remote",
      };
    }

    return {
      valid: false,
      reason: json.valid === true
        ? "malformed_license_response"
        : String(json.reason ?? "unknown"),
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
 *   1. If a positive cache (valid:true) is fresh (<24h), unexpired, and
 *      bound to this endpoint + API-key fingerprint → use cache
 *      Negative cache entries are never trusted; if one is encountered
 *      it's deleted on the spot so a since-fixed remote can heal.
 *   2. Otherwise try remote endpoint
 *      - On valid:true → write positive cache, return result
 *      - On valid:false (authoritative fail) → DELETE any positive
 *        cache (so a revoked/expired key doesn't keep masquerading as
 *        valid past its remote-side fail), return result, do NOT
 *        cache the negative.
 *      - On transient failure → fall back to the same identity-bound positive
 *        cache if within the grace period (7d). Authentication rejection is
 *        authoritative and never uses grace.
 *   3. If no usable cache and endpoint unreachable → return invalid
 *      (grace_expired).
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
  if (!isAllowedEnterpriseEndpoint(endpoint)) {
    deleteCache(contextDir);
    return {
      valid: false,
      reason: "insecure_or_invalid_endpoint",
      verified_at: new Date().toISOString(),
      source: "remote",
    };
  }

  let cached = readCache(contextDir);

  // Defensive: a previous version of this code wrote negative results
  // into the cache. Refuse to honour them and clean them up so a
  // since-deployed fix on the remote can be observed.
  if (cached && cached.result.valid === false) {
    deleteCache(contextDir);
    cached = null;
  }

  const matchingCache =
    cached && cacheMatchesCredential(cached, endpoint, apiKey)
      ? cached
      : null;

  // Fresh positive cache: skip remote.
  if (
    matchingCache &&
    matchingCache.result.valid === true &&
    cacheResultIsUnexpired(matchingCache) &&
    cacheAgeIsWithin(matchingCache, CACHE_TTL_MS)
  ) {
    return { ...matchingCache.result, source: "cache" };
  }

  const remote = await fetchLicense(
    endpoint,
    apiKey,
    options.instance_id,
    options.client_version,
  );

  if (remote) {
    if (remote.valid) {
      writeCache(contextDir, {
        version: 2,
        endpoint: normalizeLicenseEndpoint(endpoint),
        api_key_sha256: apiKeyFingerprint(apiKey),
        result: remote,
        cached_at: new Date().toISOString(),
      });
    } else {
      // Authoritative fail from remote — drop any stale positive cache
      // so we don't bounce back to "valid" on the next call.
      deleteCache(contextDir);
    }
    return remote;
  }

  // Remote unreachable. Fall back to positive cache if within grace.
  if (
    matchingCache &&
    matchingCache.result.valid === true &&
    cacheResultIsUnexpired(matchingCache) &&
    cacheAgeIsWithin(matchingCache, GRACE_PERIOD_MS)
  ) {
    return { ...matchingCache.result, source: "cache" };
  }

  return {
    valid: false,
    reason: "endpoint_unreachable_grace_expired",
    verified_at: new Date().toISOString(),
    source: "grace_expired",
  };
}
