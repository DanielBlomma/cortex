import test from "node:test";
import assert from "node:assert/strict";
import {
  getCSharpParserRuntime,
  isCSharpParserAvailable,
  parseCode,
  resetCSharpParserRuntimeCache
} from "../scripts/parsers/csharp.mjs";
import {
  getCSharpParserRuntime as getScaffoldCSharpParserRuntime,
  parseCode as parseScaffoldCSharpCode,
  resetCSharpParserRuntimeCache as resetScaffoldCSharpParserRuntimeCache
} from "../scaffold/scripts/parsers/csharp.mjs";

function withMissingDotnetRuntime(testFn) {
  return async () => {
    const previous = process.env.CORTEX_DOTNET_CMD;
    process.env.CORTEX_DOTNET_CMD = "definitely-not-a-real-dotnet-command";
    resetCSharpParserRuntimeCache();
    resetScaffoldCSharpParserRuntimeCache();
    try {
      await testFn();
    } finally {
      if (previous === undefined) {
        delete process.env.CORTEX_DOTNET_CMD;
      } else {
        process.env.CORTEX_DOTNET_CMD = previous;
      }
      resetCSharpParserRuntimeCache();
      resetScaffoldCSharpParserRuntimeCache();
    }
  };
}

const dotnetAvailable = isCSharpParserAvailable();
const liveTest = dotnetAvailable ? test : test.skip;

test("csharp parser runtime reports unavailable when dotnet is missing", withMissingDotnetRuntime(() => {
  const runtime = getCSharpParserRuntime();
  assert.equal(runtime.available, false);
  assert.match(runtime.reason ?? "", /not|spawn|command/i);
}));

test("scaffold csharp parser runtime reports unavailable when dotnet is missing", withMissingDotnetRuntime(() => {
  const runtime = getScaffoldCSharpParserRuntime();
  assert.equal(runtime.available, false);
  assert.match(runtime.reason ?? "", /not|spawn|command/i);
}));

test("csharp parser falls back to empty structured output when runtime is unavailable", withMissingDotnetRuntime(() => {
  const source = [
    "public class Worker {",
    "  public void Run() { }",
    "}"
  ].join("\n");

  const result = parseCode(source, "Worker.cs", "csharp");
  assert.deepEqual(result, { chunks: [], errors: [] });
}));

test("scaffold csharp parser falls back to empty structured output when runtime is unavailable", withMissingDotnetRuntime(() => {
  const source = [
    "public class Worker {",
    "  public void Run() { }",
    "}"
  ].join("\n");

  const result = parseScaffoldCSharpCode(source, "Worker.cs", "csharp");
  assert.deepEqual(result, { chunks: [], errors: [] });
}));

liveTest("csharp parser extracts class and method chunks", () => {
  const source = [
    "public class Foo {",
    "  public int Bar(string x) => x.Length;",
    "}"
  ].join("\n");

  const result = parseCode(source, "Foo.cs", "csharp");
  assert.equal(result.errors.length, 0);

  const byName = new Map(result.chunks.map((c) => [c.name, c]));
  assert.ok(byName.has("Foo"));
  assert.equal(byName.get("Foo").kind, "class");
  assert.equal(byName.get("Foo").language, "csharp");
  assert.equal(byName.get("Foo").exported, true);
  assert.equal(byName.get("Foo").startLine, 1);

  assert.ok(byName.has("Foo.Bar"));
  assert.equal(byName.get("Foo.Bar").kind, "method");
  assert.equal(byName.get("Foo.Bar").exported, true);
  assert.match(byName.get("Foo.Bar").signature, /int Bar\(string x\)/);
});

liveTest("csharp parser distinguishes record, struct, interface, enum kinds", () => {
  const source = [
    "public record Point(int X, int Y);",
    "public struct Size { public int W; }",
    "public interface IRun { void Go(); }",
    "public enum Color { Red, Blue }"
  ].join("\n");

  const result = parseCode(source, "Types.cs", "csharp");
  assert.equal(result.errors.length, 0);

  const kinds = new Map(result.chunks.map((c) => [c.name, c.kind]));
  assert.equal(kinds.get("Point"), "record");
  assert.equal(kinds.get("Size"), "struct");
  assert.equal(kinds.get("IRun"), "interface");
  assert.equal(kinds.get("Color"), "enum");
});

liveTest("csharp parser produces fully-qualified names for nested types", () => {
  const source = [
    "public class Outer {",
    "  public class Inner {",
    "    public void Go() { }",
    "  }",
    "}"
  ].join("\n");

  const result = parseCode(source, "Outer.cs", "csharp");
  assert.equal(result.errors.length, 0);

  const names = new Set(result.chunks.map((c) => c.name));
  assert.ok(names.has("Outer"));
  assert.ok(names.has("Outer.Inner"));
  assert.ok(names.has("Outer.Inner.Go"));
});

liveTest("csharp parser labels constructors with .ctor suffix", () => {
  const source = [
    "public class Svc {",
    "  public Svc(int n) { }",
    "}"
  ].join("\n");

  const result = parseCode(source, "Svc.cs", "csharp");
  assert.equal(result.errors.length, 0);

  const ctor = result.chunks.find((c) => c.name === "Svc.ctor");
  assert.ok(ctor, "constructor chunk missing");
  assert.equal(ctor.kind, "constructor");
});

liveTest("csharp parser extracts property signature", () => {
  const source = [
    "public class Bag {",
    "  public int Count { get; set; }",
    "}"
  ].join("\n");

  const result = parseCode(source, "Bag.cs", "csharp");
  assert.equal(result.errors.length, 0);

  const prop = result.chunks.find((c) => c.name === "Bag.Count");
  assert.ok(prop, "property chunk missing");
  assert.equal(prop.kind, "property");
  assert.match(prop.signature, /int Count/);
});

liveTest("csharp parser collects top-level, namespace-scoped, and global using directives as imports", () => {
  const source = [
    "global using System.Linq;",
    "using System;",
    "namespace App {",
    "  using System.Collections.Generic;",
    "  public class A { public void Do() { } }",
    "}"
  ].join("\n");

  const result = parseCode(source, "A.cs", "csharp");
  assert.equal(result.errors.length, 0);

  const cls = result.chunks.find((c) => c.name === "A");
  assert.ok(cls);
  assert.deepEqual(
    [...cls.imports].sort(),
    ["System", "System.Collections.Generic", "System.Linq"]
  );
});

liveTest("csharp parser collects invocation call names", () => {
  const source = [
    "public class Runner {",
    "  public void Go() {",
    "    Helper.Load();",
    "    Work();",
    "  }",
    "  public void Work() { }",
    "}"
  ].join("\n");

  const result = parseCode(source, "Runner.cs", "csharp");
  assert.equal(result.errors.length, 0);

  const go = result.chunks.find((c) => c.name === "Runner.Go");
  assert.ok(go);
  assert.ok(go.calls.includes("Load"));
  assert.ok(go.calls.includes("Work"));
});

liveTest("csharp parser reports syntax errors with line/column", () => {
  const source = [
    "public class Broken {",
    "  public void Bad( { }",
    "}"
  ].join("\n");

  const result = parseCode(source, "Broken.cs", "csharp");
  assert.equal(result.chunks.length, 0);
  assert.ok(result.errors.length > 0);
  assert.ok(typeof result.errors[0].line === "number");
  assert.ok(typeof result.errors[0].column === "number");
  assert.equal(typeof result.errors[0].message, "string");
});

liveTest("scaffold csharp parser produces same results as main parser", () => {
  const source = [
    "using System;",
    "namespace Demo {",
    "  public class Greeter {",
    "    public string Hi(string name) => $\"Hello {name}\";",
    "  }",
    "}"
  ].join("\n");

  const main = parseCode(source, "Greeter.cs", "csharp");
  const scaffold = parseScaffoldCSharpCode(source, "Greeter.cs", "csharp");

  assert.deepEqual(main, scaffold);
});
