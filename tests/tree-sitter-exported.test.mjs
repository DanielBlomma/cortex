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
 * Verifies every tree-sitter parser emits a consistent `exported`
 * boolean per the project parser-parity rule. Each language gets one
 * visible declaration (should report exported=true) and one hidden
 * declaration (should report exported=false). See
 * docs/parser-exported-semantics.md for the per-language rules.
 */

async function chunksByName(parser, source, file, language) {
  const result = await parser(source, file, language);
  return new Map(result.chunks.map((c) => [c.name, c]));
}

test("rust: pub items are exported, non-pub are not", async () => {
  const source = [
    "pub fn public_fn() {}",
    "fn private_fn() {}",
    "pub struct PublicStruct;",
    "struct PrivateStruct;"
  ].join("\n");

  const m = await chunksByName(parseRust, source, "lib.rs", "rust");
  assert.equal(m.get("public_fn")?.exported, true);
  assert.equal(m.get("private_fn")?.exported, false);
  assert.equal(m.get("PublicStruct")?.exported, true);
  assert.equal(m.get("PrivateStruct")?.exported, false);
});

test("python: names without leading underscore are exported", async () => {
  const source = [
    "def api_func():",
    "    pass",
    "",
    "def _internal_func():",
    "    pass",
    "",
    "class PublicClass:",
    "    pass",
    "",
    "class _PrivateClass:",
    "    pass"
  ].join("\n");

  const m = await chunksByName(parsePython, source, "mod.py", "python");
  assert.equal(m.get("api_func")?.exported, true);
  assert.equal(m.get("_internal_func")?.exported, false);
  assert.equal(m.get("PublicClass")?.exported, true);
  assert.equal(m.get("_PrivateClass")?.exported, false);
});

test("java: public modifier determines exported", async () => {
  const source = [
    "public class Svc {",
    "  public int visible() { return 1; }",
    "  private int hidden() { return 2; }",
    "  int packagePrivate() { return 3; }",
    "}"
  ].join("\n");

  const m = await chunksByName(parseJava, source, "Svc.java", "java");
  assert.equal(m.get("Svc")?.exported, true);
  assert.equal(m.get("Svc.visible")?.exported, true);
  assert.equal(m.get("Svc.hidden")?.exported, false);
  assert.equal(m.get("Svc.packagePrivate")?.exported, false);
});

test("go: uppercase-initial names are exported", async () => {
  const source = [
    "package main",
    "",
    "func Public() {}",
    "func private() {}",
    "",
    "type PublicType struct{}",
    "type privateType struct{}"
  ].join("\n");

  const m = await chunksByName(parseGo, source, "mod.go", "go");
  assert.equal(m.get("Public")?.exported, true);
  assert.equal(m.get("private")?.exported, false);
  assert.equal(m.get("PublicType")?.exported, true);
  assert.equal(m.get("privateType")?.exported, false);
});

test("ruby: names without leading underscore are exported", async () => {
  const source = [
    "def public_method",
    "end",
    "",
    "def _internal_method",
    "end"
  ].join("\n");

  const m = await chunksByName(parseRuby, source, "mod.rb", "ruby");
  assert.equal(m.get("public_method")?.exported, true);
  assert.equal(m.get("_internal_method")?.exported, false);
});

test("cpp: access_specifier determines class-member visibility", async () => {
  const source = [
    "int free_func() { return 0; }",
    "",
    "class Widget {",
    "public:",
    "  void visible_method() {}",
    "private:",
    "  void hidden_method() {}",
    "};",
    "",
    "struct Point {",
    "  int default_public_field;",
    "};"
  ].join("\n");

  const m = await chunksByName(parseCpp, source, "widget.cpp", "cpp");
  assert.equal(m.get("free_func")?.exported, true, "free functions at namespace scope are exported");
  assert.equal(m.get("Widget")?.exported, true, "types at namespace scope are exported");
  assert.equal(m.get("Widget::visible_method")?.exported, true, "public class member");
  assert.equal(m.get("Widget::hidden_method")?.exported, false, "private class member");
});

test("bash: function names without leading underscore are exported", async () => {
  const source = [
    "public_helper() {",
    "  echo 'ok'",
    "}",
    "",
    "_internal_helper() {",
    "  echo 'hidden'",
    "}"
  ].join("\n");

  const m = await chunksByName(parseBash, source, "lib.sh", "bash");
  assert.equal(m.get("public_helper")?.exported, true);
  assert.equal(m.get("_internal_helper")?.exported, false);
});
