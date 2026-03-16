import type { SearchEntity } from "./types.js";

const SQL_ENTITY_KINDS = new Set(["procedure", "view", "function", "table", "trigger"]);
const SQL_LIKE_EXTENSIONS = [".sql"];
const CONFIG_LIKE_EXTENSIONS = [".config"];
const RESOURCE_LIKE_EXTENSIONS = [".resx"];
const SETTINGS_LIKE_EXTENSIONS = [".settings"];
const CONFIG_ENVIRONMENT_TOKENS = [
  "release",
  "debug",
  "prod",
  "production",
  "staging",
  "stage",
  "dev",
  "development",
  "test",
  "qa",
  "uat"
];

const QUERY_TOKEN_EXPANSIONS: Record<string, string[]> = {
  semantisk: ["semantic"],
  sökning: ["search"],
  sokning: ["search"],
  regel: ["rule"],
  regler: ["rules"],
  relaterad: ["related"],
  meddelande: ["message"],
  avvikelse: ["deviation"]
};

export function normalizeText(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

export function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^\p{L}\p{N}]+/gu)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

export function expandQueryTokens(tokens: string[]): string[] {
  const expanded = new Set<string>(tokens);
  for (const token of tokens) {
    const aliases = QUERY_TOKEN_EXPANSIONS[token];
    if (!aliases) {
      continue;
    }
    for (const alias of aliases) {
      expanded.add(alias);
    }
  }
  return Array.from(expanded);
}

function daysSince(isoDate: string): number {
  const timestamp = Date.parse(isoDate);
  if (Number.isNaN(timestamp)) {
    return 3650;
  }

  const now = Date.now();
  return Math.max(0, (now - timestamp) / (1000 * 60 * 60 * 24));
}

export function recencyScore(isoDate: string): number {
  const days = daysSince(isoDate);
  return 1 / (1 + days / 30);
}

export function semanticScore(queryTokens: string[], queryPhrase: string, text: string): number {
  if (queryTokens.length === 0) {
    return 0;
  }

  const textTokenSet = new Set(tokenize(text));
  if (textTokenSet.size === 0) {
    return 0;
  }

  let matched = 0;
  for (const token of queryTokens) {
    if (textTokenSet.has(token)) {
      matched += 1;
    }
  }

  const overlap = matched / queryTokens.length;
  if (overlap <= 0) {
    return 0;
  }

  const normalizedText = normalizeText(text);
  const phraseBonus = queryPhrase && normalizedText.includes(queryPhrase) ? 0.15 : 0;
  return Math.min(1, overlap * 0.85 + phraseBonus);
}

function queryHasAnyToken(queryTokens: string[], candidates: string[]): boolean {
  return candidates.some((candidate) => queryTokens.includes(candidate));
}

function pathHasExtension(pathValue: string, extensions: string[]): boolean {
  const normalizedPath = normalizeText(pathValue);
  return extensions.some((extension) => normalizedPath.endsWith(extension));
}

export function legacyDataAccessBoost(entity: SearchEntity, queryTokens: string[], queryPhrase: string): number {
  const normalizedKind = normalizeText(entity.kind);
  const wantsSql =
    queryHasAnyToken(queryTokens, [
      "sql",
      "database",
      "db",
      "provider",
      "providername",
      "sqlclient",
      "sqlserver",
      "oracle",
      "postgres",
      "postgresql",
      "pgsql",
      "mysql",
      "sqlite",
      "stored",
      "procedure",
      "proc",
      "query",
      "queries",
      "view",
      "table",
      "trigger",
      "report",
      "reporting",
      "data",
      "dataflow"
    ]) || queryPhrase.includes("stored procedure");
  const wantsConfig =
    queryHasAnyToken(queryTokens, [
      "config",
      "configuration",
      "connection",
      "connectionstring",
      "connectionstrings",
      "appsettings",
      "setting",
      "settings"
    ]) || queryPhrase.includes("connection string");
  const wantsResource = queryHasAnyToken(queryTokens, ["resource", "resources", "resx"]);
  const wantsSettings = queryHasAnyToken(queryTokens, ["setting", "settings", "appsettings"]);
  const wantsConfigTransform =
    queryHasAnyToken(queryTokens, [...CONFIG_ENVIRONMENT_TOKENS, "transform", "xdt", "override"]) ||
    queryPhrase.includes("web.release.config") ||
    queryPhrase.includes("web.debug.config");
  const wantsMachineConfig = queryHasAnyToken(queryTokens, ["machine", "machineconfig"]);
  const wantsImpact = queryHasAnyToken(queryTokens, [
    "impact",
    "affect",
    "affected",
    "affects",
    "change",
    "changes",
    "changing",
    "override",
    "overrides"
  ]);

  let boost = 0;

  if (entity.entity_type === "Chunk") {
    if (normalizedKind === "connection_string" && (wantsConfig || wantsSql)) {
      boost += 0.16;
    } else if (
      normalizedKind === "database_target" &&
      (wantsConfig ||
        wantsSql ||
        queryHasAnyToken(queryTokens, [
          "database",
          "server",
          "catalog",
          "provider",
          "providername",
          "sqlclient",
          "sqlserver",
          "oracle",
          "postgres",
          "postgresql",
          "pgsql",
          "mysql",
          "sqlite"
        ]))
    ) {
      boost += 0.18;
    } else if (normalizedKind === "app_setting" && (wantsConfig || wantsSettings)) {
      boost += 0.12;
    } else if (normalizedKind === "resource_entry" && (wantsResource || wantsSql)) {
      boost += 0.1;
    } else if (normalizedKind === "setting_entry" && (wantsSettings || wantsConfig || wantsSql)) {
      boost += 0.1;
    } else if (SQL_ENTITY_KINDS.has(normalizedKind) && wantsSql) {
      boost += 0.12;
    }
    if (
      wantsImpact &&
      (normalizedKind === "connection_string" ||
        normalizedKind === "database_target" ||
        normalizedKind === "app_setting" ||
        SQL_ENTITY_KINDS.has(normalizedKind))
    ) {
      boost += 0.08;
    }
  }

  if (entity.entity_type === "File") {
    if (pathHasExtension(entity.path, SQL_LIKE_EXTENSIONS) && wantsSql) {
      boost += 0.04;
    }
    if (pathHasExtension(entity.path, CONFIG_LIKE_EXTENSIONS) && wantsConfig) {
      boost += 0.06;
    }
    if (
      pathHasExtension(entity.path, CONFIG_LIKE_EXTENSIONS) &&
      wantsConfigTransform &&
      CONFIG_ENVIRONMENT_TOKENS.some((token) => normalizeText(entity.path).includes(`.${token}.config`))
    ) {
      boost += 0.12;
    }
    if (
      pathHasExtension(entity.path, CONFIG_LIKE_EXTENSIONS) &&
      wantsMachineConfig &&
      normalizeText(entity.path).endsWith("machine.config")
    ) {
      boost += 0.12;
    }
    if (
      pathHasExtension(entity.path, CONFIG_LIKE_EXTENSIONS) &&
      wantsImpact &&
      (wantsConfig || wantsConfigTransform || wantsSql)
    ) {
      boost += 0.08;
    }
    if (pathHasExtension(entity.path, RESOURCE_LIKE_EXTENSIONS) && (wantsResource || wantsSql)) {
      boost += 0.05;
    }
    if (pathHasExtension(entity.path, SETTINGS_LIKE_EXTENSIONS) && (wantsSettings || wantsConfig)) {
      boost += 0.05;
    }
  }

  return boost;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const av = a[index];
    const bv = b[index];
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
