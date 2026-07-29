import { RULE_KEYWORD_LIMIT, STOP_WORDS } from "./constants.mjs";
import { tokenizeKeywords, uniqueSorted } from "./files.mjs";

export function parseSourcePaths(configText) {
  const sourcePaths = [];
  const lines = configText.split(/\r?\n/);
  let inSourcePaths = false;

  for (const line of lines) {
    if (!inSourcePaths && /^source_paths:\s*$/.test(line.trim())) {
      inSourcePaths = true;
      continue;
    }

    if (!inSourcePaths) {
      continue;
    }

    const entryMatch = line.match(/^\s*-\s*(.+?)\s*$/);
    if (entryMatch) {
      const unquoted = entryMatch[1].replace(/^['"]|['"]$/g, "");
      sourcePaths.push(unquoted);
      continue;
    }

    if (line.trim() !== "" && !/^\s/.test(line)) {
      break;
    }
  }

  return sourcePaths;
}

export function parseRules(rulesText) {
  const lines = rulesText.split(/\r?\n/);
  const rules = [];
  let current = null;

  const pushCurrent = () => {
    if (!current || !current.id) {
      return;
    }
    rules.push({
      id: current.id,
      description: current.description ?? "",
      priority: Number.isFinite(current.priority) ? current.priority : 0,
      enforce: current.enforce === true
    });
  };

  for (const line of lines) {
    const idMatch = line.match(/^\s*-\s*id:\s*(.+?)\s*$/);
    if (idMatch) {
      pushCurrent();
      current = { id: idMatch[1].replace(/^['"]|['"]$/g, "") };
      continue;
    }

    if (!current) {
      continue;
    }

    const descriptionMatch = line.match(/^\s*description:\s*(.+?)\s*$/);
    if (descriptionMatch) {
      current.description = descriptionMatch[1].replace(/^['"]|['"]$/g, "");
      continue;
    }

    const priorityMatch = line.match(/^\s*priority:\s*(\d+)\s*$/);
    if (priorityMatch) {
      current.priority = Number(priorityMatch[1]);
      continue;
    }

    const enforceMatch = line.match(/^\s*enforce:\s*(true|false)\s*$/i);
    if (enforceMatch) {
      current.enforce = enforceMatch[1].toLowerCase() === "true";
    }
  }

  pushCurrent();
  return rules;
}

export function normalizeRuleTokens(ruleRecord) {
  const idParts = ruleRecord.id.split(/[._-]+/g);
  const descriptionTokens = tokenizeKeywords(ruleRecord.body);
  const rawKeywords = [...idParts, ...descriptionTokens];
  const normalized = rawKeywords
    .map((token) => token.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));

  return uniqueSorted(normalized).slice(0, RULE_KEYWORD_LIMIT);
}

export function fileTokenSet(fileRecord) {
  const tokenSource = `${fileRecord.path}\n${fileRecord.content.slice(0, 12000)}`;
  return new Set(tokenizeKeywords(tokenSource));
}

export function collectRuleKeywordMatch(ruleKeywords, tokens, minimumMatches) {
  const required = Math.min(minimumMatches, Math.max(1, ruleKeywords.length));
  let count = 0;
  const sample = [];

  for (const keyword of ruleKeywords) {
    if (!tokens.has(keyword)) {
      continue;
    }
    count += 1;
    if (sample.length < 5) {
      sample.push(keyword);
    }
    if (count >= required && sample.length >= 5) {
      break;
    }
  }

  return { matched: count >= required, sample };
}
