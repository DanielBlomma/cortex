import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveHookEntry } from "./project-runtime.mjs";

const HOOK_DEFS = [
  {
    event: "PreToolUse",
    matcher: "Edit|Write|Bash|MultiEdit",
    name: "pre-tool-use",
  },
  { event: "Stop", matcher: undefined, name: "stop" },
  { event: "SessionStart", matcher: undefined, name: "session-start" },
  { event: "SessionEnd", matcher: undefined, name: "session-end" },
  {
    event: "UserPromptSubmit",
    matcher: undefined,
    name: "user-prompt-submit",
  },
  { event: "PreCompact", matcher: undefined, name: "pre-compact" },
];

export async function runHookShim(args) {
  const name = args[0];
  if (!name) {
    throw new Error("Usage: cortex hook <name>");
  }
  const entry = resolveHookEntry(name);
  if (!fs.existsSync(entry)) {
    throw new Error(`Hook script not found: ${entry}`);
  }
  const child = spawn(process.execPath, [entry], { stdio: "inherit" });
  await new Promise((resolve) => {
    child.on("exit", (code) => {
      process.exit(code ?? 0);
      resolve(undefined);
    });
  });
}

function managedClaudeSettingsPath() {
  if (process.platform === "darwin") {
    return "/Library/Application Support/ClaudeCode/managed-settings.json";
  }
  if (process.platform === "linux") {
    return "/etc/claude-code/managed-settings.json";
  }
  return null;
}

function settingsPathFor(scope) {
  if (scope === "project") {
    return path.join(process.cwd(), ".claude", "settings.json");
  }
  let home = process.env.HOME || "";
  const isRoot = process.getuid && process.getuid() === 0;
  if (isRoot) {
    const sudoUidRaw = process.env.SUDO_UID;
    const sudoUid = sudoUidRaw ? parseInt(sudoUidRaw, 10) : NaN;
    if (Number.isFinite(sudoUid)) {
      try {
        home = os.userInfo({ uid: sudoUid }).homedir;
      } catch {
        // Fall back to HOME below.
      }
    }
  }
  return path.join(home, ".claude", "settings.json");
}

function readJsonSafe(file) {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function hookInstalledInSettings(settings, def) {
  const rows = settings.hooks?.[def.event] || [];
  return rows.some((row) =>
    (row.hooks?.[0]?.command || "").startsWith(`cortex hook ${def.name}`),
  );
}

function readManagedClaudeSettings() {
  const file = managedClaudeSettingsPath();
  if (!file) return { file: null, settings: {} };
  return { file, settings: readJsonSafe(file) };
}

export function hasManagedClaudeHooks() {
  const { settings } = readManagedClaudeSettings();
  if (settings.allowManagedHooksOnly !== true) return false;
  return HOOK_DEFS.every((def) => hookInstalledInSettings(settings, def));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export async function runHooksCommand(args) {
  const sub = args[0] || "status";
  const scope = args.includes("--project") ? "project" : "user";
  const target = settingsPathFor(scope);

  if (sub === "install") {
    const settings = readJsonSafe(target);
    settings.hooks = settings.hooks || {};
    for (const def of HOOK_DEFS) {
      const entry = {
        ...(def.matcher ? { matcher: def.matcher } : {}),
        hooks: [{ type: "command", command: `cortex hook ${def.name}` }],
      };
      const existing = settings.hooks[def.event] || [];
      const filtered = existing.filter((row) => {
        const cmd = row.hooks?.[0]?.command || "";
        return !cmd.startsWith("cortex hook ");
      });
      settings.hooks[def.event] = [...filtered, entry];
    }
    writeJson(target, settings);
    console.log(`Installed cortex hooks into ${target}`);
    console.log(`Hooks: ${HOOK_DEFS.map((def) => def.name).join(", ")}`);
    return;
  }
  if (sub === "uninstall") {
    const settings = readJsonSafe(target);
    if (settings.hooks) {
      for (const event of Object.keys(settings.hooks)) {
        settings.hooks[event] = (settings.hooks[event] || []).filter((row) => {
          const cmd = row.hooks?.[0]?.command || "";
          return !cmd.startsWith("cortex hook ");
        });
        if (settings.hooks[event].length === 0) {
          delete settings.hooks[event];
        }
      }
      if (Object.keys(settings.hooks).length === 0) {
        delete settings.hooks;
      }
    }
    writeJson(target, settings);
    console.log(`Removed cortex hooks from ${target}`);
    return;
  }
  if (sub === "status") {
    const settings = readJsonSafe(target);
    const managed =
      scope === "user"
        ? readManagedClaudeSettings()
        : { file: null, settings: {} };
    const installed = [];
    for (const def of HOOK_DEFS) {
      const userFound = hookInstalledInSettings(settings, def);
      const managedFound =
        scope === "user"
          ? hookInstalledInSettings(managed.settings, def)
          : false;
      const found = userFound || managedFound;
      let source = "";
      if (userFound && managedFound) source = "user+managed";
      else if (userFound) source = "user";
      else if (managedFound) source = "managed";
      installed.push({
        name: def.name,
        event: def.event,
        found,
        source,
      });
    }
    console.log(`Settings file: ${target}`);
    if (scope === "user" && managed.file) {
      console.log(`Managed settings: ${managed.file}`);
    }
    for (const row of installed) {
      console.log(
        `  ${row.found ? "✓" : "✗"} ${row.event} → ${row.name}${
          row.source ? ` (${row.source})` : ""
        }`,
      );
    }
    if (
      scope === "user" &&
      managed.settings.allowManagedHooksOnly === true
    ) {
      console.log(
        "  note: managed Claude hooks are authoritative; user hooks may be intentionally absent",
      );
    }
    return;
  }
  throw new Error(
    `Unknown hooks subcommand: ${sub}. Try install|uninstall|status`,
  );
}
