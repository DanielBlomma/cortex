import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { loadEnterpriseConfig } from "../core/config.js";
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

const SUPPORTED_CLIS = ["claude", "codex"] as const;
type SkillCli = (typeof SUPPORTED_CLIS)[number];

type ManifestEntry = {
  name: string;
  scope: string;
  updated_at: string;
};

type LocalSkillRecord = {
  scope: string;
  updated_at: string;
  path: string;
};

type LocalSkillsState = {
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
    return { skills: parsed.skills ?? {}, last_synced_at: parsed.last_synced_at };
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
 * Resolve the on-disk SKILL.md path for a skill. Global skills live under
 * ~/.claude/skills (Claude Code's user-scope skills directory); cli:codex
 * skills live under ~/.codex/skills. cli:claude scope is treated as
 * Claude-only and lands in ~/.claude/skills.
 */
function skillFilePath(scope: string, name: string): string {
  const root =
    scope === "cli:codex"
      ? join(homedir(), ".codex", "skills")
      : join(homedir(), ".claude", "skills");
  return join(root, name, "SKILL.md");
}

function shouldSyncForCli(scope: string, cli: SkillCli): boolean {
  if (scope === "global") return true;
  return scope === `cli:${cli}`;
}

async function fetchManifest(
  baseUrl: string,
  apiKey: string,
  cli: SkillCli,
): Promise<ManifestEntry[]> {
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
  const body = (await res.json()) as { skills?: ManifestEntry[] };
  return body.skills ?? [];
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

function writeSkillFile(path: string, content: string): void {
  const dir = path.replace(/\/SKILL\.md$/, "");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, content, "utf8");
}

function removeSkillFile(path: string): void {
  if (!existsSync(path)) return;
  // Remove the per-skill directory (parent of SKILL.md). The skills root
  // is shared with non-Cortex skills so we never recurse beyond the
  // skill's own directory.
  const dir = path.replace(/\/SKILL\.md$/, "");
  rmSync(dir, { recursive: true, force: true });
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

  let manifest: ManifestEntry[];
  try {
    manifest = await fetchManifest(baseUrl, apiKey, cli);
  } catch (err) {
    return {
      kind: "failed",
      cli,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const state = readState();
  const relevantManifest = manifest.filter((entry) =>
    shouldSyncForCli(entry.scope, cli),
  );
  const remoteByName = new Map(relevantManifest.map((e) => [e.name, e]));

  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];

  // Detect adds + changes
  for (const entry of relevantManifest) {
    const local = state.skills[entry.name];
    const isNew = !local;
    const isChanged =
      Boolean(local) &&
      (local.updated_at !== entry.updated_at || local.scope !== entry.scope);
    if (!isNew && !isChanged) continue;

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

    const path = skillFilePath(entry.scope, entry.name);
    try {
      writeSkillFile(path, body);
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

    state.skills[entry.name] = {
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
  for (const [name, record] of Object.entries(state.skills)) {
    if (!shouldSyncForCli(record.scope, cli)) continue;
    if (remoteByName.has(name)) continue;
    try {
      removeSkillFile(record.path);
    } catch {
      // best-effort; if unlink fails the next tick will retry
    }
    delete state.skills[name];
    removed.push(name);
  }

  const totalChanged = added.length + changed.length + removed.length;
  if (totalChanged === 0) {
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
