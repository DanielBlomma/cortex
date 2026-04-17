/**
 * Rust parser dispatcher.
 *
 * Selects between the tree-sitter parser (default, richer output) and
 * the regex parser (fallback, zero deps) based on the CORTEX_RUST_PARSER
 * environment variable. If the tree-sitter parser fails to load (e.g.
 * WASM unavailable), automatically falls back to the regex parser so
 * ingestion keeps working.
 *
 *   CORTEX_RUST_PARSER=regex       → always use regex parser
 *   CORTEX_RUST_PARSER=tree-sitter → force tree-sitter (error if unavailable)
 *   unset / other                  → tree-sitter with regex auto-fallback
 */

const choice = process.env.CORTEX_RUST_PARSER;

let parser;
if (choice === "regex") {
  parser = await import("./rust.mjs");
} else if (choice === "tree-sitter") {
  parser = await import("./rust-treesitter.mjs");
} else {
  try {
    parser = await import("./rust-treesitter.mjs");
  } catch {
    parser = await import("./rust.mjs");
  }
}

export const parseCode = parser.parseCode;
