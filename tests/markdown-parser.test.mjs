import test from "node:test";
import assert from "node:assert/strict";
import { parseCode } from "../scaffold/scripts/parsers/markdown.mjs";

test("markdown parser splits H1-H3 headings into sections", () => {
  const source = [
    "# Title",
    "Intro text.",
    "",
    "## Setup",
    "Install things.",
    "",
    "### Details",
    "More depth.",
    ""
  ].join("\n");

  const result = parseCode(source, "doc.md");
  const names = result.chunks.map((chunk) => chunk.name);

  assert.deepEqual(names, ["Title", "Setup", "Details"]);
  assert.equal(result.errors.length, 0);
  for (const chunk of result.chunks) {
    assert.equal(chunk.kind, "section");
    assert.equal(chunk.language, "markdown");
  }
});

test("markdown parser keeps H4+ headings inside their parent section", () => {
  const source = [
    "## Parent",
    "Body.",
    "",
    "#### Sub-detail",
    "Nested body.",
    ""
  ].join("\n");

  const result = parseCode(source, "doc.md");

  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].name, "Parent");
  assert.ok(result.chunks[0].body.includes("#### Sub-detail"));
  assert.ok(result.chunks[0].body.includes("Nested body."));
});

test("markdown parser ignores headings inside fenced code blocks", () => {
  const source = [
    "# Real Section",
    "Some prose.",
    "",
    "```bash",
    "# this is a comment, not a heading",
    "echo hi",
    "```",
    "",
    "~~~",
    "## also not a heading",
    "~~~",
    "More prose.",
    ""
  ].join("\n");

  const result = parseCode(source, "doc.md");

  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].name, "Real Section");
  assert.ok(result.chunks[0].body.includes("# this is a comment, not a heading"));
  assert.ok(result.chunks[0].body.includes("## also not a heading"));
});

test("markdown parser captures content before the first heading as preamble", () => {
  const source = [
    "Leading prose before any heading.",
    "Second line.",
    "",
    "# First Heading",
    "Body.",
    ""
  ].join("\n");

  const result = parseCode(source, "doc.md");

  assert.equal(result.chunks[0].name, "preamble");
  assert.ok(result.chunks[0].body.includes("Leading prose before any heading."));
  assert.equal(result.chunks[1].name, "First Heading");
});

test("markdown parser skips heading-only sections with no content", () => {
  const source = [
    "# Empty One",
    "",
    "# Has Content",
    "Body here.",
    "",
    "# Empty Two",
    ""
  ].join("\n");

  const result = parseCode(source, "doc.md");
  const names = result.chunks.map((chunk) => chunk.name);

  assert.deepEqual(names, ["Has Content"]);
});

test("markdown parser reports 1-based start and end line numbers", () => {
  const source = [
    "preamble line", // line 1
    "", //              line 2
    "# Section A", //   line 3
    "a body", //        line 4
    "", //              line 5
    "## Section B", //  line 6
    "b body" //         line 7
  ].join("\n");

  const result = parseCode(source, "doc.md");
  const byName = new Map(result.chunks.map((chunk) => [chunk.name, chunk]));

  assert.equal(byName.get("preamble").startLine, 1);
  assert.equal(byName.get("Section A").startLine, 3);
  assert.equal(byName.get("Section A").endLine, 5);
  assert.equal(byName.get("Section B").startLine, 6);
  assert.equal(byName.get("Section B").endLine, 7);
});
