/**
 * Prompt injection scanner.
 *
 * Detects common prompt injection patterns in text and returns a risk
 * score with categorised matches.  Designed to run on every piece of
 * content that flows between the file system and an LLM.
 */

// ── Types ──────────────────────────────────────────────────────────

export type InjectionCategory =
  | "instruction_override"
  | "role_play"
  | "delimiter_escape"
  | "instruction_marker"
  | "encoded_payload";

export type InjectionMatch = {
  pattern: string;
  category: InjectionCategory;
  matched: string;
  position: number;
  weight: number;
};

export type ScanResult = {
  score: number;
  flagged: boolean;
  matches: InjectionMatch[];
};

// ── Pattern definitions ────────────────────────────────────────────

type PatternDef = {
  regex: RegExp;
  category: InjectionCategory;
  pattern: string;
  weight: number;
};

const PATTERNS: PatternDef[] = [
  // ── Instruction overrides ──
  {
    regex: /ignore\s+(all\s+)?previous\s+instructions/gi,
    category: "instruction_override",
    pattern: "ignore_previous_instructions",
    weight: 0.5,
  },
  {
    regex: /disregard\s+(all\s+)?(above|previous|prior|earlier)/gi,
    category: "instruction_override",
    pattern: "disregard_previous",
    weight: 0.5,
  },
  {
    regex: /forget\s+(all\s+)?(above|previous|prior|earlier)\s+(instructions|context|rules)/gi,
    category: "instruction_override",
    pattern: "forget_previous",
    weight: 0.5,
  },
  {
    regex: /new\s+instructions?\s*:/gi,
    category: "instruction_override",
    pattern: "new_instructions",
    weight: 0.4,
  },
  {
    regex: /you\s+are\s+now\s+/gi,
    category: "instruction_override",
    pattern: "you_are_now",
    weight: 0.4,
  },
  {
    regex: /from\s+now\s+on\s*,?\s+(you|ignore|do\s+not)/gi,
    category: "instruction_override",
    pattern: "from_now_on",
    weight: 0.4,
  },
  {
    regex: /override\s+(all\s+)?(system|safety|previous)\s+(prompt|instructions|rules)/gi,
    category: "instruction_override",
    pattern: "override_system",
    weight: 0.5,
  },

  // ── Role-play / persona attacks ──
  {
    regex: /act\s+as\s+(an?\s+)?(unrestricted|unfiltered|evil|malicious|jailbroken)/gi,
    category: "role_play",
    pattern: "act_as_unrestricted",
    weight: 0.5,
  },
  {
    regex: /pretend\s+you\s+are\s+(an?\s+)?(different|new|unrestricted)/gi,
    category: "role_play",
    pattern: "pretend_you_are",
    weight: 0.4,
  },
  {
    regex: /enter\s+(DAN|developer|god|sudo|admin)\s+mode/gi,
    category: "role_play",
    pattern: "special_mode",
    weight: 0.5,
  },
  {
    regex: /jailbreak/gi,
    category: "role_play",
    pattern: "jailbreak_keyword",
    weight: 0.4,
  },

  // ── Delimiter escapes ──
  {
    regex: /<\/?(system|assistant|user|tool_result|human|function_call|antml:)[\s>]/gi,
    category: "delimiter_escape",
    pattern: "xml_tag_escape",
    weight: 0.5,
  },
  {
    regex: /\[INST\]|\[\/INST\]|\[SYS\]|\[\/SYS\]/gi,
    category: "delimiter_escape",
    pattern: "inst_tag_escape",
    weight: 0.5,
  },
  {
    regex: /```\s*(system|prompt|instructions)/gi,
    category: "delimiter_escape",
    pattern: "code_block_escape",
    weight: 0.3,
  },

  // ── Instruction markers ──
  {
    regex: /^\s*(IMPORTANT|SYSTEM|ADMIN|OVERRIDE|INSTRUCTION)\s*:/gim,
    category: "instruction_marker",
    pattern: "authority_marker",
    weight: 0.3,
  },
  {
    regex: /\bdo\s+not\s+follow\s+(any\s+)?(previous|prior|above)\s+(rules|instructions|guidelines)/gi,
    category: "instruction_marker",
    pattern: "do_not_follow",
    weight: 0.5,
  },

  // ── Encoded payloads ──
  {
    regex: /(?:eval|atob|Buffer\.from)\s*\(\s*["'`][A-Za-z0-9+/=]{20,}["'`]\s*\)/g,
    category: "encoded_payload",
    pattern: "encoded_eval",
    weight: 0.4,
  },
  {
    regex: /&#x[0-9a-f]{2,4};/gi,
    category: "encoded_payload",
    pattern: "html_entity_encode",
    weight: 0.2,
  },
];

// ── Public API ─────────────────────────────────────────────────────

const DEFAULT_THRESHOLD = 0.3;

/**
 * Scan a text string for prompt injection patterns.
 *
 * @param text      The text to scan
 * @param threshold Risk score threshold (0–1) above which `flagged` is true
 * @returns         ScanResult with score, flagged boolean, and matches
 */
export function scanForInjection(
  text: string,
  threshold: number = DEFAULT_THRESHOLD,
): ScanResult {
  if (!text) {
    return { score: 0, flagged: false, matches: [] };
  }

  const matches: InjectionMatch[] = [];

  for (const def of PATTERNS) {
    // Reset lastIndex for global regexes
    def.regex.lastIndex = 0;

    let m: RegExpExecArray | null;
    while ((m = def.regex.exec(text)) !== null) {
      matches.push({
        pattern: def.pattern,
        category: def.category,
        matched: m[0],
        position: m.index,
        weight: def.weight,
      });
    }
  }

  const score = Math.min(
    1,
    matches.reduce((sum, m) => sum + m.weight, 0),
  );

  return {
    score,
    flagged: score >= threshold,
    matches,
  };
}

/**
 * Sanitize text by wrapping it in safe delimiters and neutralising
 * known injection patterns.  Use this on content returned to the LLM
 * when you want to keep the content but reduce injection risk.
 */
export function sanitizeContent(text: string): string {
  if (!text) return text;

  let out = text;

  // Neutralise XML-like tags that mimic system boundaries
  out = out.replace(/<\/?(system|assistant|user|tool_result|human|function_call|antml:)/gi, (m) =>
    m.replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  );

  // Neutralise [INST] / [SYS] tags
  out = out.replace(/\[(\/?)(?:INST|SYS)\]/gi, "[$1_$&_]");

  return out;
}
