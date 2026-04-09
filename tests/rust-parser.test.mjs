import test from "node:test";
import assert from "node:assert/strict";
import { parseCode } from "../scripts/parsers/rust.mjs";
import { parseCode as parseScaffoldCode } from "../scaffold/scripts/parsers/rust.mjs";

test("rust parser extracts a simple function", () => {
  const source = [
    "fn add(a: i32, b: i32) -> i32 {",
    "    a + b",
    "}"
  ].join("\n");

  const result = parseCode(source, "lib.rs", "rust");
  const chunkByName = new Map(result.chunks.map((c) => [c.name, c]));

  assert.ok(chunkByName.has("add"));
  assert.equal(chunkByName.get("add").kind, "function");
  assert.equal(chunkByName.get("add").language, "rust");
  assert.equal(chunkByName.get("add").startLine, 1);
  assert.equal(chunkByName.get("add").endLine, 3);
});

test("rust parser extracts pub async unsafe const fn modifiers", () => {
  const source = [
    "pub async fn fetch_data() {",
    "    todo!()",
    "}",
    "",
    "pub unsafe fn raw_ptr() {",
    "    std::ptr::null()",
    "}",
    "",
    "pub const fn max_size() -> usize {",
    "    1024",
    "}"
  ].join("\n");

  const result = parseCode(source, "lib.rs", "rust");
  const names = result.chunks.map((c) => c.name);

  assert.ok(names.includes("fetch_data"));
  assert.ok(names.includes("raw_ptr"));
  assert.ok(names.includes("max_size"));
});

test("rust parser extracts struct definitions", () => {
  const source = [
    "pub struct Config {",
    "    pub host: String,",
    "    pub port: u16,",
    "}",
    "",
    "struct UnitStruct;"
  ].join("\n");

  const result = parseCode(source, "config.rs", "rust");
  const chunkByName = new Map(result.chunks.map((c) => [c.name, c]));

  assert.ok(chunkByName.has("Config"));
  assert.equal(chunkByName.get("Config").kind, "struct");
  assert.ok(chunkByName.has("UnitStruct"));
  assert.equal(chunkByName.get("UnitStruct").kind, "struct");
});

test("rust parser extracts enum definitions", () => {
  const source = [
    "pub enum State {",
    "    Running,",
    "    Stopped,",
    "    Error(String),",
    "}"
  ].join("\n");

  const result = parseCode(source, "state.rs", "rust");
  const chunkByName = new Map(result.chunks.map((c) => [c.name, c]));

  assert.ok(chunkByName.has("State"));
  assert.equal(chunkByName.get("State").kind, "enum");
});

test("rust parser extracts trait definitions", () => {
  const source = [
    "pub trait Handler {",
    "    fn handle(&self, request: Request) -> Response;",
    "    fn name(&self) -> &str {",
    '        "default"',
    "    }",
    "}"
  ].join("\n");

  const result = parseCode(source, "handler.rs", "rust");
  const chunkByName = new Map(result.chunks.map((c) => [c.name, c]));

  assert.ok(chunkByName.has("Handler"));
  assert.equal(chunkByName.get("Handler").kind, "trait");
});

test("rust parser extracts impl blocks with methods as Type::method", () => {
  const source = [
    "struct Foo {",
    "    value: i32,",
    "}",
    "",
    "impl Foo {",
    "    pub fn new(value: i32) -> Self {",
    "        Foo { value }",
    "    }",
    "",
    "    pub fn get_value(&self) -> i32 {",
    "        self.value",
    "    }",
    "}"
  ].join("\n");

  const result = parseCode(source, "foo.rs", "rust");
  const chunkByName = new Map(result.chunks.map((c) => [c.name, c]));

  assert.ok(chunkByName.has("Foo"), "should have struct Foo");
  assert.ok(chunkByName.has("Foo::new"), "should have Foo::new method");
  assert.ok(chunkByName.has("Foo::get_value"), "should have Foo::get_value method");
  assert.equal(chunkByName.get("Foo::new").kind, "method");
  assert.equal(chunkByName.get("Foo::get_value").kind, "method");
});

test("rust parser extracts trait impl blocks", () => {
  const source = [
    "impl Display for Foo {",
    "    fn fmt(&self, f: &mut Formatter) -> Result {",
    '        write!(f, "{}", self.value)',
    "    }",
    "}"
  ].join("\n");

  const result = parseCode(source, "foo.rs", "rust");
  const chunkByName = new Map(result.chunks.map((c) => [c.name, c]));

  assert.ok(chunkByName.has("Display for Foo"), "should have impl block");
  assert.equal(chunkByName.get("Display for Foo").kind, "impl");
  assert.ok(chunkByName.has("Foo::fmt"), "should have Foo::fmt method");
  assert.equal(chunkByName.get("Foo::fmt").kind, "method");
});

test("rust parser extracts use imports", () => {
  const source = [
    "use std::collections::HashMap;",
    "use std::io::{self, Read, Write};",
    "use crate::config::Config;",
    "",
    "fn process() {",
    "    let map = HashMap::new();",
    "}"
  ].join("\n");

  const result = parseCode(source, "main.rs", "rust");
  const fn_chunk = result.chunks.find((c) => c.name === "process");

  assert.ok(fn_chunk);
  assert.ok(fn_chunk.imports.includes("std::collections::HashMap"));
  assert.ok(fn_chunk.imports.includes("std::io::{self, Read, Write}"));
  assert.ok(fn_chunk.imports.includes("crate::config::Config"));
});

test("rust parser extracts macro_rules definitions", () => {
  const source = [
    "macro_rules! my_vec {",
    "    ( $( $x:expr ),* ) => {",
    "        {",
    "            let mut temp = Vec::new();",
    "            $( temp.push($x); )*",
    "            temp",
    "        }",
    "    };",
    "}"
  ].join("\n");

  const result = parseCode(source, "macros.rs", "rust");
  const chunkByName = new Map(result.chunks.map((c) => [c.name, c]));

  assert.ok(chunkByName.has("my_vec"));
  assert.equal(chunkByName.get("my_vec").kind, "macro");
});

test("rust parser extracts inline mod blocks", () => {
  const source = [
    "mod tests {",
    "    use super::*;",
    "",
    "    fn test_add() {",
    "        assert_eq!(add(1, 2), 3);",
    "    }",
    "}"
  ].join("\n");

  const result = parseCode(source, "lib.rs", "rust");
  const chunkByName = new Map(result.chunks.map((c) => [c.name, c]));

  assert.ok(chunkByName.has("tests"));
  assert.equal(chunkByName.get("tests").kind, "module");
});

test("rust parser extracts call relationships", () => {
  const source = [
    "fn helper() -> i32 {",
    "    42",
    "}",
    "",
    "fn main() {",
    "    let x = helper();",
    "    let y = compute(x);",
    "    process_result(y);",
    "}"
  ].join("\n");

  const result = parseCode(source, "main.rs", "rust");
  const main_chunk = result.chunks.find((c) => c.name === "main");

  assert.ok(main_chunk);
  assert.ok(main_chunk.calls.includes("helper"));
  assert.ok(main_chunk.calls.includes("compute"));
  assert.ok(main_chunk.calls.includes("process_result"));
});

test("rust parser handles nested braces in closures and match", () => {
  const source = [
    "fn complex() {",
    "    let items = vec![1, 2, 3];",
    "    let result = items.iter().map(|x| {",
    "        match x {",
    "            1 => { do_one() }",
    "            _ => { do_other() }",
    "        }",
    "    }).collect();",
    "}"
  ].join("\n");

  const result = parseCode(source, "lib.rs", "rust");
  const fn_chunk = result.chunks.find((c) => c.name === "complex");

  assert.ok(fn_chunk);
  assert.equal(fn_chunk.kind, "function");
  assert.equal(fn_chunk.startLine, 1);
  assert.equal(fn_chunk.endLine, 9);
});

test("rust parser does not duplicate methods as top-level functions", () => {
  const source = [
    "impl Bar {",
    "    fn baz() {",
    "        something()",
    "    }",
    "}",
    "",
    "fn standalone() {",
    "    other()",
    "}"
  ].join("\n");

  const result = parseCode(source, "bar.rs", "rust");
  const names = result.chunks.map((c) => c.name);

  // baz should appear as Bar::baz (method), not as standalone baz (function)
  assert.ok(names.includes("Bar::baz"));
  assert.ok(!names.includes("baz"), "bare 'baz' should not appear as top-level function");
  assert.ok(names.includes("standalone"));
});

test("rust parser handles impl inside mod without duplication", () => {
  const source = [
    "mod inner {",
    "    struct Widget {",
    "        id: u32,",
    "    }",
    "",
    "    impl Widget {",
    "        fn new(id: u32) -> Self {",
    "            Widget { id }",
    "        }",
    "    }",
    "}",
    "",
    "fn top_level() {",
    "    other()",
    "}"
  ].join("\n");

  const result = parseCode(source, "lib.rs", "rust");
  const names = result.chunks.map((c) => c.name);

  assert.ok(names.includes("inner"), "should have module");
  assert.ok(names.includes("Widget"), "should have struct");
  assert.ok(names.includes("Widget::new"), "should have method");
  assert.ok(names.includes("top_level"), "should have top-level fn");
  // "new" should not appear as a bare top-level function
  assert.ok(!names.includes("new"), "bare 'new' should not appear as top-level function");
});

test("rust parser skips braces in comments when finding open brace", () => {
  const source = [
    "fn foo() // { not this brace",
    "{",
    "    bar()",
    "}"
  ].join("\n");

  const result = parseCode(source, "lib.rs", "rust");
  const fn_chunk = result.chunks.find((c) => c.name === "foo");

  assert.ok(fn_chunk);
  assert.equal(fn_chunk.kind, "function");
  assert.equal(fn_chunk.startLine, 1);
  assert.equal(fn_chunk.endLine, 4);
});

test("rust parser returns empty for non-Rust content", () => {
  const source = "This is just a plain text file with no Rust code.";
  const result = parseCode(source, "readme.txt", "rust");

  assert.deepEqual(result.errors, []);
  assert.equal(result.chunks.length, 0);
});

test("scaffold rust parser produces same results as main parser", () => {
  const source = [
    "pub fn greet(name: &str) -> String {",
    '    format!("Hello, {}!", name)',
    "}",
    "",
    "struct Person {",
    "    name: String,",
    "}",
    "",
    "impl Person {",
    "    fn new(name: String) -> Self {",
    "        Person { name }",
    "    }",
    "}"
  ].join("\n");

  const mainResult = parseCode(source, "lib.rs", "rust");
  const scaffoldResult = parseScaffoldCode(source, "lib.rs", "rust");

  assert.deepEqual(mainResult.chunks.length, scaffoldResult.chunks.length);
  assert.deepEqual(
    mainResult.chunks.map((c) => c.name).sort(),
    scaffoldResult.chunks.map((c) => c.name).sort()
  );
});
