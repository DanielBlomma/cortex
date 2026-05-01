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

function readCursor(cwd: string): Cursor {
  const path = join(cwd, ".context", CURSOR_FILENAME);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Cursor;
  } catch {
    return {};
  }
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

function isAfter(a: string, b: string | undefined): boolean {
  if (!b) return true;
  return a > b;
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
  const ungoverned: HostEvent[] = [];
  const tamper: HostEvent[] = [];

  for (const file of listHostEventFiles(cwd)) {
    for (const evt of readEventsFrom(file)) {
      const ts = eventTimestamp(evt);
      if (!ts) continue;
      if (evt.event_type === "ungoverned_ai_session_detected" && isAfter(ts, cursor.ungoverned_last_ts)) {
        ungoverned.push(evt);
      } else if (evt.event_type === "hook_tamper_detected" && isAfter(ts, cursor.tamper_last_ts)) {
        tamper.push(evt);
      }
    }
  }

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
      cursor.ungoverned_last_ts = ungoverned[ungoverned.length - 1].timestamp ?? cursor.ungoverned_last_ts;
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
      cursor.tamper_last_ts = tamper[tamper.length - 1].timestamp ?? cursor.tamper_last_ts;
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
