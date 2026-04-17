import test from "node:test";
import assert from "node:assert/strict";
import { parseCode } from "../scaffold/scripts/parsers/rust-treesitter.mjs";
import { parseCode as parseRegexCode } from "../scaffold/scripts/parsers/rust.mjs";

test("tree-sitter rust parser extracts a simple function", async () => {
  const source = [
    "fn add(a: i32, b: i32) -> i32 {",
    "    a + b",
    "}"
  ].join("\n");

  const result = await parseCode(source, "lib.rs", "rust");
  const chunkByName = new Map(result.chunks.map((c) => [c.name, c]));

  assert.ok(chunkByName.has("add"));
  assert.equal(chunkByName.get("add").kind, "function");
  assert.equal(chunkByName.get("add").language, "rust");
  assert.equal(chunkByName.get("add").startLine, 1);
  assert.equal(chunkByName.get("add").endLine, 3);
});

test("tree-sitter rust parser extracts pub async unsafe const fn modifiers", async () => {
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

  const result = await parseCode(source, "lib.rs", "rust");
  const names = result.chunks.map((c) => c.name);

  assert.ok(names.includes("fetch_data"));
  assert.ok(names.includes("raw_ptr"));
  assert.ok(names.includes("max_size"));
});

test("tree-sitter rust parser extracts struct definitions including unit struct", async () => {
  const source = [
    "pub struct Config {",
    "    pub host: String,",
    "    pub port: u16,",
    "}",
    "",
    "struct UnitStruct;"
  ].join("\n");

  const result = await parseCode(source, "config.rs", "rust");
  const chunkByName = new Map(result.chunks.map((c) => [c.name, c]));

  assert.ok(chunkByName.has("Config"));
  assert.equal(chunkByName.get("Config").kind, "struct");
  assert.ok(chunkByName.has("UnitStruct"));
  assert.equal(chunkByName.get("UnitStruct").kind, "struct");
});

test("tree-sitter rust parser extracts enum definitions", async () => {
  const source = [
    "pub enum State {",
    "    Running,",
    "    Stopped,",
    "    Error(String),",
    "}"
  ].join("\n");

  const result = await parseCode(source, "state.rs", "rust");
  const chunkByName = new Map(result.chunks.map((c) => [c.name, c]));

  assert.ok(chunkByName.has("State"));
  assert.equal(chunkByName.get("State").kind, "enum");
});

test("tree-sitter rust parser extracts trait definitions", async () => {
  const source = [
    "pub trait Handler {",
    "    fn handle(&self, request: Request) -> Response;",
    "    fn name(&self) -> &str {",
    '        "default"',
    "    }",
    "}"
  ].join("\n");

  const result = await parseCode(source, "handler.rs", "rust");
  const chunkByName = new Map(result.chunks.map((c) => [c.name, c]));

  assert.ok(chunkByName.has("Handler"));
  assert.equal(chunkByName.get("Handler").kind, "trait");
});

test("tree-sitter rust parser extracts impl blocks with methods as Type::method", async () => {
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

  const result = await parseCode(source, "foo.rs", "rust");
  const chunkByName = new Map(result.chunks.map((c) => [c.name, c]));

  assert.ok(chunkByName.has("Foo"), "should have struct Foo");
  assert.ok(chunkByName.has("Foo::new"), "should have Foo::new method");
  assert.ok(chunkByName.has("Foo::get_value"), "should have Foo::get_value method");
  assert.equal(chunkByName.get("Foo::new").kind, "method");
  assert.equal(chunkByName.get("Foo::get_value").kind, "method");
});

test("tree-sitter rust parser extracts trait impl blocks", async () => {
  const source = [
    "impl Display for Foo {",
    "    fn fmt(&self, f: &mut Formatter) -> Result {",
    '        write!(f, "{}", self.value)',
    "    }",
    "}"
  ].join("\n");

  const result = await parseCode(source, "foo.rs", "rust");
  const chunkByName = new Map(result.chunks.map((c) => [c.name, c]));

  assert.ok(chunkByName.has("Display for Foo"), "should have impl block");
  assert.equal(chunkByName.get("Display for Foo").kind, "impl");
  assert.ok(chunkByName.has("Foo::fmt"), "should have Foo::fmt method");
  assert.equal(chunkByName.get("Foo::fmt").kind, "method");
});

test("tree-sitter rust parser extracts use imports", async () => {
  const source = [
    "use std::collections::HashMap;",
    "use std::io::{self, Read, Write};",
    "use crate::config::Config;",
    "",
    "fn process() {",
    "    let map = HashMap::new();",
    "}"
  ].join("\n");

  const result = await parseCode(source, "main.rs", "rust");
  const fn_chunk = result.chunks.find((c) => c.name === "process");

  assert.ok(fn_chunk);
  assert.ok(fn_chunk.imports.includes("std::collections::HashMap"));
  assert.ok(fn_chunk.imports.some((i) => i.includes("std::io")));
  assert.ok(fn_chunk.imports.includes("crate::config::Config"));
});

test("tree-sitter rust parser extracts macro_rules definitions", async () => {
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

  const result = await parseCode(source, "macros.rs", "rust");
  const chunkByName = new Map(result.chunks.map((c) => [c.name, c]));

  assert.ok(chunkByName.has("my_vec"));
  assert.equal(chunkByName.get("my_vec").kind, "macro");
});

test("tree-sitter rust parser extracts inline mod blocks", async () => {
  const source = [
    "mod tests {",
    "    use super::*;",
    "",
    "    fn test_add() {",
    "        assert_eq!(add(1, 2), 3);",
    "    }",
    "}"
  ].join("\n");

  const result = await parseCode(source, "lib.rs", "rust");
  const chunkByName = new Map(result.chunks.map((c) => [c.name, c]));

  assert.ok(chunkByName.has("tests"));
  assert.equal(chunkByName.get("tests").kind, "module");
});

test("tree-sitter rust parser extracts call relationships", async () => {
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

  const result = await parseCode(source, "main.rs", "rust");
  const main_chunk = result.chunks.find((c) => c.name === "main");

  assert.ok(main_chunk);
  assert.ok(main_chunk.calls.includes("helper"));
  assert.ok(main_chunk.calls.includes("compute"));
  assert.ok(main_chunk.calls.includes("process_result"));
});

test("tree-sitter rust parser handles nested braces in closures and match", async () => {
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

  const result = await parseCode(source, "lib.rs", "rust");
  const fn_chunk = result.chunks.find((c) => c.name === "complex");

  assert.ok(fn_chunk);
  assert.equal(fn_chunk.kind, "function");
  assert.equal(fn_chunk.startLine, 1);
  assert.equal(fn_chunk.endLine, 9);
});

test("tree-sitter rust parser does not duplicate methods as top-level functions", async () => {
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

  const result = await parseCode(source, "bar.rs", "rust");
  const names = result.chunks.map((c) => c.name);

  assert.ok(names.includes("Bar::baz"));
  assert.ok(!names.includes("baz"), "bare 'baz' should not appear as top-level function");
  assert.ok(names.includes("standalone"));
});

test("tree-sitter rust parser handles impl inside mod without duplication", async () => {
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

  const result = await parseCode(source, "lib.rs", "rust");
  const names = result.chunks.map((c) => c.name);

  assert.ok(names.includes("inner"), "should have module");
  assert.ok(names.includes("Widget"), "should have struct");
  assert.ok(names.includes("Widget::new"), "should have method");
  assert.ok(names.includes("top_level"), "should have top-level fn");
  assert.ok(!names.includes("new"), "bare 'new' should not appear as top-level function");
});

test("tree-sitter rust parser skips braces in comments when finding function body", async () => {
  const source = [
    "fn foo() // { not this brace",
    "{",
    "    bar()",
    "}"
  ].join("\n");

  const result = await parseCode(source, "lib.rs", "rust");
  const fn_chunk = result.chunks.find((c) => c.name === "foo");

  assert.ok(fn_chunk);
  assert.equal(fn_chunk.kind, "function");
  assert.equal(fn_chunk.startLine, 1);
  assert.equal(fn_chunk.endLine, 4);
});

test("tree-sitter rust parser returns empty chunks for non-Rust content", async () => {
  const source = "This is just a plain text file with no Rust code.";
  const result = await parseCode(source, "readme.txt", "rust");

  assert.deepEqual(result.errors, []);
  assert.equal(result.chunks.length, 0);
});

// New tests — cases the regex parser struggles with or misses.

test("tree-sitter rust parser handles generic impl blocks with bounds", async () => {
  const source = [
    "impl<T: Clone + Send> Wrapper<T> {",
    "    pub fn new(value: T) -> Self {",
    "        Wrapper { inner: value }",
    "    }",
    "    pub fn get(&self) -> T {",
    "        self.inner.clone()",
    "    }",
    "}"
  ].join("\n");

  const result = await parseCode(source, "wrapper.rs", "rust");
  const names = result.chunks.map((c) => c.name);

  assert.ok(names.includes("Wrapper"), "impl block should be keyed by type name Wrapper");
  assert.ok(names.includes("Wrapper::new"), "generic impl methods should be qualified by type name");
  assert.ok(names.includes("Wrapper::get"));
});

test("tree-sitter rust parser handles cfg-gated items", async () => {
  const source = [
    '#[cfg(target_os = "linux")]',
    "fn linux_only() -> u32 {",
    "    42",
    "}",
    "",
    '#[cfg(not(target_os = "linux"))]',
    "fn other_platform() -> u32 {",
    "    0",
    "}"
  ].join("\n");

  const result = await parseCode(source, "platform.rs", "rust");
  const names = result.chunks.map((c) => c.name);

  assert.ok(names.includes("linux_only"));
  assert.ok(names.includes("other_platform"));
});

test("tree-sitter rust parser handles nested modules", async () => {
  const source = [
    "mod outer {",
    "    mod middle {",
    "        mod inner {",
    "            fn deep() -> i32 { 0 }",
    "        }",
    "    }",
    "}"
  ].join("\n");

  const result = await parseCode(source, "nested.rs", "rust");
  const names = result.chunks.map((c) => c.name);

  assert.ok(names.includes("outer"));
  assert.ok(names.includes("middle"));
  assert.ok(names.includes("inner"));
});

test("tree-sitter rust parser handles generic trait impl", async () => {
  const source = [
    "impl<T> Iterator for Counter<T> {",
    "    type Item = T;",
    "    fn next(&mut self) -> Option<T> {",
    "        None",
    "    }",
    "}"
  ].join("\n");

  const result = await parseCode(source, "counter.rs", "rust");
  const chunkByName = new Map(result.chunks.map((c) => [c.name, c]));

  assert.ok(chunkByName.has("Iterator for Counter"));
  assert.equal(chunkByName.get("Iterator for Counter").kind, "impl");
  assert.ok(chunkByName.has("Counter::next"));
});

test("tree-sitter rust parser matches regex parser on shared-surface input", async () => {
  const source = [
    "use std::collections::HashMap;",
    "",
    "pub struct Cache {",
    "    map: HashMap<String, String>,",
    "}",
    "",
    "impl Cache {",
    "    pub fn new() -> Self {",
    "        Cache { map: HashMap::new() }",
    "    }",
    "    pub fn get(&self, key: &str) -> Option<&String> {",
    "        self.map.get(key)",
    "    }",
    "}"
  ].join("\n");

  const tsResult = await parseCode(source, "cache.rs", "rust");
  const regexResult = parseRegexCode(source, "cache.rs", "rust");

  const tsNames = new Set(tsResult.chunks.map((c) => c.name));
  const regexNames = new Set(regexResult.chunks.map((c) => c.name));

  for (const name of regexNames) {
    assert.ok(tsNames.has(name), `tree-sitter missing chunk that regex produced: ${name}`);
  }
});
