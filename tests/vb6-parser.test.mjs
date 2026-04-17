import test from "node:test";
import assert from "node:assert/strict";
import { parseCode } from "../scaffold/scripts/parsers/vb6.mjs";

test("vb6 parser extracts a Sub in a .bas module", () => {
  const source = [
    'Attribute VB_Name = "Helpers"',
    "",
    "Public Sub Greet(name As String)",
    "    MsgBox \"hi \" & name",
    "End Sub"
  ].join("\n");

  const result = parseCode(source, "Helpers.bas", "vb6");
  const module = result.chunks.find((c) => c.name === "Helpers");
  const greet = result.chunks.find((c) => c.name === "Helpers.Greet");

  assert.ok(module);
  assert.equal(module.kind, "module");
  assert.ok(greet);
  assert.equal(greet.kind, "function");
  assert.equal(greet.language, "vb6");
  assert.equal(greet.exported, true);
});

test("vb6 parser extracts Function with return type and qualifies by module", () => {
  const source = [
    'Attribute VB_Name = "MathHelpers"',
    "",
    "Public Function Add(a As Long, b As Long) As Long",
    "    Add = a + b",
    "End Function"
  ].join("\n");

  const result = parseCode(source, "MathHelpers.bas", "vb6");
  const add = result.chunks.find((c) => c.name === "MathHelpers.Add");

  assert.ok(add);
  assert.equal(add.kind, "function");
});

test("vb6 parser qualifies class members as ClassName.Method for .cls files", () => {
  const source = [
    "VERSION 1.0 CLASS",
    "BEGIN",
    "  MultiUse = -1  'True",
    "END",
    'Attribute VB_Name = "Customer"',
    'Attribute VB_GlobalNameSpace = False',
    "",
    "Private m_Name As String",
    "",
    "Public Sub SetName(value As String)",
    "    m_Name = value",
    "End Sub",
    "",
    "Public Function GetName() As String",
    "    GetName = m_Name",
    "End Function"
  ].join("\n");

  const result = parseCode(source, "Customer.cls", "vb6");
  const names = new Set(result.chunks.map((c) => c.name));

  assert.ok(names.has("Customer"), "class module chunk");
  assert.ok(names.has("Customer.SetName"));
  assert.ok(names.has("Customer.GetName"));

  const cls = result.chunks.find((c) => c.name === "Customer");
  assert.equal(cls.kind, "class");
  const method = result.chunks.find((c) => c.name === "Customer.SetName");
  assert.equal(method.kind, "method");
});

test("vb6 parser marks Private Sub/Function as not exported", () => {
  const source = [
    'Attribute VB_Name = "Utils"',
    "",
    "Private Sub Internal()",
    "    Debug.Print \"internal\"",
    "End Sub",
    "",
    "Public Sub Api()",
    "    Call Internal",
    "End Sub"
  ].join("\n");

  const result = parseCode(source, "Utils.bas", "vb6");
  const internal = result.chunks.find((c) => c.name === "Utils.Internal");
  const api = result.chunks.find((c) => c.name === "Utils.Api");

  assert.equal(internal.exported, false);
  assert.equal(api.exported, true);
  // Call Internal should produce a call edge
  assert.ok(api.calls.includes("Internal"));
});

test("vb6 parser extracts Property Get/Let/Set as a single property chunk", () => {
  const source = [
    'Attribute VB_Name = "Box"',
    "",
    "Private m_Value As Integer",
    "",
    "Public Property Get Value() As Integer",
    "    Value = m_Value",
    "End Property",
    "",
    "Public Property Let Value(newValue As Integer)",
    "    m_Value = newValue",
    "End Property"
  ].join("\n");

  const result = parseCode(source, "Box.cls", "vb6");
  const props = result.chunks.filter((c) => c.kind === "property");

  assert.equal(props.length, 1, "Property Get + Let should collapse to one chunk");
  assert.equal(props[0].name, "Box.Value");
});

test("vb6 parser extracts Type and Enum declarations", () => {
  const source = [
    'Attribute VB_Name = "Types"',
    "",
    "Public Type Address",
    "    Street As String",
    "    City As String",
    "    Zip As String",
    "End Type",
    "",
    "Public Enum Status",
    "    StatusIdle = 0",
    "    StatusRunning = 1",
    "    StatusError = 2",
    "End Enum"
  ].join("\n");

  const result = parseCode(source, "Types.bas", "vb6");
  const type = result.chunks.find((c) => c.name === "Types.Address");
  const enumChunk = result.chunks.find((c) => c.name === "Types.Status");

  assert.ok(type);
  assert.equal(type.kind, "type");
  assert.ok(enumChunk);
  assert.equal(enumChunk.kind, "enum");
});

test("vb6 parser extracts user-defined calls and filters builtins", () => {
  const source = [
    'Attribute VB_Name = "Runner"',
    "",
    "Public Sub Run()",
    "    ProcessData",
    "    Call HelperFunc(1, 2)",
    "    cache.Update",
    "    MsgBox \"done\"",
    "    Debug.Print Len(\"hi\")",
    "End Sub"
  ].join("\n");

  const result = parseCode(source, "Runner.bas", "vb6");
  const run = result.chunks.find((c) => c.name === "Runner.Run");

  assert.ok(run);
  assert.ok(run.calls.includes("ProcessData"), "method-style bareword call");
  assert.ok(run.calls.includes("HelperFunc"), "Call-keyword invocation");
  assert.ok(run.calls.includes("Update"), "object.method call");
  assert.ok(!run.calls.includes("MsgBox"), "MsgBox builtin should be filtered");
  assert.ok(!run.calls.includes("Len"), "Len builtin should be filtered");
});

test("vb6 parser handles Static Sub modifier", () => {
  const source = [
    'Attribute VB_Name = "Counters"',
    "",
    "Public Static Sub Tick()",
    "    Dim n As Long",
    "    n = n + 1",
    "End Sub"
  ].join("\n");

  const result = parseCode(source, "Counters.bas", "vb6");
  const tick = result.chunks.find((c) => c.name === "Counters.Tick");

  assert.ok(tick);
  assert.equal(tick.exported, true);
});

test("vb6 parser handles a .frm form by stripping designer block", () => {
  const source = [
    "VERSION 5.00",
    "Begin VB.Form frmMain ",
    '   Caption         =   "Main"',
    "   ClientHeight    =   3000",
    "   Begin VB.CommandButton cmdOK ",
    '      Caption         =   "OK"',
    "   End",
    "End",
    'Attribute VB_Name = "frmMain"',
    "",
    "Private Sub cmdOK_Click()",
    "    DoWork",
    "End Sub",
    "",
    "Private Sub Form_Load()",
    "    Init",
    "End Sub"
  ].join("\n");

  const result = parseCode(source, "frmMain.frm", "vb6");
  const names = new Set(result.chunks.map((c) => c.name));

  assert.ok(names.has("frmMain"));
  assert.ok(names.has("frmMain.cmdOK_Click"));
  assert.ok(names.has("frmMain.Form_Load"));
  const form = result.chunks.find((c) => c.name === "frmMain");
  assert.equal(form.kind, "form");
});

test("vb6 parser derives module name from filename when Attribute VB_Name is missing", () => {
  const source = [
    "Public Sub DoStuff()",
    "    MsgBox \"x\"",
    "End Sub"
  ].join("\n");

  const result = parseCode(source, "/tmp/NoAttribute.bas", "vb6");
  const owner = result.chunks.find((c) => c.kind === "module");

  assert.ok(owner);
  assert.equal(owner.name, "NoAttribute");
  const sub = result.chunks.find((c) => c.name === "NoAttribute.DoStuff");
  assert.ok(sub);
});

test("vb6 parser handles Class_Initialize as a regular method", () => {
  const source = [
    "VERSION 1.0 CLASS",
    "BEGIN",
    "  MultiUse = -1",
    "END",
    'Attribute VB_Name = "Svc"',
    "",
    "Private Sub Class_Initialize()",
    "    Setup",
    "End Sub",
    "",
    "Private Sub Class_Terminate()",
    "    Teardown",
    "End Sub"
  ].join("\n");

  const result = parseCode(source, "Svc.cls", "vb6");
  const init = result.chunks.find((c) => c.name === "Svc.Class_Initialize");
  const term = result.chunks.find((c) => c.name === "Svc.Class_Terminate");

  assert.ok(init);
  assert.equal(init.kind, "method");
  assert.ok(term);
});

test("vb6 parser returns empty chunks for unsupported extension", () => {
  const result = parseCode("Public Sub X() End Sub", "foo.txt", "vb6");
  assert.equal(result.chunks.length, 0);
});

test("vb6 parser handles empty input without errors", () => {
  const result = parseCode("", "empty.bas", "vb6");
  assert.deepEqual(result.errors, []);
  // Empty .bas still produces an owner chunk for the module (named after file)
  assert.equal(result.chunks.filter((c) => c.kind !== "module").length, 0);
});
