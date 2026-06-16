import { fullAncestor, simple as walkSimple } from "acorn-walk";

import { WALK_BASE } from "./ast.mjs";
import { collectPatternIdentifiers } from "./patterns.mjs";
import { buildScopeGraph } from "./scope-builder.mjs";
import { isReferenceIdentifier, resolveIdentifier } from "./scope-resolver.mjs";

export function collectStaticImports(ast) {
  const bindings = [];
  const sideEffectImports = new Set();

  for (const node of ast.body || []) {
    if (node.type === "ImportDeclaration") {
      if (node.source?.type === "Literal" && typeof node.source.value === "string") {
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
    sideEffectImports: [...sideEffectImports].sort()
  };
}

export function extractImportsForChunk(bodyNode, staticImports) {
  const imports = new Set(extractDynamicImports(bodyNode));

  for (const source of staticImports.sideEffectImports || []) {
    imports.add(source);
  }

  for (const source of extractReferencedStaticImportSources(bodyNode, staticImports.bindings || [])) {
    imports.add(source);
  }

  return [...imports].sort();
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

  const scopeGraph = buildScopeGraph(bodyNode);
  const sources = new Set();

  try {
    fullAncestor(
      bodyNode,
      (node, state, ancestors) => {
        const localName = getReferencedImportName(node, ancestors);
        if (!localName) {
          return;
        }

        const source = importsByLocalName.get(localName);
        if (!source) {
          return;
        }

        if (resolveIdentifier(localName, ancestors, scopeGraph)) {
          return;
        }

        sources.add(source);
      },
      WALK_BASE
    );
  } catch (error) {
    // Ignore walk errors for incomplete ASTs.
  }

  return [...sources].sort();
}

function getReferencedImportName(node, ancestors) {
  if (node.type === "Identifier") {
    return isReferenceIdentifier(node, ancestors) ? node.name : null;
  }

  if (node.type !== "JSXIdentifier" || isIntrinsicJsxName(node.name)) {
    return null;
  }

  const parent = ancestors[ancestors.length - 2] ?? null;
  if (!parent) {
    return null;
  }

  if (parent.type === "JSXOpeningElement" && parent.name === node) {
    return node.name;
  }

  if (parent.type === "JSXMemberExpression" && parent.object === node) {
    return node.name;
  }

  if (parent.type === "JSXNamespacedName" && parent.namespace === node) {
    return node.name;
  }

  return null;
}

function isIntrinsicJsxName(name) {
  return /^[a-z]/.test(name);
}

function extractDynamicImports(bodyNode) {
  if (!bodyNode) {
    return [];
  }

  const imports = new Set();

  try {
    walkSimple(
      bodyNode,
      {
        CallExpression(node) {
          if (node.callee.type === "Import" && node.arguments[0]?.type === "Literal") {
            imports.add(node.arguments[0].value);
          }

          if (
            node.callee.type === "Identifier" &&
            node.callee.name === "require" &&
            node.arguments[0]?.type === "Literal"
          ) {
            imports.add(node.arguments[0].value);
          }
        }
      },
      WALK_BASE
    );
  } catch (error) {
    // Ignore walk errors for incomplete ASTs.
  }

  return [...imports].sort();
}
