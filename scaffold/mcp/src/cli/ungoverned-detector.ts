import { execSync } from "node:child_process";
import { basename } from "node:path";
import { hostname, userInfo } from "node:os";

export type ProcessSnapshot = {
  pid: number;
  ppid: number;
  user: string;
  comm: string;
  args: string;
};

export const DEFAULT_AI_BINARIES = [
  "claude",
  "codex",
  "copilot",
  "gemini-cli",
  "gemini",
  "aider",
  "cursor",
];

export type UngovernedFinding = {
  pid: number;
  ppid: number;
  user: string;
  cli: string;
  binary: string;
  args: string;
  parent_chain: number[];
  detected_at: string;
  host_id: string;
};

export type DetectorOptions = {
  knownBinaries?: string[];
  processes?: ProcessSnapshot[];
  hostId?: string;
};

const PS_LINE_RE = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s*(.*)$/;

export function listProcesses(): ProcessSnapshot[] {
  try {
    const out = execSync("ps -axo pid,ppid,user,comm,args", {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const lines = out.trim().split("\n").slice(1);
    return lines
      .map(parseProcessLine)
      .filter((p): p is ProcessSnapshot => p !== null);
  } catch {
    return [];
  }
}

export function parseProcessLine(line: string): ProcessSnapshot | null {
  const m = line.match(PS_LINE_RE);
  if (!m) return null;
  const pid = parseInt(m[1], 10);
  const ppid = parseInt(m[2], 10);
  if (!Number.isFinite(pid) || !Number.isFinite(ppid)) return null;
  return {
    pid,
    ppid,
    user: m[3],
    comm: m[4],
    args: m[5] ?? "",
  };
}

export function isCortexAncestor(args: string): boolean {
  if (!args) return false;
  // Accept invocations whose command line shows cortex orchestration:
  //  - `cortex run ...`     → wrapper spawned the AI CLI (Tier 2 governed)
  //  - `cortex enterprise`  → install-time orchestration
  //  - `cortex daemon`      → daemon-supervised
  //  - any path ending in `cortex.mjs` or named `cortex` followed by space/EOL
  if (/\bcortex\s+run\b/.test(args)) return true;
  if (/\bcortex\s+enterprise\b/.test(args)) return true;
  if (/\bcortex\s+daemon\b/.test(args)) return true;
  if (/\bcortex\s+hook\b/.test(args)) return true;
  if (/\bcortex(\s|$)/.test(args)) return true;
  if (/cortex\.mjs/.test(args)) return true;
  return false;
}

function findCli(comm: string, knownBinaries: string[]): string | null {
  const base = basename(comm);
  return knownBinaries.includes(base) ? base : null;
}

export function detectUngoverned(options: DetectorOptions = {}): UngovernedFinding[] {
  const known = options.knownBinaries ?? DEFAULT_AI_BINARIES;
  const procs = options.processes ?? listProcesses();
  const byPid = new Map<number, ProcessSnapshot>();
  for (const p of procs) byPid.set(p.pid, p);

  const hostId = options.hostId ?? hostname();
  const findings: UngovernedFinding[] = [];

  for (const proc of procs) {
    const cli = findCli(proc.comm, known);
    if (!cli) continue;
    if (isCortexAncestor(proc.args)) continue;

    const chain: number[] = [proc.pid];
    let current: ProcessSnapshot | undefined = byPid.get(proc.ppid);
    let governed = false;
    let depth = 0;
    while (current && current.pid > 1 && depth < 32) {
      chain.push(current.pid);
      if (isCortexAncestor(current.args)) {
        governed = true;
        break;
      }
      const next: ProcessSnapshot | undefined = byPid.get(current.ppid);
      if (!next || next.pid === current.pid) break;
      current = next;
      depth += 1;
    }

    if (!governed) {
      findings.push({
        pid: proc.pid,
        ppid: proc.ppid,
        user: proc.user,
        cli,
        binary: proc.comm,
        args: proc.args,
        parent_chain: chain,
        detected_at: new Date().toISOString(),
        host_id: hostId,
      });
    }
  }

  return findings;
}

export type EnforcementMode = "advisory" | "enforced";
export type EnforcementAction = "logged" | "sigterm" | "skipped_cross_user";

export type EnforceOptions = {
  mode: EnforcementMode;
  sendSignal?: (pid: number, signal: NodeJS.Signals) => void;
  currentUser?: string;
};

export function enforceFinding(
  finding: UngovernedFinding,
  options: EnforceOptions,
): EnforcementAction {
  if (options.mode !== "enforced") return "logged";
  const me = options.currentUser ?? userInfo().username;
  if (finding.user !== me) {
    return "skipped_cross_user";
  }
  const send = options.sendSignal ?? ((pid, sig) => process.kill(pid, sig));
  try {
    send(finding.pid, "SIGTERM");
  } catch {
    // process exited between detection and signal — best-effort
  }
  return "sigterm";
}
