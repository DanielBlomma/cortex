#!/usr/bin/env node
/**
 * JavaScript/TypeScript AST Parser for Cortex
 * Extracts functions, methods, classes and call relationships
 */

import { Parser } from "acorn";
import tsPlugin from "acorn-typescript";
import { simple as walkSimple, base } from "acorn-walk";

// Extend acorn-walk to handle TypeScript AST nodes
const tsNodeHandlers = {
  TSAsExpression(node, st, c) { c(node.expression, st); },
  TSTypeAnnotation(node, st, c) { /* skip type annotations */ },
  TSTypeParameterInstantiation(node, st, c) { /* skip */ },
  TSTypeParameterDeclaration(node, st, c) { /* skip */ },
  TSTypeReference(node, st, c) { /* skip */ },
  TSInterfaceDeclaration(node, st, c) { /* skip */ },
  TSTypeAliasDeclaration(node, st, c) { /* skip */ },
  TSEnumDeclaration(node, st, c) { /* skip */ },
  TSModuleDeclaration(node, st, c) { /* skip */ },
  TSDeclareFunction(node, st, c) { /* skip */ },
  TSPropertySignature(node, st, c) { /* skip */ },
  TSMethodSignature(node, st, c) { /* skip */ },
  TSIndexSignature(node, st, c) { /* skip */ },
  TSTypeLiteral(node, st, c) { /* skip */ },
  TSUnionType(node, st, c) { /* skip */ },
  TSIntersectionType(node, st, c) { /* skip */ },
  TSArrayType(node, st, c) { /* skip */ },
  TSTupleType(node, st, c) { /* skip */ },
  TSOptionalType(node, st, c) { /* skip */ },
  TSRestType(node, st, c) { /* skip */ },
  TSFunctionType(node, st, c) { /* skip */ },
  TSConstructorType(node, st, c) { /* skip */ },
  TSNonNullExpression(node, st, c) { c(node.expression, st); },
  TSInstantiationExpression(node, st, c) { c(node.expression, st); },
};

Object.assign(base, tsNodeHandlers);

const CHUNK_KINDS = new Set(["function", "method", "class", "const", "let", "var"]);

/**
 * Parse JavaScript/TypeScript code and extract chunks + calls
 * @param {string} code - Source code
 * @param {string} filePath - File path (for error context)
 * @param {string} language - "javascript" | "typescript" | "jsx" | "tsx"
 * @returns {Object} { chunks: Array, errors: Array }
 */
export function parseCode(code, filePath, language = "javascript") {
  const chunks = [];
  const errors = [];
  const lines = code.split(/\r?\n/);

  let ast;
  try {
    const TSParser = Parser.extend(tsPlugin());
    ast = TSParser.parse(code, {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: true,
      allowHashBang: true,
      allowImportExportEverywhere: true,
      allowAwaitOutsideFunction: true
    });
  } catch (error) {
    errors.push({
      message: `Parse error: ${error.message}`,
      line: error.loc?.line,
      column: error.loc?.column
    });
    return { chunks: [], errors };
  }

  // Extract top-level declarations
  walkSimple(ast, {
    FunctionDeclaration(node) {
      if (!node.id) return; // Skip anonymous
      
      const chunk = extractFunctionChunk(node, "function", lines, code);
      if (chunk) {
        chunk.language = language;
        chunks.push(chunk);
      }
    },

    ClassDeclaration(node) {
      if (!node.id) return;
      
      const chunk = extractClassChunk(node, lines, code);
      if (chunk) {
        chunk.language = language;
        chunks.push(chunk);
        
        // Extract methods as sub-chunks
        for (const method of extractClassMethods(node, lines, code)) {
          method.language = language;
          method.parentChunk = chunk.name;
          chunks.push(method);
        }
      }
    },

    VariableDeclaration(node) {
      // Extract arrow functions and function expressions assigned to variables
      for (const declarator of node.declarations) {
        if (!declarator.id || declarator.id.type !== "Identifier") continue;
        if (!declarator.init) continue;
        
        const isFunctionExpr = 
          declarator.init.type === "FunctionExpression" ||
          declarator.init.type === "ArrowFunctionExpression";
        
        if (isFunctionExpr) {
          const chunk = extractFunctionChunk(
            declarator.init,
            "const",
            lines,
            code,
            declarator.id.name
          );
          if (chunk) {
            chunk.language = language;
            chunks.push(chunk);
          }
        }
      }
    },

    ExportNamedDeclaration(node) {
      // Handle export function/class
      if (node.declaration) {
        if (node.declaration.type === "FunctionDeclaration") {
          const chunk = extractFunctionChunk(node.declaration, "function", lines, code);
          if (chunk) {
            chunk.exported = true;
            chunk.language = language;
            chunks.push(chunk);
          }
        } else if (node.declaration.type === "ClassDeclaration") {
          const chunk = extractClassChunk(node.declaration, lines, code);
          if (chunk) {
            chunk.exported = true;
            chunk.language = language;
            chunks.push(chunk);
            
            for (const method of extractClassMethods(node.declaration, lines, code)) {
              method.language = language;
              method.parentChunk = chunk.name;
              chunks.push(method);
            }
          }
        }
      }
    },

    ExportDefaultDeclaration(node) {
      if (node.declaration.type === "FunctionDeclaration") {
        const chunk = extractFunctionChunk(node.declaration, "function", lines, code);
        if (chunk) {
          chunk.exported = true;
          chunk.default = true;
          chunk.language = language;
          chunks.push(chunk);
        }
      } else if (node.declaration.type === "ClassDeclaration") {
        const chunk = extractClassChunk(node.declaration, lines, code);
        if (chunk) {
          chunk.exported = true;
          chunk.default = true;
          chunk.language = language;
          chunks.push(chunk);
          
          for (const method of extractClassMethods(node.declaration, lines, code)) {
            method.language = language;
            method.parentChunk = chunk.name;
            chunks.push(method);
          }
        }
      }
    }
  });

  // Extract calls for each chunk
  for (const chunk of chunks) {
    chunk.calls = extractCalls(chunk.bodyNode, code);
    chunk.imports = extractImports(ast);
    delete chunk.bodyNode; // Remove AST node (not serializable)
  }

  return { chunks, errors };
}

function extractFunctionChunk(node, kind, lines, code, nameOverride = null) {
  const name = nameOverride || node.id?.name;
  if (!name) return null;

  const startLine = node.loc.start.line;
  const endLine = node.loc.end.line;
  const body = code.slice(node.start, node.end);
  
  const params = node.params.map(param => {
    if (param.type === "Identifier") return param.name;
    if (param.type === "RestElement") return `...${param.argument.name}`;
    return "_"; // Complex patterns
  });

  const signature = `${name}(${params.join(", ")})`;

  return {
    name,
    kind,
    signature,
    body,
    startLine,
    endLine,
    bodyNode: node.body || node, // Keep AST for call extraction
    async: node.async === true,
    generator: node.generator === true
  };
}

function extractClassChunk(node, lines, code) {
  const name = node.id?.name;
  if (!name) return null;

  const startLine = node.loc.start.line;
  const endLine = node.loc.end.line;
  const body = code.slice(node.start, node.end);
  
  const superClass = node.superClass?.name || null;
  const signature = superClass ? `class ${name} extends ${superClass}` : `class ${name}`;

  return {
    name,
    kind: "class",
    signature,
    body,
    startLine,
    endLine,
    bodyNode: node.body,
    superClass
  };
}

function extractClassMethods(classNode, lines, code) {
  const methods = [];
  const className = classNode.id?.name || "UnknownClass";

  for (const member of classNode.body.body) {
    if (member.type !== "MethodDefinition") continue;
    if (member.key.type !== "Identifier") continue;

    const methodName = member.key.name;
    const fullName = `${className}.${methodName}`;
    
    const startLine = member.loc.start.line;
    const endLine = member.loc.end.line;
    const body = code.slice(member.start, member.end);
    
    const params = member.value.params.map(param => {
      if (param.type === "Identifier") return param.name;
      if (param.type === "RestElement") return `...${param.argument.name}`;
      return "_";
    });

    const isStatic = member.static === true;
    const prefix = isStatic ? "static " : "";
    const signature = `${prefix}${methodName}(${params.join(", ")})`;

    methods.push({
      name: fullName,
      kind: "method",
      signature,
      body,
      startLine,
      endLine,
      bodyNode: member.value.body,
      static: isStatic,
      async: member.value.async === true,
      generator: member.value.generator === true
    });
  }

  return methods;
}

function extractCalls(bodyNode, code) {
  if (!bodyNode) return [];
  
  const calls = new Set();

  try {
    walkSimple(bodyNode, {
      CallExpression(node) {
        const callee = node.callee;
        
        // Direct function call: foo()
        if (callee.type === "Identifier") {
          calls.add(callee.name);
        }
        
        // Method call: obj.method()
        else if (callee.type === "MemberExpression") {
          if (callee.property.type === "Identifier") {
            const objName = getObjectName(callee.object);
            if (objName) {
              calls.add(`${objName}.${callee.property.name}`);
            } else {
              calls.add(callee.property.name);
            }
          }
        }
      }
    });
  } catch (error) {
    // Ignore walk errors (incomplete AST)
  }

  return Array.from(calls).sort();
}

function getObjectName(node) {
  if (node.type === "Identifier") {
    return node.name;
  }
  if (node.type === "ThisExpression") {
    return "this";
  }
  if (node.type === "MemberExpression" && node.property.type === "Identifier") {
    return node.property.name;
  }
  return null;
}

function extractImports(ast) {
  const imports = [];

  walkSimple(ast, {
    ImportDeclaration(node) {
      if (node.source && node.source.type === "Literal") {
        imports.push(node.source.value);
      }
    },
    
    CallExpression(node) {
      // Dynamic imports: import('module')
      if (node.callee.type === "Import" && node.arguments[0]?.type === "Literal") {
        imports.push(node.arguments[0].value);
      }
      
      // Require: require('module')
      if (node.callee.type === "Identifier" && node.callee.name === "require") {
        if (node.arguments[0]?.type === "Literal") {
          imports.push(node.arguments[0].value);
        }
      }
    }
  });

  return Array.from(new Set(imports)).sort();
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
