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
import {
  DIALECT_LIMITS,
  canonicalDialectLanguageSpecificShape,
  canonicalDialectNormalizedShape,
  canonicalRepositoryPath,
  canonicalizeDialectObservations,
  createDialectObservationTransport,
  dialectFamilyForMode,
  stableDialectObservationId
} from "../../lib/dialect-observation-contract.mjs";

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

/**
 * Validate the composite adapter inputs without changing parseCode's legacy
 * argument behavior. The capability manifest remains the authority for mode
 * ownership and registry-language spelling.
 */
export function prepareDialectAdapterInput(code, repositoryPath, language, allowedFamilies) {
  if (typeof code !== "string") {
    throw new TypeError("Dialect adapter: code must be a string");
  }
  canonicalRepositoryPath(repositoryPath);
  if (typeof language !== "string") {
    throw new TypeError("Dialect adapter: language must be a string");
  }
  const separator = repositoryPath.lastIndexOf("/");
  const dot = repositoryPath.lastIndexOf(".");
  const syntaxMode = dot > separator ? repositoryPath.slice(dot) : "";
  const family = dialectFamilyForMode(syntaxMode);
  const mode = family?.modes.find((entry) => entry.extension === syntaxMode);
  if (!family || !mode || !allowedFamilies.includes(family.family) || mode.registry_language !== language) {
    throw new TypeError(`Dialect adapter: unsupported parser mode ${language}/${syntaxMode || "<none>"}`);
  }
  return {
    family: family.family,
    syntaxMode,
    oversized: Buffer.byteLength(code) > DIALECT_LIMITS.max_source_bytes
  };
}

export function dialectObservationEnvelope(status, observations = [], diagnostic = {}) {
  const canonical = status === "ok" ? canonicalizeDialectObservations(observations) : [];
  const observedCount = diagnostic.observedCount ?? canonical.length;
  const omittedCount = diagnostic.omittedCount ?? 0;
  return {
    schema_version: 1,
    status,
    observations: canonical,
    diagnostics: {
      message: status === "ok" ? null : diagnostic.message,
      observed_count: observedCount,
      omitted_count: omittedCount
    }
  };
}

export function treeSitterUnavailableTransport(status = "unavailable") {
  const parserResult = {
    chunks: [],
    errors: [{ message: "tree-sitter parser unavailable" }]
  };
  return createDialectObservationTransport(
    parserResult,
    dialectObservationEnvelope(status, [], {
      message: status === "oversized"
        ? "source exceeds dialect observation byte cap"
        : "selected Tree-sitter backend is unavailable",
      observedCount: 0,
      omittedCount: 0
    })
  );
}

/**
 * Walk a native Tree-sitter tree once after parsing and translate only node
 * kinds selected by the language adapter. Native nodes never escape this
 * function; the returned values are closed, plain-data observations.
 */
export function treeSitterDialectObservationEnvelope({
  code,
  repositoryPath,
  family,
  syntaxMode,
  rootNode,
  parserResult,
  classifyNode
}) {
  if (Buffer.byteLength(code) > DIALECT_LIMITS.max_source_bytes) {
    return dialectObservationEnvelope("oversized", [], {
      message: "source exceeds dialect observation byte cap",
      observedCount: 0,
      omittedCount: 0
    });
  }
  if (!rootNode) {
    return dialectObservationEnvelope("unavailable", [], {
      message: "native parser did not produce a syntax tree",
      observedCount: 0,
      omittedCount: 0
    });
  }
  if (parserResult.errors.length > 0) {
    return dialectObservationEnvelope("malformed", [], {
      message: "native parser reported syntax errors",
      observedCount: 0,
      omittedCount: 0
    });
  }

  const positions = sourcePositions(code);
  const observations = [];
  const observationIds = new Set();
  const stack = [{ node: rootNode, parent: null }];
  while (stack.length > 0) {
    const { node, parent } = stack.pop();
    if (node.endIndex > node.startIndex) {
      const facts = classifyNode(node, parent) ?? [];
      for (const fact of facts) {
        const span = inclusiveSpan(positions, code.length, node.startIndex, node.endIndex);
        if (!span) continue;
        const observation = {
          schema_version: 1,
          family,
          syntax_mode: syntaxMode,
          parser_backend: "tree-sitter",
          repository_path: repositoryPath,
          containing_chunk_id: null,
          start_line: span.startLine,
          start_column: span.startColumn,
          end_line: span.endLine,
          end_column: span.endColumn,
          category: fact.category,
          normalized_shape: canonicalDialectNormalizedShape(fact.category, fact.kind),
          language_specific_shape: fact.form === null
            ? null
            : canonicalDialectLanguageSpecificShape(fact.form, node.type),
          ordinal: fact.ordinal ?? null,
          observation_id: ""
        };
        observation.observation_id = stableDialectObservationId(observation);
        if (observationIds.has(observation.observation_id)) continue;
        observationIds.add(observation.observation_id);
        observations.push(observation);
      }
    }
    for (let index = node.namedChildCount - 1; index >= 0; index -= 1) {
      const child = node.namedChild(index);
      if (child) stack.push({ node: child, parent: node });
    }
  }

  if (observations.length > DIALECT_LIMITS.max_observations_per_file) {
    return dialectObservationEnvelope("truncated", [], {
      message: "dialect observation file cap exceeded",
      observedCount: observations.length,
      omittedCount: observations.length
    });
  }
  return dialectObservationEnvelope("ok", observations);
}

export function commonTreeSitterDialectFacts(node) {
  const facts = [];
  const declarationTypes = {
    function_definition: "function",
    function_declaration: "function",
    function_item: "function",
    method_declaration: "method",
    method: "method",
    singleton_method: "method",
    constructor_declaration: "constructor",
    class_declaration: "type",
    class_definition: "type",
    class: "type",
    interface_declaration: "type",
    enum_declaration: "type",
    enum_item: "type",
    record_declaration: "type",
    struct_item: "type",
    struct_specifier: "type",
    class_specifier: "type",
    union_specifier: "type",
    trait_item: "type",
    type_declaration: "type",
    type_definition: "type",
    module: "module",
    module_declaration: "module",
    mod_item: "module",
    namespace_definition: "namespace",
    field_declaration: "field",
    field_definition: "field",
    parameter: "parameter",
    parameter_declaration: "parameter",
    required_parameter: "parameter",
    optional_parameter: "parameter",
    keyword_parameter: "parameter"
  };
  const declarationKind = declarationTypes[node.type];
  if (declarationKind) facts.push({ category: "declaration_structure", kind: declarationKind, form: "declaration" });

  if ([
    "if_statement", "if_expression", "conditional_expression", "switch_statement",
    "switch_expression", "match_expression", "case_statement", "case_clause",
    "elif_clause", "when"
  ].includes(node.type)) facts.push({ category: "control_flow", kind: "branch", form: node.type.endsWith("expression") ? "expression" : "statement" });
  if ([
    "for_statement", "for_expression", "for_in_clause", "while_statement",
    "while_expression", "loop_expression", "until"
  ].includes(node.type)) facts.push({ category: "control_flow", kind: "loop", form: node.type.endsWith("expression") ? "expression" : "statement" });

  if (["throw_statement", "raise", "panic_statement"].includes(node.type)) facts.push({ category: "error_flow", kind: "raise", form: "statement" });
  if (["try_statement", "catch_clause", "except_clause", "rescue"].includes(node.type)) facts.push({ category: "error_flow", kind: "handler", form: node.type.endsWith("clause") ? "clause" : "statement" });
  if (node.type === "try_expression") facts.push({ category: "error_flow", kind: "propagate", form: "expression" });
  if (["finally_clause", "ensure", "defer_statement"].includes(node.type)) facts.push({ category: "error_flow", kind: "cleanup", form: node.type.endsWith("clause") ? "clause" : "statement" });

  if (["parameter", "parameter_declaration", "required_parameter", "optional_parameter", "keyword_parameter"].includes(node.type)) {
    facts.push({ category: "data_representation", kind: "parameter", form: "declaration" });
  }
  if (["field_declaration", "field_definition", "struct_field"].includes(node.type)) facts.push({ category: "data_representation", kind: "field", form: "declaration" });
  if ([
    "array", "array_expression", "array_type", "list", "list_comprehension",
    "dictionary", "dictionary_comprehension", "map_type", "hash"
  ].includes(node.type)) facts.push({ category: "data_representation", kind: "container", form: node.type.endsWith("type") ? "declaration" : "expression" });
  if (["struct_item", "struct_specifier", "record_declaration", "struct_type"].includes(node.type)) facts.push({ category: "data_representation", kind: "record", form: "declaration" });
  if (["enum_variant", "enumerator", "enum_body"].includes(node.type)) facts.push({ category: "data_representation", kind: "variant", form: "declaration" });
  if (["return_statement", "return_expression", "result"].includes(node.type)) {
    facts.push({ category: "data_representation", kind: "return", form: "statement" });
  }
  if (["assignment", "assignment_expression", "variable_declaration", "short_var_declaration"].includes(node.type)) facts.push({ category: "data_representation", kind: "state", form: "declaration" });

  if (["assert_statement", "static_assert_declaration"].includes(node.type)) {
    facts.push({ category: "test_shape", kind: "assertion", form: "statement" });
  }
  return facts;
}

function sourcePositions(code) {
  const positions = new Array(code.length + 1);
  let line = 1;
  let column = 0;
  let offset = 0;
  while (offset < code.length) {
    positions[offset] = { line, column };
    const unit = code.charCodeAt(offset);
    if (unit === 13 && code.charCodeAt(offset + 1) === 10) {
      positions[offset + 1] = { line, column: column + 1 };
      offset += 2;
      line += 1;
      column = 0;
    } else if (unit === 10 || unit === 13) {
      offset += 1;
      line += 1;
      column = 0;
    } else {
      offset += 1;
      column += 1;
    }
  }
  positions[code.length] = { line, column };
  return positions;
}

function inclusiveSpan(positions, sourceLength, startOffset, endOffset) {
  if (!Number.isSafeInteger(startOffset) || !Number.isSafeInteger(endOffset) ||
      startOffset < 0 || endOffset > sourceLength || endOffset <= startOffset) {
    return null;
  }
  const start = positions[startOffset];
  const end = positions[endOffset - 1];
  if (!start || !end) return null;
  return {
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column
  };
}
