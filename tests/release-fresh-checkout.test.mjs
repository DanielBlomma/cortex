import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import test from "node:test";

import {
  CHILD_CAPTURE_CAP_BYTES,
  CHILD_DIAGNOSTIC_CAP_BYTES,
  EXCERPT_CAP_BYTES,
  EXCERPT_CAP_LINES,
  FreshCheckoutError,
  HELPER_EMISSION_CAP_BYTES,
  executeChild,
  runFreshCheckout,
} from "../scripts/release-fresh-checkout.mjs";

class MemoryWriter extends Writable {
  constructor() {
    super();
    this.value = "";
  }

  _write(chunk, _encoding, callback) {
    this.value += chunk.toString("utf8");
    callback();
  }
}

function result(overrides = {}) {
  return {
    stdout: "",
    stderr: "",
    status: 0,
    signal: null,
    error: null,
    outputLimitError: null,
    ...overrides,
  };
}

function rootSuccess({ context = 81, root = 417, bundle = 6 } = {}) {
  return [
    `${context} passed, 0 failed`,
    `# tests ${root}`,
    "# suites 0",
    `# pass ${root}`,
    "# fail 0",
    "# cancelled 0",
    "# skipped 0",
    "# todo 0",
    `# tests ${bundle}`,
    "# suites 0",
    `# pass ${bundle}`,
    "# fail 0",
    "# cancelled 0",
    "# skipped 0",
    "# todo 0",
  ].join("\n");
}

function mcpSuccess(tests = 426) {
  return `ℹ tests ${tests}\nℹ suites 0\nℹ pass ${tests}\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\n`;
}

function successFor(command, args) {
  if (command === "npm" && args.length === 1 && args[0] === "test") {
    return result({ stdout: rootSuccess() });
  }
  if (command === "npm" && args.includes("test:ci")) {
    return result({ stdout: mcpSuccess() });
  }
  return result({ stdout: '{"ok":true}\n' });
}

async function invoke(executor) {
  const stdout = new MemoryWriter();
  const stderr = new MemoryWriter();
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-release-fresh-checkout-test-"));
  let error = null;
  try {
    await runFreshCheckout({ repoRoot, executor, stdout, stderr });
  } catch (caught) {
    error = caught;
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
  return { stdout: stdout.value, stderr: stderr.value, error };
}

async function invokeWithFixture(executor, prepare) {
  const stdout = new MemoryWriter();
  const stderr = new MemoryWriter();
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-release-fresh-checkout-test-"));
  let error = null;
  try {
    prepare(repoRoot);
    await runFreshCheckout({ repoRoot, executor, stdout, stderr });
  } catch (caught) {
    error = caught;
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
  return { stdout: stdout.value, stderr: stderr.value, error };
}

function lastEnvelope(stderr) {
  assert.match(stderr, /^\{\n/);
  return JSON.parse(stderr);
}

test("large late TAP failure retains exact subtest, assertion, status, totals, and bounded digests", async () => {
  const passing = Array.from({ length: 12000 }, (_, index) => `ok ${index + 1} - passing chatter ${"x".repeat(32)}`).join("\n");
  const failure = [
    "# Subtest: late named release failure",
    "not ok 417 - late named release failure",
    "  ---",
    "  error: 'expected exact release evidence'",
    "  code: 'ERR_ASSERTION'",
    "  expected: 417",
    "  actual: 416",
    "  ...",
    "1..417",
    "# tests 417",
    "# pass 416",
    "# fail 1",
  ].join("\n");
  const noisyStderr = Array.from({ length: 5000 }, (_, index) => `stderr passing chatter ${index}`).join("\n");
  const calls = [];
  const observed = await invoke(async (command, args) => {
    calls.push([command, ...args].join(" "));
    if (command === "npm" && args.length === 1 && args[0] === "test") {
      return result({ stdout: `${passing}\n${failure}\n`, stderr: noisyStderr, status: 1 });
    }
    return successFor(command, args);
  });
  assert.ok(observed.error instanceof FreshCheckoutError);
  assert.equal(observed.error.kind, "nonzero_exit");
  const envelope = lastEnvelope(observed.stderr);
  assert.equal(envelope.kind, "nonzero_exit");
  assert.equal(envelope.status, 1);
  assert.equal(envelope.signal, "unavailable");
  assert.match(envelope.evidence.failingSubtests[0].detail, /not ok 417 - late named release failure/);
  assert.match(envelope.evidence.failingSubtests[0].detail, /expected exact release evidence/);
  assert.ok(envelope.evidence.totals.some(({ line }) => line === "# tests 417"));
  assert.ok(envelope.evidence.totals.some(({ line }) => line === "# fail 1"));
  assert.equal(envelope.evidence.stdout.truncated, true);
  assert.equal(envelope.evidence.stderr.truncated, true);
  assert.equal(envelope.evidence.stdout.observedSha256.length, 64);
  assert.equal(envelope.evidence.stderr.observedSha256.length, 64);
  assert.ok(envelope.evidence.stdout.excerptBytes <= EXCERPT_CAP_BYTES);
  assert.ok(envelope.evidence.stdout.excerptLines <= EXCERPT_CAP_LINES);
  assert.ok(Buffer.byteLength(observed.stderr) < CHILD_DIAGNOSTIC_CAP_BYTES);
  assert.ok(Buffer.byteLength(observed.stdout) + Buffer.byteLength(observed.stderr) < HELPER_EMISSION_CAP_BYTES);
  assert.equal(calls.some((call) => call.includes("mcp-context") || call.includes("test:ci")), false);
  assert.equal(calls.some((call) => /npm version|npm publish|git (?:tag|push|commit)/.test(call)), false);
});

test("stdout and stderr cap truncation is deterministic and never swamps runner logs", async () => {
  const hugeStdout = `${"stdout-data\n".repeat(40000)}not ok 9 - bounded failure\n  ---\n  error: 'bounded assertion'\n  ...\n# tests 9\n# pass 8\n# fail 1\n`;
  const hugeStderr = `${"stderr-data\n".repeat(40000)}NPM_TOKEN=do-not-print /private/tmp/wo068-secret/repo\n`;
  const executor = async (command, args) => command === "npm" && args.length === 1
    ? result({ stdout: hugeStdout, stderr: hugeStderr, status: 1 })
    : successFor(command, args);
  const first = await invoke(executor);
  const second = await invoke(executor);
  const envelope = lastEnvelope(first.stderr);
  const repeatedEnvelope = lastEnvelope(second.stderr);
  repeatedEnvelope.cwd = envelope.cwd;
  assert.deepEqual(repeatedEnvelope, envelope);
  for (const channel of [envelope.evidence.stdout, envelope.evidence.stderr]) {
    assert.equal(channel.truncated, true);
    assert.ok(channel.observedBytes > channel.excerptBytes);
    assert.ok(channel.observedLines > channel.excerptLines);
    assert.equal(channel.observedSha256.length, 64);
    assert.equal(channel.observedBytes, channel.storedPrefix.bytes);
    assert.equal(channel.observedSha256, channel.storedPrefix.sha256);
  }
  assert.match(envelope.evidence.failingSubtests[0].detail, /bounded assertion/);
  assert.doesNotMatch(first.stderr, /NPM_TOKEN|do-not-print|\/private\/tmp\/wo068-secret/);
  assert.ok(Buffer.byteLength(first.stderr) < CHILD_DIAGNOSTIC_CAP_BYTES);
});

test("signal termination and spawn failure remain distinct truthful outcomes", async (t) => {
  await t.test("signal", async () => {
    const observed = await invoke(async (command, args) => command === "npm" && args.length === 1
      ? result({ status: null, signal: "SIGTERM" })
      : successFor(command, args));
    const envelope = lastEnvelope(observed.stderr);
    assert.equal(envelope.kind, "signal_termination");
    assert.equal(envelope.status, "unavailable");
    assert.equal(envelope.signal, "SIGTERM");
  });
  await t.test("spawn error", async () => {
    const observed = await invoke(async (command, args) => command === "npm" && args.length === 1
      ? result({ status: null, error: { code: "ENOENT", message: "spawn npm ENOENT" } })
      : successFor(command, args));
    const envelope = lastEnvelope(observed.stderr);
    assert.equal(envelope.kind, "spawn_failure");
    assert.equal(envelope.status, "unavailable");
    assert.equal(envelope.signal, "unavailable");
    assert.deepEqual(envelope.error, { code: "ENOENT", message: "spawn npm ENOENT" });
  });
});

test("output-limit failures are not mislabeled as process test failures", async () => {
  const observed = await invoke(async (command, args) => command === "npm" && args.length === 1
    ? result({
        status: null,
        signal: "SIGTERM",
        outputLimitError: { code: "CORTEX_CHILD_OUTPUT_LIMIT", limitBytes: 67108864, observedBytes: 67109000 },
      })
    : successFor(command, args));
  const envelope = lastEnvelope(observed.stderr);
  assert.equal(envelope.kind, "output_limit");
  assert.equal(envelope.outputLimit.code, "CORTEX_CHILD_OUTPUT_LIMIT");
  assert.equal(envelope.evidence.stdout.observedBytes, "unavailable");
  assert.equal(envelope.evidence.stdout.observedSha256, "unavailable");
  assert.equal(envelope.evidence.stdout.captureTruncated, true);
});

test("real output beyond 64 MiB retains full observed accounting and bounded stored evidence", async () => {
  const lineBytes = 1024 * 1024;
  const generatedLines = 70;
  const generatedBytes = lineBytes * generatedLines;
  const generator = [
    "process.on('SIGTERM', () => {});",
    `const line = Buffer.alloc(${lineBytes}, 0x78);`,
    "line[line.length - 1] = 0x0a;",
    `let remaining = ${generatedLines};`,
    "function write() {",
    "  while (remaining > 0) {",
    "    remaining -= 1;",
    "    if (!process.stdout.write(line)) { process.stdout.once('drain', write); return; }",
    "  }",
    "}",
    "write();",
  ].join("\n");
  const collected = await executeChild(process.execPath, ["-e", generator]);
  assert.equal(collected.outputLimitError.code, "CORTEX_CHILD_OUTPUT_LIMIT");
  assert.equal(collected.outputLimitError.observedBytes, generatedBytes);
  assert.equal(collected.outputLimitError.storedBytes, CHILD_CAPTURE_CAP_BYTES);

  const line = Buffer.alloc(lineBytes, 0x78);
  line[line.length - 1] = 0x0a;
  const expectedHash = crypto.createHash("sha256");
  const expectedStoredHash = crypto.createHash("sha256");
  for (let index = 0; index < generatedLines; index += 1) expectedHash.update(line);
  for (let index = 0; index < CHILD_CAPTURE_CAP_BYTES / lineBytes; index += 1) expectedStoredHash.update(line);
  const expectedSha256 = expectedHash.digest("hex");
  const expectedStoredSha256 = expectedStoredHash.digest("hex");

  const observed = await invoke(async (command, args) => command === "npm" && args.length === 1
    ? collected
    : successFor(command, args));
  assert.equal(observed.error.kind, "output_limit");
  const envelope = lastEnvelope(observed.stderr);
  const stdout = envelope.evidence.stdout;
  assert.equal(envelope.kind, "output_limit");
  assert.equal(envelope.outputLimit.observedBytes, generatedBytes);
  assert.equal(stdout.observedBytes, generatedBytes);
  assert.equal(stdout.observedLines, generatedLines);
  assert.equal(stdout.observedSha256, expectedSha256);
  assert.equal(stdout.storedPrefix.bytes, CHILD_CAPTURE_CAP_BYTES);
  assert.equal(stdout.storedPrefix.lines, CHILD_CAPTURE_CAP_BYTES / lineBytes);
  assert.equal(stdout.storedPrefix.sha256, expectedStoredSha256);
  assert.equal(stdout.captureTruncated, true);
  assert.ok(envelope.evidence.eventOrder.observedEvents >= envelope.evidence.eventOrder.events.length);
  assert.ok(Buffer.byteLength(observed.stderr) < CHILD_DIAGNOSTIC_CAP_BYTES);
  assert.ok(Buffer.byteLength(observed.stdout) + Buffer.byteLength(observed.stderr) < HELPER_EMISSION_CAP_BYTES);
});

test("executable alternating channels preserve bounded observed event sequence", async () => {
  const alternating = [
    "const wait = () => new Promise((resolve) => setTimeout(resolve, 25));",
    "for (const [channel, value] of [['stdout', 'out-1'], ['stderr', 'err-1'], ['stdout', 'out-2'], ['stderr', 'err-2']]) {",
    "  process[channel].write(`${value}\\n`);",
    "  await wait();",
    "}",
    "process.exitCode = 1;",
  ].join("\n");
  const collected = await executeChild(process.execPath, ["--input-type=module", "-e", alternating]);
  assert.equal(collected.status, 1);
  const observed = await invoke(async (command, args) => command === "npm" && args.length === 1
    ? collected
    : successFor(command, args));
  assert.equal(observed.error.kind, "nonzero_exit");
  const envelope = lastEnvelope(observed.stderr);
  const order = envelope.evidence.eventOrder;
  assert.notEqual(order, "unavailable");
  assert.equal(order.truncated, false);
  assert.deepEqual(order.events.map(({ sequence }) => sequence), [0, 1, 2, 3]);
  assert.deepEqual(order.events.map(({ provenance }) => provenance), ["stdout", "stderr", "stdout", "stderr"]);
  assert.deepEqual(order.events.map(({ excerpt }) => excerpt.trim()), ["out-1", "err-1", "out-2", "err-2"]);
  assert.equal(order.sha256.length, 64);
  assert.ok(Buffer.byteLength(observed.stderr) < CHILD_DIAGNOSTIC_CAP_BYTES);
  assert.ok(Buffer.byteLength(observed.stdout) + Buffer.byteLength(observed.stderr) < HELPER_EMISSION_CAP_BYTES);
});

test("collector failures have their own bounded diagnostic outcome", async () => {
  const failure = new Error("collector stream failed");
  failure.code = "ECOLLECT";
  const observed = await invoke(async (command, args) => {
    if (command === "npm" && args.length === 1) throw failure;
    return successFor(command, args);
  });
  const envelope = lastEnvelope(observed.stderr);
  assert.equal(observed.error.kind, "collector_failure");
  assert.equal(envelope.kind, "collector_failure");
  assert.equal(envelope.error.code, "ECOLLECT");
  assert.equal(envelope.status, "unavailable");
  assert.ok(Buffer.byteLength(observed.stderr) < CHILD_DIAGNOSTIC_CAP_BYTES);
});

test("missing or malformed TAP summaries fail closed with bounded tails and no success JSON", async () => {
  for (const stdout of ["TAP version 13\nok 1 - incomplete\n", "# tests nope\n# pass 417\n# fail 0\n"]) {
    const observed = await invoke(async (command, args) => command === "npm" && args.length === 1
      ? result({ stdout })
      : successFor(command, args));
    assert.equal(observed.error.kind, "missing_tap_summary");
    const envelope = lastEnvelope(observed.stderr);
    assert.equal(envelope.kind, "missing_tap_summary");
    assert.match(envelope.evidence.stdout.excerpt, /TAP version|# tests nope/);
    assert.doesNotMatch(observed.stdout, /"mcp":"426\/426"/);
    assert.ok(Buffer.byteLength(observed.stderr) < CHILD_DIAGNOSTIC_CAP_BYTES);
  }
});

test("generated-context precondition evidence is bounded and prevents every child command", async () => {
  const calls = [];
  const observed = await invokeWithFixture(async (...args) => {
    calls.push(args);
    return result();
  }, (repoRoot) => {
    for (let index = 0; index < 5000; index += 1) {
      const directory = path.join(repoRoot, ".context", `generated-${String(index).padStart(4, "0")}`);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, `${"x".repeat(64)}.json`), "generated");
    }
  });
  assert.equal(observed.error.kind, "precondition");
  const envelope = lastEnvelope(observed.stderr);
  assert.equal(envelope.kind, "precondition");
  assert.equal(envelope.status, "unavailable");
  assert.equal(envelope.signal, "unavailable");
  assert.equal(envelope.error.code, "CORTEX_GENERATED_CONTEXT_PRESENT");
  assert.match(envelope.error.message, /5000 generated context path\(s\) present; sha256=[a-f0-9]{64}/);
  assert.equal(envelope.evidence.stderr.truncated, true);
  assert.equal(envelope.evidence.stderr.observedSha256.length, 64);
  assert.ok(Buffer.byteLength(observed.stderr) < CHILD_DIAGNOSTIC_CAP_BYTES);
  assert.equal(calls.length, 0);
});

test("exact 81/417/6/426 totals pass and every total mutation fails closed", async (t) => {
  const passing = await invoke(successFor);
  assert.equal(passing.error, null);
  assert.match(passing.stdout, /"context":"81\/81"/);
  assert.match(passing.stdout, /"root":"417\/417"/);
  assert.match(passing.stdout, /"deepseekHarnessBundle":"6\/6"/);
  assert.match(passing.stdout, /"mcp":"426\/426"/);

  for (const [name, rootOptions, mcp] of [
    ["context", { context: 80 }, 426],
    ["root", { root: 416 }, 426],
    ["bundle", { bundle: 5 }, 426],
    ["mcp", {}, 425],
  ]) {
    await t.test(name, async () => {
      const calls = [];
      const observed = await invoke(async (command, args) => {
        calls.push([command, ...args].join(" "));
        if (command === "npm" && args.length === 1) return result({ stdout: rootSuccess(rootOptions) });
        if (command === "npm" && args.includes("test:ci")) return result({ stdout: mcpSuccess(mcp) });
        return successFor(command, args);
      });
      assert.equal(observed.error.kind, "totals_drift");
      assert.equal(lastEnvelope(observed.stderr).kind, "totals_drift");
      assert.doesNotMatch(observed.stdout, /"mcp":"426\/426"/);
      assert.equal(calls.some((call) => /npm version|npm publish|git (?:tag|push|commit)/.test(call)), false);
    });
  }
});
