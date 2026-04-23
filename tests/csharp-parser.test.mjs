import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureCSharpParserPublished,
  getCSharpParserRuntime,
  isCSharpParserAvailable,
  parseCode,
  parseProject,
  resetCSharpParserRuntimeCache
} from "../scaffold/scripts/parsers/csharp.mjs";

function withMissingDotnetRuntime(testFn) {
  return async () => {
    const previous = process.env.CORTEX_DOTNET_CMD;
    process.env.CORTEX_DOTNET_CMD = "definitely-not-a-real-dotnet-command";
    resetCSharpParserRuntimeCache();
    try {
      await testFn();
    } finally {
      if (previous === undefined) {
        delete process.env.CORTEX_DOTNET_CMD;
      } else {
        process.env.CORTEX_DOTNET_CMD = previous;
      }
      resetCSharpParserRuntimeCache();
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

test("csharp parser falls back to empty structured output when runtime is unavailable", withMissingDotnetRuntime(() => {
  const source = [
    "public class Worker {",
    "  public void Run() { }",
    "}"
  ].join("\n");

  const result = parseCode(source, "Worker.cs", "csharp");
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

// parseProject — batch mode with Roslyn SemanticModel

liveTest("parseProject resolves cross-file calls to fully-qualified names", () => {
  const result = parseProject([
    {
      path: "Helper.cs",
      content: "namespace Demo; public class Helper { public int Compute(int x) => x * 2; }"
    },
    {
      path: "App.cs",
      content: "namespace Demo; public class App { public int Run(Helper h) => h.Compute(21); }"
    }
  ]);

  const appChunks = result.get("App.cs").chunks;
  const runChunk = appChunks.find((c) => c.name === "App.Run");
  assert.ok(runChunk);
  assert.ok(
    runChunk.calls.includes("Demo.Helper.Compute"),
    `expected fq-name "Demo.Helper.Compute" in calls, got: ${JSON.stringify(runChunk.calls)}`
  );
});

liveTest("parseProject resolves BCL calls via loaded reference assemblies", () => {
  const result = parseProject([
    {
      path: "Reader.cs",
      content: "using System.IO; namespace Demo; public class Reader { public string Load(string p) => File.ReadAllText(p); }"
    }
  ]);

  const loadChunk = result.get("Reader.cs").chunks.find((c) => c.name === "Reader.Load");
  assert.ok(loadChunk);
  assert.ok(
    loadChunk.calls.includes("System.IO.File.ReadAllText"),
    `expected fq BCL call, got: ${JSON.stringify(loadChunk.calls)}`
  );
});

liveTest("parseProject disambiguates same-named methods in different types", () => {
  const result = parseProject([
    {
      path: "Save.cs",
      content: [
        "namespace Demo;",
        "public class UserRepo { public void Save(string u) { } }",
        "public class OrderRepo { public void Save(string o) { } }",
        "public class Caller {",
        "  public void Run(UserRepo u, OrderRepo o) { u.Save(\"a\"); o.Save(\"b\"); }",
        "}"
      ].join("\n")
    }
  ]);

  const runChunk = result.get("Save.cs").chunks.find((c) => c.name === "Caller.Run");
  assert.ok(runChunk);
  assert.ok(runChunk.calls.includes("Demo.UserRepo.Save"));
  assert.ok(runChunk.calls.includes("Demo.OrderRepo.Save"));
});

liveTest("parseProject falls back to syntax name when symbol unresolved", () => {
  const result = parseProject([
    {
      path: "Unknown.cs",
      content: "namespace Demo; public class App { public void Run(dynamic x) { x.UnknownMethod(); } }"
    }
  ]);

  const runChunk = result.get("Unknown.cs").chunks.find((c) => c.name === "App.Run");
  assert.ok(runChunk);
  assert.ok(
    runChunk.calls.includes("UnknownMethod"),
    `expected syntax fallback "UnknownMethod", got: ${JSON.stringify(runChunk.calls)}`
  );
});

liveTest("parseProject returns empty map entries for empty file list", () => {
  const result = parseProject([]);
  assert.equal(result.size, 0);
});

liveTest("parseProject preserves per-file errors without aborting batch", () => {
  const result = parseProject([
    {
      path: "Bad.cs",
      content: "namespace Demo; public class Broken { public void Bad( { } }"
    },
    {
      path: "Good.cs",
      content: "namespace Demo; public class Good { public int Ok() => 1; }"
    }
  ]);

  assert.ok(result.get("Bad.cs").errors.length > 0);
  assert.equal(result.get("Bad.cs").chunks.length, 0);
  const goodChunks = result.get("Good.cs").chunks;
  assert.ok(goodChunks.find((c) => c.name === "Good"));
  assert.ok(goodChunks.find((c) => c.name === "Good.Ok"));
});

test("parseProject falls back to empty results when dotnet runtime is missing", withMissingDotnetRuntime(() => {
  const result = parseProject([
    { path: "A.cs", content: "namespace X; public class A { }" }
  ]);
  assert.equal(result.size, 1);
  assert.deepEqual(result.get("A.cs"), { chunks: [], errors: [] });
}));

liveTest("ensureCSharpParserPublished trusts bundled dll outside git checkout", () => {
  const previousProject = process.env.CORTEX_CSHARP_PARSER_PROJECT;
  const previousPublishDir = process.env.CORTEX_CSHARP_PUBLISH_DIR;
  const previousForce = process.env.CORTEX_CSHARP_FORCE_PUBLISH;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-csharp-bundled-"));
  const projectPath = path.join(tempRoot, "CSharpParser.csproj");
  const publishDir = path.join(tempRoot, "publish");
  const dllPath = path.join(publishDir, "CSharpParser.dll");

  fs.mkdirSync(publishDir, { recursive: true });
  fs.writeFileSync(projectPath, "<Project />\n");
  fs.writeFileSync(dllPath, "not-a-real-dll");

  process.env.CORTEX_CSHARP_PARSER_PROJECT = projectPath;
  process.env.CORTEX_CSHARP_PUBLISH_DIR = publishDir;
  delete process.env.CORTEX_CSHARP_FORCE_PUBLISH;
  resetCSharpParserRuntimeCache();

  try {
    const published = ensureCSharpParserPublished();
    assert.deepEqual(published, { ok: true, dllPath });
  } finally {
    if (previousProject === undefined) {
      delete process.env.CORTEX_CSHARP_PARSER_PROJECT;
    } else {
      process.env.CORTEX_CSHARP_PARSER_PROJECT = previousProject;
    }
    if (previousPublishDir === undefined) {
      delete process.env.CORTEX_CSHARP_PUBLISH_DIR;
    } else {
      process.env.CORTEX_CSHARP_PUBLISH_DIR = previousPublishDir;
    }
    if (previousForce === undefined) {
      delete process.env.CORTEX_CSHARP_FORCE_PUBLISH;
    } else {
      process.env.CORTEX_CSHARP_FORCE_PUBLISH = previousForce;
    }
    resetCSharpParserRuntimeCache();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
