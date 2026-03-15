import { ancestor as walkAncestor, simple as walkSimple } from "acorn-walk";

import { WALK_BASE } from "./ast.mjs";

export function discoverChunks(ast, code, language = "javascript") {
  const chunks = [];
  const exportedNames = collectExportedNames(ast);

  function pushChunk(chunk) {
    if (!chunk) {
      return;
    }

    chunk.language = language;
    if (exportedNames.has(chunk.name)) {
      chunk.exported = true;
    }
    chunks.push(chunk);
  }

  walkSimple(
    ast,
    {
      FunctionDeclaration(node) {
        if (!node.id) {
          return;
        }

        pushChunk(extractFunctionChunk(node, "function", code));
      },

      ClassDeclaration(node) {
        if (!node.id) {
          return;
        }

        const chunk = extractClassChunk(node, code);
        if (chunk) {
          pushChunk(chunk);

          for (const method of extractClassMethods(node, code, language)) {
            method.parentChunk = chunk.name;
            chunks.push(method);
          }
        }
      },

      VariableDeclaration(node) {
        for (const declarator of node.declarations || []) {
          if (!declarator.id || declarator.id.type !== "Identifier" || !declarator.init) {
            continue;
          }

          const isFunctionExpr =
            declarator.init.type === "FunctionExpression" ||
            declarator.init.type === "ArrowFunctionExpression";

          if (!isFunctionExpr) {
            continue;
          }

          const chunk = extractFunctionChunk(declarator.init, "const", code, declarator.id.name);
          pushChunk(chunk);
        }
      }
    },
    WALK_BASE
  );

  return dedupeChunks(chunks);
}

function dedupeChunks(chunks) {
  const seenChunks = new Map();

  for (const chunk of chunks) {
    const key = `${chunk.name}:${chunk.startLine}`;
    const existing = seenChunks.get(key);
    if (!existing || chunk.exported) {
      seenChunks.set(key, chunk);
    }
  }

  return [...seenChunks.values()];
}

function collectExportedNames(ast) {
  const exportedNames = new Set();

  walkSimple(
    ast,
    {
      ExportNamedDeclaration(node) {
        if (node.declaration) {
          if (
            (node.declaration.type === "FunctionDeclaration" ||
              node.declaration.type === "ClassDeclaration") &&
            node.declaration.id?.name
          ) {
            exportedNames.add(node.declaration.id.name);
          }

          if (node.declaration.type === "VariableDeclaration") {
            for (const declarator of node.declaration.declarations || []) {
              if (declarator.id?.type === "Identifier") {
                exportedNames.add(declarator.id.name);
              }
            }
          }
        }

        if (!node.source) {
          for (const specifier of node.specifiers || []) {
            if (specifier.local?.type === "Identifier") {
              exportedNames.add(specifier.local.name);
            }
          }
        }
      },

      ExportDefaultDeclaration(node) {
        const declaration = node.declaration;
        if (
          (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") &&
          declaration.id?.name
        ) {
          exportedNames.add(declaration.id.name);
          return;
        }

        if (declaration.type === "Identifier") {
          exportedNames.add(declaration.name);
        }
      }
    },
    WALK_BASE
  );

  walkAncestor(
    ast,
    {
      AssignmentExpression(node, ancestors) {
        if (isNestedInFunctionScope(ancestors)) {
          return;
        }

        addCommonJsExportedNames(exportedNames, node);
      }
    },
    WALK_BASE
  );

  return exportedNames;
}

function isNestedInFunctionScope(ancestors) {
  return ancestors.slice(0, -1).some((node) =>
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  );
}

function addCommonJsExportedNames(exportedNames, assignment) {
  const exportPath = getCommonJsExportPath(assignment.left);
  if (!exportPath) {
    return;
  }

  addExportedNamesFromValue(exportedNames, assignment.right);
}

function getCommonJsExportPath(node) {
  if (!node || node.type !== "MemberExpression") {
    return null;
  }

  const propertyName = getStaticPropertyName(node);
  if (!propertyName) {
    return null;
  }

  if (node.object.type === "Identifier") {
    if (node.object.name === "exports") {
      return ["exports", propertyName];
    }

    if (node.object.name === "module" && propertyName === "exports") {
      return ["module", "exports"];
    }
  }

  const objectPath = getCommonJsExportPath(node.object);
  if (!objectPath) {
    return null;
  }

  if (objectPath.length >= 2 && objectPath[0] === "module" && objectPath[1] === "exports") {
    return [...objectPath, propertyName];
  }

  return null;
}

function getStaticPropertyName(node) {
  if (!node.computed && node.property.type === "Identifier") {
    return node.property.name;
  }

  if (node.computed && node.property.type === "Literal" && typeof node.property.value === "string") {
    return node.property.value;
  }

  return null;
}

function addExportedNamesFromValue(exportedNames, value) {
  if (!value) {
    return;
  }

  if (value.type === "Identifier") {
    exportedNames.add(value.name);
    return;
  }

  if (value.type === "AssignmentExpression") {
    addExportedNamesFromValue(exportedNames, value.right);
    return;
  }

  if (value.type !== "ObjectExpression") {
    return;
  }

  for (const property of value.properties || []) {
    if (property.type !== "Property" || property.kind !== "init") {
      continue;
    }

    addExportedNamesFromValue(exportedNames, property.value);
  }
}

function extractFunctionChunk(node, kind, code, nameOverride = null) {
  const name = nameOverride || node.id?.name;
  if (!name) {
    return null;
  }

  const params = (node.params || []).map(formatParameterName);
  const bodyStart = findLeadingCommentStart(code, node);

  return {
    name,
    kind,
    signature: `${name}(${params.join(", ")})`,
    body: code.slice(bodyStart, node.end),
    startLine: node.loc.start.line,
    endLine: node.loc.end.line,
    callNode: node.body || node,
    importNode: node,
    async: node.async === true,
    generator: node.generator === true
  };
}

function extractClassChunk(node, code) {
  const name = node.id?.name;
  if (!name) {
    return null;
  }

  const superClass = node.superClass?.name || null;
  const bodyStart = findLeadingCommentStart(code, node);

  return {
    name,
    kind: "class",
    signature: superClass ? `class ${name} extends ${superClass}` : `class ${name}`,
    body: code.slice(bodyStart, node.end),
    startLine: node.loc.start.line,
    endLine: node.loc.end.line,
    callNode: node.body,
    importNode: node,
    superClass
  };
}

function extractClassMethods(classNode, code, language) {
  const methods = [];
  const className = classNode.id?.name || "UnknownClass";

  for (const member of classNode.body.body || []) {
    if (member.type !== "MethodDefinition" || member.key.type !== "Identifier") {
      continue;
    }

    const params = (member.value.params || []).map(formatParameterName);
    const isStatic = member.static === true;
    const prefix = isStatic ? "static " : "";
    const bodyStart = findLeadingCommentStart(code, member);

    methods.push({
      name: `${className}.${member.key.name}`,
      kind: "method",
      signature: `${prefix}${member.key.name}(${params.join(", ")})`,
      body: code.slice(bodyStart, member.end),
      startLine: member.loc.start.line,
      endLine: member.loc.end.line,
      callNode: member.value.body,
      importNode: member,
      static: isStatic,
      async: member.value.async === true,
      generator: member.value.generator === true,
      language
    });
  }

  return methods;
}

function findLeadingCommentStart(code, node) {
  let bodyStart = node.start;
  let lineStart = code.lastIndexOf("\n", node.start - 1) + 1;

  while (lineStart > 0) {
    const previousLineEnd = lineStart - 1;
    const previousLineStart = code.lastIndexOf("\n", previousLineEnd - 1) + 1;
    const previousLine = code.slice(previousLineStart, previousLineEnd).replace(/\r$/, "");
    const trimmed = previousLine.trim();

    if (!trimmed) {
      break;
    }

    if (trimmed.startsWith("//")) {
      bodyStart = previousLineStart;
      lineStart = previousLineStart;
      continue;
    }

    if (trimmed.endsWith("*/")) {
      let blockStart = previousLineStart;
      let searchStart = previousLineStart;
      let foundBlockStart = trimmed.startsWith("/*");

      while (!foundBlockStart && searchStart > 0) {
        const blockLineEnd = searchStart - 1;
        const blockLineStart = code.lastIndexOf("\n", blockLineEnd - 1) + 1;
        const blockLine = code.slice(blockLineStart, blockLineEnd).replace(/\r$/, "");
        const blockTrimmed = blockLine.trim();

        if (!blockTrimmed) {
          return bodyStart;
        }

        blockStart = blockLineStart;
        searchStart = blockLineStart;
        foundBlockStart = blockTrimmed.startsWith("/*");
      }

      if (!foundBlockStart) {
        break;
      }

      bodyStart = blockStart;
      lineStart = blockStart;
      continue;
    }

    break;
  }

  return bodyStart;
}

function formatParameterName(param) {
  if (param.type === "TSParameterProperty") {
    return formatParameterName(param.parameter);
  }

  if (param.type === "Identifier") {
    return param.name;
  }

  if (param.type === "RestElement" && param.argument.type === "Identifier") {
    return `...${param.argument.name}`;
  }

  return "_";
}
