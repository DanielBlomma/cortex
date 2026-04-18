/**
 * Tree-sitter parser infrastructure for Cortex.
 *
 * Provides shared utilities for tree-sitter-based language parsers:
 * WASM grammar loading (cached), parser creation, query execution,
 * and helpers for converting tree-sitter captures into Cortex chunks.
 *
 * Tree-sitter is async at init/load time but parsing itself is sync.
 * Language modules call initTreeSitter() + loadGrammar() at module
 * load time (via top-level await) so that parseCode() can remain sync
 * and match the contract expected by scripts/ingest.mjs.
 */

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

let TreeSitterModule = null;
let initPromise = null;
const grammarCache = new Map();

async function loadTreeSitter() {
  if (TreeSitterModule) return TreeSitterModule;
  const mod = await import("web-tree-sitter");
  TreeSitterModule = mod.default ?? mod;
  return TreeSitterModule;
}

export async function initTreeSitter() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const TreeSitter = await loadTreeSitter();
    await TreeSitter.init();
    return TreeSitter;
  })();
  return initPromise;
}

function resolveGrammarPath(grammarName) {
  const override = process.env.CORTEX_TREE_SITTER_GRAMMAR_DIR;
  const baseDir = override && override.trim().length > 0
    ? override.trim()
    : path.dirname(require.resolve("tree-sitter-wasms/package.json"));
  const wasmFile = path.join(baseDir, "out", `tree-sitter-${grammarName}.wasm`);
  if (!fs.existsSync(wasmFile)) {
    throw new Error(`tree-sitter grammar WASM not found: ${wasmFile}`);
  }
  return wasmFile;
}

export async function loadGrammar(grammarName) {
  if (grammarCache.has(grammarName)) {
    return grammarCache.get(grammarName);
  }
  const TreeSitter = await initTreeSitter();
  const wasmPath = resolveGrammarPath(grammarName);
  const language = await TreeSitter.Language.load(wasmPath);
  grammarCache.set(grammarName, language);
  return language;
}

export function resetGrammarCache() {
  grammarCache.clear();
}

export function createParser(language) {
  if (!TreeSitterModule) {
    throw new Error("tree-sitter not initialized — call initTreeSitter() first");
  }
  const parser = new TreeSitterModule();
  parser.setLanguage(language);
  return parser;
}

/**
 * Hard size limit on input passed to tree-sitter. Swift was dropped
 * because its grammar OOM'd on large files (see aa52c93); even
 * supported grammars can exhaust WASM memory on adversarial input.
 * Callers receive { tree: null, reason } when the limit is hit.
 * Override via CORTEX_TREE_SITTER_MAX_BYTES.
 */
const DEFAULT_MAX_SOURCE_BYTES = 4 * 1024 * 1024; // 4 MiB

function getMaxSourceBytes() {
  const override = process.env.CORTEX_TREE_SITTER_MAX_BYTES;
  if (!override) return DEFAULT_MAX_SOURCE_BYTES;
  const n = Number.parseInt(override, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_SOURCE_BYTES;
}

export function parseSource(language, code) {
  const max = getMaxSourceBytes();
  if (typeof code === "string" && code.length > max) {
    return {
      tree: null,
      parser: null,
      reason: `source exceeds CORTEX_TREE_SITTER_MAX_BYTES (${code.length} > ${max})`
    };
  }
  const parser = createParser(language);
  try {
    const tree = parser.parse(code);
    return { tree, parser };
  } catch (error) {
    return {
      tree: null,
      parser,
      reason: `tree-sitter parse threw: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export function runQuery(language, queryString, node) {
  const query = language.query(queryString);
  const captures = query.captures(node);
  return captures;
}

/**
 * Group captures into records keyed by an anchor capture name.
 * Tree-sitter queries often produce multiple captures per match
 * (e.g. @fn + @fn.name + @fn.body). This groups all captures whose
 * node is contained within the same anchor node.
 *
 * @param {Array<{name: string, node: object}>} captures
 * @param {string} anchorName - capture name that marks the outer scope
 * @returns {Array<Map<string, object>>} list of maps from capture-name to node
 */
export function groupByAnchor(captures, anchorName) {
  const anchors = captures
    .filter((c) => c.name === anchorName)
    .sort((a, b) => a.node.startIndex - b.node.startIndex);

  const groups = anchors.map(() => new Map());
  groups.forEach((g, i) => g.set(anchorName, anchors[i].node));

  for (const cap of captures) {
    if (cap.name === anchorName) continue;
    const idx = anchors.findIndex((a) =>
      cap.node.startIndex >= a.node.startIndex &&
      cap.node.endIndex <= a.node.endIndex
    );
    if (idx >= 0 && !groups[idx].has(cap.name)) {
      groups[idx].set(cap.name, cap.node);
    }
  }

  return groups;
}

export function lineRangeOf(node) {
  return {
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1
  };
}

export function bodyOf(node, maxChars = 12000) {
  const text = node.text ?? "";
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

export function normalizeWhitespace(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

export function dedupe(items) {
  return [...new Set(items.filter((item) => item != null && item !== ""))];
}

/**
 * Walk the tree collecting syntax errors. Tree-sitter flags MISSING
 * and ERROR nodes during parsing; a clean parse has none. Returns
 * `{message, line, column}` entries compatible with Cortex's existing
 * parser error shape. Limits output to `maxErrors` to keep DB rows
 * small on pathological input. Descends into ERROR subtrees so nested
 * errors are also reported (capped by maxErrors).
 */
export function collectErrors(tree, { maxErrors = 32 } = {}) {
  const errors = [];
  if (!tree?.rootNode?.hasError) return errors;

  const visit = (node) => {
    if (errors.length >= maxErrors) return;
    if (node.isError || node.type === "ERROR") {
      errors.push({
        message: "Syntax error",
        line: node.startPosition.row + 1,
        column: node.startPosition.column + 1
      });
      // fall through — ERROR nodes can contain nested errors we still want to report
    } else if (node.isMissing) {
      errors.push({
        message: `Missing ${node.type || "token"}`,
        line: node.startPosition.row + 1,
        column: node.startPosition.column + 1
      });
      return;
    } else if (!node.hasError) {
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      visit(node.child(i));
    }
  };

  visit(tree.rootNode);
  return errors;
}

/**
 * Convenience loader for language modules — initializes tree-sitter and
 * pre-loads a grammar. Returns an object with the grammar handle and
 * shared helpers so language modules don't need to reimport base.mjs.
 */
export async function prepareLanguage(grammarName) {
  await initTreeSitter();
  const language = await loadGrammar(grammarName);
  return {
    language,
    parse: (code) => parseSource(language, code),
    query: (queryString, node) => runQuery(language, queryString, node)
  };
}

export function loadQueryFile(filePath) {
  const url = filePath.startsWith("file:") ? new URL(filePath) : pathToFileURL(path.resolve(__dirname, filePath));
  return fs.readFileSync(url, "utf8");
}
