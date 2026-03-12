import { recursive } from "acorn-walk";

import { WALK_BASE } from "./ast.mjs";

export function collectPatternIdentifiers(pattern, visit) {
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

export function buildScopeDeclarations(bodyNode) {
  const scopeDeclarations = new Map();
  const scopeStack = isFunctionScopeNode(bodyNode) || bodyNode.type === "BlockStatement" ? [] : [bodyNode];

  try {
    recursive(
      bodyNode,
      null,
      {
        ImportDeclaration() {},

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
      WALK_BASE
    );
  } catch (error) {
    // Ignore walk errors for incomplete ASTs.
  }

  return scopeDeclarations;
}

export function isReferenceIdentifier(node, ancestors) {
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

export function isShadowedIdentifier(name, ancestors, scopeDeclarations) {
  for (let index = ancestors.length - 2; index >= 0; index -= 1) {
    const declarations = scopeDeclarations.get(ancestors[index]);
    if (declarations?.has(name)) {
      return true;
    }
  }

  return false;
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
