#!/usr/bin/env node
/**
 * Regex-based Rust parser for Cortex.
 *
 * Extracts semantic chunks from Rust source files: functions, structs, enums,
 * traits, impl blocks (with methods), inline modules, macro_rules! definitions,
 * use imports, and call relationships.
 *
 * No external dependencies — pure regex, always available.
 */

const CALL_KEYWORDS = new Set([
  "if", "for", "while", "loop", "match", "return",
  "Some", "None", "Ok", "Err", "Box", "Vec", "String",
  "println", "eprintln", "format", "write", "writeln",
  "panic", "todo", "unimplemented", "unreachable",
  "assert", "assert_eq", "assert_ne", "debug_assert",
  "debug_assert_eq", "debug_assert_ne",
  "cfg", "derive", "allow", "warn", "deny"
]);

const VIS_PREFIX = /(?:pub(?:\s*\([^)]*\))?\s+)?/;
const VIS_PREFIX_SRC = VIS_PREFIX.source;
const LINE_START = "^[^\\S\\n]*";

const FN_PATTERN = new RegExp(
  `${LINE_START}${VIS_PREFIX_SRC}(?:default\\s+)?(?:async\\s+)?(?:unsafe\\s+)?(?:const\\s+)?(?:extern\\s+"[^"]*"\\s+)?fn\\s+([A-Za-z_]\\w*)`,
  "gm"
);

const STRUCT_PATTERN = new RegExp(
  `${LINE_START}${VIS_PREFIX_SRC}struct\\s+([A-Za-z_]\\w*)`,
  "gm"
);

const ENUM_PATTERN = new RegExp(
  `${LINE_START}${VIS_PREFIX_SRC}enum\\s+([A-Za-z_]\\w*)`,
  "gm"
);

const TRAIT_PATTERN = new RegExp(
  `${LINE_START}${VIS_PREFIX_SRC}(?:unsafe\\s+)?trait\\s+([A-Za-z_]\\w*)`,
  "gm"
);

const IMPL_PATTERN = /^[^\S\n]*(?:unsafe\s+)?impl(?:<[^>]*>)?\s+(?:([A-Za-z_]\w*(?:<[^>]*>)?)\s+for\s+)?([A-Za-z_]\w*)/gm;

const MOD_PATTERN = new RegExp(
  `${LINE_START}${VIS_PREFIX_SRC}mod\\s+([A-Za-z_]\\w*)`,
  "gm"
);

const MACRO_PATTERN = new RegExp(
  `${LINE_START}${VIS_PREFIX_SRC}macro_rules!\\s+([A-Za-z_]\\w*)`,
  "gm"
);

const USE_PATTERN = new RegExp(
  `^\\s*${VIS_PREFIX_SRC}use\\s+(.+?)\\s*;`,
  "gm"
);

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
  let inRawString = false;
  let rawHashCount = 0;

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

    if (inRawString) {
      if (current === '"') {
        let hashes = 0;
        while (hashes < rawHashCount && text[index + 1 + hashes] === "#") {
          hashes += 1;
        }
        if (hashes === rawHashCount) {
          inRawString = false;
          index += hashes;
        }
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

    // Rust raw strings: r#"..."#, r##"..."##, etc.
    if (current === "r" && (next === '"' || next === "#")) {
      let hashes = 0;
      let pos = index + 1;
      while (text[pos] === "#") {
        hashes += 1;
        pos += 1;
      }
      if (text[pos] === '"') {
        inRawString = true;
        rawHashCount = hashes;
        index = pos;
        continue;
      }
    }

    if (current === '"' || current === "'") {
      // Rust lifetime annotations ('a) should not trigger string mode
      if (current === "'" && next && /[a-zA-Z_]/.test(next)) {
        // Check if this is a lifetime like 'a or a char like 'x'
        const afterIdent = text.indexOf("'", index + 2);
        const nextNewline = text.indexOf("\n", index + 1);
        if (afterIdent === -1 || (nextNewline !== -1 && afterIdent > nextNewline) || afterIdent > index + 4) {
          // Lifetime — skip the tick and identifier
          continue;
        }
      }
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

function findOpenBraceAfterMatch(code, matchEnd) {
  let inLineComment = false;
  let inBlockComment = false;
  let inString = false;
  let stringChar = "";

  for (let i = matchEnd; i < code.length; i += 1) {
    const ch = code[i];
    const next = code[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") { inBlockComment = false; i += 1; }
      continue;
    }
    if (inString) {
      if (ch === "\\" && next) { i += 1; continue; }
      if (ch === stringChar) { inString = false; stringChar = ""; }
      continue;
    }
    if (ch === "/" && next === "/") { inLineComment = true; i += 1; continue; }
    if (ch === "/" && next === "*") { inBlockComment = true; i += 1; continue; }
    if (ch === '"' || ch === "'") { inString = true; stringChar = ch; continue; }

    if (ch === "{") return i;
    if (ch === ";") return -1; // Declaration without body
  }
  return -1;
}

function buildSignature(source) {
  const snippet = normalizeWhitespace(source);
  const braceIndex = snippet.indexOf("{");
  return (braceIndex === -1 ? snippet : snippet.slice(0, braceIndex)).trim();
}

function extractUseImports(code) {
  const imports = [];
  let match;
  USE_PATTERN.lastIndex = 0;
  while ((match = USE_PATTERN.exec(code)) !== null) {
    imports.push(match[1].trim());
  }
  return [...new Set(imports)];
}

function collectCallNames(body, chunkName) {
  const refs = new Set();
  const ownTailName = chunkName.split("::").pop() || chunkName;
  const pattern = /\b([A-Za-z_]\w*(?:::\w+)*)\s*[!(]\s*/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    let name = match[1];
    const tailName = name.split("::").pop() || name;
    if (CALL_KEYWORDS.has(tailName) || tailName === ownTailName) {
      continue;
    }
    // Skip if it matched a macro invocation keyword
    if (CALL_KEYWORDS.has(name)) {
      continue;
    }
    refs.add(tailName);
  }
  return [...refs];
}

function extractBlockChunks(code, pattern, kind, language) {
  const chunks = [];
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(code)) !== null) {
    const name = match[1];
    const openBraceIndex = findOpenBraceAfterMatch(code, match.index + match[0].length);
    if (openBraceIndex === -1) {
      // Could be a unit struct like `struct Foo;` — extract as single-line chunk
      if (kind === "struct") {
        const lineEnd = code.indexOf("\n", match.index);
        const endIdx = lineEnd === -1 ? code.length : lineEnd;
        const body = code.slice(match.index, endIdx).trimEnd();
        if (body.includes(";")) {
          const startLine = countLinesBefore(code, match.index);
          chunks.push({
            name,
            kind,
            signature: normalizeWhitespace(body),
            body,
            startLine,
            endLine: startLine,
            language,
            calls: [],
            imports: []
          });
        }
      }
      continue;
    }
    const closeBraceIndex = findMatchingBrace(code, openBraceIndex);
    if (closeBraceIndex === -1) continue;

    const bodyEndIndex = closeBraceIndex + 1;
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
      calls: kind === "function" ? collectCallNames(body, name) : [],
      imports: []
    });
  }
  return chunks;
}

function extractImplBlocks(code, language, imports) {
  const chunks = [];
  IMPL_PATTERN.lastIndex = 0;
  let match;
  while ((match = IMPL_PATTERN.exec(code)) !== null) {
    const traitName = match[1] || null;
    const typeName = match[2];
    const openBraceIndex = findOpenBraceAfterMatch(code, match.index + match[0].length);
    if (openBraceIndex === -1) continue;
    const closeBraceIndex = findMatchingBrace(code, openBraceIndex);
    if (closeBraceIndex === -1) continue;

    const implBody = code.slice(match.index, closeBraceIndex + 1);
    const implStartLine = countLinesBefore(code, match.index);
    const implEndLine = countLinesBefore(code, closeBraceIndex);
    const implName = traitName ? `${traitName} for ${typeName}` : typeName;

    // Add the impl block itself
    chunks.push({
      name: implName,
      kind: "impl",
      signature: buildSignature(implBody),
      body: implBody,
      startLine: implStartLine,
      endLine: implEndLine,
      language,
      calls: [],
      imports: []
    });

    // Extract methods within the impl block
    const innerCode = code.slice(openBraceIndex + 1, closeBraceIndex);
    const innerOffset = openBraceIndex + 1;
    FN_PATTERN.lastIndex = 0;
    let fnMatch;
    while ((fnMatch = FN_PATTERN.exec(innerCode)) !== null) {
      const fnName = fnMatch[1];
      const qualifiedName = `${typeName}::${fnName}`;
      const fnOpenBrace = findOpenBraceAfterMatch(innerCode, fnMatch.index + fnMatch[0].length);
      if (fnOpenBrace === -1) continue;
      const fnCloseBrace = findMatchingBrace(innerCode, fnOpenBrace);
      if (fnCloseBrace === -1) continue;

      const fnBodyEndIndex = fnCloseBrace + 1;
      const fnBody = innerCode.slice(fnMatch.index, fnBodyEndIndex);
      const fnStartLine = countLinesBefore(code, innerOffset + fnMatch.index);
      const fnEndLine = countLinesBefore(code, innerOffset + Math.max(fnMatch.index, fnBodyEndIndex - 1));

      chunks.push({
        name: qualifiedName,
        kind: "method",
        signature: buildSignature(fnBody),
        body: fnBody,
        startLine: fnStartLine,
        endLine: fnEndLine,
        language,
        calls: collectCallNames(fnBody, qualifiedName),
        imports
      });
    }
  }
  return chunks;
}

function extractMacroChunks(code, language) {
  const chunks = [];
  MACRO_PATTERN.lastIndex = 0;
  let match;
  while ((match = MACRO_PATTERN.exec(code)) !== null) {
    const name = match[1];
    // macro_rules! uses { } or ( ) or [ ] as delimiters
    const afterMatch = code.slice(match.index + match[0].length).trimStart();
    let openChar, closeChar;
    if (afterMatch[0] === "{") {
      openChar = "{";
    } else if (afterMatch[0] === "(") {
      openChar = "(";
    } else if (afterMatch[0] === "[") {
      openChar = "[";
    } else {
      continue;
    }

    // For braces, use findMatchingBrace; for parens/brackets, do simple depth counting
    let endIndex;
    if (openChar === "{") {
      const openBraceIndex = code.indexOf("{", match.index + match[0].length);
      const closeBraceIndex = findMatchingBrace(code, openBraceIndex);
      if (closeBraceIndex === -1) continue;
      endIndex = closeBraceIndex + 1;
    } else {
      closeChar = openChar === "(" ? ")" : "]";
      const startSearch = match.index + match[0].length + afterMatch.indexOf(openChar);
      let depth = 0;
      endIndex = -1;
      for (let i = startSearch; i < code.length; i += 1) {
        if (code[i] === openChar) depth += 1;
        else if (code[i] === closeChar) {
          depth -= 1;
          if (depth === 0) {
            endIndex = i + 1;
            break;
          }
        }
      }
      if (endIndex === -1) continue;
    }

    const body = code.slice(match.index, endIndex);
    const startLine = countLinesBefore(code, match.index);
    const endLine = countLinesBefore(code, Math.max(match.index, endIndex - 1));

    chunks.push({
      name,
      kind: "macro",
      signature: `macro_rules! ${name}`,
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

function extractTopLevelFunctions(code, language, implChunks, imports) {
  const chunks = [];
  FN_PATTERN.lastIndex = 0;
  let match;
  while ((match = FN_PATTERN.exec(code)) !== null) {
    const name = match[1];
    const openBraceIndex = findOpenBraceAfterMatch(code, match.index + match[0].length);
    if (openBraceIndex === -1) continue;
    const closeBraceIndex = findMatchingBrace(code, openBraceIndex);
    if (closeBraceIndex === -1) continue;

    const startLine = countLinesBefore(code, match.index);
    const endLine = countLinesBefore(code, closeBraceIndex);

    // Skip functions that are inside impl blocks (already extracted as methods)
    const insideImpl = implChunks.some(
      (impl) => impl.kind === "impl" && startLine >= impl.startLine && endLine <= impl.endLine
    );
    if (insideImpl) continue;

    const bodyEndIndex = closeBraceIndex + 1;
    const body = code.slice(match.index, bodyEndIndex);

    chunks.push({
      name,
      kind: "function",
      signature: buildSignature(body),
      body,
      startLine,
      endLine,
      language,
      calls: collectCallNames(body, name),
      imports
    });
  }
  return chunks;
}

export function parseCode(code, filePath, language = "rust") {
  const imports = extractUseImports(code);
  const implChunks = extractImplBlocks(code, language, imports);
  const structChunks = extractBlockChunks(code, STRUCT_PATTERN, "struct", language);
  const enumChunks = extractBlockChunks(code, ENUM_PATTERN, "enum", language);
  const traitChunks = extractBlockChunks(code, TRAIT_PATTERN, "trait", language);
  const modChunks = extractBlockChunks(code, MOD_PATTERN, "module", language);
  const macroChunks = extractMacroChunks(code, language);
  const fnChunks = extractTopLevelFunctions(code, language, implChunks, imports);

  const seen = new Set();
  const chunks = [...structChunks, ...enumChunks, ...traitChunks, ...implChunks, ...modChunks, ...macroChunks, ...fnChunks].filter((chunk) => {
    const key = `${chunk.kind}|${chunk.name}|${chunk.startLine}|${chunk.endLine}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { chunks, errors: [] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import("node:fs");
  const filePath = process.argv[2];

  if (!filePath) {
    console.error("Usage: rust.mjs <file.rs>");
    process.exit(1);
  }

  const code = fs.readFileSync(filePath, "utf8");
  const result = parseCode(code, filePath, "rust");
  console.log(JSON.stringify(result, null, 2));
}
