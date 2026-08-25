import crypto from "node:crypto";
import path from "node:path";
import { loadProjectCliModule } from "./project-runtime.mjs";

const CONVENTION_PUBLIC_ERROR = "Convention inspection failed safely";
const CONVENTION_INPUT_LIMITS = {
  identifier: 1_000,
  path: 1_024,
};
const UNSAFE_VISIBLE_TEXT_PATTERN = /[\p{Cc}\p{Zl}\p{Zp}\p{Bidi_Control}]/u;
const GUIDANCE_PUBLIC_ERROR = "Guidance failed safely";
const GUIDANCE_TASK_LIMITS = { scalars: 4_096, bytes: 16_384 };
const REVIEW_PUBLIC_ERROR = "Review failed safely";

export const QUERY_COMMANDS = new Set([
  "search",
  "related",
  "impact",
  "rules",
  "explain",
  "pattern-evidence",
  "conventions",
  "guidance",
  "review",
]);

export async function runQueryCommandShim(command, args) {
  const target = process.env.CORTEX_PROJECT_ROOT?.trim() || process.cwd();
  process.env.CORTEX_PROJECT_ROOT = path.resolve(target);
  if (command === "guidance") {
    try {
      const parsed = parseGuidanceLoaderArgs(args);
      validateGuidanceLoaderTarget(parsed.target);
      if (
        parsed.task.length === 0 || parsed.task !== parsed.task.trim() ||
        UNSAFE_VISIBLE_TEXT_PATTERN.test(parsed.task) ||
        unicodeScalarCount(parsed.task) > GUIDANCE_TASK_LIMITS.scalars ||
        Buffer.byteLength(parsed.task, "utf8") > GUIDANCE_TASK_LIMITS.bytes
      ) throw new Error("invalid");
    } catch {
      if (args.includes("--json")) {
        process.stdout.write(serializeGuidanceLoaderError(args));
        process.exitCode = 1;
        return;
      }
      throw new Error(GUIDANCE_PUBLIC_ERROR);
    }
  }
  if (command === "review") {
    try {
      parseReviewLoaderArgs(args);
    } catch {
      if (args.includes("--json")) {
        process.stdout.write(serializeReviewLoaderError());
        process.exitCode = 1;
        return;
      }
      throw new Error(REVIEW_PUBLIC_ERROR);
    }
  }
  let mod;
  try {
    mod = await loadProjectCliModule("query");
  } catch (error) {
    if (command !== "conventions" && command !== "guidance" && command !== "review") throw error;
    if (command === "review") {
      if (args.includes("--json")) {
        process.stdout.write(serializeReviewLoaderError());
        process.exitCode = 1;
        return;
      }
      throw new Error(REVIEW_PUBLIC_ERROR);
    }
    if (command === "guidance") {
      if (args.includes("--json")) {
        process.stdout.write(serializeGuidanceLoaderError(args));
        process.exitCode = 1;
        return;
      }
      throw new Error(GUIDANCE_PUBLIC_ERROR);
    }
    if (args.includes("--json")) {
      process.stdout.write(serializeConventionLoaderError(args));
      process.exitCode = 1;
      return;
    }
    throw new Error(CONVENTION_PUBLIC_ERROR);
  }
  await mod.runQueryCommand([command, ...args]);
}

function parseReviewLoaderArgs(args) {
  let diff = false;
  const seen = new Set();
  for (const arg of args) {
    if (arg !== "--diff" && arg !== "--json") throw new Error("invalid");
    if (seen.has(arg)) throw new Error("invalid");
    seen.add(arg);
    if (arg === "--diff") diff = true;
  }
  if (!diff) throw new Error("invalid");
  return { diff: true };
}

function serializeReviewLoaderError() {
  return `${JSON.stringify({
    ok: false,
    command: "review",
    schema_version: 1,
    generator_version: "repo-diff-review-v1",
    input: { diff: true },
    error: { code: "INVALID_ARGS", message: REVIEW_PUBLIC_ERROR },
  }, null, 2)}\n`;
}

function serializeGuidanceLoaderError(args) {
  return `${JSON.stringify({
    ok: false,
    command: "guidance",
    schema_version: 1,
    generator_version: "repo-guidance-v1",
    input: sanitizeGuidanceLoaderInput(args),
    error: { code: "INVALID_ARGS", message: GUIDANCE_PUBLIC_ERROR },
  }, null, 2)}\n`;
}

function sanitizeGuidanceLoaderInput(args) {
  let parsed;
  try {
    parsed = parseGuidanceLoaderArgs(args);
  } catch {
    return { target: "[rejected]", task_hash: "[rejected]" };
  }
  let safeTarget = "[rejected]";
  try {
    safeTarget = validateGuidanceLoaderTarget(parsed.target);
  } catch {
    // The fallback must reject malformed targets before runtime resolution.
  }
  let taskHash = "[rejected]";
  try {
    if (
      parsed.task.length === 0 ||
      parsed.task !== parsed.task.trim() ||
      UNSAFE_VISIBLE_TEXT_PATTERN.test(parsed.task) ||
      unicodeScalarCount(parsed.task) > GUIDANCE_TASK_LIMITS.scalars ||
      Buffer.byteLength(parsed.task, "utf8") > GUIDANCE_TASK_LIMITS.bytes
    ) throw new Error("invalid");
    taskHash = crypto.createHash("sha256").update(parsed.task, "utf8").digest("hex");
  } catch {
    // The public loader boundary never echoes rejected task text.
  }
  return { target: safeTarget, task_hash: taskHash };
}

function validateGuidanceLoaderTarget(target) {
  const entityLike = /^(?:(?:file|chunk|module|project):|(?:rule|adr)[.:])/u.test(String(target));
  if (
    typeof target !== "string" || target.length === 0 || target !== target.trim() ||
    target.length > (entityLike ? CONVENTION_INPUT_LIMITS.identifier : CONVENTION_INPUT_LIMITS.path) || UNSAFE_VISIBLE_TEXT_PATTERN.test(target)
  ) throw new Error("invalid");
  const canonicalPath = (value, allowRoot = false) => {
    if (
      value.length === 0 || value.includes("\\") || value.includes(":") || value.startsWith("/") ||
      /^[A-Za-z]:/u.test(value) || value.endsWith("/") || value.includes("//") ||
      value.split("/").some((part) => part === "" || part === "." || part === "..")
    ) {
      if (allowRoot && value === ".") return value;
      throw new Error("invalid");
    }
    return value;
  };
  if (/^(?:rule|adr)(?:[.:])[A-Za-z0-9](?:[A-Za-z0-9_-]|\.(?=[A-Za-z0-9]))*$/u.test(target)) return target;
  if (/^(?:rule|adr)[.:]/u.test(target)) throw new Error("invalid");
  for (const kind of ["file", "module", "project"]) {
    const prefix = `${kind}:`;
    if (!target.startsWith(prefix)) continue;
    canonicalPath(target.slice(prefix.length), kind !== "file");
    return target;
  }
  if (target.startsWith("chunk:")) {
    const body = target.slice(6);
    const rangeSeparator = body.lastIndexOf(":");
    const nameSeparator = rangeSeparator < 0 ? -1 : body.lastIndexOf(":", rangeSeparator - 1);
    const range = rangeSeparator < 0 ? null : /^([1-9][0-9]*)-([1-9][0-9]*)$/u.exec(body.slice(rangeSeparator + 1));
    const name = nameSeparator < 0 ? "" : body.slice(nameSeparator + 1, rangeSeparator);
    if (!range || nameSeparator <= 0 || rangeSeparator <= nameSeparator + 1 || name.length === 0 || name.length > 256 || /[/:\\]/u.test(name) || UNSAFE_VISIBLE_TEXT_PATTERN.test(name)) throw new Error("invalid");
    canonicalPath(body.slice(0, nameSeparator));
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) throw new Error("invalid");
    if (target !== `chunk:${body.slice(0, nameSeparator)}:${name}:${start}-${end}`) throw new Error("invalid");
    return target;
  }
  if (/^[A-Za-z][A-Za-z0-9_-]*:/u.test(target)) throw new Error("invalid");
  canonicalPath(target);
  return target;
}

function unicodeScalarCount(value) {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error("invalid");
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error("invalid");
    }
    count += 1;
  }
  return count;
}

function parseGuidanceLoaderArgs(args) {
  let target;
  let task;
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      if (seen.has("json")) throw new Error("invalid");
      seen.add("json");
      continue;
    }
    if (arg === "--task") {
      const name = arg.slice(2);
      const next = args[index + 1];
      if (seen.has(name) || next === undefined || next.startsWith("--")) throw new Error("invalid");
      seen.add(name);
      task = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--") || target !== undefined) throw new Error("invalid");
    target = arg;
  }
  if (target === undefined || task === undefined) throw new Error("invalid");
  return { target, task };
}

function serializeConventionLoaderError(args) {
  return `${JSON.stringify({
    ok: false,
    command: "conventions",
    input: sanitizeConventionLoaderInput(args),
    error: {
      code: "INVALID_ARGS",
      message: CONVENTION_PUBLIC_ERROR,
    },
  }, null, 2)}\n`;
}

function sanitizeConventionLoaderInput(args) {
  const { flags, rest } = parseConventionArgs(args);
  const target = typeof flags.target === "string" && flags.target.length > 0
    ? flags.target
    : rest.join(" ").trim();
  const max = /^(?:(?:file|chunk|module|project):|(?:rule|adr)[.:])/u.test(target)
    ? CONVENTION_INPUT_LIMITS.identifier
    : CONVENTION_INPUT_LIMITS.path;
  if (
    target.length === 0 ||
    target.length > max ||
    target !== target.trim() ||
    UNSAFE_VISIBLE_TEXT_PATTERN.test(target)
  ) {
    return { target: "[rejected]" };
  }
  return { target };
}

function parseConventionArgs(args) {
  const flags = {};
  const rest = [];
  for (let index = 0; index < args.length;) {
    const arg = args[index];
    if (arg === "--") {
      rest.push(...args.slice(index + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const next = args[index + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[name] = true;
        index += 1;
      } else {
        flags[name] = next;
        index += 2;
      }
      continue;
    }
    rest.push(arg);
    index += 1;
  }
  return { flags, rest };
}
