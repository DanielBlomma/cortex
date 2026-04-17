#!/usr/bin/env node
/**
 * Classic Visual Basic 6 parser for Cortex.
 *
 * VB6 has no tree-sitter grammar (the tree-sitter-wasms bundle ships
 * nothing for VB, and tree-sitter-vb-dotnet targets VB.NET which has
 * materially different syntax). Roslyn can only parse VB.NET, not
 * VB6. So this is a regex-based "lightweight first-pass" — same
 * approach the legacy cpp.mjs and pre-tree-sitter rust.mjs used.
 *
 * Covered extensions:
 *   .bas  — standard module
 *   .cls  — class module
 *   .frm  — form
 *   .ctl  — user control
 *
 * Extracts Sub / Function / Property (Get|Let|Set) / Type / Enum
 * declarations. Strips the VB6 binary-ish header block (VERSION ...,
 * BEGIN ... END, Attribute ...) that .cls/.frm/.ctl files carry
 * before real code. `.frm` designer BEGIN ... END property blocks
 * are also stripped so the parser only sees code.
 *
 * Naming:
 *   .bas    -> ModuleName.Proc  (ModuleName from `Attribute VB_Name` or filename)
 *   .cls    -> ClassName.Method
 *   .frm    -> FormName.EventHandler / FormName.Helper
 *   .ctl    -> ControlName.Method
 *
 * VB6 has no imports in source code — references live in the .vbp
 * project file. So chunk.imports is always [].
 */

import path from "node:path";
import fs from "node:fs";

const KIND_BY_EXT = {
  ".bas": "module",
  ".cls": "class",
  ".frm": "form",
  ".ctl": "usercontrol"
};

const VBP_HEADER_PREFIXES = ["VERSION ", "Attribute ", "Object="];

const ATTR_VB_NAME = /Attribute\s+VB_Name\s*=\s*"([^"]+)"/i;

// VB6 builtins / intrinsics / common API surfaces — not user calls.
const CALL_FILTER = new Set([
  "MsgBox", "InputBox", "Debug", "Err", "Me", "Nothing", "New",
  "Len", "LenB", "Str", "Val", "CStr", "CInt", "CLng", "CDbl",
  "CBool", "CByte", "CSng", "CDec", "CVar", "CDate",
  "Left", "Right", "Mid", "UCase", "LCase", "Trim", "LTrim", "RTrim",
  "Chr", "Asc", "IsEmpty", "IsNull", "IsNumeric", "IsDate", "IsArray",
  "IsObject", "VarType", "TypeName", "UBound", "LBound",
  "Array", "Split", "Join", "Replace", "InStr", "InStrRev",
  "Abs", "Int", "Fix", "Sgn", "Sqr", "Exp", "Log", "Sin", "Cos", "Tan",
  "Now", "Date", "Time", "DateAdd", "DateDiff", "DatePart", "Format",
  "Dir", "FileExists", "GetAttr", "FileCopy", "Kill", "MkDir", "RmDir",
  "Open", "Close", "Input", "Print", "Write", "LOF", "EOF", "Loc",
  "If", "Else", "ElseIf", "End", "Do", "Loop", "While", "Wend",
  "For", "Next", "Each", "To", "Step", "Exit", "Select", "Case",
  "With", "GoTo", "GoSub", "Return", "Resume", "On", "Error",
  "DoEvents", "RaiseEvent", "Event", "Call", "Stop", "Beep",
  "Set", "Get", "Let", "Dim", "ReDim", "Preserve", "Static",
  "Const", "Public", "Private", "Friend", "Sub", "Function", "Property",
  "True", "False", "And", "Or", "Not", "Xor", "Eqv", "Imp", "Mod",
  "App", "Screen", "Forms", "Printer", "Clipboard"
]);

const SUPPORTED_EXTS = new Set([".bas", ".cls", ".frm", ".ctl"]);

function normalizeWhitespace(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function extractModuleName(rawSource, filePath) {
  const attrMatch = rawSource.match(ATTR_VB_NAME);
  if (attrMatch) return attrMatch[1];
  // Fall back to filename without extension.
  const base = path.basename(filePath);
  const dot = base.lastIndexOf(".");
  return dot === -1 ? base : base.slice(0, dot);
}

/**
 * Strip the VB6 binary-ish header that .cls/.frm/.ctl files carry
 * before real source code. Only applied to those extensions — .bas
 * files begin directly with code (or `Attribute VB_Name` lines).
 * For .frm / .ctl we also strip the designer BEGIN ... END block
 * that describes controls and property values.
 */
function stripHeader(source, ext) {
  let out = source;

  if (ext === ".bas") {
    // Strip `Attribute VB_Name = "..."` and similar leading Attribute
    // lines. Keep the rest intact.
    const lines = out.split("\n");
    let firstCodeLine = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const trimmed = lines[i].trim();
      if (trimmed === "" || trimmed.startsWith("Attribute ")) {
        firstCodeLine = i + 1;
      } else {
        break;
      }
    }
    // Preserve original line numbers by blanking (not deleting) headers.
    for (let i = 0; i < firstCodeLine; i += 1) lines[i] = "";
    return lines.join("\n");
  }

  // .cls / .frm / .ctl — strip VERSION + BEGIN/END designer + Attribute lines.
  const lines = out.split("\n");
  let beginDepth = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    const trimmedLower = trimmed.toLowerCase();

    if (beginDepth > 0) {
      if (/^begin\b/i.test(trimmed)) beginDepth += 1;
      else if (/^end\s*$/i.test(trimmed)) beginDepth -= 1;
      lines[i] = "";
      continue;
    }

    if (VBP_HEADER_PREFIXES.some((p) => trimmed.startsWith(p))) {
      lines[i] = "";
      continue;
    }

    if (/^begin\b/i.test(trimmed)) {
      beginDepth = 1;
      lines[i] = "";
      continue;
    }
  }
  return lines.join("\n");
}

function countLinesBefore(text, index) {
  let count = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === "\n") count += 1;
  }
  return count;
}

function findBlockEnd(source, startIndex, endKeyword) {
  const endPattern = new RegExp(
    `^[ \\t]*End\\s+${endKeyword}\\b`,
    "im"
  );
  endPattern.lastIndex = startIndex;
  const slice = source.slice(startIndex);
  const match = slice.match(endPattern);
  if (!match) return -1;
  // match.index is offset within slice
  const endLineStart = startIndex + match.index;
  const newlineAfter = source.indexOf("\n", endLineStart + match[0].length);
  return newlineAfter === -1 ? source.length : newlineAfter;
}

function extractCallsFromBody(body) {
  const calls = new Set();
  // Identifier followed by `(` — function/sub call
  const callPattern = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let m;
  while ((m = callPattern.exec(body)) !== null) {
    const name = m[1];
    if (!CALL_FILTER.has(name)) calls.add(name);
  }
  // object.method — no parens needed in VB6
  const methodPattern = /\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
  while ((m = methodPattern.exec(body)) !== null) {
    const name = m[1];
    if (!CALL_FILTER.has(name)) calls.add(name);
  }
  // Call <Ident>
  const callKeywordPattern = /\bCall\s+([A-Za-z_][A-Za-z0-9_]*)/gi;
  while ((m = callKeywordPattern.exec(body)) !== null) {
    const name = m[1];
    if (!CALL_FILTER.has(name)) calls.add(name);
  }
  // Bareword Sub call at start of line: VB6 lets you invoke a Sub
  // without parens or Call keyword. The identifier must be alone on
  // the line or followed by whitespace + argument list, and must not
  // be an assignment (`x = ...`) or a declaration (`Dim x`).
  const barewordPattern = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)(?:[ \t]+[^=\n:]|[ \t]*$)/gm;
  while ((m = barewordPattern.exec(body)) !== null) {
    const name = m[1];
    if (!CALL_FILTER.has(name)) calls.add(name);
  }
  return [...calls];
}

function buildBlockChunk({ source, strippedSource, ownerName, kind, keyword, pattern, language }) {
  const chunks = [];
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(strippedSource)) !== null) {
    const matchStart = match.index;
    const endOfBlock = findBlockEnd(strippedSource, matchStart + match[0].length, keyword);
    if (endOfBlock === -1) continue;
    const body = strippedSource.slice(matchStart, endOfBlock);
    const startLine = countLinesBefore(strippedSource, matchStart);
    const endLine = countLinesBefore(strippedSource, endOfBlock);
    const visibility = match[1] ? match[1].toLowerCase() : "";
    const exported = visibility !== "private";
    const memberName = match[match.length - 1];
    const qualifiedName = ownerName ? `${ownerName}.${memberName}` : memberName;

    chunks.push({
      name: qualifiedName,
      kind,
      signature: normalizeWhitespace(body.split("\n")[0]),
      body,
      startLine,
      endLine,
      language,
      exported,
      calls: extractCallsFromBody(body),
      imports: []
    });
  }
  return chunks;
}

function buildTypeOrEnumChunks({ strippedSource, ownerName, kind, keyword, pattern, language }) {
  const chunks = [];
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(strippedSource)) !== null) {
    const matchStart = match.index;
    const endOfBlock = findBlockEnd(strippedSource, matchStart + match[0].length, keyword);
    if (endOfBlock === -1) continue;
    const body = strippedSource.slice(matchStart, endOfBlock);
    const startLine = countLinesBefore(strippedSource, matchStart);
    const endLine = countLinesBefore(strippedSource, endOfBlock);
    const typeName = match[match.length - 1];
    const qualifiedName = ownerName ? `${ownerName}.${typeName}` : typeName;
    const visibility = match[1] ? match[1].toLowerCase() : "";
    chunks.push({
      name: qualifiedName,
      kind,
      signature: normalizeWhitespace(body.split("\n")[0]),
      body,
      startLine,
      endLine,
      language,
      exported: visibility !== "private",
      calls: [],
      imports: []
    });
  }
  return chunks;
}

function buildOwnerChunk({ source, strippedSource, ownerName, kind, language }) {
  // One chunk for the whole file representing the module/class/form/control.
  const lines = strippedSource.split("\n");
  // Find first non-blank line as start; last non-blank as end.
  let startLine = 1;
  let endLine = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== "") { startLine = i + 1; break; }
  }
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trim() !== "") { endLine = i + 1; break; }
  }
  return {
    name: ownerName,
    kind,
    signature: `${kind} ${ownerName}`,
    body: source,
    startLine,
    endLine,
    language,
    exported: true,
    calls: [],
    imports: []
  };
}

export function parseCode(code, filePath, language = "vb6") {
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTS.has(ext)) {
    return { chunks: [], errors: [] };
  }

  const ownerName = extractModuleName(code, filePath);
  const ownerKind = KIND_BY_EXT[ext] ?? "module";
  const memberKind = ext === ".bas" ? "function" : "method";
  const strippedSource = stripHeader(code, ext);

  const subPattern = /^[ \t]*(?:(Public|Private|Friend)\s+)?(?:Static\s+)?Sub\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gim;
  const functionPattern = /^[ \t]*(?:(Public|Private|Friend)\s+)?(?:Static\s+)?Function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gim;
  const propertyPattern = /^[ \t]*(?:(Public|Private|Friend)\s+)?Property\s+(?:Get|Let|Set)\s+([A-Za-z_][A-Za-z0-9_]*)/gim;
  const typePattern = /^[ \t]*(?:(Public|Private)\s+)?Type\s+([A-Za-z_][A-Za-z0-9_]*)/gim;
  const enumPattern = /^[ \t]*(?:(Public|Private)\s+)?Enum\s+([A-Za-z_][A-Za-z0-9_]*)/gim;

  const chunks = [];

  chunks.push(buildOwnerChunk({
    source: code,
    strippedSource,
    ownerName,
    kind: ownerKind,
    language
  }));

  chunks.push(...buildBlockChunk({
    source: code,
    strippedSource,
    ownerName,
    kind: memberKind,
    keyword: "Sub",
    pattern: subPattern,
    language
  }));

  chunks.push(...buildBlockChunk({
    source: code,
    strippedSource,
    ownerName,
    kind: memberKind,
    keyword: "Function",
    pattern: functionPattern,
    language
  }));

  const propertyChunks = buildBlockChunk({
    source: code,
    strippedSource,
    ownerName,
    kind: "property",
    keyword: "Property",
    pattern: propertyPattern,
    language
  });
  // Property Get/Let/Set with same name collapse to one property chunk —
  // keep only the first occurrence per qualified name so the graph
  // doesn't show three property chunks for one logical property.
  const seenProps = new Set();
  for (const chunk of propertyChunks) {
    if (seenProps.has(chunk.name)) continue;
    seenProps.add(chunk.name);
    chunks.push(chunk);
  }

  chunks.push(...buildTypeOrEnumChunks({
    strippedSource,
    ownerName,
    kind: "type",
    keyword: "Type",
    pattern: typePattern,
    language
  }));

  chunks.push(...buildTypeOrEnumChunks({
    strippedSource,
    ownerName,
    kind: "enum",
    keyword: "Enum",
    pattern: enumPattern,
    language
  }));

  // Dedupe by (kind, name, startLine, endLine) — mirrors other parsers.
  const seen = new Set();
  const deduped = chunks.filter((chunk) => {
    const key = `${chunk.kind}|${chunk.name}|${chunk.startLine}|${chunk.endLine}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { chunks: deduped, errors: [] };
}

export function isAvailable() {
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: vb6.mjs <file.{bas,cls,frm,ctl}>");
    process.exit(1);
  }
  const code = fs.readFileSync(target, "utf8");
  const result = parseCode(code, target, "vb6");
  console.log(JSON.stringify(result, null, 2));
}
