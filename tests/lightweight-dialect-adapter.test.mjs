import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import * as vb6 from "../scaffold/scripts/parsers/vb6.mjs";
import * as sql from "../scaffold/scripts/parsers/sql.mjs";
import {
  DIALECT_CAPABILITY_MANIFEST,
  DIALECT_CAPABILITY_MANIFEST_SHA256,
  DIALECT_LIMITS,
  DIALECT_LIMITS_SHA256,
  canonicalJson,
  sha256
} from "../scaffold/scripts/lib/dialect-observation-contract.mjs";

const VB6_SOURCE = [
  'Attribute VB_Name = "Sample"',
  "Public Type Result",
  "  Value As Long",
  "End Type",
  "Public Sub Run()",
  "  Dim glyph As String",
  '  glyph = "😀": Call Work',
  "  On Error GoTo Failed",
  "  If Len(glyph) > 0 Then",
  "    Call MoreWork",
  "  End If",
  "  Exit Sub",
  "Failed:",
  "  Err.Raise 5",
  "End Sub"
].join("\r\n");

const SQL_SOURCE = [
  "CREATE TABLE dbo.Results (Value INT);",
  "CREATE PROCEDURE dbo.Run AS",
  "BEGIN",
  "  BEGIN TRY",
  "    IF N'😀' <> N'' EXEC dbo.Work;",
  "  END TRY",
  "  BEGIN CATCH",
  "    THROW;",
  "  END CATCH",
  "END"
].join("\r\n");

test("VB6 and SQL preserve legacy results and emit exactly four applicable categories", () => {
  for (const fixture of [
    { parser: vb6, source: VB6_SOURCE, repositoryPath: "src/Sample.bas", language: "vb6" },
    { parser: sql, source: SQL_SOURCE, repositoryPath: "db/sample.sql", language: "sql" }
  ]) {
    const legacy = fixture.parser.parseCode(fixture.source, fixture.repositoryPath, fixture.language);
    const transport = fixture.parser.parseCodeWithDialectObservations(
      fixture.source,
      fixture.repositoryPath,
      fixture.language
    );
    assert.deepEqual(transport.parser_result, legacy, fixture.language);
    assert.deepEqual(Object.keys(transport.parser_result).sort(), ["chunks", "errors"]);
    assert.equal(transport.observation_envelope.status, "ok");
    assert.deepEqual(
      new Set(transport.observation_envelope.observations.map((entry) => entry.category)),
      new Set(["declaration_structure", "control_flow", "error_flow", "data_representation"]),
      fixture.language
    );
    assert.equal(
      transport.observation_envelope.observations.some((entry) => entry.category === "test_shape"),
      false
    );
  }
});

test("every VB6 registered mode uses the same bounded lightweight adapter", () => {
  for (const extension of [".bas", ".cls", ".frm", ".ctl"]) {
    const source = extension === ".bas"
      ? "Public Sub Run()\n  Dim value As Long\nEnd Sub"
      : [
          'Attribute VB_Name = "Owner"',
          "Public Sub Run()",
          "  Dim value As Long",
          "End Sub"
        ].join("\n");
    const transport = vb6.parseCodeWithDialectObservations(source, `src/Owner${extension}`, "vb6");
    assert.equal(transport.observation_envelope.status, "ok", extension);
    assert.ok(transport.observation_envelope.observations.length > 0, extension);
    assert.ok(transport.observation_envelope.observations.every((entry) => entry.syntax_mode === extension));
  }
});

test("lightweight observations are deterministic with exact UTF-16 CRLF inclusive spans", () => {
  const first = vb6.parseCodeWithDialectObservations(VB6_SOURCE, "src/Sample.bas", "vb6");
  const second = vb6.parseCodeWithDialectObservations(VB6_SOURCE, "src/Sample.bas", "vb6");
  assert.equal(canonicalJson(first), canonicalJson(second));

  const callLine = VB6_SOURCE.split("\r\n").findIndex((line) => line.includes("Call Work")) + 1;
  const callText = VB6_SOURCE.split("\r\n")[callLine - 1];
  const call = first.observation_envelope.observations.find((entry) =>
    entry.normalized_shape === canonicalJson({ kind: "ordered_calls" })
  );
  assert.ok(call);
  assert.equal(call.start_line, callLine);
  assert.equal(call.end_line, callLine);
  assert.equal(call.start_column, callText.indexOf("Call Work"));
  assert.equal(call.end_column, callText.indexOf("Call Work") + "Call Work".length - 1);
  assert.ok(
    first.observation_envelope.observations.some((entry) => entry.end_line > entry.start_line),
    "VB6 must retain multiline block spans"
  );
  for (const entry of first.observation_envelope.observations) {
    assertPositiveInclusiveSpan(VB6_SOURCE, entry);
  }

  const sqlFirst = sql.parseCodeWithDialectObservations(SQL_SOURCE, "db/sample.sql", "sql");
  const sqlSecond = sql.parseCodeWithDialectObservations(SQL_SOURCE, "db/sample.sql", "sql");
  assert.equal(canonicalJson(sqlFirst), canonicalJson(sqlSecond));
  const sqlCallLine = SQL_SOURCE.split("\r\n").findIndex((line) => line.includes("EXEC dbo.Work")) + 1;
  const sqlCallText = SQL_SOURCE.split("\r\n")[sqlCallLine - 1];
  const sqlCall = sqlFirst.observation_envelope.observations.find((entry) =>
    entry.normalized_shape === canonicalJson({ kind: "ordered_calls" })
  );
  assert.equal(sqlCall.start_line, sqlCallLine);
  assert.equal(sqlCall.start_column, sqlCallText.indexOf("EXEC dbo.Work"));
  assert.equal(sqlCall.end_column, sqlCallText.indexOf("EXEC dbo.Work") + "EXEC dbo.Work".length - 1);
  assert.ok(
    sqlFirst.observation_envelope.observations.some((entry) => entry.end_line > entry.start_line),
    "SQL must retain multiline object spans"
  );
  for (const entry of sqlFirst.observation_envelope.observations) {
    assertPositiveInclusiveSpan(SQL_SOURCE, entry);
  }
});

test("lightweight containing chunk ids reproduce returned chunks or remain null", () => {
  for (const fixture of [
    vb6.parseCodeWithDialectObservations(VB6_SOURCE, "src/Sample.bas", "vb6"),
    sql.parseCodeWithDialectObservations(SQL_SOURCE, "db/sample.sql", "sql")
  ]) {
    const ids = new Set(fixture.parser_result.chunks.map((chunk) =>
      `chunk:${fixture.observation_envelope.observations[0]?.repository_path}:${chunk.name}:${chunk.startLine}-${chunk.endLine}`
    ));
    for (const observation of fixture.observation_envelope.observations) {
      assert.ok(observation.containing_chunk_id === null || ids.has(observation.containing_chunk_id));
    }
  }
});

test("lightweight malformed, oversized, file/chunk cap, and empty cases fail explicitly", () => {
  const malformedVb6 = vb6.parseCodeWithDialectObservations(
    "Public Sub Broken()\n  Dim value As Long",
    "src/Broken.bas",
    "vb6"
  );
  assert.equal(malformedVb6.observation_envelope.status, "malformed");
  assert.deepEqual(malformedVb6.observation_envelope.observations, []);

  const malformedSql = sql.parseCodeWithDialectObservations(
    "CREATE PROCEDURE dbo.Broken AS\nBEGIN\nSELECT 1;",
    "db/broken.sql",
    "sql"
  );
  assert.equal(malformedSql.observation_envelope.status, "malformed");
  assert.deepEqual(malformedSql.observation_envelope.observations, []);

  for (const fixture of [
    {
      parser: vb6,
      source: [
        "Public Sub Run()",
        "  Dim value As Long",
        `  '${"x".repeat(DIALECT_LIMITS.max_source_bytes)}`,
        "End Sub"
      ].join("\n"),
      repositoryPath: "src/Large.bas",
      language: "vb6"
    },
    {
      parser: sql,
      source: [
        "CREATE PROCEDURE dbo.Large AS",
        "BEGIN",
        `  --${"x".repeat(DIALECT_LIMITS.max_source_bytes)}`,
        "  SELECT 1;",
        "END"
      ].join("\n"),
      repositoryPath: "db/large.sql",
      language: "sql"
    }
  ]) {
    const legacy = fixture.parser.parseCode(fixture.source, fixture.repositoryPath, fixture.language);
    const oversized = fixture.parser.parseCodeWithDialectObservations(
      fixture.source,
      fixture.repositoryPath,
      fixture.language
    );
    assert.equal(oversized.observation_envelope.status, "oversized", fixture.language);
    assert.deepEqual(oversized.parser_result, legacy, fixture.language);
    assert.ok(oversized.parser_result.chunks.length > 0, fixture.language);
  }

  for (const fixture of [
    {
      parser: vb6,
      source: `Public Sub Run()\n  '${"x".repeat(4_300_000)}\nEnd Sub`,
      repositoryPath: "src/TransportLarge.bas",
      language: "vb6"
    },
    {
      parser: sql,
      source: `CREATE PROCEDURE dbo.TransportLarge AS\nBEGIN\n--${"x".repeat(4_300_000)}\nEND`,
      repositoryPath: "db/transport-large.sql",
      language: "sql"
    }
  ]) {
    const oversized = fixture.parser.parseCodeWithDialectObservations(
      fixture.source,
      fixture.repositoryPath,
      fixture.language
    );
    assert.equal(oversized.observation_envelope.status, "oversized", fixture.language);
    assert.deepEqual(oversized.parser_result.chunks, [], fixture.language);
    assert.equal(oversized.parser_result.errors.length, 1, fixture.language);
  }

  const calls = Array.from({ length: DIALECT_LIMITS.max_observations_per_chunk + 1 }, (_, index) =>
    `  Call Work${index}`
  );
  const capped = vb6.parseCodeWithDialectObservations(
    ["Public Sub Run()", ...calls, "End Sub"].join("\n"),
    "src/Capped.bas",
    "vb6"
  );
  assert.equal(capped.observation_envelope.status, "truncated");
  assert.deepEqual(capped.observation_envelope.observations, []);
  assert.equal(
    capped.observation_envelope.diagnostics.observed_count,
    capped.observation_envelope.diagnostics.omitted_count
  );
  assert.ok(capped.observation_envelope.diagnostics.observed_count > DIALECT_LIMITS.max_observations_per_chunk);

  const empty = sql.parseCodeWithDialectObservations("", "db/empty.sql", "sql");
  assert.equal(empty.observation_envelope.status, "ok");
  assert.deepEqual(empty.observation_envelope.observations, []);
});

test("lightweight adapters reject invalid arguments and retain no raw syntax aliases", () => {
  assert.throws(
    () => vb6.parseCodeWithDialectObservations("Public Sub X()\nEnd Sub", "../X.bas", "vb6"),
    /non-canonical repository path/
  );
  assert.throws(
    () => sql.parseCodeWithDialectObservations("SELECT 1", "db/x.txt", "sql"),
    /unsupported parser mode/
  );
  assert.throws(
    () => vb6.parseCodeWithDialectObservations(new Proxy({}, {}), "src/X.bas", "vb6"),
    /code must be a string/
  );

  const allowedKeys = [
    "category", "containing_chunk_id", "end_column", "end_line", "family",
    "language_specific_shape", "normalized_shape", "observation_id", "ordinal",
    "parser_backend", "repository_path", "schema_version", "start_column",
    "start_line", "syntax_mode"
  ].sort();
  for (const transport of [
    vb6.parseCodeWithDialectObservations(VB6_SOURCE, "src/Sample.bas", "vb6"),
    sql.parseCodeWithDialectObservations(SQL_SOURCE, "db/sample.sql", "sql")
  ]) {
    for (const observation of transport.observation_envelope.observations) {
      assert.deepEqual(Object.keys(observation).sort(), allowedKeys);
      assert.doesNotMatch(JSON.stringify(observation), /rootNode|root_node|rawSource|rawTree|syntaxTree|callback/);
    }
  }
});

test("lightweight dialect scans ignore comments, strings, and unsafe containing chunk ids", () => {
  const vbSource = [
    "Public Sub Run()",
    "  Dim text As String",
    "  text = \"If Call On Error Err.Raise\"",
    "  ' If Call On Error Err.Raise",
    "  Rem If Call On Error Err.Raise",
    "End Sub"
  ].join("\n");
  const vbTransport = vb6.parseCodeWithDialectObservations(vbSource, "src/Masked.bas", "vb6");
  const vbKinds = vbTransport.observation_envelope.observations.map((entry) =>
    JSON.parse(entry.normalized_shape).kind
  );
  assert.equal(vbKinds.includes("branch"), false);
  assert.equal(vbKinds.includes("ordered_calls"), false);
  assert.equal(vbKinds.includes("handler"), false);
  assert.equal(vbKinds.includes("raise"), false);

  const sqlSource = [
    "CREATE PROCEDURE dbo.Masked AS",
    "BEGIN",
    "  SELECT 'BEGIN IF EXEC THROW TRY CATCH END';",
    "  -- BEGIN IF EXEC THROW TRY CATCH END",
    "  /* BEGIN IF EXEC THROW TRY CATCH END */",
    "  /* outer /* nested */ THROW; */",
    "  -- CREATE TABLE dbo.Fake (value INT);",
    "END"
  ].join("\n");
  const sqlTransport = sql.parseCodeWithDialectObservations(sqlSource, "db/masked.sql", "sql");
  assert.equal(sqlTransport.observation_envelope.status, "ok");
  const sqlKinds = sqlTransport.observation_envelope.observations.map((entry) =>
    JSON.parse(entry.normalized_shape).kind
  );
  assert.equal(sqlKinds.includes("branch"), false);
  assert.equal(sqlKinds.includes("ordered_calls"), false);
  assert.equal(sqlKinds.includes("raise"), false);
  assert.equal(sqlKinds.includes("handler"), false);

  const longPath = `${"segment/".repeat(125)}sample.bas`;
  const longPathTransport = vb6.parseCodeWithDialectObservations(
    "Public Sub Run()\n  Dim value As Long\nEnd Sub",
    longPath,
    "vb6"
  );
  assert.equal(longPathTransport.observation_envelope.status, "ok");
  assert.ok(longPathTransport.observation_envelope.observations.length > 0);
  assert.ok(longPathTransport.observation_envelope.observations.every((entry) => entry.containing_chunk_id === null));

  const longName = "x".repeat(990);
  const longNameTransport = sql.parseCodeWithDialectObservations(
    `CREATE TABLE ${longName} (value INT);`,
    "db/long-name.sql",
    "sql"
  );
  assert.equal(longNameTransport.observation_envelope.status, "ok");
  assert.ok(longNameTransport.observation_envelope.observations.length > 0);
  assert.ok(longNameTransport.observation_envelope.observations.every((entry) => entry.containing_chunk_id === null));
});

test("lightweight capability gaps and frozen hashes remain exact", () => {
  for (const familyId of ["vb6", "sql"]) {
    const family = DIALECT_CAPABILITY_MANIFEST.families.find((entry) => entry.family === familyId);
    assert.deepEqual(family.capabilities.test_shape, {
      status: "unsupported",
      reason: "the existing lightweight parser has no framework-independent test-shape syntax contract"
    });
  }
  assert.equal(
    DIALECT_CAPABILITY_MANIFEST_SHA256,
    "94f1c645ce4bb7963a30b2da65bce3e5130e38b05f93046623e1759d000f871c"
  );
  assert.equal(
    DIALECT_LIMITS_SHA256,
    "aabe57c65a97253e4ae617b00c653ef5f14e2259a5006b354807468e47a1a602"
  );
  assert.equal(
    sha256(fs.readFileSync(new URL("../scaffold/ownership/v1.json", import.meta.url))),
    "b3b97387f541e718ac3b27f677e00cf815cb9bd600b1305391891685f03423ff"
  );
});

function assertPositiveInclusiveSpan(source, observation) {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  const startOffset = starts[observation.start_line - 1] + observation.start_column;
  const endOffset = starts[observation.end_line - 1] + observation.end_column;
  assert.ok(endOffset >= startOffset, JSON.stringify(observation));
  assert.ok(source.slice(startOffset, endOffset + 1).length > 0, JSON.stringify(observation));
}
