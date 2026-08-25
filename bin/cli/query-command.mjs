import path from "node:path";
import { loadProjectCliModule } from "./project-runtime.mjs";

const CONVENTION_PUBLIC_ERROR = "Convention inspection failed safely";
const CONVENTION_INPUT_LIMITS = {
  identifier: 1_000,
  path: 1_024,
};
const UNSAFE_VISIBLE_TEXT_PATTERN = /[\p{Cc}\p{Zl}\p{Zp}\p{Bidi_Control}]/u;

export const QUERY_COMMANDS = new Set([
  "search",
  "related",
  "impact",
  "rules",
  "explain",
  "pattern-evidence",
  "conventions",
]);

export async function runQueryCommandShim(command, args) {
  const target = process.env.CORTEX_PROJECT_ROOT?.trim() || process.cwd();
  process.env.CORTEX_PROJECT_ROOT = path.resolve(target);
  let mod;
  try {
    mod = await loadProjectCliModule("query");
  } catch (error) {
    if (command !== "conventions") throw error;
    if (args.includes("--json")) {
      process.stdout.write(serializeConventionLoaderError(args));
      process.exitCode = 1;
      return;
    }
    throw new Error(CONVENTION_PUBLIC_ERROR);
  }
  await mod.runQueryCommand([command, ...args]);
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
