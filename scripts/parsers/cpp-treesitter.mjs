/**
 * Tree-sitter C/C++ parser for Cortex.
 *
 * Uses tree-sitter-cpp (a superset that parses C correctly) as a
 * single grammar for .c, .h, .cpp, .cc, .hpp, .hh files. This removes
 * the clang runtime dependency that the legacy cpp.mjs parser required.
 *
 * Chunk shape matches the Cortex convention. Methods and nested types
 * are qualified by their enclosing class/struct/union/namespace path
 * using `::` as the separator, matching C++ source syntax.
 *
 * Naming:
 *   free function:         name = "add"
 *   method in class body:  name = "Foo::bar"
 *   out-of-class method:   name = "Foo::bar"   (def like `Foo::bar()`)
 *   nested class:          name = "Outer::Inner"
 *   namespace function:    name = "app::handler"
 *   namespace class:       name = "app::Service"
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

let CPP_LANG = null;
let langPromise = null;

async function ensureLanguage() {
  if (CPP_LANG) return CPP_LANG;
  if (!langPromise) {
    langPromise = (async () => {
      await initTreeSitter();
      CPP_LANG = await loadGrammar("cpp");
      return CPP_LANG;
    })();
  }
  await langPromise;
  return CPP_LANG;
}

const CHUNK_QUERY = fs.readFileSync(path.join(QUERY_DIR, "cpp.chunks.scm"), "utf8");
const CALL_QUERY = fs.readFileSync(path.join(QUERY_DIR, "cpp.calls.scm"), "utf8");
const IMPORT_QUERY = fs.readFileSync(path.join(QUERY_DIR, "cpp.imports.scm"), "utf8");

// Calls that are control-flow, builtins, or stdlib logging noise —
// kept out of the graph so real function-to-function edges stand out.
const CALL_FILTER = new Set([
  "sizeof", "alignof", "typeid", "decltype", "typeof",
  "static_cast", "dynamic_cast", "reinterpret_cast", "const_cast",
  "printf", "fprintf", "sprintf", "snprintf", "puts",
  "malloc", "free", "calloc", "realloc", "memcpy", "memset", "memmove"
]);

function normalizeWhitespace(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

/**
 * Determine whether a declaration is visible from outside its
 * enclosing class/struct. Walks up the AST and, when the nearest
 * class_specifier/struct_specifier ancestor is found, inspects the
 * preceding access_specifier sibling inside the class body. Defaults:
 * `class` members are private until an `access_specifier` says
 * otherwise; `struct`/`union` members are public.
 *
 * Returns true when the declaration is at namespace scope or under
 * a `public:` access specifier.
 */
function isCppVisible(node) {
  let current = node;
  while (current?.parent) {
    const parent = current.parent;
    const parentType = parent.type;

    if (parentType === "field_declaration_list") {
      // web-tree-sitter returns fresh wrapper objects per call, so compare
      // by source position rather than identity.
      let access = null;
      for (let i = 0; i < parent.namedChildCount; i += 1) {
        const sib = parent.namedChild(i);
        if (sib.startIndex === current.startIndex && sib.endIndex === current.endIndex) break;
        if (sib.type === "access_specifier") access = sib.text.trim();
      }
      const enclosing = parent.parent?.type;
      if (access == null) {
        // No access_specifier yet — use the enclosing type's default.
        return enclosing === "struct_specifier" || enclosing === "union_specifier";
      }
      return access === "public";
    }

    if (parentType === "class_specifier" || parentType === "struct_specifier" || parentType === "union_specifier") {
      // Direct member of a named type body not wrapped in a field list (rare).
      // Treat as if under the default access.
      return parentType !== "class_specifier";
    }

    current = parent;
  }
  // No enclosing class/struct body — namespace or file scope: always visible.
  return true;
}

function signatureOfDecl(node) {
  const braceIndex = node.text.indexOf("{");
  const semiIndex = node.text.indexOf(";");
  const end = braceIndex === -1 ? semiIndex : (semiIndex === -1 ? braceIndex : Math.min(braceIndex, semiIndex));
  if (end === -1) return normalizeWhitespace(node.text);
  return normalizeWhitespace(node.text.slice(0, end));
}

function collectCallsInNode(node) {
  const captures = runQuery(CPP_LANG, CALL_QUERY, node);
  const names = captures
    .filter((c) => c.name === "call.name")
    .map((c) => c.node.text)
    .filter((name) => name && !CALL_FILTER.has(name));
  return dedupe(names);
}

function collectImports(rootNode) {
  const captures = runQuery(CPP_LANG, IMPORT_QUERY, rootNode);
  const imports = [];
  for (const cap of captures) {
    if (cap.name !== "include.decl") continue;
    const decl = cap.node;
    for (let i = 0; i < decl.namedChildCount; i += 1) {
      const child = decl.namedChild(i);
      if (child.type === "system_lib_string") {
        // <vector> — strip angle brackets
        const text = child.text;
        imports.push(text.startsWith("<") && text.endsWith(">") ? text.slice(1, -1) : text);
      } else if (child.type === "string_literal") {
        // "local.h" — walk for string_content
        for (let j = 0; j < child.namedChildCount; j += 1) {
          const inner = child.namedChild(j);
          if (inner.type === "string_content") {
            imports.push(inner.text);
            break;
          }
        }
      }
    }
  }
  return dedupe(imports);
}

/**
 * Walk up the tree and collect names of enclosing classes, structs,
 * unions, and namespaces. Nested namespaces like `namespace a::b`
 * contribute both `a` and `b` to the path.
 */
function enclosingScopePath(node) {
  const parts = [];
  let cur = node.parent;
  while (cur && cur.type !== "translation_unit") {
    if (
      cur.type === "class_specifier" ||
      cur.type === "struct_specifier" ||
      cur.type === "union_specifier"
    ) {
      const nameNode = cur.childForFieldName("name");
      if (nameNode) parts.unshift(nameNode.text);
    } else if (cur.type === "namespace_definition") {
      parts.unshift(...namespaceDefinitionNames(cur));
    }
    cur = cur.parent;
  }
  return parts;
}

function namespaceDefinitionNames(nsNode) {
  const names = [];
  // Could have a single namespace_identifier OR a nested_namespace_specifier
  for (let i = 0; i < nsNode.namedChildCount; i += 1) {
    const child = nsNode.namedChild(i);
    if (child.type === "namespace_identifier") {
      names.push(child.text);
    } else if (child.type === "nested_namespace_specifier") {
      for (let j = 0; j < child.namedChildCount; j += 1) {
        const inner = child.namedChild(j);
        if (inner.type === "namespace_identifier") names.push(inner.text);
      }
    }
  }
  return names;
}

/**
 * Extract the function name and any qualifying path from a
 * function_definition's function_declarator. Returns { name, isMethod }.
 *
 * - identifier inside declarator → free function, name = identifier
 * - field_identifier inside declarator (in class body) → method,
 *   name = field identifier, qualifies with enclosing class
 * - qualified_identifier (like `Foo::bar`) → out-of-class method,
 *   name encoded as `Foo::bar` directly
 */
function functionNameFrom(fnDefNode) {
  let declarator = null;
  for (let i = 0; i < fnDefNode.namedChildCount; i += 1) {
    const child = fnDefNode.namedChild(i);
    if (child.type === "function_declarator") {
      declarator = child;
      break;
    }
    if (child.type === "pointer_declarator" || child.type === "reference_declarator") {
      for (let j = 0; j < child.namedChildCount; j += 1) {
        const inner = child.namedChild(j);
        if (inner.type === "function_declarator") {
          declarator = inner;
          break;
        }
      }
      if (declarator) break;
    }
  }
  if (!declarator) return null;

  for (let i = 0; i < declarator.namedChildCount; i += 1) {
    const child = declarator.namedChild(i);
    if (child.type === "identifier") {
      return { name: child.text, qualifiedForm: null };
    }
    if (child.type === "field_identifier") {
      return { name: child.text, qualifiedForm: null };
    }
    if (child.type === "qualified_identifier") {
      return { name: null, qualifiedForm: child.text };
    }
  }
  return null;
}

function buildFunctionChunk(node, imports, language) {
  const nameInfo = functionNameFrom(node);
  if (!nameInfo) return null;

  let qualifiedName;
  let kind;

  if (nameInfo.qualifiedForm) {
    qualifiedName = nameInfo.qualifiedForm;
    kind = "method";
  } else {
    const scope = enclosingScopePath(node);
    const baseName = nameInfo.name;
    if (scope.length > 0) {
      qualifiedName = `${scope.join("::")}::${baseName}`;
      kind = "method";
    } else {
      qualifiedName = baseName;
      kind = "function";
    }
  }

  const { startLine, endLine } = lineRangeOf(node);
  return {
    name: qualifiedName,
    kind,
    signature: signatureOfDecl(node),
    body: bodyOf(node),
    startLine,
    endLine,
    language,
    exported: isCppVisible(node),
    calls: collectCallsInNode(node),
    imports
  };
}

function buildTypeChunk(node, kind, language) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;
  const baseName = nameNode.text;
  const scope = enclosingScopePath(node);
  const qualifiedName = scope.length > 0 ? `${scope.join("::")}::${baseName}` : baseName;
  const { startLine, endLine } = lineRangeOf(node);
  return {
    name: qualifiedName,
    kind,
    signature: signatureOfDecl(node),
    body: bodyOf(node),
    startLine,
    endLine,
    language,
    exported: isCppVisible(node),
    calls: [],
    imports: []
  };
}

function buildNamespaceChunk(node, language) {
  const names = namespaceDefinitionNames(node);
  if (names.length === 0) return null;
  const scope = enclosingScopePath(node);
  const fullPath = [...scope, ...names].join("::");
  const { startLine, endLine } = lineRangeOf(node);
  return {
    name: fullPath,
    kind: "namespace",
    signature: signatureOfDecl(node),
    body: bodyOf(node),
    startLine,
    endLine,
    language,
    exported: isCppVisible(node),
    calls: [],
    imports: []
  };
}

export async function parseCode(code, filePath, language = "cpp") {
  await ensureLanguage();
  const { tree, reason } = parseSource(CPP_LANG, code);
  if (!tree) return { chunks: [], errors: [{ message: reason }] };
  const root = tree.rootNode;
  const imports = collectImports(root);

  const captures = runQuery(CPP_LANG, CHUNK_QUERY, root);
  const declCaptures = captures.filter((c) => c.name.endsWith(".decl"));

  const chunks = [];
  for (const cap of declCaptures) {
    const kindTag = cap.name.split(".")[0];
    let chunk = null;
    if (kindTag === "fn") chunk = buildFunctionChunk(cap.node, imports, language);
    else if (kindTag === "class") chunk = buildTypeChunk(cap.node, "class", language);
    else if (kindTag === "struct") chunk = buildTypeChunk(cap.node, "struct", language);
    else if (kindTag === "union") chunk = buildTypeChunk(cap.node, "union", language);
    else if (kindTag === "enum") chunk = buildTypeChunk(cap.node, "enum", language);
    else if (kindTag === "namespace") chunk = buildNamespaceChunk(cap.node, language);
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

export async function isAvailable() {
  try {
    await ensureLanguage();
    return true;
  } catch {
    return false;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: cpp-treesitter.mjs <file.{c,cpp,h,hpp}>");
    process.exit(1);
  }
  const code = fs.readFileSync(target, "utf8");
  const result = await parseCode(code, target, target.endsWith(".c") || target.endsWith(".h") ? "c" : "cpp");
  console.log(JSON.stringify(result, null, 2));
}
