import fs from "node:fs";
import path from "node:path";
import { restartDaemonAfterRuntimeUpgrade } from "./daemon.mjs";
import { CONTEXT_SCRIPTS_REL } from "./paths.mjs";
import { runCommand } from "./process.mjs";
import {
  ensureScaffoldExists,
  hardenEnterpriseConfigPermissions,
  initializeScaffold,
  installAssistantHelpers,
  isScaffoldOutOfDate,
  isTruthyEnv,
  maybeInstallGitHooks,
} from "./scaffold.mjs";

export const PASSTHROUGH_COMMANDS = new Set([
  "bootstrap",
  "indexing",
  "update",
  "status",
  "ingest",
  "embed",
  "graph-load",
  "dashboard",
  "watch",
  "refresh",
  "memory-compile",
  "memory-lint",
  "doctor",
]);

const INDEX_MUTATING_COMMANDS = new Set([
  "bootstrap",
  "indexing",
  "update",
  "refresh",
  "ingest",
  "embed",
  "graph-load",
]);

function invalidateSessionStatusCache(cwd) {
  try {
    fs.rmSync(
      path.join(cwd, ".context", "cache", "session-status.json"),
      { force: true },
    );
  } catch {
    // Best effort: a stale cache only delays the status refresh.
  }
}

export async function runContextCommand(cwd, contextArgs) {
  const contextScript = path.join(cwd, CONTEXT_SCRIPTS_REL, "context.sh");
  if (!fs.existsSync(contextScript)) {
    throw new Error(`Missing ${contextScript}. Run 'cortex init' first.`);
  }
  try {
    await runCommand("bash", [contextScript, ...contextArgs], cwd);
  } finally {
    if (INDEX_MUTATING_COMMANDS.has(contextArgs[0])) {
      invalidateSessionStatusCache(cwd);
    }
  }
}

async function confirmPrompt(message) {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    const answer = (await rl.question(message)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

export async function maybeMigrateScaffold(targetDir, command) {
  if (!isScaffoldOutOfDate(targetDir)) return;

  const autoYes = isTruthyEnv(process.env.CORTEX_AUTO_MIGRATE);
  const interactive = Boolean(process.stdin.isTTY && process.stderr.isTTY);

  console.error(
    `[cortex] scaffold in ${targetDir} is out of date ` +
      `(missing .context/scripts/doctor.sh or indexing.mjs, context runtime package.json, required context.sh routing, ` +
      `or carries a legacy mcp/ directory at the project root).`,
  );

  let proceed = autoYes;
  if (!autoYes) {
    if (!interactive) {
      throw new Error(
        `Cortex CLI ${process.env.CORTEX_CLI_VERSION ?? ""} needs an updated scaffold to run '${command}'. ` +
          `Run 'cortex init --bootstrap' to upgrade, or re-run with CORTEX_AUTO_MIGRATE=true.`,
      );
    }
    proceed = await confirmPrompt(
      "[cortex] Upgrade scaffold now (runs 'cortex init --bootstrap')? [y/N] ",
    );
  }

  if (!proceed) {
    throw new Error(
      "Scaffold upgrade declined. Run 'cortex init --bootstrap' manually to continue.",
    );
  }

  console.error(`[cortex] migrating scaffold in ${targetDir}`);
  ensureScaffoldExists();
  initializeScaffold(targetDir, true);
  installAssistantHelpers(targetDir);
  await maybeInstallGitHooks(targetDir);
  if (scaffoldMigrationRequiresBootstrap(command)) {
    await runContextCommand(targetDir, ["bootstrap"]);
  }
  console.error(`[cortex] scaffold upgraded; continuing with '${command}'`);
}

export function scaffoldMigrationRequiresBootstrap(command) {
  return command !== "bootstrap";
}

export async function runPassthroughCommand(command, rest) {
  const cwd = process.cwd();
  await maybeMigrateScaffold(cwd, command);
  if (command === "bootstrap") {
    hardenEnterpriseConfigPermissions(cwd);
  }
  await runContextCommand(cwd, [command, ...rest]);
  if (command === "bootstrap") {
    await restartDaemonAfterRuntimeUpgrade(cwd);
  }
}
