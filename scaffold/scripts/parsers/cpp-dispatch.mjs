/**
 * C/C++ parser dispatcher.
 *
 * Selects between the tree-sitter parser (default, no runtime deps)
 * and the legacy clang-bridge parser based on the CORTEX_CPP_PARSER
 * environment variable. Selection is deferred until the first parseCode
 * call so no WASM is loaded if the project contains no C/C++ files.
 *
 *   CORTEX_CPP_PARSER=clang        → always use clang-bridge
 *   CORTEX_CPP_PARSER=tree-sitter  → force tree-sitter (error if unavailable)
 *   unset / other                  → tree-sitter with clang auto-fallback
 */

const choice = process.env.CORTEX_CPP_PARSER;

let activeParser = null;
let resolvePromise = null;

function availabilityOf(parser) {
  if (typeof parser.isAvailable === "function") return parser.isAvailable;
  if (typeof parser.isCppParserAvailable === "function") return parser.isCppParserAvailable;
  return () => typeof parser.parseCode === "function";
}

async function resolveParser() {
  if (activeParser) return activeParser;
  if (resolvePromise) return resolvePromise;
  resolvePromise = (async () => {
    if (choice === "clang") {
      activeParser = await import("./cpp.mjs");
    } else if (choice === "tree-sitter") {
      activeParser = await import("./cpp-treesitter.mjs");
    } else {
      const ts = await import("./cpp-treesitter.mjs");
      if (await ts.isAvailable()) {
        activeParser = ts;
      } else {
        activeParser = await import("./cpp.mjs");
      }
    }
    return activeParser;
  })();
  return resolvePromise;
}

export async function parseCode(code, filePath, language = "cpp") {
  const parser = await resolveParser();
  return parser.parseCode(code, filePath, language);
}

export async function isCppParserAvailable() {
  const parser = await resolveParser();
  const check = availabilityOf(parser);
  const result = check();
  return result && typeof result.then === "function" ? await result : result;
}
