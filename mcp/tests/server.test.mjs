import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MCP_DIR = path.resolve(__dirname, "..");

function writeJsonl(filePath, records) {
  const payload = records.map((record) => JSON.stringify(record)).join("\n");
  fs.writeFileSync(filePath, payload ? `${payload}\n` : "", "utf8");
}

function buildWindowChunkSearchFixture() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-window-search-"));
  const contextDir = path.join(fixtureRoot, ".context");
  const cacheDir = path.join(contextDir, "cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  const now = new Date().toISOString();
  const fileId = "file:src/large.ts";
  const baseChunkId = "chunk:src/large.ts:LargeChunk:10-329";
  const windowChunkId = `${baseChunkId}:window:4:250-329`;
  const helperChunkId = "chunk:src/large.ts:HelperChunk:400-410";

  fs.writeFileSync(
    path.join(contextDir, "config.yaml"),
    `repo_id: fixture
source_paths:
  - src
ranking:
  semantic: 0.40
  graph: 0.25
  trust: 0.20
  recency: 0.15
`,
    "utf8"
  );
  fs.writeFileSync(path.join(contextDir, "rules.yaml"), "rules:\n", "utf8");

  writeJsonl(path.join(cacheDir, "documents.jsonl"), [
    {
      id: fileId,
      path: "src/large.ts",
      kind: "CODE",
      updated_at: now,
      source_of_truth: false,
      trust_level: 80,
      status: "active",
      excerpt: "Large chunk fixture",
      content: "export function LargeChunk() { return 1; }"
    }
  ]);

  writeJsonl(path.join(cacheDir, "entities.rule.jsonl"), []);
  writeJsonl(path.join(cacheDir, "entities.adr.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.constrains.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.implements.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.supersedes.jsonl"), []);

  writeJsonl(path.join(cacheDir, "entities.chunk.jsonl"), [
    {
      id: baseChunkId,
      file_id: fileId,
      name: "LargeChunk",
      kind: "function",
      signature: "LargeChunk()",
      body: "line-0001-prefix-only\nline-0002-prefix-only",
      start_line: 10,
      end_line: 329,
      language: "typescript",
      updated_at: now,
      source_of_truth: false,
      trust_level: 80,
      status: "active"
    },
    {
      id: windowChunkId,
      file_id: fileId,
      name: "LargeChunk#window4",
      kind: "function",
      signature: "LargeChunk() [window 4]",
      body: "windowtailonlytokenzqv993 appears only in this overlap window",
      start_line: 250,
      end_line: 329,
      language: "typescript",
      updated_at: now,
      source_of_truth: false,
      trust_level: 80,
      status: "active"
    },
    {
      id: helperChunkId,
      file_id: fileId,
      name: "HelperChunk",
      kind: "function",
      signature: "HelperChunk()",
      body: "function HelperChunk() { return 1; }",
      start_line: 400,
      end_line: 410,
      language: "typescript",
      updated_at: now,
      source_of_truth: false,
      trust_level: 80,
      status: "active"
    }
  ]);
  writeJsonl(path.join(cacheDir, "relations.calls.jsonl"), [
    {
      from: baseChunkId,
      to: helperChunkId,
      call_type: "direct"
    }
  ]);
  writeJsonl(path.join(cacheDir, "relations.imports.jsonl"), []);

  return {
    fixtureRoot,
    fileId,
    baseChunkId,
    windowChunkId,
    helperChunkId
  };
}

function buildLegacyDataAccessSearchFixture() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-legacy-search-"));
  const contextDir = path.join(fixtureRoot, ".context");
  const cacheDir = path.join(contextDir, "cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  const now = new Date().toISOString();
  const codeFileId = "file:src/Repository.vb";
  const configFileId = "file:legacy/App.config";
  const configChunkId = "chunk:legacy/App.config:connection_string.legacydb:3-3";
  const databaseTargetChunkId = "chunk:legacy/App.config:database_target.legacydb:3-3";

  fs.writeFileSync(
    path.join(contextDir, "config.yaml"),
    `repo_id: fixture
source_paths:
  - src
  - legacy
ranking:
  semantic: 0.40
  graph: 0.25
  trust: 0.20
  recency: 0.15
`,
    "utf8"
  );
  fs.writeFileSync(path.join(contextDir, "rules.yaml"), "rules:\n", "utf8");

  writeJsonl(path.join(cacheDir, "documents.jsonl"), [
    {
      id: codeFileId,
      path: "src/Repository.vb",
      kind: "CODE",
      updated_at: now,
      source_of_truth: false,
      trust_level: 80,
      status: "active",
      excerpt: "Repository loads application configuration and data access settings.",
      content: 'Dim cs = ConfigurationManager.ConnectionStrings("LegacyDb").ConnectionString'
    },
    {
      id: configFileId,
      path: "legacy/App.config",
      kind: "DOC",
      updated_at: now,
      source_of_truth: false,
      trust_level: 70,
      status: "active",
      excerpt: "Legacy application configuration",
      content:
        '<add name="LegacyDb" connectionString="Data Source=.;Initial Catalog=Legacy;" providerName="System.Data.SqlClient" />'
    }
  ]);

  writeJsonl(path.join(cacheDir, "entities.rule.jsonl"), []);
  writeJsonl(path.join(cacheDir, "entities.adr.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.constrains.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.implements.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.supersedes.jsonl"), []);

  writeJsonl(path.join(cacheDir, "entities.chunk.jsonl"), [
    {
      id: "chunk:src/Repository.vb:LoadConnection:10-12",
      file_id: codeFileId,
      name: "LoadConnection",
      kind: "function",
      signature: "LoadConnection()",
      body: 'Function LoadConnection() As String\n  Return ConfigurationManager.ConnectionStrings("LegacyDb").ConnectionString\nEnd Function',
      description: 'function. LoadConnection(). ConfigurationManager.ConnectionStrings("LegacyDb").ConnectionString.',
      start_line: 10,
      end_line: 12,
      language: "vbnet",
      updated_at: now,
      source_of_truth: false,
      trust_level: 80,
      status: "active"
    },
    {
      id: configChunkId,
      file_id: configFileId,
      name: "connection_string.legacydb",
      kind: "connection_string",
      signature: "connection_string LegacyDb",
      body: '<add name="LegacyDb" connectionString="Data Source=.;Initial Catalog=Legacy;" providerName="System.Data.SqlClient" />',
      description:
        "connection_string. connection_string LegacyDb. Data Source=.;Initial Catalog=Legacy; provider=System.Data.SqlClient",
      start_line: 3,
      end_line: 3,
      language: "config",
      updated_at: now,
      source_of_truth: false,
      trust_level: 80,
      status: "active"
    },
    {
      id: databaseTargetChunkId,
      file_id: configFileId,
      name: "database_target.legacydb",
      kind: "database_target",
      signature: "database_target LegacyDb",
      body: '<add name="LegacyDb" connectionString="Data Source=.;Initial Catalog=Legacy;" providerName="System.Data.SqlClient" />',
      description:
        "database_target. database_target LegacyDb. database=Legacy; server=.; provider=System.Data.SqlClient;",
      start_line: 3,
      end_line: 3,
      language: "config",
      updated_at: now,
      source_of_truth: false,
      trust_level: 80,
      status: "active"
    }
  ]);

  writeJsonl(path.join(cacheDir, "relations.calls.jsonl"), [
    { from: configChunkId, to: databaseTargetChunkId, call_type: "direct" }
  ]);
  writeJsonl(path.join(cacheDir, "relations.imports.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.defines.jsonl"), [
    { from: codeFileId, to: "chunk:src/Repository.vb:LoadConnection:10-12" },
    { from: configFileId, to: configChunkId }
  ]);
  writeJsonl(path.join(cacheDir, "relations.calls_sql.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.uses_config_key.jsonl"), [
    { from: codeFileId, to: configChunkId, note: "legacydb" },
    { from: codeFileId, to: databaseTargetChunkId, note: "legacydb" }
  ]);
  writeJsonl(path.join(cacheDir, "relations.transforms_config.jsonl"), []);

  return {
    fixtureRoot,
    codeFileId,
    configChunkId,
    databaseTargetChunkId
  };
}

function buildConfigTransformFixture() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-config-transform-"));
  const contextDir = path.join(fixtureRoot, ".context");
  const cacheDir = path.join(contextDir, "cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  const now = new Date().toISOString();
  const baseConfigId = "file:legacy/Web.config";
  const transformConfigId = "file:legacy/Web.Release.config";
  const baseConfigChunkId = "chunk:legacy/Web.config:connection_string.legacydb:3-3";

  fs.writeFileSync(path.join(contextDir, "config.yaml"), "repo_id: fixture\nsource_paths:\n  - legacy\n", "utf8");
  fs.writeFileSync(path.join(contextDir, "rules.yaml"), "rules:\n", "utf8");

  writeJsonl(path.join(cacheDir, "documents.jsonl"), [
    {
      id: baseConfigId,
      path: "legacy/Web.config",
      kind: "DOC",
      updated_at: now,
      source_of_truth: false,
      trust_level: 70,
      status: "active",
      excerpt: "Base web configuration",
      content: "<configuration />"
    },
    {
      id: transformConfigId,
      path: "legacy/Web.Release.config",
      kind: "DOC",
      updated_at: now,
      source_of_truth: false,
      trust_level: 70,
      status: "active",
      excerpt: "Release web.config transform",
      content:
        '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform"><appSettings><add key="FeatureFlag" value="true" xdt:Transform="SetAttributes" xdt:Locator="Match(key)" /></appSettings></configuration>'
    }
  ]);

  writeJsonl(path.join(cacheDir, "entities.rule.jsonl"), []);
  writeJsonl(path.join(cacheDir, "entities.adr.jsonl"), []);
  writeJsonl(path.join(cacheDir, "entities.chunk.jsonl"), [
    {
      id: baseConfigChunkId,
      file_id: baseConfigId,
      name: "connection_string.legacydb",
      kind: "connection_string",
      signature: "connection_string LegacyDb",
      body: '<add name="LegacyDb" connectionString="Data Source=.;Initial Catalog=Legacy;" />',
      description: "connection_string. connection_string LegacyDb. Data Source=.;Initial Catalog=Legacy;",
      start_line: 3,
      end_line: 3,
      language: "config",
      updated_at: now,
      source_of_truth: false,
      trust_level: 80,
      status: "active"
    }
  ]);
  writeJsonl(path.join(cacheDir, "relations.constrains.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.implements.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.supersedes.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.defines.jsonl"), [
    { from: baseConfigId, to: baseConfigChunkId }
  ]);
  writeJsonl(path.join(cacheDir, "relations.calls.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.imports.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.calls_sql.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.uses_config_key.jsonl"), [
    { from: transformConfigId, to: baseConfigChunkId, note: "legacydb:release" }
  ]);
  writeJsonl(path.join(cacheDir, "relations.uses_resource.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.uses_setting.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.uses_config.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.transforms_config.jsonl"), [
    { from: transformConfigId, to: baseConfigId, note: "release" }
  ]);

  return {
    fixtureRoot,
    baseConfigId,
    baseConfigChunkId,
    transformConfigId
  };
}

function buildConfigToSqlImpactFixture() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-config-sql-impact-"));
  const contextDir = path.join(fixtureRoot, ".context");
  const cacheDir = path.join(contextDir, "cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  const now = new Date().toISOString();
  const codeFileId = "file:src/ReportRepository.vb";
  const settingsFileId = "file:legacy/App.settings";
  const sqlFileId = "file:db/reporting.sql";
  const settingChunkId = "chunk:legacy/App.settings:setting_entry.runreportproc:4-6";
  const sqlChunkId = "chunk:db/reporting.sql:procedure.usp_runreport:1-5";

  fs.writeFileSync(
    path.join(contextDir, "config.yaml"),
    "repo_id: fixture\nsource_paths:\n  - src\n  - legacy\n  - db\n",
    "utf8"
  );
  fs.writeFileSync(path.join(contextDir, "rules.yaml"), "rules:\n", "utf8");

  writeJsonl(path.join(cacheDir, "documents.jsonl"), [
    {
      id: codeFileId,
      path: "src/ReportRepository.vb",
      kind: "CODE",
      updated_at: now,
      source_of_truth: false,
      trust_level: 80,
      status: "active",
      excerpt: "Repository resolves the configured report procedure.",
      content: "Dim procName = My.Settings.RunReportProc"
    },
    {
      id: settingsFileId,
      path: "legacy/App.settings",
      kind: "DOC",
      updated_at: now,
      source_of_truth: false,
      trust_level: 75,
      status: "active",
      excerpt: "Application settings for legacy reports",
      content: '<Setting Name="RunReportProc" Type="System.String" Scope="Application"><Value>usp_RunReport</Value></Setting>'
    },
    {
      id: sqlFileId,
      path: "db/reporting.sql",
      kind: "CODE",
      updated_at: now,
      source_of_truth: false,
      trust_level: 80,
      status: "active",
      excerpt: "SQL procedures for reporting",
      content: "CREATE PROCEDURE dbo.usp_RunReport AS SELECT 1;"
    }
  ]);

  writeJsonl(path.join(cacheDir, "entities.rule.jsonl"), []);
  writeJsonl(path.join(cacheDir, "entities.adr.jsonl"), []);
  writeJsonl(path.join(cacheDir, "entities.chunk.jsonl"), [
    {
      id: settingChunkId,
      file_id: settingsFileId,
      name: "setting_entry.runreportproc",
      kind: "setting_entry",
      signature: "setting_entry RunReportProc",
      body: '<Setting Name="RunReportProc" Type="System.String" Scope="Application"><Value>usp_RunReport</Value></Setting>',
      description: "setting_entry. setting_entry RunReportProc. value=usp_RunReport.",
      start_line: 4,
      end_line: 6,
      language: "settings",
      updated_at: now,
      source_of_truth: false,
      trust_level: 80,
      status: "active"
    },
    {
      id: sqlChunkId,
      file_id: sqlFileId,
      name: "procedure.usp_runreport",
      kind: "procedure",
      signature: "procedure dbo.usp_RunReport",
      body: "CREATE PROCEDURE dbo.usp_RunReport AS SELECT 1;",
      description: "procedure. dbo.usp_RunReport. reporting stored procedure.",
      start_line: 1,
      end_line: 5,
      language: "sql",
      updated_at: now,
      source_of_truth: false,
      trust_level: 80,
      status: "active"
    }
  ]);
  writeJsonl(path.join(cacheDir, "relations.constrains.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.implements.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.supersedes.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.defines.jsonl"), [
    { from: settingsFileId, to: settingChunkId },
    { from: sqlFileId, to: sqlChunkId }
  ]);
  writeJsonl(path.join(cacheDir, "relations.calls.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.imports.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.calls_sql.jsonl"), [
    { from: settingChunkId, to: sqlChunkId, note: "usp_runreport" }
  ]);
  writeJsonl(path.join(cacheDir, "relations.uses_config_key.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.uses_resource_key.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.uses_setting_key.jsonl"), [
    { from: codeFileId, to: settingChunkId, note: "runreportproc" }
  ]);
  writeJsonl(path.join(cacheDir, "relations.uses_resource.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.uses_setting.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.uses_config.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.transforms_config.jsonl"), []);

  return {
    fixtureRoot,
    codeFileId,
    settingChunkId,
    sqlChunkId
  };
}

function buildImpactSortingFixture() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-impact-sorting-"));
  const contextDir = path.join(fixtureRoot, ".context");
  const cacheDir = path.join(contextDir, "cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  const now = new Date().toISOString();
  const codeFileId = "file:src/LegacyEntry.vb";
  const configFileId = "file:legacy/App.config";
  const sqlFileId = "file:db/reporting.sql";
  const nearChunkId = "chunk:legacy/App.config:app_setting.featuretoggle:3-3";
  const farChunkId = "chunk:db/reporting.sql:procedure.usp_heavyreport:1-5";

  fs.writeFileSync(
    path.join(contextDir, "config.yaml"),
    "repo_id: fixture\nsource_paths:\n  - src\n  - legacy\n  - db\n",
    "utf8"
  );
  fs.writeFileSync(path.join(contextDir, "rules.yaml"), "rules:\n", "utf8");

  writeJsonl(path.join(cacheDir, "documents.jsonl"), [
    {
      id: codeFileId,
      path: "src/LegacyEntry.vb",
      kind: "CODE",
      updated_at: now,
      source_of_truth: false,
      trust_level: 80,
      status: "active",
      excerpt: "Legacy entry point",
      content: "Dim flag = ConfigurationManager.AppSettings(\"FeatureToggle\")"
    },
    {
      id: configFileId,
      path: "legacy/App.config",
      kind: "DOC",
      updated_at: now,
      source_of_truth: false,
      trust_level: 40,
      status: "active",
      excerpt: "Legacy app settings",
      content: '<add key="FeatureToggle" value="usp_HeavyReport" />'
    },
    {
      id: sqlFileId,
      path: "db/reporting.sql",
      kind: "CODE",
      updated_at: now,
      source_of_truth: false,
      trust_level: 95,
      status: "active",
      excerpt: "Heavy reporting SQL",
      content: "CREATE PROCEDURE dbo.usp_HeavyReport AS SELECT 1;"
    }
  ]);

  writeJsonl(path.join(cacheDir, "entities.rule.jsonl"), []);
  writeJsonl(path.join(cacheDir, "entities.adr.jsonl"), []);
  writeJsonl(path.join(cacheDir, "entities.chunk.jsonl"), [
    {
      id: nearChunkId,
      file_id: configFileId,
      name: "app_setting.featuretoggle",
      kind: "app_setting",
      signature: "app_setting FeatureToggle",
      body: '<add key="FeatureToggle" value="usp_HeavyReport" />',
      description: "app_setting. app_setting FeatureToggle. value=usp_HeavyReport.",
      start_line: 3,
      end_line: 3,
      language: "config",
      updated_at: now,
      source_of_truth: false,
      trust_level: 10,
      status: "active"
    },
    {
      id: farChunkId,
      file_id: sqlFileId,
      name: "procedure.usp_heavyreport",
      kind: "procedure",
      signature: "procedure dbo.usp_HeavyReport",
      body: "CREATE PROCEDURE dbo.usp_HeavyReport AS SELECT 1;",
      description: "procedure. dbo.usp_HeavyReport. trusted reporting stored procedure.",
      start_line: 1,
      end_line: 5,
      language: "sql",
      updated_at: now,
      source_of_truth: false,
      trust_level: 100,
      status: "active"
    }
  ]);
  writeJsonl(path.join(cacheDir, "relations.constrains.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.implements.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.supersedes.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.defines.jsonl"), [
    { from: configFileId, to: nearChunkId },
    { from: sqlFileId, to: farChunkId }
  ]);
  writeJsonl(path.join(cacheDir, "relations.calls.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.imports.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.calls_sql.jsonl"), [
    { from: nearChunkId, to: farChunkId, note: "usp_heavyreport" }
  ]);
  writeJsonl(path.join(cacheDir, "relations.uses_config_key.jsonl"), [
    { from: codeFileId, to: nearChunkId, note: "featuretoggle" }
  ]);
  writeJsonl(path.join(cacheDir, "relations.uses_resource_key.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.uses_setting_key.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.uses_resource.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.uses_setting.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.uses_config.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.transforms_config.jsonl"), []);

  return {
    fixtureRoot,
    codeFileId,
    nearChunkId,
    farChunkId
  };
}

function buildLongImpactPathFixture() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-impact-long-path-"));
  const contextDir = path.join(fixtureRoot, ".context");
  const cacheDir = path.join(contextDir, "cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  const now = new Date().toISOString();
  const seedFileId = "file:src/Entry.vb";
  const targetFileId = "file:db/reporting.sql";
  const configChunkId = "chunk:legacy/App.config:app_setting.featuretoggle:3-3";
  const helperChunkId = "chunk:src/FeatureToggleResolver.vb:ResolveFeatureToggle:10-20";
  const sqlChunkId = "chunk:db/reporting.sql:procedure.usp_heavyreport:1-5";

  fs.writeFileSync(
    path.join(contextDir, "config.yaml"),
    "repo_id: fixture\nsource_paths:\n  - src\n  - legacy\n  - db\n",
    "utf8"
  );
  fs.writeFileSync(path.join(contextDir, "rules.yaml"), "rules:\n", "utf8");

  writeJsonl(path.join(cacheDir, "documents.jsonl"), [
    {
      id: seedFileId,
      path: "src/Entry.vb",
      kind: "CODE",
      updated_at: now,
      source_of_truth: false,
      trust_level: 80,
      status: "active",
      excerpt: "Entry point for legacy flow",
      content: "Dim feature = ConfigurationManager.AppSettings(\"FeatureToggle\")"
    },
    {
      id: "file:legacy/App.config",
      path: "legacy/App.config",
      kind: "DOC",
      updated_at: now,
      source_of_truth: false,
      trust_level: 70,
      status: "active",
      excerpt: "Legacy app config",
      content: '<add key="FeatureToggle" value="On" />'
    },
    {
      id: "file:src/FeatureToggleResolver.vb",
      path: "src/FeatureToggleResolver.vb",
      kind: "CODE",
      updated_at: now,
      source_of_truth: false,
      trust_level: 80,
      status: "active",
      excerpt: "Resolves feature toggles into SQL flows",
      content: "Function ResolveFeatureToggle() As String"
    },
    {
      id: targetFileId,
      path: "db/reporting.sql",
      kind: "CODE",
      updated_at: now,
      source_of_truth: false,
      trust_level: 85,
      status: "active",
      excerpt: "Reporting SQL definitions",
      content: "CREATE PROCEDURE dbo.usp_HeavyReport AS SELECT 1;"
    }
  ]);

  writeJsonl(path.join(cacheDir, "entities.rule.jsonl"), []);
  writeJsonl(path.join(cacheDir, "entities.adr.jsonl"), []);
  writeJsonl(path.join(cacheDir, "entities.chunk.jsonl"), [
    {
      id: configChunkId,
      file_id: "file:legacy/App.config",
      name: "app_setting.featuretoggle",
      kind: "app_setting",
      signature: "app_setting FeatureToggle",
      body: '<add key="FeatureToggle" value="On" />',
      description: "app_setting. app_setting FeatureToggle.",
      start_line: 3,
      end_line: 3,
      language: "config",
      updated_at: now,
      source_of_truth: false,
      trust_level: 70,
      status: "active"
    },
    {
      id: helperChunkId,
      file_id: "file:src/FeatureToggleResolver.vb",
      name: "ResolveFeatureToggle",
      kind: "function",
      signature: "ResolveFeatureToggle()",
      body: "Function ResolveFeatureToggle() As String\nEnd Function",
      description: "function. ResolveFeatureToggle().",
      start_line: 10,
      end_line: 20,
      language: "vbnet",
      updated_at: now,
      source_of_truth: false,
      trust_level: 80,
      status: "active"
    },
    {
      id: sqlChunkId,
      file_id: targetFileId,
      name: "procedure.usp_heavyreport",
      kind: "procedure",
      signature: "procedure dbo.usp_HeavyReport",
      body: "CREATE PROCEDURE dbo.usp_HeavyReport AS SELECT 1;",
      description: "procedure. dbo.usp_HeavyReport.",
      start_line: 1,
      end_line: 5,
      language: "sql",
      updated_at: now,
      source_of_truth: false,
      trust_level: 90,
      status: "active"
    }
  ]);
  writeJsonl(path.join(cacheDir, "relations.constrains.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.implements.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.supersedes.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.defines.jsonl"), [
    { from: "file:legacy/App.config", to: configChunkId },
    { from: "file:src/FeatureToggleResolver.vb", to: helperChunkId },
    { from: targetFileId, to: sqlChunkId }
  ]);
  writeJsonl(path.join(cacheDir, "relations.calls.jsonl"), [
    { from: configChunkId, to: helperChunkId, call_type: "direct" },
    { from: helperChunkId, to: sqlChunkId, call_type: "direct" }
  ]);
  writeJsonl(path.join(cacheDir, "relations.imports.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.calls_sql.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.uses_config_key.jsonl"), [
    { from: seedFileId, to: configChunkId, note: "featuretoggle" }
  ]);
  writeJsonl(path.join(cacheDir, "relations.uses_resource_key.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.uses_setting_key.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.uses_resource.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.uses_setting.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.uses_config.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.transforms_config.jsonl"), []);

  return {
    fixtureRoot,
    seedFileId,
    targetFileId
  };
}

function buildConfigIncludeFixture() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-config-include-"));
  const contextDir = path.join(fixtureRoot, ".context");
  const cacheDir = path.join(contextDir, "cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  const now = new Date().toISOString();
  const baseConfigId = "file:legacy/Web.config";
  const appSettingsConfigId = "file:legacy/AppSettings.Shared.config";
  const connectionStringsConfigId = "file:legacy/ConnectionStrings.Release.config";

  fs.writeFileSync(path.join(contextDir, "config.yaml"), "repo_id: fixture\nsource_paths:\n  - legacy\n", "utf8");
  fs.writeFileSync(path.join(contextDir, "rules.yaml"), "rules:\n", "utf8");

  writeJsonl(path.join(cacheDir, "documents.jsonl"), [
    {
      id: baseConfigId,
      path: "legacy/Web.config",
      kind: "DOC",
      updated_at: now,
      source_of_truth: false,
      trust_level: 70,
      status: "active",
      excerpt: "Base web configuration",
      content:
        '<configuration><connectionStrings configSource="ConnectionStrings.Release.config" /><appSettings file="AppSettings.Shared.config" /></configuration>'
    },
    {
      id: appSettingsConfigId,
      path: "legacy/AppSettings.Shared.config",
      kind: "DOC",
      updated_at: now,
      source_of_truth: false,
      trust_level: 70,
      status: "active",
      excerpt: "Shared app settings fragment",
      content: "<appSettings />"
    },
    {
      id: connectionStringsConfigId,
      path: "legacy/ConnectionStrings.Release.config",
      kind: "DOC",
      updated_at: now,
      source_of_truth: false,
      trust_level: 70,
      status: "active",
      excerpt: "Connection strings fragment",
      content: "<connectionStrings />"
    }
  ]);

  writeJsonl(path.join(cacheDir, "entities.rule.jsonl"), []);
  writeJsonl(path.join(cacheDir, "entities.adr.jsonl"), []);
  writeJsonl(path.join(cacheDir, "entities.chunk.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.constrains.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.implements.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.supersedes.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.defines.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.calls.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.imports.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.calls_sql.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.uses_config_key.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.uses_resource.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.uses_setting.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.uses_config.jsonl"), [
    { from: baseConfigId, to: appSettingsConfigId, note: "appsettings:file" },
    { from: baseConfigId, to: connectionStringsConfigId, note: "connectionstrings:configsource" }
  ]);
  writeJsonl(path.join(cacheDir, "relations.transforms_config.jsonl"), []);

  return {
    fixtureRoot,
    baseConfigId,
    appSettingsConfigId,
    connectionStringsConfigId
  };
}

function buildConfigHandlerFixture() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-config-handler-"));
  const contextDir = path.join(fixtureRoot, ".context");
  const cacheDir = path.join(contextDir, "cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  const now = new Date().toISOString();
  const webConfigId = "file:legacy/Web.config";
  const machineConfigId = "file:legacy/machine.config";
  const projectFileId = "file:legacy/Legacy.App.vbproj";
  const handlerFileId = "file:legacy/LegacySettingsSection.vb";

  fs.writeFileSync(path.join(contextDir, "config.yaml"), "repo_id: fixture\nsource_paths:\n  - legacy\n", "utf8");
  fs.writeFileSync(path.join(contextDir, "rules.yaml"), "rules:\n", "utf8");

  writeJsonl(path.join(cacheDir, "documents.jsonl"), [
    {
      id: webConfigId,
      path: "legacy/Web.config",
      kind: "DOC",
      updated_at: now,
      source_of_truth: false,
      trust_level: 70,
      status: "active",
      excerpt: "Web configuration with custom section handler",
      content:
        '<configuration><configSections><section name="legacySettings" type="Legacy.Configuration.LegacySettingsSection, Legacy.App" /></configSections></configuration>'
    },
    {
      id: machineConfigId,
      path: "legacy/machine.config",
      kind: "DOC",
      updated_at: now,
      source_of_truth: false,
      trust_level: 70,
      status: "active",
      excerpt: "Machine-level configuration",
      content: "<configuration />"
    },
    {
      id: projectFileId,
      path: "legacy/Legacy.App.vbproj",
      kind: "DOC",
      updated_at: now,
      source_of_truth: false,
      trust_level: 70,
      status: "active",
      excerpt: "VB project for legacy app",
      content: "<Project><PropertyGroup><AssemblyName>Legacy.App</AssemblyName></PropertyGroup></Project>"
    },
    {
      id: handlerFileId,
      path: "legacy/LegacySettingsSection.vb",
      kind: "CODE",
      updated_at: now,
      source_of_truth: false,
      trust_level: 80,
      status: "active",
      excerpt: "Section handler implementation",
      content: "Public Class LegacySettingsSection\nEnd Class"
    }
  ]);

  writeJsonl(path.join(cacheDir, "entities.rule.jsonl"), []);
  writeJsonl(path.join(cacheDir, "entities.adr.jsonl"), []);
  writeJsonl(path.join(cacheDir, "entities.chunk.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.constrains.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.implements.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.supersedes.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.defines.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.calls.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.imports.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.calls_sql.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.uses_config_key.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.uses_resource.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.uses_setting.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.transforms_config.jsonl"), []);
  writeJsonl(path.join(cacheDir, "relations.uses_config.jsonl"), [
    { from: webConfigId, to: machineConfigId, note: "inherits:machine" },
    { from: webConfigId, to: projectFileId, note: "section_handler:legacysettings" },
    { from: webConfigId, to: handlerFileId, note: "section_handler:legacysettings" }
  ]);

  return {
    fixtureRoot,
    webConfigId,
    machineConfigId,
    projectFileId,
    handlerFileId
  };
}

async function withClient(fn, options = {}) {
  const mergedEnv = {
    ...process.env,
    ...(options.env ?? {})
  };

  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/server.js"],
    cwd: MCP_DIR,
    stderr: "pipe",
    env: mergedEnv
  });

  const client = new Client({ name: "cortex-test-client", version: "0.1.0" });
  await client.connect(transport);
  try {
    await fn(client);
  } finally {
    await client.close();
  }
}

test("context.get_rules accepts missing arguments", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "context.get_rules" });
    assert.notEqual(result.isError, true);
    assert.ok(result.structuredContent);
    assert.ok(Array.isArray(result.structuredContent.rules));
  });
});

test("context.search returns unified entity types", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "context.search",
      arguments: { query: "rule.source_of_truth", top_k: 10 }
    });
    assert.notEqual(result.isError, true);
    assert.ok(result.structuredContent);
    assert.ok(Array.isArray(result.structuredContent.results));
    const types = new Set(result.structuredContent.results.map((item) => item.entity_type));
    assert.ok(types.has("Rule"));
  });
});

test("context.search filters out zero-relevance noise", async () => {
  const { fixtureRoot } = buildWindowChunkSearchFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.search",
          arguments: { query: "zzzxxyyqqqnonexistingterm", top_k: 10 }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.ok(Array.isArray(result.structuredContent.results));
        assert.equal(result.structuredContent.results.length, 0);
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.search applies the minimal response preset", async () => {
  const { fixtureRoot, baseChunkId } = buildWindowChunkSearchFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.search",
          arguments: { query: "windowtailonlytokenzqv993", top_k: 10, response_preset: "minimal" }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.equal(result.structuredContent.response_preset, "minimal");
        assert.equal(result.structuredContent.include_scores, false);
        assert.equal(result.structuredContent.include_matched_rules, false);
        assert.equal(result.structuredContent.include_content, false);

        const baseResult = result.structuredContent.results.find((item) => item.id === baseChunkId);
        assert.ok(baseResult);
        assert.equal("score" in baseResult, false);
        assert.equal("semantic_score" in baseResult, false);
        assert.equal("matched_rules" in baseResult, false);
        assert.equal("content" in baseResult, false);
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.search lets explicit flags override the response preset", async () => {
  const { fixtureRoot, baseChunkId } = buildWindowChunkSearchFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.search",
          arguments: {
            query: "windowtailonlytokenzqv993",
            top_k: 10,
            response_preset: "minimal",
            include_scores: true,
            include_content: true
          }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.equal(result.structuredContent.response_preset, "minimal");
        assert.equal(result.structuredContent.include_scores, true);
        assert.equal(result.structuredContent.include_matched_rules, false);
        assert.equal(result.structuredContent.include_content, true);

        const baseResult = result.structuredContent.results.find((item) => item.id === baseChunkId);
        assert.ok(baseResult);
        assert.ok(baseResult.score > 0);
        assert.ok(String(baseResult.content ?? "").includes("windowtailonlytokenzqv993"));
        assert.equal("matched_rules" in baseResult, false);
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.search collapses overlap window hits back to the base chunk", async () => {
  const { fixtureRoot, baseChunkId, windowChunkId } = buildWindowChunkSearchFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.search",
          arguments: { query: "windowtailonlytokenzqv993", top_k: 10, include_content: true }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.ok(Array.isArray(result.structuredContent.results));

        const ids = result.structuredContent.results.map((item) => String(item.id));
        assert.ok(ids.includes(baseChunkId));
        assert.ok(!ids.includes(windowChunkId));

        const baseResult = result.structuredContent.results.find((item) => item.id === baseChunkId);
        assert.equal(baseResult?.entity_type, "Chunk");
        assert.ok(String(baseResult?.content ?? "").includes("windowtailonlytokenzqv993"));
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.get_related accepts chunk ids returned by context.search", async () => {
  const { fixtureRoot, fileId, baseChunkId } = buildWindowChunkSearchFixture();
  try {
    await withClient(
      async (client) => {
        const searchResult = await client.callTool({
          name: "context.search",
          arguments: { query: "windowtailonlytokenzqv993", top_k: 10 }
        });
        assert.notEqual(searchResult.isError, true);
        assert.ok(searchResult.structuredContent);
        assert.ok(Array.isArray(searchResult.structuredContent.results));

        const chunkResult = searchResult.structuredContent.results.find((item) => item.id === baseChunkId);
        assert.ok(chunkResult);

        const relatedResult = await client.callTool({
          name: "context.get_related",
          arguments: { entity_id: baseChunkId, depth: 1, include_edges: true }
        });
        assert.notEqual(relatedResult.isError, true);
        assert.ok(relatedResult.structuredContent);
        assert.notEqual(relatedResult.structuredContent.warning, "Entity not found in indexed context.");
        assert.ok(Array.isArray(relatedResult.structuredContent.related));
        assert.ok(Array.isArray(relatedResult.structuredContent.edges));

        const relatedIds = relatedResult.structuredContent.related.map((item) => String(item.id));
        assert.ok(relatedIds.includes(fileId));

        const partOfEdge = relatedResult.structuredContent.edges.find(
          (edge) => edge.from === baseChunkId && edge.to === fileId && edge.relation === "PART_OF"
        );
        assert.ok(partOfEdge);
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.reload returns reload metadata", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "context.reload" });
    assert.notEqual(result.isError, true);
    assert.ok(result.structuredContent);
    assert.equal(typeof result.structuredContent.reloaded, "boolean");
    assert.ok(["ryu", "cache"].includes(String(result.structuredContent.context_source)));
  });
});

test("context.get_related links window chunks to the base chunk", async () => {
  const { fixtureRoot, windowChunkId, helperChunkId } = buildWindowChunkSearchFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.get_related",
          arguments: { entity_id: windowChunkId, depth: 1, include_edges: true }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.ok(Array.isArray(result.structuredContent.related));
        assert.ok(Array.isArray(result.structuredContent.edges));

        const relatedIds = result.structuredContent.related.map((item) => String(item.id));
        assert.ok(relatedIds.includes("chunk:src/large.ts:LargeChunk:10-329"));
        assert.ok(!relatedIds.includes(helperChunkId));

        const partOfEdge = result.structuredContent.edges.find(
          (edge) =>
            edge.from === windowChunkId &&
            edge.to === "chunk:src/large.ts:LargeChunk:10-329" &&
            edge.relation === "PART_OF"
        );
        assert.ok(partOfEdge);
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.get_related reaches base chunk relations from a window chunk", async () => {
  const { fixtureRoot, windowChunkId, helperChunkId } = buildWindowChunkSearchFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.get_related",
          arguments: { entity_id: windowChunkId, depth: 2, include_edges: true }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.ok(Array.isArray(result.structuredContent.related));
        assert.ok(Array.isArray(result.structuredContent.edges));

        const relatedIds = result.structuredContent.related.map((item) => String(item.id));
        assert.ok(relatedIds.includes(helperChunkId));

        const callEdge = result.structuredContent.edges.find(
          (edge) =>
            edge.from === "chunk:src/large.ts:LargeChunk:10-329" &&
            edge.to === helperChunkId &&
            edge.relation === "CALLS"
        );
        assert.ok(callEdge);
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.get_related applies the minimal response preset", async () => {
  const { fixtureRoot, windowChunkId } = buildWindowChunkSearchFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.get_related",
          arguments: { entity_id: windowChunkId, depth: 2, response_preset: "minimal" }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.equal(result.structuredContent.response_preset, "minimal");
        assert.equal(result.structuredContent.include_edges, false);
        assert.equal(result.structuredContent.include_entity_metadata, false);
        assert.deepEqual(result.structuredContent.edges, []);
        assert.ok(Array.isArray(result.structuredContent.related));
        assert.ok(result.structuredContent.related.length > 0);
        const firstRelated = result.structuredContent.related[0];
        assert.equal("status" in firstRelated, false);
        assert.equal("source_of_truth" in firstRelated, false);
        assert.equal(typeof firstRelated.label, "string");
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.get_related lets explicit flags override the response preset", async () => {
  const { fixtureRoot, windowChunkId } = buildWindowChunkSearchFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.get_related",
          arguments: {
            entity_id: windowChunkId,
            depth: 2,
            response_preset: "minimal",
            include_edges: true,
            include_entity_metadata: true
          }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.equal(result.structuredContent.response_preset, "minimal");
        assert.equal(result.structuredContent.include_edges, true);
        assert.equal(result.structuredContent.include_entity_metadata, true);
        assert.ok(Array.isArray(result.structuredContent.edges));
        assert.ok(result.structuredContent.edges.length > 0);
        assert.ok(Array.isArray(result.structuredContent.related));
        assert.ok(result.structuredContent.related.length > 0);
        const firstRelated = result.structuredContent.related[0];
        assert.equal("status" in firstRelated, true);
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.search prioritizes structured config chunks for legacy data-access queries", async () => {
  const { fixtureRoot, configChunkId, databaseTargetChunkId } = buildLegacyDataAccessSearchFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.search",
          arguments: { query: "legacydb connection string", top_k: 5 }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.ok(Array.isArray(result.structuredContent.results));
        assert.equal(result.structuredContent.results[0]?.id, configChunkId);
        assert.equal(result.structuredContent.results[0]?.entity_type, "Chunk");
        assert.equal(result.structuredContent.results[0]?.kind, "connection_string");

        const databaseResult = await client.callTool({
          name: "context.search",
          arguments: { query: "legacy database server", top_k: 5 }
        });
        assert.notEqual(databaseResult.isError, true);
        assert.ok(databaseResult.structuredContent);
        assert.ok(Array.isArray(databaseResult.structuredContent.results));
        const topResultIds = databaseResult.structuredContent.results
          .slice(0, 3)
          .map((item) => item?.id);
        assert.ok(topResultIds.includes(databaseTargetChunkId));
        assert.ok(
          databaseResult.structuredContent.results.some(
            (item) => item?.id === databaseTargetChunkId && item?.kind === "database_target"
          )
        );

        const providerResult = await client.callTool({
          name: "context.search",
          arguments: { query: "sqlclient provider legacy database", top_k: 5 }
        });
        assert.notEqual(providerResult.isError, true);
        assert.ok(providerResult.structuredContent);
        assert.ok(Array.isArray(providerResult.structuredContent.results));
        const providerTopIds = providerResult.structuredContent.results
          .slice(0, 3)
          .map((item) => item?.id);
        assert.ok(providerTopIds.includes(databaseTargetChunkId));
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.get_related exposes config-key links to database targets", async () => {
  const { fixtureRoot, codeFileId, configChunkId, databaseTargetChunkId } =
    buildLegacyDataAccessSearchFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.get_related",
          arguments: { entity_id: codeFileId, depth: 1, include_edges: true }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.ok(Array.isArray(result.structuredContent.related));
        assert.ok(Array.isArray(result.structuredContent.edges));

        const relatedIds = result.structuredContent.related.map((item) => item?.id);
        assert.ok(relatedIds.includes(configChunkId));
        assert.ok(relatedIds.includes(databaseTargetChunkId));

        const configEdge = result.structuredContent.edges.find(
          (edge) =>
            edge.from === codeFileId &&
            edge.to === configChunkId &&
            edge.relation === "USES_CONFIG_KEY"
        );
        const databaseEdge = result.structuredContent.edges.find(
          (edge) =>
            edge.from === codeFileId &&
            edge.to === databaseTargetChunkId &&
            edge.relation === "USES_CONFIG_KEY"
        );
        assert.ok(configEdge);
        assert.ok(databaseEdge);
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.get_related links config transforms to their base config", async () => {
  const { fixtureRoot, baseConfigId, baseConfigChunkId, transformConfigId } = buildConfigTransformFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.get_related",
          arguments: { entity_id: transformConfigId, depth: 1, include_edges: true }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.ok(Array.isArray(result.structuredContent.related));
        assert.ok(Array.isArray(result.structuredContent.edges));

        const relatedIds = result.structuredContent.related.map((item) => item?.id);
        assert.ok(relatedIds.includes(baseConfigId));
        assert.ok(relatedIds.includes(baseConfigChunkId));

        const transformEdge = result.structuredContent.edges.find(
          (edge) =>
            edge.from === transformConfigId &&
            edge.to === baseConfigId &&
            edge.relation === "TRANSFORMS_CONFIG" &&
            edge.note === "release"
        );
        const keyEdge = result.structuredContent.edges.find(
          (edge) =>
            edge.from === transformConfigId &&
            edge.to === baseConfigChunkId &&
            edge.relation === "USES_CONFIG_KEY" &&
            edge.note === "legacydb:release"
        );
        assert.ok(transformEdge);
        assert.ok(keyEdge);
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.search surfaces release transforms for config override queries", async () => {
  const { fixtureRoot, transformConfigId } = buildConfigTransformFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.search",
          arguments: { query: "release legacydb transform", top_k: 5 }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.ok(Array.isArray(result.structuredContent.results));

        const topResultIds = result.structuredContent.results
          .slice(0, 3)
          .map((item) => item?.id);
        assert.ok(topResultIds.includes(transformConfigId));
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.search includes affected base config chunks for release impact queries", async () => {
  const { fixtureRoot, transformConfigId, baseConfigChunkId } = buildConfigTransformFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.search",
          arguments: { query: "what changes affect legacydb in release", top_k: 5 }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.ok(Array.isArray(result.structuredContent.results));

        const topResultIds = result.structuredContent.results
          .slice(0, 5)
          .map((item) => item?.id);
        assert.ok(topResultIds.includes(transformConfigId));
        assert.ok(topResultIds.includes(baseConfigChunkId));
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.impact resolves a release query into config impact paths", async () => {
  const { fixtureRoot, transformConfigId, baseConfigChunkId } = buildConfigTransformFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.impact",
          arguments: { query: "what changes affect legacydb in release", depth: 2, top_k: 5 }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.equal(result.structuredContent.resolved_seed_id, transformConfigId);
        assert.equal(result.structuredContent.resolved_from_query, true);
        assert.ok(Array.isArray(result.structuredContent.results));

        const resultIds = result.structuredContent.results.map((item) => item?.id);
        assert.ok(resultIds.includes(baseConfigChunkId));

        const impactHit = result.structuredContent.results.find((item) => item?.id === baseConfigChunkId);
        assert.ok(impactHit);
        assert.ok(impactHit.impact_score > 0);
        assert.equal(typeof impactHit.why, "string");
        assert.ok(impactHit.why.toLowerCase().includes("connection_string.legacydb"));
        assert.ok(impactHit.why.includes("uses config key"));
        assert.ok(impactHit.why.includes("legacydb:release"));
        assert.equal(Array.isArray(impactHit.path_entities), true);
        assert.equal(Array.isArray(impactHit.path_edges), true);
        assert.ok(impactHit.path_entities.includes(transformConfigId));
        assert.ok(impactHit.path_entities.includes(baseConfigChunkId));
        assert.ok(
          impactHit.path_edges.some((edge) => edge?.relation === "USES_CONFIG_KEY")
        );
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.impact follows config-key edges from a transform file seed", async () => {
  const { fixtureRoot, transformConfigId, baseConfigChunkId, baseConfigId } = buildConfigTransformFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.impact",
          arguments: { entity_id: transformConfigId, depth: 2, top_k: 5, include_edges: true }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.equal(result.structuredContent.resolved_seed_id, transformConfigId);
        assert.equal(result.structuredContent.resolved_from_query, false);
        assert.ok(Array.isArray(result.structuredContent.results));
        assert.ok(Array.isArray(result.structuredContent.edges));

        const resultIds = result.structuredContent.results.map((item) => item?.id);
        assert.ok(resultIds.includes(baseConfigId));
        assert.ok(resultIds.includes(baseConfigChunkId));

        const keyEdge = result.structuredContent.edges.find(
          (edge) =>
            edge.from === transformConfigId &&
            edge.to === baseConfigChunkId &&
            edge.relation === "USES_CONFIG_KEY"
        );
        assert.ok(keyEdge);

        const impactHit = result.structuredContent.results.find((item) => item?.id === baseConfigChunkId);
        assert.ok(impactHit);
        assert.deepEqual(impactHit.path_entities, [transformConfigId, baseConfigChunkId]);
        assert.ok(
          Array.isArray(impactHit.path_edges) &&
            impactHit.path_edges.some((edge) => edge?.relation === "USES_CONFIG_KEY")
        );
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.impact supports config_only profile", async () => {
  const { fixtureRoot, transformConfigId, baseConfigChunkId, baseConfigId } = buildConfigTransformFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.impact",
          arguments: {
            entity_id: transformConfigId,
            depth: 2,
            top_k: 5,
            profile: "config_only",
            include_edges: true
          }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.equal(result.structuredContent.profile, "config_only");
        assert.ok(Array.isArray(result.structuredContent.relation_types));
        assert.ok(result.structuredContent.relation_types.includes("USES_CONFIG_KEY"));
        assert.ok(result.structuredContent.relation_types.includes("TRANSFORMS_CONFIG"));

        const resultIds = result.structuredContent.results.map((item) => item?.id);
        assert.ok(resultIds.includes(baseConfigId));
        assert.ok(resultIds.includes(baseConfigChunkId));
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.impact supports explicit relation type filtering", async () => {
  const { fixtureRoot, transformConfigId, baseConfigId, baseConfigChunkId } = buildConfigTransformFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.impact",
          arguments: {
            entity_id: transformConfigId,
            depth: 2,
            top_k: 5,
            relation_types: ["TRANSFORMS_CONFIG"],
            include_edges: true
          }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.deepEqual(result.structuredContent.relation_types, ["TRANSFORMS_CONFIG"]);

        const resultIds = result.structuredContent.results.map((item) => item?.id);
        assert.ok(resultIds.includes(baseConfigId));
        assert.ok(!resultIds.includes(baseConfigChunkId));

        const edgeRelations = result.structuredContent.edges.map((edge) => edge?.relation);
        assert.deepEqual([...new Set(edgeRelations)], ["TRANSFORMS_CONFIG"]);
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.impact prioritizes SQL endpoints for config_to_sql profile", async () => {
  const { fixtureRoot, codeFileId, settingChunkId, sqlChunkId } = buildConfigToSqlImpactFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.impact",
          arguments: {
            entity_id: codeFileId,
            depth: 3,
            top_k: 1,
            profile: "config_to_sql",
            include_edges: true
          }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.equal(result.structuredContent.profile, "config_to_sql");
        assert.equal(result.structuredContent.results[0]?.id, sqlChunkId);
        assert.ok(result.structuredContent.results[0]?.impact_score > 0);
        assert.ok(result.structuredContent.results[0]?.profile_score > 0);
        assert.ok(result.structuredContent.results[0]?.impact_domains.includes("sql"));
        assert.equal(typeof result.structuredContent.results[0]?.why, "string");
        assert.ok(result.structuredContent.results[0]?.why.includes("uses setting key"));
        assert.ok(result.structuredContent.results[0]?.why.includes("calls sql"));
        assert.ok(result.structuredContent.results[0]?.why.includes("usp_runreport"));
        assert.deepEqual(result.structuredContent.results[0]?.path_entities, [
          codeFileId,
          settingChunkId,
          sqlChunkId
        ]);
        assert.deepEqual(result.structuredContent.results[0]?.path_relation_types, [
          "USES_SETTING_KEY",
          "CALLS_SQL"
        ]);
        assert.ok(
          result.structuredContent.edges.some(
            (edge) =>
              edge.from === codeFileId &&
              edge.to === settingChunkId &&
              edge.relation === "USES_SETTING_KEY"
          )
        );
        assert.ok(
          result.structuredContent.edges.some(
            (edge) =>
              edge.from === settingChunkId &&
              edge.to === sqlChunkId &&
              edge.relation === "CALLS_SQL"
          )
        );
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.impact uses transform path notes in scoring", async () => {
  const { fixtureRoot, transformConfigId, baseConfigChunkId } = buildConfigTransformFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.impact",
          arguments: {
            entity_id: transformConfigId,
            query: "legacydb:release",
            depth: 2,
            top_k: 5,
            result_entity_types: ["Chunk"]
          }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        const impactHit = result.structuredContent.results.find((item) => item?.id === baseConfigChunkId);
        assert.ok(impactHit);
        assert.ok(impactHit.note_score > 0);
        assert.ok(impactHit.why.includes("legacydb:release"));
        assert.equal(Array.isArray(impactHit.top_reasons), true);
        assert.ok(
          impactHit.top_reasons.some((reason) => String(reason).includes("note match"))
        );
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.impact uses SQL path notes in scoring", async () => {
  const { fixtureRoot, codeFileId, sqlChunkId } = buildConfigToSqlImpactFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.impact",
          arguments: {
            entity_id: codeFileId,
            query: "usp_runreport",
            depth: 3,
            top_k: 5,
            profile: "config_to_sql",
            result_domains: ["sql"],
            result_entity_types: ["Chunk"]
          }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.equal(result.structuredContent.results[0]?.id, sqlChunkId);
        assert.ok(result.structuredContent.results[0]?.note_score > 0);
        assert.ok(result.structuredContent.results[0]?.why.includes("usp_runreport"));
        assert.equal(Array.isArray(result.structuredContent.results[0]?.top_reasons), true);
        assert.ok(
          result.structuredContent.results[0]?.top_reasons.some((reason) =>
            String(reason).includes("profile boost: config_to_sql")
          )
        );
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.impact filters results to requested SQL domains", async () => {
  const { fixtureRoot, codeFileId, sqlChunkId } = buildConfigToSqlImpactFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.impact",
          arguments: {
            entity_id: codeFileId,
            depth: 3,
            top_k: 5,
            profile: "config_to_sql",
            result_domains: ["sql"]
          }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.deepEqual(result.structuredContent.result_domains, ["sql"]);
        assert.ok(Array.isArray(result.structuredContent.results));
        assert.ok(result.structuredContent.results.length >= 1);
        assert.equal(result.structuredContent.results[0]?.id, sqlChunkId);
        assert.ok(
          result.structuredContent.results.some((item) => item?.id === sqlChunkId)
        );
        assert.ok(
          result.structuredContent.results.every((item) => item?.impact_domains.includes("sql"))
        );
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.impact filters results to requested config domains", async () => {
  const { fixtureRoot, transformConfigId, baseConfigId, baseConfigChunkId } = buildConfigTransformFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.impact",
          arguments: {
            entity_id: transformConfigId,
            depth: 2,
            top_k: 5,
            profile: "all",
            result_domains: ["config"]
          }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.deepEqual(result.structuredContent.result_domains, ["config"]);
        assert.ok(Array.isArray(result.structuredContent.results));

        const resultIds = result.structuredContent.results.map((item) => item?.id);
        assert.ok(resultIds.includes(baseConfigId));
        assert.ok(resultIds.includes(baseConfigChunkId));
        assert.ok(
          result.structuredContent.results.every((item) => item?.impact_domains.includes("config"))
        );
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.impact filters SQL impact results to chunk entities", async () => {
  const { fixtureRoot, codeFileId, sqlChunkId } = buildConfigToSqlImpactFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.impact",
          arguments: {
            entity_id: codeFileId,
            depth: 3,
            top_k: 5,
            profile: "config_to_sql",
            result_domains: ["sql"],
            result_entity_types: ["Chunk"]
          }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.deepEqual(result.structuredContent.result_domains, ["sql"]);
        assert.deepEqual(result.structuredContent.result_entity_types, ["Chunk"]);
        assert.ok(Array.isArray(result.structuredContent.results));
        assert.equal(result.structuredContent.results.length, 1);
        assert.equal(result.structuredContent.results[0]?.id, sqlChunkId);
        assert.equal(result.structuredContent.results[0]?.entity_type, "Chunk");
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.impact filters config impact results to chunk entities", async () => {
  const { fixtureRoot, transformConfigId, baseConfigId, baseConfigChunkId } = buildConfigTransformFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.impact",
          arguments: {
            entity_id: transformConfigId,
            depth: 2,
            top_k: 5,
            result_domains: ["config"],
            result_entity_types: ["Chunk"]
          }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.deepEqual(result.structuredContent.result_domains, ["config"]);
        assert.deepEqual(result.structuredContent.result_entity_types, ["Chunk"]);
        assert.ok(Array.isArray(result.structuredContent.results));

        const resultIds = result.structuredContent.results.map((item) => item?.id);
        assert.ok(!resultIds.includes(baseConfigId));
        assert.ok(resultIds.includes(baseConfigChunkId));
        assert.ok(
          result.structuredContent.results.every((item) => item?.entity_type === "Chunk")
        );
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.impact defaults to impact_score sorting", async () => {
  const { fixtureRoot, codeFileId, nearChunkId, farChunkId } = buildImpactSortingFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.impact",
          arguments: {
            entity_id: codeFileId,
            depth: 3,
            top_k: 2,
            result_entity_types: ["Chunk"]
          }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.equal(result.structuredContent.sort_by, "impact_score");
        assert.deepEqual(result.structuredContent.result_entity_types, ["Chunk"]);
        assert.deepEqual(
          result.structuredContent.results.map((item) => item?.id),
          [farChunkId, nearChunkId]
        );
        assert.ok(result.structuredContent.results[0]?.impact_score > result.structuredContent.results[1]?.impact_score);
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.impact supports shortest_path sorting", async () => {
  const { fixtureRoot, codeFileId, nearChunkId, farChunkId } = buildImpactSortingFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.impact",
          arguments: {
            entity_id: codeFileId,
            depth: 3,
            top_k: 2,
            sort_by: "shortest_path",
            result_entity_types: ["Chunk"]
          }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.equal(result.structuredContent.sort_by, "shortest_path");
        assert.deepEqual(
          result.structuredContent.results.map((item) => item?.id),
          [nearChunkId, farChunkId]
        );
        assert.ok(result.structuredContent.results[0]?.hops < result.structuredContent.results[1]?.hops);
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.impact filters results by required CALLS_SQL path segments", async () => {
  const { fixtureRoot, codeFileId, sqlChunkId } = buildConfigToSqlImpactFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.impact",
          arguments: {
            entity_id: codeFileId,
            depth: 3,
            top_k: 5,
            path_must_include: ["CALLS_SQL"],
            result_entity_types: ["Chunk"]
          }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.deepEqual(result.structuredContent.path_must_include, ["CALLS_SQL"]);
        assert.ok(Array.isArray(result.structuredContent.results));
        assert.equal(result.structuredContent.results.length, 1);
        assert.equal(result.structuredContent.results[0]?.id, sqlChunkId);
        assert.ok(
          result.structuredContent.results[0]?.path_relation_types.includes("CALLS_SQL")
        );
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.impact filters results by required TRANSFORMS_CONFIG path segments", async () => {
  const { fixtureRoot, transformConfigId, baseConfigId } = buildConfigTransformFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.impact",
          arguments: {
            entity_id: transformConfigId,
            depth: 2,
            top_k: 5,
            path_must_include: ["TRANSFORMS_CONFIG"],
            result_entity_types: ["File"]
          }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.deepEqual(result.structuredContent.path_must_include, ["TRANSFORMS_CONFIG"]);
        assert.ok(Array.isArray(result.structuredContent.results));
        assert.equal(result.structuredContent.results.length, 1);
        assert.equal(result.structuredContent.results[0]?.id, baseConfigId);
        assert.ok(
          result.structuredContent.results[0]?.path_relation_types.includes("TRANSFORMS_CONFIG")
        );
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.impact excludes results with blocked CALLS_SQL path segments", async () => {
  const { fixtureRoot, codeFileId, settingChunkId, sqlChunkId } = buildConfigToSqlImpactFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.impact",
          arguments: {
            entity_id: codeFileId,
            depth: 3,
            top_k: 5,
            path_must_exclude: ["CALLS_SQL"],
            result_entity_types: ["Chunk"]
          }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.deepEqual(result.structuredContent.path_must_exclude, ["CALLS_SQL"]);
        assert.ok(Array.isArray(result.structuredContent.results));

        const resultIds = result.structuredContent.results.map((item) => item?.id);
        assert.ok(resultIds.includes(settingChunkId));
        assert.ok(!resultIds.includes(sqlChunkId));
        assert.ok(
          result.structuredContent.results.every(
            (item) => !item?.path_relation_types.includes("CALLS_SQL")
          )
        );
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.impact excludes results with blocked TRANSFORMS_CONFIG path segments", async () => {
  const { fixtureRoot, transformConfigId, baseConfigChunkId, baseConfigId } = buildConfigTransformFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.impact",
          arguments: {
            entity_id: transformConfigId,
            depth: 2,
            top_k: 5,
            path_must_exclude: ["TRANSFORMS_CONFIG"]
          }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.deepEqual(result.structuredContent.path_must_exclude, ["TRANSFORMS_CONFIG"]);
        assert.ok(Array.isArray(result.structuredContent.results));

        const resultIds = result.structuredContent.results.map((item) => item?.id);
        assert.ok(resultIds.includes(baseConfigChunkId));
        assert.ok(!resultIds.includes(baseConfigId));
        assert.ok(
          result.structuredContent.results.every(
            (item) => !item?.path_relation_types.includes("TRANSFORMS_CONFIG")
          )
        );
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.impact returns compact path summaries for longer paths", async () => {
  const { fixtureRoot, seedFileId, targetFileId } = buildLongImpactPathFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.impact",
          arguments: {
            entity_id: seedFileId,
            depth: 4,
            top_k: 10,
            result_entity_types: ["File"]
          }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        const impactHit = result.structuredContent.results.find((item) => item?.id === targetFileId);
        assert.ok(impactHit);
        assert.equal(typeof impactHit.path_summary, "string");
        assert.equal(typeof impactHit.path_summary_compact, "string");
        assert.ok(impactHit.path_summary.includes("ResolveFeatureToggle"));
        assert.ok(impactHit.path_summary.includes("procedure.usp_heavyreport"));
        assert.ok(impactHit.path_summary_compact.includes("... 2 more hops ..."));
        assert.ok(impactHit.path_summary_compact.toLowerCase().includes("app_setting.featuretoggle"));
        assert.ok(impactHit.path_summary_compact.includes("db/reporting.sql"));
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.impact suppresses verbose path payloads when verbose_paths is false", async () => {
  const { fixtureRoot, seedFileId, targetFileId } = buildLongImpactPathFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.impact",
          arguments: {
            entity_id: seedFileId,
            depth: 4,
            top_k: 10,
            include_edges: true,
            verbose_paths: false,
            result_entity_types: ["File"]
          }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.equal(result.structuredContent.verbose_paths, false);
        assert.deepEqual(result.structuredContent.edges, []);

        const impactHit = result.structuredContent.results.find((item) => item?.id === targetFileId);
        assert.ok(impactHit);
        assert.equal(typeof impactHit.path_summary, "string");
        assert.equal(typeof impactHit.path_summary_compact, "string");
        assert.equal("path_entities" in impactHit, false);
        assert.equal("path_edges" in impactHit, false);
        assert.ok(Array.isArray(impactHit.path_relation_types));
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.impact respects max_path_hops_shown in compact summaries", async () => {
  const { fixtureRoot, seedFileId, targetFileId } = buildLongImpactPathFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.impact",
          arguments: {
            entity_id: seedFileId,
            depth: 4,
            top_k: 10,
            max_path_hops_shown: 3,
            result_entity_types: ["File"]
          }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.equal(result.structuredContent.max_path_hops_shown, 3);

        const impactHit = result.structuredContent.results.find((item) => item?.id === targetFileId);
        assert.ok(impactHit);
        assert.equal(typeof impactHit.path_summary_compact, "string");
        assert.ok(impactHit.path_summary_compact.includes("... 1 more hop ..."));
        assert.ok(impactHit.path_summary_compact.includes("ResolveFeatureToggle"));
        assert.ok(impactHit.path_summary_compact.includes("db/reporting.sql"));
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.impact suppresses numeric score fields when include_scores is false", async () => {
  const { fixtureRoot, codeFileId, sqlChunkId } = buildConfigToSqlImpactFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.impact",
          arguments: {
            entity_id: codeFileId,
            depth: 3,
            top_k: 5,
            profile: "config_to_sql",
            include_scores: false,
            result_domains: ["sql"],
            result_entity_types: ["Chunk"]
          }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.equal(result.structuredContent.include_scores, false);

        const impactHit = result.structuredContent.results.find((item) => item?.id === sqlChunkId);
        assert.ok(impactHit);
        assert.equal("impact_score" in impactHit, false);
        assert.equal("profile_score" in impactHit, false);
        assert.equal("note_score" in impactHit, false);
        assert.equal("semantic_score" in impactHit, false);
        assert.equal("graph_score" in impactHit, false);
        assert.equal("trust_score" in impactHit, false);
        assert.equal(typeof impactHit.why, "string");
        assert.equal(Array.isArray(impactHit.top_reasons), true);
        assert.equal(typeof impactHit.path_summary_compact, "string");
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.impact suppresses top_reasons when include_reasons is false", async () => {
  const { fixtureRoot, codeFileId, sqlChunkId } = buildConfigToSqlImpactFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.impact",
          arguments: {
            entity_id: codeFileId,
            depth: 3,
            top_k: 5,
            profile: "config_to_sql",
            include_reasons: false,
            result_domains: ["sql"],
            result_entity_types: ["Chunk"]
          }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.equal(result.structuredContent.include_reasons, false);

        const impactHit = result.structuredContent.results.find((item) => item?.id === sqlChunkId);
        assert.ok(impactHit);
        assert.equal("top_reasons" in impactHit, false);
        assert.equal(typeof impactHit.why, "string");
        assert.equal(typeof impactHit.path_summary_compact, "string");
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.impact applies the minimal response preset", async () => {
  const { fixtureRoot, seedFileId, targetFileId } = buildLongImpactPathFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.impact",
          arguments: {
            entity_id: seedFileId,
            depth: 4,
            top_k: 10,
            include_edges: true,
            response_preset: "minimal",
            result_entity_types: ["File"]
          }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.equal(result.structuredContent.response_preset, "minimal");
        assert.equal(result.structuredContent.include_scores, false);
        assert.equal(result.structuredContent.include_reasons, false);
        assert.equal(result.structuredContent.verbose_paths, false);
        assert.equal(result.structuredContent.max_path_hops_shown, 1);
        assert.deepEqual(result.structuredContent.edges, []);

        const impactHit = result.structuredContent.results.find((item) => item?.id === targetFileId);
        assert.ok(impactHit);
        assert.equal("impact_score" in impactHit, false);
        assert.equal("top_reasons" in impactHit, false);
        assert.equal("path_entities" in impactHit, false);
        assert.equal("path_edges" in impactHit, false);
        assert.ok(impactHit.path_summary_compact.includes("... 3 more hops ..."));
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.impact lets explicit flags override the response preset", async () => {
  const { fixtureRoot, codeFileId, sqlChunkId } = buildConfigToSqlImpactFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.impact",
          arguments: {
            entity_id: codeFileId,
            depth: 3,
            top_k: 5,
            profile: "config_to_sql",
            response_preset: "minimal",
            include_reasons: true,
            result_domains: ["sql"],
            result_entity_types: ["Chunk"]
          }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.equal(result.structuredContent.response_preset, "minimal");
        assert.equal(result.structuredContent.include_scores, false);
        assert.equal(result.structuredContent.include_reasons, true);

        const impactHit = result.structuredContent.results.find((item) => item?.id === sqlChunkId);
        assert.ok(impactHit);
        assert.equal("impact_score" in impactHit, false);
        assert.equal(Array.isArray(impactHit.top_reasons), true);
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.get_related links base configs to external config fragments", async () => {
  const { fixtureRoot, baseConfigId, appSettingsConfigId, connectionStringsConfigId } =
    buildConfigIncludeFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.get_related",
          arguments: { entity_id: baseConfigId, depth: 1, include_edges: true }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.ok(Array.isArray(result.structuredContent.related));
        assert.ok(Array.isArray(result.structuredContent.edges));

        const relatedIds = result.structuredContent.related.map((item) => item?.id);
        assert.ok(relatedIds.includes(appSettingsConfigId));
        assert.ok(relatedIds.includes(connectionStringsConfigId));

        const appSettingsEdge = result.structuredContent.edges.find(
          (edge) =>
            edge.from === baseConfigId &&
            edge.to === appSettingsConfigId &&
            edge.relation === "USES_CONFIG" &&
            edge.note === "appsettings:file"
        );
        const connectionStringsEdge = result.structuredContent.edges.find(
          (edge) =>
            edge.from === baseConfigId &&
            edge.to === connectionStringsConfigId &&
            edge.relation === "USES_CONFIG" &&
            edge.note === "connectionstrings:configsource"
        );
        assert.ok(appSettingsEdge);
        assert.ok(connectionStringsEdge);
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("context.get_related links configs to machine config and section handler files", async () => {
  const { fixtureRoot, webConfigId, machineConfigId, projectFileId, handlerFileId } =
    buildConfigHandlerFixture();
  try {
    await withClient(
      async (client) => {
        const result = await client.callTool({
          name: "context.get_related",
          arguments: { entity_id: webConfigId, depth: 1, include_edges: true }
        });
        assert.notEqual(result.isError, true);
        assert.ok(result.structuredContent);
        assert.ok(Array.isArray(result.structuredContent.related));
        assert.ok(Array.isArray(result.structuredContent.edges));

        const relatedIds = result.structuredContent.related.map((item) => item?.id);
        assert.ok(relatedIds.includes(machineConfigId));
        assert.ok(relatedIds.includes(projectFileId));
        assert.ok(relatedIds.includes(handlerFileId));

        const machineEdge = result.structuredContent.edges.find(
          (edge) =>
            edge.from === webConfigId &&
            edge.to === machineConfigId &&
            edge.relation === "USES_CONFIG" &&
            edge.note === "inherits:machine"
        );
        const projectEdge = result.structuredContent.edges.find(
          (edge) =>
            edge.from === webConfigId &&
            edge.to === projectFileId &&
            edge.relation === "USES_CONFIG" &&
            edge.note === "section_handler:legacysettings"
        );
        const handlerEdge = result.structuredContent.edges.find(
          (edge) =>
            edge.from === webConfigId &&
            edge.to === handlerFileId &&
            edge.relation === "USES_CONFIG" &&
            edge.note === "section_handler:legacysettings"
        );
        assert.ok(machineEdge);
        assert.ok(projectEdge);
        assert.ok(handlerEdge);
      },
      {
        env: {
          CORTEX_PROJECT_ROOT: fixtureRoot
        }
      }
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
