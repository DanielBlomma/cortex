import test from "node:test";
import assert from "node:assert/strict";
import { parseCode } from "../scaffold/scripts/parsers/javascript.mjs";

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

test("parseCode marks common ESM export forms as exported", () => {
  const source = [
    "export const foo = () => {};",
    "const bar = () => {};",
    "function baz() { return 1; }",
    "export { bar };",
    "export default baz;"
  ].join("\n");

  const chunks = parseCode(source, "fixture.ts", "typescript").chunks;
  const chunkByName = new Map(chunks.map((chunk) => [chunk.name, chunk]));

  assert.equal(chunkByName.get("foo")?.exported, true);
  assert.equal(chunkByName.get("bar")?.exported, true);
  assert.equal(chunkByName.get("baz")?.exported, true);
});

test("parseCode marks CommonJS exports as exported", () => {
  const source = [
    "function alpha() { return 1; }",
    "const beta = () => 2;",
    "class Gamma {}",
    "module.exports = { alpha };",
    "exports.beta = beta;",
    "module.exports.Gamma = Gamma;"
  ].join("\n");

  const chunks = parseCode(source, "fixture.cjs", "javascript").chunks;
  const chunkByName = new Map(chunks.map((chunk) => [chunk.name, chunk]));

  assert.equal(chunkByName.get("alpha")?.exported, true);
  assert.equal(chunkByName.get("beta")?.exported, true);
  assert.equal(chunkByName.get("Gamma")?.exported, true);
});

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

test("parseCode extracts TypeScript declaration chunks", () => {
  const source = [
    "import {Base} from './base';",
    "export interface User extends Base {",
    "  name: string;",
    "}",
    "export type UserId = string | number;",
    "export enum UserKind {",
    "  Admin = 'admin'",
    "}"
  ].join("\n");

  const chunks = parseCode(source, "fixture.ts", "typescript").chunks;
  const chunkByName = new Map(chunks.map((chunk) => [chunk.name, chunk]));

  assert.equal(chunkByName.get("User")?.kind, "interface");
  assert.equal(chunkByName.get("User")?.exported, true);
  assert.equal(chunkByName.get("UserId")?.kind, "type");
  assert.equal(chunkByName.get("UserId")?.exported, true);
  assert.equal(chunkByName.get("UserKind")?.kind, "enum");
  assert.equal(chunkByName.get("UserKind")?.exported, true);
});

test("parseCode tracks imports inside TypeScript declaration member types", () => {
  const source = [
    "import { Owner } from './owner';",
    "export interface User {",
    "  owner: Owner;",
    "}",
    "export type Box = {",
    "  value: Owner;",
    "};"
  ].join("\n");

  const chunks = parseCode(source, "fixture.ts", "typescript").chunks;
  const chunkByName = new Map(chunks.map((chunk) => [chunk.name, chunk]));

  assert.deepEqual(chunkByName.get("User")?.imports, ["./owner"]);
  assert.deepEqual(chunkByName.get("Box")?.imports, ["./owner"]);
});

test("parseCode extracts class-field function chunks", () => {
  const source = [
    "class UserCard {",
    "  load = () => fetchUser();",
    "  static create = function() { return makeUser(); };",
    "}",
    "function fetchUser() { return null; }",
    "function makeUser() { return null; }"
  ].join("\n");

  const chunks = parseCode(source, "fixture.ts", "typescript").chunks;
  const chunkByName = new Map(chunks.map((chunk) => [chunk.name, chunk]));

  assert.equal(chunkByName.get("UserCard.load")?.kind, "method");
  assert.equal(chunkByName.get("UserCard.load")?.field, true);
  assert.deepEqual(chunkByName.get("UserCard.load")?.calls, ["fetchUser"]);
  assert.equal(chunkByName.get("UserCard.create")?.static, true);
  assert.deepEqual(chunkByName.get("UserCard.create")?.calls, ["makeUser"]);
});

test("parseCode walks TypeScript keyword nodes without dropping chunks", () => {
  const source = [
    "export function normalize(value: any): unknown {",
    "  return value as string;",
    "}"
  ].join("\n");

  const result = parseCode(source, "fixture.ts", "typescript");

  assert.deepEqual(result.errors, []);
  assert.equal(result.chunks.find((chunk) => chunk.name === "normalize")?.kind, "function");
});

test("parseCode handles TSX without walker crashes", () => {
  const source = [
    "export function UserView() {",
    "  return <section>{name}</section>;",
    "}"
  ].join("\n");

  const result = parseCode(source, "fixture.tsx", "tsx");

  assert.deepEqual(result.errors, []);
  assert.equal(result.chunks.find((chunk) => chunk.name === "UserView")?.kind, "function");
});

test("parseCode walks JSX markup for calls and imported component references", () => {
  const source = [
    "import { Button } from './button';",
    "import { format } from './format';",
    "export function UserView({ name }) {",
    "  return <Button label={format(name)} />;",
    "}"
  ].join("\n");

  const chunk = parseCode(source, "fixture.tsx", "tsx").chunks.find((entry) => entry.name === "UserView");

  assert.deepEqual(chunk?.calls, ["format"]);
  assert.deepEqual(chunk?.imports, ["./button", "./format"]);
});
