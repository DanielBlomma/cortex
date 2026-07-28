import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const SKILL_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const OWNERSHIP_FILENAME = ".cortex-managed.json";
const STATE_FILES = [
  "skills.local.json",
  "workflows.local.json",
  "capabilities.local.json",
  ".skills-update-applied.json",
] as const;

type SkillCli = "claude" | "codex";

type PurgeTarget = {
  dir: string;
  marker: string;
  skill: string | null;
};

function configuredHome(homeDir?: string): string {
  return homeDir ?? process.env.HOME?.trim() ?? homedir();
}

function safeDirectory(path: string): string | null {
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${path} is not a safe directory`);
  }
  const real = realpathSync(path);
  if (real !== path) throw new Error(`${path} is not a canonical directory`);
  return real;
}

function inspectManagedSkill(
  root: string,
  cli: SkillCli,
  name: string,
): PurgeTarget | null {
  if (!SKILL_NAME_RE.test(name)) {
    throw new Error("invalid managed skill name");
  }
  const dir = resolve(root, name);
  if (!dir.startsWith(`${root}/`)) {
    throw new Error("managed skill escapes its root");
  }
  const stat = lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("managed skill target is not a safe directory");
  }
  if (realpathSync(dir) !== dir) {
    throw new Error("managed skill target is not canonical");
  }
  const marker = join(dir, OWNERSHIP_FILENAME);
  if (!existsSync(marker)) return null;
  const markerStat = lstatSync(marker);
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) {
    throw new Error("managed skill ownership marker is unsafe");
  }
  const parsed = JSON.parse(readFileSync(marker, "utf8")) as {
    version?: unknown;
    manager?: unknown;
    cli?: unknown;
    name?: unknown;
  };
  if (
    parsed.version !== 1 ||
    parsed.manager !== "cortex" ||
    parsed.cli !== cli ||
    parsed.name !== name
  ) {
    throw new Error("managed skill ownership marker is invalid");
  }
  const entries = readdirSync(dir);
  const unexpected = entries.filter(
    (entry) => entry !== OWNERSHIP_FILENAME && entry !== "SKILL.md",
  );
  if (unexpected.length > 0) {
    throw new Error("managed skill directory contains unowned files");
  }
  const skill = join(dir, "SKILL.md");
  if (existsSync(skill)) {
    const skillStat = lstatSync(skill);
    if (!skillStat.isFile() || skillStat.isSymbolicLink()) {
      throw new Error("managed skill file is unsafe");
    }
  }
  return { dir, marker, skill: existsSync(skill) ? skill : null };
}

function recordedSkills(home: string): Array<{ cli: SkillCli; name: string }> {
  const statePath = join(home, ".cortex", "skills.local.json");
  if (!existsSync(statePath)) return [];
  const stat = lstatSync(statePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("skills state is unsafe");
  }
  const parsed = JSON.parse(readFileSync(statePath, "utf8")) as {
    skills?: Record<string, { cli?: unknown }>;
  };
  if (!parsed.skills || typeof parsed.skills !== "object") return [];
  const records: Array<{ cli: SkillCli; name: string }> = [];
  for (const [key, value] of Object.entries(parsed.skills)) {
    const [keyCli, name] = key.includes(":")
      ? key.split(":", 2)
      : [String(value?.cli ?? ""), key];
    if (
      (keyCli !== "claude" && keyCli !== "codex") ||
      !SKILL_NAME_RE.test(name)
    ) {
      throw new Error("skills state contains an unsafe record");
    }
    records.push({ cli: keyCli, name });
  }
  return records;
}

/**
 * Purge credential-specific artifacts before an explicit API-key rotation.
 * Every path is derived from the target user's home and every skill deletion
 * requires the Cortex ownership marker. Any ambiguity aborts rotation.
 */
export function prepareEnterpriseCredentialRotation(homeDir?: string): boolean {
  try {
    const home = realpathSync(configuredHome(homeDir));
    const cortexDir = safeDirectory(join(home, ".cortex"));
    if (!cortexDir) return true;

    const targets = new Map<string, PurgeTarget>();
    const recorded = recordedSkills(home);
    for (const cli of ["claude", "codex"] as const) {
      const cliDir = safeDirectory(join(home, cli === "codex" ? ".codex" : ".claude"));
      if (!cliDir) {
        if (recorded.some((record) => record.cli === cli)) return false;
        continue;
      }
      const root = safeDirectory(join(cliDir, "skills"));
      if (!root) {
        if (recorded.some((record) => record.cli === cli)) return false;
        continue;
      }
      for (const name of readdirSync(root)) {
        const candidate = join(root, name);
        const stat = lstatSync(candidate);
        if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
        const target = inspectManagedSkill(root, cli, name);
        if (target) targets.set(target.dir, target);
      }
      for (const record of recorded.filter((entry) => entry.cli === cli)) {
        const candidate = join(root, record.name);
        if (!existsSync(candidate)) continue;
        const target = inspectManagedSkill(root, cli, record.name);
        if (!target) {
          // Legacy state without an ownership marker is not deletion
          // authority. Abort and require the operator to resolve it.
          return false;
        }
        targets.set(target.dir, target);
      }
    }

    for (const target of targets.values()) {
      if (target.skill) unlinkSync(target.skill);
      unlinkSync(target.marker);
      rmdirSync(target.dir);
    }
    for (const filename of STATE_FILES) {
      const path = join(cortexDir, filename);
      if (existsSync(path)) unlinkSync(path);
    }
    return true;
  } catch {
    return false;
  }
}
