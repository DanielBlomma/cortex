import { simple as walkSimple } from "acorn-walk";

import { WALK_BASE } from "./ast.mjs";

export function extractCalls(bodyNode) {
  if (!bodyNode) {
    return [];
  }

  const calls = new Set();

  try {
    walkSimple(
      bodyNode,
      {
        CallExpression(node) {
          const callee = node.callee;

          if (callee.type === "Identifier") {
            calls.add(callee.name);
            return;
          }

          if (callee.type === "MemberExpression" && callee.property.type === "Identifier") {
            const objectName = getObjectName(callee.object);
            calls.add(objectName ? `${objectName}.${callee.property.name}` : callee.property.name);
          }
        }
      },
      WALK_BASE
    );
  } catch (error) {
    // Ignore walk errors for incomplete ASTs.
  }

  return [...calls].sort();
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
