/**
 * Tree-sitter Python parser for Cortex.
 *
 * Extracts function_definition (sync + async), class_definition, and
 * nested methods as chunks matching Cortex's standard shape. Call
 * extraction covers direct identifier calls and trailing identifier
 * of attribute/method calls. Imports cover `import X`, `import X as Y`,
 * `from X import Y`, `from X import Y as Z`, and relative imports.
 *
 * Chunk naming:
 *   - top-level function:   name = "foo"
 *   - top-level class:      name = "Foo"
 *   - method:               name = "Class.method"
 *   - nested class:         name = "Outer.Inner"
 *   - method in nested:     name = "Outer.Inner.method"
 *
 * parseCode is async; the WASM grammar is lazily loaded on first call
 * and cached for subsequent calls. Callers must `await parseCode(...)`.
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

let PY_LANG = null;
let langPromise = null;

async function ensureLanguage() {
  if (PY_LANG) return PY_LANG;
  if (!langPromise) {
    langPromise = (async () => {
      await initTreeSitter();
      PY_LANG = await loadGrammar("python");
      return PY_LANG;
    })();
  }
  await langPromise;
  return PY_LANG;
}

export async function isAvailable() {
  try {
    await ensureLanguage();
    return true;
  } catch {
    return false;
  }
}

const CHUNK_QUERY = fs.readFileSync(path.join(QUERY_DIR, "python.chunks.scm"), "utf8");
const CALL_QUERY = fs.readFileSync(path.join(QUERY_DIR, "python.calls.scm"), "utf8");
const IMPORT_QUERY = fs.readFileSync(path.join(QUERY_DIR, "python.imports.scm"), "utf8");

const CALL_BUILTINS = new Set([
  "print", "len", "range", "str", "int", "float", "bool",
  "list", "dict", "set", "tuple", "type", "isinstance",
  "getattr", "setattr", "hasattr", "super", "self"
]);

function normalizeWhitespace(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function signatureOfDef(node) {
  const colonIndex = node.text.indexOf(":");
  const firstLine = colonIndex >= 0 ? node.text.slice(0, colonIndex + 1) : node.text.split("\n")[0];
  return normalizeWhitespace(firstLine);
}

function renderDottedName(node) {
  if (!node) return "";
  if (node.type === "identifier") return node.text;
  if (node.type === "dotted_name") {
    const parts = [];
    for (let i = 0; i < node.namedChildCount; i += 1) {
      const c = node.namedChild(i);
      if (c.type === "identifier") parts.push(c.text);
    }
    return parts.join(".");
  }
  return node.text;
}

function renderAliasedImport(node) {
  const dotted = node.namedChild(0);
  return renderDottedName(dotted);
}

function renderRelativeImport(node) {
  let prefix = "";
  let moduleName = "";
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (child.type === "import_prefix") prefix = child.text;
    else if (child.type === "dotted_name") moduleName = renderDottedName(child);
  }
  return prefix + moduleName;
}

function renderImportName(node) {
  if (!node) return "";
  if (node.type === "dotted_name") return renderDottedName(node);
  if (node.type === "aliased_import") return renderAliasedImport(node);
  if (node.type === "relative_import") return renderRelativeImport(node);
  if (node.type === "identifier") return node.text;
  return normalizeWhitespace(node.text);
}

function collectImports(rootNode) {
  const captures = runQuery(PY_LANG, IMPORT_QUERY, rootNode);
  const imports = [];

  for (const cap of captures) {
    if (cap.name !== "import.stmt") continue;
    const stmt = cap.node;

    if (stmt.type === "import_statement") {
      for (let i = 0; i < stmt.namedChildCount; i += 1) {
        const child = stmt.namedChild(i);
        const rendered = renderImportName(child);
        if (rendered) imports.push(rendered);
      }
      continue;
    }

    if (stmt.type === "import_from_statement") {
      let moduleSource = "";
      const importedNames = [];
      for (let i = 0; i < stmt.namedChildCount; i += 1) {
        const child = stmt.namedChild(i);
        if (!moduleSource && (child.type === "dotted_name" || child.type === "relative_import")) {
          moduleSource = renderImportName(child);
        } else if (child.type === "dotted_name" || child.type === "aliased_import") {
          importedNames.push(renderImportName(child));
        }
      }
      if (moduleSource && importedNames.length === 0) {
        imports.push(moduleSource);
      } else {
        for (const name of importedNames) {
          imports.push(moduleSource ? `${moduleSource}.${name}` : name);
        }
      }
    }
  }

  return dedupe(imports);
}

function collectCallsInNode(node) {
  const captures = runQuery(PY_LANG, CALL_QUERY, node);
  const names = captures
    .filter((c) => c.name === "call.name")
    .map((c) => c.node.text)
    .filter((name) => name && !CALL_BUILTINS.has(name));
  return dedupe(names);
}

function enclosingClassPath(node) {
  const path = [];
  let cur = node.parent;
  while (cur && cur.type !== "module") {
    if (cur.type === "class_definition") {
      const nameNode = cur.childForFieldName("name");
      if (nameNode) path.unshift(nameNode.text);
    }
    cur = cur.parent;
  }
  return path;
}

function isExported(name) {
  return !name.startsWith("_");
}

function buildFunctionChunk(node, imports, language) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;
  const baseName = nameNode.text;
  const classPath = enclosingClassPath(node);
  const isMethod = classPath.length > 0;
  const qualifiedName = isMethod ? `${classPath.join(".")}.${baseName}` : baseName;
  const { startLine, endLine } = lineRangeOf(node);
  return {
    name: qualifiedName,
    kind: isMethod ? "method" : "function",
    signature: signatureOfDef(node),
    body: bodyOf(node),
    startLine,
    endLine,
    language,
    exported: isExported(baseName),
    calls: collectCallsInNode(node.childForFieldName("body") ?? node),
    imports
  };
}

function buildClassChunk(node, language) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;
  const baseName = nameNode.text;
  const classPath = enclosingClassPath(node);
  const qualifiedName = classPath.length > 0
    ? `${classPath.join(".")}.${baseName}`
    : baseName;
  const { startLine, endLine } = lineRangeOf(node);
  return {
    name: qualifiedName,
    kind: "class",
    signature: signatureOfDef(node),
    body: bodyOf(node),
    startLine,
    endLine,
    language,
    exported: isExported(baseName),
    calls: [],
    imports: []
  };
}

export async function parseCode(code, filePath, language = "python") {
  await ensureLanguage();
  const { tree, reason } = parseSource(PY_LANG, code);
  if (!tree) return { chunks: [], errors: [{ message: reason }] };
  const root = tree.rootNode;
  const imports = collectImports(root);

  const captures = runQuery(PY_LANG, CHUNK_QUERY, root);
  const declCaptures = captures.filter((c) => c.name.endsWith(".decl"));

  const chunks = [];
  for (const cap of declCaptures) {
    const kind = cap.name.split(".")[0];
    let chunk = null;
    if (kind === "fn") chunk = buildFunctionChunk(cap.node, imports, language);
    else if (kind === "class") chunk = buildClassChunk(cap.node, language);
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
    console.error("Usage: python-treesitter.mjs <file.py>");
    process.exit(1);
  }
  const code = fs.readFileSync(target, "utf8");
  const result = await parseCode(code, target, "python");
  console.log(JSON.stringify(result, null, 2));
}
