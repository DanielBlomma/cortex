import test from "node:test";
import assert from "node:assert/strict";
import { parseCode as parseRust } from "../scaffold/scripts/parsers/rust-treesitter.mjs";
import { parseCode as parsePython } from "../scaffold/scripts/parsers/python-treesitter.mjs";
import { parseCode as parseJava } from "../scaffold/scripts/parsers/java-treesitter.mjs";
import { parseCode as parseGo } from "../scaffold/scripts/parsers/go-treesitter.mjs";
import { parseCode as parseRuby } from "../scaffold/scripts/parsers/ruby-treesitter.mjs";
import { parseCode as parseCpp } from "../scaffold/scripts/parsers/cpp-treesitter.mjs";
import { parseCode as parseBash } from "../scaffold/scripts/parsers/bash-treesitter.mjs";

/**
 * Verifies every tree-sitter parser caps chunk bodies at bodyOf()'s
 * maxChars (12000 default). Prior to this PR, parsers emitted
 * body: node.text with no limit, so a 50KB function produced a 50KB
 * chunk body — blowing out DB rows and embedding costs.
 */

const MAX_BODY_CHARS = 12000;

// Each case builds a function that's >> 12000 chars in its body.
// The function signature/opener stays small so the chunk anchor works.
const PAD = "x".repeat(20000);

const CASES = [
  {
    name: "rust",
    parse: parseRust,
    file: "big.rs",
    source: `fn big() {\n    let s = "${PAD}";\n    let t = s;\n}\n`
  },
  {
    name: "python",
    parse: parsePython,
    file: "big.py",
    source: `def big():\n    s = "${PAD}"\n    return s\n`
  },
  {
    name: "java",
    parse: parseJava,
    file: "Big.java",
    source: `class Big { String big() { String s = "${PAD}"; return s; } }\n`
  },
  {
    name: "go",
    parse: parseGo,
    file: "big.go",
    source: `package main\nfunc big() string {\n    s := "${PAD}"\n    return s\n}\n`
  },
  {
    name: "ruby",
    parse: parseRuby,
    file: "big.rb",
    source: `def big\n  s = "${PAD}"\n  s\nend\n`
  },
  {
    name: "cpp",
    parse: parseCpp,
    file: "big.cpp",
    source: `const char* big() { const char* s = "${PAD}"; return s; }\n`
  },
  {
    name: "bash",
    parse: parseBash,
    file: "big.sh",
    source: `big() {\n  local s="${PAD}"\n  echo "$s"\n}\n`
  }
];

for (const { name, parse, file, source } of CASES) {
  test(`tree-sitter ${name} parser: chunk body is capped at ${MAX_BODY_CHARS} chars`, async () => {
    assert.ok(
      source.length > MAX_BODY_CHARS,
      `test fixture for ${name} must be larger than cap (got ${source.length})`
    );

    const result = await parse(source, file, name);
    assert.ok(result.chunks.length > 0, `${name}: expected at least one chunk`);

    for (const chunk of result.chunks) {
      assert.ok(
        chunk.body.length <= MAX_BODY_CHARS,
        `${name}: chunk ${chunk.name} body is ${chunk.body.length} chars, expected ≤ ${MAX_BODY_CHARS}`
      );
    }
  });
}
