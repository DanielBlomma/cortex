#!/usr/bin/env node
/**
 * SQL parser for Cortex.
 * Extracts stored procedures, views, functions, tables, and triggers as chunks.
 */

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
  const matches = [...code.matchAll(SQL_OBJECT_PATTERN)];
  const chunks = [];

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

    chunks.push({
      name: objectName,
      kind,
      signature: firstLine,
      body,
      startLine: countLinesBefore(code, start),
      endLine: countLinesBefore(code, Math.max(start, end - 1)),
      language,
      calls: extractReferenceNames(body, selfAliases),
      imports: []
    });
  }

  return { chunks, errors: [] };
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
