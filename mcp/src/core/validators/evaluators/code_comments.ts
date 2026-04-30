import { statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  registerGenericEvaluator,
  type ValidatorContext,
  type ValidatorResult,
} from "../engine.js";

// Per "parser parity" — every supported language is a first-class citizen.
// Adding a new language means adding an entry to LANGUAGES plus a positive
// and a negative test. Extensions listed here are the only files scanned.

type EndStyle = "braces" | "indent";

type LanguageSpec = {
  name: string;
  extensions: string[];
  functionPatterns: RegExp[];
  lineCommentPrefix: string;
  // Block comment support is optional; leave empty to disable.
  blockCommentStart: string;
  blockCommentEnd: string;
  endStyle: EndStyle;
  // Python-style: a docstring as the first statement in the body counts as
  // a comment. Only relevant for indent-style languages right now.
  allowsDocstring?: boolean;
};

const LANGUAGES: LanguageSpec[] = [
  {
    name: "TypeScript/JavaScript",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
    functionPatterns: [
      /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*(?:<[^>]*>)?\s*\(/,
      /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[\w<>,\s[\]|&]+)?\s*=\s*(?:async\s*)?(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[\w<>,\s[\]|&]+\s*)?=>/,
      /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:readonly\s+)?(?:async\s+)?(?:\*\s*)?(\w+)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[\w<>,\s[\]|&]+\s*)?\{/,
    ],
    lineCommentPrefix: "//",
    blockCommentStart: "/*",
    blockCommentEnd: "*/",
    endStyle: "braces",
  },
  {
    name: "Python",
    extensions: [".py"],
    functionPatterns: [
      /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/,
    ],
    lineCommentPrefix: "#",
    blockCommentStart: "",
    blockCommentEnd: "",
    endStyle: "indent",
    allowsDocstring: true,
  },
  {
    name: "Go",
    extensions: [".go"],
    functionPatterns: [
      /^func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(/,
    ],
    lineCommentPrefix: "//",
    blockCommentStart: "/*",
    blockCommentEnd: "*/",
    endStyle: "braces",
  },
  {
    name: "Rust",
    extensions: [".rs"],
    functionPatterns: [
      /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+(?:"[^"]*"\s+)?)?fn\s+(\w+)/,
    ],
    lineCommentPrefix: "//",
    blockCommentStart: "/*",
    blockCommentEnd: "*/",
    endStyle: "braces",
  },
  {
    name: "C#",
    extensions: [".cs"],
    functionPatterns: [
      // Require at least one access/modifier keyword so we don't match
      // arbitrary `name(args)` calls. Return type is optional to also
      // match constructors.
      /^\s*(?:(?:public|private|protected|internal|static|async|override|virtual|sealed|abstract|new|partial)\s+)+(?:[\w<>\[\],?\s]+?\s+)?(\w+)\s*\([^)]*\)\s*(?:\{|where|:|=>|$)/,
    ],
    lineCommentPrefix: "//",
    blockCommentStart: "/*",
    blockCommentEnd: "*/",
    endStyle: "braces",
  },
  {
    name: "Java",
    extensions: [".java"],
    functionPatterns: [
      /^\s*(?:(?:public|private|protected|static|final|abstract|synchronized|native)\s+)+(?:[\w<>\[\],?\s]+?\s+)?(\w+)\s*\([^)]*\)\s*(?:\{|throws|$)/,
    ],
    lineCommentPrefix: "//",
    blockCommentStart: "/*",
    blockCommentEnd: "*/",
    endStyle: "braces",
  },
];

function pickLanguage(file: string): LanguageSpec | null {
  const lower = file.toLowerCase();
  for (const lang of LANGUAGES) {
    if (lang.extensions.some((ext) => lower.endsWith(ext))) {
      return lang;
    }
  }
  return null;
}

// Scan for a preceding comment within `lookback` non-blank lines above
// `startLine` (exclusive). Returns true if a comment is found.
function hasPrecedingComment(
  lines: string[],
  startLine: number,
  lang: LanguageSpec,
  lookback: number,
): boolean {
  let checked = 0;
  for (let i = startLine - 1; i >= 0 && checked < lookback; i -= 1) {
    const trimmed = lines[i].trim();
    if (trimmed === "") continue;
    checked += 1;

    if (trimmed.startsWith(lang.lineCommentPrefix)) return true;
    if (lang.blockCommentStart) {
      if (trimmed.endsWith(lang.blockCommentEnd)) return true;
      if (trimmed.startsWith(lang.blockCommentStart)) return true;
    }
    // First non-blank non-comment line above → no leading comment.
    return false;
  }
  return false;
}

function isDocstringLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith('"""') || t.startsWith("'''") || t.startsWith('"') || t.startsWith("'");
}

// Walk forward from `startLine` (the function declaration line) and return
// the (exclusive) end-of-function line. Handles both brace and indent
// styles. Naive — comments/strings may contain braces and skew the
// counter; acceptable tradeoff without per-language AST parsing.
function findFunctionEnd(
  lines: string[],
  startLine: number,
  lang: LanguageSpec,
  indentMatch?: string,
): number {
  if (lang.endStyle === "indent") {
    const baseIndent = (indentMatch ?? "").length;
    for (let i = startLine + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.trim() === "") continue;
      const indent = line.length - line.trimStart().length;
      if (indent <= baseIndent) return i;
    }
    return lines.length;
  }

  // Braces
  let depth = 0;
  let seenOpen = false;
  for (let i = startLine; i < lines.length; i += 1) {
    const line = lines[i];
    for (let j = 0; j < line.length; j += 1) {
      const c = line[j];
      if (c === "{") {
        depth += 1;
        seenOpen = true;
      } else if (c === "}") {
        depth -= 1;
        if (seenOpen && depth === 0) return i + 1;
      }
    }
  }
  return lines.length;
}

type Violation = {
  file: string;
  line: number;
  name: string;
  lineCount: number;
};

function scanFile(
  content: string,
  file: string,
  lang: LanguageSpec,
  minLines: number,
): Violation[] {
  const lines = content.split("\n");
  const hits: Violation[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const pattern of lang.functionPatterns) {
      const m = line.match(pattern);
      if (!m) continue;

      // For Python, capture group 1 is indent, 2 is name; for others, 1 is name.
      const name = lang.endStyle === "indent" ? m[2] ?? "<anonymous>" : m[1] ?? "<anonymous>";
      const indent = lang.endStyle === "indent" ? m[1] ?? "" : undefined;

      const endLine = findFunctionEnd(lines, i, lang, indent);
      const funcLineCount = endLine - i;

      if (funcLineCount < minLines) break;

      if (hasPrecedingComment(lines, i, lang, 3)) break;

      if (lang.allowsDocstring && lines[i + 1] && isDocstringLine(lines[i + 1])) break;

      hits.push({ file, line: i + 1, name, lineCount: funcLineCount });
      break; // one match per line is enough
    }
  }

  return hits;
}

registerGenericEvaluator({
  type: "code_comments",
  async check(ctx: ValidatorContext, config: Record<string, unknown>): Promise<ValidatorResult> {
    const files = ctx.changedFiles ?? [];
    if (files.length === 0) {
      return { pass: true, severity: "info", message: "No changed files to scan" };
    }

    const minLines = typeof config.min_lines === "number" && config.min_lines > 0 ? config.min_lines : 15;
    const severity =
      config.severity === "error" || config.severity === "warning" || config.severity === "info"
        ? config.severity
        : "warning";
    const allowlist = Array.isArray(config.allowlist_paths)
      ? config.allowlist_paths.filter((p): p is string => typeof p === "string")
      : ["tests/", "test/", "__tests__/", "fixtures/", "docs/"];
    const maxBytes = typeof config.max_scan_bytes === "number" ? config.max_scan_bytes : 2_000_000;

    // Optional language filter (by name, case-insensitive). Absent = all.
    const wantedLanguages = Array.isArray(config.languages)
      ? new Set(
          config.languages.filter((l): l is string => typeof l === "string").map((l) => l.toLowerCase()),
        )
      : null;

    const allHits: Violation[] = [];
    let scanned = 0;

    for (const file of files) {
      if (allowlist.some((p) => file.includes(p))) continue;
      const lang = pickLanguage(file);
      if (!lang) continue;
      if (wantedLanguages && !wantedLanguages.has(lang.name.toLowerCase())) continue;

      const abs = join(ctx.projectRoot, file);
      try {
        const stat = statSync(abs);
        if (stat.size > maxBytes) continue;
        const content = readFileSync(abs, "utf8");
        scanned += 1;
        allHits.push(...scanFile(content, file, lang, minLines));
      } catch {
        // unreadable — skip
      }
    }

    if (allHits.length === 0) {
      return {
        pass: true,
        severity: "info",
        message: `No undocumented functions (${minLines}+ lines) in ${scanned} changed file${scanned === 1 ? "" : "s"}`,
      };
    }

    const detail =
      allHits
        .slice(0, 30)
        .map((h) => `${h.file}:${h.line} — ${h.name} (${h.lineCount} lines)`)
        .join("\n") + (allHits.length > 30 ? `\n... and ${allHits.length - 30} more` : "");

    return {
      pass: false,
      severity,
      message: `${allHits.length} function${allHits.length === 1 ? "" : "s"} of ${minLines}+ lines without preceding comment`,
      detail,
    };
  },
});
