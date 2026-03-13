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

export function walkPatternExpressions(pattern, visit) {
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
