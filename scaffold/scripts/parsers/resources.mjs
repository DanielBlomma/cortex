#!/usr/bin/env node
/**
 * .NET resources/settings parser for Cortex.
 * Extracts .resx and .settings entries as chunks.
 */

const SQL_REFERENCE_PATTERNS = [
  /\bexec(?:ute)?\s+([#@]?[A-Za-z0-9_[\].]+)/gi,
  /\bfrom\s+([#@]?[A-Za-z0-9_[\].]+)/gi,
  /\bjoin\s+([#@]?[A-Za-z0-9_[\].]+)/gi,
  /\bupdate\s+([#@]?[A-Za-z0-9_[\].]+)/gi,
  /\binsert\s+into\s+([#@]?[A-Za-z0-9_[\].]+)/gi,
  /\bdelete\s+from\s+([#@]?[A-Za-z0-9_[\].]+)/gi,
  /\bmerge\s+into\s+([#@]?[A-Za-z0-9_[\].]+)/gi
];

function countLinesBefore(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === "\n") {
      line += 1;
    }
  }
  return line;
}

function decodeXmlEntities(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function normalizeEntryKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeSqlName(value) {
  return String(value ?? "")
    .trim()
    .replace(/[;"`]/g, "")
    .replace(/\[(.+?)\]/g, "$1")
    .replace(/\s+/g, "")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.\.+/g, ".")
    .toLowerCase();
}

function extractSqlRefs(text) {
  const refs = new Set();
  const normalized = normalizeSqlName(text);
  if (/^[a-z0-9_.]+$/i.test(normalized) && normalized.includes(".")) {
    refs.add(normalized);
  }

  for (const pattern of SQL_REFERENCE_PATTERNS) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const name = normalizeSqlName(match[1]);
      if (!name || name.startsWith("@") || name.startsWith("#")) {
        continue;
      }
      refs.add(name);
    }
  }

  return [...refs];
}

function parseResx(code, language) {
  const chunks = [];
  const pattern = /<data\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/data>/gi;
  let match;

  while ((match = pattern.exec(code)) !== null) {
    const originalKey = decodeXmlEntities(match[1]).trim();
    const normalizedKey = normalizeEntryKey(originalKey);
    if (!normalizedKey) {
      continue;
    }

    const valueMatch = match[2].match(/<value>([\s\S]*?)<\/value>/i);
    const value = decodeXmlEntities(valueMatch?.[1] ?? "").trim();
    const body = match[0];
    const startIndex = match.index ?? 0;
    const endIndex = startIndex + body.length;

    chunks.push({
      name: `resource.${normalizedKey}`,
      kind: "resource_entry",
      signature: `resource ${originalKey}`.trim(),
      body,
      startLine: countLinesBefore(code, startIndex),
      endLine: countLinesBefore(code, Math.max(startIndex, endIndex - 1)),
      language,
      resourceKey: originalKey,
      description: value,
      imports: [],
      calls: extractSqlRefs(value)
    });
  }

  return chunks;
}

function parseSettings(code, language) {
  const chunks = [];
  const pattern = /<Setting\b[^>]*\bName="([^"]+)"[^>]*>([\s\S]*?)<\/Setting>/gi;
  let match;

  while ((match = pattern.exec(code)) !== null) {
    const originalKey = decodeXmlEntities(match[1]).trim();
    const normalizedKey = normalizeEntryKey(originalKey);
    if (!normalizedKey) {
      continue;
    }

    const valueMatch = match[2].match(/<Value(?:\s[^>]*)?>([\s\S]*?)<\/Value>/i);
    const value = decodeXmlEntities(valueMatch?.[1] ?? "").trim();
    const body = match[0];
    const startIndex = match.index ?? 0;
    const endIndex = startIndex + body.length;

    chunks.push({
      name: `setting.${normalizedKey}`,
      kind: "setting_entry",
      signature: `setting ${originalKey}`.trim(),
      body,
      startLine: countLinesBefore(code, startIndex),
      endLine: countLinesBefore(code, Math.max(startIndex, endIndex - 1)),
      language,
      resourceKey: originalKey,
      description: value,
      imports: [],
      calls: extractSqlRefs(value)
    });
  }

  return chunks;
}

export function parseCode(code, filePath, language = "resource") {
  const chunks = language === "settings" ? parseSettings(code, language) : parseResx(code, language);
  return { chunks, errors: [] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import("node:fs");
  const filePath = process.argv[2];

  if (!filePath) {
    console.error("Usage: resources.mjs <file.{resx,settings}>");
    process.exit(1);
  }

  const code = fs.readFileSync(filePath, "utf8");
  const language = filePath.toLowerCase().endsWith(".settings") ? "settings" : "resource";
  const result = parseCode(code, filePath, language);
  console.log(JSON.stringify(result, null, 2));
}
