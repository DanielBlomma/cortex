#!/usr/bin/env node
/**
 * .NET config parser for Cortex.
 * Extracts connection strings and app settings from .config files as chunks.
 */

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

function normalizeConfigKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseAttributes(raw) {
  const attrs = new Map();
  const pattern = /\b([A-Za-z_:][A-Za-z0-9_:\-]*)="([^"]*)"/g;
  let match;
  while ((match = pattern.exec(raw)) !== null) {
    attrs.set(match[1], decodeXmlEntities(match[2]));
  }
  return attrs;
}

function parseConnectionStringParts(value) {
  const parts = new Map();
  for (const segment of String(value ?? "").split(";")) {
    const trimmed = segment.trim();
    if (!trimmed) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim().toLowerCase();
    const partValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key || !partValue) {
      continue;
    }
    parts.set(key, partValue);
  }
  return parts;
}

function buildConnectionStringDescription(connectionString, providerName) {
  const summary = String(connectionString ?? "").trim();
  const provider = String(providerName ?? "").trim();
  if (!provider) {
    return summary;
  }
  return summary.includes(provider) ? summary : `${summary}; provider=${provider}`;
}

export function parseCode(code, filePath, language = "config") {
  const chunks = [];
  const addPattern = /<add\b([^>]+?)\/?>/gi;
  let match;

  while ((match = addPattern.exec(code)) !== null) {
    const attrs = parseAttributes(match[1]);
    const key = attrs.get("key");
    const name = attrs.get("name");
    const connectionString = attrs.get("connectionString");
    const providerName = attrs.get("providerName");
    const value = attrs.get("value");

    let kind = "";
    let configKey = "";
    let descriptionValue = "";

    if (name && connectionString) {
      kind = "connection_string";
      configKey = name;
      descriptionValue = buildConnectionStringDescription(connectionString, providerName);
    } else if (key) {
      kind = "app_setting";
      configKey = key;
      descriptionValue = value ?? "";
    } else {
      continue;
    }

    const normalizedKey = normalizeConfigKey(configKey);
    if (!normalizedKey) {
      continue;
    }

    const body = match[0];
    const startIndex = match.index ?? 0;
    const endIndex = startIndex + body.length;
    chunks.push({
      name: `${kind}.${normalizedKey}`,
      kind,
      signature: `${kind} ${configKey}`.trim(),
      body,
      startLine: countLinesBefore(code, startIndex),
      endLine: countLinesBefore(code, Math.max(startIndex, endIndex - 1)),
      language,
      description: descriptionValue,
      configKey,
      imports: [],
      calls: []
    });

    if (kind === "connection_string") {
      const connectionParts = parseConnectionStringParts(connectionString);
      const server =
        connectionParts.get("server") ??
        connectionParts.get("data source") ??
        connectionParts.get("addr") ??
        connectionParts.get("address") ??
        connectionParts.get("network address") ??
        "";
      const database =
        connectionParts.get("database") ?? connectionParts.get("initial catalog") ?? "";
      const provider = connectionParts.get("provider") ?? String(providerName ?? "").trim();
      const targetName = `database_target.${normalizedKey}`;
      const targetSummary = [
        database ? `database=${database}` : "",
        server ? `server=${server}` : "",
        provider ? `provider=${provider}` : ""
      ]
        .filter(Boolean)
        .join("; ");

      chunks[chunks.length - 1].calls = [targetName];
      chunks.push({
        name: targetName,
        kind: "database_target",
        signature: `database_target ${configKey}`.trim(),
        body,
        startLine: countLinesBefore(code, startIndex),
        endLine: countLinesBefore(code, Math.max(startIndex, endIndex - 1)),
        language,
        description: targetSummary || connectionString,
        configKey,
        imports: [],
        calls: []
      });
    }
  }

  return { chunks, errors: [] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import("node:fs");
  const filePath = process.argv[2];

  if (!filePath) {
    console.error("Usage: config.mjs <file.config>");
    process.exit(1);
  }

  const code = fs.readFileSync(filePath, "utf8");
  const result = parseCode(code, filePath, "config");
  console.log(JSON.stringify(result, null, 2));
}
