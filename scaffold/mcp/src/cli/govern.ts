import {
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  existsSync,
  renameSync,
  unlinkSync,
  rmSync,
  chmodSync,
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

type CodexHookCommand = {
  type: "command";
  command: string;
  timeout?: number;
  statusMessage?: string;
};

type CodexHookHandler = {
  matcher?: string;
  hooks: CodexHookCommand[];
};

type CodexHookHandlersByEvent = Record<string, CodexHookHandler[]>;

const SUPPORTED_CODEX_HOOK_EVENTS = new Set([
  "SessionStart",
  "SessionEnd",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "UserPromptSubmit",
  "Stop",
]);

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeCodexHookCommand(raw: unknown): CodexHookCommand | null {
  if (typeof raw === "string" && raw.trim()) {
    return { type: "command", command: raw.trim() };
  }
  if (!isRecord(raw)) {
    return null;
  }
  const command = typeof raw.command === "string" ? raw.command.trim() : "";
  if (!command) {
    return null;
  }
  const timeout = typeof raw.timeout === "number" && Number.isFinite(raw.timeout)
    ? Math.trunc(raw.timeout)
    : undefined;
  const statusMessage = typeof raw.statusMessage === "string" && raw.statusMessage.trim()
    ? raw.statusMessage
    : undefined;
  return {
    type: "command",
    command,
    ...(timeout !== undefined ? { timeout } : {}),
    ...(statusMessage ? { statusMessage } : {}),
  };
}

function normalizeCodexHookCommands(raw: unknown): CodexHookCommand[] {
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => normalizeCodexHookCommand(entry))
      .filter((entry): entry is CodexHookCommand => entry !== null);
  }
  const single = normalizeCodexHookCommand(raw);
  return single ? [single] : [];
}

function normalizeCodexHookHandlers(raw: unknown): CodexHookHandler[] {
  const entries = Array.isArray(raw) ? raw : [raw];
  const normalized: CodexHookHandler[] = [];

  for (const entry of entries) {
    if (typeof entry === "string") {
      normalized.push({ hooks: [{ type: "command", command: entry }] });
      continue;
    }
    if (!isRecord(entry)) {
      continue;
    }

    const matcher = typeof entry.matcher === "string" && entry.matcher.trim()
      ? entry.matcher
      : undefined;

    if (Array.isArray(entry.hooks) || typeof entry.hooks === "string" || isRecord(entry.hooks)) {
      const hooks = normalizeCodexHookCommands(entry.hooks);
      if (hooks.length > 0) {
        normalized.push({ ...(matcher ? { matcher } : {}), hooks });
      }
      continue;
    }

    const shorthand = normalizeCodexHookCommand(entry);
    if (shorthand) {
      normalized.push({
        ...(matcher ? { matcher } : {}),
        hooks: [shorthand],
      });
    }
  }

  return normalized;
}

function normalizeCodexHooks(managedSettings: Record<string, unknown>): CodexHookHandlersByEvent {
  const hooksRoot = managedSettings.hooks;
  if (!isRecord(hooksRoot)) {
    return {};
  }

  const normalized: CodexHookHandlersByEvent = {};
  for (const [eventName, rawHandlers] of Object.entries(hooksRoot)) {
    if (!SUPPORTED_CODEX_HOOK_EVENTS.has(eventName)) {
      continue;
    }
    const handlers = normalizeCodexHookHandlers(rawHandlers);
    if (handlers.length > 0) {
      normalized[eventName] = handlers;
    }
  }
  return normalized;
}

function codexManagedHooksDir(requirementsPath: string): string {
  return join(dirname(requirementsPath), "hooks");
}

function shellQuotedCommandPath(filePath: string): string {
  return `"${filePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function managedCodexHookWrapperContent(hookName: string): string {
  return [
    "#!/bin/sh",
    "set -eu",
    'CORTEX="${CORTEX_BIN:-cortex}"',
    `exec "$CORTEX" hook ${hookName} "$@"`,
    "",
  ].join("\n");
}

function materializeCodexManagedHooks(
  requirementsPath: string,
  managedSettings: Record<string, unknown>,
): { managedHookDir: string | null; hooksByEvent: CodexHookHandlersByEvent } {
  const hooksByEvent = normalizeCodexHooks(managedSettings);
  const eventNames = Object.keys(hooksByEvent);
  if (eventNames.length === 0) {
    return { managedHookDir: null, hooksByEvent };
  }

  const managedHookDir = codexManagedHooksDir(requirementsPath);
  mkdirSync(managedHookDir, { recursive: true });

  for (const handlers of Object.values(hooksByEvent)) {
    for (const handler of handlers) {
      for (const hook of handler.hooks) {
        const match = hook.command.match(/^cortex hook ([a-z0-9-]+)$/);
        if (!match) {
          continue;
        }
        const hookName = match[1];
        const wrapperPath = join(managedHookDir, `${hookName}.sh`);
        writeAtomic(wrapperPath, managedCodexHookWrapperContent(hookName), 0o755);
        hook.command = shellQuotedCommandPath(wrapperPath);
      }
    }
  }

  return { managedHookDir, hooksByEvent };
}

export function buildCodexRequirementsToml(
  config: FetchedConfig,
  options: { managedHookDir?: string | null; hooksByEvent?: CodexHookHandlersByEvent } = {},
): string {
  const denyRead = config.deny_rules
    .map((r) => r.pattern)
    .filter((p) => /^(Edit|Read|Write)\(/.test(p))
    .map((p) => p.replace(/^[A-Za-z]+\(/, "").replace(/\)$/, ""));
  const hooksByEvent = options.hooksByEvent ?? normalizeCodexHooks(config.managed_settings);
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

  const eventNames = Object.keys(hooksByEvent);
  if (eventNames.length > 0) {
    lines.push("[hooks]");
    if (options.managedHookDir) {
      lines.push(`managed_dir = ${tomlString(options.managedHookDir)}`);
    }
    lines.push("");

    for (const eventName of eventNames) {
      for (const handler of hooksByEvent[eventName]) {
        lines.push(`[[hooks.${eventName}]]`);
        if (handler.matcher) {
          lines.push(`matcher = ${tomlString(handler.matcher)}`);
        }
        for (const hook of handler.hooks) {
          lines.push("");
          lines.push(`[[hooks.${eventName}.hooks]]`);
          lines.push(`type = ${tomlString(hook.type)}`);
          lines.push(`command = ${tomlString(hook.command)}`);
          if (hook.timeout !== undefined) {
            lines.push(`timeout = ${hook.timeout}`);
          }
          if (hook.statusMessage) {
            lines.push(`statusMessage = ${tomlString(hook.statusMessage)}`);
          }
        }
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

function writeAtomic(filePath: string, content: string, mode?: number): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${randomUUID()}`;
  writeFileSync(tmp, content, "utf8");
  if (mode !== undefined) {
    chmodSync(tmp, mode);
  }
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

    const codexManagedHooks =
      cli === "codex"
        ? materializeCodexManagedHooks(path, merged.managed_settings)
        : { managedHookDir: null, hooksByEvent: {} };

    const content =
      cli === "claude"
        ? JSON.stringify(merged.managed_settings, null, 2) + "\n"
        : buildCodexRequirementsToml(merged, codexManagedHooks);

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

  // Filter out unknown CLI keys defensively — govern.local.json is a
  // user-writable file and a corrupted/forward-compatible entry must not
  // crash the path that walks it.
  const allInstalledClis = Object.keys(state.installs).filter((k): k is GovernCli =>
    ALL_CLIS.includes(k as GovernCli),
  );
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

type CliStatusEntry = {
  cli: GovernCli;
  tier: "Tier 1 (Prevent)" | "Tier 2 (Wrap)";
  path: string;
  version: string;
  mode: "advisory" | "enforced";
  frameworks: Array<{ id: string; version: string }>;
  installed_at: string;
  managed_path_present: boolean;
  managed_path_size_bytes: number | null;
  managed_path_kind: "managed-settings.json" | "requirements.toml" | "shim" | "unknown";
  deny_rules_count: number | null;
  shim_real_binary: string | null;
};

type RecentEventCount = {
  ungoverned_ai_session_detected: number;
  hook_tamper_detected: number;
  tamper_repaired: number;
  govern_config_unchanged: number;
  govern_config_available: number;
  govern_config_sync_failed: number;
};

export type GovernStatusReport = {
  cwd: string;
  host_id: string;
  generated_at: string;
  enterprise: {
    api_key_set: boolean;
    base_url: string;
    frameworks_configured: ComplianceFramework[];
    govern_mode_config: GovernConfigModeFromConfig;
  };
  mode_effective: "off" | "advisory" | "enforced";
  installs: CliStatusEntry[];
  update_notification: {
    cli: string;
    latest_version: string;
    current_version: string | null;
    detected_at: string;
  } | null;
  tamper_lock: {
    cli: string;
    session_id: string;
    detected_at: string;
    last_seen: string;
    missing_seconds: number;
  } | null;
  recent_events_24h: RecentEventCount;
  recent_events_sample: Array<Record<string, unknown>>;
};

type GovernConfigModeFromConfig = "off" | "advisory" | "enforced";

const TIER_BY_CLI: Record<GovernCli, CliStatusEntry["tier"]> = {
  claude: "Tier 1 (Prevent)",
  codex: "Tier 1 (Prevent)",
  copilot: "Tier 2 (Wrap)",
};

function classifyManagedPath(
  cli: GovernCli,
  filePath: string,
): CliStatusEntry["managed_path_kind"] {
  if (cli === "copilot") return "shim";
  if (filePath.endsWith(".json")) return "managed-settings.json";
  if (filePath.endsWith(".toml")) return "requirements.toml";
  return "unknown";
}

function countDenyRules(
  cli: GovernCli,
  filePath: string,
): { count: number | null; shimReal: string | null } {
  if (!existsSync(filePath)) return { count: null, shimReal: null };
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return { count: null, shimReal: null };
  }
  if (cli === "copilot") {
    // Shim is a shell script — pull the captured "Real binary" comment.
    const m = raw.match(/Real binary captured at install time:\s*(.+?)\s*$/m);
    return { count: null, shimReal: m ? m[1] : null };
  }
  if (cli === "claude") {
    try {
      const parsed = JSON.parse(raw) as {
        permissions?: { deny?: unknown[] };
      };
      const deny = parsed.permissions?.deny;
      return { count: Array.isArray(deny) ? deny.length : 0, shimReal: null };
    } catch {
      return { count: null, shimReal: null };
    }
  }
  if (cli === "codex") {
    // requirements.toml: count items inside `deny_read = [ ... ]`.
    const m = raw.match(/deny_read\s*=\s*\[([^\]]*)\]/);
    if (!m) return { count: 0, shimReal: null };
    const inner = m[1].trim();
    if (!inner) return { count: 0, shimReal: null };
    return { count: inner.split(",").filter((s) => s.trim()).length, shimReal: null };
  }
  return { count: null, shimReal: null };
}

function readUpdateNotification(cwd: string): GovernStatusReport["update_notification"] {
  const path = join(cwd, ".context", ".govern-update-available.json");
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      cli?: string;
      latest_version?: string;
      current_version?: string | null;
      detected_at?: string;
    };
    if (!raw.cli || !raw.latest_version || !raw.detected_at) return null;
    return {
      cli: raw.cli,
      latest_version: raw.latest_version,
      current_version: raw.current_version ?? null,
      detected_at: raw.detected_at,
    };
  } catch {
    return null;
  }
}

function readActiveTamperLock(cwd: string): GovernStatusReport["tamper_lock"] {
  const path = join(cwd, ".context", ".cortex-tamper.lock");
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      cli?: string;
      session_id?: string;
      detected_at?: string;
      last_seen?: string;
      missing_seconds?: number;
    };
    if (!raw.cli || !raw.session_id || !raw.detected_at || !raw.last_seen) return null;
    return {
      cli: raw.cli,
      session_id: raw.session_id,
      detected_at: raw.detected_at,
      last_seen: raw.last_seen,
      missing_seconds: raw.missing_seconds ?? 0,
    };
  } catch {
    return null;
  }
}

function readRecentEvents(
  cwd: string,
  windowMs: number,
  now: Date,
): { counts: RecentEventCount; sample: Array<Record<string, unknown>> } {
  const counts: RecentEventCount = {
    ungoverned_ai_session_detected: 0,
    hook_tamper_detected: 0,
    tamper_repaired: 0,
    govern_config_unchanged: 0,
    govern_config_available: 0,
    govern_config_sync_failed: 0,
  };
  const sample: Array<Record<string, unknown>> = [];
  const cutoff = now.getTime() - windowMs;
  const auditDir = join(cwd, ".context", "audit");
  if (!existsSync(auditDir)) return { counts, sample };
  let files: string[];
  try {
    // Walk every host-events-*.jsonl file, newest first. The window can
    // span more than two daily files (a 24h window read at 00:30 still
    // needs yesterday's file + a sliver of the day before), and we must
    // not silently drop events because the slice(-2) heuristic happens
    // to land on a quiet day. Per-line cutoff still bounds work below.
    files = readdirSync(auditDir)
      .filter((n) => n.startsWith("host-events-") && n.endsWith(".jsonl"))
      .sort()
      .reverse()
      .map((n) => join(auditDir, n));
  } catch {
    return { counts, sample };
  }
  outer: for (const file of files) {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    // Within a single file, lines are appended in chronological order, so
    // once we hit a line older than the cutoff every subsequent line is
    // also too old. The filename ordering is already newest-first across
    // files, so once an entire file is too old it's the boundary and we
    // stop walking older files altogether.
    let fileHadAnyInWindow = false;
    let fileHadAnyOutOfWindow = false;
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let evt: Record<string, unknown>;
      try {
        evt = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const ts = (evt.timestamp ?? evt.detected_at) as string | undefined;
      if (!ts) continue;
      const t = new Date(ts).getTime();
      if (!Number.isFinite(t)) continue;
      if (t < cutoff) {
        fileHadAnyOutOfWindow = true;
        continue;
      }
      fileHadAnyInWindow = true;
      const type = evt.event_type as keyof RecentEventCount | undefined;
      if (type && type in counts) {
        counts[type] += 1;
      }
      if (sample.length < 10) sample.push(evt);
    }
    // If this file had only out-of-window events, the cutoff is behind us
    // and any older file can only contain even older events — stop early.
    if (fileHadAnyOutOfWindow && !fileHadAnyInWindow) break outer;
  }
  return { counts, sample };
}

export function buildGovernStatus(options: { cwd?: string; now?: Date } = {}): GovernStatusReport {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? new Date();
  const config = loadEnterpriseConfig(join(cwd, ".context"));
  const state = loadState(cwd);

  const installs: CliStatusEntry[] = [];
  let mostRestrictiveMode: "off" | "advisory" | "enforced" = "off";
  for (const [rawCliName, record] of Object.entries(state.installs)) {
    // Skip any unknown CLI keys (e.g. a forward-compatible 'gemini' entry
    // written by a newer enterprise endpoint, or a hand-edited corrupt
    // file). Casting blindly would let unknown keys flow into TIER_BY_CLI
    // / countDenyRules and produce undefined-shaped data.
    if (!ALL_CLIS.includes(rawCliName as GovernCli)) continue;
    if (!record) continue;
    const cliName = rawCliName as GovernCli;
    const present = existsSync(record.path);
    let size: number | null = null;
    if (present) {
      try {
        size = statSync(record.path).size;
      } catch {
        size = null;
      }
    }
    const { count, shimReal } = countDenyRules(cliName, record.path);
    installs.push({
      cli: cliName,
      tier: TIER_BY_CLI[cliName],
      path: record.path,
      version: record.version,
      mode: record.mode,
      frameworks: record.frameworks,
      installed_at: record.installed_at,
      managed_path_present: present,
      managed_path_size_bytes: size,
      managed_path_kind: classifyManagedPath(cliName, record.path),
      deny_rules_count: count,
      shim_real_binary: shimReal,
    });
    if (record.mode === "enforced") mostRestrictiveMode = "enforced";
    else if (record.mode === "advisory" && mostRestrictiveMode === "off") {
      mostRestrictiveMode = "advisory";
    }
  }

  const { counts, sample } = readRecentEvents(cwd, 24 * 60 * 60 * 1000, now);

  return {
    cwd,
    host_id: hostname(),
    generated_at: now.toISOString(),
    enterprise: {
      api_key_set: config.enterprise.api_key.trim() !== "",
      base_url: config.enterprise.base_url || config.enterprise.endpoint,
      frameworks_configured: config.compliance.frameworks,
      govern_mode_config: config.govern.mode,
    },
    mode_effective: mostRestrictiveMode,
    installs,
    update_notification: readUpdateNotification(cwd),
    tamper_lock: readActiveTamperLock(cwd),
    recent_events_24h: counts,
    recent_events_sample: sample,
  };
}

function formatCompact(report: GovernStatusReport): string {
  const lines: string[] = [];
  lines.push("Cortex Enterprise — Govern Overview");
  lines.push("===================================");
  lines.push(`Host:          ${report.host_id}`);
  lines.push(`Mode:          ${report.mode_effective}`);
  lines.push(
    `Frameworks:    ${report.enterprise.frameworks_configured.join(", ") || "(none)"}`,
  );
  lines.push(`Endpoint:      ${report.enterprise.base_url || "(not set)"}`);
  lines.push(
    `API key:       ${report.enterprise.api_key_set ? "configured" : "NOT SET (run 'sudo cortex enterprise <key>')"}`,
  );
  lines.push("");
  if (report.tamper_lock) {
    lines.push("⚠ TAMPER LOCK ACTIVE");
    lines.push(
      `  cli=${report.tamper_lock.cli} session=${report.tamper_lock.session_id} detected=${report.tamper_lock.detected_at}`,
    );
    lines.push("  Run: sudo cortex enterprise repair");
    lines.push("");
  }
  if (report.update_notification) {
    lines.push(
      `↺ UPDATE AVAILABLE: ${report.update_notification.cli} ` +
        `(current=${report.update_notification.current_version ?? "unknown"} → ` +
        `latest=${report.update_notification.latest_version})`,
    );
    lines.push("  Run: sudo cortex enterprise sync");
    lines.push("");
  }
  if (report.installs.length === 0) {
    lines.push("No CLIs governed on this host.");
    lines.push("Run: sudo cortex enterprise <api-key>");
    return lines.join("\n");
  }
  lines.push("AI CLIs on this host:");
  for (const i of report.installs) {
    const presence = i.managed_path_present ? "✓" : "✗";
    const denyText =
      i.deny_rules_count !== null ? `${i.deny_rules_count} deny rules` : "shim";
    lines.push(
      `  ${presence} ${i.cli.padEnd(8)} ${i.tier.padEnd(20)} ${denyText}, mode=${i.mode}`,
    );
  }
  lines.push("");
  lines.push("Recent activity (last 24h):");
  lines.push(`  ungoverned sessions:  ${report.recent_events_24h.ungoverned_ai_session_detected}`);
  lines.push(`  tamper detected:      ${report.recent_events_24h.hook_tamper_detected}`);
  lines.push(`  tamper repaired:      ${report.recent_events_24h.tamper_repaired}`);
  lines.push(`  config unchanged:     ${report.recent_events_24h.govern_config_unchanged}`);
  lines.push(`  config available:     ${report.recent_events_24h.govern_config_available}`);
  lines.push(`  sync failed:          ${report.recent_events_24h.govern_config_sync_failed}`);
  lines.push("");
  lines.push("Run 'cortex enterprise status --verbose' for the full deny-rule list and event details.");
  return lines.join("\n");
}

function formatVerbose(report: GovernStatusReport): string {
  const sections: string[] = [formatCompact(report), ""];
  sections.push("Per-CLI managed-config detail:");
  for (const i of report.installs) {
    sections.push(`  [${i.cli}]`);
    sections.push(`    path:           ${i.path}`);
    sections.push(`    kind:           ${i.managed_path_kind}`);
    sections.push(
      `    file:           ${i.managed_path_present ? `present (${i.managed_path_size_bytes ?? "?"} bytes)` : "MISSING"}`,
    );
    sections.push(`    version:        ${i.version}`);
    sections.push(`    mode:           ${i.mode}`);
    sections.push(`    installed_at:   ${i.installed_at}`);
    sections.push(
      `    frameworks:     ${i.frameworks.map((f) => `${f.id}@${f.version}`).join(", ") || "(none)"}`,
    );
    if (i.deny_rules_count !== null) {
      sections.push(`    deny_rules:     ${i.deny_rules_count}`);
    }
    if (i.shim_real_binary) {
      sections.push(`    shim → real:    ${i.shim_real_binary}`);
    }
    sections.push("");
  }
  sections.push("Recent host events (sample, up to 10):");
  if (report.recent_events_sample.length === 0) {
    sections.push("  (none in last 24h)");
  } else {
    for (const evt of report.recent_events_sample) {
      sections.push(`  ${JSON.stringify(evt)}`);
    }
  }
  return sections.join("\n");
}

export type RunGovernStatusOptions = {
  cwd?: string;
  verbose?: boolean;
  json?: boolean;
};

export function runGovernStatus(options: RunGovernStatusOptions = {}): void {
  const report = buildGovernStatus({ cwd: options.cwd });
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(options.verbose ? formatVerbose(report) : formatCompact(report));
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
  // Filter to known CLIs so a corrupt or forward-compatible install
  // record doesn't crash the repair walk.
  const installed: Array<[GovernCli, GovernInstallRecord]> = Object.entries(
    state.installs,
  ).filter(
    (entry): entry is [GovernCli, GovernInstallRecord] =>
      ALL_CLIS.includes(entry[0] as GovernCli) && entry[1] !== undefined,
  );
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
  // Drop unknown CLI keys: runGovernInstall would throw on an unsupported
  // cli, but silently skipping is the right behaviour when sync runs in
  // the daemon — it's not a user typo to surface, just stale/forward
  // state we don't recognise.
  const targets = Object.keys(state.installs).filter((k): k is GovernCli =>
    ALL_CLIS.includes(k as GovernCli),
  );
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
