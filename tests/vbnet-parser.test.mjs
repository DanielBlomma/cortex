import test from "node:test";
import assert from "node:assert/strict";
import {
  getVbNetParserRuntime,
  parseCode,
  resetVbNetParserRuntimeCache
} from "../scaffold/scripts/parsers/vbnet.mjs";

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

