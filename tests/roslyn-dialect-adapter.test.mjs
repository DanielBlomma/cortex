import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as csharp from "../scaffold/scripts/parsers/csharp.mjs";
import * as vbnet from "../scaffold/scripts/parsers/vbnet.mjs";
import {
  DIALECT_ADAPTER_SHAPE_INVENTORY_SHA256,
  DIALECT_CAPABILITY_MANIFEST_SHA256,
  DIALECT_LIMITS,
  DIALECT_LIMITS_SHA256,
  canonicalJson
} from "../scaffold/scripts/lib/dialect-observation-contract.mjs";

const CSHARP_SOURCE = [
  "public record Result(int Value);",
  "public class Sample {",
  "  [global::Xunit.Fact] public int Works(string text) {",
  "    var glyph = \"😀\";",
  "    try {",
  "      if (text.Length == 0) return 0;",
  "      var marker = \"😀\"; global::Xunit.Assert.True(text.Length > 0);",
  "    } catch { throw; }",
  "    return new[] { 1, 2 }.Length;",
  "  }",
  "}"
].join("\r\n");

const VBNET_SOURCE = [
  "Public Structure Result",
  "  Public Value As Integer",
  "End Structure",
  "Public Class Sample",
  "  <Global.Xunit.Fact> Public Function Works(text As String) As Integer",
  "    Dim glyph = \"😀\"",
  "    Try",
  "      If text.Length = 0 Then Return 0",
  "      Dim marker = \"😀\" : Global.Xunit.Assert.True(text.Length > 0)",
  "    Catch",
  "      Throw",
  "    End Try",
  "    Return New Integer() {1, 2}.Length",
  "  End Function",
  "End Class"
].join("\r\n");

const LIVE_FIXTURES = [
  { parser: csharp, source: CSHARP_SOURCE, repositoryPath: "src/Sample.cs", language: "csharp" },
  { parser: vbnet, source: VBNET_SOURCE, repositoryPath: "src/Sample.vb", language: "vbnet" }
];

test("Roslyn adapters preserve legacy results and emit every applicable category", () => {
  for (const fixture of LIVE_FIXTURES) {
    assert.equal(fixture.parser.isCSharpParserAvailable?.() ?? fixture.parser.isVbNetParserAvailable(), true);
    const legacy = fixture.parser.parseCode(fixture.source, fixture.repositoryPath, fixture.language);
    const transport = fixture.parser.parseCodeWithDialectObservations(
      fixture.source,
      fixture.repositoryPath,
      fixture.language
    );

    assert.deepEqual(transport.parser_result, legacy, fixture.language);
    assert.deepEqual(
      fixture.parser.parseCode(fixture.source, fixture.repositoryPath, fixture.language),
      legacy,
      `${fixture.language} parser result changed after adapter use`
    );
    assert.deepEqual(Object.keys(transport.parser_result).sort(), ["chunks", "errors"]);
    assert.equal(transport.observation_envelope.status, "ok");
    assert.deepEqual(
      new Set(transport.observation_envelope.observations.map((entry) => entry.category)),
      new Set([
        "declaration_structure", "control_flow", "error_flow",
        "data_representation", "test_shape"
      ]),
      fixture.language
    );
    assert.ok(
      transport.observation_envelope.observations.some((entry) =>
        entry.normalized_shape === canonicalJson({ kind: "test_declaration" }))
    );
    assert.ok(
      transport.observation_envelope.observations.some((entry) =>
        entry.normalized_shape === canonicalJson({ kind: "assertion" }))
    );
  }
});

test("Roslyn observations are deterministic, canonical, and use exact UTF-16 CRLF spans", () => {
  for (const fixture of LIVE_FIXTURES) {
    const first = fixture.parser.parseCodeWithDialectObservations(
      fixture.source,
      fixture.repositoryPath,
      fixture.language
    );
    const second = fixture.parser.parseCodeWithDialectObservations(
      fixture.source,
      fixture.repositoryPath,
      fixture.language
    );
    assert.equal(canonicalJson(first), canonicalJson(second), fixture.language);
    assert.deepEqual(
      first.observation_envelope.observations.map((entry) => entry.observation_id),
      second.observation_envelope.observations.map((entry) => entry.observation_id)
    );

    const assertionTarget = fixture.language === "csharp"
      ? "global::Xunit.Assert.True(text.Length > 0)"
      : "Global.Xunit.Assert.True(text.Length > 0)";
    const assertionLine = fixture.source.split("\r\n").findIndex((line) => line.includes(assertionTarget)) + 1;
    const assertionText = fixture.source.split("\r\n")[assertionLine - 1];
    const assertion = first.observation_envelope.observations.find((entry) =>
      entry.category === "test_shape" &&
      entry.normalized_shape === canonicalJson({ kind: "assertion" })
    );
    assert.ok(assertion, fixture.language);
    assert.equal(assertion.start_line, assertionLine);
    assert.equal(assertion.end_line, assertionLine);
    assert.equal(assertion.start_column, assertionText.indexOf(assertionTarget));
    assert.equal(assertion.end_column, assertionText.indexOf(assertionTarget) + assertionTarget.length - 1);
    assert.ok(
      first.observation_envelope.observations.some((entry) => entry.end_line > entry.start_line),
      `${fixture.language} must retain multiline native spans`
    );
  }
});

test("Roslyn adapters reject bad arguments and emit no zero-width observations", () => {
  assert.throws(
    () => csharp.parseCodeWithDialectObservations("class C {}", "../C.cs", "csharp"),
    /non-canonical repository path/
  );
  assert.throws(
    () => csharp.parseCodeWithDialectObservations("class C {}", "src/C.vb", "csharp"),
    /unsupported parser mode/
  );
  assert.throws(
    () => vbnet.parseCodeWithDialectObservations({}, "src/C.vb", "vbnet"),
    /code must be a string/
  );

  for (const [parser, repositoryPath, language] of [
    [csharp, "src/Empty.cs", "csharp"],
    [vbnet, "src/Empty.vb", "vbnet"]
  ]) {
    const transport = parser.parseCodeWithDialectObservations("", repositoryPath, language);
    assert.equal(transport.observation_envelope.status, "ok");
    assert.deepEqual(transport.observation_envelope.observations, []);
  }
});

test("Roslyn malformed, oversized, unavailable, and file-cap cases fail explicitly", () => {
  const malformed = csharp.parseCodeWithDialectObservations(
    "public class Broken { public void Bad( { }",
    "src/Broken.cs",
    "csharp"
  );
  assert.equal(malformed.observation_envelope.status, "malformed");
  assert.equal(malformed.observation_envelope.observations.length, 0);
  assert.ok(malformed.parser_result.errors.length > 0);

  for (const fixture of [
    {
      parser: csharp,
      source: `public class Large { public int Work() { return 1; } } //${"x".repeat(DIALECT_LIMITS.max_source_bytes)}`,
      repositoryPath: "src/Large.cs",
      language: "csharp"
    },
    {
      parser: vbnet,
      source: [
        "Public Class Large",
        "  Public Function Work() As Integer",
        "    Return 1",
        "  End Function",
        "End Class",
        `'${"x".repeat(DIALECT_LIMITS.max_source_bytes)}`
      ].join("\n"),
      repositoryPath: "src/Large.vb",
      language: "vbnet"
    }
  ]) {
    const legacy = fixture.parser.parseCode(fixture.source, fixture.repositoryPath, fixture.language);
    const oversized = fixture.parser.parseCodeWithDialectObservations(
      fixture.source,
      fixture.repositoryPath,
      fixture.language
    );
    assert.deepEqual(oversized.parser_result, legacy, fixture.language);
    assert.ok(oversized.parser_result.chunks.length > 0, fixture.language);
    assert.equal(oversized.observation_envelope.status, "oversized");
  }

  for (const fixture of [
    { parser: csharp, family: "csharp", repositoryPath: "src/FakeLarge.cs", language: "csharp" },
    { parser: vbnet, family: "vbnet", repositoryPath: "src/FakeLarge.vb", language: "vbnet" }
  ]) {
    withFakeDotnet(
      fixture.parser,
      fixture.family,
      JSON.stringify({ chunks: [], errors: [] }),
      (logPath) => {
        const transport = fixture.parser.parseCodeWithDialectObservations(
          "x".repeat(DIALECT_LIMITS.max_source_bytes + 1),
          fixture.repositoryPath,
          fixture.language
        );
        assert.equal(transport.observation_envelope.status, "oversized");
        const parserInvocation = fs.readFileSync(logPath, "utf8").trim().split("\n")
          .find((line) => !line.startsWith("--version"));
        assert.ok(parserInvocation);
        assert.doesNotMatch(parserInvocation, /(?:^|\s)--dialect(?:\s|$)/);
      }
    );
  }

  const methods = Array.from({ length: 260 }, (_, index) =>
    `public int M${index}(int value) { return value; }`
  ).join("\n");
  const capped = csharp.parseCodeWithDialectObservations(
    `public class Many { ${methods} }`,
    "src/Many.cs",
    "csharp"
  );
  assert.equal(capped.observation_envelope.status, "truncated");
  assert.equal(capped.observation_envelope.observations.length, 0);
  assert.ok(capped.observation_envelope.diagnostics.observed_count > DIALECT_LIMITS.max_observations_per_file);
  assert.equal(
    capped.observation_envelope.diagnostics.omitted_count,
    capped.observation_envelope.diagnostics.observed_count
  );

  withMissingDotnet(csharp, "csharp", () => {
    const unavailable = csharp.parseCodeWithDialectObservations(
      "public class C {}",
      "src/C.cs",
      "csharp"
    );
    assert.deepEqual(unavailable.parser_result, { chunks: [], errors: [] });
    assert.equal(unavailable.observation_envelope.status, "unavailable");
    assert.equal(unavailable.observation_envelope.observations.length, 0);
  });
});

test("Roslyn composite calls use one parser subprocess and fail closed on invalid or unexpected JSON", () => {
  for (const fixture of [
    { parser: csharp, family: "csharp", repositoryPath: "src/Fake.cs", language: "csharp" },
    { parser: vbnet, family: "vbnet", repositoryPath: "src/Fake.vb", language: "vbnet" }
  ]) {
    const validPayload = JSON.stringify({
      chunks: [],
      errors: [],
      dialect: { candidates: [], observedCount: 0 }
    });
    withFakeDotnet(fixture.parser, fixture.family, validPayload, (logPath) => {
      const transport = fixture.parser.parseCodeWithDialectObservations(
        " ",
        fixture.repositoryPath,
        fixture.language
      );
      assert.equal(transport.observation_envelope.status, "ok");
      const invocations = fs.readFileSync(logPath, "utf8").trim().split("\n");
      assert.equal(invocations.filter((line) => !line.startsWith("--version")).length, 1);
    });

    withFakeDotnet(fixture.parser, fixture.family, "not-json", () => {
      const transport = fixture.parser.parseCodeWithDialectObservations(
        " ",
        fixture.repositoryPath,
        fixture.language
      );
      assert.equal(transport.observation_envelope.status, "unavailable");
      assert.equal(transport.observation_envelope.observations.length, 0);
      assert.ok(transport.parser_result.errors.length > 0);
    });

    withFakeDotnet(
      fixture.parser,
      fixture.family,
      JSON.stringify({ chunks: [], errors: [], dialect: { candidates: [], observedCount: 0 }, rawTree: {} }),
      () => {
        const transport = fixture.parser.parseCodeWithDialectObservations(
          " ",
          fixture.repositoryPath,
          fixture.language
        );
        assert.equal(transport.observation_envelope.status, "unavailable");
        assert.equal(transport.observation_envelope.observations.length, 0);
      }
    );
  }
});

test("Roslyn adapters reject ambiguous test names and keep local-function call ordinals local", () => {
  const ambiguous = [
    "public class FactAttribute : System.Attribute {}",
    "public static class Assert { public static void True(bool value) {} }",
    "public class Sample {",
    "  [Fact] public void Works() { Assert.True(true); }",
    "}"
  ].join("\n");
  const ambiguousTransport = csharp.parseCodeWithDialectObservations(ambiguous, "src/Ambiguous.cs", "csharp");
  assert.equal(
    ambiguousTransport.observation_envelope.observations.some((entry) => entry.category === "test_shape"),
    false
  );

  const nested = [
    "public class Sample {",
    "  public void Outer() {",
    "    One();",
    "    void Inner() { Two(); Three(); }",
    "    Inner();",
    "  }",
    "  private void One() {}",
    "  private void Two() {}",
    "  private void Three() {}",
    "}"
  ].join("\n");
  const nestedTransport = csharp.parseCodeWithDialectObservations(nested, "src/Nested.cs", "csharp");
  const ordered = nestedTransport.observation_envelope.observations.filter((entry) =>
    entry.normalized_shape === canonicalJson({ kind: "ordered_calls" })
  );
  assert.equal(ordered.length, 4);
  assert.deepEqual(ordered.map((entry) => entry.ordinal), [0, 0, 1, 1]);
  assert.equal(new Set(ordered.map((entry) => entry.observation_id)).size, ordered.length);

  for (const fixture of [
    {
      parser: csharp,
      source: [
        "public class LambdaCalls {",
        "  public void Outer() {",
        "    One();",
        "    System.Action inner = () => Two();",
        "    Three();",
        "  }",
        "  private void One() {} private void Two() {} private void Three() {}",
        "}"
      ].join("\n"),
      repositoryPath: "src/LambdaCalls.cs",
      language: "csharp"
    },
    {
      parser: vbnet,
      source: [
        "Public Class LambdaCalls",
        "  Public Sub Outer()",
        "    One()",
        "    Dim inner As System.Action = Sub() Two()",
        "    Three()",
        "  End Sub",
        "  Private Sub One()",
        "  End Sub",
        "  Private Sub Two()",
        "  End Sub",
        "  Private Sub Three()",
        "  End Sub",
        "End Class"
      ].join("\n"),
      repositoryPath: "src/LambdaCalls.vb",
      language: "vbnet"
    }
  ]) {
    const transport = fixture.parser.parseCodeWithDialectObservations(
      fixture.source,
      fixture.repositoryPath,
      fixture.language
    );
    const lambdaOrdered = transport.observation_envelope.observations.filter((entry) =>
      entry.normalized_shape === canonicalJson({ kind: "ordered_calls" })
    );
    assert.deepEqual(lambdaOrdered.map((entry) => entry.ordinal), [0, 0, 1], fixture.language);
  }
});

test("Roslyn composite failure diagnostics stay bounded and batch mode omits dialect payloads", () => {
  for (const fixture of [
    { parser: csharp, family: "csharp", repositoryPath: "src/Fake.cs", language: "csharp" },
    { parser: vbnet, family: "vbnet", repositoryPath: "src/Fake.vb", language: "vbnet" }
  ]) {
    withFakeDotnetFailure(fixture.parser, fixture.family, () => {
      const transport = fixture.parser.parseCodeWithDialectObservations(
        " ",
        fixture.repositoryPath,
        fixture.language
      );
      assert.equal(transport.observation_envelope.status, "unavailable");
      assert.equal(transport.parser_result.errors.length, 1);
      assert.ok(
        [...transport.parser_result.errors[0].message].length <= DIALECT_LIMITS.max_diagnostic_chars
      );
    });

    withFakeDotnetHugeSuccessfulError(fixture.parser, fixture.family, () => {
      const transport = fixture.parser.parseCodeWithDialectObservations(
        " ",
        fixture.repositoryPath,
        fixture.language
      );
      assert.equal(transport.observation_envelope.status, "malformed");
      assert.equal(transport.parser_result.errors.length, 1);
      assert.equal(
        [...transport.parser_result.errors[0].message].length,
        DIALECT_LIMITS.max_diagnostic_chars
      );
    });

    const invalidChunkPayload = JSON.stringify({
      chunks: [{ name: "malicious", rawTree: {} }],
      errors: [],
      dialect: { candidates: [], observedCount: 0 }
    });
    withFakeDotnet(fixture.parser, fixture.family, invalidChunkPayload, () => {
      const transport = fixture.parser.parseCodeWithDialectObservations(
        " ",
        fixture.repositoryPath,
        fixture.language
      );
      assert.equal(transport.observation_envelope.status, "unavailable");
      assert.deepEqual(transport.parser_result.chunks, []);
    });
  }

  const published = csharp.ensureCSharpParserPublished();
  assert.equal(published.ok, true);
  const runtime = csharp.getCSharpParserRuntime();
  const batch = childProcess.spawnSync(runtime.command, [published.dllPath, "--batch"], {
    input: JSON.stringify({ files: [{ path: "src/A.cs", source: "public class A {}" }] }),
    encoding: "utf8",
    timeout: 30000
  });
  assert.equal(batch.status, 0, batch.stderr);
  const batchOutput = JSON.parse(batch.stdout);
  assert.deepEqual(Object.keys(batchOutput.files["src/A.cs"]).sort(), ["chunks", "errors"]);

  for (const fixture of [
    {
      parser: csharp,
      runtime: csharp.getCSharpParserRuntime(),
      published: csharp.ensureCSharpParserPublished(),
      repositoryPath: "src/Plain.cs",
      language: "csharp",
      source: "public class Plain {}"
    },
    {
      parser: vbnet,
      runtime: vbnet.getVbNetParserRuntime(),
      published: vbnet.ensureVbNetParserPublished(),
      repositoryPath: "src/Plain.vb",
      language: "vbnet",
      source: "Public Class Plain\nEnd Class"
    }
  ]) {
    assert.equal(fixture.published.ok, true);
    const plain = childProcess.spawnSync(
      fixture.runtime.command,
      [
        fixture.published.dllPath,
        "--stdin",
        "--file", fixture.repositoryPath,
        "--language", fixture.language
      ],
      { input: fixture.source, encoding: "utf8", timeout: 30000 }
    );
    assert.equal(plain.status, 0, plain.stderr);
    assert.deepEqual(Object.keys(JSON.parse(plain.stdout)).sort(), ["chunks", "errors"]);
  }
});

test("Roslyn adapters retain frozen contract, ownership, and bounded plain observation shape", () => {
  assert.equal(
    DIALECT_CAPABILITY_MANIFEST_SHA256,
    "94f1c645ce4bb7963a30b2da65bce3e5130e38b05f93046623e1759d000f871c"
  );
  assert.equal(
    DIALECT_LIMITS_SHA256,
    "aabe57c65a97253e4ae617b00c653ef5f14e2259a5006b354807468e47a1a602"
  );
  assert.equal(
    DIALECT_ADAPTER_SHAPE_INVENTORY_SHA256,
    "f09fdb942324539c94a5ef64ed4ee743a28ab26fad773d60afddcc7414323250"
  );
  assert.equal(
    crypto.createHash("sha256").update(fs.readFileSync(new URL("../scaffold/ownership/v1.json", import.meta.url))).digest("hex"),
    "b3b97387f541e718ac3b27f677e00cf815cb9bd600b1305391891685f03423ff"
  );

  const allowedKeys = [
    "category", "containing_chunk_id", "end_column", "end_line", "family",
    "language_specific_shape", "normalized_shape", "observation_id", "ordinal",
    "parser_backend", "repository_path", "schema_version", "start_column",
    "start_line", "syntax_mode"
  ].sort();
  for (const fixture of LIVE_FIXTURES) {
    const observations = fixture.parser.parseCodeWithDialectObservations(
      fixture.source,
      fixture.repositoryPath,
      fixture.language
    ).observation_envelope.observations;
    for (const observation of observations) {
      assert.deepEqual(Object.keys(observation).sort(), allowedKeys);
      assert.equal(Object.getPrototypeOf(observation), Object.prototype);
    }
  }
});

function withMissingDotnet(parser, family, callback) {
  const previous = process.env.CORTEX_DOTNET_CMD;
  process.env.CORTEX_DOTNET_CMD = "definitely-not-a-real-dotnet-command";
  resetParser(parser, family);
  try {
    callback();
  } finally {
    restoreEnvironment("CORTEX_DOTNET_CMD", previous);
    resetParser(parser, family);
  }
}

function withFakeDotnet(parser, family, stdout, callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `cortex-${family}-dialect-`));
  const commandPath = path.join(tempRoot, "fake-dotnet");
  const projectPath = path.join(tempRoot, "Parser.csproj");
  const publishDir = path.join(tempRoot, "publish");
  const dllName = family === "csharp" ? "CSharpParser.dll" : "VbNetParser.dll";
  const logPath = path.join(tempRoot, "calls.log");
  fs.mkdirSync(publishDir);
  fs.writeFileSync(projectPath, "<Project />\n");
  fs.writeFileSync(path.join(publishDir, dllName), "fixture");
  fs.writeFileSync(commandPath, [
    "#!/bin/sh",
    `printf '%s\\n' \"$*\" >> ${shellQuote(logPath)}`,
    "if [ \"$1\" = \"--version\" ]; then printf '8.0.422\\n'; exit 0; fi",
    `printf '%s' ${shellQuote(stdout)}`
  ].join("\n"));
  fs.chmodSync(commandPath, 0o755);

  const prefix = family === "csharp" ? "CSHARP" : "VBNET";
  const previous = new Map([
    ["CORTEX_DOTNET_CMD", process.env.CORTEX_DOTNET_CMD],
    [`CORTEX_${prefix}_PARSER_PROJECT`, process.env[`CORTEX_${prefix}_PARSER_PROJECT`]],
    [`CORTEX_${prefix}_PUBLISH_DIR`, process.env[`CORTEX_${prefix}_PUBLISH_DIR`]]
  ]);
  process.env.CORTEX_DOTNET_CMD = commandPath;
  process.env[`CORTEX_${prefix}_PARSER_PROJECT`] = projectPath;
  process.env[`CORTEX_${prefix}_PUBLISH_DIR`] = publishDir;
  resetParser(parser, family);
  try {
    callback(logPath);
  } finally {
    for (const [name, value] of previous) restoreEnvironment(name, value);
    resetParser(parser, family);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function withFakeDotnetFailure(parser, family, callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `cortex-${family}-dialect-failure-`));
  const commandPath = path.join(tempRoot, "fake-dotnet");
  const projectPath = path.join(tempRoot, "Parser.csproj");
  const publishDir = path.join(tempRoot, "publish");
  const dllName = family === "csharp" ? "CSharpParser.dll" : "VbNetParser.dll";
  fs.mkdirSync(publishDir);
  fs.writeFileSync(projectPath, "<Project />\n");
  fs.writeFileSync(path.join(publishDir, dllName), "fixture");
  fs.writeFileSync(commandPath, [
    "#!/bin/sh",
    "if [ \"$1\" = \"--version\" ]; then printf '8.0.422\\n'; exit 0; fi",
    "dd if=/dev/zero bs=1024 count=4500 2>/dev/null | tr '\\000' x >&2",
    "exit 1"
  ].join("\n"));
  fs.chmodSync(commandPath, 0o755);

  const prefix = family === "csharp" ? "CSHARP" : "VBNET";
  const previous = new Map([
    ["CORTEX_DOTNET_CMD", process.env.CORTEX_DOTNET_CMD],
    [`CORTEX_${prefix}_PARSER_PROJECT`, process.env[`CORTEX_${prefix}_PARSER_PROJECT`]],
    [`CORTEX_${prefix}_PUBLISH_DIR`, process.env[`CORTEX_${prefix}_PUBLISH_DIR`]]
  ]);
  process.env.CORTEX_DOTNET_CMD = commandPath;
  process.env[`CORTEX_${prefix}_PARSER_PROJECT`] = projectPath;
  process.env[`CORTEX_${prefix}_PUBLISH_DIR`] = publishDir;
  resetParser(parser, family);
  try {
    callback();
  } finally {
    for (const [name, value] of previous) restoreEnvironment(name, value);
    resetParser(parser, family);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function withFakeDotnetHugeSuccessfulError(parser, family, callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `cortex-${family}-dialect-huge-error-`));
  const commandPath = path.join(tempRoot, "fake-dotnet");
  const projectPath = path.join(tempRoot, "Parser.csproj");
  const publishDir = path.join(tempRoot, "publish");
  const dllName = family === "csharp" ? "CSharpParser.dll" : "VbNetParser.dll";
  fs.mkdirSync(publishDir);
  fs.writeFileSync(projectPath, "<Project />\n");
  fs.writeFileSync(path.join(publishDir, dllName), "fixture");
  fs.writeFileSync(commandPath, [
    "#!/bin/sh",
    "if [ \"$1\" = \"--version\" ]; then printf '8.0.422\\n'; exit 0; fi",
    "printf '{\"chunks\":[],\"errors\":[{\"message\":\"'",
    "dd if=/dev/zero bs=1024 count=4500 2>/dev/null | tr '\\000' x",
    "printf '\"}],\"dialect\":{\"candidates\":[],\"observedCount\":0}}'"
  ].join("\n"));
  fs.chmodSync(commandPath, 0o755);

  const prefix = family === "csharp" ? "CSHARP" : "VBNET";
  const previous = new Map([
    ["CORTEX_DOTNET_CMD", process.env.CORTEX_DOTNET_CMD],
    [`CORTEX_${prefix}_PARSER_PROJECT`, process.env[`CORTEX_${prefix}_PARSER_PROJECT`]],
    [`CORTEX_${prefix}_PUBLISH_DIR`, process.env[`CORTEX_${prefix}_PUBLISH_DIR`]]
  ]);
  process.env.CORTEX_DOTNET_CMD = commandPath;
  process.env[`CORTEX_${prefix}_PARSER_PROJECT`] = projectPath;
  process.env[`CORTEX_${prefix}_PUBLISH_DIR`] = publishDir;
  resetParser(parser, family);
  try {
    callback();
  } finally {
    for (const [name, value] of previous) restoreEnvironment(name, value);
    resetParser(parser, family);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function resetParser(parser, family) {
  if (family === "csharp") parser.resetCSharpParserRuntimeCache();
  else parser.resetVbNetParserRuntimeCache();
}

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}
