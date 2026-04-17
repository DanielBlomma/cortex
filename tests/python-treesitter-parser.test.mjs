import test from "node:test";
import assert from "node:assert/strict";
import { parseCode } from "../scripts/parsers/python-treesitter.mjs";

test("python parser extracts a simple function", () => {
  const source = [
    "def add(a, b):",
    "    return a + b"
  ].join("\n");

  const result = parseCode(source, "math.py", "python");
  const byName = new Map(result.chunks.map((c) => [c.name, c]));

  assert.ok(byName.has("add"));
  assert.equal(byName.get("add").kind, "function");
  assert.equal(byName.get("add").language, "python");
  assert.equal(byName.get("add").exported, true);
  assert.equal(byName.get("add").startLine, 1);
});

test("python parser extracts async def as function", () => {
  const source = [
    "async def fetch():",
    "    await http_get()"
  ].join("\n");

  const result = parseCode(source, "async.py", "python");
  const chunk = result.chunks.find((c) => c.name === "fetch");

  assert.ok(chunk);
  assert.equal(chunk.kind, "function");
  assert.ok(chunk.signature.startsWith("async def"));
});

test("python parser extracts class and its methods qualified as Class.method", () => {
  const source = [
    "class Service:",
    "    def run(self):",
    "        return self.x",
    "    async def fetch(self):",
    "        return await self.client.get()"
  ].join("\n");

  const result = parseCode(source, "service.py", "python");
  const names = new Set(result.chunks.map((c) => c.name));

  assert.ok(names.has("Service"));
  assert.ok(names.has("Service.run"));
  assert.ok(names.has("Service.fetch"));

  const run = result.chunks.find((c) => c.name === "Service.run");
  assert.equal(run.kind, "method");

  const cls = result.chunks.find((c) => c.name === "Service");
  assert.equal(cls.kind, "class");
});

test("python parser qualifies nested classes and methods", () => {
  const source = [
    "class Outer:",
    "    class Inner:",
    "        def deep(self):",
    "            return 1"
  ].join("\n");

  const result = parseCode(source, "nested.py", "python");
  const names = new Set(result.chunks.map((c) => c.name));

  assert.ok(names.has("Outer"));
  assert.ok(names.has("Outer.Inner"));
  assert.ok(names.has("Outer.Inner.deep"));
});

test("python parser marks underscore-prefixed names as not exported", () => {
  const source = [
    "def _private_helper():",
    "    return 1",
    "",
    "def public_fn():",
    "    return _private_helper()"
  ].join("\n");

  const result = parseCode(source, "mod.py", "python");
  const priv = result.chunks.find((c) => c.name === "_private_helper");
  const pub = result.chunks.find((c) => c.name === "public_fn");

  assert.equal(priv.exported, false);
  assert.equal(pub.exported, true);
});

test("python parser extracts direct and attribute calls", () => {
  const source = [
    "def main():",
    "    helper()",
    "    obj.method()",
    "    mod.submod.call()"
  ].join("\n");

  const result = parseCode(source, "main.py", "python");
  const main = result.chunks.find((c) => c.name === "main");

  assert.ok(main);
  assert.ok(main.calls.includes("helper"));
  assert.ok(main.calls.includes("method"));
  assert.ok(main.calls.includes("call"));
});

test("python parser filters out common builtins from call edges", () => {
  const source = [
    "def wrapper():",
    "    print('hi')",
    "    items = list(range(10))",
    "    real_call(items)"
  ].join("\n");

  const result = parseCode(source, "mod.py", "python");
  const chunk = result.chunks.find((c) => c.name === "wrapper");

  assert.ok(chunk);
  assert.ok(chunk.calls.includes("real_call"));
  assert.ok(!chunk.calls.includes("print"));
  assert.ok(!chunk.calls.includes("list"));
  assert.ok(!chunk.calls.includes("range"));
});

test("python parser extracts plain and aliased import statements", () => {
  const source = [
    "import os",
    "import json as j",
    "",
    "def use():",
    "    return os.getcwd()"
  ].join("\n");

  const result = parseCode(source, "mod.py", "python");
  const chunk = result.chunks.find((c) => c.name === "use");

  assert.ok(chunk);
  assert.ok(chunk.imports.includes("os"));
  assert.ok(chunk.imports.includes("json"));
});

test("python parser extracts from-import statements", () => {
  const source = [
    "from pathlib import Path",
    "from collections import OrderedDict as ODict",
    "",
    "def use():",
    "    return Path('.')"
  ].join("\n");

  const result = parseCode(source, "mod.py", "python");
  const chunk = result.chunks.find((c) => c.name === "use");

  assert.ok(chunk);
  assert.ok(chunk.imports.includes("pathlib.Path"));
  assert.ok(chunk.imports.includes("collections.OrderedDict"));
});

test("python parser extracts relative from-imports with leading dots", () => {
  const source = [
    "from .util import helper",
    "from ..pkg import foo",
    "",
    "def use():",
    "    helper()"
  ].join("\n");

  const result = parseCode(source, "sub/mod.py", "python");
  const chunk = result.chunks.find((c) => c.name === "use");

  assert.ok(chunk);
  assert.ok(chunk.imports.some((i) => i.includes(".util") && i.includes("helper")));
  assert.ok(chunk.imports.some((i) => i.includes("..pkg") && i.includes("foo")));
});

test("python parser handles decorated functions", () => {
  const source = [
    "@property",
    "@staticmethod",
    "def cached_value():",
    "    return compute()"
  ].join("\n");

  const result = parseCode(source, "mod.py", "python");
  const chunk = result.chunks.find((c) => c.name === "cached_value");

  assert.ok(chunk);
  assert.equal(chunk.kind, "function");
  assert.ok(chunk.calls.includes("compute"));
});

test("python parser handles empty input without errors", () => {
  const result = parseCode("", "empty.py", "python");
  assert.deepEqual(result.errors, []);
  assert.equal(result.chunks.length, 0);
});

test("python parser handles non-Python text without chunks", () => {
  const result = parseCode("just some plain text here", "notes.txt", "python");
  assert.equal(result.chunks.length, 0);
});
