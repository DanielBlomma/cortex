import test from "node:test";
import assert from "node:assert/strict";
import {
  getVbNetParserRuntime,
  parseCode,
  resetVbNetParserRuntimeCache
} from "../scripts/parsers/vbnet.mjs";
import {
  getVbNetParserRuntime as getScaffoldVbNetParserRuntime,
  parseCode as parseScaffoldVbNetCode,
  resetVbNetParserRuntimeCache as resetScaffoldVbNetParserRuntimeCache
} from "../scaffold/scripts/parsers/vbnet.mjs";

function withMissingDotnetRuntime(testFn) {
  return async () => {
    const previous = process.env.CORTEX_DOTNET_CMD;
    process.env.CORTEX_DOTNET_CMD = "definitely-not-a-real-dotnet-command";
    resetVbNetParserRuntimeCache();
    resetScaffoldVbNetParserRuntimeCache();
    try {
      await testFn();
    } finally {
      if (previous === undefined) {
        delete process.env.CORTEX_DOTNET_CMD;
      } else {
        process.env.CORTEX_DOTNET_CMD = previous;
      }
      resetVbNetParserRuntimeCache();
      resetScaffoldVbNetParserRuntimeCache();
    }
  };
}

test("vbnet parser runtime reports unavailable when dotnet is missing", withMissingDotnetRuntime(() => {
  const runtime = getVbNetParserRuntime();
  assert.equal(runtime.available, false);
  assert.match(runtime.reason ?? "", /not|spawn|command/i);
}));

test("scaffold vbnet parser runtime reports unavailable when dotnet is missing", withMissingDotnetRuntime(() => {
  const runtime = getScaffoldVbNetParserRuntime();
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

test("scaffold vbnet parser falls back to empty structured output when runtime is unavailable", withMissingDotnetRuntime(() => {
  const source = [
    "Public Module Bootstrap",
    "  Public Sub Main()",
    "  End Sub",
    "End Module"
  ].join("\n");

  const result = parseScaffoldVbNetCode(source, "Bootstrap.vb", "vbnet");
  assert.deepEqual(result, { chunks: [], errors: [] });
}));
