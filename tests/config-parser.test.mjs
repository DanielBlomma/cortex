import test from "node:test";
import assert from "node:assert/strict";
import { parseCode } from "../scripts/parsers/config.mjs";
import { parseCode as parseScaffoldCode } from "../scaffold/scripts/parsers/config.mjs";

test("config parser extracts connection strings and app settings as chunks", () => {
  const source = [
    "<configuration>",
    "  <connectionStrings>",
    '    <add name="LegacyDb" connectionString="Data Source=.;Initial Catalog=Legacy;" providerName="System.Data.SqlClient" />',
    "  </connectionStrings>",
    "  <appSettings>",
    '    <add key="FeatureFlag" value="true" />',
    "  </appSettings>",
    "</configuration>"
  ].join("\n");

  const result = parseCode(source, "App.config", "config");
  const chunkByName = new Map(result.chunks.map((chunk) => [chunk.name, chunk]));

  assert.equal(chunkByName.get("connection_string.legacydb")?.kind, "connection_string");
  assert.equal(chunkByName.get("database_target.legacydb")?.kind, "database_target");
  assert.equal(chunkByName.get("app_setting.featureflag")?.kind, "app_setting");
  assert.equal(chunkByName.get("connection_string.legacydb")?.signature, "connection_string LegacyDb");
  assert.equal(chunkByName.get("database_target.legacydb")?.signature, "database_target LegacyDb");
  assert.equal(chunkByName.get("app_setting.featureflag")?.signature, "app_setting FeatureFlag");
  assert.deepEqual(chunkByName.get("connection_string.legacydb")?.calls, ["database_target.legacydb"]);
  assert.match(chunkByName.get("database_target.legacydb")?.description ?? "", /database=Legacy/i);
  assert.match(chunkByName.get("database_target.legacydb")?.description ?? "", /server=\./i);
  assert.match(
    chunkByName.get("database_target.legacydb")?.description ?? "",
    /provider=System\.Data\.SqlClient/i
  );
  assert.match(
    chunkByName.get("connection_string.legacydb")?.description ?? "",
    /provider=System\.Data\.SqlClient/i
  );
});

test("scaffold config parser extracts config entries", () => {
  const source = [
    "<configuration>",
    "  <appSettings>",
    '    <add key="Theme" value="light" />',
    "  </appSettings>",
    "</configuration>"
  ].join("\n");

  const result = parseScaffoldCode(source, "Web.config", "config");
  assert.deepEqual(
    result.chunks.map((chunk) => chunk.name),
    ["app_setting.theme"]
  );
});
