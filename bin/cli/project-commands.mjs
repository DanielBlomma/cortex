import fs from "node:fs";
import path from "node:path";
import { parseConnectArgs, parseInitArgs } from "./arguments.mjs";
import { runContextCommand } from "./context-passthrough.mjs";
import { restartDaemonAfterRuntimeUpgrade } from "./daemon.mjs";
import { printBanner } from "./help.mjs";
import { MCP_PROJECT_REL } from "./paths.mjs";
import {
  commandExists,
  runCommand,
  runCommandResult,
  toErrorMessage,
} from "./process.mjs";
import {
  ensureProjectInitialized,
  ensureScaffoldExists,
  hardenEnterpriseConfigPermissions,
  initializeScaffold,
  installAssistantHelpers,
  maybeInstallGitHooks,
} from "./scaffold.mjs";

function normalizeName(value) {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "repo";
}

async function connectCodex(targetDir, serverEntry) {
  if (!(await commandExists("codex", targetDir))) {
    console.log(
      "[cortex] codex CLI not found, skipping Codex MCP registration",
    );
    return false;
  }

  const repoName = normalizeName(path.basename(targetDir));
  const serverName = `cortex-${repoName}`;
  await runCommandResult(
    "codex",
    ["mcp", "remove", serverName],
    targetDir,
    "ignore",
  );
  await runCommand(
    "codex",
    ["mcp", "add", serverName, "--", "node", serverEntry],
    targetDir,
  );
  console.log(`[cortex] connected Codex MCP server: ${serverName}`);
  return true;
}

async function connectClaude(targetDir) {
  if (!(await commandExists("claude", targetDir))) {
    console.log(
      "[cortex] claude CLI not found, skipping Claude Code MCP registration",
    );
    return false;
  }

  const serverName = "cortex";
  const projectServerEntry = path.join(
    MCP_PROJECT_REL,
    "dist",
    "server.js",
  );
  await runCommandResult(
    "claude",
    ["mcp", "remove", "-s", "project", serverName],
    targetDir,
    "ignore",
  );
  await runCommand(
    "claude",
    [
      "mcp",
      "add",
      "-s",
      "project",
      serverName,
      "--",
      "node",
      projectServerEntry,
    ],
    targetDir,
  );
  console.log(
    "[cortex] connected Claude Code MCP server: cortex (project scope)",
  );
  return true;
}

async function connectMcpClients(targetDir, options = {}) {
  const { skipBuild = false } = options;
  const mcpDir = path.join(targetDir, MCP_PROJECT_REL);
  const packageJson = path.join(mcpDir, "package.json");
  const nodeModules = path.join(mcpDir, "node_modules");
  const serverEntry = path.join(mcpDir, "dist", "server.js");

  if (!fs.existsSync(packageJson)) {
    throw new Error(`Missing ${packageJson}. Run 'cortex init' first.`);
  }

  if (!skipBuild && fs.existsSync(nodeModules)) {
    try {
      await runCommand(
        "npm",
        ["--prefix", mcpDir, "run", "build", "--silent"],
        targetDir,
      );
    } catch (error) {
      console.log(
        `[cortex] MCP build failed, continuing with existing dist output: ${toErrorMessage(error)}`,
      );
    }
  } else if (!skipBuild) {
    console.log(
      "[cortex] .context/mcp/node_modules not found, skipping build (run cortex bootstrap first)",
    );
  }

  if (!fs.existsSync(serverEntry)) {
    console.log(
      `[cortex] warning: ${serverEntry} not found yet; run cortex bootstrap before first MCP call`,
    );
  }

  let connected = 0;

  try {
    if (await connectCodex(targetDir, serverEntry)) connected += 1;
  } catch (error) {
    console.log(
      `[cortex] failed to connect Codex MCP: ${toErrorMessage(error)}`,
    );
  }

  try {
    if (await connectClaude(targetDir)) connected += 1;
  } catch (error) {
    console.log(
      `[cortex] failed to connect Claude MCP: ${toErrorMessage(error)}`,
    );
  }

  if (connected === 0) {
    console.log("[cortex] no MCP clients connected");
  }

  return connected;
}

export async function runInitCommand(args) {
  ensureScaffoldExists();
  const { target, force, bootstrap, connect, watch } = parseInitArgs(args);
  printBanner("Cortex initializes repo-scoped context for AI coding agents.");
  fs.mkdirSync(target, { recursive: true });
  initializeScaffold(target, force);
  hardenEnterpriseConfigPermissions(target);
  const helpers = installAssistantHelpers(target);
  await maybeInstallGitHooks(target);

  console.log(`[cortex] initialized in ${target}`);
  console.log(
    "[cortex] scaffold copied: .context/, .context/scripts/, context runtime (.context/mcp compatibility path), .githooks/, docs/",
  );
  console.log(
    `[cortex] Claude commands ready: /context-update (${helpers.claude.total} files)`,
  );
  if (helpers.codex.changed) {
    console.log("[cortex] Codex workflow instructions added to AGENTS.md");
  } else {
    console.log(
      "[cortex] Codex workflow instructions already up to date in AGENTS.md",
    );
  }

  if (bootstrap) {
    console.log(
      "[cortex] bootstrap: install deps -> ingest -> embeddings -> graph",
    );
  } else {
    console.log("[cortex] next: cortex bootstrap");
  }

  if (connect) {
    console.log(
      "[cortex] MCP connect: Codex + Claude Code (if CLIs are installed)",
    );
  } else {
    console.log(
      "[cortex] MCP connect skipped (run 'cortex connect' or init with --connect)",
    );
  }

  if (watch) {
    if (bootstrap) {
      console.log("[cortex] background sync: cortex watch start");
    } else {
      console.log(
        "[cortex] background sync pending: run cortex watch start after bootstrap",
      );
    }
  } else {
    console.log("[cortex] background sync skipped (--no-watch)");
  }

  if (!bootstrap) console.log("");

  if (bootstrap) {
    await runContextCommand(target, ["bootstrap"]);
    await restartDaemonAfterRuntimeUpgrade(target);
  }

  if (connect) {
    await connectMcpClients(target);
  }

  if (watch && bootstrap) {
    await runContextCommand(target, ["watch", "start"]);
  }
}

export async function runConnectCommand(args) {
  const { target, skipBuild } = parseConnectArgs(args);
  ensureProjectInitialized(target);
  const helpers = installAssistantHelpers(target);
  if (helpers.claude.changed > 0 || helpers.codex.changed) {
    console.log(
      "[cortex] assistant helpers updated (.claude/commands + AGENTS.md)",
    );
  }
  await connectMcpClients(target, { skipBuild });
}
