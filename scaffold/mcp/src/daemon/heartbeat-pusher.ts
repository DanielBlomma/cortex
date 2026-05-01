import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hostname, platform, release } from "node:os";
import { loadEnterpriseConfig } from "../core/config.js";

/**
 * Govern host heartbeat — fills the host_enrollment table on cortex-web.
 *
 * Reads .context/govern.local.json + enterprise.yml + OS info, builds a
 * canonical payload matching governHeartbeatSchema on the server side,
 * and POSTs it to /api/v1/govern/heartbeat. Without this, the dashboard
 * at /dashboard/govern shows zero hosts forever.
 *
 * Periodic — default 5 min, same cadence as host-events-pusher.
 */

const TIER_BY_CLI: Record<string, "prevent" | "wrap" | "detect" | "off"> = {
  claude: "prevent",
  codex: "prevent",
  copilot: "wrap",
};

type LocalGovernState = {
  installs?: Record<
    string,
    {
      mode?: "advisory" | "enforced";
      version?: string;
      frameworks?: Array<{ id: string; version: string }>;
    }
  >;
};

function readLocalGovernState(cwd: string): LocalGovernState {
  const p = join(cwd, ".context", "govern.local.json");
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as LocalGovernState;
  } catch {
    return {};
  }
}

function mapOs(plat: NodeJS.Platform): "darwin" | "linux" | "windows" {
  if (plat === "darwin") return "darwin";
  if (plat === "linux") return "linux";
  if (plat === "win32") return "windows";
  return "linux";
}

export type HeartbeatPayload = {
  host_id: string;
  os: "darwin" | "linux" | "windows";
  os_version?: string;
  govern_mode: "off" | "advisory" | "enforced";
  active_frameworks: string[];
  config_version: string | null;
  ai_clis_detected: Array<{
    name: string;
    tier: "prevent" | "wrap" | "detect" | "off";
    version?: string;
    last_seen?: string;
  }>;
};

export function buildHeartbeatPayload(cwd: string, hostId?: string): HeartbeatPayload {
  const config = loadEnterpriseConfig(join(cwd, ".context"));
  const state = readLocalGovernState(cwd);
  const installs = state.installs ?? {};
  const now = new Date().toISOString();

  const aiClisDetected = Object.entries(installs).map(([name, info]) => ({
    name,
    tier: TIER_BY_CLI[name] ?? "off",
    version: info.version,
    last_seen: now,
  }));

  let governMode: "off" | "advisory" | "enforced" = "off";
  for (const inst of Object.values(installs)) {
    if (inst.mode === "enforced") {
      governMode = "enforced";
      break;
    }
    if (inst.mode === "advisory" && governMode === "off") governMode = "advisory";
  }

  const configVersion = Object.values(installs)[0]?.version ?? null;

  return {
    host_id: hostId ?? hostname(),
    os: mapOs(platform()),
    os_version: release(),
    govern_mode: governMode,
    active_frameworks: config.compliance.frameworks,
    config_version: configVersion,
    ai_clis_detected: aiClisDetected,
  };
}

export type HeartbeatPushOutcome = { ok: true } | { ok: false; error: string };

export async function pushHeartbeat(cwd: string): Promise<HeartbeatPushOutcome> {
  const config = loadEnterpriseConfig(join(cwd, ".context"));
  const apiKey = config.enterprise.api_key.trim();
  const baseUrl = (config.enterprise.base_url || config.enterprise.endpoint).trim();
  if (!apiKey || !baseUrl) {
    return { ok: false, error: "enterprise not configured" };
  }
  const payload = buildHeartbeatPayload(cwd);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/govern/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} ${res.statusText}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type HeartbeatHandle = { stop(): void };

export function startHeartbeatPusher(cwd: string, intervalMs: number): HeartbeatHandle {
  const tick = () => {
    void pushHeartbeat(cwd).catch((err) => {
      process.stderr.write(
        `[cortex-daemon] heartbeat push failed: ${err instanceof Error ? err.message : String(err)}\n`,
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
