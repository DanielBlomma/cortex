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
 * Robustness tests per the parser-parity project rule. Each tree-sitter
 * parser must survive:
 *   - Unicode identifiers (non-ASCII names)
 *   - BOM at start of file
 *   - CRLF line endings
 *   - Oversize input (hit the CORTEX_TREE_SITTER_MAX_BYTES guard)
 * without throwing, producing corrupt output, or hanging.
 */

const PARSERS = [
  {
    name: "rust",
    parse: parseRust,
    file: "mod.rs",
    unicode: `fn greet_世界() -> &'static str { "hello" }\n`,
    simple: `fn add(a: i32, b: i32) -> i32 { a + b }\n`,
    expectName: "add"
  },
  {
    name: "python",
    parse: parsePython,
    file: "mod.py",
    unicode: `def greet_世界():\n    return "hello"\n`,
    simple: `def add(a, b):\n    return a + b\n`,
    expectName: "add"
  },
  {
    name: "java",
    parse: parseJava,
    file: "Mod.java",
    unicode: `class Greeter { String greet世界() { return "hi"; } }\n`,
    simple: `class A { int add(int a, int b) { return a + b; } }\n`,
    expectName: "A.add"
  },
  {
    name: "go",
    parse: parseGo,
    file: "mod.go",
    unicode: `package main\nfunc Greet世界() string { return "hi" }\n`,
    simple: `package main\nfunc Add(a, b int) int { return a + b }\n`,
    expectName: "Add"
  },
  {
    name: "ruby",
    parse: parseRuby,
    file: "mod.rb",
    unicode: `def greet_世界\n  "hi"\nend\n`,
    simple: `def add(a, b)\n  a + b\nend\n`,
    expectName: "add"
  },
  {
    name: "cpp",
    parse: parseCpp,
    file: "mod.cpp",
    // C++ identifiers can be Unicode since C++11 (N2249).
    unicode: `int greet世界() { return 1; }\n`,
    simple: `int add(int a, int b) { return a + b; }\n`,
    expectName: "add"
  },
  {
    name: "bash",
    parse: parseBash,
    file: "mod.sh",
    unicode: `greet_世界() {\n  echo hi\n}\n`,
    simple: `add() {\n  echo $(( $1 + $2 ))\n}\n`,
    expectName: "add"
  }
];

for (const { name, parse, file, unicode, simple, expectName } of PARSERS) {
  test(`${name}: handles Unicode identifiers without throwing`, async () => {
    const result = await parse(unicode, file, name);
    assert.ok(Array.isArray(result.chunks), `${name}: expected chunks array`);
    assert.ok(Array.isArray(result.errors), `${name}: expected errors array`);
    // Minimum guarantee: parser doesn't throw. Unicode identifier may or
    // may not produce a chunk depending on grammar; both are acceptable
    // so long as the parser returned a shape.
  });

  test(`${name}: handles UTF-8 BOM at start of file`, async () => {
    const withBom = "\uFEFF" + simple;
    const result = await parse(withBom, file, name);
    assert.ok(Array.isArray(result.chunks));
    const names = new Set(result.chunks.map((c) => c.name));
    assert.ok(
      names.has(expectName),
      `${name}: expected chunk "${expectName}" after BOM, got ${JSON.stringify([...names])}`
    );
  });

  test(`${name}: handles CRLF line endings`, async () => {
    const crlf = simple.replace(/\n/g, "\r\n");
    const result = await parse(crlf, file, name);
    const names = new Set(result.chunks.map((c) => c.name));
    assert.ok(
      names.has(expectName),
      `${name}: expected chunk "${expectName}" with CRLF, got ${JSON.stringify([...names])}`
    );
  });

  test(`${name}: oversize input returns error without throwing`, async () => {
    const prev = process.env.CORTEX_TREE_SITTER_MAX_BYTES;
    process.env.CORTEX_TREE_SITTER_MAX_BYTES = "1024";
    try {
      const huge = simple + "// " + "x".repeat(2000) + "\n";
      const result = await parse(huge, file, name);
      assert.deepEqual(result.chunks, [], `${name}: expected empty chunks for oversize input`);
      assert.ok(result.errors.length > 0, `${name}: expected an error for oversize input`);
      assert.match(
        result.errors[0].message,
        /CORTEX_TREE_SITTER_MAX_BYTES|exceeds/,
        `${name}: error message should reference the size limit`
      );
    } finally {
      if (prev === undefined) delete process.env.CORTEX_TREE_SITTER_MAX_BYTES;
      else process.env.CORTEX_TREE_SITTER_MAX_BYTES = prev;
    }
  });
}
