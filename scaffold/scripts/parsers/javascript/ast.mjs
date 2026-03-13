import { Parser } from "acorn";
import tsPlugin from "acorn-typescript";
import { base } from "acorn-walk";

const tsNodeHandlers = {
  TSAsExpression(node, st, visit) { visit(node.expression, st); },
  TSTypeAnnotation() {},
  TSTypeParameterInstantiation() {},
  TSTypeParameterDeclaration() {},
  TSTypeReference() {},
  TSInterfaceDeclaration() {},
  TSTypeAliasDeclaration() {},
  TSEnumDeclaration() {},
  TSModuleDeclaration() {},
  TSDeclareFunction() {},
  TSPropertySignature() {},
  TSMethodSignature() {},
  TSIndexSignature() {},
  TSTypeLiteral() {},
  TSUnionType() {},
  TSIntersectionType() {},
  TSArrayType() {},
  TSTupleType() {},
  TSOptionalType() {},
  TSRestType() {},
  TSFunctionType() {},
  TSConstructorType() {},
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
