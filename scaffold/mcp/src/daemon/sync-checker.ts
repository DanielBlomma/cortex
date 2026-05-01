import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadEnterpriseConfig } from "../core/config.js";
import { writeHostAuditEvent } from "./ungoverned-scanner.js";

/**
 * Phase 7 sync flow — daemon side.
 *
 * The daemon periodically pings cortex-web /api/v1/govern/config to learn
 * whether a new config version is available. It does NOT re-apply (that
 * would require root, which the daemon explicitly doesn't have post-Fas-3
 * privilege drop). Instead it emits an audit event and writes a
 * notification file that 'cortex enterprise status' surfaces. The
 * operator must then run 'sudo cortex enterprise sync' to actually
 * re-fetch + write managed-settings.
 *
 * Three audit outcomes per tick:
 *  - govern_config_unchanged  (304 / same version) — heartbeat that
 *                              cortex-web is reachable and we're current.
 *  - govern_config_available  (200 with new version) — operator action needed.
 *  - govern_config_sync_failed (network / auth error) — also written so
 *                              admin sees blackouts in audit timeline.
 */

const NOTIFICATION_FILENAME = ".govern-update-available.json";

export type SyncCheckOptions = {
  cwd: string;
  cli: "claude" | "codex" | "copilot";
  now?: () => Date;
};

export type SyncCheckOutcome =
  | { kind: "unchanged"; version: string }
  | { kind: "available"; latest_version: string; current_version: string | null }
  | { kind: "failed"; error: string };

type LocalGovernState = {
  installs?: Record<
    string,
    {
      version?: string;
      mode?: string;
      frameworks?: Array<{ id: string; version: string }>;
    }
  >;
};

function readLocalGovernState(cwd: string): LocalGovernState {
  const path = join(cwd, ".context", "govern.local.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LocalGovernState;
  } catch {
    return {};
  }
}

function activeFrameworks(cwd: string): string[] {
  const state = readLocalGovernState(cwd);
  for (const inst of Object.values(state.installs ?? {})) {
    if (inst.frameworks?.length) {
      return inst.frameworks.map((f) => f.id);
    }
  }
  // Fall back to enterprise.yml's compliance.frameworks
  const config = loadEnterpriseConfig(join(cwd, ".context"));
  return config.compliance.frameworks;
}

function currentVersion(cwd: string, cli: string): string | null {
  const state = readLocalGovernState(cwd);
  return state.installs?.[cli]?.version ?? null;
}

export async function checkSyncForCli(
  options: SyncCheckOptions,
): Promise<SyncCheckOutcome> {
  const cwd = options.cwd;
  const config = loadEnterpriseConfig(join(cwd, ".context"));
  const apiKey = config.enterprise.api_key.trim();
  const baseUrl = (config.enterprise.base_url || config.enterprise.endpoint).trim();
  if (!apiKey || !baseUrl) {
    return { kind: "failed", error: "enterprise not configured" };
  }
  const frameworks = activeFrameworks(cwd);
  if (frameworks.length === 0) {
    return { kind: "failed", error: "no active frameworks" };
  }

  const url = new URL(baseUrl.replace(/\/$/, "") + "/api/v1/govern/config");
  url.searchParams.set("cli", options.cli);
  url.searchParams.set("frameworks", frameworks.join(","));

  const installedVersion = currentVersion(cwd, options.cli);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };
  if (installedVersion) headers["If-None-Match"] = `"${installedVersion}"`;

  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    return { kind: "failed", error: err instanceof Error ? err.message : String(err) };
  }

  if (res.status === 304) {
    return { kind: "unchanged", version: installedVersion ?? "unknown" };
  }
  if (!res.ok) {
    return { kind: "failed", error: `HTTP ${res.status} ${res.statusText}` };
  }

  const etag = (res.headers.get("etag") ?? "").replace(/"/g, "");
  if (etag && etag === installedVersion) {
    return { kind: "unchanged", version: etag };
  }
  return {
    kind: "available",
    latest_version: etag || "unknown",
    current_version: installedVersion,
  };
}

function writeUpdateNotification(
  cwd: string,
  data: { latest_version: string; current_version: string | null; cli: string; detected_at: string },
): void {
  const dir = join(cwd, ".context");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, NOTIFICATION_FILENAME),
    JSON.stringify(data, null, 2) + "\n",
    "utf8",
  );
}

export async function runSyncCheckOnce(
  cwd: string,
  clis: Array<"claude" | "codex" | "copilot">,
): Promise<SyncCheckOutcome[]> {
  const outcomes: SyncCheckOutcome[] = [];
  const now = new Date().toISOString();
  for (const cli of clis) {
    const outcome = await checkSyncForCli({ cwd, cli });
    outcomes.push(outcome);
    const eventBase = {
      timestamp: now,
      host_id: undefined as string | undefined,
      cli,
    };
    if (outcome.kind === "unchanged") {
      await writeHostAuditEvent(cwd, {
        ...eventBase,
        event_type: "govern_config_unchanged",
        version: outcome.version,
      }).catch(() => undefined);
    } else if (outcome.kind === "available") {
      await writeHostAuditEvent(cwd, {
        ...eventBase,
        event_type: "govern_config_available",
        latest_version: outcome.latest_version,
        current_version: outcome.current_version,
      }).catch(() => undefined);
      writeUpdateNotification(cwd, {
        latest_version: outcome.latest_version,
        current_version: outcome.current_version,
        cli,
        detected_at: now,
      });
    } else {
      await writeHostAuditEvent(cwd, {
        ...eventBase,
        event_type: "govern_config_sync_failed",
        error: outcome.error,
      }).catch(() => undefined);
    }
  }
  return outcomes;
}

export type SyncTimerHandle = {
  stop(): void;
};

export function startSyncTimer(
  cwd: string,
  intervalMs: number,
): SyncTimerHandle {
  const tick = () => {
    const state = readLocalGovernState(cwd);
    const clis = Object.keys(state.installs ?? {}) as Array<
      "claude" | "codex" | "copilot"
    >;
    if (clis.length === 0) return;
    void runSyncCheckOnce(cwd, clis).catch((err) => {
      process.stderr.write(
        `[cortex-daemon] sync check failed: ${err instanceof Error ? err.message : String(err)}\n`,
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
