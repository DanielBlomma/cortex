import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { loadEnterpriseConfig } from "../core/config.js";

/**
 * Phase 7 sync flow — host-events pusher.
 *
 * The daemon writes ungoverned-session and hook-tamper events to
 * .context/audit/host-events-YYYY-MM-DD.jsonl. This pusher batches
 * unpushed events and POSTs them to the cortex-web govern endpoints.
 *
 * State (.context/.cortex-host-events-cursor.json) tracks the last
 * pushed timestamp per event_type so we don't double-push or skip.
 */

const CURSOR_FILENAME = ".cortex-host-events-cursor.json";

type Cursor = {
  ungoverned_last_ts?: string;
  tamper_last_ts?: string;
};

/**
 * Cursor format is `${ISO_TIMESTAMP}#${stable_id}` where stable_id is
 * the pid for ungoverned events and the session_id for tamper events.
 * The composite suffix breaks ties when two writers emit at the exact
 * same millisecond (clock resolution / two daemon producers).
 *
 * For backward compatibility, a persisted value with no `#` is treated
 * as `${ts}#~`: `~` sorts after every printable ASCII character we
 * actually emit, so an old cursor still skips all events at-or-before
 * its timestamp on the first read after upgrade.
 */
function readCursor(cwd: string): Cursor {
  const path = join(cwd, ".context", CURSOR_FILENAME);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Cursor;
  } catch {
    return {};
  }
}

function normalizeCursor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.includes("#") ? value : `${value}#~`;
}

function stableIdFor(evt: HostEvent): string {
  if (evt.event_type === "ungoverned_ai_session_detected") {
    const pid = evt.pid;
    if (typeof pid === "number") return String(pid);
    if (typeof pid === "string" && pid.length > 0) return pid;
    return "0";
  }
  if (evt.event_type === "hook_tamper_detected") {
    const sid = evt.session_id;
    if (typeof sid === "string" && sid.length > 0) return sid;
    return "";
  }
  return "";
}

function compositeKey(evt: HostEvent): string | null {
  const ts = eventTimestamp(evt);
  if (!ts) return null;
  return `${ts}#${stableIdFor(evt)}`;
}

function sortByTs<T extends HostEvent>(arr: T[]): T[] {
  return arr.sort((a, b) => {
    const ka = compositeKey(a) ?? "";
    const kb = compositeKey(b) ?? "";
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  });
}

function writeCursor(cwd: string, cursor: Cursor): void {
  const path = join(cwd, ".context", CURSOR_FILENAME);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cursor, null, 2) + "\n", "utf8");
}

type HostEvent = Record<string, unknown> & { event_type?: string; timestamp?: string };

function listHostEventFiles(cwd: string): string[] {
  const dir = join(cwd, ".context", "audit");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith("host-events-") && name.endsWith(".jsonl"))
    .sort()
    .map((name) => join(dir, name));
}

function readEventsFrom(file: string): HostEvent[] {
  if (!existsSync(file)) return [];
  const stat = statSync(file);
  if (!stat.isFile()) return [];
  const raw = readFileSync(file, "utf8");
  const out: HostEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as HostEvent);
    } catch {
      // skip malformed lines
    }
  }
  return out;
}

function eventTimestamp(e: HostEvent): string | null {
  const ts = e.timestamp ?? e.detected_at;
  return typeof ts === "string" ? ts : null;
}

function isAfterComposite(evt: HostEvent, cursor: string | undefined): boolean {
  if (!cursor) return true;
  const key = compositeKey(evt);
  if (!key) return false;
  return key > cursor;
}

export type PushOutcome = {
  ungoverned_pushed: number;
  tamper_pushed: number;
  errors: string[];
};

export async function pushHostEvents(cwd: string): Promise<PushOutcome> {
  const outcome: PushOutcome = {
    ungoverned_pushed: 0,
    tamper_pushed: 0,
    errors: [],
  };

  const config = loadEnterpriseConfig(join(cwd, ".context"));
  const apiKey = config.enterprise.api_key.trim();
  const baseUrl = (config.enterprise.base_url || config.enterprise.endpoint).trim();
  if (!apiKey || !baseUrl) {
    outcome.errors.push("enterprise not configured");
    return outcome;
  }

  const cursor = readCursor(cwd);
  const ungovernedCursor = normalizeCursor(cursor.ungoverned_last_ts);
  const tamperCursor = normalizeCursor(cursor.tamper_last_ts);
  const ungoverned: HostEvent[] = [];
  const tamper: HostEvent[] = [];

  for (const file of listHostEventFiles(cwd)) {
    for (const evt of readEventsFrom(file)) {
      const ts = eventTimestamp(evt);
      if (!ts) continue;
      if (evt.event_type === "ungoverned_ai_session_detected" && isAfterComposite(evt, ungovernedCursor)) {
        ungoverned.push(evt);
      } else if (evt.event_type === "hook_tamper_detected" && isAfterComposite(evt, tamperCursor)) {
        tamper.push(evt);
      }
    }
  }

  sortByTs(ungoverned);
  sortByTs(tamper);

  if (ungoverned.length > 0) {
    const result = await pushBatch(
      `${baseUrl.replace(/\/$/, "")}/api/v1/govern/ungoverned`,
      apiKey,
      {
        events: ungoverned.map(toUngovernedPayload),
      },
    );
    if (result.ok) {
      outcome.ungoverned_pushed = ungoverned.length;
      const last = ungoverned[ungoverned.length - 1];
      cursor.ungoverned_last_ts = compositeKey(last) ?? cursor.ungoverned_last_ts;
    } else {
      outcome.errors.push(`ungoverned: ${result.error}`);
    }
  }

  if (tamper.length > 0) {
    const result = await pushBatch(
      `${baseUrl.replace(/\/$/, "")}/api/v1/govern/tamper`,
      apiKey,
      {
        events: tamper.map(toTamperPayload),
      },
    );
    if (result.ok) {
      outcome.tamper_pushed = tamper.length;
      const last = tamper[tamper.length - 1];
      cursor.tamper_last_ts = compositeKey(last) ?? cursor.tamper_last_ts;
    } else {
      outcome.errors.push(`tamper: ${result.error}`);
    }
  }

  if (outcome.ungoverned_pushed > 0 || outcome.tamper_pushed > 0) {
    writeCursor(cwd, cursor);
  }

  return outcome;
}

function toUngovernedPayload(e: HostEvent): Record<string, unknown> {
  return {
    detected_at: e.timestamp,
    host_id: e.host_id,
    cli: e.cli,
    binary_path: e.binary,
    args: e.args,
    sys_user: e.user,
    parent_pid: e.ppid,
    pid: e.pid,
    action_taken: e.action ?? "logged",
  };
}

function toTamperPayload(e: HostEvent): Record<string, unknown> {
  return {
    detected_at: e.timestamp,
    host_id: e.host_id,
    cli: e.cli,
    hook_name: e.hook_name ?? "any",
    session_id: e.session_id,
    last_seen: e.last_seen ?? null,
    missing_seconds: e.missing_seconds,
  };
}

async function pushBatch(
  url: string,
  apiKey: string,
  payload: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
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

export type PusherHandle = {
  stop(): void;
};

export function startHostEventsPusher(cwd: string, intervalMs: number): PusherHandle {
  const tick = () => {
    void pushHostEvents(cwd).catch((err) => {
      process.stderr.write(
        `[cortex-daemon] host-events push failed: ${err instanceof Error ? err.message : String(err)}\n`,
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
