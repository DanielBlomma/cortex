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

export function resolveIdentifier(name, ancestors, scopeGraph) {
  let scope = getNearestScope(ancestors, scopeGraph) ?? scopeGraph.rootScope;

  while (scope) {
    if (scope.declarations.has(name)) {
      return {
        name,
        scope,
        kind: scope.kind
      };
    }

    scope = scope.parent;
  }

  return null;
}

function getNearestScope(ancestors, scopeGraph) {
  for (let index = ancestors.length - 2; index >= 0; index -= 1) {
    const scope = scopeGraph.scopeByNode.get(ancestors[index]);
    if (scope) {
      return scope;
    }
  }

  return null;
}
