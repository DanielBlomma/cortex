import test from "node:test";
import assert from "node:assert/strict";
import { parseCode } from "../scripts/parsers/cpp-treesitter.mjs";

test("cpp parser extracts a top-level C function", () => {
  const source = "int add(int a, int b) { return a + b; }";

  const result = parseCode(source, "math.c", "c");
  const chunk = result.chunks.find((c) => c.name === "add");

  assert.ok(chunk);
  assert.equal(chunk.kind, "function");
  assert.equal(chunk.language, "c");
});

test("cpp parser extracts a C++ class with inline method qualified as Class::method", () => {
  const source = [
    "class Foo {",
    "public:",
    "  int bar(int x) { return x + 1; }",
    "};"
  ].join("\n");

  const result = parseCode(source, "foo.cpp", "cpp");
  const names = new Set(result.chunks.map((c) => c.name));

  assert.ok(names.has("Foo"));
  assert.ok(names.has("Foo::bar"));
  const method = result.chunks.find((c) => c.name === "Foo::bar");
  assert.equal(method.kind, "method");
});

test("cpp parser extracts out-of-class method definitions", () => {
  const source = [
    "class Foo {",
    "public:",
    "  int bar();",
    "};",
    "int Foo::bar() { return 42; }"
  ].join("\n");

  const result = parseCode(source, "foo.cpp", "cpp");
  const names = result.chunks.map((c) => c.name);

  assert.ok(names.includes("Foo"));
  assert.ok(names.includes("Foo::bar"));
});

test("cpp parser extracts struct, union, and enum types", () => {
  const source = [
    "struct Point { int x; int y; };",
    "union Data { int i; float f; };",
    "enum State { IDLE, RUNNING };",
    "enum class Color { RED, GREEN };"
  ].join("\n");

  const result = parseCode(source, "types.cpp", "cpp");
  const byName = new Map(result.chunks.map((c) => [c.name, c]));

  assert.equal(byName.get("Point").kind, "struct");
  assert.equal(byName.get("Data").kind, "union");
  assert.equal(byName.get("State").kind, "enum");
  assert.equal(byName.get("Color").kind, "enum");
});

test("cpp parser qualifies methods inside namespaces", () => {
  const source = [
    "namespace app {",
    "  int handler(int x) { return x; }",
    "  class Service {",
    "  public:",
    "    void run() { }",
    "  };",
    "}"
  ].join("\n");

  const result = parseCode(source, "app.cpp", "cpp");
  const names = new Set(result.chunks.map((c) => c.name));

  assert.ok(names.has("app"));
  assert.ok(names.has("app::handler"));
  assert.ok(names.has("app::Service"));
  assert.ok(names.has("app::Service::run"));
});

test("cpp parser handles nested namespace declarations (namespace a::b)", () => {
  const source = [
    "namespace a::b {",
    "  void f() { }",
    "}"
  ].join("\n");

  const result = parseCode(source, "ns.cpp", "cpp");
  const names = new Set(result.chunks.map((c) => c.name));

  assert.ok(names.has("a::b"), "nested namespace should be captured as a::b");
  assert.ok(names.has("a::b::f"));
});

test("cpp parser extracts template class and its methods", () => {
  const source = [
    "template<typename T>",
    "class Wrapper {",
    "public:",
    "  T get() const { return value; }",
    "private:",
    "  T value;",
    "};"
  ].join("\n");

  const result = parseCode(source, "wrapper.cpp", "cpp");
  const names = new Set(result.chunks.map((c) => c.name));

  assert.ok(names.has("Wrapper"));
  assert.ok(names.has("Wrapper::get"));
});

test("cpp parser extracts nested class qualified as Outer::Inner", () => {
  const source = [
    "class Outer {",
    "public:",
    "  class Inner {",
    "  public:",
    "    int deep() { return 1; }",
    "  };",
    "};"
  ].join("\n");

  const result = parseCode(source, "nested.cpp", "cpp");
  const names = new Set(result.chunks.map((c) => c.name));

  assert.ok(names.has("Outer"));
  assert.ok(names.has("Outer::Inner"));
  assert.ok(names.has("Outer::Inner::deep"));
});

test("cpp parser extracts includes (system and local)", () => {
  const source = [
    "#include <vector>",
    "#include <string>",
    "#include \"local.h\"",
    "#include \"../util/helper.hpp\"",
    "",
    "void run() { }"
  ].join("\n");

  const result = parseCode(source, "m.cpp", "cpp");
  const chunk = result.chunks.find((c) => c.name === "run");

  assert.ok(chunk);
  assert.ok(chunk.imports.includes("vector"));
  assert.ok(chunk.imports.includes("string"));
  assert.ok(chunk.imports.includes("local.h"));
  assert.ok(chunk.imports.includes("../util/helper.hpp"));
});

test("cpp parser extracts direct, member, pointer, and qualified calls", () => {
  const source = [
    "void run() {",
    "  helper();",
    "  obj.method();",
    "  ptr->method();",
    "  ns::func();",
    "  Class::staticMethod();",
    "}"
  ].join("\n");

  const result = parseCode(source, "r.cpp", "cpp");
  const chunk = result.chunks.find((c) => c.name === "run");

  assert.ok(chunk);
  assert.ok(chunk.calls.includes("helper"));
  assert.ok(chunk.calls.includes("method"));
  assert.ok(chunk.calls.includes("func"));
  assert.ok(chunk.calls.includes("staticMethod"));
});

test("cpp parser filters out builtins like sizeof, static_cast, malloc, printf", () => {
  const source = [
    "int compute() {",
    "  void* p = malloc(sizeof(int));",
    "  int n = static_cast<int>(3.14);",
    "  printf(\"%d\", n);",
    "  real_call();",
    "  free(p);",
    "  return n;",
    "}"
  ].join("\n");

  const result = parseCode(source, "c.cpp", "cpp");
  const chunk = result.chunks.find((c) => c.name === "compute");

  assert.ok(chunk);
  assert.ok(chunk.calls.includes("real_call"));
  assert.ok(!chunk.calls.includes("sizeof"));
  assert.ok(!chunk.calls.includes("static_cast"));
  assert.ok(!chunk.calls.includes("malloc"));
  assert.ok(!chunk.calls.includes("free"));
  assert.ok(!chunk.calls.includes("printf"));
});

test("cpp parser handles empty input without errors", () => {
  const result = parseCode("", "empty.cpp", "cpp");
  assert.deepEqual(result.errors, []);
  assert.equal(result.chunks.length, 0);
});

test("cpp parser handles header-only C code (no classes, no namespaces)", () => {
  const source = [
    "#ifndef UTIL_H",
    "#define UTIL_H",
    "int helper(int x);",
    "void process(void);",
    "#endif"
  ].join("\n");

  const result = parseCode(source, "util.h", "c");
  // Declarations only (no definitions) — should produce zero chunks
  // but also no errors.
  assert.deepEqual(result.errors, []);
});
