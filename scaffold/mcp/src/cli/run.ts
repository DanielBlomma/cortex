import { spawn } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { platform, tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

export type RunCli = "claude" | "codex" | "copilot";
export const RUN_CLIS: RunCli[] = ["claude", "codex", "copilot"];

export const SHIM_MARKER = "# cortex-shim-v1";

export function isCortexShim(filePath: string): boolean {
  try {
    return readFileSync(filePath, "utf8").includes(SHIM_MARKER);
  } catch {
    return false;
  }
}

export function findRealBinary(name: string, excludePaths: string[] = []): string | null {
  const exclusions = new Set(excludePaths);
  const pathDirs = (process.env.PATH ?? "").split(":");
  for (const dir of pathDirs) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (exclusions.has(candidate)) continue;
    if (!existsSync(candidate)) continue;
    if (isCortexShim(candidate)) continue;
    return candidate;
  }
  return null;
}

export function buildDarwinSandboxProfile(homeDir: string): string {
  return [
    "(version 1)",
    "(allow default)",
    "; Cortex Tier 2 (wrap) profile for Copilot CLI.",
    "; Deny writes to Copilot's mutable config locations so AI cannot",
    "; reconfigure itself out of governance.",
    `(deny file-write* (subpath "${homeDir}/.copilot"))`,
    `(deny file-write* (subpath "${homeDir}/.copilot.local"))`,
    '(deny file-write* (regex #"^/etc/copilot"))',
    "",
  ].join("\n");
}

export function buildLinuxBwrapArgs(
  homeDir: string,
  realBinary: string,
  args: string[],
): string[] {
  return [
    "--die-with-parent",
    "--unshare-user",
    "--ro-bind",
    "/",
    "/",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--bind",
    homeDir,
    homeDir,
    "--tmpfs",
    `${homeDir}/.copilot`,
    "--tmpfs",
    `${homeDir}/.copilot.local`,
    "--ro-bind",
    "/etc",
    "/etc",
    "--",
    realBinary,
    ...args,
  ];
}

export type RunOptions = {
  cli: RunCli;
  args: string[];
  realBinary?: string;
  excludePaths?: string[];
};

function spawnAndWait(cmd: string, args: string[], extraEnv?: Record<string, string>): Promise<number> {
  return new Promise((resolve) => {
    const env = extraEnv ? { ...process.env, ...extraEnv } : process.env;
    const child = spawn(cmd, args, { stdio: "inherit", env });
    child.on("exit", (code, signal) => {
      if (signal) resolve(128);
      else resolve(code ?? 1);
    });
    child.on("error", (err) => {
      console.error(`✗ Failed to spawn ${cmd}: ${err.message}`);
      resolve(127);
    });
  });
}

export async function runAiCli(options: RunOptions): Promise<number> {
  const { cli, args } = options;
  const real =
    options.realBinary ?? findRealBinary(cli, options.excludePaths ?? []);
  if (!real) {
    const exclusions = options.excludePaths?.length
      ? ` (excluding ${options.excludePaths.join(", ")})`
      : "";
    console.error(`✗ Could not find '${cli}' binary in PATH${exclusions}.`);
    return 127;
  }

  if (cli !== "copilot") {
    return spawnAndWait(real, args);
  }

  const home = process.env.HOME ?? "";
  if (!home) {
    console.error("✗ HOME not set — required for Copilot wrap profile.");
    return 1;
  }

  const proxyPort = process.env.CORTEX_EGRESS_PROXY_PORT ?? "18888";
  const proxyEnv: Record<string, string> = {
    HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
    HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
    https_proxy: `http://127.0.0.1:${proxyPort}`,
    http_proxy: `http://127.0.0.1:${proxyPort}`,
  };

  const os = platform();
  if (os === "darwin") {
    const profile = buildDarwinSandboxProfile(home);
    const tmpProfile = join(tmpdir(), `cortex-copilot-${randomUUID()}.sb`);
    writeFileSync(tmpProfile, profile);
    try {
      return await spawnAndWait("sandbox-exec", ["-f", tmpProfile, real, ...args], proxyEnv);
    } finally {
      try {
        unlinkSync(tmpProfile);
      } catch {
        // best-effort cleanup
      }
    }
  }
  if (os === "linux") {
    return spawnAndWait("bwrap", buildLinuxBwrapArgs(home, real, args), proxyEnv);
  }
  console.error(`✗ Tier 2 (wrap) for copilot not yet supported on ${os}.`);
  return 1;
}

const DEFAULT_COPILOT_SHIM_PATHS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "/usr/local/bin/copilot",
  linux: "/usr/local/bin/copilot",
};

export function getDefaultCopilotShimPath(os: NodeJS.Platform): string {
  const path = DEFAULT_COPILOT_SHIM_PATHS[os];
  if (!path) {
    throw new Error(`copilot shim install not yet supported on ${os}`);
  }
  return path;
}

export function buildCopilotShim(realBinary: string): string {
  return [
    "#!/bin/sh",
    SHIM_MARKER,
    "# Cortex Tier 2 wrap shim — re-execs through 'cortex run copilot'.",
    "# Direct invocations of copilot are routed through cortex's OS sandbox.",
    `# Real binary captured at install time: ${realBinary}`,
    "",
    'CORTEX="${CORTEX_BIN:-cortex}"',
    'exec "$CORTEX" run copilot "$@"',
    "",
  ].join("\n");
}

export type InstallShimOptions = {
  shimPath?: string;
  realBinary?: string;
  searchPath?: string;
};

export type InstallShimResult = {
  ok: boolean;
  message: string;
  shimPath?: string;
  realBinary?: string;
};

export function installCopilotShim(options: InstallShimOptions = {}): InstallShimResult {
  const shimPath = options.shimPath ?? getDefaultCopilotShimPath(platform());
  const search = options.searchPath ?? process.env.PATH ?? "";
  const real =
    options.realBinary ??
    findRealBinaryIn(search, "copilot", [shimPath]);
  if (!real) {
    return {
      ok: false,
      message:
        `Copilot CLI not found in PATH (excluding ${shimPath}). ` +
        "Install GitHub Copilot CLI first, then re-run cortex enterprise sync.",
    };
  }
  if (existsSync(shimPath) && !isCortexShim(shimPath)) {
    return {
      ok: false,
      message:
        `${shimPath} exists and is not a cortex shim — refusing to overwrite. ` +
        "Move/rename the existing file, then re-run.",
    };
  }
  try {
    mkdirSync(dirname(shimPath), { recursive: true });
    writeFileSync(shimPath, buildCopilotShim(real));
    chmodSync(shimPath, 0o755);
  } catch (err) {
    return {
      ok: false,
      message: `Failed to write shim at ${shimPath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return {
    ok: true,
    message: `Installed copilot shim at ${shimPath} (real binary: ${real})`,
    shimPath,
    realBinary: real,
  };
}

function findRealBinaryIn(
  searchPath: string,
  name: string,
  excludePaths: string[],
): string | null {
  const exclusions = new Set(excludePaths);
  for (const dir of searchPath.split(":")) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (exclusions.has(candidate)) continue;
    if (!existsSync(candidate)) continue;
    if (isCortexShim(candidate)) continue;
    return candidate;
  }
  return null;
}

export function uninstallCopilotShim(shimPath?: string): { ok: boolean; message: string } {
  const target = shimPath ?? getDefaultCopilotShimPath(platform());
  if (!existsSync(target)) {
    return { ok: true, message: `${target} already absent.` };
  }
  if (!isCortexShim(target)) {
    return {
      ok: false,
      message: `${target} is no longer a cortex shim — refusing to delete (would clobber a real binary).`,
    };
  }
  try {
    unlinkSync(target);
  } catch (err) {
    return {
      ok: false,
      message: `Failed to remove ${target}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { ok: true, message: `Removed copilot shim at ${target}` };
}
