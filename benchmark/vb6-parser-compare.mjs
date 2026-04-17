#!/usr/bin/env node
/**
 * VB6 parser benchmark — file-level baseline vs regex parser.
 *
 * VB6 has no tree-sitter grammar, so the Cortex parser is regex-based.
 * Measured metric is the jump from file-level fallback (each .bas/
 * .cls/.frm/.ctl as one chunk) to structural chunks per Sub/Function
 * /Property/Type/Enum.
 *
 * Usage:
 *   node benchmark/vb6-parser-compare.mjs               # synthetic corpus
 *   node benchmark/vb6-parser-compare.mjs --corpus src
 *   node benchmark/vb6-parser-compare.mjs --output benchmark/vb6-delta.md
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { performance } from "node:perf_hooks";
import { parseCode as parseVb6 } from "../scripts/parsers/vb6.mjs";

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { corpus: null, runs: 3, output: null };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--corpus") opts.corpus = args[++i];
    else if (a === "--runs") opts.runs = Number(args[++i]);
    else if (a === "--output") opts.output = args[++i];
  }
  return opts;
}

function collectVb6Files(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    const entries = readdirSync(cur, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if ([".bas", ".cls", ".frm", ".ctl"].includes(extname(entry.name))) out.push(full);
    }
  }
  return out;
}

const SYNTHETIC_CORPUS = [
  {
    path: "src/MathHelpers.bas",
    content: [
      'Attribute VB_Name = "MathHelpers"',
      "",
      "Option Explicit",
      "",
      "Public Function Add(a As Long, b As Long) As Long",
      "    Add = a + b",
      "End Function",
      "",
      "Public Function Multiply(a As Long, b As Long) As Long",
      "    Multiply = a * b",
      "End Function",
      "",
      "Public Function Clamp(value As Long, lo As Long, hi As Long) As Long",
      "    If value < lo Then",
      "        Clamp = lo",
      "    ElseIf value > hi Then",
      "        Clamp = hi",
      "    Else",
      "        Clamp = value",
      "    End If",
      "End Function",
      "",
      "Private Function _round(value As Double) As Long",
      "    _round = CLng(Int(value + 0.5))",
      "End Function"
    ].join("\n")
  },
  {
    path: "src/Customer.cls",
    content: [
      "VERSION 1.0 CLASS",
      "BEGIN",
      "  MultiUse = -1  'True",
      "END",
      'Attribute VB_Name = "Customer"',
      'Attribute VB_GlobalNameSpace = False',
      'Attribute VB_Creatable = False',
      'Attribute VB_PredeclaredId = False',
      'Attribute VB_Exposed = False',
      "",
      "Private m_Id As Long",
      "Private m_Name As String",
      "",
      "Public Property Get Id() As Long",
      "    Id = m_Id",
      "End Property",
      "",
      "Public Property Let Id(value As Long)",
      "    m_Id = value",
      "End Property",
      "",
      "Public Property Get Name() As String",
      "    Name = m_Name",
      "End Property",
      "",
      "Public Property Let Name(value As String)",
      "    m_Name = value",
      "End Property",
      "",
      "Public Sub Save()",
      "    Call Repository.Persist(Me)",
      "End Sub",
      "",
      "Public Function ToString() As String",
      "    ToString = m_Id & \": \" & m_Name",
      "End Function",
      "",
      "Private Sub Class_Initialize()",
      "    m_Id = 0",
      "    m_Name = \"\"",
      "End Sub"
    ].join("\n")
  },
  {
    path: "src/OrderService.cls",
    content: [
      "VERSION 1.0 CLASS",
      "BEGIN",
      "  MultiUse = -1",
      "END",
      'Attribute VB_Name = "OrderService"',
      "",
      "Private m_Customer As Customer",
      "",
      "Public Sub PlaceOrder(productId As Long, quantity As Long)",
      "    ValidateOrder productId, quantity",
      "    Dim total As Double",
      "    total = CalculateTotal(productId, quantity)",
      "    ProcessPayment total",
      "    Call NotifyCustomer(m_Customer)",
      "End Sub",
      "",
      "Private Sub ValidateOrder(pid As Long, qty As Long)",
      "    If pid <= 0 Then Err.Raise vbObjectError + 100, , \"Invalid product\"",
      "    If qty <= 0 Then Err.Raise vbObjectError + 101, , \"Invalid quantity\"",
      "End Sub",
      "",
      "Private Function CalculateTotal(pid As Long, qty As Long) As Double",
      "    CalculateTotal = Repository.GetPrice(pid) * qty",
      "End Function",
      "",
      "Private Sub ProcessPayment(total As Double)",
      "    PaymentGateway.Charge m_Customer.Id, total",
      "End Sub",
      "",
      "Private Sub NotifyCustomer(c As Customer)",
      "    EmailSender.Send c.Name, \"Order confirmed\"",
      "End Sub"
    ].join("\n")
  },
  {
    path: "src/Types.bas",
    content: [
      'Attribute VB_Name = "Types"',
      "",
      "Public Type Address",
      "    Street As String",
      "    City As String",
      "    Zip As String",
      "End Type",
      "",
      "Public Type Product",
      "    Id As Long",
      "    Name As String",
      "    Price As Double",
      "End Type",
      "",
      "Public Enum OrderStatus",
      "    StatusPending = 0",
      "    StatusConfirmed = 1",
      "    StatusShipped = 2",
      "    StatusDelivered = 3",
      "    StatusCancelled = 4",
      "End Enum"
    ].join("\n")
  },
  {
    path: "src/frmMain.frm",
    content: [
      "VERSION 5.00",
      "Begin VB.Form frmMain ",
      '   Caption         =   "Main"',
      "   ClientHeight    =   3000",
      "   ClientWidth     =   4000",
      "   Begin VB.CommandButton cmdOK ",
      '      Caption         =   "OK"',
      "      Left            =   100",
      "      Top             =   100",
      "   End",
      "   Begin VB.CommandButton cmdCancel ",
      '      Caption         =   "Cancel"',
      "      Left            =   200",
      "      Top             =   100",
      "   End",
      "End",
      'Attribute VB_Name = "frmMain"',
      "",
      "Private Sub cmdOK_Click()",
      "    Call SaveChanges",
      "    Unload Me",
      "End Sub",
      "",
      "Private Sub cmdCancel_Click()",
      "    Unload Me",
      "End Sub",
      "",
      "Private Sub Form_Load()",
      "    Me.Caption = \"Main Form\"",
      "    LoadDefaults",
      "End Sub",
      "",
      "Private Sub SaveChanges()",
      "    DataManager.Save",
      "End Sub",
      "",
      "Private Sub LoadDefaults()",
      "    DataManager.Load",
      "End Sub"
    ].join("\n")
  }
];

function loadCorpus(corpusDir) {
  if (!corpusDir) {
    return SYNTHETIC_CORPUS.map((entry) => ({
      path: entry.path,
      content: entry.content,
      bytes: Buffer.byteLength(entry.content, "utf8")
    }));
  }
  const files = collectVb6Files(corpusDir);
  return files.map((filePath) => {
    const content = readFileSync(filePath, "utf8");
    return { path: filePath, content, bytes: Buffer.byteLength(content, "utf8") };
  });
}

function baselineFileChunks(corpus) {
  return corpus.map((file) => ({
    name: file.path,
    kind: "file",
    language: "vb6",
    calls: [],
    imports: []
  }));
}

function summarize(chunks) {
  const kindCounts = Object.create(null);
  const allCalls = new Set();
  for (const chunk of chunks) {
    kindCounts[chunk.kind] = (kindCounts[chunk.kind] ?? 0) + 1;
    for (const call of chunk.calls ?? []) allCalls.add(`${chunk.name}->${call}`);
  }
  return {
    chunks: chunks.length,
    kindCounts,
    uniqueCallEdges: allCalls.size
  };
}

function timeParser(corpus, runs) {
  const timings = [];
  let lastChunks = [];
  for (let run = 0; run < runs; run += 1) {
    const t0 = performance.now();
    const allChunks = [];
    for (const file of corpus) {
      const result = parseVb6(file.content, file.path, "vb6");
      allChunks.push(...result.chunks);
    }
    timings.push(performance.now() - t0);
    if (run === runs - 1) lastChunks = allChunks;
  }
  timings.sort((a, b) => a - b);
  return {
    medianMs: timings[Math.floor(timings.length / 2)],
    p95Ms: timings[Math.min(timings.length - 1, Math.floor(timings.length * 0.95))],
    chunks: lastChunks
  };
}

function formatKindCounts(base, tsCounts) {
  const kinds = new Set([...Object.keys(base), ...Object.keys(tsCounts)]);
  return [...kinds].sort().map((k) => {
    const a = Object.hasOwn(base, k) ? base[k] : 0;
    const b = Object.hasOwn(tsCounts, k) ? tsCounts[k] : 0;
    const delta = b - a;
    const arrow = delta > 0 ? "+" : "";
    return `| ${k} | ${a} | ${b} | ${arrow}${delta} |`;
  }).join("\n");
}

function renderReport({ corpusInfo, baseline, parsed }) {
  const bSum = summarize(baseline);
  const pSum = summarize(parsed.chunks);
  const ratio = bSum.chunks > 0 ? (pSum.chunks / bSum.chunks).toFixed(1) : "∞";

  return [
    "# VB6 parser benchmark — file-level baseline vs regex parser",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Corpus: ${corpusInfo.source} — ${corpusInfo.fileCount} files, ${corpusInfo.totalBytes} bytes`,
    `Runs: ${corpusInfo.runs}`,
    "",
    "## Summary",
    "",
    "| Metric | baseline (file-level) | vb6 regex | Δ |",
    "|---|---:|---:|---:|",
    `| Chunks extracted | ${bSum.chunks} | ${pSum.chunks} | ${pSum.chunks - bSum.chunks >= 0 ? "+" : ""}${pSum.chunks - bSum.chunks} (${ratio}×) |`,
    `| Unique call edges | ${bSum.uniqueCallEdges} | ${pSum.uniqueCallEdges} | +${pSum.uniqueCallEdges} |`,
    `| Median parse time (ms) | n/a | ${parsed.medianMs.toFixed(2)} | — |`,
    `| p95 parse time (ms) | n/a | ${parsed.p95Ms.toFixed(2)} | — |`,
    "",
    "## Chunks by kind",
    "",
    "| Kind | baseline | vb6 regex | Δ |",
    "|---|---:|---:|---:|",
    formatKindCounts(bSum.kindCounts, pSum.kindCounts),
    "",
    "## Interpretation",
    "",
    "- **VB6 has no tree-sitter grammar** — this parser is regex-based, following the same pattern as the legacy pre-tree-sitter Rust and C/C++ parsers.",
    "- **Chunk granularity** goes from file-blobs to individual Sub/Function/Property/Type/Enum chunks. Class members are qualified as `ClassName.Method`; .bas module members as `ModuleName.Func`.",
    "- **Property Get/Let/Set** for the same property are collapsed to a single `property` chunk, avoiding three near-duplicate entries in the graph.",
    "- **Call extraction** covers four VB6 patterns: `Func(args)`, `Call Func(args)`, `obj.Method`, and bareword `SubName` (a call with no parens, common in VB6). Builtins like `MsgBox`, `Len`, `CStr`, `Debug.Print` are filtered.",
    "- **`.frm` designer blocks** are stripped before parsing so the parser only sees code (not the `BEGIN...END` property trees).",
    "- **No imports:** VB6 has no import mechanism in source — references live in the `.vbp` project file. chunk.imports is always empty.",
    ""
  ].join("\n");
}

(async function main() {
  const opts = parseArgs();
  const corpus = loadCorpus(opts.corpus);
  const totalBytes = corpus.reduce((acc, f) => acc + f.bytes, 0);

  console.log(`[bench] corpus: ${opts.corpus ?? "synthetic"} — ${corpus.length} files, ${totalBytes} bytes`);
  console.log(`[bench] runs: ${opts.runs}`);

  const baseline = baselineFileChunks(corpus);
  console.log(`[bench] baseline: ${baseline.length} chunks, 0 edges`);

  console.log("[bench] running vb6 regex parser...");
  const parsed = timeParser(corpus, opts.runs);
  console.log(`[bench]   median ${parsed.medianMs.toFixed(2)}ms, ${parsed.chunks.length} chunks`);

  const report = renderReport({
    corpusInfo: { source: opts.corpus ?? "synthetic", fileCount: corpus.length, totalBytes, runs: opts.runs },
    baseline,
    parsed
  });

  console.log("\n" + report);

  if (opts.output) {
    writeFileSync(opts.output, report);
    console.log(`[bench] report written to ${opts.output}`);
  }
})();
