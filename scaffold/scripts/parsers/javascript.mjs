#!/usr/bin/env node
/**
 * JavaScript/TypeScript AST Parser for Cortex
 * Extracts functions, methods, classes and call relationships
 */

import { Parser } from "acorn";
import tsPlugin from "acorn-typescript";
import { simple as walkSimple, base, fullAncestor, recursive } from "acorn-walk";

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

  const staticImports = collectStaticImports(ast);

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

  // Deduplicate chunks by name+startLine (exports can cause double extraction)
  const seenChunks = new Map();
  for (const chunk of chunks) {
    const key = `${chunk.name}:${chunk.startLine}`;
    const existing = seenChunks.get(key);
    // Prefer exported version over non-exported
    if (!existing || chunk.exported) {
      seenChunks.set(key, chunk);
    }
  }
  const uniqueChunks = [...seenChunks.values()];

  // Extract calls for each chunk
  for (const chunk of uniqueChunks) {
    chunk.calls = extractCalls(chunk.callNode, code);
    chunk.imports = extractImportsForChunk(chunk.importNode, staticImports);
    delete chunk.callNode; // Remove AST nodes (not serializable)
    delete chunk.importNode;
  }

  return { chunks: uniqueChunks, errors };
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
    callNode: node.body || node, // Keep AST for call extraction
    importNode: node, // Include declaration headers for import extraction
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
    callNode: node.body,
    importNode: node,
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
      callNode: member.value.body,
      importNode: member,
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

function collectStaticImports(ast) {
  const bindings = [];
  const sideEffectImports = new Set();

  for (const node of ast.body || []) {
    if (node.type === "ImportDeclaration") {
      if (node.source && node.source.type === "Literal" && typeof node.source.value === "string") {
        if ((node.specifiers || []).length === 0) {
          sideEffectImports.add(node.source.value);
        }
        for (const specifier of node.specifiers || []) {
          if (specifier.local?.type === "Identifier") {
            bindings.push({
              localName: specifier.local.name,
              source: node.source.value
            });
          }
        }
      }
      continue;
    }

    if (node.type === "VariableDeclaration") {
      for (const declarator of node.declarations || []) {
        const source = getStaticRequireImportSource(declarator.init);
        if (!source) {
          continue;
        }
        collectPatternIdentifiers(declarator.id, (localName) => {
          bindings.push({ localName, source });
        });
      }
      continue;
    }

    if (node.type === "ExpressionStatement") {
      const source = getStaticRequireImportSource(node.expression);
      if (source) {
        sideEffectImports.add(source);
      }
    }
  }

  return {
    bindings,
    sideEffectImports: Array.from(sideEffectImports).sort()
  };
}

function getStaticRequireImportSource(node) {
  if (
    node?.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "require" &&
    node.arguments[0]?.type === "Literal" &&
    typeof node.arguments[0].value === "string"
  ) {
    return node.arguments[0].value;
  }

  return null;
}

function isFunctionScopeNode(node) {
  return Boolean(
    node &&
    (node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression")
  );
}

function currentScope(scopeStack) {
  return scopeStack[scopeStack.length - 1] ?? null;
}

function nearestVarScope(scopeStack) {
  for (let index = scopeStack.length - 1; index >= 0; index -= 1) {
    const scopeNode = scopeStack[index];
    if (isFunctionScopeNode(scopeNode) || index === 0) {
      return scopeNode;
    }
  }
  return null;
}

function declareIdentifier(scopeDeclarations, scopeNode, name) {
  if (!scopeNode || !name) {
    return;
  }

  const declarations = scopeDeclarations.get(scopeNode) ?? new Set();
  declarations.add(name);
  scopeDeclarations.set(scopeNode, declarations);
}

function collectPatternIdentifiers(pattern, visit) {
  if (!pattern) {
    return;
  }

  switch (pattern.type) {
    case "Identifier":
      visit(pattern.name);
      break;
    case "AssignmentPattern":
      collectPatternIdentifiers(pattern.left, visit);
      break;
    case "ArrayPattern":
      for (const element of pattern.elements || []) {
        if (element) {
          collectPatternIdentifiers(element, visit);
        }
      }
      break;
    case "ObjectPattern":
      for (const property of pattern.properties || []) {
        if (!property) {
          continue;
        }
        if (property.type === "Property") {
          collectPatternIdentifiers(property.value, visit);
        } else if (property.type === "RestElement") {
          collectPatternIdentifiers(property.argument, visit);
        }
      }
      break;
    case "RestElement":
      collectPatternIdentifiers(pattern.argument, visit);
      break;
    default:
      break;
  }
}

function declarePattern(scopeDeclarations, scopeNode, pattern) {
  collectPatternIdentifiers(pattern, (name) => {
    declareIdentifier(scopeDeclarations, scopeNode, name);
  });
}

function walkPatternExpressions(pattern, visit) {
  if (!pattern) {
    return;
  }

  switch (pattern.type) {
    case "AssignmentPattern":
      walkPatternExpressions(pattern.left, visit);
      if (pattern.right) {
        visit(pattern.right);
      }
      break;
    case "ArrayPattern":
      for (const element of pattern.elements || []) {
        if (element) {
          walkPatternExpressions(element, visit);
        }
      }
      break;
    case "ObjectPattern":
      for (const property of pattern.properties || []) {
        if (!property) {
          continue;
        }
        if (property.type === "Property") {
          if (property.computed) {
            visit(property.key);
          }
          walkPatternExpressions(property.value, visit);
        } else if (property.type === "RestElement") {
          walkPatternExpressions(property.argument, visit);
        }
      }
      break;
    case "RestElement":
      walkPatternExpressions(pattern.argument, visit);
      break;
    default:
      break;
  }
}

function withScope(scopeStack, scopeNode, visit) {
  scopeStack.push(scopeNode);
  try {
    visit();
  } finally {
    scopeStack.pop();
  }
}

function buildScopeDeclarations(bodyNode) {
  const scopeDeclarations = new Map();
  const scopeStack = isFunctionScopeNode(bodyNode) || bodyNode.type === "BlockStatement" ? [] : [bodyNode];

  try {
    recursive(
      bodyNode,
      null,
      {
        ImportDeclaration() {
          // Imports are module-scope and intentionally ignored for shadowing checks.
        },

        VariableDeclaration(node, state, recurse) {
          const targetScope = node.kind === "var" ? nearestVarScope(scopeStack) : currentScope(scopeStack);
          for (const declarator of node.declarations || []) {
            declarePattern(scopeDeclarations, targetScope, declarator.id);
            if (declarator.init) {
              recurse(declarator.init, state);
            }
          }
        },

        FunctionDeclaration(node, state, recurse) {
          const parentScope = currentScope(scopeStack);
          if (node.id && parentScope && parentScope !== node) {
            declareIdentifier(scopeDeclarations, parentScope, node.id.name);
          }

          withScope(scopeStack, node, () => {
            if (node.id) {
              declareIdentifier(scopeDeclarations, node, node.id.name);
            }
            for (const param of node.params || []) {
              declarePattern(scopeDeclarations, node, param);
            }
            for (const param of node.params || []) {
              walkPatternExpressions(param, (child) => recurse(child, state));
            }
            if (node.body) {
              recurse(node.body, state);
            }
          });
        },

        FunctionExpression(node, state, recurse) {
          withScope(scopeStack, node, () => {
            if (node.id) {
              declareIdentifier(scopeDeclarations, node, node.id.name);
            }
            for (const param of node.params || []) {
              declarePattern(scopeDeclarations, node, param);
            }
            for (const param of node.params || []) {
              walkPatternExpressions(param, (child) => recurse(child, state));
            }
            if (node.body) {
              recurse(node.body, state);
            }
          });
        },

        ArrowFunctionExpression(node, state, recurse) {
          withScope(scopeStack, node, () => {
            for (const param of node.params || []) {
              declarePattern(scopeDeclarations, node, param);
            }
            for (const param of node.params || []) {
              walkPatternExpressions(param, (child) => recurse(child, state));
            }
            if (node.body) {
              recurse(node.body, state);
            }
          });
        },

        ClassDeclaration(node, state, recurse) {
          const parentScope = currentScope(scopeStack);
          if (node.id && parentScope && parentScope !== node) {
            declareIdentifier(scopeDeclarations, parentScope, node.id.name);
          }

          if (node.superClass) {
            recurse(node.superClass, state);
          }

          withScope(scopeStack, node, () => {
            if (node.id) {
              declareIdentifier(scopeDeclarations, node, node.id.name);
            }
            if (node.body) {
              recurse(node.body, state);
            }
          });
        },

        ClassExpression(node, state, recurse) {
          if (node.superClass) {
            recurse(node.superClass, state);
          }

          withScope(scopeStack, node, () => {
            if (node.id) {
              declareIdentifier(scopeDeclarations, node, node.id.name);
            }
            if (node.body) {
              recurse(node.body, state);
            }
          });
        },

        BlockStatement(node, state, recurse) {
          withScope(scopeStack, node, () => {
            for (const statement of node.body || []) {
              recurse(statement, state);
            }
          });
        },

        SwitchStatement(node, state, recurse) {
          if (node.discriminant) {
            recurse(node.discriminant, state);
          }

          withScope(scopeStack, node, () => {
            for (const caseNode of node.cases || []) {
              recurse(caseNode, state);
            }
          });
        },

        ForStatement(node, state, recurse) {
          withScope(scopeStack, node, () => {
            if (node.init) {
              recurse(node.init, state);
            }
            if (node.test) {
              recurse(node.test, state);
            }
            if (node.update) {
              recurse(node.update, state);
            }
            if (node.body) {
              recurse(node.body, state);
            }
          });
        },

        ForInStatement(node, state, recurse) {
          withScope(scopeStack, node, () => {
            recurse(node.left, state);
            recurse(node.right, state);
            if (node.body) {
              recurse(node.body, state);
            }
          });
        },

        ForOfStatement(node, state, recurse) {
          withScope(scopeStack, node, () => {
            recurse(node.left, state);
            recurse(node.right, state);
            if (node.body) {
              recurse(node.body, state);
            }
          });
        },

        CatchClause(node, state, recurse) {
          withScope(scopeStack, node, () => {
            if (node.param) {
              declarePattern(scopeDeclarations, node, node.param);
              walkPatternExpressions(node.param, (child) => recurse(child, state));
            }
            if (node.body) {
              recurse(node.body, state);
            }
          });
        },

        MethodDefinition(node, state, recurse) {
          if (node.computed && node.key) {
            recurse(node.key, state);
          }
          if (node.value) {
            recurse(node.value, state);
          }
        },

        PropertyDefinition(node, state, recurse) {
          if (node.computed && node.key) {
            recurse(node.key, state);
          }
          if (node.value) {
            recurse(node.value, state);
          }
        }
      },
      base
    );
  } catch (error) {
    // Ignore walk errors (incomplete AST)
  }

  return scopeDeclarations;
}

function isReferenceIdentifier(node, ancestors) {
  const parent = ancestors[ancestors.length - 2] ?? null;
  const grandparent = ancestors[ancestors.length - 3] ?? null;

  if (!parent) {
    return true;
  }

  switch (parent.type) {
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement":
    case "MetaProperty":
      return false;
    case "VariableDeclarator":
      return parent.init === node;
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      return !parent.params.includes(node) && parent.id !== node;
    case "ClassDeclaration":
    case "ClassExpression":
      return parent.id !== node;
    case "MemberExpression":
      return parent.object === node || parent.computed;
    case "Property":
      if (grandparent?.type === "ObjectPattern") {
        return parent.computed && parent.key === node;
      }
      if (parent.shorthand && parent.value === node) {
        return true;
      }
      return parent.value === node || (parent.computed && parent.key === node);
    case "MethodDefinition":
    case "PropertyDefinition":
      return parent.computed && parent.key === node;
    case "AssignmentPattern":
      return parent.right === node;
    case "ArrayPattern":
    case "ObjectPattern":
    case "RestElement":
      return false;
    case "CatchClause":
      return parent.param !== node;
    case "ExportSpecifier":
      return parent.local === node;
    default:
      return true;
  }
}

function isShadowedIdentifier(name, ancestors, scopeDeclarations) {
  for (let index = ancestors.length - 2; index >= 0; index -= 1) {
    const declarations = scopeDeclarations.get(ancestors[index]);
    if (declarations?.has(name)) {
      return true;
    }
  }

  return false;
}

function extractReferencedStaticImportSources(bodyNode, bindings) {
  if (!bodyNode || bindings.length === 0) {
    return [];
  }

  const importsByLocalName = new Map();
  for (const binding of bindings) {
    if (!importsByLocalName.has(binding.localName)) {
      importsByLocalName.set(binding.localName, binding.source);
    }
  }

  const scopeDeclarations = buildScopeDeclarations(bodyNode);
  const sources = new Set();

  try {
    fullAncestor(bodyNode, (node, state, ancestors) => {
      if (node.type !== "Identifier") {
        return;
      }

      const source = importsByLocalName.get(node.name);
      if (!source) {
        return;
      }

      if (!isReferenceIdentifier(node, ancestors)) {
        return;
      }

      if (isShadowedIdentifier(node.name, ancestors, scopeDeclarations)) {
        return;
      }

      sources.add(source);
    }, base);
  } catch (error) {
    // Ignore walk errors (incomplete AST)
  }

  return Array.from(sources).sort();
}

function extractDynamicImports(bodyNode) {
  const imports = [];

  try {
    walkSimple(bodyNode, {
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
  } catch (error) {
    // Ignore walk errors (incomplete AST)
  }

  return Array.from(new Set(imports)).sort();
}

function extractImportsForChunk(bodyNode, staticImports) {
  const imports = new Set(extractDynamicImports(bodyNode));

  for (const source of staticImports.sideEffectImports || []) {
    imports.add(source);
  }

  for (const source of extractReferencedStaticImportSources(bodyNode, staticImports.bindings || [])) {
    imports.add(source);
  }

  return Array.from(imports).sort();
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
