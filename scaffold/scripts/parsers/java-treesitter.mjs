/**
 * Tree-sitter Java parser for Cortex.
 *
 * Extracts class/interface/enum/record declarations, methods, and
 * constructors as chunks. Methods and constructors are qualified by
 * the enclosing type path, so `Outer.Inner.deep()` becomes
 * "Outer.Inner.deep" and `Svc(int n)` becomes "Svc.ctor".
 *
 * Naming conventions (match other Cortex parsers):
 *   class/interface/enum/record:  name = "Foo"
 *   nested type:                  name = "Outer.Inner"
 *   method:                       name = "Class.method"
 *   method in nested:             name = "Outer.Inner.method"
 *   constructor:                  name = "Class.ctor"  (matches C# style)
 *
 * exported: true when modifiers include `public`. Package-private and
 * protected count as not-exported for Cortex's find-callers purposes.
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

let JAVA_LANG = null;
let langPromise = null;

async function ensureLanguage() {
  if (JAVA_LANG) return JAVA_LANG;
  if (!langPromise) {
    langPromise = (async () => {
      await initTreeSitter();
      JAVA_LANG = await loadGrammar("java");
      return JAVA_LANG;
    })();
  }
  await langPromise;
  return JAVA_LANG;
}

export async function isAvailable() {
  try {
    await ensureLanguage();
    return true;
  } catch {
    return false;
  }
}

const CHUNK_QUERY = fs.readFileSync(path.join(QUERY_DIR, "java.chunks.scm"), "utf8");
const CALL_QUERY = fs.readFileSync(path.join(QUERY_DIR, "java.calls.scm"), "utf8");
const IMPORT_QUERY = fs.readFileSync(path.join(QUERY_DIR, "java.imports.scm"), "utf8");

// Keywords that parse as method_invocation in some grammars but
// aren't real call edges for our purposes.
const CALL_FILTER = new Set([
  "super", "this"
]);

function normalizeWhitespace(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function signatureOfDecl(node) {
  const braceIndex = node.text.indexOf("{");
  const semiIndex = node.text.indexOf(";");
  const end = braceIndex === -1 ? semiIndex : (semiIndex === -1 ? braceIndex : Math.min(braceIndex, semiIndex));
  if (end === -1) return normalizeWhitespace(node.text);
  return normalizeWhitespace(node.text.slice(0, end));
}

function hasPublicModifier(node) {
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (child.type !== "modifiers") continue;
    if (child.text.includes("public")) return true;
    return false;
  }
  return false;
}

function enclosingTypePath(node) {
  const path = [];
  let cur = node.parent;
  while (cur && cur.type !== "program") {
    if (
      cur.type === "class_declaration" ||
      cur.type === "interface_declaration" ||
      cur.type === "enum_declaration" ||
      cur.type === "record_declaration"
    ) {
      const nameNode = cur.childForFieldName("name");
      if (nameNode) path.unshift(nameNode.text);
    }
    cur = cur.parent;
  }
  return path;
}

function collectCallsInNode(node) {
  const captures = runQuery(JAVA_LANG, CALL_QUERY, node);
  const names = captures
    .filter((c) => c.name === "call.name")
    .map((c) => c.node.text)
    .filter((name) => name && !CALL_FILTER.has(name));
  return dedupe(names);
}

function collectImports(rootNode) {
  const captures = runQuery(JAVA_LANG, IMPORT_QUERY, rootNode);
  const imports = [];
  for (const cap of captures) {
    if (cap.name !== "import.decl") continue;
    const decl = cap.node;
    // decl.text looks like `import java.util.List;` or
    // `import static java.lang.Math.PI;` or `import java.util.*;`.
    // Strip `import`, optional `static`, and trailing semicolon.
    let text = decl.text.trim();
    if (text.endsWith(";")) text = text.slice(0, -1).trim();
    if (text.startsWith("import")) text = text.slice("import".length).trim();
    if (text.startsWith("static ")) text = text.slice("static".length).trim();
    imports.push(text);
  }
  return dedupe(imports);
}

function buildTypeChunk(node, kind, imports, language) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;
  const baseName = nameNode.text;
  const parentPath = enclosingTypePath(node);
  const qualifiedName = parentPath.length > 0
    ? `${parentPath.join(".")}.${baseName}`
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
    exported: hasPublicModifier(node),
    calls: [],
    imports: []
  };
}

function buildMethodChunk(node, imports, language) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;
  const methodName = nameNode.text;
  const parentPath = enclosingTypePath(node);
  const qualifiedName = parentPath.length > 0
    ? `${parentPath.join(".")}.${methodName}`
    : methodName;
  const { startLine, endLine } = lineRangeOf(node);
  return {
    name: qualifiedName,
    kind: "method",
    signature: signatureOfDecl(node),
    body: bodyOf(node),
    startLine,
    endLine,
    language,
    exported: hasPublicModifier(node),
    calls: collectCallsInNode(node),
    imports
  };
}

function buildConstructorChunk(node, imports, language) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;
  const parentPath = enclosingTypePath(node);
  const classPath = parentPath.length > 0 ? parentPath.join(".") : nameNode.text;
  const qualifiedName = `${classPath}.ctor`;
  const { startLine, endLine } = lineRangeOf(node);
  return {
    name: qualifiedName,
    kind: "constructor",
    signature: signatureOfDecl(node),
    body: bodyOf(node),
    startLine,
    endLine,
    language,
    exported: hasPublicModifier(node),
    calls: collectCallsInNode(node),
    imports
  };
}

export async function parseCode(code, filePath, language = "java") {
  await ensureLanguage();
  const { tree, reason } = parseSource(JAVA_LANG, code);
  if (!tree) return { chunks: [], errors: [{ message: reason }] };
  const root = tree.rootNode;
  const imports = collectImports(root);

  const captures = runQuery(JAVA_LANG, CHUNK_QUERY, root);
  const declCaptures = captures.filter((c) => c.name.endsWith(".decl"));

  const chunks = [];
  for (const cap of declCaptures) {
    const kind = cap.name.split(".")[0];
    let chunk = null;
    if (kind === "class") chunk = buildTypeChunk(cap.node, "class", imports, language);
    else if (kind === "interface") chunk = buildTypeChunk(cap.node, "interface", imports, language);
    else if (kind === "enum") chunk = buildTypeChunk(cap.node, "enum", imports, language);
    else if (kind === "record") chunk = buildTypeChunk(cap.node, "record", imports, language);
    else if (kind === "method") chunk = buildMethodChunk(cap.node, imports, language);
    else if (kind === "ctor") chunk = buildConstructorChunk(cap.node, imports, language);
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
    console.error("Usage: java-treesitter.mjs <file.java>");
    process.exit(1);
  }
  const code = fs.readFileSync(target, "utf8");
  const result = await parseCode(code, target, "java");
  console.log(JSON.stringify(result, null, 2));
}
