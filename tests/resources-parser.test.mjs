import test from "node:test";
import assert from "node:assert/strict";
import { parseCode } from "../scaffold/scripts/parsers/resources.mjs";

test("resources parser extracts resx entries and SQL references", () => {
  const source = [
    "<root>",
    '  <data name="ActiveUsersQuery" xml:space="preserve">',
    "    <value>SELECT * FROM dbo.ActiveUsers</value>",
    "  </data>",
    "</root>"
  ].join("\n");

  const result = parseCode(source, "Resources.resx", "resource");
  const chunk = result.chunks[0];

  assert.equal(chunk.name, "resource.activeusersquery");
  assert.equal(chunk.kind, "resource_entry");
  assert.equal(chunk.signature, "resource ActiveUsersQuery");
  assert.deepEqual(chunk.calls, ["dbo.activeusers"]);
});

test("resources parser extracts settings entries", () => {
  const source = [
    "<SettingsFile>",
    "  <Settings>",
    '    <Setting Name="RunReportProc" Type="System.String" Scope="Application">',
    "      <Value Profile=\"(Default)\">reporting.RunReport</Value>",
    "    </Setting>",
    "  </Settings>",
    "</SettingsFile>"
  ].join("\n");

  const result = parseCode(source, "App.settings", "settings");
  const chunk = result.chunks[0];

  assert.equal(chunk.name, "setting.runreportproc");
  assert.equal(chunk.kind, "setting_entry");
  assert.deepEqual(chunk.calls, ["reporting.runreport"]);
});
