import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { toCsvCell, toCsvRow, writeCsv, toCopyPathLiteral, CSV_NULL_SENTINEL, CSV_COPY_OPTIONS } from "../dist/graphCsv.js";

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

test("writeCsv: streams iterable rows with byte-equivalent CSV output", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-csv-"));
  const filePath = path.join(dir, "rows.csv");
  try {
    function* rows() {
      yield ["a", 1, true];
      yield ['she said "hi"', "a\nb", ""];
      yield [null, undefined, false];
    }

    const rowCount = writeCsv(filePath, ["c1", "c2", "c3"], rows());
    const expected = [
      toCsvRow(["c1", "c2", "c3"]),
      toCsvRow(["a", 1, true]),
      toCsvRow(['she said "hi"', "a\nb", ""]),
      toCsvRow([null, undefined, false]),
      ""
    ].join("\n");

    assert.equal(rowCount, 3);
    assert.equal(fs.readFileSync(filePath, "utf8"), expected);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("writeCsv: empty iterables write only the header and return zero rows", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-csv-empty-"));
  const filePath = path.join(dir, "rows.csv");
  try {
    const rowCount = writeCsv(filePath, ["only"], []);

    assert.equal(rowCount, 0);
    assert.equal(fs.readFileSync(filePath, "utf8"), `${toCsvRow(["only"])}\n`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

test("toCopyPathLiteral leaves a plain posix path untouched", () => {
  assert.equal(toCopyPathLiteral("/repo/.context/cache/graph-import/File.csv"), "/repo/.context/cache/graph-import/File.csv");
});

test("toCopyPathLiteral backslash-escapes embedded double quotes", () => {
  assert.equal(toCopyPathLiteral('/we"ird/File.csv'), '/we\\"ird/File.csv');
  assert.equal(toCopyPathLiteral('/a"b"c/File.csv'), '/a\\"b\\"c/File.csv');
});

test("toCopyPathLiteral normalizes windows separators to forward slashes", () => {
  assert.equal(toCopyPathLiteral("C:\\repo\\cache\\File.csv"), "C:/repo/cache/File.csv");
});

test("toCopyPathLiteral normalizes separators before escaping quotes", () => {
  // The escaping backslash inserted for the quote must survive (not be turned
  // into a slash): separators are normalized first, then quotes escaped.
  assert.equal(toCopyPathLiteral('C:\\we"ird\\File.csv'), 'C:/we\\"ird/File.csv');
});
