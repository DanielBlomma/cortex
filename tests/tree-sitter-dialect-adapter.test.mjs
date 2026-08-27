import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  DIALECT_CAPABILITY_MANIFEST,
  DIALECT_LIMITS,
  compareDialectObservations
} from "../scaffold/scripts/lib/dialect-observation-contract.mjs";
import * as python from "../scaffold/scripts/parsers/python-treesitter.mjs";
import * as go from "../scaffold/scripts/parsers/go-treesitter.mjs";
import * as java from "../scaffold/scripts/parsers/java-treesitter.mjs";
import * as ruby from "../scaffold/scripts/parsers/ruby-treesitter.mjs";
import * as bash from "../scaffold/scripts/parsers/bash-treesitter.mjs";

const FIXTURES = [
  {
    family: "python", parser: python, path: "src/example.py", language: "python",
    source: "def value(): return [1]\ndef test_value(value):\n    if value:\n        assert value\n    else:\n        raise ValueError()\n"
  },
  {
    family: "go", parser: go, path: "src/example_test.go", language: "go",
    source: "package p\nimport \"testing\"\ntype Value struct { N int }\nfunc TestValue(t *testing.T) { defer cleanup(); if true { cleanup() } }\n"
  },
  {
    family: "java", parser: java, path: "src/Example.java", language: "java",
    source: "class Example { int value; void testValue(int input) { assert input >= 0; try { if (input > 0) throw new Error(); } catch (Exception error) {} } }"
  },
  {
    family: "ruby", parser: ruby, path: "src/example.rb", language: "ruby",
    source: "require \"minitest/autorun\"\nclass Example < Minitest::Test\n  def test_value(input)\n    @values = [input]\n    begin\n      if input\n        @values\n      end\n    rescue\n      @values = []\n    ensure\n      cleanup\n    end\n  end\nend\n"
  },
  {
    family: "bash", parser: bash, path: "src/example.sh", language: "bash",
    source: "source './test_helper/bats-assert/load.bash'\ntest_value() { local value=1; if [[ $value ]]; then assert_success; run || cleanup; fi; }\n"
  }
];

function applicableCategories(family) {
  const entry = DIALECT_CAPABILITY_MANIFEST.families.find((candidate) => candidate.family === family);
  return new Set(Object.entries(entry.capabilities)
    .filter(([, capability]) => capability.status === "applicable")
    .map(([category]) => category));
}

test("Python, Go, Java, Ruby, and Bash emit every applicable category", async () => {
  for (const fixture of FIXTURES) {
    const before = await fixture.parser.parseCode(fixture.source, fixture.path, fixture.language);
    const transport = await fixture.parser.parseCodeWithDialectObservations(fixture.source, fixture.path, fixture.language);
    const after = await fixture.parser.parseCode(fixture.source, fixture.path, fixture.language);
    assert.equal(transport.observation_envelope.status, "ok", fixture.family);
    assert.deepEqual(transport.parser_result, before, fixture.family);
    assert.deepEqual(after, before, fixture.family);
    assert.deepEqual(
      new Set(transport.observation_envelope.observations.map((entry) => entry.category)),
      applicableCategories(fixture.family),
      fixture.family
    );
  }
});

test("every Tree-sitter wrapper and dispatcher has one native parse path", async () => {
  for (const file of [
    "cpp-treesitter.mjs", "rust-treesitter.mjs", "python-treesitter.mjs",
    "go-treesitter.mjs", "java-treesitter.mjs", "ruby-treesitter.mjs",
    "bash-treesitter.mjs"
  ]) {
    const source = fs.readFileSync(`scaffold/scripts/parsers/${file}`, "utf8");
    const compositeStart = source.indexOf("export async function parseCodeWithDialectObservations");
    const classifierStarts = [
      source.indexOf("function createDialectClassifier", compositeStart),
      source.indexOf("function classifyDialectNode", compositeStart)
    ].filter((index) => index >= 0);
    const composite = source.slice(compositeStart, Math.min(...classifierStarts));
    assert.equal((composite.match(/parseInternal\(/g) ?? []).length, 1, file);
    assert.equal((composite.match(/parseCode\(/g) ?? []).length, 0, file);

    const internalStart = source.indexOf("async function parseInternal");
    const internalEnd = source.indexOf("export async function parseCodeWithDialectObservations", internalStart);
    const internal = source.slice(internalStart, internalEnd);
    assert.equal((internal.match(/parseSource\(/g) ?? []).length, 1, file);

    const legacyStart = source.indexOf("export async function parseCode(");
    const legacyEnd = source.indexOf("async function parseInternal", legacyStart);
    assert.equal((source.slice(legacyStart, legacyEnd).match(/parseInternal\(/g) ?? []).length, 1, file);
  }

  for (const file of ["cpp-dispatch.mjs", "rust-dispatch.mjs"]) {
    const source = fs.readFileSync(`scaffold/scripts/parsers/${file}`, "utf8");
    const compositeStart = source.indexOf("export async function parseCodeWithDialectObservations");
    const compositeEnd = source.indexOf("export async function is", compositeStart);
    const composite = source.slice(compositeStart, compositeEnd);
    assert.equal((composite.match(/parser\.parseCodeWithDialectObservations\(/g) ?? []).length, 1, file);
    assert.equal((composite.match(/parser\.parseCode\(/g) ?? []).length, 1, file);
  }

  const base = fs.readFileSync("scaffold/scripts/parsers/tree-sitter/base.mjs", "utf8");
  const parseSourceStart = base.indexOf("export function parseSource");
  const parseSourceEnd = base.indexOf("export function runQuery", parseSourceStart);
  assert.equal((base.slice(parseSourceStart, parseSourceEnd).match(/parser\.parse\(/g) ?? []).length, 1);
});

test("Tree-sitter adapters reject shadowed, conflicting, unsupported, and production-like test names", async () => {
  const fixtures = [
    [python, "def fixture(fn): return fn\n@fixture\ndef value():\n    assert_equal(1, 1)\n    return 1\n", "src/ordinary.py", "python"],
    [go, "package p\ntype fakeT struct{}\nfunc (t *fakeT) Error() {}\nfunc TestValue(t *fakeT) { t.Error(); return }\n", "src/ordinary.go", "go"],
    [go, "package p\nimport (\n  _ \"testing\"\n  evil \"example.com/evil\"\n)\nfunc TestValue(t *evil.T) {}\n", "src/blank_test.go", "go"],
    [go, "package p\nimport (\n  \"testing\"\n  \"evil/testing\"\n)\nfunc TestValue(t *testing.T) {}\n", "src/competing_test.go", "go"],
    [java, "@interface Test {} class Example { @Test int value() { assertEquals(1, 1); return 1; } void assertEquals(int a, int b) {} }", "src/Ordinary.java", "java"],
    [ruby, "class Example\n  def test_value\n    assert_equal 1, 1\n    return 1\n  end\n  def assert_equal(a, b); a == b; end\nend\n", "src/ordinary.rb", "ruby"],
    [ruby, "def require(name); name; end\nmodule Minitest\n  class Test; end\nend\nrequire \"minitest/autorun\"\nclass Example < Minitest::Test\n  def test_value; 1; end\nend\n", "src/spoofed.rb", "ruby"],
    [ruby, "Object.define_singleton_method(:require) { |name| name }\nObject.const_set(:Minitest, Module.new)\nMinitest.const_set(:Test, Class.new)\nMinitest::Test.module_eval { define_method(:test_value) { 1 } }\nrequire \"minitest/autorun\"\nclass Example < Minitest::Test\n  def test_value; 1; end\nend\n", "src/dynamic-spoofed.rb", "ruby"],
    [bash, "source './test_helper/bats-assert/load.bash'\nassert_success() { :; }\ntest_value() { [[ 1 ]]; assert_success; return 0; }\n", "src/ordinary.sh", "bash"],
    [bash, "source() { :; }\nsource './test_helper/bats-assert/load.bash'\ntest_value() { assert_success; return 0; }\n", "src/shadowed-source.sh", "bash"],
    [bash, "alias source=false\nsource './test_helper/bats-assert/load.bash'\ntest_value() { assert_success; return 0; }\n", "src/aliased-source.sh", "bash"],
    [bash, "alias 'source=false'\nalias '.=false'\nalias 'assert_success=:'\nsource './test_helper/bats-assert/load.bash'\ntest_value() { assert_success; return 0; }\n", "src/quoted-aliases.sh", "bash"]
  ];
  for (const [parser, source, repositoryPath, language] of fixtures) {
    const transport = await parser.parseCodeWithDialectObservations(source, repositoryPath, language);
    const observations = transport.observation_envelope.observations;
    assert.equal(observations.some((entry) => entry.category === "test_shape"), false, language);
    assert.equal(observations.some((entry) => entry.category === "error_flow"), false, language);
  }
});

test("Go test declarations bind the exact default or explicit testing qualifier", async () => {
  for (const source of [
    "package p\nimport \"testing\"\nfunc TestValue(t *testing.T) {}\n",
    "package p\nimport testpkg \"testing\"\nfunc TestValue(t *testpkg.T) {}\n",
    "package p\nimport \"testing\"\nfunc helper(testing int) {}\nfunc TestValue(t *testing.T) {}\n"
  ]) {
    const transport = await go.parseCodeWithDialectObservations(source, "src/value_test.go", "go");
    assert.equal(
      transport.observation_envelope.observations.some((entry) => entry.category === "test_shape"),
      true
    );
  }
});

test("Ruby and Bash never emit unsupported framework-bound test facts", async () => {
  for (const fixture of FIXTURES.filter((entry) => ["ruby", "bash"].includes(entry.family))) {
    const transport = await fixture.parser.parseCodeWithDialectObservations(
      fixture.source,
      fixture.path,
      fixture.language
    );
    assert.equal(
      transport.observation_envelope.observations.some((entry) => entry.category === "test_shape"),
      false,
      fixture.family
    );
  }
});

test("Bash error flow requires native failure-branch syntax rather than shadowable command names", async () => {
  const positive = await bash.parseCodeWithDialectObservations(
    "run || cleanup\n",
    "src/failure-handler.sh",
    "bash"
  );
  assert.equal(
    positive.observation_envelope.observations.some((entry) =>
      entry.category === "error_flow" && entry.normalized_shape === '{"kind":"handler"}'
    ),
    true
  );
  assert.equal(
    positive.observation_envelope.observations.some((entry) =>
      entry.category === "data_representation" && entry.normalized_shape === '{"kind":"container"}'
    ),
    false
  );

  for (const source of [
    "trap cleanup EXIT\n",
    "builtin trap cleanup EXIT\n",
    "builtin() { printf '%s\\n' \"$*\"; }\nbuiltin trap cleanup EXIT\n"
  ]) {
    const transport = await bash.parseCodeWithDialectObservations(
      source,
      "src/shadowable-trap.sh",
      "bash"
    );
    assert.equal(
      transport.observation_envelope.observations.some((entry) => entry.category === "error_flow"),
      false,
      source
    );
  }
});

test("all registered shell modes use the Bash Tree-sitter adapter", async () => {
  for (const repositoryPath of ["src/mode.sh", "src/mode.bash", "src/mode.zsh"]) {
    const transport = await bash.parseCodeWithDialectObservations(FIXTURES[4].source, repositoryPath, "bash");
    assert.equal(transport.observation_envelope.status, "ok", repositoryPath);
    assert.ok(transport.observation_envelope.observations.length > 0, repositoryPath);
  }
});

test("Tree-sitter ordering and IDs are deterministic across repeated runs", async () => {
  for (const fixture of FIXTURES) {
    const first = await fixture.parser.parseCodeWithDialectObservations(fixture.source, fixture.path, fixture.language);
    const second = await fixture.parser.parseCodeWithDialectObservations(fixture.source, fixture.path, fixture.language);
    assert.deepEqual(second, first, fixture.family);
    const observations = first.observation_envelope.observations;
    assert.deepEqual(observations, [...observations].sort(compareDialectObservations), fixture.family);
    assert.equal(new Set(observations.map((entry) => entry.observation_id)).size, observations.length, fixture.family);
  }
});

test("Tree-sitter converts Unicode, CRLF, and multiline spans and skips zero-width roots", async () => {
  const source = "label = \"😀\"\r\ndef test_value(value):\r\n    assert value\r\n";
  const transport = await python.parseCodeWithDialectObservations(source, "src/unicode.py", "python");
  const functionObservation = transport.observation_envelope.observations.find((entry) =>
    entry.category === "declaration_structure" &&
    entry.normalized_shape === '{"kind":"function"}'
  );
  assert.deepEqual(
    [functionObservation?.start_line, functionObservation?.start_column, functionObservation?.end_line, functionObservation?.end_column],
    [2, 0, 3, 15]
  );
  const stateObservation = transport.observation_envelope.observations.find((entry) =>
    entry.category === "data_representation" && entry.start_line === 1
  );
  assert.deepEqual(
    [stateObservation?.start_column, stateObservation?.end_column],
    [0, 11]
  );

  const empty = await python.parseCodeWithDialectObservations("", "src/empty.py", "python");
  assert.equal(empty.observation_envelope.status, "ok");
  assert.deepEqual(empty.observation_envelope.observations, []);
});

test("shared Tree-sitter handling reports malformed and all-or-nothing caps", async () => {
  const malformed = await python.parseCodeWithDialectObservations("def (", "src/bad.py", "python");
  assert.equal(malformed.observation_envelope.status, "malformed");
  assert.deepEqual(malformed.observation_envelope.observations, []);

  const branches = Array.from({ length: 520 }, () => "if (value) { value++; }").join("\n");
  const cappedSource = `int run(int value) {\n${branches}\nreturn value;\n}`;
  const cpp = await import("../scaffold/scripts/parsers/cpp-treesitter.mjs");
  const capped = await cpp.parseCodeWithDialectObservations(cappedSource, "src/capped.cpp", "cpp");
  assert.equal(capped.observation_envelope.status, "truncated");
  assert.deepEqual(capped.observation_envelope.observations, []);
  assert.equal(capped.observation_envelope.diagnostics.observed_count, capped.observation_envelope.diagnostics.omitted_count);
  assert.equal(capped.observation_envelope.diagnostics.observed_count, 524);

  const oversizedSource = `#${"x".repeat(DIALECT_LIMITS.max_source_bytes)}\n`;
  const oversized = await python.parseCodeWithDialectObservations(oversizedSource, "src/large.py", "python");
  assert.equal(oversized.observation_envelope.status, "oversized");
  assert.deepEqual(oversized.observation_envelope.observations, []);
});

test("Tree-sitter transport retains no raw syntax, aliases, accessors, or parser prototypes", async () => {
  const transport = await java.parseCodeWithDialectObservations(FIXTURES[2].source, FIXTURES[2].path, "java");
  const forbidden = new Set(["ast", "rootnode", "namedrootnode", "tree", "treecursor", "source", "code", "rawtext"]);
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    assert.ok([Object.prototype, Array.prototype].includes(Object.getPrototypeOf(value)));
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      assert.ok("value" in descriptor, key);
      assert.equal(forbidden.has(key.replace(/[^a-z]/gi, "").toLowerCase()), false, key);
      visit(descriptor.value);
    }
  };
  visit(transport);
});
