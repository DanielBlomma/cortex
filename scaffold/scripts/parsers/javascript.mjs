#!/usr/bin/env node
/**
 * JavaScript/TypeScript AST Parser for Cortex
 * Extracts functions, methods, classes and call relationships
 */

import { parseAst, walkAst } from "./javascript/ast.mjs";
import { discoverChunks } from "./javascript/chunks.mjs";
import { extractCalls } from "./javascript/calls.mjs";
import { collectStaticImports, extractImportsForChunk } from "./javascript/imports.mjs";
import { buildScopeGraph, resolveIdentifier } from "./javascript/scope-analysis.mjs";
import {
  DIALECT_LIMITS,
  canonicalDialectLanguageSpecificShape,
  canonicalDialectNormalizedShape,
  canonicalRepositoryPath,
  canonicalizeDialectObservations,
  createDialectObservationTransport,
  dialectFamilyForMode,
  stableDialectObservationId
} from "../lib/dialect-observation-contract.mjs";

/**
 * Parse JavaScript/TypeScript code and extract chunks + calls
 * @param {string} code - Source code
 * @param {string} filePath - File path (for error context)
 * @param {string} language - "javascript" | "typescript" | "jsx" | "tsx"
 * @returns {Object} { chunks: Array, errors: Array }
 */
export function parseCode(code, filePath, language = "javascript") {
  return parseInternal(code, filePath, language).parserResult;
}

function parseInternal(code, filePath, language) {
  const { ast, errors } = parseAst(code, filePath);
  if (!ast) {
    return { ast: null, parserResult: { chunks: [], errors } };
  }

  const staticImports = collectStaticImports(ast);
  const chunks = discoverChunks(ast, code, language);

  for (const chunk of chunks) {
    chunk.calls = extractCalls(chunk.callNode);
    chunk.imports = extractImportsForChunk(chunk.importNode, staticImports);
    delete chunk.callNode;
    delete chunk.importNode;
  }

  return { ast, parserResult: { chunks, errors } };
}

export function parseCodeWithDialectObservations(code, repositoryPath, language = "javascript") {
  const metadata = prepareDialectInput(code, repositoryPath, language);
  const { ast, parserResult } = parseInternal(code, repositoryPath, language);
  let observationEnvelope;
  if (metadata.oversized) {
    observationEnvelope = statusEnvelope("oversized", "source exceeds dialect observation byte cap");
  } else if (!ast || parserResult.errors.length > 0) {
    observationEnvelope = statusEnvelope("malformed", "native parser reported syntax errors");
  } else {
    observationEnvelope = collectDialectObservations(code, repositoryPath, metadata, ast);
  }
  return createDialectObservationTransport(parserResult, observationEnvelope);
}

function prepareDialectInput(code, repositoryPath, language) {
  if (typeof code !== "string") throw new TypeError("Dialect adapter: code must be a string");
  canonicalRepositoryPath(repositoryPath);
  if (typeof language !== "string") throw new TypeError("Dialect adapter: language must be a string");
  const separator = repositoryPath.lastIndexOf("/");
  const dot = repositoryPath.lastIndexOf(".");
  const syntaxMode = dot > separator ? repositoryPath.slice(dot) : "";
  const family = dialectFamilyForMode(syntaxMode);
  const mode = family?.modes.find((entry) => entry.extension === syntaxMode);
  if (!family || !["javascript", "typescript"].includes(family.family) || mode?.registry_language !== language) {
    throw new TypeError(`Dialect adapter: unsupported parser mode ${language}/${syntaxMode || "<none>"}`);
  }
  return {
    family: family.family,
    syntaxMode,
    parserBackend: family.family === "typescript" ? "acorn-typescript" : "acorn",
    oversized: Buffer.byteLength(code) > DIALECT_LIMITS.max_source_bytes
  };
}

function collectDialectObservations(code, repositoryPath, metadata, ast) {
  const positions = sourcePositions(code);
  const observations = [];
  const testBindings = collectTestBindings(ast);
  const scopeGraph = buildScopeGraph(ast);
  walkAst(ast, (node, parent, key, index, ancestors) => {
    if (!Number.isSafeInteger(node.start) || !Number.isSafeInteger(node.end) || node.end <= node.start) return;
    const span = inclusiveSpan(positions, code.length, node.start, node.end);
    if (!span) return;
    for (const fact of classifyDialectNode(node, parent, key, { testBindings, scopeGraph, ancestors })) {
      const observation = {
        schema_version: 1,
        family: metadata.family,
        syntax_mode: metadata.syntaxMode,
        parser_backend: metadata.parserBackend,
        repository_path: repositoryPath,
        containing_chunk_id: null,
        start_line: span.startLine,
        start_column: span.startColumn,
        end_line: span.endLine,
        end_column: span.endColumn,
        category: fact.category,
        normalized_shape: canonicalDialectNormalizedShape(fact.category, fact.kind),
        language_specific_shape: canonicalDialectLanguageSpecificShape(fact.form, node.type),
        ordinal: null,
        observation_id: ""
      };
      observation.observation_id = stableDialectObservationId(observation);
      observations.push(observation);
    }
  });
  if (observations.length > DIALECT_LIMITS.max_observations_per_file) {
    return statusEnvelope(
      "truncated",
      "dialect observation file cap exceeded",
      observations.length,
      observations.length
    );
  }
  return statusEnvelope("ok", null, observations.length, 0, canonicalizeDialectObservations(observations));
}

function classifyDialectNode(node, parent, key, testContext) {
  const facts = [];
  const declarationKinds = new Map([
    ["Program", "module"],
    ["FunctionDeclaration", "function"],
    ["FunctionExpression", "function"],
    ["ArrowFunctionExpression", "function"],
    ["MethodDefinition", node.kind === "constructor" ? "constructor" : "method"],
    ["PropertyDefinition", "field"],
    ["ClassDeclaration", "type"],
    ["ClassExpression", "type"],
    ["TSInterfaceDeclaration", "type"],
    ["TSTypeAliasDeclaration", "type"],
    ["TSEnumDeclaration", "type"],
    ["TSModuleDeclaration", "namespace"],
    ["TSPropertySignature", "property"],
    ["TSMethodSignature", "method"]
  ]);
  const declarationKind = declarationKinds.get(node.type);
  if (declarationKind) facts.push({ category: "declaration_structure", kind: declarationKind, form: "declaration" });
  if (key === "params" && parent && [
    "FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression",
    "TSDeclareFunction", "TSFunctionType", "TSConstructorType", "TSMethodSignature"
  ].includes(parent.type)) {
    facts.push({ category: "declaration_structure", kind: "parameter", form: "declaration" });
    facts.push({ category: "data_representation", kind: "parameter", form: "pattern" });
  }

  if (["IfStatement", "SwitchStatement", "SwitchCase", "ConditionalExpression"].includes(node.type)) {
    facts.push({ category: "control_flow", kind: "branch", form: node.type === "ConditionalExpression" ? "expression" : "statement" });
  }
  if (["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"].includes(node.type)) {
    facts.push({ category: "control_flow", kind: "loop", form: "statement" });
  }

  if (node.type === "ThrowStatement") facts.push({ category: "error_flow", kind: "raise", form: "statement" });
  if (["TryStatement", "CatchClause"].includes(node.type)) facts.push({ category: "error_flow", kind: "handler", form: node.type === "CatchClause" ? "clause" : "statement" });

  if (["ObjectExpression", "ObjectPattern", "TSTypeLiteral"].includes(node.type)) {
    facts.push({ category: "data_representation", kind: "record", form: node.type === "ObjectPattern" ? "pattern" : "expression" });
  }
  if (["ArrayExpression", "ArrayPattern", "TSArrayType", "TSTupleType"].includes(node.type)) {
    facts.push({ category: "data_representation", kind: "container", form: node.type === "ArrayPattern" ? "pattern" : "expression" });
  }
  if (["PropertyDefinition", "TSPropertySignature"].includes(node.type)) facts.push({ category: "data_representation", kind: "field", form: "declaration" });
  if (["VariableDeclaration", "VariableDeclarator"].includes(node.type)) facts.push({ category: "data_representation", kind: "state", form: "declaration" });
  if (node.type === "ReturnStatement" || (node.type === "TSTypeAnnotation" && key === "returnType")) {
    facts.push({ category: "data_representation", kind: "return", form: node.type === "ReturnStatement" ? "statement" : "annotation" });
  }
  if (["TSUnionType", "TSEnumMember"].includes(node.type)) facts.push({ category: "data_representation", kind: "variant", form: "declaration" });

  if (node.type === "CallExpression") {
    const binding = resolvedTestBinding(node.callee, testContext);
    if (binding) facts.push({ category: "test_shape", kind: binding, form: "expression" });
  }
  return facts;
}

function collectTestBindings(ast) {
  const bindings = new Map();
  for (const node of ast.body ?? []) {
    if (node.type !== "ImportDeclaration" || typeof node.source?.value !== "string") continue;
    if (node.importKind === "type") continue;
    const source = node.source.value;
    if (source === "node:test") {
      for (const specifier of node.specifiers ?? []) {
        if (specifier.importKind === "type") continue;
        const local = specifier.local?.name;
        if (!local) continue;
        if (specifier.type === "ImportNamespaceSpecifier") {
          bindings.set(local, { source: "node:test", form: "namespace", directKind: null });
          continue;
        }
        const imported = specifier.type === "ImportSpecifier" ? specifier.imported?.name : "test";
        const directKind = testBindingKind(imported);
        if (directKind) bindings.set(local, { source: "node:test", form: "callable", directKind });
      }
    }
    if (["node:assert", "node:assert/strict"].includes(source)) {
      for (const specifier of node.specifiers ?? []) {
        if (specifier.importKind === "type") continue;
        const local = specifier.local?.name;
        if (!local) continue;
        if (specifier.type === "ImportNamespaceSpecifier") {
          bindings.set(local, { source: "node:assert", form: "namespace", directKind: null });
        } else if (specifier.type === "ImportDefaultSpecifier") {
          bindings.set(local, { source: "node:assert", form: "default", directKind: "assertion" });
        } else if (ASSERT_CALLABLES.has(specifier.imported?.name)) {
          bindings.set(local, { source: "node:assert", form: "callable", directKind: "assertion" });
        }
      }
    }
  }
  return bindings;
}

const ASSERT_CALLABLES = new Set([
  "deepEqual", "deepStrictEqual", "doesNotMatch", "doesNotReject", "doesNotThrow",
  "equal", "fail", "ifError", "match", "notDeepEqual", "notDeepStrictEqual",
  "notEqual", "notStrictEqual", "ok", "partialDeepStrictEqual", "rejects", "strict",
  "strictEqual", "throws"
]);

function testBindingKind(name) {
  if (["test", "it"].includes(name)) return "test_declaration";
  if (["describe", "suite"].includes(name)) return "suite";
  if (["before", "beforeEach", "beforeAll"].includes(name)) return "setup";
  if (["after", "afterEach", "afterAll"].includes(name)) return "teardown";
  return null;
}

function resolvedTestBinding(callee, context) {
  if (callee?.type === "Identifier") {
    return resolvedImportBinding(callee, context)?.directKind ?? null;
  }
  if (callee?.type !== "MemberExpression" || callee.computed || callee.object?.type !== "Identifier") return null;
  const binding = resolvedImportBinding(callee.object, {
    ...context,
    ancestors: [...context.ancestors, callee, callee.object]
  });
  if (!binding) return null;
  const member = callee.property?.type === "Identifier" ? callee.property.name : null;
  if (binding.source === "node:assert" && ASSERT_CALLABLES.has(member)) return "assertion";
  if (binding.source === "node:test" && binding.form === "namespace") return testBindingKind(member);
  if (binding.source === "node:test" && binding.form === "callable" && ["only", "skip", "todo"].includes(member)) {
    return "test_declaration";
  }
  return null;
}

function resolvedImportBinding(identifier, context) {
  const binding = context.testBindings.get(identifier.name);
  if (!binding) return null;
  const ancestors = context.ancestors.at(-1) === identifier
    ? context.ancestors
    : [...context.ancestors, identifier];
  return resolveIdentifier(identifier.name, ancestors, context.scopeGraph) ? null : binding;
}

function statusEnvelope(status, message, observedCount = 0, omittedCount = 0, observations = []) {
  return {
    schema_version: 1,
    status,
    observations,
    diagnostics: {
      message: status === "ok" ? null : message,
      observed_count: observedCount,
      omitted_count: omittedCount
    }
  };
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
  if (startOffset < 0 || endOffset > sourceLength || endOffset <= startOffset) return null;
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

// CLI interface for testing
if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import("node:fs");
  const filePath = process.argv[2];
  
  if (!filePath) {
    console.error("Usage: javascript.mjs <file.js>");
    process.exit(1);
  }

  const code = fs.readFileSync(filePath, "utf8");
  const result = parseCode(code, filePath, "javascript");
  
  console.log(JSON.stringify(result, null, 2));
}
