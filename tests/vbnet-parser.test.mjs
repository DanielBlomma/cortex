import test from "node:test";
import assert from "node:assert/strict";
import {
  getVbNetParserRuntime,
  isVbNetParserAvailable,
  parseCode,
  resetVbNetParserRuntimeCache
} from "../scaffold/scripts/parsers/vbnet.mjs";

const dotnetAvailable = isVbNetParserAvailable();
const liveTest = dotnetAvailable ? test : test.skip;

function withMissingDotnetRuntime(testFn) {
  return async () => {
    const previous = process.env.CORTEX_DOTNET_CMD;
    process.env.CORTEX_DOTNET_CMD = "definitely-not-a-real-dotnet-command";
    resetVbNetParserRuntimeCache();
    try {
      await testFn();
    } finally {
      if (previous === undefined) {
        delete process.env.CORTEX_DOTNET_CMD;
      } else {
        process.env.CORTEX_DOTNET_CMD = previous;
      }
      resetVbNetParserRuntimeCache();
    }
  };
}

test("vbnet parser runtime reports unavailable when dotnet is missing", withMissingDotnetRuntime(() => {
  const runtime = getVbNetParserRuntime();
  assert.equal(runtime.available, false);
  assert.match(runtime.reason ?? "", /not|spawn|command/i);
}));

test("vbnet parser falls back to empty structured output when runtime is unavailable", withMissingDotnetRuntime(() => {
  const source = [
    "Public Class Worker",
    "  Public Sub Run()",
    "  End Sub",
    "End Class"
  ].join("\n");

  const result = parseCode(source, "Worker.vb", "vbnet");
  assert.deepEqual(result, { chunks: [], errors: [] });
}));

liveTest("vbnet parser extracts class and method chunks", () => {
  const source = [
    "Public Class Greeter",
    "  Public Function Hello(name As String) As String",
    "    Return \"Hi \" & name",
    "  End Function",
    "End Class"
  ].join("\n");

  const result = parseCode(source, "Greeter.vb", "vbnet");
  assert.equal(result.errors.length, 0);

  const byName = new Map(result.chunks.map((c) => [c.name, c]));
  assert.ok(byName.has("Greeter"));
  assert.equal(byName.get("Greeter").kind, "class");
  assert.equal(byName.get("Greeter").exported, true);

  assert.ok(byName.has("Greeter.Hello"));
  assert.equal(byName.get("Greeter.Hello").kind, "function");
  assert.equal(byName.get("Greeter.Hello").exported, true);
});

liveTest("vbnet parser distinguishes Sub and Function method kinds", () => {
  const source = [
    "Public Class Worker",
    "  Public Sub Start()",
    "  End Sub",
    "  Public Function Count() As Integer",
    "    Return 0",
    "  End Function",
    "End Class"
  ].join("\n");

  const result = parseCode(source, "Worker.vb", "vbnet");
  assert.equal(result.errors.length, 0);

  const kinds = new Map(result.chunks.map((c) => [c.name, c.kind]));
  assert.equal(kinds.get("Worker.Start"), "method");
  assert.equal(kinds.get("Worker.Count"), "function");
});

liveTest("vbnet parser collects imports as namespace names", () => {
  const source = [
    "Imports System",
    "Imports System.Collections.Generic",
    "",
    "Public Class Bag",
    "  Public Sub Add()",
    "  End Sub",
    "End Class"
  ].join("\n");

  const result = parseCode(source, "Bag.vb", "vbnet");
  assert.equal(result.errors.length, 0);

  const bag = result.chunks.find((c) => c.name === "Bag");
  assert.ok(bag);
  assert.ok(bag.imports.includes("System"));
  assert.ok(bag.imports.includes("System.Collections.Generic"));
});

liveTest("vbnet parser collects invocation call names", () => {
  const source = [
    "Public Class Runner",
    "  Public Sub Go()",
    "    Helper.Load()",
    "    Work()",
    "  End Sub",
    "  Public Sub Work()",
    "  End Sub",
    "End Class"
  ].join("\n");

  const result = parseCode(source, "Runner.vb", "vbnet");
  assert.equal(result.errors.length, 0);

  const go = result.chunks.find((c) => c.name === "Runner.Go");
  assert.ok(go);
  assert.ok(go.calls.includes("Load"));
  assert.ok(go.calls.includes("Work"));
});

liveTest("vbnet parser marks non-Public members as not exported", () => {
  const source = [
    "Public Class Svc",
    "  Private Sub Internal()",
    "  End Sub",
    "End Class"
  ].join("\n");

  const result = parseCode(source, "Svc.vb", "vbnet");
  const internal = result.chunks.find((c) => c.name === "Svc.Internal");
  assert.ok(internal);
  assert.equal(internal.exported, false);
});
