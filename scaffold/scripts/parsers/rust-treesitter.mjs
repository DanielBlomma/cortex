/**
 * Tree-sitter Rust parser for Cortex.
 *
 * Produces the same chunk shape as scripts/parsers/rust.mjs (the regex
 * parser) but uses tree-sitter-rust via web-tree-sitter WASM. This is
 * the pilot language for the tree-sitter infrastructure; behavioral
 * parity with the regex parser is verified by the existing rust-parser
 * test suite run against this module.
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

let RUST_LANG = null;
let langPromise = null;

async function ensureLanguage() {
  if (RUST_LANG) return RUST_LANG;
  if (!langPromise) {
    langPromise = (async () => {
      await initTreeSitter();
      RUST_LANG = await loadGrammar("rust");
      return RUST_LANG;
    })();
  }
  await langPromise;
  return RUST_LANG;
}

export async function isAvailable() {
  try {
    await ensureLanguage();
    return true;
  } catch {
    return false;
  }
}

const CHUNK_QUERY = fs.readFileSync(path.join(QUERY_DIR, "rust.chunks.scm"), "utf8");
const CALL_QUERY = fs.readFileSync(path.join(QUERY_DIR, "rust.calls.scm"), "utf8");
const IMPORT_QUERY = fs.readFileSync(path.join(QUERY_DIR, "rust.imports.scm"), "utf8");

const CALL_KEYWORDS = new Set([
  "if", "for", "while", "loop", "match", "return",
  "Some", "None", "Ok", "Err", "Box", "Vec", "String",
  "println", "eprintln", "format", "write", "writeln",
  "panic", "todo", "unimplemented", "unreachable",
  "assert", "assert_eq", "assert_ne", "debug_assert",
  "debug_assert_eq", "debug_assert_ne",
  "cfg", "derive", "allow", "warn", "deny"
]);

function normalizeWhitespace(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function buildSignature(bodyText) {
  const braceIndex = bodyText.indexOf("{");
  if (braceIndex === -1) return normalizeWhitespace(bodyText);
  return normalizeWhitespace(bodyText.slice(0, braceIndex));
}

function collectImports(rootNode) {
  const captures = runQuery(RUST_LANG, IMPORT_QUERY, rootNode);
  const imports = captures
    .filter((c) => c.name === "use.path")
    .map((c) => normalizeWhitespace(c.node.text));
  return dedupe(imports);
}

const MACRO_INNER_CALL_PATTERN = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

function collectCallsFromMacroBodies(node) {
  const names = [];
  const visit = (n) => {
    if (n.type === "macro_invocation") {
      for (let i = 0; i < n.namedChildCount; i += 1) {
        const child = n.namedChild(i);
        if (child.type !== "token_tree") continue;
        const text = child.text;
        MACRO_INNER_CALL_PATTERN.lastIndex = 0;
        let m;
        while ((m = MACRO_INNER_CALL_PATTERN.exec(text)) !== null) {
          names.push(m[1]);
        }
      }
      return;
    }
    for (let i = 0; i < n.namedChildCount; i += 1) visit(n.namedChild(i));
  };
  visit(node);
  return names.filter((n) => !CALL_KEYWORDS.has(n));
}

function collectCallsInNode(node) {
  const captures = runQuery(RUST_LANG, CALL_QUERY, node);
  const astNames = captures
    .filter((c) => c.name === "call.name")
    .map((c) => c.node.text)
    .filter((name) => name && !CALL_KEYWORDS.has(name));
  const macroInnerNames = collectCallsFromMacroBodies(node);
  return dedupe([...astNames, ...macroInnerNames]);
}

/**
 * Walk captures from CHUNK_QUERY and group companion captures with
 * their decl anchor. Returns [{ kind, decl, name, typeNode }] entries
 * in document order.
 */
function groupDeclarations(rootNode) {
  const captures = runQuery(RUST_LANG, CHUNK_QUERY, rootNode);

  const declCaptures = captures.filter((c) => c.name.endsWith(".decl"));
  declCaptures.sort((a, b) => a.node.startIndex - b.node.startIndex);

  const entries = declCaptures.map((c) => ({
    kind: c.name.split(".")[0],
    node: c.node,
    meta: {}
  }));

  for (const cap of captures) {
    if (cap.name.endsWith(".decl")) continue;
    const [kind, field] = cap.name.split(".");
    let closest = null;
    let closestSize = Infinity;
    for (const entry of entries) {
      if (entry.kind !== kind) continue;
      if (cap.node.startIndex < entry.node.startIndex) continue;
      if (cap.node.endIndex > entry.node.endIndex) continue;
      const size = entry.node.endIndex - entry.node.startIndex;
      if (size < closestSize) {
        closest = entry;
        closestSize = size;
      }
    }
    if (!closest) continue;
    if (!(field in closest.meta)) {
      closest.meta[field] = cap.node;
    }
  }

  return entries;
}

function isRustPublic(node) {
  for (let i = 0; i < node.namedChildCount; i += 1) {
    if (node.namedChild(i).type === "visibility_modifier") return true;
  }
  return false;
}

function chunkFrom(kind, node, name, signatureOverride, calls, imports, language) {
  const { startLine, endLine } = lineRangeOf(node);
  return {
    name,
    kind,
    signature: signatureOverride ?? buildSignature(node.text),
    body: bodyOf(node),
    startLine,
    endLine,
    language,
    exported: isRustPublic(node),
    calls,
    imports
  };
}

function isInsideAny(node, others) {
  return others.some(
    (o) =>
      node.startIndex >= o.startIndex &&
      node.endIndex <= o.endIndex &&
      node !== o
  );
}

function extractFunctionCalls(functionNode) {
  const bodyNode = functionNode.childForFieldName("body");
  if (!bodyNode) return [];
  return collectCallsInNode(bodyNode);
}

export async function parseCode(code, filePath, language = "rust") {
  await ensureLanguage();
  const { tree, reason } = parseSource(RUST_LANG, code);
  if (!tree) return { chunks: [], errors: [{ message: reason }] };
  const root = tree.rootNode;

  const imports = collectImports(root);
  const decls = groupDeclarations(root);

  const implNodes = decls.filter((d) => d.kind === "impl").map((d) => d.node);

  const chunks = [];

  for (const entry of decls) {
    const { kind, node, meta } = entry;

    if (kind === "fn") {
      if (isInsideAny(node, implNodes)) continue;
      const name = meta.name?.text;
      if (!name) continue;
      chunks.push(
        chunkFrom("function", node, name, null, extractFunctionCalls(node), imports, language)
      );
    } else if (kind === "struct") {
      const name = meta.name?.text;
      if (!name) continue;
      const isUnit = !node.text.includes("{");
      const signature = isUnit ? normalizeWhitespace(node.text) : buildSignature(node.text);
      chunks.push(chunkFrom("struct", node, name, signature, [], [], language));
    } else if (kind === "enum") {
      const name = meta.name?.text;
      if (!name) continue;
      chunks.push(chunkFrom("enum", node, name, null, [], [], language));
    } else if (kind === "trait") {
      const name = meta.name?.text;
      if (!name) continue;
      chunks.push(chunkFrom("trait", node, name, null, [], [], language));
    } else if (kind === "mod") {
      const name = meta.name?.text;
      if (!name) continue;
      chunks.push(chunkFrom("module", node, name, null, [], [], language));
    } else if (kind === "macro") {
      const name = meta.name?.text;
      if (!name) continue;
      chunks.push(
        chunkFrom("macro", node, name, `macro_rules! ${name}`, [], [], language)
      );
    } else if (kind === "impl") {
      const typeName = meta.type?.text;
      if (!typeName) continue;
      const traitNode = node.childForFieldName("trait");
      const implName = traitNode ? `${traitNode.text} for ${typeName}` : typeName;
      chunks.push(chunkFrom("impl", node, implName, null, [], [], language));

      const bodyNode = node.childForFieldName("body");
      if (!bodyNode) continue;
      for (let i = 0; i < bodyNode.namedChildCount; i += 1) {
        const child = bodyNode.namedChild(i);
        if (child.type !== "function_item") continue;
        const fnName = child.childForFieldName("name")?.text;
        if (!fnName) continue;
        const hasBody = child.childForFieldName("body");
        if (!hasBody) continue;
        const qualifiedName = `${typeName}::${fnName}`;
        const { startLine, endLine } = lineRangeOf(child);
        chunks.push({
          name: qualifiedName,
          kind: "method",
          signature: buildSignature(child.text),
          body: bodyOf(child),
          startLine,
          endLine,
          language,
          exported: isRustPublic(child),
          calls: extractFunctionCalls(child),
          imports
        });
      }
    }
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
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: rust-treesitter.mjs <file.rs>");
    process.exit(1);
  }
  const code = fs.readFileSync(filePath, "utf8");
  const result = await parseCode(code, filePath, "rust");
  console.log(JSON.stringify(result, null, 2));
}
