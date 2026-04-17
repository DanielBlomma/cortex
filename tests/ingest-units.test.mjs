/**
 * Unit tests for ingest helper functions: generateChunkDescription,
 * generateModuleSummary, and generateModules.
 *
 * Run with: node --test tests/ingest-units.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildChunkAliasIndexes,
  buildSqlResourceReferenceMap,
  detectKind,
  extractSqlObjectReferencesFromContent,
  generateChunkDescription,
  generateConfigIncludeRelations,
  generateConfigTransformKeyRelations,
  generateMachineConfigRelations,
  generateConfigTransformRelations,
  generateModuleSummary,
  generateModules,
  generateNamedResourceRelations,
  generateProjects,
  generateSectionHandlerRelations,
  getChunkParserForExtension,
  resolveRelativeImportTargetId
} from "../scaffold/scripts/ingest.mjs";

// ─── detectKind / parser dispatch ────────────────────────────────────────────

test("detectKind: treats Visual Basic source files as CODE", () => {
  assert.equal(detectKind("src/Main.vb"), "CODE");
  assert.equal(detectKind("src/Generated/Form1.Designer.vb"), "CODE");
});

test("detectKind: treats legacy .NET project and config files as DOC metadata for now", () => {
  assert.equal(detectKind("legacy/App.sln"), "DOC");
  assert.equal(detectKind("legacy/App.vbproj"), "DOC");
  assert.equal(detectKind("legacy/App.config"), "DOC");
  assert.equal(detectKind("legacy/Resources.resx"), "DOC");
  assert.equal(detectKind("legacy/Settings.settings"), "DOC");
  assert.equal(detectKind("native/Engine.vcxproj"), "DOC");
});

test("getChunkParserForExtension: only dispatches current chunk-capable languages", () => {
  assert.equal(getChunkParserForExtension(".ts")?.language, "typescript");
  assert.equal(getChunkParserForExtension(".js")?.language, "javascript");
  assert.equal(getChunkParserForExtension(".vb")?.language, "vbnet");
  assert.equal(getChunkParserForExtension(".sql")?.language, "sql");
  assert.equal(getChunkParserForExtension(".config")?.language, "config");
  assert.equal(getChunkParserForExtension(".resx")?.language, "resource");
  assert.equal(getChunkParserForExtension(".settings")?.language, "settings");
  assert.equal(getChunkParserForExtension(".cpp")?.language, "cpp");
  assert.equal(getChunkParserForExtension(".c")?.language, "c");
});

test("extractSqlObjectReferencesFromContent: finds stored procedure command usage", () => {
  const source = [
    'cmd = New SqlCommand("dbo.GetUsers", conn)',
    "cmd.CommandType = CommandType.StoredProcedure"
  ].join("\n");

  assert.deepEqual(extractSqlObjectReferencesFromContent(source), ["dbo.getusers"]);
});

test("extractSqlObjectReferencesFromContent: finds SQL text references in command strings", () => {
  const source = [
    'cmd.CommandText = "SELECT * FROM dbo.ActiveUsers JOIN dbo.Users u ON u.Id = ActiveUsers.Id"',
    "cmd.CommandType = CommandType.Text"
  ].join("\n");

  const refs = extractSqlObjectReferencesFromContent(source);
  assert.ok(refs.includes("dbo.activeusers"));
  assert.ok(refs.includes("dbo.users"));
});

test("buildSqlResourceReferenceMap: extracts SQL references from resx and settings files", () => {
  const fileRecords = [
    {
      path: "legacy/Queries.resx",
      content: [
        "<root>",
        '  <data name="ActiveUsersQuery" xml:space="preserve">',
        "    <value>SELECT * FROM dbo.ActiveUsers</value>",
        "  </data>",
        '  <data name="GetUsersProc" xml:space="preserve">',
        "    <value>dbo.GetUsers</value>",
        "  </data>",
        "</root>"
      ].join("\n")
    },
    {
      path: "legacy/App.settings",
      content: [
        "<SettingsFile>",
        '  <Settings>',
        '    <Setting Name="RunReportProc" Type="System.String" Scope="Application">',
        "      <Value Profile=\"(Default)\">reporting.RunReport</Value>",
        "    </Setting>",
        "  </Settings>",
        "</SettingsFile>"
      ].join("\n")
    }
  ];

  const map = buildSqlResourceReferenceMap(fileRecords);
  assert.deepEqual(map.get("activeusersquery"), ["dbo.activeusers"]);
  assert.deepEqual(map.get("getusersproc"), ["dbo.getusers"]);
  assert.deepEqual(map.get("runreportproc"), ["reporting.runreport"]);
});

test("extractSqlObjectReferencesFromContent: resolves My.Resources and Settings-backed SQL indirection", () => {
  const resourceMap = new Map([
    ["activeusersquery", ["dbo.activeusers"]],
    ["getusersproc", ["dbo.getusers"]]
  ]);
  const source = [
    "cmd.CommandText = My.Resources.ActiveUsersQuery",
    "cmd2.CommandText = Settings.Default.GetUsersProc"
  ].join("\n");

  const refs = extractSqlObjectReferencesFromContent(source, "src/Form1.Designer.vb", resourceMap);
  assert.ok(refs.includes("dbo.activeusers"));
  assert.ok(refs.includes("dbo.getusers"));
});

test("extractSqlObjectReferencesFromContent: extracts SQL references directly from resx values", () => {
  const source = [
    "<root>",
    '  <data name="LookupSql" xml:space="preserve">',
    "    <value>SELECT * FROM dbo.Users</value>",
    "  </data>",
    "</root>"
  ].join("\n");

  const refs = extractSqlObjectReferencesFromContent(source, "legacy/Lookup.resx");
  assert.deepEqual(refs, ["dbo.users"]);
});

test("resolveRelativeImportTargetId: resolves quoted C/C++ local includes without dot prefix", () => {
  const indexed = new Set(["file:src/widget.h", "file:src/include/helpers.hpp"]);

  assert.equal(
    resolveRelativeImportTargetId("src/main.cpp", "widget.h", indexed),
    "file:src/widget.h"
  );
  assert.equal(
    resolveRelativeImportTargetId("src/main.cpp", "include/helpers", indexed),
    "file:src/include/helpers.hpp"
  );
});

test("resolveRelativeImportTargetId: keeps JS package imports unresolved", () => {
  const indexed = new Set(["file:src/react.ts", "file:src/local.ts"]);

  assert.equal(resolveRelativeImportTargetId("src/app.ts", "react", indexed), null);
  assert.equal(resolveRelativeImportTargetId("src/app.ts", "./local", indexed), "file:src/local.ts");
});

test("buildChunkAliasIndexes includes cached structured targets and skips window chunks", () => {
  const indexes = buildChunkAliasIndexes([
    {
      id: "chunk:db/Queries.sql:dbo.GetUsers:1-3",
      name: "dbo.GetUsers",
      language: "sql"
    },
    {
      id: "chunk:App.config:LegacyDb:1-1",
      name: "LegacyDb",
      language: "config"
    },
    {
      id: "chunk:Resources.resx:QueryName:1-1",
      name: "QueryName",
      resourceKey: "QueryName",
      language: "resource"
    },
    {
      id: "chunk:Settings.settings:RunReportProc:1-1",
      name: "RunReportProc",
      resourceKey: "RunReportProc",
      language: "settings"
    },
    {
      id: "chunk:db/Queries.sql:dbo.GetUsers:1-3:window:1:1-2",
      name: "dbo.GetUsers#window1",
      language: "sql"
    }
  ]);

  assert.deepEqual(indexes.sqlChunkIdsByAlias.get("dbo.getusers"), ["chunk:db/Queries.sql:dbo.GetUsers:1-3"]);
  assert.deepEqual(indexes.sqlChunkIdsByAlias.get("getusers"), ["chunk:db/Queries.sql:dbo.GetUsers:1-3"]);
  assert.deepEqual(indexes.configChunkIdsByAlias.get("legacydb"), ["chunk:App.config:LegacyDb:1-1"]);
  assert.deepEqual(indexes.resourceChunkIdsByAlias.get("queryname"), ["chunk:Resources.resx:QueryName:1-1"]);
  assert.deepEqual(indexes.settingChunkIdsByAlias.get("runreportproc"), ["chunk:Settings.settings:RunReportProc:1-1"]);
});

// ─── generateChunkDescription ────────────────────────────────────────────────

test("generateChunkDescription: basic function with signature", () => {
  const chunk = { kind: "function", signature: "foo()", body: "", exported: false, async: false };
  const result = generateChunkDescription(chunk);
  assert.equal(result, "function. foo().");
});

test("generateChunkDescription: exported async function", () => {
  const chunk = { kind: "function", signature: "bar(x)", body: "", exported: true, async: true };
  const result = generateChunkDescription(chunk);
  assert.equal(result, "function. exported. async. bar(x).");
});

test("generateChunkDescription: extracts JSDoc comment", () => {
  const chunk = {
    kind: "function",
    signature: "process(data)",
    body: "/** Processes input data and returns the result */\nfunction process(data) { return data; }",
    exported: false,
    async: false
  };
  const result = generateChunkDescription(chunk);
  assert.ok(result.includes("Processes input data"), `Expected JSDoc content in: ${result}`);
});

test("generateChunkDescription: extracts line comment", () => {
  const chunk = {
    kind: "function",
    signature: "helper()",
    body: "// This is a helpful utility function\nfunction helper() {}",
    exported: false,
    async: false
  };
  const result = generateChunkDescription(chunk);
  assert.ok(result.includes("This is a helpful utility function"), `Expected comment in: ${result}`);
});

test("generateChunkDescription: ignores short comments (<= 10 chars)", () => {
  const chunk = {
    kind: "function",
    signature: "fn()",
    body: "// hi\nfunction fn() {}",
    exported: false,
    async: false
  };
  const result = generateChunkDescription(chunk);
  assert.equal(result, "function. fn().");
});

test("generateChunkDescription: body with no comments", () => {
  const chunk = {
    kind: "class",
    signature: "class Foo",
    body: "class Foo { constructor() {} }",
    exported: false,
    async: false
  };
  const result = generateChunkDescription(chunk);
  assert.equal(result, "class. class Foo.");
});

test("generateChunkDescription: very long signature is preserved", () => {
  const longSig = "a".repeat(500);
  const chunk = { kind: "function", signature: longSig, body: "", exported: false, async: false };
  const result = generateChunkDescription(chunk);
  assert.ok(result.includes(longSig));
});

test("generateChunkDescription: preserves parser-provided description for structured chunks", () => {
  const chunk = {
    kind: "connection_string",
    signature: "connection_string LegacyDb",
    description: "Server=.;Database=Legacy;Trusted_Connection=True;",
    body: "<add name=\"LegacyDb\" connectionString=\"Server=.;Database=Legacy;\" />",
    exported: false,
    async: false
  };
  const result = generateChunkDescription(chunk);
  assert.ok(result.includes("Database=Legacy"), `Expected parser description in: ${result}`);
});

// ─── generateModuleSummary ───────────────────────────────────────────────────

test("generateModuleSummary: auto-generated when no README", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-test-"));
  const files = [
    { path: "src/foo.ts", kind: "CODE" },
    { path: "src/bar.ts", kind: "CODE" }
  ];
  const result = generateModuleSummary("src", files, ["foo", "bar"], tmpDir);
  assert.ok(result.startsWith("Module src"), `Expected auto summary, got: ${result}`);
  assert.ok(result.includes("2 files"));
  assert.ok(result.includes("2 code"));
  assert.ok(result.includes("Key exports: foo, bar"));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("generateModuleSummary: reads README.md when present", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-test-"));
  const srcDir = path.join(tmpDir, "src");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, "README.md"), "# My Module\nThis module handles authentication and session management for the app.\n");

  const files = [{ path: "src/auth.ts", kind: "CODE" }];
  const result = generateModuleSummary("src", files, [], tmpDir);
  assert.ok(result.includes("authentication"), `Expected README content, got: ${result}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("generateModuleSummary: falls back to auto if README too short", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-test-"));
  const srcDir = path.join(tmpDir, "src");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, "README.md"), "# Title\nShort.\n");

  const files = [
    { path: "src/a.ts", kind: "CODE" },
    { path: "src/b.ts", kind: "CODE" }
  ];
  const result = generateModuleSummary("src", files, [], tmpDir);
  assert.ok(result.startsWith("Module src"), `Expected auto fallback, got: ${result}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("generateModuleSummary: mixed file types count correctly", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-test-"));
  const files = [
    { path: "lib/index.ts", kind: "CODE" },
    { path: "lib/README.md", kind: "DOC" },
    { path: "lib/utils.ts", kind: "CODE" }
  ];
  const result = generateModuleSummary("lib", files, [], tmpDir);
  assert.ok(result.includes("3 files"), `Expected 3 files, got: ${result}`);
  assert.ok(result.includes("2 code"), `Expected 2 code, got: ${result}`);
  assert.ok(result.includes("1 docs"), `Expected 1 docs, got: ${result}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("generateModuleSummary: single extension detected", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-test-"));
  const files = [
    { path: "src/a.ts", kind: "CODE" },
    { path: "src/b.ts", kind: "CODE" }
  ];
  const result = generateModuleSummary("src", files, [], tmpDir);
  assert.ok(result.includes("TypeScript"), `Expected TypeScript mention, got: ${result}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("generateModuleSummary: multiple extensions — no extension text", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-test-"));
  const files = [
    { path: "src/a.ts", kind: "CODE" },
    { path: "src/b.js", kind: "CODE" }
  ];
  const result = generateModuleSummary("src", files, [], tmpDir);
  assert.ok(!result.includes("TypeScript"), `Expected no extension text, got: ${result}`);
  assert.ok(!result.includes("JavaScript"), `Expected no extension text, got: ${result}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── generateModules ─────────────────────────────────────────────────────────

test("generateModules: skips directories with fewer than 2 files", () => {
  const files = [{ id: "file:src/only.ts", path: "src/only.ts", kind: "CODE", updated_at: "2026-01-01" }];
  const chunks = [];
  const result = generateModules(files, chunks);
  assert.equal(result.modules.length, 0);
  assert.equal(result.containsRelations.length, 0);
});

test("generateModules: creates module for directory with 2+ files", () => {
  const files = [
    { id: "file:src/a.ts", path: "src/a.ts", kind: "CODE", updated_at: "2026-01-01" },
    { id: "file:src/b.ts", path: "src/b.ts", kind: "CODE", updated_at: "2026-01-02" }
  ];
  const chunks = [];
  const result = generateModules(files, chunks);
  assert.equal(result.modules.length, 1);
  assert.equal(result.modules[0].id, "module:src");
  assert.equal(result.modules[0].name, "src");
  assert.equal(result.modules[0].file_count, 2);
  assert.equal(result.containsRelations.length, 2);
});

test("generateModules: CONTAINS_MODULE only creates direct parent-child links", () => {
  const files = [
    { id: "file:a/f1.ts", path: "a/f1.ts", kind: "CODE", updated_at: "2026-01-01" },
    { id: "file:a/f2.ts", path: "a/f2.ts", kind: "CODE", updated_at: "2026-01-01" },
    { id: "file:a/b/f1.ts", path: "a/b/f1.ts", kind: "CODE", updated_at: "2026-01-01" },
    { id: "file:a/b/f2.ts", path: "a/b/f2.ts", kind: "CODE", updated_at: "2026-01-01" },
    { id: "file:a/b/c/f1.ts", path: "a/b/c/f1.ts", kind: "CODE", updated_at: "2026-01-01" },
    { id: "file:a/b/c/f2.ts", path: "a/b/c/f2.ts", kind: "CODE", updated_at: "2026-01-01" }
  ];
  const chunks = [];
  const result = generateModules(files, chunks);

  assert.equal(result.modules.length, 3);
  assert.equal(result.containsModuleRelations.length, 2);

  const cmRels = result.containsModuleRelations;
  assert.ok(cmRels.some(r => r.from === "module:a" && r.to === "module:a/b"));
  assert.ok(cmRels.some(r => r.from === "module:a/b" && r.to === "module:a/b/c"));
  // No direct link from a to a/b/c
  assert.ok(!cmRels.some(r => r.from === "module:a" && r.to === "module:a/b/c"));
});

test("generateModules: exported chunks create EXPORTS relations", () => {
  const files = [
    { id: "file:lib/a.ts", path: "lib/a.ts", kind: "CODE", updated_at: "2026-01-01" },
    { id: "file:lib/b.ts", path: "lib/b.ts", kind: "CODE", updated_at: "2026-01-01" }
  ];
  const chunks = [
    { id: "chunk:lib/a.ts:foo:1-5", file_id: "file:lib/a.ts", name: "foo", exported: true },
    { id: "chunk:lib/b.ts:bar:1-5", file_id: "file:lib/b.ts", name: "bar", exported: true },
    { id: "chunk:lib/b.ts:internal:6-10", file_id: "file:lib/b.ts", name: "internal", exported: false }
  ];
  const result = generateModules(files, chunks);

  assert.equal(result.exportsRelations.length, 2);
  assert.ok(result.exportsRelations.some(r => r.from === "module:lib" && r.to === "chunk:lib/a.ts:foo:1-5"));
  assert.ok(result.exportsRelations.some(r => r.from === "module:lib" && r.to === "chunk:lib/b.ts:bar:1-5"));
});

test("generateModules: window chunks are excluded from module exports", () => {
  const files = [
    { id: "file:lib/a.ts", path: "lib/a.ts", kind: "CODE", updated_at: "2026-01-01" },
    { id: "file:lib/b.ts", path: "lib/b.ts", kind: "CODE", updated_at: "2026-01-01" }
  ];
  const chunks = [
    { id: "chunk:lib/a.ts:foo:1-120", file_id: "file:lib/a.ts", name: "foo", exported: true },
    {
      id: "chunk:lib/a.ts:foo:1-120:window:1:1-80",
      file_id: "file:lib/a.ts",
      name: "foo#window1",
      exported: true
    }
  ];
  const result = generateModules(files, chunks);

  assert.equal(result.exportsRelations.length, 1);
  assert.deepEqual(result.exportsRelations[0], {
    from: "module:lib",
    to: "chunk:lib/a.ts:foo:1-120"
  });
  assert.equal(result.modules[0].exported_symbols, "foo");
});

test("generateModules: no exported chunks means empty exports", () => {
  const files = [
    { id: "file:lib/a.ts", path: "lib/a.ts", kind: "CODE", updated_at: "2026-01-01" },
    { id: "file:lib/b.ts", path: "lib/b.ts", kind: "CODE", updated_at: "2026-01-01" }
  ];
  const chunks = [
    { id: "chunk:lib/a.ts:fn:1-5", file_id: "file:lib/a.ts", name: "fn", exported: false }
  ];
  const result = generateModules(files, chunks);

  assert.equal(result.modules.length, 1);
  assert.equal(result.exportsRelations.length, 0);
  assert.equal(result.modules[0].exported_symbols, "");
});

test("generateProjects: creates solution and project entities with project references", () => {
  const files = [
    {
      id: "file:legacy/App.sln",
      path: "legacy/App.sln",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: 'Project("{GUID}") = "App", "App/App.vbproj", "{APP-GUID}"\nProject("{GUID}") = "Lib", "Lib/Lib.csproj", "{LIB-GUID}"\n'
    },
    {
      id: "file:legacy/App/App.vbproj",
      path: "legacy/App/App.vbproj",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: [
        "<Project>",
        "  <PropertyGroup><AssemblyName>App</AssemblyName><TargetFrameworkVersion>v4.8</TargetFrameworkVersion></PropertyGroup>",
        '  <ItemGroup><Compile Include="Main.vb" /><EmbeddedResource Include="Resources.resx" /><ProjectReference Include="..\\Lib\\Lib.csproj" /></ItemGroup>',
        "</Project>"
      ].join("\n")
    },
    {
      id: "file:legacy/Lib/Lib.csproj",
      path: "legacy/Lib/Lib.csproj",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: "<Project><PropertyGroup><AssemblyName>Lib</AssemblyName><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>"
    },
    {
      id: "file:legacy/App/Main.vb",
      path: "legacy/App/Main.vb",
      kind: "CODE",
      updated_at: "2026-01-01",
      content: "Module MainModule\nEnd Module"
    },
    {
      id: "file:legacy/App/Resources.resx",
      path: "legacy/App/Resources.resx",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: "<root />"
    }
  ];

  const result = generateProjects(files);

  assert.equal(result.projects.length, 3);
  assert.ok(result.projects.some((project) => project.id === "project:legacy/App.sln" && project.kind === "solution"));
  assert.ok(result.projects.some((project) => project.id === "project:legacy/App/App.vbproj" && project.target_framework === "v4.8"));
  assert.ok(result.projects.some((project) => project.id === "project:legacy/Lib/Lib.csproj" && project.language === "csharp"));

  assert.ok(result.includesFileRelations.some((relation) => relation.from === "project:legacy/App/App.vbproj" && relation.to === "file:legacy/App/Main.vb"));
  assert.ok(result.includesFileRelations.some((relation) => relation.from === "project:legacy/App/App.vbproj" && relation.to === "file:legacy/App/Resources.resx"));

  assert.ok(result.referencesProjectRelations.some((relation) => relation.from === "project:legacy/App.sln" && relation.to === "project:legacy/App/App.vbproj"));
  assert.ok(result.referencesProjectRelations.some((relation) => relation.from === "project:legacy/App.sln" && relation.to === "project:legacy/Lib/Lib.csproj"));
  assert.ok(result.referencesProjectRelations.some((relation) => relation.from === "project:legacy/App/App.vbproj" && relation.to === "project:legacy/Lib/Lib.csproj"));
});

test("generateProjects: includes vcxproj solution members in the project graph", () => {
  const files = [
    {
      id: "file:native/App.sln",
      path: "native/App.sln",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: [
        'Project("{GUID}") = "Engine", "Engine/Engine.vcxproj", "{ENGINE-GUID}"',
        'Project("{GUID}") = "Interop", "Interop/Interop.csproj", "{INTEROP-GUID}"'
      ].join("\n")
    },
    {
      id: "file:native/Engine/Engine.vcxproj",
      path: "native/Engine/Engine.vcxproj",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: [
        "<Project>",
        "  <ItemGroup>",
        '    <ProjectReference Include="..\\Interop\\Interop.csproj" />',
        "  </ItemGroup>",
        "</Project>"
      ].join("\n")
    },
    {
      id: "file:native/Interop/Interop.csproj",
      path: "native/Interop/Interop.csproj",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: "<Project><PropertyGroup><AssemblyName>Interop</AssemblyName></PropertyGroup></Project>"
    }
  ];

  const result = generateProjects(files);

  assert.ok(result.projects.some((project) => project.id === "project:native/Engine/Engine.vcxproj" && project.language === "cpp"));
  assert.ok(
    result.referencesProjectRelations.some(
      (relation) =>
        relation.from === "project:native/App.sln" && relation.to === "project:native/Engine/Engine.vcxproj"
    )
  );
  assert.ok(
    result.referencesProjectRelations.some(
      (relation) =>
        relation.from === "project:native/Engine/Engine.vcxproj" &&
        relation.to === "project:native/Interop/Interop.csproj"
    )
  );
});

test("generateNamedResourceRelations: links code files to matching resx and settings files", () => {
  const files = [
    {
      id: "file:legacy/Form1.Designer.vb",
      path: "legacy/Form1.Designer.vb",
      kind: "CODE",
      updated_at: "2026-01-01",
      content: [
        "cmd.CommandText = My.Resources.ActiveUsersQuery",
        "Dim procName = My.Settings.RunReportProc"
      ].join("\n")
    },
    {
      id: "file:legacy/Resources.resx",
      path: "legacy/Resources.resx",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: [
        "<root>",
        '  <data name="ActiveUsersQuery" xml:space="preserve">',
        "    <value>SELECT * FROM dbo.ActiveUsers</value>",
        "  </data>",
        "</root>"
      ].join("\n")
    },
    {
      id: "file:legacy/App.settings",
      path: "legacy/App.settings",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: [
        "<SettingsFile>",
        "  <Settings>",
        '    <Setting Name="RunReportProc" Type="System.String" Scope="Application">',
        "      <Value Profile=\"(Default)\">reporting.RunReport</Value>",
        "    </Setting>",
        "  </Settings>",
        "</SettingsFile>"
      ].join("\n")
    }
  ];

  const result = generateNamedResourceRelations(files);

  assert.deepEqual(result.usesResourceRelations, [
    {
      from: "file:legacy/Form1.Designer.vb",
      to: "file:legacy/Resources.resx",
      note: "activeusersquery"
    }
  ]);
  assert.deepEqual(result.usesSettingRelations, [
    {
      from: "file:legacy/Form1.Designer.vb",
      to: "file:legacy/App.settings",
      note: "runreportproc"
    }
  ]);
  assert.deepEqual(result.usesConfigRelations, []);
});

test("generateNamedResourceRelations: links code files to matching app/web config keys", () => {
  const files = [
    {
      id: "file:legacy/Repository.vb",
      path: "legacy/Repository.vb",
      kind: "CODE",
      updated_at: "2026-01-01",
      content: [
        'Dim cs = ConfigurationManager.ConnectionStrings["LegacyDb"].ConnectionString',
        'Dim feature = ConfigurationManager.AppSettings("FeatureFlag")'
      ].join("\n")
    },
    {
      id: "file:legacy/App.config",
      path: "legacy/App.config",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: [
        "<configuration>",
        "  <connectionStrings>",
        '    <add name="LegacyDb" connectionString="Server=.;Database=Legacy;" />',
        "  </connectionStrings>",
        "  <appSettings>",
        '    <add key="FeatureFlag" value="true" />',
        "  </appSettings>",
        "</configuration>"
      ].join("\n")
    }
  ];

  const result = generateNamedResourceRelations(files);

  assert.deepEqual(result.usesConfigRelations, [
    {
      from: "file:legacy/Repository.vb",
      to: "file:legacy/App.config",
      note: "featureflag"
    },
    {
      from: "file:legacy/Repository.vb",
      to: "file:legacy/App.config",
      note: "legacydb"
    }
  ]);
});

test("generateConfigTransformRelations: links transform configs back to their base config", () => {
  const files = [
    {
      id: "file:legacy/Web.config",
      path: "legacy/Web.config",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: "<configuration />"
    },
    {
      id: "file:legacy/Web.Release.config",
      path: "legacy/Web.Release.config",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: [
        "<configuration xmlns:xdt=\"http://schemas.microsoft.com/XML-Document-Transform\">",
        "  <connectionStrings>",
        "    <add name=\"LegacyDb\" connectionString=\"Data Source=prod;Initial Catalog=Legacy;\" xdt:Transform=\"SetAttributes\" xdt:Locator=\"Match(name)\" />",
        "  </connectionStrings>",
        "</configuration>"
      ].join("\n")
    },
    {
      id: "file:legacy/App.config",
      path: "legacy/App.config",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: "<configuration />"
    },
    {
      id: "file:legacy/App.Debug.config",
      path: "legacy/App.Debug.config",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: [
        "<configuration xmlns:xdt=\"http://schemas.microsoft.com/XML-Document-Transform\">",
        "  <appSettings>",
        "    <add key=\"FeatureFlag\" value=\"true\" xdt:Transform=\"SetAttributes\" xdt:Locator=\"Match(key)\" />",
        "  </appSettings>",
        "</configuration>"
      ].join("\n")
    },
    {
      id: "file:legacy/Plain.Custom.config",
      path: "legacy/Plain.Custom.config",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: "<configuration />"
    }
  ];

  const result = generateConfigTransformRelations(files);

  assert.deepEqual(result, [
    {
      from: "file:legacy/App.Debug.config",
      to: "file:legacy/App.config",
      note: "debug"
    },
    {
      from: "file:legacy/Web.Release.config",
      to: "file:legacy/Web.config",
      note: "release"
    }
  ]);
});

test("generateConfigIncludeRelations: links base configs to external config fragments", () => {
  const files = [
    {
      id: "file:legacy/Web.config",
      path: "legacy/Web.config",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: [
        "<configuration>",
        '  <connectionStrings configSource="ConnectionStrings.Release.config" />',
        '  <appSettings file="AppSettings.Shared.config" />',
        "</configuration>"
      ].join("\n")
    },
    {
      id: "file:legacy/ConnectionStrings.Release.config",
      path: "legacy/ConnectionStrings.Release.config",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: "<connectionStrings />"
    },
    {
      id: "file:legacy/AppSettings.Shared.config",
      path: "legacy/AppSettings.Shared.config",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: "<appSettings />"
    },
    {
      id: "file:legacy/Orphan.config",
      path: "legacy/Orphan.config",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: '<configuration><appSettings file="../outside.config" /></configuration>'
    }
  ];

  const result = generateConfigIncludeRelations(files);

  assert.deepEqual(result, [
    {
      from: "file:legacy/Web.config",
      to: "file:legacy/AppSettings.Shared.config",
      note: "appsettings:file"
    },
    {
      from: "file:legacy/Web.config",
      to: "file:legacy/ConnectionStrings.Release.config",
      note: "connectionstrings:configsource"
    }
  ]);
});

test("generateMachineConfigRelations: links config files to the nearest machine.config", () => {
  const files = [
    {
      id: "file:machine.config",
      path: "machine.config",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: "<configuration />"
    },
    {
      id: "file:legacy/machine.config",
      path: "legacy/machine.config",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: "<configuration />"
    },
    {
      id: "file:legacy/Web.config",
      path: "legacy/Web.config",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: "<configuration />"
    },
    {
      id: "file:legacy/admin/Admin.config",
      path: "legacy/admin/Admin.config",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: "<configuration />"
    },
    {
      id: "file:legacy/Web.Release.config",
      path: "legacy/Web.Release.config",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform" />'
    }
  ];

  const result = generateMachineConfigRelations(files);

  assert.deepEqual(result, [
    {
      from: "file:legacy/admin/Admin.config",
      to: "file:legacy/machine.config",
      note: "inherits:machine"
    },
    {
      from: "file:legacy/Web.config",
      to: "file:legacy/machine.config",
      note: "inherits:machine"
    }
  ]);
});

test("generateSectionHandlerRelations: links config sections to project and code handlers", () => {
  const files = [
    {
      id: "file:legacy/Web.config",
      path: "legacy/Web.config",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: [
        "<configuration>",
        "  <configSections>",
        '    <section name="legacySettings" type="Legacy.Configuration.LegacySettingsSection, Legacy.App" />',
        "  </configSections>",
        "</configuration>"
      ].join("\n")
    },
    {
      id: "file:legacy/Legacy.App.vbproj",
      path: "legacy/Legacy.App.vbproj",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: [
        "<Project>",
        "  <PropertyGroup>",
        "    <AssemblyName>Legacy.App</AssemblyName>",
        "    <RootNamespace>Legacy.Configuration</RootNamespace>",
        "  </PropertyGroup>",
        "</Project>"
      ].join("\n")
    },
    {
      id: "file:legacy/LegacySettingsSection.vb",
      path: "legacy/LegacySettingsSection.vb",
      kind: "CODE",
      updated_at: "2026-01-01",
      content: [
        "Namespace Legacy.Configuration",
        "  Public Class LegacySettingsSection",
        "  End Class",
        "End Namespace"
      ].join("\n")
    },
    {
      id: "file:legacy/Other.vb",
      path: "legacy/Other.vb",
      kind: "CODE",
      updated_at: "2026-01-01",
      content: "Public Class OtherThing\nEnd Class"
    }
  ];

  const result = generateSectionHandlerRelations(files);

  assert.deepEqual(result, [
    {
      from: "file:legacy/Web.config",
      to: "file:legacy/Legacy.App.vbproj",
      note: "section_handler:legacysettings"
    },
    {
      from: "file:legacy/Web.config",
      to: "file:legacy/LegacySettingsSection.vb",
      note: "section_handler:legacysettings"
    }
  ]);
});

test("generateConfigTransformKeyRelations: links transform files to overridden base config chunks", () => {
  const files = [
    {
      id: "file:legacy/Web.config",
      path: "legacy/Web.config",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: [
        "<configuration>",
        "  <connectionStrings>",
        '    <add name="LegacyDb" connectionString="Data Source=.;Initial Catalog=Legacy;" />',
        "  </connectionStrings>",
        "  <appSettings>",
        '    <add key="FeatureFlag" value="false" />',
        "  </appSettings>",
        "</configuration>"
      ].join("\n")
    },
    {
      id: "file:legacy/Web.Release.config",
      path: "legacy/Web.Release.config",
      kind: "DOC",
      updated_at: "2026-01-01",
      content: [
        '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform">',
        "  <connectionStrings>",
        '    <add name="LegacyDb" connectionString="Data Source=prod;Initial Catalog=Legacy;" xdt:Transform="SetAttributes" xdt:Locator="Match(name)" />',
        "  </connectionStrings>",
        "  <appSettings>",
        '    <add key="FeatureFlag" value="true" xdt:Transform="SetAttributes" xdt:Locator="Match(key)" />',
        "  </appSettings>",
        "</configuration>"
      ].join("\n")
    }
  ];

  const chunks = [
    {
      id: "chunk:legacy/Web.config:connection_string.legacydb:3-3",
      file_id: "file:legacy/Web.config",
      name: "connection_string.legacydb",
      kind: "connection_string",
      language: "config"
    },
    {
      id: "chunk:legacy/Web.config:app_setting.featureflag:6-6",
      file_id: "file:legacy/Web.config",
      name: "app_setting.featureflag",
      kind: "app_setting",
      language: "config"
    },
    {
      id: "chunk:legacy/Web.Release.config:connection_string.legacydb:3-3",
      file_id: "file:legacy/Web.Release.config",
      name: "connection_string.legacydb",
      kind: "connection_string",
      language: "config"
    }
  ];

  const result = generateConfigTransformKeyRelations(files, chunks);

  assert.deepEqual(result, [
    {
      from: "file:legacy/Web.Release.config",
      to: "chunk:legacy/Web.config:app_setting.featureflag:6-6",
      note: "featureflag:release"
    },
    {
      from: "file:legacy/Web.Release.config",
      to: "chunk:legacy/Web.config:connection_string.legacydb:3-3",
      note: "legacydb:release"
    }
  ]);
});
