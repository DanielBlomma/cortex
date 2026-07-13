import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPACT_FILE_TEXT_STRATEGY,
  COMPACT_FILE_TEXT_TARGET_CHARS,
  COMPACT_FILE_TEXT_THRESHOLD_CHARS,
  DEFAULT_MODEL_ID,
  parseChunkEntities,
  parseFileEntities,
  resolveEmbedTextProfile,
  resolveModelId,
  resolveSignatureProfile
} from "../dist/embed.js";

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

test("compact-files leaves small file text unchanged", () => {
  const content = "export function smallApi() { return true; }";

  const [full] = parseFileEntities([fileRecord(content)]);
  const [compact] = parseFileEntities([fileRecord(content)], { textProfile: "compact-files" });

  assert.equal(compact.text, full.text);
  assert.equal(compact.signature, full.signature);
  assert.equal(compact.text_profile, "compact-files");
  assert.equal(compact.text_compacted, false);
  assert.equal(compact.text_omitted_chars, 0);
});

test("compact-files compacts only large file entities and preserves semantic anchors", () => {
  const head = `HEAD_MARKER\n${"h".repeat(15000)}`;
  const signalLines = [
    "import { Owner } from './owner';",
    "export interface UserRecord { owner: Owner; }",
    "export function createUserRecord(owner: Owner) { return { owner }; }"
  ].join("\n");
  const tail = `${"t".repeat(3000)}\nTAIL_MARKER`;
  const content = `${head}\n${"m".repeat(COMPACT_FILE_TEXT_THRESHOLD_CHARS)}\n${signalLines}\n${tail}`;

  const [full] = parseFileEntities([fileRecord(content)]);
  const [compact] = parseFileEntities([fileRecord(content)], { textProfile: "compact-files" });

  assert.equal(compact.text_profile, "compact-files");
  assert.equal(compact.text_compacted, true);
  assert.ok(full.text.length > COMPACT_FILE_TEXT_THRESHOLD_CHARS);
  assert.ok(compact.text.length < full.text.length);
  assert.ok(compact.text.length <= COMPACT_FILE_TEXT_TARGET_CHARS + 5120);
  assert.notEqual(compact.signature, full.signature);
  assert.match(compact.text, new RegExp(COMPACT_FILE_TEXT_STRATEGY));
  assert.match(compact.text, /omitted_chars=/);
  assert.ok(compact.text.includes("src/big.ts"));
  assert.ok(compact.text.includes("excerpt"));
  assert.ok(compact.text.includes("HEAD_MARKER"));
  assert.ok(compact.text.includes("TAIL_MARKER"));
  assert.ok(compact.text.includes("import { Owner } from './owner';"));
  assert.ok(compact.text.includes("export interface UserRecord"));
  assert.ok(compact.text.includes("export function createUserRecord"));
});

test("compact-files keeps collecting signal anchors after an oversized signal line", () => {
  const hugeSignal = `export const generatedRoutes = "${"x".repeat(COMPACT_FILE_TEXT_THRESHOLD_CHARS)}";`;
  const laterSignal = "export function conciseAnchor() { return true; }";
  const content = [
    `HEAD_MARKER\n${"h".repeat(15000)}`,
    hugeSignal,
    laterSignal,
    `${"m".repeat(COMPACT_FILE_TEXT_THRESHOLD_CHARS)}\nTAIL_MARKER`
  ].join("\n");

  const [compact] = parseFileEntities([fileRecord(content)], { textProfile: "compact-files" });

  assert.equal(compact.text_compacted, true);
  assert.ok(compact.text.includes("export const generatedRoutes"));
  assert.match(compact.text, /signal_line_truncated_chars=/);
  assert.ok(!compact.text.includes("x".repeat(1024)));
  assert.ok(compact.text.includes(laterSignal));
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

test("chunk embedding text keeps full body while file compact profile is enabled", () => {
  const filePathById = new Map([["file-1", "src/big.ts"]]);
  const body = `${"z".repeat(COMPACT_FILE_TEXT_THRESHOLD_CHARS)}CHUNK_TAIL`;

  const [chunk] = parseChunkEntities([chunkRecord(body)], filePathById);

  assert.ok(chunk.text.includes(body));
  assert.ok(chunk.text.includes("CHUNK_TAIL"));
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

test("embedding text profile resolver accepts only known profiles", () => {
  assert.equal(resolveEmbedTextProfile(undefined), "full");
  assert.equal(resolveEmbedTextProfile(""), "full");
  assert.equal(resolveEmbedTextProfile(" full "), "full");
  assert.equal(resolveEmbedTextProfile(" compact-files "), "compact-files");
  assert.throws(() => resolveEmbedTextProfile("compact"), /Unsupported CORTEX_EMBED_TEXT_PROFILE/);
});

test("signature profile preserves default cache and separates compact-files", () => {
  assert.equal(resolveSignatureProfile(null, "full"), "");
  assert.equal(resolveSignatureProfile(2048, "full"), "embed|max_tokens=2048");

  const compact = resolveSignatureProfile(null, "compact-files");
  assert.match(compact, /^embed\|/);
  assert.match(compact, /text_profile=compact-files/);
  assert.match(compact, new RegExp(COMPACT_FILE_TEXT_STRATEGY));
  assert.match(compact, new RegExp(`threshold_chars=${COMPACT_FILE_TEXT_THRESHOLD_CHARS}`));

  const cappedCompact = resolveSignatureProfile(2048, "compact-files");
  assert.match(cappedCompact, /max_tokens=2048/);
  assert.notEqual(cappedCompact, resolveSignatureProfile(2048, "full"));
  assert.equal(resolveSignatureProfile(null, "compact-files", "Chunk"), "");
  assert.equal(resolveSignatureProfile(2048, "compact-files", "Chunk"), "embed|max_tokens=2048");
  assert.equal(resolveSignatureProfile(2048, "compact-files", "File"), cappedCompact);
});
