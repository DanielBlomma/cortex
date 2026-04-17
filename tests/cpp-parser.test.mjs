import test from "node:test";
import assert from "node:assert/strict";
import {
  getCppParserRuntime,
  isCppParserAvailable,
  parseCode,
  resetCppParserRuntimeCache
} from "../scaffold/scripts/parsers/cpp.mjs";

function withMissingClangRuntime(testFn) {
  return async () => {
    const previous = process.env.CORTEX_CLANG_CMD;
    process.env.CORTEX_CLANG_CMD = "definitely-not-a-real-clang-command";
    resetCppParserRuntimeCache();
    try {
      await testFn();
    } finally {
      if (previous === undefined) {
        delete process.env.CORTEX_CLANG_CMD;
      } else {
        process.env.CORTEX_CLANG_CMD = previous;
      }
      resetCppParserRuntimeCache();
    }
  };
}

test("cpp parser runtime reports unavailable when clang is missing", withMissingClangRuntime(() => {
  const runtime = getCppParserRuntime();
  assert.equal(runtime.available, false);
  assert.match(runtime.reason ?? "", /clang runtime not available/i);
}));

test("cpp parser falls back to empty structured output when runtime is unavailable", withMissingClangRuntime(() => {
  const source = "int add(int a, int b) { return a + b; }";
  const result = parseCode(source, "add.cpp", "cpp");
  assert.deepEqual(result, { chunks: [], errors: [] });
}));

test("cpp parser extracts includes, records, and functions when clang is available", () => {
  if (!isCppParserAvailable()) {
    return;
  }

  const source = [
    '#include "widget.h"',
    "",
    "int add(int a, int b) {",
    "  return a + b;",
    "}",
    "",
    "class Widget {",
    "public:",
    "  void run() {",
    "    add(1, 2);",
    "  }",
    "};"
  ].join("\n");

  const result = parseCode(source, "Widget.cpp", "cpp");
  const chunkByName = new Map(result.chunks.map((chunk) => [chunk.name, chunk]));

  assert.ok(chunkByName.has("add"));
  assert.ok(chunkByName.has("Widget"));
  assert.ok(chunkByName.has("Widget::run"));
  assert.ok(chunkByName.get("Widget::run")?.calls.includes("add"));
  assert.deepEqual(chunkByName.get("add")?.imports, ["widget.h"]);
});

