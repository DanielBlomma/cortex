import fs from "node:fs";
import path from "node:path";
import { normalizeProjectRoot } from "../wsl.mjs";
import {
  maybeMigrateScaffold,
  runContextCommand,
} from "./context-passthrough.mjs";
import { MCP_PROJECT_REL } from "./paths.mjs";
import { runCommand } from "./process.mjs";
import {
  canAutoInitialize,
  ensureProjectInitialized,
  ensureScaffoldExists,
  initializeScaffold,
  installAssistantHelpers,
  isScaffoldOutOfDate,
  isTruthyEnv,
  maybeInstallGitHooks,
} from "./scaffold.mjs";

async function ensureProjectInitializedForMcp(targetDir) {
  const mcpPackageJson = path.join(
    targetDir,
    MCP_PROJECT_REL,
    "package.json",
  );
  const serverEntry = path.join(
    targetDir,
    MCP_PROJECT_REL,
    "dist",
    "server.js",
  );

  if (fs.existsSync(mcpPackageJson) && fs.existsSync(serverEntry)) return;

  if (isScaffoldOutOfDate(targetDir)) {
    await maybeMigrateScaffold(targetDir, "mcp");
    if (fs.existsSync(mcpPackageJson) && fs.existsSync(serverEntry)) return;
  }

  if (!isTruthyEnv(process.env.CORTEX_AUTO_BOOTSTRAP_ON_MCP)) {
    ensureProjectInitialized(targetDir);
    return;
  }

  if (!fs.existsSync(mcpPackageJson)) {
    if (!canAutoInitialize(targetDir)) {
      throw new Error(
        `Cannot auto-initialize Cortex in ${targetDir}: scaffold paths already exist. Run 'cortex init --bootstrap' manually.`,
      );
    }
    ensureScaffoldExists();
    fs.mkdirSync(targetDir, { recursive: true });
    initializeScaffold(targetDir, false);
    installAssistantHelpers(targetDir);
    await maybeInstallGitHooks(targetDir);
    console.log(`[cortex] auto-init completed in ${targetDir}`);
  }

  if (!fs.existsSync(serverEntry)) {
    console.log("[cortex] auto-bootstrap: running initial bootstrap for MCP");
    await runContextCommand(targetDir, ["bootstrap"]);
  }
}

export async function runMcpCommand() {
  const rawTarget = process.env.CORTEX_PROJECT_ROOT || process.cwd();
  const target = path.resolve(normalizeProjectRoot(rawTarget));
  process.env.CORTEX_PROJECT_ROOT = target;
  await ensureProjectInitializedForMcp(target);
  ensureProjectInitialized(target);
  const serverEntry = path.join(
    target,
    MCP_PROJECT_REL,
    "dist",
    "server.js",
  );
  if (!fs.existsSync(serverEntry)) {
    throw new Error(
      `Missing ${serverEntry}. Run 'cortex bootstrap' in ${target} first.`,
    );
  }
  process.stderr.write(
    `[cortex] starting MCP stdio server from ${serverEntry}\n`,
  );
  await runCommand("node", [serverEntry], target);
}
