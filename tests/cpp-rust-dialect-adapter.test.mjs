import test from "node:test";
import assert from "node:assert/strict";
import * as cpp from "../scaffold/scripts/parsers/cpp-treesitter.mjs";
import * as rust from "../scaffold/scripts/parsers/rust-treesitter.mjs";
import * as cppDispatch from "../scaffold/scripts/parsers/cpp-dispatch.mjs";
import * as rustDispatch from "../scaffold/scripts/parsers/rust-dispatch.mjs";
import { compareDialectObservations } from "../scaffold/scripts/lib/dialect-observation-contract.mjs";

const C_SOURCE = [
  "#include <setjmp.h>",
  "static_assert(sizeof(int) > 0, \"int required\");",
  "jmp_buf error_target;",
  "struct Value { int count; };",
  "int test_value(int input) {",
  "  if (input < 0) longjmp(error_target, 1);",
  "  return input;",
  "}"
].join("\n");

const CPP_SOURCE = [
  "static_assert(sizeof(int) > 0, \"int required\");",
  "struct Value { int count; };",
  "int test_value(int input) {",
  "  try { if (input < 0) throw input; } catch (...) { return -1; }",
  "  return input;",
  "}"
].join("\n");

const RUST_SOURCE = [
  "struct Value { count: i32 }",
  "#[test]",
  "fn test_value(input: Result<i32, Error>) -> Result<i32, Error> {",
  "    let value = input?;",
  "    if value < 0 { return Err(Error); }",
  "    Ok(value)",
  "}"
].join("\n");

const ALL_CATEGORIES = new Set([
  "declaration_structure", "control_flow", "error_flow",
  "data_representation", "test_shape"
]);

test("C and C++ adapters cover every registered mode", async () => {
  const modes = [
    ["src/value.c", "c", C_SOURCE],
    ["src/value.h", "c", C_SOURCE],
    ["src/value.cpp", "cpp", CPP_SOURCE],
    ["src/value.cc", "cpp", CPP_SOURCE],
    ["src/value.hpp", "cpp", CPP_SOURCE],
    ["src/value.hh", "cpp", CPP_SOURCE]
  ];
  for (const [repositoryPath, language, source] of modes) {
    const transport = await cpp.parseCodeWithDialectObservations(source, repositoryPath, language);
    assert.equal(transport.observation_envelope.status, "ok", repositoryPath);
    assert.ok(transport.observation_envelope.observations.length > 0, repositoryPath);
  }
});

test("C, C++, and Rust emit every applicable category from native syntax", async () => {
  const fixtures = [
    [cpp, C_SOURCE, "src/value.c", "c"],
    [cpp, CPP_SOURCE, "src/value.cpp", "cpp"],
    [rust, RUST_SOURCE, "src/value.rs", "rust"]
  ];
  for (const [parser, source, repositoryPath, language] of fixtures) {
    const transport = await parser.parseCodeWithDialectObservations(source, repositoryPath, language);
    assert.equal(transport.observation_envelope.status, "ok", language);
    assert.deepEqual(
      new Set(transport.observation_envelope.observations.map((entry) => entry.category)),
      ALL_CATEGORIES,
      language
    );
  }
});

test("C/C++ and Rust parser results remain exactly equal before and after adapter use", async () => {
  for (const [parser, source, repositoryPath, language] of [
    [cpp, CPP_SOURCE, "src/equality.cpp", "cpp"],
    [rust, RUST_SOURCE, "src/equality.rs", "rust"]
  ]) {
    const before = await parser.parseCode(source, repositoryPath, language);
    const transport = await parser.parseCodeWithDialectObservations(source, repositoryPath, language);
    const after = await parser.parseCode(source, repositoryPath, language);
    assert.deepEqual(transport.parser_result, before, language);
    assert.deepEqual(after, before, language);
  }
});

test("C/C++ and Rust dispatchers preserve the single delegated parser result", async () => {
  for (const [parser, source, repositoryPath, language] of [
    [cppDispatch, CPP_SOURCE, "src/dispatch.cpp", "cpp"],
    [rustDispatch, RUST_SOURCE, "src/dispatch.rs", "rust"]
  ]) {
    const before = await parser.parseCode(source, repositoryPath, language);
    const transport = await parser.parseCodeWithDialectObservations(source, repositoryPath, language);
    assert.deepEqual(transport.parser_result, before, language);
    assert.equal(transport.observation_envelope.status, "ok", language);
  }
});

test("C, C++, and Rust reject shadowed framework-like names and ordinary returns", async () => {
  const fixtures = [
    [cpp, "#include <setjmp.h>\n#define longjmp(target, value) value\nvoid assert(int); void TEST(void); int ordinary(void) { assert(1); TEST(); longjmp(0, 1); return 1; }", "src/ordinary.c", "c"],
    [cpp, "void EXPECT_TRUE(bool); void TEST_CASE(); int value() { EXPECT_TRUE(true); TEST_CASE(); return 1; }", "src/ordinary.cpp", "cpp"],
    [cpp, "#include <setjmp.h>\nvoid ordinary(jmp_buf target) { auto longjmp = [](jmp_buf, int) {}; longjmp(target, 1); }", "src/local-longjmp.cpp", "cpp"],
    [rust, [
      "macro_rules! assert { ($value:expr) => { $value } }",
      "#[test_case]",
      "fn value() -> Result<i32, Error> { assert!(true); Ok(1) }"
    ].join("\n"), "src/ordinary.rs", "rust"]
  ];
  for (const [parser, source, repositoryPath, language] of fixtures) {
    const transport = await parser.parseCodeWithDialectObservations(source, repositoryPath, language);
    const observations = transport.observation_envelope.observations;
    assert.equal(observations.some((entry) => entry.category === "test_shape"), false, language);
    assert.equal(observations.some((entry) => entry.category === "error_flow"), false, language);
  }
});

test("C/C++ and Rust ordering and identities are stable", async () => {
  for (const [parser, source, repositoryPath, language] of [
    [cpp, CPP_SOURCE, "src/stable.cpp", "cpp"],
    [rust, RUST_SOURCE, "src/stable.rs", "rust"]
  ]) {
    const first = await parser.parseCodeWithDialectObservations(source, repositoryPath, language);
    const second = await parser.parseCodeWithDialectObservations(source, repositoryPath, language);
    assert.deepEqual(second, first, language);
    const observations = first.observation_envelope.observations;
    assert.deepEqual(observations, [...observations].sort(compareDialectObservations), language);
    assert.equal(new Set(observations.map((entry) => entry.observation_id)).size, observations.length, language);
  }
});

test("Rust mode validation and malformed syntax fail closed", async () => {
  const valid = await rust.parseCodeWithDialectObservations(RUST_SOURCE, "src/value.rs", "rust");
  assert.equal(valid.observation_envelope.status, "ok");
  await assert.rejects(
    () => rust.parseCodeWithDialectObservations(RUST_SOURCE, "src/value.cpp", "rust"),
    /unsupported parser mode/
  );
  const malformed = await rust.parseCodeWithDialectObservations("fn broken(", "src/broken.rs", "rust");
  assert.equal(malformed.observation_envelope.status, "malformed");
  assert.deepEqual(malformed.observation_envelope.observations, []);
});
