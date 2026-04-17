#!/usr/bin/env node
/**
 * JavaScript/TypeScript AST Parser for Cortex
 * Extracts functions, methods, classes and call relationships
 */

import { parseAst } from "./javascript/ast.mjs";
import { discoverChunks } from "./javascript/chunks.mjs";
import { extractCalls } from "./javascript/calls.mjs";
import { collectStaticImports, extractImportsForChunk } from "./javascript/imports.mjs";

/**
 * Parse JavaScript/TypeScript code and extract chunks + calls
 * @param {string} code - Source code
 * @param {string} filePath - File path (for error context)
 * @param {string} language - "javascript" | "typescript" | "jsx" | "tsx"
 * @returns {Object} { chunks: Array, errors: Array }
 */
export function parseCode(code, filePath, language = "javascript") {
  const { ast, errors } = parseAst(code, filePath);
  if (!ast) {
    return { chunks: [], errors };
  }

  const staticImports = collectStaticImports(ast);
  const chunks = discoverChunks(ast, code, language);

  for (const chunk of chunks) {
    chunk.calls = extractCalls(chunk.callNode);
    chunk.imports = extractImportsForChunk(chunk.importNode, staticImports);
    delete chunk.callNode;
    delete chunk.importNode;
  }

  return { chunks, errors };
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
