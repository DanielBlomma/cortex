import { Parser } from "acorn";
import tsPlugin from "acorn-typescript";
import { base } from "acorn-walk";

const baseIdentifier = base.Identifier;
const baseFunction = base.Function;
const baseClass = base.Class;

base.Identifier = (node, st, visit) => {
  baseIdentifier(node, st, visit);
  if (node.typeAnnotation) {
    visit(node.typeAnnotation, st);
  }
};

base.Function = (node, st, visit) => {
  baseFunction(node, st, visit);
  if (node.returnType) {
    visit(node.returnType, st);
  }
  if (node.typeParameters) {
    visit(node.typeParameters, st);
  }
};

base.Class = (node, st, visit) => {
  baseClass(node, st, visit);
  for (const implementedType of node.implements || []) {
    visit(implementedType, st);
  }
  if (node.typeParameters) {
    visit(node.typeParameters, st);
  }
};

const tsNodeHandlers = {
  TSAsExpression(node, st, visit) { visit(node.expression, st); },
  TSSatisfiesExpression(node, st, visit) { visit(node.expression, st); },
  TSTypeAssertion(node, st, visit) { visit(node.expression, st); },
  TSTypeAnnotation(node, st, visit) {
    if (node.typeAnnotation) {
      visit(node.typeAnnotation, st);
    }
  },
  TSTypeParameterInstantiation(node, st, visit) {
    for (const param of node.params || []) {
      visit(param, st);
    }
  },
  TSTypeParameterDeclaration(node, st, visit) {
    for (const param of node.params || []) {
      if (param.constraint) {
        visit(param.constraint, st);
      }
      if (param.default) {
        visit(param.default, st);
      }
    }
  },
  TSTypeReference(node, st, visit) {
    if (node.typeName) {
      visit(node.typeName, st);
    }
    if (node.typeParameters) {
      visit(node.typeParameters, st);
    }
  },
  TSQualifiedName(node, st, visit) {
    if (node.left) visit(node.left, st);
    if (node.right) visit(node.right, st);
  },
  TSInterfaceDeclaration(node, st, visit) {
    if (node.extends) {
      for (const extendedType of node.extends) {
        visit(extendedType, st);
      }
    }
    if (node.body) {
      visit(node.body, st);
    }
  },
  TSInterfaceBody(node, st, visit) {
    for (const member of node.body || []) {
      visit(member, st);
    }
  },
  TSTypeAliasDeclaration(node, st, visit) {
    if (node.typeParameters) {
      visit(node.typeParameters, st);
    }
    if (node.typeAnnotation) {
      visit(node.typeAnnotation, st);
    }
  },
  TSEnumDeclaration(node, st, visit) {
    for (const member of node.members || []) {
      visit(member, st);
    }
  },
  TSEnumMember(node, st, visit) {
    if (node.initializer) {
      visit(node.initializer, st);
    }
  },
  TSModuleDeclaration() {},
  TSDeclareFunction() {},
  TSPropertySignature(node, st, visit) {
    if (node.computed && node.key) {
      visit(node.key, st);
    }
    if (node.typeAnnotation) {
      visit(node.typeAnnotation, st);
    }
  },
  TSMethodSignature(node, st, visit) {
    if (node.computed && node.key) {
      visit(node.key, st);
    }
    if (node.typeParameters) {
      visit(node.typeParameters, st);
    }
    for (const param of node.params || []) {
      visit(param, st);
    }
    if (node.returnType) {
      visit(node.returnType, st);
    }
  },
  TSIndexSignature(node, st, visit) {
    for (const param of node.params || []) {
      visit(param, st);
    }
    if (node.typeAnnotation) {
      visit(node.typeAnnotation, st);
    }
  },
  TSTypeLiteral(node, st, visit) {
    for (const member of node.members || node.body || []) {
      visit(member, st);
    }
  },
  TSUnionType(node, st, visit) {
    for (const typeNode of node.types || []) {
      visit(typeNode, st);
    }
  },
  TSIntersectionType(node, st, visit) {
    for (const typeNode of node.types || []) {
      visit(typeNode, st);
    }
  },
  TSArrayType(node, st, visit) {
    if (node.elementType) {
      visit(node.elementType, st);
    }
  },
  TSTupleType(node, st, visit) {
    for (const elementType of node.elementTypes || []) {
      visit(elementType, st);
    }
  },
  TSOptionalType(node, st, visit) {
    if (node.typeAnnotation) {
      visit(node.typeAnnotation, st);
    }
  },
  TSRestType(node, st, visit) {
    if (node.typeAnnotation) {
      visit(node.typeAnnotation, st);
    }
  },
  TSFunctionType(node, st, visit) {
    for (const param of node.params || []) {
      visit(param, st);
    }
    if (node.returnType) {
      visit(node.returnType, st);
    }
  },
  TSConstructorType(node, st, visit) {
    for (const param of node.params || []) {
      visit(param, st);
    }
    if (node.returnType) {
      visit(node.returnType, st);
    }
  },
  TSExpressionWithTypeArguments(node, st, visit) {
    if (node.expression) {
      visit(node.expression, st);
    }
    if (node.typeParameters) {
      visit(node.typeParameters, st);
    }
  },
  TSParameterProperty(node, st, visit) {
    if (node.parameter) {
      visit(node.parameter, st);
    }
  },
  TSNonNullExpression(node, st, visit) { visit(node.expression, st); },
  TSInstantiationExpression(node, st, visit) { visit(node.expression, st); },
  JSXElement(node, st, visit) {
    if (node.openingElement) {
      visit(node.openingElement, st);
    }
    for (const child of node.children || []) {
      visit(child, st);
    }
    if (node.closingElement) {
      visit(node.closingElement, st);
    }
  },
  JSXFragment(node, st, visit) {
    if (node.openingFragment) {
      visit(node.openingFragment, st);
    }
    for (const child of node.children || []) {
      visit(child, st);
    }
    if (node.closingFragment) {
      visit(node.closingFragment, st);
    }
  },
  JSXOpeningElement(node, st, visit) {
    if (node.name) {
      visit(node.name, st);
    }
    for (const attribute of node.attributes || []) {
      visit(attribute, st);
    }
  },
  JSXClosingElement(node, st, visit) {
    if (node.name) {
      visit(node.name, st);
    }
  },
  JSXAttribute(node, st, visit) {
    if (node.value) {
      visit(node.value, st);
    }
  },
  JSXExpressionContainer(node, st, visit) {
    if (node.expression && node.expression.type !== "JSXEmptyExpression") {
      visit(node.expression, st);
    }
  },
  JSXSpreadAttribute(node, st, visit) {
    if (node.argument) {
      visit(node.argument, st);
    }
  },
  JSXMemberExpression(node, st, visit) {
    if (node.object) {
      visit(node.object, st);
    }
  },
  JSXNamespacedName(node, st, visit) {
    if (node.namespace) {
      visit(node.namespace, st);
    }
  }
};

for (const nodeType of [
  "JSXClosingFragment",
  "JSXEmptyExpression",
  "JSXIdentifier",
  "JSXOpeningFragment",
  "JSXText",
  "TSAnyKeyword",
  "TSBigIntKeyword",
  "TSBooleanKeyword",
  "TSIntrinsicKeyword",
  "TSNeverKeyword",
  "TSNullKeyword",
  "TSNumberKeyword",
  "TSObjectKeyword",
  "TSStringKeyword",
  "TSSymbolKeyword",
  "TSUndefinedKeyword",
  "TSUnknownKeyword",
  "TSVoidKeyword",
  "TSThisType",
  "TSLiteralType"
]) {
  tsNodeHandlers[nodeType] = () => {};
}

Object.assign(base, tsNodeHandlers);

export const WALK_BASE = base;

export function parseAst(code) {
  try {
    const TSParser = Parser.extend(tsPlugin());
    const ast = TSParser.parse(code, {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: true,
      allowHashBang: true,
      allowImportExportEverywhere: true,
      allowAwaitOutsideFunction: true
    });

    return { ast, errors: [] };
  } catch (error) {
    return {
      ast: null,
      errors: [
        {
          message: `Parse error: ${error.message}`,
          line: error.loc?.line,
          column: error.loc?.column
        }
      ]
    };
  }
}
