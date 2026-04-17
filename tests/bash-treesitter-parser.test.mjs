import test from "node:test";
import assert from "node:assert/strict";
import { parseCode } from "../scripts/parsers/bash-treesitter.mjs";

test("bash parser extracts a function declared with function keyword", () => {
  const source = [
    "function add() {",
    "  echo $(($1 + $2))",
    "}"
  ].join("\n");

  const result = parseCode(source, "add.sh", "bash");
  const chunk = result.chunks.find((c) => c.name === "add");

  assert.ok(chunk);
  assert.equal(chunk.kind, "function");
  assert.equal(chunk.language, "bash");
});

test("bash parser extracts a function declared with alternate syntax", () => {
  const source = [
    "greet() {",
    "  echo \"hello $1\"",
    "}"
  ].join("\n");

  const result = parseCode(source, "greet.sh", "bash");
  const chunk = result.chunks.find((c) => c.name === "greet");

  assert.ok(chunk);
  assert.equal(chunk.kind, "function");
});

test("bash parser extracts nested functions as separate chunks", () => {
  const source = [
    "outer() {",
    "  inner() {",
    "    echo nested",
    "  }",
    "  inner",
    "}"
  ].join("\n");

  const result = parseCode(source, "nested.sh", "bash");
  const names = new Set(result.chunks.map((c) => c.name));

  assert.ok(names.has("outer"));
  assert.ok(names.has("inner"));
});

test("bash parser extracts user-defined calls and filters shell builtins", () => {
  const source = [
    "run() {",
    "  helper",
    "  echo 'hi'",
    "  other_func arg1 arg2",
    "  cat /tmp/file",
    "  my_task",
    "}"
  ].join("\n");

  const result = parseCode(source, "r.sh", "bash");
  const chunk = result.chunks.find((c) => c.name === "run");

  assert.ok(chunk);
  assert.ok(chunk.calls.includes("helper"));
  assert.ok(chunk.calls.includes("other_func"));
  assert.ok(chunk.calls.includes("my_task"));
  assert.ok(!chunk.calls.includes("echo"), "echo should be filtered as builtin");
  assert.ok(!chunk.calls.includes("cat"), "cat should be filtered as common system command");
});

test("bash parser strips absolute paths when filtering commands", () => {
  const source = [
    "check() {",
    "  /usr/bin/which bash",
    "  /bin/ls /tmp",
    "  custom_script",
    "}"
  ].join("\n");

  const result = parseCode(source, "c.sh", "bash");
  const chunk = result.chunks.find((c) => c.name === "check");

  assert.ok(chunk);
  assert.ok(chunk.calls.includes("custom_script"));
  assert.ok(!chunk.calls.some((c) => c.includes("which")), "which with path should be filtered");
  assert.ok(!chunk.calls.some((c) => c.includes("ls")), "ls with path should be filtered");
});

test("bash parser extracts top-level source and . imports", () => {
  const source = [
    "source ./util.sh",
    ". ./helpers.sh",
    "",
    "run() {",
    "  helper",
    "}"
  ].join("\n");

  const result = parseCode(source, "app.sh", "bash");
  const chunk = result.chunks.find((c) => c.name === "run");

  assert.ok(chunk);
  assert.ok(chunk.imports.includes("./util.sh"));
  assert.ok(chunk.imports.includes("./helpers.sh"));
});

test("bash parser ignores dynamic source paths with substitutions", () => {
  const source = [
    ". \"$(dirname \"$0\")/lib.sh\"",
    "source ./static.sh",
    "",
    "use() { echo ok; }"
  ].join("\n");

  const result = parseCode(source, "dyn.sh", "bash");
  const chunk = result.chunks.find((c) => c.name === "use");

  assert.ok(chunk);
  // The dynamic one should be skipped; the static one should be present.
  assert.ok(chunk.imports.includes("./static.sh"));
  assert.ok(!chunk.imports.some((i) => i.includes("dirname")));
});

test("bash parser ignores source calls nested inside function bodies", () => {
  const source = [
    "lazy() {",
    "  source ./dynamic.sh",
    "  do_work",
    "}"
  ].join("\n");

  const result = parseCode(source, "lazy.sh", "bash");
  const chunk = result.chunks.find((c) => c.name === "lazy");

  assert.ok(chunk);
  // source inside function body should NOT be promoted to top-level imports
  assert.ok(!chunk.imports.includes("./dynamic.sh"));
});

test("bash parser marks _-prefixed function names as not exported", () => {
  const source = [
    "_internal() { return 0; }",
    "public_api() { return 0; }"
  ].join("\n");

  const result = parseCode(source, "s.sh", "bash");
  const internal = result.chunks.find((c) => c.name === "_internal");
  const api = result.chunks.find((c) => c.name === "public_api");

  assert.equal(internal.exported, false);
  assert.equal(api.exported, true);
});

test("bash parser handles heredocs without breaking", () => {
  const source = [
    "write_config() {",
    "  cat > /tmp/x <<EOF",
    "this is in a heredoc",
    "still in heredoc",
    "EOF",
    "}"
  ].join("\n");

  const result = parseCode(source, "w.sh", "bash");
  const chunk = result.chunks.find((c) => c.name === "write_config");

  assert.ok(chunk);
  assert.equal(chunk.kind, "function");
});

test("bash parser handles empty input without errors", () => {
  const result = parseCode("", "empty.sh", "bash");
  assert.deepEqual(result.errors, []);
  assert.equal(result.chunks.length, 0);
});

test("bash parser returns empty for top-level scripts without functions", () => {
  const source = [
    "#!/usr/bin/env bash",
    "echo 'running'",
    "cd /tmp",
    "ls"
  ].join("\n");

  const result = parseCode(source, "script.sh", "bash");
  assert.deepEqual(result.errors, []);
  assert.equal(result.chunks.length, 0);
});
