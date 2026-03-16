import test from "node:test";
import assert from "node:assert/strict";
import { parseCode } from "../scripts/parsers/sql.mjs";
import { parseCode as parseScaffoldCode } from "../scaffold/scripts/parsers/sql.mjs";

test("sql parser extracts procedures, views, and tables as chunks", () => {
  const source = [
    "CREATE TABLE [dbo].[Users] (Id INT, Name NVARCHAR(100));",
    "",
    "CREATE OR ALTER VIEW dbo.ActiveUsers AS",
    "SELECT u.Id, u.Name FROM dbo.Users u;",
    "",
    "CREATE PROCEDURE [dbo].[GetUsers]",
    "AS",
    "BEGIN",
    "  SELECT * FROM dbo.ActiveUsers;",
    "END"
  ].join("\n");

  const result = parseCode(source, "fixture.sql", "sql");
  const chunkByName = new Map(result.chunks.map((chunk) => [chunk.name, chunk]));

  assert.equal(chunkByName.get("dbo.users")?.kind, "table");
  assert.equal(chunkByName.get("dbo.activeusers")?.kind, "view");
  assert.equal(chunkByName.get("dbo.getusers")?.kind, "procedure");
  assert.ok(chunkByName.get("dbo.getusers")?.calls.includes("dbo.activeusers"));
  assert.ok(chunkByName.get("dbo.activeusers")?.calls.includes("dbo.users"));
});

test("scaffold sql parser extracts function calls and normalizes names", () => {
  const source = [
    "CREATE FUNCTION [sales].[ComputeScore] ()",
    "RETURNS INT",
    "AS",
    "BEGIN",
    "  RETURN 1;",
    "END",
    "",
    "CREATE PROC [sales].[RunReport]",
    "AS",
    "BEGIN",
    "  EXEC [sales].[ComputeScore];",
    "END"
  ].join("\n");

  const result = parseScaffoldCode(source, "fixture.sql", "sql");
  const runReport = result.chunks.find((chunk) => chunk.name === "sales.runreport");

  assert.equal(result.chunks.find((chunk) => chunk.name === "sales.computescore")?.kind, "function");
  assert.deepEqual(runReport?.calls, ["sales.computescore"]);
});
