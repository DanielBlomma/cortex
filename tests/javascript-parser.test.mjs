import test from "node:test";
import assert from "node:assert/strict";
import { parseCode } from "../scripts/parsers/javascript.mjs";
import { parseCode as parseScaffoldCode } from "../scaffold/scripts/parsers/javascript.mjs";

test("parseCode marks exported variable declarations as exported", () => {
  const source = [
    "export const foo = () => {};",
    "const bar = () => {};",
    "export { bar };"
  ].join("\n");

  const chunks = parseCode(source, "fixture.ts", "typescript").chunks;
  const chunkByName = new Map(chunks.map((chunk) => [chunk.name, chunk]));

  assert.equal(chunkByName.get("foo")?.exported, true);
  assert.equal(chunkByName.get("bar")?.exported, true);
});

test("parseCode does not mark re-export specifiers as local exports", () => {
  const source = [
    "const foo = () => {};",
    'export { bar } from "./dep";'
  ].join("\n");

  const chunks = parseCode(source, "fixture.ts", "typescript").chunks;
  assert.equal(chunks.find((chunk) => chunk.name === "foo")?.exported, undefined);
});

test("parseCode marks default identifier exports as exported", () => {
  const source = [
    "const foo = () => {};",
    "export default foo;"
  ].join("\n");

  const chunks = parseCode(source, "fixture.ts", "typescript").chunks;
  assert.equal(chunks.find((chunk) => chunk.name === "foo")?.exported, true);
});

test("scaffold parseCode marks common ESM export forms as exported", () => {
  const source = [
    "export const foo = () => {};",
    "const bar = () => {};",
    "function baz() { return 1; }",
    "export { bar };",
    "export default baz;"
  ].join("\n");

  const chunks = parseScaffoldCode(source, "fixture.ts", "typescript").chunks;
  const chunkByName = new Map(chunks.map((chunk) => [chunk.name, chunk]));

  assert.equal(chunkByName.get("foo")?.exported, true);
  assert.equal(chunkByName.get("bar")?.exported, true);
  assert.equal(chunkByName.get("baz")?.exported, true);
});

for (const [label, parser] of [
  ["main", parseCode],
  ["scaffold", parseScaffoldCode]
]) {
  test(`${label} parseCode marks CommonJS exports as exported`, () => {
    const source = [
      "function alpha() { return 1; }",
      "const beta = () => 2;",
      "class Gamma {}",
      "module.exports = { alpha };",
      "exports.beta = beta;",
      "module.exports.Gamma = Gamma;"
    ].join("\n");

    const chunks = parser(source, "fixture.cjs", "javascript").chunks;
    const chunkByName = new Map(chunks.map((chunk) => [chunk.name, chunk]));

    assert.equal(chunkByName.get("alpha")?.exported, true);
    assert.equal(chunkByName.get("beta")?.exported, true);
    assert.equal(chunkByName.get("Gamma")?.exported, true);
  });
}

test("parseCode includes leading JSDoc in function chunk bodies", () => {
  const source = [
    "/**",
    " * Processes incoming records.",
    " */",
    "function processRecords(input) {",
    "  return input;",
    "}"
  ].join("\n");

  const chunks = parseCode(source, "fixture.js", "javascript").chunks;
  const body = chunks.find((chunk) => chunk.name === "processRecords")?.body ?? "";

  assert.match(body, /^\/\*\*[\s\S]*function processRecords/);
});

test("parseCode includes leading line comments for const function chunks", () => {
  const source = [
    "// Shared helper for retries",
    "const retry = () => true;"
  ].join("\n");

  const chunks = parseCode(source, "fixture.js", "javascript").chunks;
  const body = chunks.find((chunk) => chunk.name === "retry")?.body ?? "";

  assert.match(body, /^\/\/ Shared helper for retries\nconst retry =/);
});
