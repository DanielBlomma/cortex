import test from "node:test";
import assert from "node:assert/strict";
import { parseCode } from "../scripts/parsers/go-treesitter.mjs";

test("go parser extracts a top-level function", async () => {
  const source = [
    "package main",
    "",
    "func Add(a, b int) int {",
    "    return a + b",
    "}"
  ].join("\n");

  const result = await parseCode(source, "math.go", "go");
  const chunk = result.chunks.find((c) => c.name === "Add");

  assert.ok(chunk);
  assert.equal(chunk.kind, "function");
  assert.equal(chunk.language, "go");
  assert.equal(chunk.exported, true);
});

test("go parser marks lowercase-first-letter names as not exported", async () => {
  const source = [
    "package m",
    "func helper() int { return 1 }",
    "func Exported() int { return 2 }"
  ].join("\n");

  const result = await parseCode(source, "m.go", "go");
  const helper = result.chunks.find((c) => c.name === "helper");
  const exported = result.chunks.find((c) => c.name === "Exported");

  assert.equal(helper.exported, false);
  assert.equal(exported.exported, true);
});

test("go parser extracts methods qualified by value receiver type", async () => {
  const source = [
    "package m",
    "type S struct{}",
    "func (s S) Name() string { return \"s\" }"
  ].join("\n");

  const result = await parseCode(source, "s.go", "go");
  const names = result.chunks.map((c) => c.name);

  assert.ok(names.includes("S"));
  assert.ok(names.includes("S.Name"));
  const method = result.chunks.find((c) => c.name === "S.Name");
  assert.equal(method.kind, "method");
});

test("go parser unifies pointer and value receivers under the same type name", async () => {
  const source = [
    "package m",
    "type Box struct{ v int }",
    "func (b *Box) Set(v int) { b.v = v }",
    "func (b Box) Get() int { return b.v }"
  ].join("\n");

  const result = await parseCode(source, "box.go", "go");
  const names = result.chunks.map((c) => c.name);

  assert.ok(names.includes("Box.Set"));
  assert.ok(names.includes("Box.Get"));
});

test("go parser extracts struct and interface types", async () => {
  const source = [
    "package m",
    "type Config struct {",
    "    Host string",
    "    Port int",
    "}",
    "type Handler interface {",
    "    Handle() Response",
    "}"
  ].join("\n");

  const result = await parseCode(source, "types.go", "go");
  const byName = new Map(result.chunks.map((c) => [c.name, c]));

  assert.ok(byName.has("Config"));
  assert.equal(byName.get("Config").kind, "struct");
  assert.ok(byName.has("Handler"));
  assert.equal(byName.get("Handler").kind, "interface");
});

test("go parser extracts type aliases", async () => {
  const source = [
    "package m",
    "type UserID int64",
    "type StringMap = map[string]string"
  ].join("\n");

  const result = await parseCode(source, "types.go", "go");
  const byName = new Map(result.chunks.map((c) => [c.name, c]));

  assert.ok(byName.has("UserID"));
  assert.equal(byName.get("UserID").kind, "type");
  assert.ok(byName.has("StringMap"));
  assert.equal(byName.get("StringMap").kind, "type");
});

test("go parser extracts imports including aliased and grouped", async () => {
  const source = [
    "package m",
    "",
    "import \"fmt\"",
    "import (",
    "    \"os\"",
    "    s \"strings\"",
    "    \"github.com/foo/bar\"",
    ")",
    "",
    "func Run() {",
    "    fmt.Println()",
    "}"
  ].join("\n");

  const result = await parseCode(source, "m.go", "go");
  const chunk = result.chunks.find((c) => c.name === "Run");

  assert.ok(chunk);
  assert.ok(chunk.imports.includes("fmt"));
  assert.ok(chunk.imports.includes("os"));
  assert.ok(chunk.imports.includes("strings"));
  assert.ok(chunk.imports.includes("github.com/foo/bar"));
});

test("go parser extracts direct and selector calls", async () => {
  const source = [
    "package m",
    "func Run() {",
    "    helper()",
    "    fmt.Println(\"hi\")",
    "    pkg.sub.Call()",
    "    obj.Method(1)",
    "}"
  ].join("\n");

  const result = await parseCode(source, "r.go", "go");
  const chunk = result.chunks.find((c) => c.name === "Run");

  assert.ok(chunk);
  assert.ok(chunk.calls.includes("helper"));
  assert.ok(chunk.calls.includes("Println"));
  assert.ok(chunk.calls.includes("Call"));
  assert.ok(chunk.calls.includes("Method"));
});

test("go parser filters out builtins like make, new, len, append", async () => {
  const source = [
    "package m",
    "func Build() []int {",
    "    s := make([]int, 0)",
    "    s = append(s, 1)",
    "    _ = len(s)",
    "    realCall(s)",
    "    return s",
    "}"
  ].join("\n");

  const result = await parseCode(source, "b.go", "go");
  const chunk = result.chunks.find((c) => c.name === "Build");

  assert.ok(chunk);
  assert.ok(chunk.calls.includes("realCall"));
  assert.ok(!chunk.calls.includes("make"));
  assert.ok(!chunk.calls.includes("append"));
  assert.ok(!chunk.calls.includes("len"));
});

test("go parser handles generic functions", async () => {
  const source = [
    "package m",
    "func Map[T, U any](items []T, fn func(T) U) []U {",
    "    result := make([]U, 0, len(items))",
    "    for _, item := range items {",
    "        result = append(result, fn(item))",
    "    }",
    "    return result",
    "}"
  ].join("\n");

  const result = await parseCode(source, "m.go", "go");
  const chunk = result.chunks.find((c) => c.name === "Map");

  assert.ok(chunk);
  assert.equal(chunk.kind, "function");
  assert.equal(chunk.exported, true);
});

test("go parser extracts call edges for methods", async () => {
  const source = [
    "package m",
    "type S struct{ delegate *Delegate }",
    "func (s *S) Do() {",
    "    s.delegate.Execute()",
    "    logOperation(\"done\")",
    "}"
  ].join("\n");

  const result = await parseCode(source, "s.go", "go");
  const method = result.chunks.find((c) => c.name === "S.Do");

  assert.ok(method);
  assert.ok(method.calls.includes("Execute"));
  assert.ok(method.calls.includes("logOperation"));
});

test("go parser handles empty input without errors", async () => {
  const result = await parseCode("", "empty.go", "go");
  assert.deepEqual(result.errors, []);
  assert.equal(result.chunks.length, 0);
});

test("go parser handles package-only input", async () => {
  const result = await parseCode("package empty", "e.go", "go");
  assert.deepEqual(result.errors, []);
  assert.equal(result.chunks.length, 0);
});
