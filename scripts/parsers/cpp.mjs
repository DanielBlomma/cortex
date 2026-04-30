#!/usr/bin/env node
/**
 * Capability-gated C/C++ parser bridge for Cortex.
 *
 * Uses `clang`/`clang++` as the runtime capability signal. When available,
 * this parser extracts a lightweight first-pass structure from source text:
 * functions, methods, classes/structs/enums, local call names, and quoted
 * #include references. When the runtime is unavailable, callers should skip
 * structured chunk extraction and fall back to file-level indexing.
 */

import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_CLANG_COMMANDS = ["clang++", "clang"];
const CONTROL_KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "sizeof"]);
const CALL_KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "sizeof",
  "alignof",
  "static_cast",
  "reinterpret_cast",
  "const_cast",
  "dynamic_cast"
]);

const RECORD_PATTERN = /\b(class|struct|enum)\s+([A-Za-z_]\w*)[^;{]*\{/g;
const FUNCTION_PATTERN =
  /^(?!\s*(?:if|for|while|switch|catch|return)\b)\s*(?:template\s*<[\s\S]*?>\s*)?(?:(?:inline|static|constexpr|virtual|friend|extern|typename|auto|unsigned|signed|long|short|const|volatile|mutable|[\w:<>~*&]+\s+)+)?([A-Za-z_~]\w*(?:::\w+)*)\s*\(([\s\S]{0,240}?)\)\s*(?:const\b\s*)?(?:noexcept\b\s*)?(?:->\s*[^{};]+)?\s*\{/gm;

let runtimeCache = null;

function getCompilerCandidates() {
  const override = process.env.CORTEX_CLANG_CMD?.trim();
  return override ? [override] : DEFAULT_CLANG_COMMANDS;
}

function countLinesBefore(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === "\n") {
      line += 1;
    }
  }
  return line;
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function findMatchingBrace(text, openBraceIndex) {
  if (openBraceIndex < 0 || text[openBraceIndex] !== "{") {
    return -1;
  }

  let depth = 0;
  let inSingleLineComment = false;
  let inBlockComment = false;
  let inString = false;
  let stringChar = "";

  for (let index = openBraceIndex; index < text.length; index += 1) {
    const current = text[index];
    const next = text[index + 1];

    if (inSingleLineComment) {
      if (current === "\n") {
        inSingleLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (current === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      if (current === "\\" && next) {
        index += 1;
        continue;
      }
      if (current === stringChar) {
        inString = false;
        stringChar = "";
      }
      continue;
    }

    if (current === "/" && next === "/") {
      inSingleLineComment = true;
      index += 1;
      continue;
    }

    if (current === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (current === '"' || current === "'") {
      inString = true;
      stringChar = current;
      continue;
    }

    if (current === "{") {
      depth += 1;
      continue;
    }

    if (current === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function extractQuotedIncludes(code) {
  const includes = [];
  const pattern = /^\s*#include\s+"([^"]+)"/gm;
  let match;
  while ((match = pattern.exec(code)) !== null) {
    includes.push(match[1].trim());
  }
  return [...new Set(includes)];
}

function collectCallNames(body, chunkName) {
  const refs = new Set();
  const ownTailName = chunkName.split("::").pop() || chunkName;
  const pattern = /\b([A-Za-z_~]\w*(?:::\w+)*)\s*\(/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    const name = match[1];
    const tailName = name.split("::").pop() || name;
    if (CALL_KEYWORDS.has(tailName) || tailName === ownTailName) {
      continue;
    }
    refs.add(tailName);
  }
  return [...refs];
}

function buildSignature(source) {
  const snippet = normalizeWhitespace(source);
  const braceIndex = snippet.indexOf("{");
  return (braceIndex === -1 ? snippet : snippet.slice(0, braceIndex)).trim();
}

function extractRecordChunks(code, language) {
  const chunks = [];
  let match;
  while ((match = RECORD_PATTERN.exec(code)) !== null) {
    const kind = match[1];
    const name = match[2];
    const openBraceIndex = code.indexOf("{", match.index);
    const closeBraceIndex = findMatchingBrace(code, openBraceIndex);
    if (closeBraceIndex === -1) {
      continue;
    }

    const bodyEndIndex =
      code[closeBraceIndex + 1] === ";" ? closeBraceIndex + 2 : closeBraceIndex + 1;
    const body = code.slice(match.index, bodyEndIndex);
    const startLine = countLinesBefore(code, match.index);
    const endLine = countLinesBefore(code, Math.max(match.index, bodyEndIndex - 1));

    chunks.push({
      name,
      kind,
      signature: buildSignature(body),
      body,
      startLine,
      endLine,
      language,
      calls: [],
      imports: []
    });
  }
  return chunks;
}

function extractFunctionChunks(code, language, recordChunks, includes) {
  const chunks = [];
  let match;
  while ((match = FUNCTION_PATTERN.exec(code)) !== null) {
    const rawName = match[1];
    const tailName = rawName.split("::").pop() || rawName;
    if (!tailName || CONTROL_KEYWORDS.has(tailName)) {
      continue;
    }

    const openBraceOffset = match[0].lastIndexOf("{");
    const openBraceIndex = match.index + openBraceOffset;
    const closeBraceIndex = findMatchingBrace(code, openBraceIndex);
    if (closeBraceIndex === -1) {
      continue;
    }

    const startIndex = match.index;
    const bodyEndIndex = closeBraceIndex + 1;
    const body = code.slice(startIndex, bodyEndIndex);
    const startLine = countLinesBefore(code, startIndex);
    const endLine = countLinesBefore(code, Math.max(startIndex, bodyEndIndex - 1));
    const owningRecord = recordChunks.find(
      (record) => startLine >= record.startLine && endLine <= record.endLine
    );
    const isMethod = rawName.includes("::") || Boolean(owningRecord);
    const name =
      rawName.includes("::") || !owningRecord ? rawName : `${owningRecord.name}::${rawName}`;

    chunks.push({
      name,
      kind: isMethod ? "method" : "function",
      signature: buildSignature(body),
      body,
      startLine,
      endLine,
      language,
      calls: collectCallNames(body, name),
      imports: includes
    });
  }
  return chunks;
}

export function resetCppParserRuntimeCache() {
  runtimeCache = null;
}

export function getCppParserRuntime() {
  if (runtimeCache) {
    return runtimeCache;
  }

  const candidates = getCompilerCandidates();
  for (const command of candidates) {
    const probe = spawnSync(command, ["--version"], {
      encoding: "utf8",
      timeout: 5000
    });
    if (!probe.error && probe.status === 0) {
      runtimeCache = {
        available: true,
        command,
        version: (probe.stdout || probe.stderr || "").trim()
      };
      return runtimeCache;
    }
  }

  runtimeCache = {
    available: false,
    command: candidates[0],
    reason: `clang runtime not available (${candidates.join(", ")})`
  };
  return runtimeCache;
}

export function isCppParserAvailable() {
  return getCppParserRuntime().available;
}

export function parseCode(code, filePath, language = "cpp") {
  const runtime = getCppParserRuntime();
  if (!runtime.available) {
    return { chunks: [], errors: [] };
  }

  const normalizedLanguage = language === "c" ? "c" : "cpp";
  const includes = extractQuotedIncludes(code);
  const recordChunks = extractRecordChunks(code, normalizedLanguage);
  const functionChunks = extractFunctionChunks(code, normalizedLanguage, recordChunks, includes);
  const seen = new Set();
  const chunks = [...recordChunks, ...functionChunks].filter((chunk) => {
    const key = `${chunk.kind}|${chunk.name}|${chunk.startLine}|${chunk.endLine}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return { chunks, errors: [] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import("node:fs");
  const filePath = process.argv[2];

  if (!filePath) {
    console.error("Usage: cpp.mjs <file.{c,cpp,h,hpp}>");
    process.exit(1);
  }

  const ext = path.extname(filePath).toLowerCase();
  const language = ext === ".c" || ext === ".h" ? "c" : "cpp";
  const code = fs.readFileSync(filePath, "utf8");
  const result = parseCode(code, filePath, language);
  console.log(JSON.stringify(result, null, 2));
}
