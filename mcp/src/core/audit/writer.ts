import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export type AuditEvidenceLevel = "required" | "diagnostic";
export type AuditEventType =
  | "tool_call"
  | "workflow_transition"
  | "review_result"
  | "policy_sync"
  | "approval"
  | "session"
  | "security_scan";

export type AuditEntry = {
  timestamp: string;
  tool: string;
  input: Record<string, unknown>;
  result_count: number;
  entities_returned: string[];
  rules_applied: string[];
  duration_ms: number;
  status?: "success" | "error";
  error?: string;
  event_type?: AuditEventType;
  evidence_level?: AuditEvidenceLevel;
  resource_type?: string;
  resource_id?: string;
  repo?: string;
  instance_id?: string;
  session_id?: string;
  metadata?: Record<string, unknown>;
};

type AuditWriterOptions = {
  onEntry?: (entry: AuditEntry) => void;
};

export class AuditWriter {
  private readonly auditDir: string;
  private readonly onEntry: ((entry: AuditEntry) => void) | null;
  private initialized = false;

  constructor(contextDir: string, options: AuditWriterOptions = {}) {
    this.auditDir = join(contextDir, "audit");
    this.onEntry = options.onEntry ?? null;
  }

  log(entry: AuditEntry): void {
    const date = entry.timestamp.slice(0, 10); // YYYY-MM-DD
    const filePath = join(this.auditDir, `${date}.jsonl`);
    const line = JSON.stringify(entry) + "\n";

    this.onEntry?.(entry);

    // Fire-and-forget async write — don't block the tool handler
    this.writeAsync(filePath, line).catch(() => {
      process.stderr.write("[cortex-enterprise] Failed to write audit entry\n");
    });
  }

  private async writeAsync(filePath: string, line: string): Promise<void> {
    if (!this.initialized) {
      await mkdir(this.auditDir, { recursive: true });
      this.initialized = true;
    }
    await appendFile(filePath, line);
  }
}
