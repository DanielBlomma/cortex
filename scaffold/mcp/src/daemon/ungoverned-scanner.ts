import { appendFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { userInfo } from "node:os";
import {
  detectUngoverned,
  enforceFinding,
  type DetectorOptions,
  type EnforcementMode,
  type UngovernedFinding,
} from "../cli/ungoverned-detector.js";

export type ScannerOptions = {
  cwd: string;
  intervalMs?: number;
  mode?: EnforcementMode;
  detectorOptions?: DetectorOptions;
  onFinding?: (finding: UngovernedFinding & { action: string }) => void;
};

const DEFAULT_INTERVAL_MS = 60_000;

function readMode(cwd: string): EnforcementMode {
  const stateFile = join(cwd, ".context", "govern.local.json");
  if (!existsSync(stateFile)) return "advisory";
  try {
    const raw = readFileSync(stateFile, "utf8");
    const parsed = JSON.parse(raw) as {
      installs?: Record<string, { mode?: EnforcementMode }>;
    };
    for (const inst of Object.values(parsed.installs ?? {})) {
      if (inst.mode === "enforced") return "enforced";
    }
    return "advisory";
  } catch {
    return "advisory";
  }
}

export async function writeHostAuditEvent(
  cwd: string,
  event: Record<string, unknown>,
): Promise<void> {
  const auditDir = join(cwd, ".context", "audit");
  await mkdir(auditDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const file = join(auditDir, `host-events-${date}.jsonl`);
  await appendFile(file, JSON.stringify(event) + "\n");
}

export async function runScanOnce(options: ScannerOptions): Promise<UngovernedFinding[]> {
  const mode = options.mode ?? readMode(options.cwd);
  const findings = detectUngoverned(options.detectorOptions);
  const me = userInfo().username;
  for (const finding of findings) {
    const action = enforceFinding(finding, { mode, currentUser: me });
    const event = {
      event_type: "ungoverned_ai_session_detected",
      timestamp: finding.detected_at,
      host_id: finding.host_id,
      cli: finding.cli,
      binary: finding.binary,
      pid: finding.pid,
      ppid: finding.ppid,
      user: finding.user,
      args: finding.args,
      parent_chain: finding.parent_chain,
      mode,
      action,
    };
    try {
      await writeHostAuditEvent(options.cwd, event);
    } catch (err) {
      process.stderr.write(
        `[cortex-daemon] failed to write ungoverned audit: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    options.onFinding?.({ ...finding, action });
  }
  return findings;
}

export type ScannerHandle = {
  stop(): void;
  isRunning(): boolean;
};

export function startUngovernedScanner(options: ScannerOptions): ScannerHandle {
  const interval = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  let running = true;

  const tick = async () => {
    if (!running) return;
    try {
      await runScanOnce(options);
    } catch (err) {
      process.stderr.write(
        `[cortex-daemon] ungoverned scan failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  };

  void tick();
  const handle = setInterval(() => void tick(), interval);
  if (typeof handle.unref === "function") handle.unref();

  return {
    stop() {
      running = false;
      clearInterval(handle);
    },
    isRunning() {
      return running;
    },
  };
}
