import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type OrgPolicy = {
  id: string;
  title?: string | null;
  kind?: "predefined" | "custom" | null;
  status?: "draft" | "active" | "disabled" | "archived" | null;
  severity?: "info" | "warning" | "error" | "block" | null;
  description: string;
  priority: number;
  scope: string;
  enforce: boolean;
  source: "org" | "local";
  // Execution hints for generic evaluators (M2). Null for predefined
  // rules that dispatch via the name-based validator registry.
  type?: string | null;
  config?: Record<string, unknown> | null;
};

/**
 * Parse the simple YAML rules format used by Cortex:
 *
 * rules:
 *   - id: rule.foo
 *     description: "..."
 *     priority: 100
 *     enforce: true
 */
function parseRulesYaml(text: string, source: "org" | "local"): OrgPolicy[] {
  const policies: OrgPolicy[] = [];
  let current: Partial<OrgPolicy> | null = null;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();

    // New rule entry
    if (trimmed.startsWith("- id:")) {
      if (current?.id) {
        policies.push(finalize(current, source));
      }
      current = { id: trimmed.slice(5).trim() };
      continue;
    }

    if (!current) continue;

    if (trimmed.startsWith("title:")) {
      current.title = trimmed.slice(6).trim().replace(/^["']|["']$/g, "");
    } else if (trimmed.startsWith("kind:")) {
      const kind = trimmed.slice(5).trim();
      if (kind === "predefined" || kind === "custom") current.kind = kind;
    } else if (trimmed.startsWith("status:")) {
      const status = trimmed.slice(7).trim();
      if (status === "draft" || status === "active" || status === "disabled" || status === "archived") {
        current.status = status;
      }
    } else if (trimmed.startsWith("severity:")) {
      const severity = trimmed.slice(9).trim();
      if (severity === "info" || severity === "warning" || severity === "error" || severity === "block") {
        current.severity = severity;
      }
    } else if (trimmed.startsWith("description:")) {
      current.description = trimmed.slice(12).trim().replace(/^["']|["']$/g, "");
    } else if (trimmed.startsWith("priority:")) {
      current.priority = parseInt(trimmed.slice(9).trim(), 10) || 50;
    } else if (trimmed.startsWith("scope:")) {
      current.scope = trimmed.slice(6).trim();
    } else if (trimmed.startsWith("enforce:")) {
      current.enforce = trimmed.slice(8).trim() === "true";
    } else if (trimmed.startsWith("type:")) {
      const raw = trimmed.slice(5).trim();
      current.type = raw === "null" || raw === "" ? null : raw;
    } else if (trimmed.startsWith("config:")) {
      // Config is JSON-encoded on a single line so the line-based parser
      // doesn't need to understand nested YAML. `config: null` or an
      // unparseable value leaves it null.
      const raw = trimmed.slice(7).trim();
      if (raw && raw !== "null") {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            current.config = parsed as Record<string, unknown>;
          }
        } catch {
          // ignore malformed config; evaluator will see null and fail
          // gracefully with its own validation message.
        }
      }
    }
  }

  if (current?.id) {
    policies.push(finalize(current, source));
  }

  return policies;
}

function finalize(partial: Partial<OrgPolicy>, source: "org" | "local"): OrgPolicy {
  return {
    id: partial.id ?? "",
    title: partial.title ?? partial.id ?? "",
    kind: partial.kind ?? null,
    status: partial.status ?? "active",
    severity: partial.severity ?? "block",
    description: partial.description ?? "",
    priority: partial.priority ?? 50,
    scope: partial.scope ?? "global",
    enforce: partial.enforce ?? true,
    source,
    type: partial.type ?? null,
    config: partial.config ?? null,
  };
}

function policiesToYaml(policies: OrgPolicy[]): string {
  const lines = ["rules:"];
  for (const p of policies) {
    lines.push(`  - id: ${p.id}`);
    if (p.title) lines.push(`    title: "${p.title.replace(/"/g, '\\"')}"`);
    if (p.kind) lines.push(`    kind: ${p.kind}`);
    if (p.status) lines.push(`    status: ${p.status}`);
    if (p.severity) lines.push(`    severity: ${p.severity}`);
    lines.push(`    description: "${p.description.replace(/"/g, '\\"')}"`);
    lines.push(`    priority: ${p.priority}`);
    lines.push(`    scope: ${p.scope}`);
    lines.push(`    enforce: ${p.enforce}`);
    if (p.type) {
      lines.push(`    type: ${p.type}`);
    }
    if (p.config) {
      lines.push(`    config: ${JSON.stringify(p.config)}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export class PolicyStore {
  private readonly contextDir: string;
  private readonly orgRulesPath: string;
  private readonly localRulesPath: string;

  constructor(contextDir: string) {
    this.contextDir = contextDir;
    this.orgRulesPath = join(contextDir, "policies", "org-rules.yaml");
    this.localRulesPath = join(contextDir, "rules.yaml");
  }

  loadOrgPolicies(): OrgPolicy[] {
    try {
      const raw = readFileSync(this.orgRulesPath, "utf8");
      return parseRulesYaml(raw, "org");
    } catch {
      return [];
    }
  }

  loadLocalPolicies(): OrgPolicy[] {
    try {
      const raw = readFileSync(this.localRulesPath, "utf8");
      return parseRulesYaml(raw, "local");
    } catch {
      return [];
    }
  }

  /**
   * Merge org + local policies. Org rules override local rules with same ID.
   * Result is sorted by priority (highest first).
   */
  getMergedPolicies(): OrgPolicy[] {
    const orgPolicies = this.loadOrgPolicies();
    const localPolicies = this.loadLocalPolicies();

    const merged = new Map<string, OrgPolicy>();

    // Local first
    for (const p of localPolicies) {
      merged.set(p.id, p);
    }

    // Org overrides
    for (const p of orgPolicies) {
      merged.set(p.id, p);
    }

    return [...merged.values()].sort((a, b) => b.priority - a.priority);
  }

  writeOrgPolicies(policies: OrgPolicy[]): void {
    const dir = join(this.contextDir, "policies");
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.orgRulesPath, policiesToYaml(policies));
  }
}
