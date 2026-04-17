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
  TSInterfaceDeclaration() {},
  TSTypeAliasDeclaration() {},
  TSEnumDeclaration() {},
  TSModuleDeclaration() {},
  TSDeclareFunction() {},
  TSPropertySignature() {},
  TSMethodSignature() {},
  TSIndexSignature() {},
  TSTypeLiteral() {},
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
  TSInstantiationExpression(node, st, visit) { visit(node.expression, st); }
};

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
