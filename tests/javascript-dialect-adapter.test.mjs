import test from "node:test";
import assert from "node:assert/strict";
import { Parser } from "../scaffold/scripts/parsers/node_modules/acorn/dist/acorn.mjs";
import {
  parseCode,
  parseCodeWithDialectObservations
} from "../scaffold/scripts/parsers/javascript.mjs";
import { parseAst } from "../scaffold/scripts/parsers/javascript/ast.mjs";
import {
  DIALECT_LIMITS,
  compareDialectObservations
} from "../scaffold/scripts/lib/dialect-observation-contract.mjs";

const JAVASCRIPT_FIXTURE = [
  "import test from 'node:test';",
  "import assert from 'node:assert/strict';",
  "export function test_value(value) {",
  "  const state = { value, entries: [value] };",
  "  if (!value) throw new Error('missing');",
  "  test('value', () => expect(state.value));",
  "  assert.ok(state.value);",
  "  return state;",
  "}"
].join("\n");

const TYPESCRIPT_FIXTURE = [
  "import test from 'node:test';",
  "import assert from 'node:assert/strict';",
  "export interface Value { name: string; entries: string[] }",
  "export function test_value(value: Value): Value {",
  "  const state: Value = { name: value.name, entries: [value.name] };",
  "  if (!state.name) throw new Error('missing');",
  "  test('value', () => assert.ok(state.name));",
  "  return state;",
  "}"
].join("\n");

const MODE_FIXTURES = [
  ["src/mode.js", "javascript", JAVASCRIPT_FIXTURE],
  ["src/mode.jsx", "jsx", "export function View(){ return <section>{value}</section>; }"],
  ["src/mode.mjs", "javascript", JAVASCRIPT_FIXTURE],
  ["src/mode.cjs", "javascript", "function value(){ return { ok: true }; } module.exports = { value };"],
  ["src/mode.ts", "typescript", "export function value(input: string): string { return input; }"],
  ["src/mode.tsx", "tsx", "export function View(input: {name:string}) { return <div>{input.name}</div>; }"],
  ["src/mode.mts", "typescript", "export interface Value { name: string }"],
  ["src/mode.cts", "typescript", "export type Value = string | number;"]
];

function categoriesOf(transport) {
  return new Set(transport.observation_envelope.observations.map((entry) => entry.category));
}

test("Acorn adapters cover every registered JavaScript and TypeScript mode", () => {
  for (const [repositoryPath, language, source] of MODE_FIXTURES) {
    const transport = parseCodeWithDialectObservations(source, repositoryPath, language);
    assert.equal(transport.observation_envelope.status, "ok", repositoryPath);
    assert.equal(transport.parser_result.errors.length, 0, repositoryPath);
    assert.ok(transport.observation_envelope.observations.length > 0, repositoryPath);
  }
});

test("Acorn emits all applicable categories for JavaScript and TypeScript and keeps parser results unchanged", () => {
  for (const [source, repositoryPath, language] of [
    [JAVASCRIPT_FIXTURE, "src/value.js", "javascript"],
    [TYPESCRIPT_FIXTURE, "src/value.ts", "typescript"]
  ]) {
    const before = parseCode(source, repositoryPath, language);
    const transport = parseCodeWithDialectObservations(source, repositoryPath, language);
    const after = parseCode(source, repositoryPath, language);

    assert.deepEqual(transport.parser_result, before, repositoryPath);
    assert.deepEqual(after, before, repositoryPath);
    assert.deepEqual(categoriesOf(transport), new Set([
      "declaration_structure", "control_flow", "error_flow",
      "data_representation", "test_shape"
    ]), repositoryPath);
  }
});

test("Acorn does not infer test or error semantics from shadowed names or await", () => {
  for (const [path, language, source] of [
    ["src/ordinary.js", "javascript", [
      "import test from 'node:test';",
      "async function production(test, expect, assert) {",
      "  await test(expect(assert));",
      "  return 1;",
      "}"
    ].join("\n")],
    ["src/ordinary.ts", "typescript", [
      "const fixture = () => 1;",
      "const test = fixture;",
      "const expect = test;",
      "export async function production(): Promise<number> {",
      "  await expect(test());",
      "  return 1;",
      "}"
    ].join("\n")]
  ]) {
    const transport = parseCodeWithDialectObservations(source, path, language);
    const observations = transport.observation_envelope.observations;
    assert.equal(observations.some((entry) => entry.category === "test_shape"), false, path);
    assert.equal(observations.some((entry) => entry.category === "error_flow"), false, path);
  }
});

test("Acorn resolves destructured, rest, and default-parameter shadows and excludes CallTracker", () => {
  for (const [path, language, source] of [
    ["src/destructured.js", "javascript", [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "function production({ test }, [assert], ...rest) {",
      "  test(rest);",
      "  assert(rest);",
      "}"
    ].join("\n")],
    ["src/defaults.ts", "typescript", [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "function production(test = () => 1, { assert = () => 1 } = {}) {",
      "  test();",
      "  assert();",
      "}"
    ].join("\n")],
    ["src/tracker.js", "javascript", [
      "import { CallTracker } from 'node:assert';",
      "CallTracker();"
    ].join("\n")],
    ["src/lexical.js", "javascript", [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "{ const { test } = { test() {} }; test(); }",
      "{ const [assert] = [() => 1]; assert(); }",
      "try { throw 1; } catch ({ test }) { test(); }",
      "{ class test {} test(); }",
      "{ function assert() {} assert(); }"
    ].join("\n")]
  ]) {
    const transport = parseCodeWithDialectObservations(source, path, language);
    assert.equal(
      transport.observation_envelope.observations.some((entry) => entry.category === "test_shape"),
      false,
      path
    );
  }
});

test("TypeScript type-only node:test and node:assert imports do not emit runtime test facts", () => {
  for (const source of [
    [
      "import type test from 'node:test';",
      "import type assert from 'node:assert/strict';",
      "test('value', () => {});",
      "assert.ok(true);"
    ].join("\n"),
    [
      "import { type test, type describe } from 'node:test';",
      "import { type ok, type strictEqual } from 'node:assert';",
      "test('value', () => {});",
      "describe('suite', () => {});",
      "ok(true);",
      "strictEqual(1, 1);"
    ].join("\n")
  ]) {
    const transport = parseCodeWithDialectObservations(source, "src/type-only.ts", "typescript");
    assert.equal(transport.observation_envelope.status, "ok");
    assert.equal(
      transport.observation_envelope.observations.some((entry) => entry.category === "test_shape"),
      false
    );
  }
});

test("the Acorn composite path invokes the native parser exactly once", () => {
  const original = Parser.prototype.parse;
  let calls = 0;
  Parser.prototype.parse = function instrumentedParse(...args) {
    calls += 1;
    return original.apply(this, args);
  };
  try {
    parseCodeWithDialectObservations(JAVASCRIPT_FIXTURE, "src/once.js", "javascript");
  } finally {
    Parser.prototype.parse = original;
  }
  assert.equal(calls, 1);
});

test("Acorn observations have deterministic canonical ordering and stable IDs", () => {
  const first = parseCodeWithDialectObservations(JAVASCRIPT_FIXTURE, "src/stable.js", "javascript");
  const second = parseCodeWithDialectObservations(JAVASCRIPT_FIXTURE, "src/stable.js", "javascript");
  assert.deepEqual(second, first);
  const observations = first.observation_envelope.observations;
  assert.deepEqual(observations, [...observations].sort(compareDialectObservations));
  assert.equal(new Set(observations.map((entry) => entry.observation_id)).size, observations.length);
});

test("Acorn converts non-BMP, CRLF, and multiline half-open spans to inclusive UTF-16 spans", () => {
  const source = [
    "const icon = '😀';",
    "function test_icon(value) {",
    "  if (value) throw new Error();",
    "  return { value };",
    "}"
  ].join("\r\n");
  const transport = parseCodeWithDialectObservations(source, "src/unicode.js", "javascript");
  const functionObservation = transport.observation_envelope.observations.find((entry) =>
    entry.category === "declaration_structure" &&
    entry.normalized_shape === '{"kind":"function"}' &&
    entry.start_line === 2
  );
  assert.deepEqual(
    [functionObservation?.start_line, functionObservation?.start_column, functionObservation?.end_line, functionObservation?.end_column],
    [2, 0, 5, 0]
  );
  const stateObservation = transport.observation_envelope.observations.find((entry) =>
    entry.category === "data_representation" && entry.start_line === 1
  );
  assert.equal(stateObservation?.end_column, 17);
});

test("Acorn skips zero-width syntax and fails closed for cap and status precedence", () => {
  const empty = parseCodeWithDialectObservations("", "src/empty.js", "javascript");
  assert.equal(empty.observation_envelope.status, "ok");
  assert.deepEqual(empty.observation_envelope.observations, []);

  const cappedSource = Array.from({ length: 180 }, (_, index) => `const value${index} = {};`).join("\n");
  const capped = parseCodeWithDialectObservations(cappedSource, "src/capped.js", "javascript");
  assert.equal(capped.observation_envelope.status, "truncated");
  assert.deepEqual(capped.observation_envelope.observations, []);
  assert.equal(capped.observation_envelope.diagnostics.observed_count, capped.observation_envelope.diagnostics.omitted_count);
  assert.equal(capped.observation_envelope.diagnostics.observed_count, 541);

  const malformed = parseCodeWithDialectObservations("function {", "src/bad.js", "javascript");
  assert.equal(malformed.observation_envelope.status, "malformed");
  assert.deepEqual(malformed.observation_envelope.observations, []);

  const oversizedSource = `/*${"x".repeat(DIALECT_LIMITS.max_source_bytes)}*/`;
  const oversized = parseCodeWithDialectObservations(oversizedSource, "src/large.js", "javascript");
  assert.equal(oversized.observation_envelope.status, "oversized");
  assert.deepEqual(oversized.observation_envelope.observations, []);
});

test("Acorn preserves location-less deep parser errors while the composite remains JSON-safe", () => {
  const source = "(".repeat(1000) + "0" + ")".repeat(1000);
  const astResult = parseAst(source);
  const before = parseCode(source, "src/deep.js", "javascript");
  const beforeSnapshot = structuredClone(before);
  const transport = parseCodeWithDialectObservations(source, "src/deep.js", "javascript");
  const after = parseCode(source, "src/deep.js", "javascript");

  assert.equal(astResult.ast, null);
  assert.deepEqual(astResult.errors, before.errors);
  assert.deepEqual(before, beforeSnapshot);
  assert.deepEqual(after, before);
  assert.match(before.errors[0]?.message ?? "", /Maximum call stack size exceeded/);
  assert.equal(Object.hasOwn(before.errors[0], "line"), true);
  assert.equal(Object.hasOwn(before.errors[0], "column"), true);
  assert.equal(before.errors[0].line, undefined);
  assert.equal(before.errors[0].column, undefined);

  assert.equal(transport.observation_envelope.status, "malformed");
  assert.deepEqual(transport.observation_envelope.observations, []);
  assert.equal(transport.observation_envelope.diagnostics.observed_count, 0);
  assert.equal(transport.observation_envelope.diagnostics.omitted_count, 0);
  assert.equal(Object.hasOwn(transport.parser_result.errors[0], "line"), false);
  assert.equal(Object.hasOwn(transport.parser_result.errors[0], "column"), false);
  assert.equal(JSON.stringify(transport.parser_result), JSON.stringify(before));
});

test("Acorn rejects invalid arguments before parsing and transports no raw syntax", () => {
  assert.throws(() => parseCodeWithDialectObservations("const x = 1;", "../escape.js", "javascript"), /non-canonical repository path/);
  assert.throws(() => parseCodeWithDialectObservations("const x = 1;", "src/value.ts", "javascript"), /unsupported parser mode/);
  assert.throws(() => parseCodeWithDialectObservations({ toString: () => "const x = 1;" }, "src/value.js", "javascript"), /code must be a string/);

  const transport = parseCodeWithDialectObservations(JAVASCRIPT_FIXTURE, "src/plain.js", "javascript");
  const forbidden = new Set(["ast", "rootnode", "tree", "source", "code", "rawtext"]);
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    assert.ok([Object.prototype, Array.prototype].includes(Object.getPrototypeOf(value)));
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbidden.has(key.replace(/[^a-z]/gi, "").toLowerCase()), false, key);
      visit(child);
    }
  };
  visit(transport);
});
