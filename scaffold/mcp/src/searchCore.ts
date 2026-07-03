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
  dashboard: ["status"],
  embed: ["embedding", "embeddings"],
  embedding: ["embed", "embeddings"],
  embeddings: ["embed", "embedding"],
  git: ["githooks"],
  hook: ["hooks", "githooks"],
  hooks: ["hook", "githooks"],
  import: ["imports"],
  imports: ["import"],
  javascript: ["js"],
  parser: ["parsers"],
  parsers: ["parser"],
  status: ["dashboard"],
  semantisk: ["semantic"],
  sökning: ["search"],
  sokning: ["search"],
  regel: ["rule"],
  regler: ["rules"],
  relaterad: ["related"],
  meddelande: ["message"],
  avvikelse: ["deviation"]
};

const STRUCTURAL_QUERY_STOP_TOKENS = new Set([
  "about",
  "after",
  "and",
  "are",
  "before",
  "between",
  "does",
  "from",
  "happen",
  "happens",
  "has",
  "how",
  "into",
  "the",
  "their",
  "then",
  "through",
  "when",
  "where",
  "while",
  "with",
  "what",
  "which",
  "who",
  "why"
]);

const IDENTIFIER_COMPOUND_TOKENS = new Set(["csharp", "fsharp", "graphql", "javascript", "typescript", "vbnet"]);
const LANGUAGE_TOKEN_GROUPS = [
  ["javascript", "typescript", "js", "ts"],
  ["csharp", "cs"],
  ["vbnet", "vb"],
  ["fsharp", "fs"],
  ["java"],
  ["cpp"],
  ["python", "py"],
  ["rust", "rs"],
  ["ruby", "rb"],
  ["go"],
  ["php"],
  ["swift"],
  ["kotlin", "kt"],
  ["sql"]
];

export function normalizeText(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function normalizeLanguageAliases(value: string): string {
  return value
    .replace(/(^|[^\p{L}\p{N}])c#(?=$|[^\p{L}\p{N}])/giu, "$1 csharp ")
    .replace(/(^|[^\p{L}\p{N}])f#(?=$|[^\p{L}\p{N}])/giu, "$1 fsharp ")
    .replace(/(^|[^\p{L}\p{N}])vb\.net(?=$|[^\p{L}\p{N}])/giu, "$1 vbnet ");
}

function splitIdentifierPart(part: string): string[] {
  const split = part
    .replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, "$1 $2")
    .replace(/([\p{Lu}]+)([\p{Lu}][\p{Ll}])/gu, "$1 $2")
    .split(/\s+/u)
    .filter(Boolean);
  if (split.length <= 1) {
    return [];
  }

  const merged: string[] = [];
  for (let index = 0; index < split.length; index += 1) {
    const current = normalizeText(split[index]);
    const next = index + 1 < split.length ? normalizeText(split[index + 1]) : "";
    const compound = `${current}${next}`;
    if (next && IDENTIFIER_COMPOUND_TOKENS.has(compound)) {
      merged.push(compound);
      index += 1;
      continue;
    }
    merged.push(current);
  }
  return merged;
}

export function tokenize(value: string): string[] {
  const tokens: string[] = [];
  for (const rawPart of normalizeLanguageAliases(value).normalize("NFKC").split(/[^\p{L}\p{N}]+/gu)) {
    const part = rawPart.trim();
    if (part.length < 2) {
      continue;
    }

    const variants = [part, ...splitIdentifierPart(part)];
    for (const variant of variants) {
      const token = normalizeText(variant).trim();
      if (token.length >= 2) {
        tokens.push(token);
      }
    }
  }
  return tokens;
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

function relatedQueryTokens(token: string): string[] {
  const related = new Set<string>(QUERY_TOKEN_EXPANSIONS[token] ?? []);
  for (const [source, aliases] of Object.entries(QUERY_TOKEN_EXPANSIONS)) {
    if (!aliases.includes(token)) {
      continue;
    }
    related.add(source);
    for (const alias of aliases) {
      related.add(alias);
    }
  }
  return Array.from(related);
}

function queryTokenGroups(queryTokens: string[]): string[][] {
  const inputTokens = new Set(queryTokens);
  const visited = new Set<string>();
  const groups: string[][] = [];

  for (const token of queryTokens) {
    if (visited.has(token)) {
      continue;
    }

    const group = new Set<string>();
    const queue = [token];
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      if (group.has(current)) {
        continue;
      }
      group.add(current);

      for (const related of relatedQueryTokens(current)) {
        group.add(related);
        if (inputTokens.has(related) && !visited.has(related)) {
          queue.push(related);
        }
      }
    }

    for (const member of group) {
      if (inputTokens.has(member)) {
        visited.add(member);
      }
    }
    groups.push(Array.from(group));
  }

  return groups;
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

  const tokenGroups = queryTokenGroups(queryTokens);
  let matched = 0;
  for (const group of tokenGroups) {
    if (group.some((token) => textTokenSet.has(token))) {
      matched += 1;
    }
  }

  const overlap = matched / tokenGroups.length;
  if (overlap <= 0) {
    return 0;
  }

  const normalizedText = normalizeText(text);
  const phraseBonus = queryPhrase && normalizedText.includes(queryPhrase) ? 0.15 : 0;
  return Math.min(1, overlap * 0.85 + phraseBonus);
}

function structuralQueryTokens(queryTokens: string[]): string[] {
  return queryTokens.filter((token) => token.length >= 3 && !STRUCTURAL_QUERY_STOP_TOKENS.has(token));
}

function tokenSet(value: string): Set<string> {
  return new Set(tokenize(value));
}

function overlapCount(queryTokens: string[], targetTokens: Set<string>): number {
  let matched = 0;
  for (const token of queryTokens) {
    if (targetTokens.has(token)) {
      matched += 1;
    }
  }
  return matched;
}

function basenameWithoutExtension(pathValue: string): string {
  const base = pathValue.split(/[\\/]/u).pop() ?? pathValue;
  const extensionIndex = base.lastIndexOf(".");
  return extensionIndex > 0 ? base.slice(0, extensionIndex) : base;
}

function languageGroupsForTokens(tokens: Set<string>): Set<number> {
  const groups = new Set<number>();
  for (let index = 0; index < LANGUAGE_TOKEN_GROUPS.length; index += 1) {
    if (LANGUAGE_TOKEN_GROUPS[index].some((token) => tokens.has(token))) {
      groups.add(index);
    }
  }
  return groups;
}

function hasLanguageGroupOverlap(a: Set<number>, b: Set<number>): boolean {
  for (const value of a) {
    if (b.has(value)) {
      return true;
    }
  }
  return false;
}

export function structuralSearchBoost(entity: SearchEntity, queryTokens: string[], queryPhrase: string): number {
  const structuralTokens = structuralQueryTokens(queryTokens);
  if (structuralTokens.length === 0) {
    return 0;
  }

  const pathTokens = tokenSet(entity.path);
  const labelTokens = tokenSet(entity.label);
  const pathMatches = overlapCount(structuralTokens, pathTokens);
  const basenameMatches = overlapCount(structuralTokens, tokenSet(basenameWithoutExtension(entity.path)));
  const labelMatches = overlapCount(structuralTokens, labelTokens);
  const kindMatches = overlapCount(structuralTokens, tokenSet(entity.kind));

  let boost = 0;
  boost += Math.min(0.1, pathMatches * 0.035);
  boost += Math.min(0.08, basenameMatches * 0.06);
  boost += Math.min(0.08, labelMatches * 0.04);
  boost += Math.min(0.03, kindMatches * 0.02);

  const normalizedPath = normalizeText(entity.path);
  const normalizedLabel = normalizeText(entity.label);
  const compactPhrase = queryPhrase.replace(/[^\p{L}\p{N}]+/gu, "");
  if (compactPhrase.length >= 8) {
    const compactPath = normalizedPath.replace(/[^\p{L}\p{N}]+/gu, "");
    const compactLabel = normalizedLabel.replace(/[^\p{L}\p{N}]+/gu, "");
    if (compactPath.includes(compactPhrase) || compactLabel.includes(compactPhrase)) {
      boost += 0.04;
    }
  }

  const queryLanguageGroups = languageGroupsForTokens(new Set(queryTokens));
  const pathLanguageGroups = languageGroupsForTokens(new Set([...pathTokens, ...labelTokens]));
  if (
    queryLanguageGroups.size > 0 &&
    pathLanguageGroups.size > 0 &&
    pathTokens.has("parsers") &&
    !hasLanguageGroupOverlap(queryLanguageGroups, pathLanguageGroups)
  ) {
    boost -= 0.08;
  }

  return Math.min(0.2, boost);
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

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
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
