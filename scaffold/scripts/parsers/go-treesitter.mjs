/**
 * Tree-sitter Go parser for Cortex.
 *
 * Extracts function_declaration, method_declaration (with receiver),
 * and type_declaration (struct/interface/type alias) as chunks.
 *
 * Naming:
 *   top-level function:   name = "Parse"
 *   method on T:          name = "T.Method"
 *   method on *T:         name = "T.Method"   (pointer vs value unified)
 *   struct type:          name = "Config"     (kind = "struct")
 *   interface type:       name = "Handler"    (kind = "interface")
 *   other type:           name = "UserID"     (kind = "type")
 *
 * Exported: true when the name starts with an upper-case letter (Go convention).
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
  commonTreeSitterDialectFacts,
  parseSource,
  prepareDialectAdapterInput,
  runQuery,
  treeSitterDialectObservationEnvelope,
  treeSitterUnavailableTransport
} from "./tree-sitter/base.mjs";
import { createDialectObservationTransport } from "../lib/dialect-observation-contract.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const QUERY_DIR = path.join(__dirname, "tree-sitter", "queries");

let GO_LANG = null;
let langPromise = null;

async function ensureLanguage() {
  if (GO_LANG) return GO_LANG;
  if (!langPromise) {
    langPromise = (async () => {
      await initTreeSitter();
      GO_LANG = await loadGrammar("go");
      return GO_LANG;
    })();
  }
  await langPromise;
  return GO_LANG;
}

export async function isAvailable() {
  try {
    await ensureLanguage();
    return true;
  } catch {
    return false;
  }
}

const CHUNK_QUERY = fs.readFileSync(path.join(QUERY_DIR, "go.chunks.scm"), "utf8");
const CALL_QUERY = fs.readFileSync(path.join(QUERY_DIR, "go.calls.scm"), "utf8");
const IMPORT_QUERY = fs.readFileSync(path.join(QUERY_DIR, "go.imports.scm"), "utf8");

const CALL_FILTER = new Set([
  "make", "new", "len", "cap", "append", "copy", "delete",
  "panic", "recover", "print", "println", "close",
  "int", "int32", "int64", "float32", "float64", "string",
  "byte", "rune", "bool", "complex", "real", "imag"
]);

function normalizeWhitespace(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function signatureOfDecl(node) {
  const braceIndex = node.text.indexOf("{");
  if (braceIndex === -1) return normalizeWhitespace(node.text);
  return normalizeWhitespace(node.text.slice(0, braceIndex));
}

function unquoteStringLiteral(text) {
  if (text.length >= 2 && (text.startsWith('"') || text.startsWith("`"))) {
    return text.slice(1, -1);
  }
  return text;
}

function isExported(name) {
  if (!name || name.length === 0) return false;
  const first = name[0];
  return first >= "A" && first <= "Z";
}

function collectImports(rootNode) {
  const captures = runQuery(GO_LANG, IMPORT_QUERY, rootNode);
  const imports = captures
    .filter((c) => c.name === "import.path")
    .map((c) => unquoteStringLiteral(c.node.text));
  return dedupe(imports);
}

function collectCallsInNode(node) {
  const captures = runQuery(GO_LANG, CALL_QUERY, node);
  const names = captures
    .filter((c) => c.name === "call.name")
    .map((c) => c.node.text)
    .filter((name) => name && !CALL_FILTER.has(name));
  return dedupe(names);
}

/**
 * Return the receiver type name for a method_declaration, ignoring
 * pointer-vs-value distinction. `func (r *Foo) M()` and `func (r Foo) M()`
 * both return "Foo".
 */
function receiverTypeOf(methodNode) {
  // First parameter_list is the receiver — walk for pointer_type or type_identifier.
  for (let i = 0; i < methodNode.namedChildCount; i += 1) {
    const child = methodNode.namedChild(i);
    if (child.type !== "parameter_list") continue;
    for (let j = 0; j < child.namedChildCount; j += 1) {
      const param = child.namedChild(j);
      if (param.type !== "parameter_declaration") continue;
      for (let k = 0; k < param.namedChildCount; k += 1) {
        const typeNode = param.namedChild(k);
        if (typeNode.type === "pointer_type") {
          for (let m = 0; m < typeNode.namedChildCount; m += 1) {
            const inner = typeNode.namedChild(m);
            if (inner.type === "type_identifier") return inner.text;
          }
        }
        if (typeNode.type === "type_identifier") return typeNode.text;
        // generic receivers look like generic_type with inner type_identifier
        if (typeNode.type === "generic_type") {
          for (let m = 0; m < typeNode.namedChildCount; m += 1) {
            const inner = typeNode.namedChild(m);
            if (inner.type === "type_identifier") return inner.text;
          }
        }
      }
    }
    break;
  }
  return "";
}

/**
 * Classify a type_declaration's kind. Inspects the body of the type_spec
 * (or type_alias) child to decide: struct, interface, or generic "type".
 */
function typeKindOf(declNode) {
  for (let i = 0; i < declNode.namedChildCount; i += 1) {
    const spec = declNode.namedChild(i);
    if (spec.type !== "type_spec" && spec.type !== "type_alias") continue;
    for (let j = 0; j < spec.namedChildCount; j += 1) {
      const child = spec.namedChild(j);
      if (child.type === "struct_type") return "struct";
      if (child.type === "interface_type") return "interface";
    }
  }
  return "type";
}

function buildFunctionChunk(node, imports, language) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;
  const name = nameNode.text;
  const { startLine, endLine } = lineRangeOf(node);
  return {
    name,
    kind: "function",
    signature: signatureOfDecl(node),
    body: bodyOf(node),
    startLine,
    endLine,
    language,
    exported: isExported(name),
    calls: collectCallsInNode(node),
    imports
  };
}

function buildMethodChunk(node, imports, language) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;
  const methodName = nameNode.text;
  const receiver = receiverTypeOf(node);
  const qualifiedName = receiver ? `${receiver}.${methodName}` : methodName;
  const { startLine, endLine } = lineRangeOf(node);
  return {
    name: qualifiedName,
    kind: "method",
    signature: signatureOfDecl(node),
    body: bodyOf(node),
    startLine,
    endLine,
    language,
    exported: isExported(methodName),
    calls: collectCallsInNode(node),
    imports
  };
}

function buildTypeChunk(node, nameNode, language) {
  const name = nameNode.text;
  const kind = typeKindOf(node);
  const { startLine, endLine } = lineRangeOf(node);
  return {
    name,
    kind,
    signature: signatureOfDecl(node),
    body: bodyOf(node),
    startLine,
    endLine,
    language,
    exported: isExported(name),
    calls: [],
    imports: []
  };
}

export async function parseCode(code, filePath, language = "go") {
  return (await parseInternal(code, filePath, language)).parserResult;
}

async function parseInternal(code, filePath, language) {
  await ensureLanguage();
  const { tree, reason } = parseSource(GO_LANG, code);
  if (!tree) return { tree: null, parserResult: { chunks: [], errors: [{ message: reason }] } };
  const root = tree.rootNode;
  const imports = collectImports(root);

  const captures = runQuery(GO_LANG, CHUNK_QUERY, root);
  const declCaptures = captures.filter((c) => c.name.endsWith(".decl"));

  const nameCaptures = captures.filter((c) => c.name.endsWith(".name"));

  const chunks = [];
  for (const cap of declCaptures) {
    const kind = cap.name.split(".")[0];
    if (kind === "fn") {
      const chunk = buildFunctionChunk(cap.node, imports, language);
      if (chunk) chunks.push(chunk);
    } else if (kind === "method") {
      const chunk = buildMethodChunk(cap.node, imports, language);
      if (chunk) chunks.push(chunk);
    } else if (kind === "type") {
      let nameNode = null;
      let smallest = Infinity;
      for (const nc of nameCaptures) {
        if (nc.name !== "type.name") continue;
        if (nc.node.startIndex < cap.node.startIndex) continue;
        if (nc.node.endIndex > cap.node.endIndex) continue;
        const size = nc.node.endIndex - nc.node.startIndex;
        if (size < smallest) {
          smallest = size;
          nameNode = nc.node;
        }
      }
      if (!nameNode) continue;
      const chunk = buildTypeChunk(cap.node, nameNode, language);
      if (chunk) chunks.push(chunk);
    }
  }

  const seen = new Set();
  const deduped = chunks.filter((chunk) => {
    const key = `${chunk.kind}|${chunk.name}|${chunk.startLine}|${chunk.endLine}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { tree, parserResult: { chunks: deduped, errors: collectErrors(tree) } };
}

export async function parseCodeWithDialectObservations(code, repositoryPath, language = "go") {
  const metadata = prepareDialectAdapterInput(code, repositoryPath, language, ["go"]);
  let parsed;
  try {
    parsed = await parseInternal(code, repositoryPath, language);
  } catch {
    return treeSitterUnavailableTransport(metadata.oversized ? "oversized" : "unavailable");
  }
  const { tree, parserResult } = parsed;
  const classifyNode = createDialectClassifier(tree?.rootNode ?? null, repositoryPath);
  const observationEnvelope = treeSitterDialectObservationEnvelope({
    code,
    repositoryPath,
    family: metadata.family,
    syntaxMode: metadata.syntaxMode,
    rootNode: tree?.rootNode ?? null,
    parserResult,
    classifyNode
  });
  return createDialectObservationTransport(parserResult, observationEnvelope);
}

function createDialectClassifier(rootNode, repositoryPath) {
  const testingQualifier = resolvedTestingQualifier(rootNode);
  const testFile = /(?:^|\/)[^/]+_test\.go$/.test(repositoryPath);
  return (node) => classifyDialectNode(node, {
    testingQualifier,
    testFile
  });
}

function classifyDialectNode(node, context) {
  const facts = commonTreeSitterDialectFacts(node);
  if (["type_spec", "type_alias"].includes(node.type)) facts.push({ category: "declaration_structure", kind: "type", form: "declaration" });
  if (node.type === "method_declaration") facts.push({ category: "declaration_structure", kind: "method", form: "declaration" });
  if (node.type === "function_declaration" && context.testFile && context.testingQualifier && isGoTestFunction(node, context.testingQualifier)) {
    facts.push({ category: "test_shape", kind: "test_declaration", form: "declaration" });
  }
  return facts;
}

function isGoTestFunction(node, testingQualifier) {
  const name = node.childForFieldName("name")?.text ?? "";
  if (!/^Test[^a-z]/.test(name)) return false;
  const parameters = node.childForFieldName("parameters");
  if (!parameters || parameters.namedChildCount !== 1) return false;
  const parameter = parameters.namedChild(0);
  const type = parameter?.childForFieldName("type");
  const qualified = type?.type === "pointer_type" ? type.namedChild(0) : null;
  return qualified?.type === "qualified_type" &&
    qualified.childForFieldName("package")?.text === testingQualifier &&
    qualified.childForFieldName("name")?.text === "T";
}

function resolvedTestingQualifier(rootNode) {
  const testingQualifiers = [];
  const competingQualifiers = new Set();
  visitTree(rootNode, (node) => {
    if (node.type !== "import_spec") return;
    const importPath = goImportPath(node);
    const qualifier = goImportQualifier(node, importPath);
    if (!qualifier) return;
    if (importPath === "testing") testingQualifiers.push(qualifier);
    else competingQualifiers.add(qualifier);
  });
  if (testingQualifiers.length !== 1) return null;
  const [testingQualifier] = testingQualifiers;
  return competingQualifiers.has(testingQualifier) ? null : testingQualifier;
}

function goImportQualifier(node, importPath) {
  const name = node.childForFieldName("name");
  if (name) {
    return name.type === "package_identifier" && name.text !== "_" && name.text !== "."
      ? name.text
      : null;
  }
  const pathTail = importPath?.split("/").at(-1) ?? "";
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(pathTail) ? pathTail : null;
}

function goImportPath(node) {
  const pathNode = node.childForFieldName("path");
  return pathNode ? unquoteStringLiteral(pathNode.text) : null;
}

function visitTree(rootNode, visit) {
  if (!rootNode) return;
  const stack = [rootNode];
  while (stack.length > 0) {
    const node = stack.pop();
    visit(node);
    for (let index = 0; index < node.namedChildCount; index += 1) stack.push(node.namedChild(index));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: go-treesitter.mjs <file.go>");
    process.exit(1);
  }
  const code = fs.readFileSync(target, "utf8");
  const result = await parseCode(code, target, "go");
  console.log(JSON.stringify(result, null, 2));
}
