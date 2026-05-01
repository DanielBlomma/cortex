import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  renameSync,
  unlinkSync,
  rmSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { platform, hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { loadEnterpriseConfig, type ComplianceFramework } from "../core/config.js";
import { installCopilotShim, uninstallCopilotShim } from "./run.js";
import {
  readTamperLock,
  removeTamperLock,
  emitTamperAudit,
} from "../daemon/heartbeat-tracker.js";

export type GovernCli = "claude" | "codex" | "copilot";

const ALL_CLIS: GovernCli[] = ["claude", "codex", "copilot"];
const TIER1_CLIS: GovernCli[] = ["claude", "codex"];

export type ManagedSettingsPaths = Partial<Record<GovernCli, Partial<Record<NodeJS.Platform, string>>>>;

const DEFAULT_PATHS: ManagedSettingsPaths = {
  claude: {
    darwin: "/Library/Application Support/ClaudeCode/managed-settings.json",
    linux: "/etc/claude-code/managed-settings.json",
  },
  codex: {
    darwin: "/Library/Application Support/Codex/requirements.toml",
    linux: "/etc/codex/requirements.toml",
  },
};

export type GovernState = {
  installs: Partial<Record<GovernCli, GovernInstallRecord>>;
};

export type GovernInstallRecord = {
  path: string;
  version: string;
  frameworks: Array<{ id: string; version: string }>;
  installed_at: string;
  mode: "advisory" | "enforced";
};

export type FetchedConfig = {
  cli: GovernCli;
  managed_settings: Record<string, unknown>;
  deny_rules: Array<{ pattern: string; source_frameworks: string[] }>;
  tamper_config: { heartbeat_interval_seconds: number; missing_threshold_seconds: number };
  frameworks: Array<{ id: string; version: string }>;
};

export function getManagedSettingsPath(cli: GovernCli, os: NodeJS.Platform): string {
  const path = DEFAULT_PATHS[cli]?.[os];
  if (!path) {
    throw new Error(`govern install for ${cli} not yet supported on ${os}`);
  }
  return path;
}

export function requireRoot(): void {
  const getuid = (process as { getuid?: () => number }).getuid;
  if (typeof getuid !== "function") {
    throw new Error(
      "govern install on this OS requires admin privileges; not yet supported (only macOS + Linux).",
    );
  }
  if (getuid() !== 0) {
    throw new Error(
      "This command writes to a system path. Re-run with: sudo cortex govern <command>",
    );
  }
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function tomlArray(values: unknown[]): string {
  const items = values.map((v) => {
    if (typeof v === "string") return tomlString(v);
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return tomlString(JSON.stringify(v));
  });
  return `[${items.join(", ")}]`;
}

export function buildCodexRequirementsToml(config: FetchedConfig): string {
  const denyRead = config.deny_rules
    .map((r) => r.pattern)
    .filter((p) => /^(Edit|Read|Write)\(/.test(p))
    .map((p) => p.replace(/^[A-Za-z]+\(/, "").replace(/\)$/, ""));
  const lines: string[] = [
    "# Cortex govern — codex requirements (Phase 3 of PLAN.govern-mode.md).",
    "# Admin-enforced upper bounds. Users cannot weaken these via ~/.codex/config.toml.",
    "",
    `allowed_sandbox_modes = ${tomlArray(["read-only", "workspace-write"])}`,
    `allowed_approval_policies = ${tomlArray(["untrusted", "on-request"])}`,
    "",
    "[permissions.filesystem]",
    `deny_read = ${tomlArray(denyRead)}`,
    "",
    "[features]",
    "codex_hooks = true",
    "",
  ];
  return lines.join("\n");
}

function writeAtomic(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${randomUUID()}`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, filePath);
}

function getStatePath(cwd: string): string {
  return join(cwd, ".context", "govern.local.json");
}

function loadState(cwd: string): GovernState {
  try {
    const raw = readFileSync(getStatePath(cwd), "utf8");
    const parsed = JSON.parse(raw) as GovernState;
    return { installs: parsed.installs ?? {} };
  } catch {
    return { installs: {} };
  }
}

function saveState(cwd: string, state: GovernState): void {
  const path = getStatePath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
}

async function fetchGovernConfig(
  baseUrl: string,
  apiKey: string,
  cli: GovernCli,
  frameworks: string[],
): Promise<{ config: FetchedConfig; etag: string | null }> {
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/api/v1/govern/config`);
  url.searchParams.set("cli", cli);
  url.searchParams.set("frameworks", frameworks.join(","));
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`govern config fetch failed: HTTP ${res.status} ${res.statusText}`);
  }
  const etag = res.headers.get("etag");
  const config = (await res.json()) as FetchedConfig;
  return { config, etag };
}

async function postApplied(
  baseUrl: string,
  apiKey: string,
  payload: {
    host_id: string;
    cli: GovernCli;
    version: string;
    source: "session_start" | "periodic_sync" | "manual";
    success: boolean;
    error_message?: string;
    instance_id?: string;
  },
): Promise<void> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/govern/applied`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`govern applied notify failed: HTTP ${res.status} ${body}`);
  }
}

export type GovernInstallOptions = {
  cli: GovernCli | "all";
  frameworks?: string[];
  mode?: "advisory" | "enforced";
  cwd?: string;
  pathOverride?: Partial<Record<GovernCli, string>>;
  skipRoot?: boolean;
  apiKey?: string;
  baseUrl?: string;
};

export type GovernInstallResult = {
  ok: boolean;
  message: string;
  installed: GovernCli[];
};

export async function runGovernInstall(
  options: GovernInstallOptions,
): Promise<GovernInstallResult> {
  const cwd = options.cwd ?? process.cwd();
  const contextDir = join(cwd, ".context");
  if (!existsSync(contextDir)) {
    return {
      ok: false,
      message: `No .context/ at ${cwd}. Run 'cortex init --bootstrap' first.`,
      installed: [],
    };
  }

  let apiKey = options.apiKey?.trim() ?? "";
  let baseUrl = options.baseUrl?.trim() ?? "";
  let frameworks = options.frameworks ?? [];

  if (!apiKey || !baseUrl || frameworks.length === 0) {
    const config = loadEnterpriseConfig(contextDir);
    if (!apiKey) apiKey = config.enterprise.api_key.trim();
    if (!baseUrl) baseUrl = (config.enterprise.base_url || config.enterprise.endpoint).trim();
    if (frameworks.length === 0) {
      frameworks = config.compliance.frameworks as ComplianceFramework[];
    }
  }

  if (!apiKey) {
    return {
      ok: false,
      message:
        "No enterprise.api_key available (pass via options or set in enterprise.yml).",
      installed: [],
    };
  }
  if (!baseUrl) {
    return {
      ok: false,
      message: "No enterprise.base_url configured (pass via options or enterprise.yml).",
      installed: [],
    };
  }

  const targets: GovernCli[] =
    options.cli === "all" ? [...ALL_CLIS] : [options.cli as GovernCli];
  if (frameworks.length === 0) {
    return {
      ok: false,
      message:
        "No frameworks configured. Set compliance.frameworks in enterprise.yml.",
      installed: [],
    };
  }

  const mode = options.mode ?? "advisory";
  const state = loadState(cwd);
  const installed: GovernCli[] = [];

  for (const cli of targets) {
    if (cli === "copilot") {
      if (!options.skipRoot) requireRoot();
      const shimPath = options.pathOverride?.copilot;
      const shimResult = installCopilotShim(
        shimPath ? { shimPath } : {},
      );
      if (!shimResult.ok) {
        console.log(`! ${cli}: ${shimResult.message}`);
        continue;
      }
      state.installs[cli] = {
        path: shimResult.shimPath ?? "",
        version: "shim-v1",
        frameworks: [{ id: "tier2", version: "wrap" }],
        installed_at: new Date().toISOString(),
        mode,
      };
      installed.push(cli);
      console.log(`✓ ${cli}: ${shimResult.message} (mode=${mode})`);
      continue;
    }
    if (!options.skipRoot) requireRoot();

    const path = options.pathOverride?.[cli] ?? getManagedSettingsPath(cli, platform());

    let merged: FetchedConfig;
    let version: string;
    try {
      const result = await fetchGovernConfig(baseUrl, apiKey, cli, frameworks);
      merged = result.config;
      version = result.etag?.replace(/"/g, "") ?? "unknown";
    } catch (err) {
      return {
        ok: false,
        message: `Failed to fetch govern config for ${cli}: ${err instanceof Error ? err.message : String(err)}`,
        installed,
      };
    }

    const content =
      cli === "claude"
        ? JSON.stringify(merged.managed_settings, null, 2) + "\n"
        : buildCodexRequirementsToml(merged);

    try {
      writeAtomic(path, content);
    } catch (err) {
      await postApplied(baseUrl, apiKey, {
        host_id: hostname(),
        cli,
        version,
        source: "manual",
        success: false,
        error_message: err instanceof Error ? err.message : String(err),
      }).catch(() => undefined);
      return {
        ok: false,
        message: `Failed to write ${path}: ${err instanceof Error ? err.message : String(err)}`,
        installed,
      };
    }

    state.installs[cli] = {
      path,
      version,
      frameworks: merged.frameworks,
      installed_at: new Date().toISOString(),
      mode,
    };

    await postApplied(baseUrl, apiKey, {
      host_id: hostname(),
      cli,
      version,
      source: "manual",
      success: true,
    }).catch((err) => {
      console.log(
        `! Could not notify cortex-web of applied state for ${cli}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    installed.push(cli);
    const shortVersion = version.length > 12 ? `${version.slice(0, 12)}...` : version;
    console.log(`✓ ${cli}: managed-settings written to ${path} (version ${shortVersion}, mode=${mode})`);
  }

  saveState(cwd, state);
  return {
    ok: true,
    message: `Installed govern for ${installed.join(", ") || "(none)"}.`,
    installed,
  };
}

export type GovernUninstallOptions = {
  cli: GovernCli | "all";
  breakGlass?: boolean;
  reason?: string;
  cwd?: string;
  skipRoot?: boolean;
};

export async function runGovernUninstall(
  options: GovernUninstallOptions,
): Promise<{ ok: boolean; message: string; uninstalled: GovernCli[] }> {
  const cwd = options.cwd ?? process.cwd();
  const state = loadState(cwd);

  const allInstalledClis = Object.keys(state.installs) as GovernCli[];
  const targets: GovernCli[] =
    options.cli === "all" ? allInstalledClis : [options.cli as GovernCli];

  for (const cli of targets) {
    const inst = state.installs[cli];
    if (inst?.mode === "enforced") {
      if (!options.breakGlass) {
        return {
          ok: false,
          message: `${cli} is installed in enforced mode. Pass --break-glass --reason "<text>" to override.`,
          uninstalled: [],
        };
      }
      if (!options.reason || options.reason.trim().length < 4) {
        return {
          ok: false,
          message: '--break-glass requires --reason "<text>" (at least 4 chars)',
          uninstalled: [],
        };
      }
    }
  }

  const uninstalled: GovernCli[] = [];
  for (const cli of targets) {
    const inst = state.installs[cli];
    if (!inst) continue;
    if (!options.skipRoot) requireRoot();
    if (cli === "copilot") {
      const shimResult = uninstallCopilotShim(inst.path);
      if (!shimResult.ok) {
        console.log(`! ${cli}: ${shimResult.message}`);
        continue;
      }
      delete state.installs[cli];
      uninstalled.push(cli);
      console.log(
        `✓ ${cli}: ${shimResult.message}` +
          (options.breakGlass ? ` (break-glass: ${options.reason})` : ""),
      );
      continue;
    }
    try {
      unlinkSync(inst.path);
    } catch {
      // file already gone — proceed
    }
    delete state.installs[cli];
    uninstalled.push(cli);
    console.log(
      `✓ ${cli}: managed-settings removed from ${inst.path}` +
        (options.breakGlass ? ` (break-glass: ${options.reason})` : ""),
    );
  }

  saveState(cwd, state);
  return {
    ok: true,
    message: `Uninstalled govern for ${uninstalled.join(", ") || "(none)"}.`,
    uninstalled,
  };
}

export function runGovernStatus(options: { cwd?: string } = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const state = loadState(cwd);
  const installs = state.installs;
  console.log("Cortex Govern — local state");
  console.log("===========================");
  if (Object.keys(installs).length === 0) {
    console.log("No CLIs governed on this host.");
    console.log("Run: sudo cortex govern install --cli <claude|codex|all>");
    console.log("(Full overview UI lands in Phase 8.)");
    return;
  }
  for (const cli of Object.keys(installs) as GovernCli[]) {
    const i = installs[cli];
    if (!i) continue;
    const fwIds = i.frameworks.map((f) => f.id).join(", ") || "(none)";
    console.log(`  ${cli}:`);
    console.log(`    path:        ${i.path}`);
    console.log(`    version:     ${i.version}`);
    console.log(`    mode:        ${i.mode}`);
    console.log(`    frameworks:  ${fwIds}`);
    console.log(`    installed:   ${i.installed_at}`);
  }
  console.log("");
  console.log("(Full overview with audit timeline + tamper-status lands in Phase 8.)");
}

export type GovernRepairOptions = {
  cwd?: string;
  skipRoot?: boolean;
  reason?: string;
};

export type GovernRepairResult = {
  ok: boolean;
  message: string;
  removed_lock?: boolean;
  reverified: GovernCli[];
};

/**
 * Verify that managed-settings files for each governed CLI still exist
 * (and copilot's shim path is still our shim). If everything checks out,
 * remove .cortex-tamper.lock and emit a tamper_repaired audit event.
 *
 * Re-fetching from cortex-web (full re-install) is intentionally NOT done
 * here — that path is `cortex enterprise sync`. Repair is the post-incident
 * "I've reviewed the situation, lock cleared" verb.
 */
export async function runGovernRepair(
  options: GovernRepairOptions = {},
): Promise<GovernRepairResult> {
  const cwd = options.cwd ?? process.cwd();
  const state = loadState(cwd);
  const installed = Object.entries(state.installs) as Array<
    [GovernCli, GovernInstallRecord]
  >;
  if (installed.length === 0) {
    return {
      ok: false,
      message:
        "No CLIs governed on this host — nothing to repair. Run 'cortex enterprise <key>' first.",
      reverified: [],
    };
  }

  if (!options.skipRoot) requireRoot();

  const verified: GovernCli[] = [];
  const missing: string[] = [];
  for (const [cli, record] of installed) {
    if (!existsSync(record.path)) {
      missing.push(`${cli}: ${record.path} is missing`);
      continue;
    }
    if (cli === "copilot") {
      // Verify the file is still our shim (not replaced by a real binary).
      try {
        const raw = readFileSync(record.path, "utf8");
        if (!raw.includes("# cortex-shim-v1")) {
          missing.push(`${cli}: ${record.path} is no longer a cortex shim`);
          continue;
        }
      } catch {
        missing.push(`${cli}: ${record.path} could not be read`);
        continue;
      }
    }
    verified.push(cli);
  }

  if (missing.length > 0) {
    return {
      ok: false,
      message:
        "Cannot repair — the following managed paths are missing or replaced:\n  " +
        missing.join("\n  ") +
        "\nRun 'sudo cortex enterprise sync' to re-install, then 'cortex enterprise repair' again.",
      reverified: verified,
    };
  }

  const lock = readTamperLock(cwd);
  if (!lock) {
    return {
      ok: true,
      message:
        "No tamper lock present — managed paths verified, nothing to clear.",
      removed_lock: false,
      reverified: verified,
    };
  }

  const removed = removeTamperLock(cwd);
  if (removed) {
    await emitTamperAudit(cwd, {
      ...lock,
      detected_at: new Date().toISOString(),
      hook_name: "tamper_repaired",
      missing_seconds: 0,
    }).catch(() => undefined);
  }

  return {
    ok: true,
    message:
      `Repaired: managed paths verified for ${verified.join(", ")}; ` +
      `tamper lock removed${options.reason ? ` (reason: ${options.reason})` : ""}.`,
    removed_lock: removed,
    reverified: verified,
  };
}

export async function runGovernSync(options: { cwd?: string } = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const state = loadState(cwd);
  const targets = Object.keys(state.installs) as GovernCli[];
  if (targets.length === 0) {
    console.log("Nothing to sync — no CLIs governed on this host.");
    return;
  }
  for (const cli of targets) {
    const previous = state.installs[cli];
    const result = await runGovernInstall({
      cli,
      cwd,
      mode: previous?.mode,
    });
    if (!result.ok) {
      console.log(`! sync ${cli} failed: ${result.message}`);
    }
  }
}
