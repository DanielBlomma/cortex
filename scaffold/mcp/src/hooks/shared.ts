import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { call, isDaemonRunning, spawnDaemon } from "../daemon/client.js";
import { fileURLToPath } from "node:url";
import type { HeartbeatPayload, HeartbeatResult } from "../daemon/protocol.js";

/**
 * Shared utilities for hook scripts.
 *
 * Hook flow (Claude Code spec):
 *   1. Claude Code spawns the hook script with input JSON on stdin
 *   2. Hook reads stdin, makes a decision
 *   3. Hook prints JSON to stdout (or exits non-zero to block)
 *   4. exit 0 = allow, exit 2 = block, other non-zero = error
 */

export type HookInput = {
  // Claude Code's documented hook input shape — varies by hook type.
  // We read it as a generic record and let the hook narrow.
  [key: string]: unknown;
};

export async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    // If stdin is a TTY (running interactively for testing), don't hang.
    if (process.stdin.isTTY) resolve("");
  });
}

export function parseInput(raw: string): HookInput {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as HookInput;
  } catch {
    return {};
  }
}

/**
 * Detect whether the current project is running enterprise mode.
 * Lightweight YAML peek — we don't want to load the full config parser
 * on every hook invocation.
 */
export function isEnterpriseProject(cwd: string): boolean {
  const candidates = [
    join(cwd, ".context", "enterprise.yml"),
    join(cwd, ".context", "enterprise.yaml"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, "utf8");
      // Look for an api_key under enterprise: section.
      // Conservative: any non-empty api_key value implies "intent to be enterprise".
      const match = raw.match(/^\s*api_key:\s*(\S.*?)\s*$/m);
      if (match && match[1] && match[1] !== "") return true;
    } catch {
      // ignore
    }
  }
  return false;
}

export function ensureDaemon(daemonEntry: string): void {
  if (isDaemonRunning()) return;
  spawnDaemon(daemonEntry);
}

/**
 * Resolve daemon entry script path relative to this hook script's location.
 * Hooks live at dist/hooks/<name>.js, daemon at dist/daemon/main.js.
 */
export function resolveDaemonEntry(hookFileUrl: string): string {
  const hookPath = fileURLToPath(hookFileUrl);
  // dist/hooks/<x>.js → dist/daemon/main.js
  return join(hookPath, "..", "..", "daemon", "main.js");
}

/**
 * Send a heartbeat to the daemon for tamper-detection bookkeeping.
 * Failure to reach the daemon is non-fatal — daemon-down is treated as
 * "we don't know" rather than tamper. Returns whether the daemon
 * reported an active tamper-lock for this cwd.
 */
export async function sendHeartbeat(
  payload: Omit<HeartbeatPayload, "ts">,
): Promise<{ tamperLockActive: boolean }> {
  const result = await call<HeartbeatResult>(
    "heartbeat",
    { ...payload, ts: new Date().toISOString() } satisfies HeartbeatPayload,
    { timeoutMs: 1500 },
  );
  if (!result.ok) return { tamperLockActive: false };
  return { tamperLockActive: result.result.tamper_lock_active === true };
}

const TAMPER_LOCK_FILENAME = ".cortex-tamper.lock";

export function readTamperLockJson(cwd: string): unknown | null {
  const path = join(cwd, ".context", TAMPER_LOCK_FILENAME);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * True iff this cwd is in enforced govern mode. Reads govern.local.json,
 * which is written by the install/install-flow. We don't fall back to
 * enterprise.yml because the user's intent is captured at install time.
 */
export function isEnforcedMode(cwd: string): boolean {
  const path = join(cwd, ".context", "govern.local.json");
  if (!existsSync(path)) return false;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      installs?: Record<string, { mode?: string }>;
    };
    for (const inst of Object.values(parsed.installs ?? {})) {
      if (inst.mode === "enforced") return true;
    }
    return false;
  } catch {
    return false;
  }
}
