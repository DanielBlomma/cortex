/**
 * Rust parser dispatcher.
 *
 * Selects between the tree-sitter parser (default, richer output) and
 * the regex parser (fallback, zero deps) based on the CORTEX_RUST_PARSER
 * environment variable. Selection is deferred until the first parseCode
 * call so no WASM is loaded if the project contains no .rs files.
 *
 *   CORTEX_RUST_PARSER=regex       → always use regex parser
 *   CORTEX_RUST_PARSER=tree-sitter → force tree-sitter (error if unavailable)
 *   unset / other                  → tree-sitter with regex auto-fallback
 */

const choice = process.env.CORTEX_RUST_PARSER;

let activeParser = null;
let resolvePromise = null;

async function resolveParser() {
  if (activeParser) return activeParser;
  if (resolvePromise) return resolvePromise;
  resolvePromise = (async () => {
    if (choice === "regex") {
      activeParser = await import("./rust.mjs");
    } else if (choice === "tree-sitter") {
      activeParser = await import("./rust-treesitter.mjs");
    } else {
      const ts = await import("./rust-treesitter.mjs");
      if (await ts.isAvailable()) {
        activeParser = ts;
      } else {
        activeParser = await import("./rust.mjs");
      }
    }
    return activeParser;
  })();
  return resolvePromise;
}

export async function parseCode(code, filePath, language = "rust") {
  const parser = await resolveParser();
  return parser.parseCode(code, filePath, language);
}
