import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir, hostname } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { loadEnterpriseConfig } from "../core/config.js";
import { matchesEnterpriseHostIdentity } from "../core/enterprise-host-identity.js";
import {
  enterpriseCredentialId,
  isAllowedLicenseEndpoint,
} from "../core/license.js";
import { writeHostAuditEvent } from "./ungoverned-scanner.js";
import { daemonDir } from "./paths.js";

/**
 * Skills v3 sync flow — daemon side.
 *
 * The daemon polls cortex-web /api/v1/govern/skills/manifest each tick to
 * learn what skills the org has authored. It diffs against a local state
 * file, then for each new/changed skill it fetches the assembled SKILL.md
 * and writes it to the appropriate per-CLI skills directory. Removed
 * skills are unlinked. Unlike govern-config sync, this does NOT need
 * root: SKILL.md files live in user-owned directories the daemon can
 * write to directly.
 *
 * Three audit outcomes per tick:
 *  - skills_unchanged   — manifest matches local state
 *  - skills_synced      — at least one skill was written or removed
 *                         (metadata: added/changed/removed counts)
 *  - skills_sync_failed — network / auth / disk error
 *
 * When something changes, a notification file is written so
 * 'cortex enterprise status' can prompt the user to restart Claude
 * Code / Codex CLI to pick up the new skills.
 */

const STATE_FILENAME = "skills.local.json";
const NOTIFICATION_FILENAME = ".skills-update-applied.json";
const OWNERSHIP_FILENAME = ".cortex-managed.json";
const OWNERSHIP_VERSION = 1;

const SUPPORTED_CLIS = ["claude", "codex"] as const;
type SkillCli = (typeof SUPPORTED_CLIS)[number];

const SKILL_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

type ManifestEntry = {
  name: string;
  scope: string;
  updated_at: string;
};

type LocalSkillRecord = {
  credential_id?: string;
  cli: SkillCli;
  scope: string;
  updated_at: string;
  path: string;
};

type LocalSkillsState = {
  credential_id?: string;
  skills: Record<string, LocalSkillRecord>;
  last_synced_at?: string;
};

export type SkillSyncOutcome =
  | {
      kind: "unchanged";
      cli: SkillCli;
      count: number;
    }
  | {
      kind: "synced";
      cli: SkillCli;
      added: string[];
      changed: string[];
      removed: string[];
    }
  | {
      kind: "failed";
      cli: SkillCli;
      error: string;
    };

function stateFilePath(): string {
  return join(daemonDir(), STATE_FILENAME);
}

function notificationFilePath(): string {
  return join(daemonDir(), NOTIFICATION_FILENAME);
}

function readState(): LocalSkillsState {
  const path = stateFilePath();
  if (!existsSync(path)) return { skills: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as LocalSkillsState;
    const normalizedSkills: Record<string, LocalSkillRecord> = {};
    for (const [key, record] of Object.entries(parsed.skills ?? {})) {
      if (!record || typeof record !== "object") continue;
      const inferredCli =
        record.path?.includes("/.codex/skills/")
          ? "codex"
          : "claude";
      const cli =
        record.cli === "codex" || record.cli === "claude"
          ? record.cli
          : inferredCli;
      const normalizedKey = key.includes(":") ? key : `${cli}:${key}`;
      normalizedSkills[normalizedKey] = {
        credential_id:
          typeof record.credential_id === "string"
            ? record.credential_id
            : undefined,
        cli,
        scope: String(record.scope ?? "global"),
        updated_at: String(record.updated_at ?? ""),
        path: String(record.path ?? ""),
      };
    }
    return {
      credential_id:
        typeof parsed.credential_id === "string"
          ? parsed.credential_id
          : undefined,
      skills: normalizedSkills,
      last_synced_at: parsed.last_synced_at,
    };
  } catch {
    return { skills: {} };
  }
}

function writeState(state: LocalSkillsState): void {
  writeFileSync(
    stateFilePath(),
    JSON.stringify(state, null, 2) + "\n",
    "utf8",
  );
}

/**
 * Resolve the on-disk SKILL.md path for a skill install target. Global
 * skills are installed once per CLI, so the destination root depends on the
 * active sync target rather than just the stored scope.
 */
function isSafeSkillName(name: unknown): name is string {
  return typeof name === "string" && SKILL_NAME_RE.test(name);
}

function assertPathContained(root: string, target: string): void {
  const rel = relative(root, target);
  if (
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel)
  ) {
    throw new Error("skill target escapes managed root");
  }
}

function configuredSkillRoot(cli: SkillCli): string {
  return join(
    realpathSync(homedir()),
    cli === "codex" ? ".codex" : ".claude",
    "skills",
  );
}

function assertNotSymlink(path: string, description: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error(`${description} must not be a symbolic link`);
  }
}

function resolveSkillRoot(cli: SkillCli, create: boolean): string | null {
  const root = configuredSkillRoot(cli);
  const cliRoot = resolve(root, "..");
  assertNotSymlink(cliRoot, `${cli} configuration directory`);
  if (!existsSync(cliRoot)) {
    if (!create) return null;
    mkdirSync(cliRoot, { mode: 0o700 });
  }
  if (!lstatSync(cliRoot).isDirectory()) {
    throw new Error(`${cli} configuration path is not a directory`);
  }

  assertNotSymlink(root, `${cli} skills root`);
  if (!existsSync(root)) {
    if (!create) return null;
    mkdirSync(root, { mode: 0o700 });
  }
  if (!lstatSync(root).isDirectory()) {
    throw new Error(`${cli} skills root is not a directory`);
  }
  return realpathSync(root);
}

function skillFilePath(root: string, name: string): string {
  if (!isSafeSkillName(name)) {
    throw new Error("invalid skill name");
  }
  const target = resolve(root, name, "SKILL.md");
  assertPathContained(resolve(root), target);
  return target;
}

function stateSkillKey(cli: SkillCli, name: string): string {
  return `${cli}:${name}`;
}

function shouldSyncForCli(scope: string, cli: SkillCli): boolean {
  if (scope === "global") return true;
  return scope === `cli:${cli}`;
}

async function fetchManifest(
  baseUrl: string,
  apiKey: string,
  cli: SkillCli,
): Promise<unknown[]> {
  const url = new URL(
    baseUrl.replace(/\/$/, "") + "/api/v1/govern/skills/manifest",
  );
  url.searchParams.set("cli", cli);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { skills?: unknown };
  if (body.skills === undefined) return [];
  if (!Array.isArray(body.skills)) {
    throw new Error("invalid skill manifest: skills must be an array");
  }
  return body.skills;
}

async function fetchSkillBody(
  baseUrl: string,
  apiKey: string,
  name: string,
): Promise<string> {
  const url = new URL(
    baseUrl.replace(/\/$/, "") +
      "/api/v1/govern/skills/" +
      encodeURIComponent(name),
  );
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return res.text();
}

function validateManifest(
  manifest: unknown[],
  cli: SkillCli,
): ManifestEntry[] {
  const validated: ManifestEntry[] = [];
  const names = new Set<string>();
  for (let index = 0; index < manifest.length; index += 1) {
    const raw = manifest[index];
    if (!raw || typeof raw !== "object") {
      throw new Error(`invalid skill manifest entry at index ${index}`);
    }
    const entry = raw as Record<string, unknown>;
    if (!isSafeSkillName(entry.name)) {
      throw new Error(`invalid skill name at manifest index ${index}`);
    }
    if (
      entry.scope !== "global" &&
      entry.scope !== "cli:claude" &&
      entry.scope !== "cli:codex"
    ) {
      throw new Error(`invalid skill scope at manifest index ${index}`);
    }
    if (typeof entry.updated_at !== "string" || !entry.updated_at.trim()) {
      throw new Error(`invalid skill timestamp at manifest index ${index}`);
    }
    if (shouldSyncForCli(entry.scope, cli)) {
      if (names.has(entry.name)) {
        throw new Error(`duplicate skill name at manifest index ${index}`);
      }
      names.add(entry.name);
    }
    validated.push({
      name: entry.name,
      scope: entry.scope,
      updated_at: entry.updated_at,
    });
  }
  return validated;
}

type OwnershipMarker = {
  version: number;
  manager: string;
  cli: SkillCli;
  name: string;
};

function ownershipMarker(cli: SkillCli, name: string): OwnershipMarker {
  return {
    version: OWNERSHIP_VERSION,
    manager: "cortex",
    cli,
    name,
  };
}

function assertCortexOwnedSkillDir(
  skillDir: string,
  cli: SkillCli,
  name: string,
): void {
  const markerPath = join(skillDir, OWNERSHIP_FILENAME);
  if (!existsSync(markerPath) || lstatSync(markerPath).isSymbolicLink()) {
    throw new Error("skill directory is not owned by Cortex");
  }
  let parsed: Partial<OwnershipMarker>;
  try {
    parsed = JSON.parse(readFileSync(markerPath, "utf8")) as Partial<OwnershipMarker>;
  } catch {
    throw new Error("skill directory has an invalid Cortex ownership marker");
  }
  if (
    parsed.version !== OWNERSHIP_VERSION ||
    parsed.manager !== "cortex" ||
    parsed.cli !== cli ||
    parsed.name !== name
  ) {
    throw new Error("skill directory has an invalid Cortex ownership marker");
  }
}

function preflightSkillWrite(
  cli: SkillCli,
  name: string,
): { root: string; skillDir: string; target: string } {
  const root = resolveSkillRoot(cli, true);
  if (!root) throw new Error("skill root could not be created");
  const target = skillFilePath(root, name);
  const skillDir = resolve(root, name);
  assertPathContained(root, skillDir);
  if (!existsSync(skillDir)) return { root, skillDir, target };

  const stat = lstatSync(skillDir);
  if (stat.isSymbolicLink()) {
    throw new Error("skill directory must not be a symbolic link");
  }
  if (!stat.isDirectory()) {
    throw new Error("managed skill target is not a directory");
  }
  assertCortexOwnedSkillDir(skillDir, cli, name);
  const existingSkillFile = join(skillDir, "SKILL.md");
  if (
    existsSync(existingSkillFile) &&
    lstatSync(existingSkillFile).isSymbolicLink()
  ) {
    throw new Error("skill file must not be a symbolic link");
  }
  return { root, skillDir, target };
}

function writeSkillFile(
  cli: SkillCli,
  name: string,
  content: string,
): string {
  const {
    root,
    skillDir,
    target: lexicalTarget,
  } = preflightSkillWrite(cli, name);

  let created = false;
  if (existsSync(skillDir)) {
    const stat = lstatSync(skillDir);
    if (stat.isSymbolicLink()) {
      throw new Error("skill directory must not be a symbolic link");
    }
    if (!stat.isDirectory()) {
      throw new Error("managed skill target is not a directory");
    }
    assertCortexOwnedSkillDir(skillDir, cli, name);
  } else {
    mkdirSync(skillDir, { mode: 0o700 });
    created = true;
    writeFileSync(
      join(skillDir, OWNERSHIP_FILENAME),
      JSON.stringify(ownershipMarker(cli, name), null, 2) + "\n",
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
  }

  const realSkillDir = realpathSync(skillDir);
  assertPathContained(root, realSkillDir);
  const target = join(realSkillDir, "SKILL.md");
  assertPathContained(root, target);
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
    throw new Error("skill file must not be a symbolic link");
  }

  const temporaryTarget = join(
    realSkillDir,
    `.SKILL.md.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    writeFileSync(temporaryTarget, content, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporaryTarget, target);
  } catch (err) {
    if (existsSync(temporaryTarget)) unlinkSync(temporaryTarget);
    if (created) {
      const entries = readdirSync(skillDir);
      if (
        entries.length === 1 &&
        entries[0] === OWNERSHIP_FILENAME
      ) {
        unlinkSync(join(skillDir, OWNERSHIP_FILENAME));
        rmdirSync(skillDir);
      }
    }
    throw err;
  }
  return lexicalTarget;
}

function removeSkillFile(cli: SkillCli, name: string): void {
  if (!isSafeSkillName(name)) {
    throw new Error("invalid skill name");
  }
  const root = resolveSkillRoot(cli, false);
  if (!root) return;
  const skillDir = resolve(root, name);
  assertPathContained(root, skillDir);
  if (!existsSync(skillDir)) return;

  const stat = lstatSync(skillDir);
  if (stat.isSymbolicLink()) {
    throw new Error("skill directory must not be a symbolic link");
  }
  if (!stat.isDirectory()) {
    throw new Error("managed skill target is not a directory");
  }
  assertPathContained(root, realpathSync(skillDir));
  assertCortexOwnedSkillDir(skillDir, cli, name);

  const entries = readdirSync(skillDir);
  const unexpected = entries.filter(
    (entry) => entry !== OWNERSHIP_FILENAME && entry !== "SKILL.md",
  );
  if (unexpected.length > 0) {
    throw new Error("managed skill directory contains unowned files");
  }
  const skillPath = join(skillDir, "SKILL.md");
  if (existsSync(skillPath)) {
    if (lstatSync(skillPath).isSymbolicLink()) {
      throw new Error("skill file must not be a symbolic link");
    }
    unlinkSync(skillPath);
  }
  unlinkSync(join(skillDir, OWNERSHIP_FILENAME));
  rmdirSync(skillDir);
}

function writeNotification(data: {
  added: number;
  changed: number;
  removed: number;
  cli: SkillCli;
  detected_at: string;
}): void {
  writeFileSync(
    notificationFilePath(),
    JSON.stringify(data, null, 2) + "\n",
    "utf8",
  );
}

export async function runSkillSyncForCli(
  cwd: string,
  cli: SkillCli,
): Promise<SkillSyncOutcome> {
  const config = loadEnterpriseConfig(join(cwd, ".context"));
  const apiKey = config.enterprise.api_key.trim();
  const baseUrl = (config.enterprise.base_url || config.enterprise.endpoint).trim();
  if (!apiKey || !baseUrl) {
    return { kind: "failed", cli, error: "enterprise not configured" };
  }
  if (!isAllowedLicenseEndpoint(baseUrl)) {
    return { kind: "failed", cli, error: "insecure or invalid enterprise endpoint" };
  }

  const credentialId = enterpriseCredentialId(baseUrl, apiKey);
  if (!matchesEnterpriseHostIdentity(credentialId)) {
    return {
      kind: "failed",
      cli,
      error:
        "enterprise identity conflict: this user profile is already enrolled to another endpoint or API key",
    };
  }
  const state = readState();
  const identityChanged = state.credential_id !== credentialId;
  let stateSanitized = identityChanged;
  state.credential_id = credentialId;

  let manifest: ManifestEntry[];
  try {
    manifest = validateManifest(
      await fetchManifest(baseUrl, apiKey, cli),
      cli,
    );
  } catch (err) {
    return {
      kind: "failed",
      cli,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const relevantManifest = manifest.filter((entry) =>
    shouldSyncForCli(entry.scope, cli),
  );
  const remoteByName = new Map(relevantManifest.map((e) => [e.name, e]));

  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  // Detect adds + changes
  for (const entry of relevantManifest) {
    const skillKey = stateSkillKey(cli, entry.name);
    const local = state.skills[skillKey];
    const isNew = !local;
    const isChanged =
      Boolean(local) &&
      (
        identityChanged ||
        local.credential_id !== credentialId ||
        local.updated_at !== entry.updated_at ||
        local.scope !== entry.scope
      );
    if (!isNew && !isChanged) continue;

    try {
      preflightSkillWrite(cli, entry.name);
    } catch (err) {
      return {
        kind: "failed",
        cli,
        error:
          err instanceof Error
            ? `preflight ${entry.name}: ${err.message}`
            : `preflight ${entry.name}: ${String(err)}`,
      };
    }

    let body: string;
    try {
      body = await fetchSkillBody(baseUrl, apiKey, entry.name);
    } catch (err) {
      return {
        kind: "failed",
        cli,
        error:
          err instanceof Error
            ? `fetch ${entry.name}: ${err.message}`
            : `fetch ${entry.name}: ${String(err)}`,
      };
    }

    let path: string;
    try {
      path = writeSkillFile(cli, entry.name, body);
    } catch (err) {
      return {
        kind: "failed",
        cli,
        error:
          err instanceof Error
            ? `write ${entry.name}: ${err.message}`
            : `write ${entry.name}: ${String(err)}`,
      };
    }

    state.skills[skillKey] = {
      credential_id: credentialId,
      cli,
      scope: entry.scope,
      updated_at: entry.updated_at,
      path,
    };
    (isNew ? added : changed).push(entry.name);
  }

  // Detect removes — entries we have locally for this cli but the manifest
  // dropped (or disabled). We only consider state entries whose scope
  // matches this cli, so we don't accidentally remove the other CLI's
  // skills when running a per-cli tick.
  for (const [skillKey, record] of Object.entries(state.skills)) {
    if (record.cli !== cli) continue;
    const [, name] = skillKey.split(":", 2);
    if (!name) continue;
    if (!isSafeSkillName(name)) {
      // State from an older vulnerable version is not deletion authority.
      // Drop the record without touching its persisted absolute path.
      delete state.skills[skillKey];
      stateSanitized = true;
      continue;
    }
    if (!shouldSyncForCli(record.scope, cli)) continue;
    if (remoteByName.has(name)) continue;
    try {
      removeSkillFile(cli, name);
    } catch (err) {
      return {
        kind: "failed",
        cli,
        error:
          err instanceof Error
            ? `remove ${name}: ${err.message}`
            : `remove ${name}: ${String(err)}`,
      };
    }
    delete state.skills[skillKey];
    removed.push(name);
  }

  const totalChanged = added.length + changed.length + removed.length;
  if (totalChanged === 0) {
    if (stateSanitized) {
      state.last_synced_at = new Date().toISOString();
      writeState(state);
    }
    return { kind: "unchanged", cli, count: relevantManifest.length };
  }

  state.last_synced_at = new Date().toISOString();
  writeState(state);
  return { kind: "synced", cli, added, changed, removed };
}

export async function runSkillSyncOnce(
  cwd: string,
  clis: ReadonlyArray<SkillCli> = SUPPORTED_CLIS,
): Promise<SkillSyncOutcome[]> {
  const outcomes: SkillSyncOutcome[] = [];
  const now = new Date().toISOString();

  for (const cli of clis) {
    const outcome = await runSkillSyncForCli(cwd, cli);
    outcomes.push(outcome);

    const eventBase = {
      timestamp: now,
      host_id: hostname(),
      cli,
    };

    if (outcome.kind === "unchanged") {
      await writeHostAuditEvent(cwd, {
        ...eventBase,
        event_type: "skills_unchanged",
        count: outcome.count,
      }).catch(() => undefined);
    } else if (outcome.kind === "synced") {
      await writeHostAuditEvent(cwd, {
        ...eventBase,
        event_type: "skills_synced",
        added: outcome.added,
        changed: outcome.changed,
        removed: outcome.removed,
      }).catch(() => undefined);
      writeNotification({
        added: outcome.added.length,
        changed: outcome.changed.length,
        removed: outcome.removed.length,
        cli,
        detected_at: now,
      });
    } else {
      await writeHostAuditEvent(cwd, {
        ...eventBase,
        event_type: "skills_sync_failed",
        error: outcome.error,
      }).catch(() => undefined);
    }
  }

  // We deliberately leave the notification file in place when this tick
  // had no changes — it represents "restart pending" from a prior sync,
  // not current drift. `cortex enterprise status --acknowledge-skills`
  // (future CLI) will be the explicit clear path.

  return outcomes;
}

export type SkillSyncTimerHandle = {
  stop(): void;
};

export function startSkillSyncTimer(
  cwd: string,
  intervalMs: number,
): SkillSyncTimerHandle {
  const tick = () => {
    void runSkillSyncOnce(cwd).catch((err) => {
      process.stderr.write(
        `[cortex-daemon] skill sync failed: ${
          err instanceof Error ? err.message : String(err)
        }\n`,
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
