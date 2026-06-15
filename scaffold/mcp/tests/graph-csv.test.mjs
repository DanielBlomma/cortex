import test from "node:test";
import assert from "node:assert/strict";

import { toCsvCell, toCsvRow, CSV_NULL_SENTINEL, CSV_COPY_OPTIONS } from "../dist/graphCsv.js";

test("toCsvCell: quotes plain strings", () => {
  assert.equal(toCsvCell("hello"), '"hello"');
});

test("toCsvCell: doubles internal quotes", () => {
  assert.equal(toCsvCell('she said "hi"'), '"she said ""hi"""');
});

test("toCsvCell: preserves newlines, CRLF, commas, and tabs verbatim", () => {
  assert.equal(toCsvCell("a\nb"), '"a\nb"');
  assert.equal(toCsvCell("a\r\nb"), '"a\r\nb"');
  assert.equal(toCsvCell("a,b,,c"), '"a,b,,c"');
  assert.equal(toCsvCell("x\ty"), '"x\ty"');
});

test("toCsvCell: empty string becomes an empty quoted field, not the null sentinel", () => {
  assert.equal(toCsvCell(""), '""');
});

test("toCsvCell: booleans render as true/false, numbers via String()", () => {
  assert.equal(toCsvCell(true), '"true"');
  assert.equal(toCsvCell(false), '"false"');
  assert.equal(toCsvCell(0), '"0"');
  assert.equal(toCsvCell(42), '"42"');
  assert.equal(toCsvCell(-1), '"-1"');
});

test("toCsvCell: null and undefined collapse to empty field", () => {
  assert.equal(toCsvCell(null), '""');
  assert.equal(toCsvCell(undefined), '""');
});

test("toCsvCell: preserves unicode and backslashes", () => {
  assert.equal(toCsvCell("åäö 日本語 🚀"), '"åäö 日本語 🚀"');
  assert.equal(toCsvCell("C:\\path\\n"), '"C:\\path\\n"');
});

test("toCsvRow: joins cells with commas", () => {
  assert.equal(toCsvRow(["a", 1, true]), '"a","1","true"');
  assert.equal(toCsvRow(['a"b', "c,d"]), '"a""b","c,d"');
});

test("CSV_NULL_SENTINEL is a single NUL byte (impossible in any text-file-derived cell)", () => {
  assert.equal(CSV_NULL_SENTINEL.length, 1);
  assert.equal(CSV_NULL_SENTINEL.charCodeAt(0), 0);
});

test("CSV_COPY_OPTIONS disables parallel reads and empty-as-null", () => {
  assert.match(CSV_COPY_OPTIONS, /PARALLEL=false/);
  assert.match(CSV_COPY_OPTIONS, /HEADER=true/);
  assert.match(CSV_COPY_OPTIONS, /NULL_STRINGS=\[/);
});
