#!/usr/bin/env node
/**
 * SQL parser for Cortex.
 * Extracts stored procedures, views, functions, tables, and triggers as chunks.
 */

import path from "node:path";
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

const SQL_OBJECT_PATTERN =
  /create\s+(?:or\s+alter\s+)?(procedure|proc|view|function|table|trigger)\s+([^\s(]+)/gi;

const SQL_REFERENCE_PATTERNS = [
  /\bexec(?:ute)?\s+([#@]?[A-Za-z0-9_[\].]+)/gi,
  /\bfrom\s+([#@]?[A-Za-z0-9_[\].]+)/gi,
  /\bjoin\s+([#@]?[A-Za-z0-9_[\].]+)/gi,
  /\bupdate\s+([#@]?[A-Za-z0-9_[\].]+)/gi,
  /\binsert\s+into\s+([#@]?[A-Za-z0-9_[\].]+)/gi,
  /\bdelete\s+from\s+([#@]?[A-Za-z0-9_[\].]+)/gi,
  /\bmerge\s+into\s+([#@]?[A-Za-z0-9_[\].]+)/gi
];

const OBJECT_KIND_MAP = new Map([
  ["proc", "procedure"],
  ["procedure", "procedure"],
  ["view", "view"],
  ["function", "function"],
  ["table", "table"],
  ["trigger", "trigger"]
]);

function countLinesBefore(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === "\n") {
      line += 1;
    }
  }
  return line;
}

function normalizeSqlName(value) {
  if (!value) {
    return "";
  }

  return value
    .trim()
    .replace(/[;"`]/g, "")
    .replace(/\[(.+?)\]/g, "$1")
    .replace(/\s+/g, "")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.\.+/g, ".")
    .toLowerCase();
}

function sqlNameAliases(name) {
  const normalized = normalizeSqlName(name);
  if (!normalized) {
    return [];
  }

  const aliases = new Set([normalized]);
  const parts = normalized.split(".").filter(Boolean);
  if (parts.length > 1) {
    aliases.add(parts[parts.length - 1]);
  }
  return [...aliases];
}

function extractReferenceNames(body, selfAliases) {
  const refs = new Set();

  for (const pattern of SQL_REFERENCE_PATTERNS) {
    let match;
    while ((match = pattern.exec(body)) !== null) {
      const name = normalizeSqlName(match[1]);
      if (!name || name.startsWith("@") || name.startsWith("#")) {
        continue;
      }

      const aliases = sqlNameAliases(name);
      if (aliases.some((alias) => selfAliases.has(alias))) {
        continue;
      }

      refs.add(name);
    }
  }

  return [...refs];
}

export function parseCode(code, filePath, language = "sql") {
  return parseInternal(code, filePath, language, false).parserResult;
}

export function parseCodeWithDialectObservations(code, repositoryPath, language = "sql") {
  const metadata = prepareDialectInput(code, repositoryPath, language);
  const parsed = parseInternal(code, repositoryPath, language, !metadata.oversized);
  if (metadata.oversized) {
    return createLightweightTransport(
      parsed.parserResult,
      statusEnvelope("oversized", "source exceeds dialect observation byte cap")
    );
  }
  const observationEnvelope = parsed.malformed
    ? statusEnvelope("malformed", "lightweight parser reported syntax errors")
    : lightweightObservationEnvelope(code, repositoryPath, metadata, parsed.candidates);
  return createLightweightTransport(parsed.parserResult, observationEnvelope);
}

function parseInternal(code, filePath, language, collectDialect) {
  const matches = [...code.matchAll(SQL_OBJECT_PATTERN)];
  const chunks = [];
  const candidates = [];
  const identities = new Set();
  const dialectCode = collectDialect ? maskSqlDialectText(code) : null;
  const dialectMatches = collectDialect
    ? matches.filter((match) =>
        dialectCode.slice(match.index ?? 0, (match.index ?? 0) + match[0].length).trim().length > 0)
    : [];
  const dialectMatchIndexes = new Map(dialectMatches.map((match, index) => [match.index ?? 0, index]));
  let malformed = false;

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const kind = OBJECT_KIND_MAP.get((match[1] || "").toLowerCase()) || "sql_object";
    const objectName = normalizeSqlName(match[2] || "");
    if (!objectName) {
      continue;
    }

    const start = match.index ?? 0;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? code.length : code.length;
    const body = code.slice(start, end).trimEnd();
    const firstLine = body.split(/\r?\n/, 1)[0]?.trim() || `${kind} ${objectName}`;
    const selfAliases = new Set(sqlNameAliases(objectName));
    const dialectIndex = dialectMatchIndexes.get(start);
    const declarationIsCode = dialectIndex !== undefined;
    const dialectEnd = declarationIsCode && dialectIndex + 1 < dialectMatches.length
      ? dialectMatches[dialectIndex + 1].index ?? code.length
      : code.length;
    const observationBody = declarationIsCode ? code.slice(start, dialectEnd).trimEnd() : null;
    const dialectBody = declarationIsCode ? maskSqlDialectText(observationBody) : null;
    const dialectReferences = declarationIsCode
      ? extractDialectReferenceSpans(dialectBody, selfAliases)
      : null;

    const chunk = {
      name: objectName,
      kind,
      signature: firstLine,
      body,
      startLine: countLinesBefore(code, start),
      endLine: countLinesBefore(code, Math.max(start, end - 1)),
      language,
      calls: extractReferenceNames(body, selfAliases),
      imports: []
    };
    chunks.push(chunk);

    if (declarationIsCode) {
      const observationChunk = dialectEnd <= end ? chunk : null;
      addDialectCandidate(candidates, identities, {
        startOffset: start,
        endOffset: start + observationBody.length,
        category: "declaration_structure",
        kind: kind === "function" || kind === "procedure" || kind === "trigger" ? "function" : "type",
        form: "declaration",
        syntaxKind: `${kind}Declaration`,
        ordinal: null,
        chunk: observationChunk
      });
      if (kind === "table" || kind === "view" || kind === "function") {
        addDialectCandidate(candidates, identities, {
          startOffset: start,
          endOffset: start + observationBody.length,
          category: "data_representation",
          kind: kind === "function" ? "return" : "record",
          form: "declaration",
          syntaxKind: `${kind}Declaration`,
          ordinal: null,
          chunk: observationChunk
        });
      }

      dialectReferences.sort((left, right) => left.startOffset - right.startOffset);
      dialectReferences.forEach((reference, ordinal) => {
        addDialectCandidate(candidates, identities, {
          startOffset: start + reference.startOffset,
          endOffset: start + reference.endOffset,
          category: "control_flow",
          kind: "ordered_calls",
          form: "statement",
          syntaxKind: "ReferenceStatement",
          ordinal,
          chunk: observationChunk
        });
      });

      const tokenPattern = /\b(?:BEGIN(?!\s+(?:DISTRIBUTED\s+)?TRAN(?:SACTION)?\b)|END|IF|CASE|WHILE|TRY|CATCH|THROW|RAISERROR)\b/gi;
      let beginCount = 0;
      let endCount = 0;
      let token;
      while ((token = tokenPattern.exec(dialectBody)) !== null) {
        const value = token[0].toUpperCase();
        if (value === "BEGIN") beginCount += 1;
        if (value === "END") endCount += 1;
        let fact = null;
        if (value === "IF" || value === "CASE") {
          fact = ["control_flow", "branch", "statement", `${value}Clause`];
        } else if (value === "WHILE") {
          fact = ["control_flow", "loop", "statement", "WhileStatement"];
        } else if (value === "TRY" || value === "CATCH") {
          fact = ["error_flow", "handler", value === "CATCH" ? "clause" : "statement", `${value}Clause`];
        } else if (value === "THROW" || value === "RAISERROR") {
          fact = ["error_flow", "raise", "statement", `${value}Statement`];
        }
        if (fact) {
          addDialectCandidate(candidates, identities, {
            startOffset: start + token.index,
            endOffset: start + token.index + token[0].length,
            category: fact[0], kind: fact[1], form: fact[2], syntaxKind: fact[3],
            ordinal: null, chunk: observationChunk
          });
        }
      }
      if (beginCount > endCount) malformed = true;
    }
  }

  return { parserResult: { chunks, errors: [] }, candidates, malformed };
}

function extractDialectReferenceSpans(dialectBody, selfAliases) {
  const references = [];
  for (const pattern of SQL_REFERENCE_PATTERNS) {
    let match;
    while ((match = pattern.exec(dialectBody)) !== null) {
      const name = normalizeSqlName(match[1]);
      if (!name || name.startsWith("@") || name.startsWith("#")) continue;
      const aliases = sqlNameAliases(name);
      if (aliases.some((alias) => selfAliases.has(alias))) continue;
      references.push({ startOffset: match.index, endOffset: match.index + match[0].length });
    }
  }
  return references;
}

function maskSqlDialectText(source) {
  const output = source.split("");
  let mode = "code";
  let blockCommentDepth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (mode === "line-comment") {
      if (char === "\r" || char === "\n") mode = "code";
      else output[index] = " ";
      continue;
    }
    if (mode === "block-comment") {
      output[index] = char === "\r" || char === "\n" ? char : " ";
      if (char === "/" && next === "*") {
        output[index + 1] = " ";
        index += 1;
        blockCommentDepth += 1;
      } else if (char === "*" && next === "/") {
        output[index + 1] = " ";
        index += 1;
        blockCommentDepth -= 1;
        if (blockCommentDepth === 0) mode = "code";
      }
      continue;
    }
    if (mode === "single-quote" || mode === "double-quote") {
      const quote = mode === "single-quote" ? "'" : '"';
      output[index] = char === "\r" || char === "\n" ? char : " ";
      if (char === quote) {
        if (next === quote) {
          output[index + 1] = " ";
          index += 1;
        } else {
          mode = "code";
        }
      }
      continue;
    }
    if (mode === "bracket") {
      output[index] = char === "\r" || char === "\n" ? char : " ";
      if (char === "]") {
        if (next === "]") {
          output[index + 1] = " ";
          index += 1;
        } else {
          mode = "code";
        }
      }
      continue;
    }
    if (char === "-" && next === "-") {
      output[index] = " ";
      output[index + 1] = " ";
      index += 1;
      mode = "line-comment";
    } else if (char === "/" && next === "*") {
      output[index] = " ";
      output[index + 1] = " ";
      index += 1;
      mode = "block-comment";
      blockCommentDepth = 1;
    } else if (char === "'") {
      output[index] = " ";
      mode = "single-quote";
    } else if (char === '"') {
      output[index] = " ";
      mode = "double-quote";
    } else if (char === "[") {
      output[index] = " ";
      mode = "bracket";
    }
  }
  return output.join("");
}

function prepareDialectInput(code, repositoryPath, language) {
  if (typeof code !== "string") throw new TypeError("Dialect adapter: code must be a string");
  canonicalRepositoryPath(repositoryPath);
  if (typeof language !== "string") throw new TypeError("Dialect adapter: language must be a string");
  const ext = path.extname(repositoryPath).toLowerCase();
  const family = dialectFamilyForMode(ext);
  const mode = family?.modes.find((entry) => entry.extension === ext);
  if (!family || family.family !== "sql" || mode?.registry_language !== language) {
    throw new TypeError(`Dialect adapter: unsupported parser mode ${language}/${ext || "<none>"}`);
  }
  return {
    family: family.family,
    syntaxMode: ext,
    parserBackend: "lightweight-sql",
    oversized: Buffer.byteLength(code) > DIALECT_LIMITS.max_source_bytes
  };
}

function addDialectCandidate(candidates, identities, candidate) {
  if (candidate.endOffset <= candidate.startOffset) return;
  const identity = [
    candidate.startOffset, candidate.endOffset, candidate.category, candidate.kind,
    candidate.form, candidate.syntaxKind, candidate.ordinal
  ].join("\0");
  if (identities.has(identity)) return;
  identities.add(identity);
  candidates.push(candidate);
}

function lightweightObservationEnvelope(code, repositoryPath, metadata, candidates) {
  const lineStarts = sourceLineStarts(code);
  const observations = candidates.map((candidate) => {
    const start = sourcePosition(lineStarts, candidate.startOffset);
    const end = sourcePosition(lineStarts, candidate.endOffset - 1);
    const observation = {
      schema_version: 1,
      family: metadata.family,
      syntax_mode: metadata.syntaxMode,
      parser_backend: metadata.parserBackend,
      repository_path: repositoryPath,
      containing_chunk_id: safeContainingChunkId(candidate.chunk, repositoryPath),
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import("node:fs");
  const filePath = process.argv[2];

  if (!filePath) {
    console.error("Usage: sql.mjs <file.sql>");
    process.exit(1);
  }

  const code = fs.readFileSync(filePath, "utf8");
  const result = parseCode(code, filePath, "sql");
  console.log(JSON.stringify(result, null, 2));
}
