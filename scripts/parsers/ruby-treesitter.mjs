/**
 * Tree-sitter Ruby parser for Cortex.
 *
 * Extracts class, module, method (instance `def`), and singleton_method
 * (`def self.foo`) as chunks. Methods are qualified by enclosing
 * class/module path, using Ruby-standard notation:
 *
 *   top-level method:         name = "foo"
 *   class instance method:    name = "Foo#bar"
 *   class singleton method:   name = "Foo.baz"   (called as Foo.baz)
 *   nested module/class:      name = "Outer::Inner"
 *   method in nested class:   name = "Outer::Inner#run"
 *   singleton in nested:      name = "Outer::Inner.load"
 *
 * The `#` vs `.` distinction is the long-standing Ruby documentation
 * convention (e.g. "String#length" vs "String.new") and lets the
 * call-graph distinguish overloads that share a bare method name.
 *
 * Imports: require / require_relative / load / autoload are captured
 * as `call` nodes at program scope; the adapter filters by method
 * name and extracts the string path argument (autoload takes the
 * path as second arg).
 *
 * parseCode is async; the WASM grammar is lazily loaded on first call
 * and cached for subsequent calls.
 */

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  dedupe,
  initTreeSitter,
  lineRangeOf,
  loadGrammar,
  bodyOf,
  collectErrors,
  parseSource,
  runQuery
} from "./tree-sitter/base.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const QUERY_DIR = path.join(__dirname, "tree-sitter", "queries");

let RUBY_LANG = null;
let langPromise = null;

async function ensureLanguage() {
  if (RUBY_LANG) return RUBY_LANG;
  if (!langPromise) {
    langPromise = (async () => {
      await initTreeSitter();
      RUBY_LANG = await loadGrammar("ruby");
      return RUBY_LANG;
    })();
  }
  await langPromise;
  return RUBY_LANG;
}

export async function isAvailable() {
  try {
    await ensureLanguage();
    return true;
  } catch {
    return false;
  }
}

const CHUNK_QUERY = fs.readFileSync(path.join(QUERY_DIR, "ruby.chunks.scm"), "utf8");
const CALL_QUERY = fs.readFileSync(path.join(QUERY_DIR, "ruby.calls.scm"), "utf8");
const IMPORT_QUERY = fs.readFileSync(path.join(QUERY_DIR, "ruby.imports.scm"), "utf8");

const LOADER_NAMES = new Set(["require", "require_relative", "load", "autoload"]);

// Keywords that parse as call nodes but aren't real call edges.
// `puts`, `print`, `p` are stdlib IO helpers — keep them out so the
// graph isn't dominated by debug/logging noise.
const CALL_FILTER = new Set([
  "puts", "print", "p", "pp",
  "require", "require_relative", "load", "autoload",
  "attr_reader", "attr_writer", "attr_accessor",
  "private", "protected", "public",
  "raise", "throw", "catch",
  "lambda", "proc"
]);

function normalizeWhitespace(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function signatureOfDecl(node) {
  const firstNewline = node.text.indexOf("\n");
  if (firstNewline === -1) return normalizeWhitespace(node.text);
  return normalizeWhitespace(node.text.slice(0, firstNewline));
}

function unquoteString(node) {
  // tree-sitter-ruby string nodes contain a string_content child.
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const c = node.namedChild(i);
    if (c.type === "string_content") return c.text;
  }
  // Fallback: strip surrounding quotes.
  const text = node.text;
  if (text.length >= 2 && (text.startsWith("'") || text.startsWith('"'))) {
    return text.slice(1, -1);
  }
  return text;
}

function enclosingModulePath(node) {
  const parts = [];
  let cur = node.parent;
  while (cur && cur.type !== "program") {
    if (cur.type === "class" || cur.type === "module") {
      const nameNode = cur.childForFieldName("name");
      if (nameNode) parts.unshift(nameNode.text);
    }
    cur = cur.parent;
  }
  return parts;
}

function collectImports(rootNode) {
  const captures = runQuery(RUBY_LANG, IMPORT_QUERY, rootNode);
  const imports = [];

  // Only top-level require calls count as imports (not calls made
  // inside methods that happen to be named `require`).
  const callNodes = new Map();
  for (const cap of captures) {
    if (cap.name === "import.call") {
      callNodes.set(cap.node.id, cap.node);
    }
  }

  for (const [, callNode] of callNodes) {
    // Walk up: an import call's ancestors should be only program /
    // body_statement, never a method body.
    let ancestor = callNode.parent;
    let isTopLevel = true;
    while (ancestor) {
      if (
        ancestor.type === "method" ||
        ancestor.type === "singleton_method" ||
        ancestor.type === "block" ||
        ancestor.type === "do_block"
      ) {
        isTopLevel = false;
        break;
      }
      ancestor = ancestor.parent;
    }
    if (!isTopLevel) continue;

    const methodNode = callNode.childForFieldName("method");
    const argumentsNode = callNode.childForFieldName("arguments");
    if (!methodNode || !argumentsNode) continue;
    if (!LOADER_NAMES.has(methodNode.text)) continue;

    const isAutoload = methodNode.text === "autoload";
    let targetArgIndex = 0;
    if (isAutoload) targetArgIndex = 1;
    const stringArgs = [];
    for (let i = 0; i < argumentsNode.namedChildCount; i += 1) {
      const arg = argumentsNode.namedChild(i);
      if (arg.type === "string") stringArgs.push(arg);
    }
    const target = stringArgs[targetArgIndex] ?? stringArgs[0];
    if (target) imports.push(unquoteString(target));
  }

  return dedupe(imports);
}

function collectCallsInNode(node) {
  const captures = runQuery(RUBY_LANG, CALL_QUERY, node);
  const names = captures
    .filter((c) => c.name === "call.name")
    .map((c) => c.node.text)
    .filter((name) => name && !CALL_FILTER.has(name));
  return dedupe(names);
}

function buildTypeChunk(node, kind, language) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;
  const baseName = nameNode.text;
  const parentPath = enclosingModulePath(node);
  const qualifiedName = parentPath.length > 0
    ? `${parentPath.join("::")}::${baseName}`
    : baseName;
  const { startLine, endLine } = lineRangeOf(node);
  return {
    name: qualifiedName,
    kind,
    signature: signatureOfDecl(node),
    body: bodyOf(node),
    startLine,
    endLine,
    language,
    exported: true,
    calls: [],
    imports: []
  };
}

function buildMethodChunk(node, imports, language, isSingleton) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;
  const methodName = nameNode.text;
  const parentPath = enclosingModulePath(node);
  const owner = parentPath.length > 0 ? parentPath.join("::") : "";
  const separator = isSingleton ? "." : "#";
  const qualifiedName = owner ? `${owner}${separator}${methodName}` : methodName;
  const { startLine, endLine } = lineRangeOf(node);
  return {
    name: qualifiedName,
    kind: isSingleton ? "class_method" : "method",
    signature: signatureOfDecl(node),
    body: bodyOf(node),
    startLine,
    endLine,
    language,
    exported: !methodName.startsWith("_"),
    calls: collectCallsInNode(node),
    imports
  };
}

export async function parseCode(code, filePath, language = "ruby") {
  await ensureLanguage();
  const { tree, reason } = parseSource(RUBY_LANG, code);
  if (!tree) return { chunks: [], errors: [{ message: reason }] };
  const root = tree.rootNode;
  const imports = collectImports(root);

  const captures = runQuery(RUBY_LANG, CHUNK_QUERY, root);
  const declCaptures = captures.filter((c) => c.name.endsWith(".decl"));

  const chunks = [];
  for (const cap of declCaptures) {
    const kind = cap.name.split(".")[0];
    let chunk = null;
    if (kind === "class") chunk = buildTypeChunk(cap.node, "class", language);
    else if (kind === "module") chunk = buildTypeChunk(cap.node, "module", language);
    else if (kind === "method") chunk = buildMethodChunk(cap.node, imports, language, false);
    else if (kind === "singleton") chunk = buildMethodChunk(cap.node, imports, language, true);
    if (chunk) chunks.push(chunk);
  }

  const seen = new Set();
  const deduped = chunks.filter((chunk) => {
    const key = `${chunk.kind}|${chunk.name}|${chunk.startLine}|${chunk.endLine}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { chunks: deduped, errors: collectErrors(tree) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: ruby-treesitter.mjs <file.rb>");
    process.exit(1);
  }
  const code = fs.readFileSync(target, "utf8");
  const result = await parseCode(code, target, "ruby");
  console.log(JSON.stringify(result, null, 2));
}
