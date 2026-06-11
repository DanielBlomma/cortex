import test from "node:test";
import assert from "node:assert/strict";
import { parseFileEntities, parseChunkEntities, resolveModelId, DEFAULT_MODEL_ID } from "../dist/embed.js";

function fileRecord(content) {
  return {
    id: "file-1",
    path: "src/big.ts",
    content,
    excerpt: "excerpt",
    updated_at: "2026-01-01T00:00:00Z",
    checksum: "fixed-checksum"
  };
}

function chunkRecord(body) {
  return {
    id: "chunk-1",
    file_id: "file-1",
    name: "bigFunction",
    signature: "function bigFunction()",
    description: "",
    body,
    updated_at: "2026-01-01T00:00:00Z",
    checksum: "fixed-checksum"
  };
}

test("file embedding text is uncapped beyond the old 7000-char limit", () => {
  const base = "x".repeat(8000);
  const variant = `${"x".repeat(7500)}CHANGED${"x".repeat(493)}`;

  const [a] = parseFileEntities([fileRecord(base)]);
  const [b] = parseFileEntities([fileRecord(variant)]);

  assert.ok(a.text.length > 7000);
  assert.ok(a.text.includes(base));
  assert.notEqual(a.signature, b.signature);
});

test("chunk embedding text includes the full body beyond the old 2000-char preview", () => {
  const filePathById = new Map([["file-1", "src/big.ts"]]);
  const base = "y".repeat(3000);
  const variant = `${"y".repeat(2500)}CHANGED${"y".repeat(493)}`;

  const [a] = parseChunkEntities([chunkRecord(base)], filePathById);
  const [b] = parseChunkEntities([chunkRecord(variant)], filePathById);

  assert.ok(a.text.includes(base));
  assert.notEqual(a.signature, b.signature);
});

test("default embedding model is jina code model and env override still works", () => {
  const saved = process.env.CORTEX_EMBED_MODEL;
  try {
    delete process.env.CORTEX_EMBED_MODEL;
    assert.equal(DEFAULT_MODEL_ID, "jinaai/jina-embeddings-v2-base-code");
    assert.equal(resolveModelId(), DEFAULT_MODEL_ID);

    process.env.CORTEX_EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";
    assert.equal(resolveModelId(), "Xenova/all-MiniLM-L6-v2");

    process.env.CORTEX_EMBED_MODEL = "   ";
    assert.equal(resolveModelId(), DEFAULT_MODEL_ID);
  } finally {
    if (saved === undefined) {
      delete process.env.CORTEX_EMBED_MODEL;
    } else {
      process.env.CORTEX_EMBED_MODEL = saved;
    }
  }
});
