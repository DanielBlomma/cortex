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
 * Verifies that every tree-sitter parser reports syntax errors with
 * line/column info instead of silently returning errors: []. Ensures
 * parity across all supported tree-sitter languages per the project
 * parser-parity rule.
 */

const CASES = [
  {
    name: "rust",
    parse: parseRust,
    file: "broken.rs",
    valid: "fn add(a: i32, b: i32) -> i32 { a + b }\n",
    malformed: "fn add(a: i32, b: i32 -> i32 {\n    a + b\n"
  },
  {
    name: "python",
    parse: parsePython,
    file: "broken.py",
    valid: "def add(a, b):\n    return a + b\n",
    malformed: "def add(a, b:\n    return a +\n"
  },
  {
    name: "java",
    parse: parseJava,
    file: "Broken.java",
    valid: "class A { int add(int a, int b) { return a + b; } }\n",
    malformed: "class A { int add(int a, int b { return a + b; } }\n"
  },
  {
    name: "go",
    parse: parseGo,
    file: "broken.go",
    valid: "package main\nfunc add(a, b int) int { return a + b }\n",
    malformed: "package main\nfunc add(a, b int int { return a + b\n"
  },
  {
    name: "ruby",
    parse: parseRuby,
    file: "broken.rb",
    valid: "def add(a, b)\n  a + b\nend\n",
    malformed: "def add(a, b\n  a + b\n"
  },
  {
    name: "cpp",
    parse: parseCpp,
    file: "broken.cpp",
    valid: "int add(int a, int b) { return a + b; }\n",
    malformed: "int add(int a, int b { return a + b; }\n"
  },
  {
    name: "bash",
    parse: parseBash,
    file: "broken.sh",
    valid: "add() {\n  echo $(( $1 + $2 ))\n}\n",
    malformed: "add() {\n  echo $(( $1 + $2\n"
  }
];

for (const { name, parse, file, valid, malformed } of CASES) {
  test(`tree-sitter ${name} parser: clean source has no errors`, async () => {
    const result = await parse(valid, file, name);
    assert.deepEqual(result.errors, [], `expected no errors for valid ${name} input, got ${JSON.stringify(result.errors)}`);
  });

  test(`tree-sitter ${name} parser: malformed source reports errors with line/column`, async () => {
    const result = await parse(malformed, file, name);
    assert.ok(
      result.errors.length > 0,
      `expected at least one error for malformed ${name} input, got none`
    );

    const first = result.errors[0];
    assert.equal(typeof first.message, "string", `${name}: error.message should be a string`);
    assert.equal(typeof first.line, "number", `${name}: error.line should be a number`);
    assert.equal(typeof first.column, "number", `${name}: error.column should be a number`);
    assert.ok(first.line >= 1, `${name}: error.line should be 1-based`);
    assert.ok(first.column >= 1, `${name}: error.column should be 1-based`);
  });
}
