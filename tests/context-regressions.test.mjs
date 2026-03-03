import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const WATCH_PATH = path.join(REPO_ROOT, "scripts", "watch.sh");
const INGEST_PATH = path.join(REPO_ROOT, "scripts", "ingest.mjs");

let passed = 0;
let failed = 0;

function assert(name, condition) {
  if (condition) {
    console.log(`  PASS ${name}`);
    passed += 1;
  } else {
    console.log(`  FAIL ${name}`);
    failed += 1;
  }
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    ...options
  });
}

function parseJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function extractStatusDigestFunction(sourceText) {
  const lines = sourceText.split(/\r?\n/);
  const start = lines.findIndex((line) => line === "status_digest() {");
  if (start === -1) {
    throw new Error("Could not find status_digest() in scripts/watch.sh");
  }

  const end = lines.findIndex((line, index) => index > start && line === "}");
  if (end === -1) {
    throw new Error("Could not find end of status_digest() in scripts/watch.sh");
  }

  return lines.slice(start, end + 1).join("\n");
}

function digestForRepo(repoDir, statusDigestFunction) {
  const harnessPath = path.join(repoDir, "digest-harness.sh");
  fs.writeFileSync(
    harnessPath,
    `#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="${repoDir}"
${statusDigestFunction}
status_digest
`,
    "utf8"
  );
  fs.chmodSync(harnessPath, 0o755);
  return run("bash", [harnessPath]).trim();
}

function testWatchDigestIncludesHead() {
  console.log("1. watch digest tracks HEAD transitions");
  const watchSource = fs.readFileSync(WATCH_PATH, "utf8");
  assert("watch script includes rev-parse HEAD", watchSource.includes("rev-parse --verify HEAD"));
  assert("watch script includes symbolic ref", watchSource.includes("symbolic-ref --short -q HEAD"));

  const statusDigestFunction = extractStatusDigestFunction(watchSource);
  const repoDir = makeTempDir("cortex-watch-digest-");
  try {
    run("git", ["init"], { cwd: repoDir });
    run("git", ["checkout", "-b", "main"], { cwd: repoDir });
    run("git", ["config", "user.email", "tests@example.com"], { cwd: repoDir });
    run("git", ["config", "user.name", "Cortex Tests"], { cwd: repoDir });

    fs.writeFileSync(path.join(repoDir, "sample.txt"), "main-v1\n", "utf8");
    run("git", ["add", "sample.txt"], { cwd: repoDir });
    run("git", ["commit", "-m", "main init"], { cwd: repoDir });

    run("git", ["checkout", "-b", "feature"], { cwd: repoDir });
    fs.writeFileSync(path.join(repoDir, "sample.txt"), "feature-v2\n", "utf8");
    run("git", ["add", "sample.txt"], { cwd: repoDir });
    run("git", ["commit", "-m", "feature change"], { cwd: repoDir });

    run("git", ["checkout", "main"], { cwd: repoDir });
    const digestMain = digestForRepo(repoDir, statusDigestFunction);
    run("git", ["checkout", "feature"], { cwd: repoDir });
    const digestFeature = digestForRepo(repoDir, statusDigestFunction);

    assert("clean branch switch changes digest", digestMain !== digestFeature);
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
}

function testIngestChunkIdDisambiguation() {
  console.log("\n2. ingest chunk ids are unique for same-name declarations");
  const fixtureRoot = makeTempDir("cortex-ingest-chunks-");
  try {
    fs.mkdirSync(path.join(fixtureRoot, ".context"), { recursive: true });
    fs.mkdirSync(path.join(fixtureRoot, "scripts", "parsers"), { recursive: true });
    fs.mkdirSync(path.join(fixtureRoot, "src"), { recursive: true });

    const ingestSource = fs.readFileSync(INGEST_PATH, "utf8").replace(
      'import { parseCode } from "./parsers/javascript.mjs";',
      'import { parseCode } from "./parsers/mock-parser.mjs";'
    );
    fs.writeFileSync(path.join(fixtureRoot, "scripts", "ingest.mjs"), ingestSource, "utf8");

    fs.writeFileSync(
      path.join(fixtureRoot, "scripts", "parsers", "mock-parser.mjs"),
      `export function parseCode() {
  return {
    errors: [],
    chunks: [
      {
        name: "Thing.value",
        kind: "method",
        signature: "get value()",
        body: "get value() { return this._value; }",
        startLine: 2,
        endLine: 4,
        calls: [],
        imports: [],
        language: "typescript"
      },
      {
        name: "Thing.value",
        kind: "method",
        signature: "set value(v)",
        body: "set value(v) { this._value = v; }",
        startLine: 6,
        endLine: 8,
        calls: [],
        imports: [],
        language: "typescript"
      },
      {
        name: "useValue",
        kind: "function",
        signature: "useValue()",
        body: "function useValue() { Thing.value(); }",
        startLine: 10,
        endLine: 12,
        calls: ["Thing.value"],
        imports: [],
        language: "typescript"
      }
    ]
  };
}
`,
      "utf8"
    );

    fs.writeFileSync(
      path.join(fixtureRoot, ".context", "config.yaml"),
      `repo_id: fixture
source_paths:
  - src
truth_order:
  - ADR
  - RULE
  - CODE
  - WIKI
ranking:
  semantic: 0.40
  graph: 0.25
  trust: 0.20
  recency: 0.15
`,
      "utf8"
    );

    fs.writeFileSync(
      path.join(fixtureRoot, ".context", "rules.yaml"),
      `rules:
  - id: rule.test
    description: "fixture rule"
    priority: 1
    enforce: true
`,
      "utf8"
    );

    fs.writeFileSync(
      path.join(fixtureRoot, "src", "sample.ts"),
      `export class Thing {
  get value() { return 1; }
  set value(v: number) {}
}
export function useValue() {
  return new Thing().value;
}
`,
      "utf8"
    );

    run("node", ["scripts/ingest.mjs"], { cwd: fixtureRoot });

    const chunks = parseJsonl(path.join(fixtureRoot, ".context", "cache", "entities.chunk.jsonl"));
    const calls = parseJsonl(path.join(fixtureRoot, ".context", "cache", "relations.calls.jsonl"));

    assert("three chunks were produced", chunks.length === 3);
    const chunkIds = chunks.map((chunk) => chunk.id);
    assert("chunk ids are unique", new Set(chunkIds).size === chunkIds.length);

    const thingValueChunks = chunks.filter((chunk) => chunk.name === "Thing.value");
    assert("same-name declarations both exist", thingValueChunks.length === 2);
    assert(
      "same-name declarations have disambiguated ids",
      new Set(thingValueChunks.map((chunk) => chunk.id)).size === 2 &&
        thingValueChunks.every((chunk) => /:\d+-\d+$/.test(chunk.id))
    );

    const useValueChunk = chunks.find((chunk) => chunk.name === "useValue");
    const thingIds = new Set(thingValueChunks.map((chunk) => chunk.id));
    const useValueEdges = calls.filter((rel) => rel.from === useValueChunk?.id);
    const toThingEdges = useValueEdges.filter((rel) => thingIds.has(rel.to));
    assert("calls relation fans out to both matching chunk ids", toThingEdges.length === 2);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

console.log("context regression tests\n");
testWatchDigestIncludesHead();
testIngestChunkIdDisambiguation();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
