#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const CHILD_CAPTURE_CAP_BYTES = 64 * 1024 * 1024;
export const CHILD_DIAGNOSTIC_CAP_BYTES = 64 * 1024;
export const HELPER_EMISSION_CAP_BYTES = 256 * 1024;
export const EXCERPT_CAP_BYTES = 8 * 1024;
export const EXCERPT_CAP_LINES = 80;
const FAILURE_CAP_BYTES = 32 * 1024;
const FAILURE_CAP_LINES = 240;
const MAX_FAILURES = 8;
const MAX_TOTAL_LINES = 64;
const EVENT_ORDER_CAP_EVENTS = 32;
const EVENT_EXCERPT_CAP_BYTES = 256;
const EVENT_EXCERPT_CAP_LINES = 4;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const trackedContext = new Set([
  ".context/config.yaml",
  ".context/ontology.cypher",
  ".context/rules.yaml",
  "scaffold/.context/config.yaml",
  "scaffold/.context/ontology.cypher",
  "scaffold/.context/rules.yaml",
]);

export class FreshCheckoutError extends Error {
  constructor(kind, message) {
    super(`Fresh-checkout release regression failed: ${message}`);
    this.name = "FreshCheckoutError";
    this.kind = kind;
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function lineCount(value) {
  if (!value) return 0;
  return (value.match(/\n/g) ?? []).length + (value.endsWith("\n") ? 0 : 1);
}

function newlineByteCount(value) {
  let count = 0;
  let index = value.indexOf(0x0a);
  while (index >= 0) {
    count += 1;
    index = value.indexOf(0x0a, index + 1);
  }
  return count;
}

function sanitize(value, repoRoot) {
  let text = String(value ?? "")
    .replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  const authNames = "NPM_TOKEN|NODE_AUTH_TOKEN|GH_TOKEN|GITHUB_TOKEN|_authToken";
  text = text
    .replace(new RegExp(`\\b(?:${authNames})\\b\\s*[:=]\\s*[^\\s]+`, "gi"), "[REDACTED_AUTH]")
    .replace(new RegExp(`\\b(?:${authNames})\\b`, "gi"), "[REDACTED_AUTH_NAME]")
    .replace(/\b(?:npm_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g, "[REDACTED_TOKEN]")
    .replace(/(?:\/private)?\/tmp\/[A-Za-z0-9._/-]+/g, "<disposable-path>");
  if (repoRoot) text = text.replaceAll(repoRoot, "<repo>");
  return text;
}

function tailBounded(value, byteCap, lineCap) {
  const lines = value.split("\n");
  let selected = lines.slice(Math.max(0, lines.length - lineCap)).join("\n");
  let bytes = Buffer.from(selected);
  if (bytes.length > byteCap) bytes = bytes.subarray(bytes.length - byteCap);
  selected = bytes.toString("utf8").replace(/^\uFFFD/, "");
  return selected;
}

function summarizeChannel(raw, repoRoot, accounting = null, captureKnownIncomplete = false) {
  const stored = String(raw ?? "");
  const cleaned = sanitize(stored, repoRoot);
  const excerpt = tailBounded(cleaned, EXCERPT_CAP_BYTES, EXCERPT_CAP_LINES);
  const storedBytes = Buffer.byteLength(stored);
  const storedLines = lineCount(stored);
  const excerptBytes = Buffer.byteLength(excerpt);
  const excerptLines = lineCount(excerpt);
  const observedBytes = accounting?.observedBytes ?? (captureKnownIncomplete ? "unavailable" : storedBytes);
  const observedLines = accounting?.observedLines ?? (captureKnownIncomplete ? "unavailable" : storedLines);
  const observedSha256 = accounting?.sha256 ?? (captureKnownIncomplete ? "unavailable" : sha256(stored));
  const captureTruncated = accounting
    ? accounting.observedBytes > accounting.storedBytes
    : captureKnownIncomplete;
  const excerptTruncated = excerptBytes < Buffer.byteLength(cleaned) || excerptLines < lineCount(cleaned);
  return {
    observedBytes,
    observedLines,
    observedSha256,
    storedPrefix: {
      bytes: accounting?.storedBytes ?? storedBytes,
      lines: accounting?.storedLines ?? storedLines,
      sha256: accounting?.storedSha256 ?? sha256(stored),
    },
    captureTruncated,
    excerptTruncated,
    truncated: captureTruncated || excerptTruncated,
    excerptBytes,
    excerptLines,
    excerpt,
  };
}

function summarizeEventOrder(streamAccounting, repoRoot) {
  const eventOrder = streamAccounting?.eventOrder;
  if (!eventOrder) return "unavailable";
  return {
    observedEvents: eventOrder.observedEvents,
    collectorRetainedEvents: eventOrder.events.length,
    truncated: eventOrder.observedEvents > eventOrder.events.length,
    sha256: eventOrder.sha256,
    events: eventOrder.events.map((event) => ({
      ...event,
      excerpt: sanitize(event.excerpt, repoRoot),
    })),
  };
}

function extractFailures(raw, provenance, repoRoot) {
  const lines = sanitize(raw, repoRoot).split("\n");
  const failures = [];
  for (let index = 0; index < lines.length && failures.length < MAX_FAILURES; index += 1) {
    if (!/^not ok\s+\d+\s+-\s+/.test(lines[index])) continue;
    const block = [lines[index]];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (cursor > index + 1 && /^(?:# Subtest:|(?:not )?ok\s+\d+\s+-|1\.\.\d+)/.test(line)) break;
      block.push(line);
      if (/^\s+\.\.\.\s*$/.test(line)) break;
    }
    failures.push({
      provenance,
      detail: tailBounded(block.join("\n"), FAILURE_CAP_BYTES, FAILURE_CAP_LINES),
    });
  }
  return failures;
}

function extractTotals(raw, provenance, repoRoot) {
  return sanitize(raw, repoRoot)
    .split("\n")
    .filter((line) => /^(?:#|ℹ)\s+(?:tests|pass|fail|cancelled|skipped|todo)\s+\d+$/.test(line) || /^\d+ passed, \d+ failed$/.test(line))
    .map((line) => ({ provenance, line }));
}

function childEvidence(result, repoRoot) {
  const totals = [
    ...extractTotals(result.stdout, "stdout", repoRoot),
    ...extractTotals(result.stderr, "stderr", repoRoot),
  ];
  const captureKnownIncomplete = Boolean(result.outputLimitError);
  return {
    stdout: summarizeChannel(
      result.stdout,
      repoRoot,
      result.streamAccounting?.channels?.stdout,
      captureKnownIncomplete,
    ),
    stderr: summarizeChannel(
      result.stderr,
      repoRoot,
      result.streamAccounting?.channels?.stderr,
      captureKnownIncomplete,
    ),
    eventOrder: summarizeEventOrder(result.streamAccounting, repoRoot),
    failingSubtests: [
      ...extractFailures(result.stdout, "stdout", repoRoot),
      ...extractFailures(result.stderr, "stderr", repoRoot),
    ],
    totals: totals.slice(-MAX_TOTAL_LINES),
    totalsTruncation: totals.length > MAX_TOTAL_LINES ? {
      originalLines: totals.length,
      retainedLines: MAX_TOTAL_LINES,
      sha256: sha256(JSON.stringify(totals)),
    } : "unavailable",
  };
}

function printable(value) {
  return value === null || value === undefined ? "unavailable" : value;
}

function commandText(command, args) {
  return [command, ...args].join(" ");
}

function classifyProcess(result) {
  if (result.outputLimitError) return "output_limit";
  if (result.error) return "spawn_failure";
  if (result.signal) return "signal_termination";
  if (result.status !== 0) return "nonzero_exit";
  return "success";
}

function diagnosticEnvelope(kind, command, args, result, repoRoot, validation = null) {
  const envelope = {
    ok: false,
    kind,
    command: commandText(command, args),
    cwd: repoRoot,
    status: printable(result.status),
    signal: printable(result.signal),
    error: result.error ? {
      code: printable(result.error.code),
      message: sanitize(result.error.message, repoRoot),
    } : { code: "unavailable", message: "unavailable" },
    outputLimit: result.outputLimitError ?? "unavailable",
    validation: validation ?? "unavailable",
    evidence: childEvidence(result, repoRoot),
  };
  let serialized = `${JSON.stringify(envelope, null, 2)}\n`;
  if (Buffer.byteLength(serialized) >= CHILD_DIAGNOSTIC_CAP_BYTES) {
    const originalBytes = Buffer.byteLength(serialized);
    const originalDigest = sha256(serialized);
    envelope.evidence.stdout.excerpt = tailBounded(envelope.evidence.stdout.excerpt, 2048, 20);
    envelope.evidence.stderr.excerpt = tailBounded(envelope.evidence.stderr.excerpt, 2048, 20);
    envelope.evidence.failingSubtests = envelope.evidence.failingSubtests.slice(0, 2).map((failure) => ({
      ...failure,
      detail: tailBounded(failure.detail, 8192, 80),
    }));
    if (envelope.evidence.eventOrder !== "unavailable") {
      const collectorRetainedEvents = envelope.evidence.eventOrder.events.length;
      envelope.evidence.eventOrder.events = envelope.evidence.eventOrder.events.slice(-8);
      envelope.evidence.eventOrder.emissionTruncation = {
        collectorRetainedEvents,
        emittedEvents: envelope.evidence.eventOrder.events.length,
      };
    }
    envelope.diagnosticTruncation = { originalBytes, sha256: originalDigest };
    serialized = `${JSON.stringify(envelope, null, 2)}\n`;
  }
  if (Buffer.byteLength(serialized) >= CHILD_DIAGNOSTIC_CAP_BYTES) {
    throw new FreshCheckoutError("collector_failure", "diagnostic envelope exceeded the 64 KiB child cap");
  }
  return serialized;
}

function successEnvelope(command, args, result, repoRoot) {
  const evidence = childEvidence(result, repoRoot);
  const envelope = {
    ok: true,
    command: commandText(command, args),
    cwd: repoRoot,
    status: result.status,
    signal: "unavailable",
    stdout: evidence.stdout,
    stderr: evidence.stderr,
    totals: evidence.totals,
  };
  const serialized = `${JSON.stringify(envelope, null, 2)}\n`;
  if (Buffer.byteLength(serialized) >= CHILD_DIAGNOSTIC_CAP_BYTES) {
    throw new FreshCheckoutError("collector_failure", "success envelope exceeded the 64 KiB child cap");
  }
  return serialized;
}

export function executeChild(command, args, { cwd = root, env = process.env } = {}) {
  return new Promise((resolve) => {
    const chunks = { stdout: [], stderr: [] };
    const channels = Object.fromEntries(["stdout", "stderr"].map((provenance) => [provenance, {
      observedBytes: 0,
      newlineBytes: 0,
      endsWithNewline: false,
      hash: crypto.createHash("sha256"),
      storedBytes: 0,
      storedNewlineBytes: 0,
      storedEndsWithNewline: false,
      storedHash: crypto.createHash("sha256"),
    }]));
    const orderedEvents = [];
    const eventHash = crypto.createHash("sha256");
    let observedEvents = 0;
    let observedBytes = 0;
    let storedBytes = 0;
    let outputLimitError = null;
    let spawnError = null;
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const collect = (provenance, chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const channel = channels[provenance];
      channel.observedBytes += bytes.length;
      channel.hash.update(bytes);
      channel.newlineBytes += newlineByteCount(bytes);
      if (bytes.length > 0) channel.endsWithNewline = bytes.at(-1) === 0x0a;

      const sequence = observedEvents;
      observedEvents += 1;
      eventHash.update(`${sequence}\0${provenance}\0${bytes.length}\0`);
      eventHash.update(bytes);
      orderedEvents.push({
        sequence,
        provenance,
        bytes: bytes.length,
        sha256: sha256(bytes),
        excerpt: tailBounded(bytes.toString("utf8"), EVENT_EXCERPT_CAP_BYTES, EVENT_EXCERPT_CAP_LINES),
      });
      if (orderedEvents.length > EVENT_ORDER_CAP_EVENTS) orderedEvents.shift();

      observedBytes += bytes.length;
      const available = Math.max(0, CHILD_CAPTURE_CAP_BYTES - storedBytes);
      if (available > 0) {
        const retained = bytes.subarray(0, Math.min(available, bytes.length));
        chunks[provenance].push(retained);
        storedBytes += retained.length;
        channel.storedBytes += retained.length;
        channel.storedHash.update(retained);
        channel.storedNewlineBytes += newlineByteCount(retained);
        if (retained.length > 0) channel.storedEndsWithNewline = retained.at(-1) === 0x0a;
      }
      if (observedBytes > CHILD_CAPTURE_CAP_BYTES) {
        if (!outputLimitError) {
          outputLimitError = {
            code: "CORTEX_CHILD_OUTPUT_LIMIT",
            limitBytes: CHILD_CAPTURE_CAP_BYTES,
            observedBytes,
            storedBytes,
          };
          child.kill("SIGTERM");
        }
        outputLimitError.observedBytes = observedBytes;
        outputLimitError.storedBytes = storedBytes;
        return;
      }
    };
    child.stdout?.on("data", (chunk) => collect("stdout", chunk));
    child.stderr?.on("data", (chunk) => collect("stderr", chunk));
    child.on("error", (error) => {
      spawnError = { code: error.code ?? null, message: error.message ?? String(error) };
    });
    child.on("close", (status, signal) => {
      const streamAccounting = {
        channels: Object.fromEntries(Object.entries(channels).map(([provenance, channel]) => [provenance, {
          observedBytes: channel.observedBytes,
          observedLines: channel.observedBytes === 0
            ? 0
            : channel.newlineBytes + (channel.endsWithNewline ? 0 : 1),
          sha256: channel.hash.digest("hex"),
          storedBytes: channel.storedBytes,
          storedLines: channel.storedBytes === 0
            ? 0
            : channel.storedNewlineBytes + (channel.storedEndsWithNewline ? 0 : 1),
          storedSha256: channel.storedHash.digest("hex"),
        }])),
        eventOrder: {
          observedEvents,
          sha256: eventHash.digest("hex"),
          events: orderedEvents,
        },
      };
      resolve({
        stdout: Buffer.concat(chunks.stdout).toString("utf8"),
        stderr: Buffer.concat(chunks.stderr).toString("utf8"),
        status,
        signal,
        error: spawnError,
        outputLimitError,
        streamAccounting,
      });
    });
  });
}

function filesBelow(directory, repoRoot) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(repoRoot, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));
}

function nodeTapSummaries(output, marker) {
  const lines = output.split(/\r?\n/);
  const summaries = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(new RegExp(`^${marker} tests (\\d+)$`));
    if (!match) continue;
    const summary = { tests: Number(match[1]), pass: null, fail: null };
    for (let cursor = index + 1; cursor < Math.min(lines.length, index + 10); cursor += 1) {
      if (new RegExp(`^${marker} tests \\d+$`).test(lines[cursor])) break;
      const value = lines[cursor].match(new RegExp(`^${marker} (pass|fail) (\\d+)$`));
      if (value) summary[value[1]] = Number(value[2]);
    }
    summaries.push(summary);
  }
  return summaries;
}

function validateExpectedTotals(expected, anySummary) {
  const missing = expected.filter((item) => item.actual === null).map((item) => item.suite);
  if (missing.length > 0 || !anySummary) {
    return { ok: false, kind: "missing_tap_summary", message: `missing required TAP summary: ${missing.join(", ")}`, expected };
  }
  const drifted = expected.filter((item) => item.actual.tests !== item.tests || item.actual.pass !== item.pass || item.actual.fail !== item.fail);
  if (drifted.length > 0) {
    return { ok: false, kind: "totals_drift", message: "required TAP totals drifted", expected };
  }
  return { ok: true, expected };
}

function validateRootTotals(output) {
  const context = output.match(/(?:^|\n)(\d+) passed, (\d+) failed(?:\n|$)/);
  const summaries = nodeTapSummaries(output, "#");
  return validateExpectedTotals([
    { suite: "context", tests: 81, pass: 81, fail: 0, actual: context ? { tests: Number(context[1]) + Number(context[2]), pass: Number(context[1]), fail: Number(context[2]) } : null },
    { suite: "root", tests: 417, pass: 417, fail: 0, actual: summaries[0] ?? null },
    { suite: "deepseekHarnessBundle", tests: 6, pass: 6, fail: 0, actual: summaries[1] ?? null },
  ], context !== null || summaries.length > 0);
}

function validateMcpTotals(output) {
  const summaries = nodeTapSummaries(output, "ℹ");
  return validateExpectedTotals([
    { suite: "mcp", tests: 426, pass: 426, fail: 0, actual: summaries[0] ?? null },
  ], summaries.length > 0);
}

export async function runFreshCheckout({
  repoRoot = root,
  executor = executeChild,
  stdout = process.stdout,
  stderr = process.stderr,
  env = process.env,
} = {}) {
  let emittedBytes = 0;
  const emit = (writer, value) => {
    const bytes = Buffer.byteLength(value);
    if (emittedBytes + bytes >= HELPER_EMISSION_CAP_BYTES) {
      throw new FreshCheckoutError("collector_failure", "helper emission exceeded the 256 KiB cap");
    }
    emittedBytes += bytes;
    writer.write(value);
  };
  const run = async (command, args, validate = null) => {
    let result;
    try {
      result = await executor(command, args, { cwd: repoRoot, env });
    } catch (error) {
      result = {
        stdout: "",
        stderr: "",
        status: null,
        signal: null,
        error: { code: error.code ?? "CORTEX_COLLECTOR_FAILURE", message: error.message ?? String(error) },
        outputLimitError: null,
      };
      emit(stderr, diagnosticEnvelope("collector_failure", command, args, result, repoRoot));
      const failure = new FreshCheckoutError("collector_failure", `${commandText(command, args)} output collector failed`);
      failure.diagnosticEmitted = true;
      throw failure;
    }
    const processKind = classifyProcess(result);
    if (processKind !== "success") {
      emit(stderr, diagnosticEnvelope(processKind, command, args, result, repoRoot));
      const failure = new FreshCheckoutError(processKind, `${commandText(command, args)} failed (${processKind})`);
      failure.diagnosticEmitted = true;
      throw failure;
    }
    if (validate) {
      const validation = validate(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
      if (!validation.ok) {
        emit(stderr, diagnosticEnvelope(validation.kind, command, args, result, repoRoot, validation));
        const failure = new FreshCheckoutError(validation.kind, validation.message);
        failure.diagnosticEmitted = true;
        throw failure;
      }
    }
    emit(stdout, successEnvelope(command, args, result, repoRoot));
    return result;
  };

  const initial = [
    ...filesBelow(path.join(repoRoot, ".context"), repoRoot),
    ...filesBelow(path.join(repoRoot, "scaffold", ".context"), repoRoot),
  ].sort();
  const unexpected = initial.filter((file) => !trackedContext.has(file));
  if (unexpected.length > 0) {
    const listing = unexpected.join("\n");
    const result = {
      stdout: "",
      stderr: listing,
      status: null,
      signal: null,
      error: {
        code: "CORTEX_GENERATED_CONTEXT_PRESENT",
        message: `${unexpected.length} generated context path(s) present; sha256=${sha256(listing)}`,
      },
      outputLimitError: null,
    };
    emit(stderr, diagnosticEnvelope("precondition", "fresh-checkout", ["precondition"], result, repoRoot));
    const failure = new FreshCheckoutError("precondition", "checkout already contains generated context state");
    failure.diagnosticEmitted = true;
    throw failure;
  }

  await run(process.execPath, ["scripts/release-artifacts.mjs", "root-context"]);
  await run("npm", ["test"], validateRootTotals);
  await run(process.execPath, ["scripts/release-artifacts.mjs", "mcp-context"]);
  await run("npm", ["--prefix", "scaffold/mcp", "run", "test:ci"], validateMcpTotals);

  emit(stdout, `${JSON.stringify({
    ok: true,
    context: "81/81",
    root: "417/417",
    deepseekHarnessBundle: "6/6",
    mcp: "426/426",
  })}\n`);
  return { ok: true, emittedBytes };
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  runFreshCheckout().catch((error) => {
    if (!error.diagnosticEmitted) process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
