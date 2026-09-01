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
import {
  DIALECT_LIMITS,
  canonicalDialectLanguageSpecificShape,
  canonicalDialectNormalizedShape,
  canonicalRepositoryPath,
  canonicalizeDialectObservations,
  createDialectObservationTransport,
  dialectFamilyForMode,
  stableDialectObservationId,
  visibleBounded
} from "../lib/dialect-observation-contract.mjs";

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

function buildBlockChunk({ source, strippedSource, ownerName, kind, keyword, pattern, language, dialectState = null }) {
  const chunks = [];
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(strippedSource)) !== null) {
    const matchStart = match.index;
    const endOfBlock = findBlockEnd(strippedSource, matchStart + match[0].length, keyword);
    if (endOfBlock === -1) {
      if (dialectState) dialectState.malformed = true;
      continue;
    }
    const body = strippedSource.slice(matchStart, endOfBlock);
    const startLine = countLinesBefore(strippedSource, matchStart);
    const endLine = countLinesBefore(strippedSource, endOfBlock);
    const visibility = match[1] ? match[1].toLowerCase() : "";
    const exported = visibility !== "private";
    const memberName = match[match.length - 1];
    const qualifiedName = ownerName ? `${ownerName}.${memberName}` : memberName;

    const chunk = {
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
    };
    chunks.push(chunk);
    if (dialectState) {
      addDialectCandidate(dialectState, {
        startOffset: matchStart,
        endOffset: matchStart + match[0].length,
        category: "declaration_structure",
        kind: keyword === "Property" ? "property" : kind,
        form: "declaration",
        syntaxKind: `${keyword}Declaration`,
        ordinal: null,
        chunk
      });
      collectBlockDialectCandidates(body, matchStart, chunk, dialectState);
    }
  }
  return chunks;
}

function buildTypeOrEnumChunks({ strippedSource, ownerName, kind, keyword, pattern, language, dialectState = null }) {
  const chunks = [];
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(strippedSource)) !== null) {
    const matchStart = match.index;
    const endOfBlock = findBlockEnd(strippedSource, matchStart + match[0].length, keyword);
    if (endOfBlock === -1) {
      if (dialectState) dialectState.malformed = true;
      continue;
    }
    const body = strippedSource.slice(matchStart, endOfBlock);
    const startLine = countLinesBefore(strippedSource, matchStart);
    const endLine = countLinesBefore(strippedSource, endOfBlock);
    const typeName = match[match.length - 1];
    const qualifiedName = ownerName ? `${ownerName}.${typeName}` : typeName;
    const visibility = match[1] ? match[1].toLowerCase() : "";
    const chunk = {
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
    };
    chunks.push(chunk);
    if (dialectState) {
      addDialectCandidate(dialectState, {
        startOffset: matchStart,
        endOffset: matchStart + match[0].length,
        category: "declaration_structure",
        kind: "type",
        form: "declaration",
        syntaxKind: `${keyword}Declaration`,
        ordinal: null,
        chunk
      });
      addDialectCandidate(dialectState, {
        startOffset: matchStart,
        endOffset: matchStart + match[0].length,
        category: "data_representation",
        kind: keyword === "Enum" ? "variant" : "record",
        form: "declaration",
        syntaxKind: `${keyword}Declaration`,
        ordinal: null,
        chunk
      });
    }
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
  return parseInternal(code, filePath, language, false).parserResult;
}

export function parseCodeWithDialectObservations(code, repositoryPath, language = "vb6") {
  const metadata = prepareDialectInput(code, repositoryPath, language);
  const parsed = parseInternal(code, repositoryPath, language, !metadata.oversized);
  if (metadata.oversized) {
    return createLightweightTransport(
      parsed.parserResult,
      statusEnvelope("oversized", "source exceeds dialect observation byte cap")
    );
  }
  const observationEnvelope = parsed.dialectState.malformed
    ? statusEnvelope("malformed", "lightweight parser reported syntax errors")
    : lightweightObservationEnvelope(code, repositoryPath, metadata, parsed.dialectState.candidates);
  return createLightweightTransport(parsed.parserResult, observationEnvelope);
}

function parseInternal(code, filePath, language, collectDialect) {
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTS.has(ext)) {
    return {
      parserResult: { chunks: [], errors: [] },
      dialectState: { candidates: [], identities: new Set(), malformed: false }
    };
  }

  const dialectState = { candidates: [], identities: new Set(), malformed: false };

  const ownerName = extractModuleName(code, filePath);
  const ownerKind = KIND_BY_EXT[ext] ?? "module";
  const memberKind = ext === ".bas" ? "function" : "method";
  const strippedSource = stripHeader(code, ext);
  if (collectDialect) {
    dialectState.sourceLineStarts = sourceLineStarts(code);
    dialectState.strippedLineStarts = sourceLineStarts(strippedSource);
  }

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
  if (collectDialect && code.length > 0) {
    const ownerChunk = chunks[0];
    const first = dialectState.sourceLineStarts[ownerChunk.startLine - 1] ?? 0;
    const endLineStart = dialectState.sourceLineStarts[ownerChunk.endLine - 1] ?? first;
    const nextLineStart = dialectState.sourceLineStarts[ownerChunk.endLine] ?? code.length;
    const endLine = code.slice(endLineStart, nextLineStart);
    const last = endLineStart + endLine.search(/\s*$/);
    if (last > first) {
      addDialectCandidate(dialectState, {
        startOffset: first,
        endOffset: last,
        category: "declaration_structure",
        kind: ext === ".bas" ? "module" : "type",
        form: "declaration",
        syntaxKind: `${ownerKind[0].toUpperCase()}${ownerKind.slice(1)}File`,
        ordinal: null,
        chunk: ownerChunk,
        sourceOffsets: true
      });
    }
  }

  chunks.push(...buildBlockChunk({
    source: code,
    strippedSource,
    ownerName,
    kind: memberKind,
    keyword: "Sub",
    pattern: subPattern,
    language,
    dialectState: collectDialect ? dialectState : null
  }));

  chunks.push(...buildBlockChunk({
    source: code,
    strippedSource,
    ownerName,
    kind: memberKind,
    keyword: "Function",
    pattern: functionPattern,
    language,
    dialectState: collectDialect ? dialectState : null
  }));

  const propertyChunks = buildBlockChunk({
    source: code,
    strippedSource,
    ownerName,
    kind: "property",
    keyword: "Property",
    pattern: propertyPattern,
    language,
    dialectState: collectDialect ? dialectState : null
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
    language,
    dialectState: collectDialect ? dialectState : null
  }));

  chunks.push(...buildTypeOrEnumChunks({
    strippedSource,
    ownerName,
    kind: "enum",
    keyword: "Enum",
    pattern: enumPattern,
    language,
    dialectState: collectDialect ? dialectState : null
  }));

  // Dedupe by (kind, name, startLine, endLine) — mirrors other parsers.
  const seen = new Set();
  const deduped = chunks.filter((chunk) => {
    const key = `${chunk.kind}|${chunk.name}|${chunk.startLine}|${chunk.endLine}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const returnedChunks = new Set(deduped);
  for (const candidate of dialectState.candidates) {
    if (candidate.chunk && !returnedChunks.has(candidate.chunk)) candidate.chunk = null;
  }

  return { parserResult: { chunks: deduped, errors: [] }, dialectState };
}

function prepareDialectInput(code, repositoryPath, language) {
  if (typeof code !== "string") throw new TypeError("Dialect adapter: code must be a string");
  canonicalRepositoryPath(repositoryPath);
  if (typeof language !== "string") throw new TypeError("Dialect adapter: language must be a string");
  const ext = path.extname(repositoryPath).toLowerCase();
  const family = dialectFamilyForMode(ext);
  const mode = family?.modes.find((entry) => entry.extension === ext);
  if (!family || family.family !== "vb6" || mode?.registry_language !== language) {
    throw new TypeError(`Dialect adapter: unsupported parser mode ${language}/${ext || "<none>"}`);
  }
  return {
    family: family.family,
    syntaxMode: ext,
    parserBackend: "lightweight-vb6",
    oversized: Buffer.byteLength(code) > DIALECT_LIMITS.max_source_bytes
  };
}

function collectBlockDialectCandidates(body, bodyOffset, chunk, state) {
  const pattern = /\b(?:If|ElseIf|Select\s+Case|For(?:\s+Each)?|Do|While|Exit\s+(?:Sub|Function|Property)|On\s+Error|Resume|Err\.Raise|Dim|ReDim|Call\s+[A-Za-z_][A-Za-z0-9_]*)\b/gi;
  const dialectBody = maskVb6DialectText(body);
  const calls = [];
  let match;
  while ((match = pattern.exec(dialectBody)) !== null) {
    const value = match[0].replace(/\s+/g, " ").toLowerCase();
    let fact;
    if (value.startsWith("if") || value.startsWith("elseif") || value.startsWith("select")) {
      fact = ["control_flow", "branch", "statement", "BranchStatement"];
    } else if (value.startsWith("for") || value === "do" || value === "while") {
      fact = ["control_flow", "loop", "statement", "LoopStatement"];
    } else if (value.startsWith("exit ")) {
      fact = ["control_flow", "early_return", "statement", "ExitStatement"];
    } else if (value === "on error") {
      fact = ["error_flow", "handler", "statement", "OnErrorStatement"];
    } else if (value === "resume") {
      fact = ["error_flow", "propagate", "statement", "ResumeStatement"];
    } else if (value === "err.raise") {
      fact = ["error_flow", "raise", "statement", "RaiseStatement"];
    } else if (value === "dim" || value === "redim") {
      fact = ["data_representation", value === "redim" ? "container" : "state", "declaration", value === "redim" ? "ReDimStatement" : "DimStatement"];
    } else if (value.startsWith("call ")) {
      calls.push({ startOffset: bodyOffset + match.index, endOffset: bodyOffset + match.index + match[0].length });
    }
    if (fact) {
      addDialectCandidate(state, {
        startOffset: bodyOffset + match.index,
        endOffset: bodyOffset + match.index + match[0].length,
        category: fact[0], kind: fact[1], form: fact[2], syntaxKind: fact[3],
        ordinal: null, chunk
      });
    }
  }
  calls.forEach((call, ordinal) => addDialectCandidate(state, {
    ...call,
    category: "control_flow",
    kind: "ordered_calls",
    form: "statement",
    syntaxKind: "CallStatement",
    ordinal,
    chunk
  }));
}

function maskVb6DialectText(source) {
  const output = source.split("");
  let inString = false;
  let inComment = false;
  let statementStart = true;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\r" || char === "\n") {
      inComment = false;
      statementStart = true;
      continue;
    }
    if (inComment) {
      output[index] = " ";
      continue;
    }
    if (inString) {
      output[index] = " ";
      if (char === '"') {
        if (source[index + 1] === '"') {
          output[index + 1] = " ";
          index += 1;
        } else {
          inString = false;
        }
      }
      continue;
    }
    if (char === '"') {
      output[index] = " ";
      inString = true;
      statementStart = false;
      continue;
    }
    if (char === "'") {
      output[index] = " ";
      inComment = true;
      continue;
    }
    if (char === ":") {
      statementStart = true;
      continue;
    }
    if (/\s/.test(char)) continue;
    if (statementStart && source.slice(index, index + 3).toLowerCase() === "rem" &&
        !/[A-Za-z0-9_]/.test(source[index + 3] ?? "")) {
      output[index] = " ";
      inComment = true;
      continue;
    }
    statementStart = false;
  }
  return output.join("");
}

function addDialectCandidate(state, candidate) {
  if (!candidate.sourceOffsets) {
    candidate.startOffset = translateStrippedOffset(state, candidate.startOffset);
    candidate.endOffset = translateStrippedOffset(state, candidate.endOffset);
  }
  delete candidate.sourceOffsets;
  if (candidate.endOffset <= candidate.startOffset) return;
  const identity = [
    candidate.startOffset, candidate.endOffset, candidate.category, candidate.kind,
    candidate.form, candidate.syntaxKind, candidate.ordinal
  ].join("\0");
  if (state.identities.has(identity)) return;
  state.identities.add(identity);
  state.candidates.push(candidate);
}

function translateStrippedOffset(state, offset) {
  const position = sourcePosition(state.strippedLineStarts, offset);
  const sourceLineStart = state.sourceLineStarts[position.line - 1];
  const sourceLineEnd = state.sourceLineStarts[position.line] ?? Number.MAX_SAFE_INTEGER;
  return Math.min(sourceLineStart + position.column, sourceLineEnd);
}

function lightweightObservationEnvelope(code, repositoryPath, metadata, candidates) {
  const lineStarts = sourceLineStarts(code);
  const observations = candidates.map((candidate) => {
    const start = sourcePosition(lineStarts, candidate.startOffset);
    const end = sourcePosition(lineStarts, candidate.endOffset - 1);
    const containingChunkId = safeContainingChunkId(candidate.chunk, repositoryPath);
    const observation = {
      schema_version: 1,
      family: metadata.family,
      syntax_mode: metadata.syntaxMode,
      parser_backend: metadata.parserBackend,
      repository_path: repositoryPath,
      containing_chunk_id: containingChunkId,
      start_line: start.line,
      start_column: start.column,
      end_line: end.line,
      end_column: end.column,
      category: candidate.category,
      normalized_shape: canonicalDialectNormalizedShape(candidate.category, candidate.kind),
      language_specific_shape: canonicalDialectLanguageSpecificShape(candidate.form, candidate.syntaxKind),
      ordinal: candidate.ordinal,
      observation_id: ""
    };
    observation.observation_id = stableDialectObservationId(observation);
    return observation;
  });
  const chunkCounts = new Map();
  for (const observation of observations) {
    if (observation.containing_chunk_id === null) continue;
    chunkCounts.set(
      observation.containing_chunk_id,
      (chunkCounts.get(observation.containing_chunk_id) ?? 0) + 1
    );
  }
  if (observations.length > DIALECT_LIMITS.max_observations_per_file ||
      [...chunkCounts.values()].some((count) => count > DIALECT_LIMITS.max_observations_per_chunk)) {
    return statusEnvelope(
      "truncated",
      "dialect observation cap exceeded",
      observations.length,
      observations.length
    );
  }
  return statusEnvelope("ok", null, observations.length, 0, observations);
}

function safeContainingChunkId(chunk, repositoryPath) {
  if (!chunk) return null;
  const candidate = `chunk:${repositoryPath}:${chunk.name}:${chunk.startLine}-${chunk.endLine}`;
  try {
    return visibleBounded(candidate, DIALECT_LIMITS.max_identifier_chars, "containing chunk id");
  } catch {
    return null;
  }
}

function sourceLineStarts(code) {
  const starts = [0];
  for (let index = 0; index < code.length; index += 1) {
    if (code.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function sourcePosition(lineStarts, offset) {
  let low = 0;
  let high = lineStarts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle] <= offset) low = middle;
    else high = middle;
  }
  return { line: low + 1, column: offset - lineStarts[low] };
}

function statusEnvelope(status, message, observedCount = 0, omittedCount = 0, observations = []) {
  return {
    schema_version: 1,
    status,
    observations: status === "ok" ? canonicalizeDialectObservations(observations) : [],
    diagnostics: {
      message: status === "ok" ? null : message,
      observed_count: observedCount,
      omitted_count: omittedCount
    }
  };
}

function createLightweightTransport(parserResult, envelope) {
  try {
    return createDialectObservationTransport(parserResult, envelope);
  } catch {
    const fallbackEnvelope = envelope.status === "oversized"
      ? envelope
      : statusEnvelope("unavailable", "lightweight parser result exceeded composite transport contract");
    return createDialectObservationTransport(
      { chunks: [], errors: [{ message: "Lightweight parser result exceeded composite transport contract" }] },
      fallbackEnvelope
    );
  }
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
