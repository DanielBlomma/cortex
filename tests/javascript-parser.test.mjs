import test from "node:test";
import assert from "node:assert/strict";
import { parseCode } from "../scripts/parsers/javascript.mjs";

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
