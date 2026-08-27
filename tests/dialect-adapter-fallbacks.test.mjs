import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import {
  DIALECT_ADAPTER_SHAPE_INVENTORY_SHA256,
  DIALECT_CAPABILITY_MANIFEST_SHA256,
  DIALECT_LIMITS_SHA256
} from "../scaffold/scripts/lib/dialect-observation-contract.mjs";

const EXPECTED_HASHES = {
  capability: "94f1c645ce4bb7963a30b2da65bce3e5130e38b05f93046623e1759d000f871c",
  limits: "aabe57c65a97253e4ae617b00c653ef5f14e2259a5006b354807468e47a1a602",
  shapes: "f09fdb942324539c94a5ef64ed4ee743a28ab26fad773d60afddcc7414323250",
  ownershipV1: "b3b97387f541e718ac3b27f677e00cf815cb9bd600b1305391891685f03423ff"
};

function runModule(source, environment = {}) {
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: process.cwd(),
    env: { ...process.env, ...environment },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function runInstrumentedFallback({ dispatcher, fallbackSuffix, environment, source, path, language }) {
  const loaderSource = [
    "export async function load(url, context, nextLoad) {",
    "  const result = await nextLoad(url, context);",
    `  if (!url.endsWith(${JSON.stringify(fallbackSuffix)})) return result;`,
    "  const original = typeof result.source === 'string' ? result.source : new TextDecoder().decode(result.source);",
    "  const instrumented = original.replace('export function parseCode(', 'function instrumentedFallbackParseCode(');",
    "  if (instrumented === original) throw new Error('parseCode export not found for instrumentation');",
    "  const wrapper = `\\nexport function parseCode(...args) { globalThis.__fallbackParseCalls = (globalThis.__fallbackParseCalls ?? 0) + 1; return instrumentedFallbackParseCode(...args); }\\n`;",
    "  return { ...result, source: instrumented + wrapper, shortCircuit: true };",
    "}"
  ].join("\n");
  const loaderUrl = `data:text/javascript,${encodeURIComponent(loaderSource)}`;
  const registrationSource = `import { register } from 'node:module'; register(${JSON.stringify(loaderUrl)}, import.meta.url);`;
  const registrationUrl = `data:text/javascript,${encodeURIComponent(registrationSource)}`;
  const program = [
    `const parser = await import(${JSON.stringify(dispatcher)});`,
    `const transport = await parser.parseCodeWithDialectObservations(${JSON.stringify(source)}, ${JSON.stringify(path)}, ${JSON.stringify(language)});`,
    "console.log(JSON.stringify({ calls: globalThis.__fallbackParseCalls ?? 0, transport }));"
  ].join("\n");
  const result = spawnSync(process.execPath, [
    "--import", registrationUrl,
    "--input-type=module", "--eval", program
  ], {
    cwd: process.cwd(),
    env: { ...process.env, ...environment },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("forced clang and Rust regex fallbacks preserve parser output and report unavailable", () => {
  const cppResult = runModule(`
    import * as parser from './scaffold/scripts/parsers/cpp-dispatch.mjs';
    const source = 'int value(void) { return 1; }';
    const before = await parser.parseCode(source, 'src/value.c', 'c');
    const transport = await parser.parseCodeWithDialectObservations(source, 'src/value.c', 'c');
    const after = await parser.parseCode(source, 'src/value.c', 'c');
    console.log(JSON.stringify({ before, transport, after }));
  `, { CORTEX_CPP_PARSER: "clang" });
  assert.equal(cppResult.transport.observation_envelope.status, "unavailable");
  assert.deepEqual(cppResult.transport.observation_envelope.observations, []);
  assert.deepEqual(cppResult.transport.parser_result, cppResult.before);
  assert.deepEqual(cppResult.after, cppResult.before);

  const rustResult = runModule(`
    import * as parser from './scaffold/scripts/parsers/rust-dispatch.mjs';
    const source = 'fn value() -> i32 { 1 }';
    const before = await parser.parseCode(source, 'src/value.rs', 'rust');
    const transport = await parser.parseCodeWithDialectObservations(source, 'src/value.rs', 'rust');
    const after = await parser.parseCode(source, 'src/value.rs', 'rust');
    console.log(JSON.stringify({ before, transport, after }));
  `, { CORTEX_RUST_PARSER: "regex" });
  assert.equal(rustResult.transport.observation_envelope.status, "unavailable");
  assert.deepEqual(rustResult.transport.observation_envelope.observations, []);
  assert.deepEqual(rustResult.transport.parser_result, rustResult.before);
  assert.deepEqual(rustResult.after, rustResult.before);
});

test("forced fallback dispatch invokes each legacy parser exactly once", () => {
  const cpp = runInstrumentedFallback({
    dispatcher: "./scaffold/scripts/parsers/cpp-dispatch.mjs",
    fallbackSuffix: "/scaffold/scripts/parsers/cpp.mjs",
    environment: { CORTEX_CPP_PARSER: "clang" },
    source: "int value(void) { return 1; }",
    path: "src/value.c",
    language: "c"
  });
  assert.equal(cpp.calls, 1);
  assert.equal(cpp.transport.observation_envelope.status, "unavailable");

  const rust = runInstrumentedFallback({
    dispatcher: "./scaffold/scripts/parsers/rust-dispatch.mjs",
    fallbackSuffix: "/scaffold/scripts/parsers/rust.mjs",
    environment: { CORTEX_RUST_PARSER: "regex" },
    source: "fn value() -> i32 { 1 }",
    path: "src/value.rs",
    language: "rust"
  });
  assert.equal(rust.calls, 1);
  assert.equal(rust.transport.observation_envelope.status, "unavailable");
});

test("forced unavailable Tree-sitter backends return unavailable without fallback facts", () => {
  const missingGrammarDir = "/definitely/not/a/cortex/tree-sitter/grammar-directory";
  const cppResult = runModule(`
    import { parseCodeWithDialectObservations } from './scaffold/scripts/parsers/cpp-dispatch.mjs';
    console.log(JSON.stringify(await parseCodeWithDialectObservations('int value(void) { return 1; }', 'src/value.c', 'c')));
  `, {
    CORTEX_CPP_PARSER: "tree-sitter",
    CORTEX_TREE_SITTER_GRAMMAR_DIR: missingGrammarDir
  });
  assert.equal(cppResult.observation_envelope.status, "unavailable");
  assert.deepEqual(cppResult.observation_envelope.observations, []);

  const pythonResult = runModule(`
    import { parseCodeWithDialectObservations } from './scaffold/scripts/parsers/python-treesitter.mjs';
    console.log(JSON.stringify(await parseCodeWithDialectObservations('def value(): return 1', 'src/value.py', 'python')));
  `, { CORTEX_TREE_SITTER_GRAMMAR_DIR: missingGrammarDir });
  assert.equal(pythonResult.observation_envelope.status, "unavailable");
  assert.deepEqual(pythonResult.observation_envelope.observations, []);
});

test("invalid paths take precedence over backend resolution", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    import { parseCodeWithDialectObservations } from './scaffold/scripts/parsers/rust-dispatch.mjs';
    try {
      await parseCodeWithDialectObservations('fn value() {}', '../escape.rs', 'rust');
      process.exitCode = 2;
    } catch (error) {
      console.log(error.message);
    }
  `], {
    cwd: process.cwd(),
    env: { ...process.env, CORTEX_RUST_PARSER: "regex" },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /non-canonical repository path/);
});

test("accepted contract, shape, ownership, package-lock, and managed-target baselines remain frozen", () => {
  assert.equal(DIALECT_CAPABILITY_MANIFEST_SHA256, EXPECTED_HASHES.capability);
  assert.equal(DIALECT_LIMITS_SHA256, EXPECTED_HASHES.limits);
  assert.equal(DIALECT_ADAPTER_SHAPE_INVENTORY_SHA256, EXPECTED_HASHES.shapes);

  const sha256 = (path) => crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex");
  assert.equal(sha256("scaffold/ownership/v1.json"), EXPECTED_HASHES.ownershipV1);
  assert.equal(
    sha256("scaffold/scripts/parsers/package-lock.json"),
    "afd26dd736139b350a21c4789d4b75eb12048158923e8d82a5cb7f6743d5538f"
  );

  const ownership = JSON.parse(fs.readFileSync("scaffold/ownership/v2.json", "utf8"));
  const managedTargets = ownership.managedRoots.flatMap((root) => root.files.map((file) => `${root.target}/${file}`));
  assert.equal(new Set(managedTargets).size, 396);
  assert.equal(managedTargets.filter((target) => target.startsWith(".context/scripts/")).length, 96);
});
