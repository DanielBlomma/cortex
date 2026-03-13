import { recursive } from "acorn-walk";

import { WALK_BASE } from "./ast.mjs";
import { collectPatternIdentifiers, walkPatternExpressions } from "./patterns.mjs";

export function buildScopeGraph(bodyNode) {
  const rootScope = createScope(bodyNode, null, "analysis-root");
  const scopeByNode = new Map();
  const scopeStack = [rootScope];

  try {
    recursive(
      bodyNode,
      null,
      {
        ImportDeclaration() {},

        VariableDeclaration(node, state, recurse) {
          const targetScope = node.kind === "var" ? nearestVarScope(scopeStack) : currentScope(scopeStack);
          for (const declarator of node.declarations || []) {
            declarePattern(targetScope, declarator.id);
            if (declarator.init) {
              recurse(declarator.init, state);
            }
          }
        },

        FunctionDeclaration(node, state, recurse) {
          const parentScope = currentScope(scopeStack);
          if (node.id) {
            declareIdentifier(parentScope, node.id.name);
          }

          const functionScope = createChildScope(scopeByNode, parentScope, node, "function");
          if (node.id) {
            declareIdentifier(functionScope, node.id.name);
          }
          declareTypeParameters(functionScope, node.typeParameters);
          for (const param of node.params || []) {
            declarePattern(functionScope, param);
          }

          withScope(scopeStack, functionScope, () => {
            for (const param of node.params || []) {
              walkPatternExpressions(param, (child) => recurse(child, state));
            }
            if (node.body) {
              recurse(node.body, state);
            }
          });
        },

        FunctionExpression(node, state, recurse) {
          const functionScope = createChildScope(scopeByNode, currentScope(scopeStack), node, "function");
          if (node.id) {
            declareIdentifier(functionScope, node.id.name);
          }
          declareTypeParameters(functionScope, node.typeParameters);
          for (const param of node.params || []) {
            declarePattern(functionScope, param);
          }

          withScope(scopeStack, functionScope, () => {
            for (const param of node.params || []) {
              walkPatternExpressions(param, (child) => recurse(child, state));
            }
            if (node.body) {
              recurse(node.body, state);
            }
          });
        },

        ArrowFunctionExpression(node, state, recurse) {
          const functionScope = createChildScope(scopeByNode, currentScope(scopeStack), node, "function");
          declareTypeParameters(functionScope, node.typeParameters);
          for (const param of node.params || []) {
            declarePattern(functionScope, param);
          }

          withScope(scopeStack, functionScope, () => {
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
          if (node.id) {
            declareIdentifier(parentScope, node.id.name);
          }

          if (node.superClass) {
            recurse(node.superClass, state);
          }

          const classScope = createChildScope(scopeByNode, parentScope, node, "class");
          if (node.id) {
            declareIdentifier(classScope, node.id.name);
          }
          declareTypeParameters(classScope, node.typeParameters);

          withScope(scopeStack, classScope, () => {
            if (node.body) {
              recurse(node.body, state);
            }
          });
        },

        ClassExpression(node, state, recurse) {
          if (node.superClass) {
            recurse(node.superClass, state);
          }

          const classScope = createChildScope(scopeByNode, currentScope(scopeStack), node, "class");
          if (node.id) {
            declareIdentifier(classScope, node.id.name);
          }
          declareTypeParameters(classScope, node.typeParameters);

          withScope(scopeStack, classScope, () => {
            if (node.body) {
              recurse(node.body, state);
            }
          });
        },

        BlockStatement(node, state, recurse) {
          const blockScope = createChildScope(scopeByNode, currentScope(scopeStack), node, "block");
          withScope(scopeStack, blockScope, () => {
            for (const statement of node.body || []) {
              recurse(statement, state);
            }
          });
        },

        SwitchStatement(node, state, recurse) {
          if (node.discriminant) {
            recurse(node.discriminant, state);
          }

          const switchScope = createChildScope(scopeByNode, currentScope(scopeStack), node, "block");
          withScope(scopeStack, switchScope, () => {
            for (const caseNode of node.cases || []) {
              recurse(caseNode, state);
            }
          });
        },

        ForStatement(node, state, recurse) {
          const loopScope = createChildScope(scopeByNode, currentScope(scopeStack), node, "block");
          withScope(scopeStack, loopScope, () => {
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
          const loopScope = createChildScope(scopeByNode, currentScope(scopeStack), node, "block");
          withScope(scopeStack, loopScope, () => {
            recurse(node.left, state);
            recurse(node.right, state);
            if (node.body) {
              recurse(node.body, state);
            }
          });
        },

        ForOfStatement(node, state, recurse) {
          const loopScope = createChildScope(scopeByNode, currentScope(scopeStack), node, "block");
          withScope(scopeStack, loopScope, () => {
            recurse(node.left, state);
            recurse(node.right, state);
            if (node.body) {
              recurse(node.body, state);
            }
          });
        },

        CatchClause(node, state, recurse) {
          const catchScope = createChildScope(scopeByNode, currentScope(scopeStack), node, "catch");
          if (node.param) {
            declarePattern(catchScope, node.param);
          }

          withScope(scopeStack, catchScope, () => {
            if (node.param) {
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

  return { rootScope, scopeByNode };
}

function createScope(node, parent, kind) {
  const scope = {
    node,
    parent,
    kind,
    declarations: new Set(),
    children: []
  };

  if (parent) {
    parent.children.push(scope);
  }

  return scope;
}

function createChildScope(scopeByNode, parentScope, node, kind) {
  const existing = scopeByNode.get(node);
  if (existing) {
    return existing;
  }

  const scope = createScope(node, parentScope, kind);
  scopeByNode.set(node, scope);
  return scope;
}

function currentScope(scopeStack) {
  return scopeStack[scopeStack.length - 1] ?? null;
}

function nearestVarScope(scopeStack) {
  for (let index = scopeStack.length - 1; index >= 0; index -= 1) {
    const scope = scopeStack[index];
    if (scope.kind === "function" || scope.kind === "analysis-root") {
      return scope;
    }
  }

  return currentScope(scopeStack);
}

function declareIdentifier(scope, name) {
  if (!scope || !name) {
    return;
  }

  scope.declarations.add(name);
}

function declarePattern(scope, pattern) {
  collectPatternIdentifiers(pattern, (name) => {
    declareIdentifier(scope, name);
  });
}

function declareTypeParameters(scope, typeParameters) {
  for (const param of typeParameters?.params || []) {
    declareIdentifier(scope, param.name);
  }
}

function withScope(scopeStack, scope, visit) {
  scopeStack.push(scope);
  try {
    visit();
  } finally {
    scopeStack.pop();
  }
}
