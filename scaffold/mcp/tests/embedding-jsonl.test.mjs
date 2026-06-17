import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readJsonlRecords, writeJsonlRecords } from "../dist/jsonl.js";

test("writeJsonlRecords writes canonical JSONL without building a joined body", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-jsonl-"));
  const filePath = path.join(dir, "embeddings.jsonl");
  const records = [
    { id: "a", vector: [1, 2.5], model: "m" },
    { id: "b", vector: [0], model: "m", label: "two" }
  ];

  const count = writeJsonlRecords(filePath, records);

  assert.equal(count, 2);
  assert.equal(fs.readFileSync(filePath, "utf8"), records.map(JSON.stringify).join("\n") + "\n");
});

test("readJsonlRecords streams valid records and skips blank or invalid lines", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-jsonl-"));
  const filePath = path.join(dir, "embeddings.jsonl");
  fs.writeFileSync(filePath, '{"id":"a"}\r\n\nnot json\n{"id":"b"}\n', "utf8");

  assert.deepEqual(Array.from(readJsonlRecords(filePath)), [{ id: "a" }, { id: "b" }]);
});

test("writeJsonlRecords creates an empty file for empty output", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-jsonl-"));
  const filePath = path.join(dir, "empty.jsonl");

  const count = writeJsonlRecords(filePath, []);

  assert.equal(count, 0);
  assert.equal(fs.readFileSync(filePath, "utf8"), "");
});
