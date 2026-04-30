import { statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  registerGenericEvaluator,
  type ValidatorContext,
  type ValidatorResult,
} from "../engine.js";

const BINARY_SNIFF_BYTES = 512;
const DEFAULT_MAX_BYTES = 2_000_000;

const SEVERITIES = new Set(["error", "warning", "info"]);

type RegexConfig = {
  pattern: string;
  flags?: string;
  file_pattern?: string;
  severity?: "error" | "warning" | "info";
  message?: string;
  max_matches_per_file?: number;
  max_scan_bytes?: number;
  allowlist_paths?: string[];
};

function parseConfig(raw: Record<string, unknown>): RegexConfig | { error: string } {
  const pattern = raw.pattern;
  if (typeof pattern !== "string" || pattern.length === 0) {
    return { error: "config.pattern must be a non-empty string" };
  }
  try {
    new RegExp(pattern, typeof raw.flags === "string" ? raw.flags : undefined);
  } catch (err) {
    return { error: `config.pattern is not a valid regex: ${err instanceof Error ? err.message : String(err)}` };
  }

  const severity = raw.severity;
  if (severity !== undefined && (typeof severity !== "string" || !SEVERITIES.has(severity))) {
    return { error: 'config.severity must be one of "error", "warning", "info"' };
  }

  if (raw.file_pattern !== undefined && typeof raw.file_pattern !== "string") {
    return { error: "config.file_pattern must be a string" };
  }
  if (raw.file_pattern) {
    try {
      new RegExp(raw.file_pattern);
    } catch (err) {
      return { error: `config.file_pattern is not a valid regex: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  return {
    pattern,
    flags: typeof raw.flags === "string" ? raw.flags : undefined,
    file_pattern: typeof raw.file_pattern === "string" ? raw.file_pattern : undefined,
    severity: severity as "error" | "warning" | "info" | undefined,
    message: typeof raw.message === "string" ? raw.message : undefined,
    max_matches_per_file:
      typeof raw.max_matches_per_file === "number" ? raw.max_matches_per_file : undefined,
    max_scan_bytes:
      typeof raw.max_scan_bytes === "number" ? raw.max_scan_bytes : undefined,
    allowlist_paths: Array.isArray(raw.allowlist_paths)
      ? raw.allowlist_paths.filter((p): p is string => typeof p === "string")
      : undefined,
  };
}

registerGenericEvaluator({
  type: "regex",
  async check(ctx: ValidatorContext, rawConfig: Record<string, unknown>): Promise<ValidatorResult> {
    const parsed = parseConfig(rawConfig);
    if ("error" in parsed) {
      return { pass: false, severity: "error", message: `Invalid regex config: ${parsed.error}` };
    }

    const files = ctx.changedFiles ?? [];
    if (files.length === 0) {
      return { pass: true, severity: "info", message: "No changed files to scan" };
    }

    const severity = parsed.severity ?? "warning";
    const allowlist = parsed.allowlist_paths ?? ["tests/", "test/", "__tests__/", "fixtures/", "docs/"];
    const maxBytes = parsed.max_scan_bytes ?? DEFAULT_MAX_BYTES;
    const maxMatches = parsed.max_matches_per_file ?? 20;

    // A regex used purely to filter file paths should be anchored by the
    // caller if needed; we compile as-is to give them full control.
    const fileRe = parsed.file_pattern ? new RegExp(parsed.file_pattern) : null;
    const contentRe = new RegExp(parsed.pattern, parsed.flags);

    const hits: string[] = [];
    let scanned = 0;

    for (const file of files) {
      if (allowlist.some((p) => file.includes(p))) continue;
      if (fileRe && !fileRe.test(file)) continue;

      const abs = join(ctx.projectRoot, file);
      try {
        const stat = statSync(abs);
        if (stat.size > maxBytes) continue;

        const buf = readFileSync(abs);
        const sniff = buf.subarray(0, Math.min(buf.length, BINARY_SNIFF_BYTES));
        if (sniff.includes(0)) continue;

        const content = buf.toString("utf8");
        scanned += 1;

        const lines = content.split("\n");
        let fileMatches = 0;
        for (let i = 0; i < lines.length; i += 1) {
          // Compile a per-line test with the `g` flag stripped so we don't
          // hop across repeated state; callers supply single-line patterns.
          const lineRe = new RegExp(contentRe.source, (contentRe.flags || "").replace(/g/g, ""));
          if (lineRe.test(lines[i])) {
            hits.push(`${file}:${i + 1}`);
            fileMatches += 1;
            if (fileMatches >= maxMatches) break;
          }
        }
      } catch {
        // Unreadable file — skip
      }
    }

    if (hits.length === 0) {
      return {
        pass: true,
        severity: "info",
        message: `No regex matches in ${scanned} changed file${scanned === 1 ? "" : "s"}`,
      };
    }

    const messageStem = parsed.message ?? "Pattern match";
    return {
      pass: false,
      severity,
      message: `${messageStem}: ${hits.length} match${hits.length === 1 ? "" : "es"} in ${scanned} file${scanned === 1 ? "" : "s"}`,
      detail:
        hits.slice(0, 30).join("\n") + (hits.length > 30 ? `\n... and ${hits.length - 30} more` : ""),
    };
  },
});
