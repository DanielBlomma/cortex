import { writeFileSync, existsSync, unlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hostname } from "node:os";
import type { HeartbeatPayload, HeartbeatResult } from "./protocol.js";
import { writeHostAuditEvent } from "./ungoverned-scanner.js";

/**
 * Hook heartbeat tracker for Phase 6 tamper-detection.
 *
 * Each hook invocation pings the daemon. The daemon tracks per-session
 * "last seen any hook" timestamps. A session is considered active from
 * the first SessionStart heartbeat until SessionEnd (or auto-cleanup
 * after a long stale interval).
 *
 * Tamper detection (periodic): if an active session has had at least
 * one non-SessionStart heartbeat (so we know hooks were genuinely
 * firing) and then nothing within `missingThresholdSeconds`, we flag
 * it. Pure idle sessions where the user just left Claude open without
 * doing anything do not match the "had-activity-then-silence" pattern.
 */

export type SessionState = {
  cli: HeartbeatPayload["cli"];
  cwd: string;
  started_at: string;
  last_heartbeat: string;
  hook_count: number;
  ended: boolean;
  ended_at?: string;
};

export type TamperLockEntry = {
  version: 1;
  detected_at: string;
  cli: HeartbeatPayload["cli"];
  session_id: string;
  hook_name: string;
  last_seen: string;
  missing_seconds: number;
  host_id: string;
  cwd: string;
};

export const TAMPER_LOCK_FILENAME = ".cortex-tamper.lock";

export type TamperCheckOptions = {
  cwds: string[];
  missingThresholdSeconds: number;
  now?: Date;
  onTamperDetected?: (entry: TamperLockEntry) => void;
};

export class HeartbeatTracker {
  private sessions = new Map<string, SessionState>();
  private hostId: string;
  private cleanupAfterMs: number;

  constructor(
    options: { hostId?: string; cleanupAfterMs?: number } = {},
  ) {
    this.hostId = options.hostId ?? hostname();
    // Sessions with no heartbeat for this long are auto-removed (covers
    // crashes that never sent SessionEnd). Default 12h.
    this.cleanupAfterMs = options.cleanupAfterMs ?? 12 * 60 * 60 * 1000;
  }

  recordHeartbeat(payload: HeartbeatPayload): HeartbeatResult {
    const existing = this.sessions.get(payload.session_id);
    const now = payload.ts;

    if (payload.hook === "SessionStart") {
      this.sessions.set(payload.session_id, {
        cli: payload.cli,
        cwd: payload.cwd,
        started_at: now,
        last_heartbeat: now,
        hook_count: 1,
        ended: false,
      });
    } else if (payload.hook === "SessionEnd") {
      if (existing) {
        existing.last_heartbeat = now;
        existing.ended = true;
        existing.ended_at = now;
        existing.hook_count += 1;
      } else {
        // SessionEnd without prior SessionStart — register a closed session
        // so the tamper-checker doesn't flag it later.
        this.sessions.set(payload.session_id, {
          cli: payload.cli,
          cwd: payload.cwd,
          started_at: now,
          last_heartbeat: now,
          hook_count: 1,
          ended: true,
          ended_at: now,
        });
      }
    } else {
      if (existing) {
        existing.last_heartbeat = now;
        existing.hook_count += 1;
      } else {
        // Heartbeat from a session we never saw start (daemon was restarted
        // mid-session). Register it as active.
        this.sessions.set(payload.session_id, {
          cli: payload.cli,
          cwd: payload.cwd,
          started_at: now,
          last_heartbeat: now,
          hook_count: 1,
          ended: false,
        });
      }
    }

    const tamperLockActive = existsSync(
      join(payload.cwd, ".context", TAMPER_LOCK_FILENAME),
    );
    return { recorded: true, tamper_lock_active: tamperLockActive };
  }

  getActiveSessions(): Array<[string, SessionState]> {
    return Array.from(this.sessions.entries()).filter(
      ([, state]) => !state.ended,
    );
  }

  detectTamper(options: TamperCheckOptions): TamperLockEntry[] {
    const now = options.now ?? new Date();
    const thresholdMs = options.missingThresholdSeconds * 1000;
    const flagged: TamperLockEntry[] = [];

    for (const [sessionId, state] of this.sessions) {
      // Cleanup sessions that have been silent forever — they crashed.
      const lastMs = new Date(state.last_heartbeat).getTime();
      if (Number.isFinite(lastMs) && now.getTime() - lastMs > this.cleanupAfterMs) {
        this.sessions.delete(sessionId);
        continue;
      }

      if (state.ended) continue;
      // Need at least 2 heartbeats for the "had-activity-then-silence"
      // signal — a single SessionStart followed by silence may just be a
      // user opening Claude and walking away.
      if (state.hook_count < 2) continue;

      const elapsedMs = now.getTime() - lastMs;
      if (elapsedMs <= thresholdMs) continue;

      const entry: TamperLockEntry = {
        version: 1,
        detected_at: now.toISOString(),
        cli: state.cli,
        session_id: sessionId,
        hook_name: "any",
        last_seen: state.last_heartbeat,
        missing_seconds: Math.round(elapsedMs / 1000),
        host_id: this.hostId,
        cwd: state.cwd,
      };
      flagged.push(entry);
      // Mark ended so we don't re-flag the same session every tick.
      state.ended = true;
      state.ended_at = now.toISOString();
      options.onTamperDetected?.(entry);
    }

    return flagged;
  }

  // For tests:
  _forceState(sessionId: string, state: SessionState): void {
    this.sessions.set(sessionId, state);
  }
  _size(): number {
    return this.sessions.size;
  }
}

export function writeTamperLock(cwd: string, entry: TamperLockEntry): string {
  const dir = join(cwd, ".context");
  const path = join(dir, TAMPER_LOCK_FILENAME);
  writeFileSync(path, JSON.stringify(entry, null, 2) + "\n", "utf8");
  return path;
}

export function readTamperLock(cwd: string): TamperLockEntry | null {
  const path = join(cwd, ".context", TAMPER_LOCK_FILENAME);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as TamperLockEntry;
  } catch {
    return null;
  }
}

export function removeTamperLock(cwd: string): boolean {
  const path = join(cwd, ".context", TAMPER_LOCK_FILENAME);
  if (!existsSync(path)) return false;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

export async function emitTamperAudit(
  cwd: string,
  entry: TamperLockEntry,
): Promise<void> {
  await writeHostAuditEvent(cwd, {
    event_type: "hook_tamper_detected",
    timestamp: entry.detected_at,
    host_id: entry.host_id,
    cli: entry.cli,
    session_id: entry.session_id,
    hook_name: entry.hook_name,
    last_seen: entry.last_seen,
    missing_seconds: entry.missing_seconds,
  });
}
