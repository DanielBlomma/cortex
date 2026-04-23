import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { render, scanBaseline } from "../scripts/dashboard.mjs";

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

test("scanBaseline dedupes overlapping source_paths", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-dashboard-"));
  const contextDir = path.join(tempRoot, ".context");
  const configPath = path.join(contextDir, "config.yaml");
  const srcDir = path.join(tempRoot, "src");
  const nestedDir = path.join(srcDir, "nested");

  fs.mkdirSync(contextDir, { recursive: true });
  fs.mkdirSync(nestedDir, { recursive: true });
  fs.writeFileSync(
    configPath,
    [
      "source_paths:",
      "  - src",
      "  - src/nested",
    ].join("\n")
  );
  fs.writeFileSync(path.join(srcDir, "root.ts"), "export const root = true;\n");
  fs.writeFileSync(path.join(nestedDir, "child.ts"), "export const child = true;\n");

  try {
    const baseline = scanBaseline(tempRoot, configPath);
    assert.equal(baseline.files, 2);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("render surfaces C# parser problems without making C# a primary health metric", () => {
  const output = stripAnsi(render({
    baseline: { files: 2, lines: 10, chars: 100, tokens: 25 },
    cortex: {
      files: 2,
      chunks: 0,
      rules: 0,
      adrs: 0,
      totalEntities: 2,
      relations: { calls: 0, defines: 0, constrains: 0, implements: 0, imports: 0, supersedes: 0, total: 0 },
    },
    tokens: {
      codebase: 25,
      baselinePerTask: 25,
      cortexPerTask: 5,
      filesPerTask: 2,
      queriesPerTask: 1,
      ratio: 5,
      reduction: 80,
    },
    embeddings: null,
    parserHealth: {
      csharp: {
        available: false,
        reason: "install .NET SDK",
        files: 4,
        chunks: 0,
      },
    },
    freshness: { percent: 100 },
    version: { state: "current", local: "1.6.0", latest: "1.6.0" },
    topConnected: [],
    timestamps: {
      lastIngest: "just now",
      lastGraph: "just now",
      lastEmbed: "never",
    },
  }, false));

  assert.match(output, /Parser warning \(C#\):\s+unavailable/i);
  assert.match(output, /install \.NET SDK/i);
});

test("render hides healthy C# parser state", () => {
  const output = stripAnsi(render({
    baseline: { files: 2, lines: 10, chars: 100, tokens: 25 },
    cortex: {
      files: 2,
      chunks: 6,
      rules: 0,
      adrs: 0,
      totalEntities: 8,
      relations: { calls: 0, defines: 0, constrains: 0, implements: 0, imports: 0, supersedes: 0, total: 0 },
    },
    tokens: {
      codebase: 25,
      baselinePerTask: 25,
      cortexPerTask: 5,
      filesPerTask: 2,
      queriesPerTask: 1,
      ratio: 5,
      reduction: 80,
    },
    embeddings: null,
    parserHealth: {
      csharp: {
        available: true,
        reason: null,
        files: 4,
        chunks: 12,
      },
    },
    freshness: { percent: 100 },
    version: { state: "current", local: "1.6.0", latest: "1.6.0" },
    topConnected: [],
    timestamps: {
      lastIngest: "just now",
      lastGraph: "just now",
      lastEmbed: "never",
    },
  }, false));

  assert.doesNotMatch(output, /Parser warning \(C#\):/i);
});
