import test from "node:test";
import assert from "node:assert/strict";
import {
  bodyOf,
  dedupe,
  groupByAnchor,
  initTreeSitter,
  lineRangeOf,
  loadGrammar,
  normalizeWhitespace,
  parseSource,
  prepareLanguage,
  resetGrammarCache,
  runQuery
} from "../scaffold/scripts/parsers/tree-sitter/base.mjs";

test("initTreeSitter is idempotent and returns the tree-sitter module", async () => {
  const a = await initTreeSitter();
  const b = await initTreeSitter();
  assert.equal(a, b);
  assert.equal(typeof a.Language?.load, "function");
});

test("loadGrammar loads rust grammar and caches it", async () => {
  resetGrammarCache();
  const first = await loadGrammar("rust");
  const second = await loadGrammar("rust");
  assert.equal(first, second, "grammar should be cached and return same instance");
});

test("parseSource produces a source_file root for rust", async () => {
  const language = await loadGrammar("rust");
  const { tree } = parseSource(language, "fn add(a: i32, b: i32) -> i32 { a + b }");
  assert.equal(tree.rootNode.type, "source_file");
  assert.ok(tree.rootNode.childCount > 0);
});

test("runQuery returns named captures for function declarations", async () => {
  const language = await loadGrammar("rust");
  const { tree } = parseSource(language, "fn add(a: i32, b: i32) -> i32 { a + b }");
  const captures = runQuery(
    language,
    "(function_item name: (identifier) @name) @fn",
    tree.rootNode
  );
  const names = captures.map((c) => c.name);
  assert.ok(names.includes("fn"));
  assert.ok(names.includes("name"));
  const nameCap = captures.find((c) => c.name === "name");
  assert.equal(nameCap.node.text, "add");
});

test("groupByAnchor groups captures by enclosing anchor node", async () => {
  const language = await loadGrammar("rust");
  const source = [
    "fn alpha() { beta(); }",
    "fn gamma() { delta(); }"
  ].join("\n");
  const { tree } = parseSource(language, source);
  const captures = runQuery(
    language,
    "(function_item name: (identifier) @name) @fn",
    tree.rootNode
  );

  const groups = groupByAnchor(captures, "fn");
  assert.equal(groups.length, 2);
  assert.equal(groups[0].get("name").text, "alpha");
  assert.equal(groups[1].get("name").text, "gamma");
});

test("lineRangeOf returns 1-based inclusive line numbers", async () => {
  const language = await loadGrammar("rust");
  const source = "\n\nfn noop() {}\n";
  const { tree } = parseSource(language, source);
  const captures = runQuery(language, "(function_item) @fn", tree.rootNode);
  const range = lineRangeOf(captures[0].node);
  assert.equal(range.startLine, 3);
  assert.equal(range.endLine, 3);
});

test("bodyOf returns node text, truncated when exceeding max", async () => {
  const language = await loadGrammar("rust");
  const source = "fn big() { " + "let x=1; ".repeat(200) + "}";
  const { tree } = parseSource(language, source);
  const captures = runQuery(language, "(function_item) @fn", tree.rootNode);
  const full = bodyOf(captures[0].node);
  const truncated = bodyOf(captures[0].node, 50);
  assert.ok(full.length > 50);
  assert.equal(truncated.length, 50);
});

test("normalizeWhitespace collapses whitespace", () => {
  assert.equal(normalizeWhitespace("  hello\n\tworld  "), "hello world");
});

test("dedupe removes duplicates and falsy entries", () => {
  assert.deepEqual(dedupe(["a", "b", "a", "", null, undefined, "c"]), ["a", "b", "c"]);
});

test("prepareLanguage bundles init + grammar + helpers", async () => {
  const { language, parse, query } = await prepareLanguage("rust");
  assert.ok(language);
  const { tree } = parse("fn zero() -> i32 { 0 }");
  const caps = query("(function_item name: (identifier) @n) @f", tree.rootNode);
  assert.ok(caps.some((c) => c.name === "n" && c.node.text === "zero"));
});
