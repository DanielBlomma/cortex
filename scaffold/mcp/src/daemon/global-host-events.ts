import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadEnterpriseConfig } from "../core/config.js";
import {
  enterpriseCredentialId,
  isAllowedLicenseEndpoint,
} from "../core/license.js";
import { matchesEnterpriseHostIdentity } from "../core/enterprise-host-identity.js";

type GlobalHostEvent = Record<string, unknown> & {
  event_type: "ungoverned_ai_session_detected";
  timestamp: string;
  credential_id: string;
};

type GlobalCursor = {
  version: 1;
  credential_id: string;
  ungoverned_last_key?: string;
};

const EVENT_FILE_RE = /^ungoverned-\d{4}-\d{2}-\d{2}\.jsonl$/;
const CURSOR_FILENAME = "global-host-events-cursor.json";

function configuredHome(): string {
  return process.env.HOME?.trim() || homedir();
}

function globalEventDir(create: boolean): string | null {
  try {
    const home = realpathSync(configuredHome());
    const cortexDir = join(home, ".cortex");
    if (!existsSync(cortexDir)) return null;
    const cortexStat = lstatSync(cortexDir);
    if (!cortexStat.isDirectory() || cortexStat.isSymbolicLink()) return null;
    if (realpathSync(cortexDir) !== cortexDir) return null;

    const dir = join(cortexDir, "host-events");
    if (existsSync(dir)) {
      const stat = lstatSync(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
      if (realpathSync(dir) !== dir) return null;
      chmodSync(dir, 0o700);
      return dir;
    }
    if (!create) return null;
    mkdirSync(dir, { mode: 0o700 });
    chmodSync(dir, 0o700);
    return dir;
  } catch {
    return null;
  }
}

function eventKey(event: GlobalHostEvent): string {
  const pid =
    typeof event.pid === "number" || typeof event.pid === "string"
      ? String(event.pid)
      : "0";
  return `${event.timestamp}#${pid}`;
}

export function writeGlobalUngovernedEvent(
  credentialId: string,
  event: Omit<GlobalHostEvent, "credential_id">,
): boolean {
  if (!matchesEnterpriseHostIdentity(credentialId)) return false;
  const dir = globalEventDir(true);
  if (!dir) return false;
  const date = new Date().toISOString().slice(0, 10);
  const path = join(dir, `ungoverned-${date}.jsonl`);
  let fd: number | null = null;
  try {
    fd = openSync(
      path,
      constants.O_WRONLY |
        constants.O_APPEND |
        constants.O_CREAT |
        constants.O_NOFOLLOW,
      0o600,
    );
    fchmodSync(fd, 0o600);
    writeSync(
      fd,
      JSON.stringify({ ...event, credential_id: credentialId }) + "\n",
      undefined,
      "utf8",
    );
    closeSync(fd);
    return true;
  } catch {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Best effort.
      }
    }
    return false;
  }
}

function readCursor(dir: string, credentialId: string): GlobalCursor {
  const path = join(dir, CURSOR_FILENAME);
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return { version: 1, credential_id: credentialId };
    }
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<GlobalCursor>;
    if (
      parsed.version !== 1 ||
      parsed.credential_id !== credentialId ||
      (parsed.ungoverned_last_key !== undefined &&
        typeof parsed.ungoverned_last_key !== "string")
    ) {
      return { version: 1, credential_id: credentialId };
    }
    return parsed as GlobalCursor;
  } catch {
    return { version: 1, credential_id: credentialId };
  }
}

function writeCursor(dir: string, cursor: GlobalCursor): void {
  const path = join(dir, CURSOR_FILENAME);
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(
      temporaryPath,
      JSON.stringify(cursor, null, 2) + "\n",
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, path);
    chmodSync(path, 0o600);
  } catch (err) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // Best effort.
    }
    throw err;
  }
}

function readEvents(dir: string, credentialId: string): GlobalHostEvent[] {
  const events: GlobalHostEvent[] = [];
  for (const name of readdirSync(dir).filter((entry) => EVENT_FILE_RE.test(entry)).sort()) {
    const path = join(dir, name);
    try {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      for (const line of readFileSync(path, "utf8").split("\n")) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line) as Partial<GlobalHostEvent>;
        if (
          parsed.event_type !== "ungoverned_ai_session_detected" ||
          parsed.credential_id !== credentialId ||
          typeof parsed.timestamp !== "string"
        ) {
          continue;
        }
        events.push(parsed as GlobalHostEvent);
      }
    } catch {
      // Skip malformed or concurrently changing files.
    }
  }
  return events.sort((a, b) => eventKey(a).localeCompare(eventKey(b)));
}

export async function pushGlobalUngovernedEvents(
  cwd: string,
  credentialId: string,
): Promise<{ pushed: number; error?: string }> {
  if (!matchesEnterpriseHostIdentity(credentialId)) {
    return { pushed: 0, error: "enterprise identity conflict" };
  }
  const config = loadEnterpriseConfig(join(cwd, ".context"));
  const apiKey = config.enterprise.api_key.trim();
  const baseUrl = (
    config.enterprise.base_url || config.enterprise.endpoint
  ).trim();
  if (
    !apiKey ||
    !baseUrl ||
    !isAllowedLicenseEndpoint(baseUrl) ||
    enterpriseCredentialId(baseUrl, apiKey) !== credentialId
  ) {
    return { pushed: 0, error: "enterprise identity conflict" };
  }
  const dir = globalEventDir(false);
  if (!dir) return { pushed: 0 };
  const cursor = readCursor(dir, credentialId);
  const events = readEvents(dir, credentialId).filter(
    (event) =>
      !cursor.ungoverned_last_key ||
      eventKey(event) > cursor.ungoverned_last_key,
  );
  if (events.length === 0) return { pushed: 0 };

  try {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/api/v1/govern/ungoverned`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          events: events.map((event) => ({
            detected_at: event.timestamp,
            host_id: event.host_id,
            cli: event.cli,
            binary_path: event.binary,
            args: event.args,
            sys_user: event.user,
            parent_pid: event.ppid,
            pid: event.pid,
            action_taken: event.action ?? "logged",
          })),
        }),
      },
    );
    if (!response.ok) {
      return {
        pushed: 0,
        error: `HTTP ${response.status} ${response.statusText}`,
      };
    }
    cursor.ungoverned_last_key = eventKey(events[events.length - 1]);
    writeCursor(dir, cursor);
    return { pushed: events.length };
  } catch (err) {
    return {
      pushed: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type GlobalHostEventsPusherHandle = {
  stop(): void;
};

export function startGlobalUngovernedEventsPusher(
  cwd: string,
  credentialId: string,
  intervalMs: number,
): GlobalHostEventsPusherHandle {
  const tick = () => {
    void pushGlobalUngovernedEvents(cwd, credentialId).then((outcome) => {
      if (outcome.error) {
        process.stderr.write(
          `[cortex-daemon] global host-events push failed: ${outcome.error}\n`,
        );
      }
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
