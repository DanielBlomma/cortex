/**
 * Policy enforcement layer.
 *
 * Bridges the injection scanner with the policy store — only runs the
 * scanner when the `prompt-injection-defense` policy is active.
 */

import type { OrgPolicy } from "./store.js";
import { scanForInjection, sanitizeContent, type InjectionMatch, type ScanResult } from "./injection.js";

const RULE_ID = "prompt-injection-defense";

export type EnforcementResult = {
  allowed: boolean;
  ruleId: string;
  scan: ScanResult;
  sanitized?: string;
};

/**
 * Check whether the prompt-injection-defense policy is active.
 */
export function isInjectionDefenseActive(policies: OrgPolicy[]): boolean {
  return policies.some((p) => p.id === RULE_ID && p.enforce);
}

/**
 * Enforce the prompt-injection-defense policy against a piece of text.
 *
 * If the policy is not active the text is always allowed.
 *
 * @param text     The text to check
 * @param policies The current merged policy list
 * @param options  Optional: pass `sanitize: true` to get a sanitised version of the text
 * @returns        EnforcementResult
 */
export function enforceInjectionPolicy(
  text: string,
  policies: OrgPolicy[],
  options?: { sanitize?: boolean },
): EnforcementResult {
  if (!isInjectionDefenseActive(policies)) {
    return {
      allowed: true,
      ruleId: RULE_ID,
      scan: { score: 0, flagged: false, matches: [] },
    };
  }

  const scan = scanForInjection(text);

  const result: EnforcementResult = {
    allowed: !scan.flagged,
    ruleId: RULE_ID,
    scan,
  };

  if (options?.sanitize && scan.flagged) {
    result.sanitized = sanitizeContent(text);
  }

  return result;
}

/**
 * Build a violation payload compatible with the cortex-web
 * `POST /api/v1/violations/push` endpoint.
 */
export function buildViolationPayload(
  matches: InjectionMatch[],
  context: { filePath?: string; query?: string },
): {
  rule_id: string;
  severity: "error" | "warning" | "info";
  message: string;
  file_path?: string;
  metadata?: string;
  occurred_at: string;
} {
  const topMatch = matches[0];
  const score = matches.reduce((s, m) => s + m.weight, 0).toFixed(2);
  const message = `Prompt injection detected: ${topMatch.category} (score ${score})`;

  return {
    rule_id: RULE_ID,
    severity: "warning",
    message: message.slice(0, 2000),
    file_path: context.filePath?.slice(0, 500),
    metadata: JSON.stringify({
      query_present: Boolean(context.query),
      query_length: context.query?.length ?? 0,
      match_count: matches.length,
      categories: [...new Set(matches.map((m) => m.category))],
      patterns: matches.map((m) => m.pattern),
    }).slice(0, 5000),
    occurred_at: new Date().toISOString(),
  };
}
