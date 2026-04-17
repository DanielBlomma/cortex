/**
 * C/C++ parser dispatcher.
 *
 * Selects between the tree-sitter parser (default, no runtime deps)
 * and the legacy clang-bridge parser based on the CORTEX_CPP_PARSER
 * environment variable. If the tree-sitter parser fails to load
 * (WASM unavailable, corrupt grammar, etc.), automatically falls back
 * to the clang-bridge so ingestion keeps working.
 *
 *   CORTEX_CPP_PARSER=clang        → always use clang-bridge
 *   CORTEX_CPP_PARSER=tree-sitter  → force tree-sitter (error if unavailable)
 *   unset / other                  → tree-sitter with clang auto-fallback
 */

const choice = process.env.CORTEX_CPP_PARSER;

let parser;
let availability;

if (choice === "clang") {
  parser = await import("./cpp.mjs");
  availability = () =>
    typeof parser.isCppParserAvailable === "function"
      ? parser.isCppParserAvailable()
      : typeof parser.parseCode === "function";
} else if (choice === "tree-sitter") {
  parser = await import("./cpp-treesitter.mjs");
  availability = () =>
    typeof parser.isAvailable === "function"
      ? parser.isAvailable()
      : typeof parser.parseCode === "function";
} else {
  try {
    parser = await import("./cpp-treesitter.mjs");
    availability = () =>
      typeof parser.isAvailable === "function"
        ? parser.isAvailable()
        : typeof parser.parseCode === "function";
  } catch {
    parser = await import("./cpp.mjs");
    availability = () =>
      typeof parser.isCppParserAvailable === "function"
        ? parser.isCppParserAvailable()
        : typeof parser.parseCode === "function";
  }
}

export const parseCode = parser.parseCode;
export function isCppParserAvailable() {
  return availability();
}
