#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const SCAFFOLD_ROOT = path.join(PACKAGE_ROOT, "scaffold");
const PACKAGE_JSON_PATH = path.join(PACKAGE_ROOT, "package.json");

const GITIGNORE_LINES = [
  "",
  "# Cortex local storage",
  ".context/db/",
  ".context/embeddings/",
  ".context/cache/",
  ".context/plan/",
  "mcp/.npm-cache/",
  "mcp/dist/",
  "mcp/node_modules/"
];

const CORTEX_LOGO = [
  "  CCC    OOO   RRRR  TTTTT  EEEEE  X   X",
  " C   C  O   O  R   R   T    E       X X",
  " C      O   O  RRRR    T    EEEE     X",
  " C   C  O   O  R  R    T    E       X X",
  "  CCC    OOO   R   R   T    EEEEE  X   X"
].join("\n");

function printBanner(title) {
  console.log(CORTEX_LOGO);
  if (title) {
    console.log(title);
  }
  console.log("");
}

function printHelp() {
  console.log("Cortex CLI");
  console.log("");
  console.log("Usage:");
  console.log("  cortex init [path] [--force] [--bootstrap] [--connect] [--no-connect] [--watch] [--no-watch]");
  console.log("  cortex connect [path] [--skip-build]");
  console.log("  cortex watch [start|stop|status|run|once] [--interval <sec>] [--debounce <sec>]");
  console.log("  cortex bootstrap");
  console.log("  cortex update");
  console.log("  cortex status");
  console.log("  cortex ingest [--changed] [--verbose]");
  console.log("  cortex embed [--changed]");
  console.log("  cortex graph-load [--no-reset]");
  console.log("  cortex note <title> [text]");
  console.log("  cortex plan");
  console.log("  cortex todo [text|list|done <id>|reopen <id>|remove <id>]");
  console.log("  cortex help");
}

function readCliVersion() {
  try {
    const parsed = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8"));
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function parseInitArgs(args) {
  let target = process.cwd();
  let force = false;
  let bootstrap = false;
  let connect = true;
  let watch = true;

  for (const arg of args) {
    if (arg === "--force") {
      force = true;
      continue;
    }

    if (arg === "--bootstrap") {
      bootstrap = true;
      continue;
    }

    if (arg === "--connect") {
      connect = true;
      continue;
    }

    if (arg === "--no-connect") {
      connect = false;
      continue;
    }

    if (arg === "--watch") {
      watch = true;
      continue;
    }

    if (arg === "--no-watch") {
      watch = false;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown init option: ${arg}`);
    }

    target = path.resolve(arg);
  }

  return { target, force, bootstrap, connect, watch };
}

function parseConnectArgs(args) {
  let target = process.cwd();
  let skipBuild = false;

  for (const arg of args) {
    if (arg === "--skip-build") {
      skipBuild = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown connect option: ${arg}`);
    }

    target = path.resolve(arg);
  }

  return { target, skipBuild };
}

function ensureScaffoldExists() {
  if (!fs.existsSync(SCAFFOLD_ROOT)) {
    throw new Error(`Scaffold not found at ${SCAFFOLD_ROOT}`);
  }
}

function copyDirectory(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
      continue;
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    const sourceMode = fs.statSync(sourcePath).mode;
    fs.chmodSync(targetPath, sourceMode);
  }
}

function ensurePathWritable(targetPath, force) {
  if (!fs.existsSync(targetPath)) {
    return;
  }

  if (!force) {
    throw new Error(
      `Refusing to overwrite existing path: ${targetPath}\nRun with --force to overwrite scaffold files.`
    );
  }
}

function mergeGitignore(targetDir) {
  const gitignorePath = path.join(targetDir, ".gitignore");
  const current = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8") : "";
  const merged = current + GITIGNORE_LINES.filter((line) => !current.includes(line)).join("\n") + "\n";
  fs.writeFileSync(gitignorePath, merged, "utf8");
}

function installScaffold(targetDir, force) {
  const copyMap = [
    [path.join(SCAFFOLD_ROOT, ".context"), path.join(targetDir, ".context")],
    [path.join(SCAFFOLD_ROOT, "scripts"), path.join(targetDir, "scripts")],
    [path.join(SCAFFOLD_ROOT, "mcp"), path.join(targetDir, "mcp")]
  ];

  for (const [sourcePath, targetPath] of copyMap) {
    ensurePathWritable(targetPath, force);
    copyDirectory(sourcePath, targetPath);
  }

  const docsDir = path.join(targetDir, "docs");
  fs.mkdirSync(docsDir, { recursive: true });
  const docsSource = path.join(SCAFFOLD_ROOT, "docs", "architecture.md");
  const docsTarget = path.join(docsDir, "cortex-architecture.md");
  if (!fs.existsSync(docsTarget) || force) {
    fs.copyFileSync(docsSource, docsTarget);
  }

  mergeGitignore(targetDir);
}

function writeTextFile(targetPath, content) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, "utf8");
}

function upsertTextFile(targetPath, content) {
  if (fs.existsSync(targetPath)) {
    const existing = fs.readFileSync(targetPath, "utf8");
    if (existing === content) {
      return false;
    }
  }
  writeTextFile(targetPath, content);
  return true;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function upsertSectionByMarkers(targetPath, startMarker, endMarker, sectionContent) {
  const block = `${startMarker}\n${sectionContent.trimEnd()}\n${endMarker}`;
  const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf8") : "";
  const hasMarkers = existing.includes(startMarker) && existing.includes(endMarker);

  if (hasMarkers) {
    const pattern = new RegExp(`${escapeRegex(startMarker)}[\\s\\S]*?${escapeRegex(endMarker)}`);
    const replaced = existing.replace(pattern, block);
    if (replaced === existing) {
      return false;
    }
    writeTextFile(targetPath, replaced.endsWith("\n") ? replaced : `${replaced}\n`);
    return true;
  }

  let next = existing;
  if (next.length > 0 && !next.endsWith("\n")) {
    next += "\n";
  }
  if (next.trim().length > 0 && !next.endsWith("\n\n")) {
    next += "\n";
  }
  next += `${block}\n`;
  writeTextFile(targetPath, next);
  return true;
}

function installClaudeCommands(targetDir) {
  const commandSpecs = [
    {
      file: "note.md",
      content: `---
description: "Save important project context into Cortex notes"
argument-hint: "<title> [details]"
---
Execute: cortex note "$ARGUMENTS"
`
    },
    {
      file: "todo.md",
      content: `---
description: "Add or list Cortex TODOs"
argument-hint: "<text|list|done <id>|reopen <id>|remove <id>>"
---
Execute: cortex todo "$ARGUMENTS"
`
    },
    {
      file: "plan.md",
      content: `---
description: "Show Cortex auto-plan progress"
---
Execute: cortex plan
`
    },
    {
      file: "context-update.md",
      content: `---
description: "Refresh Cortex context for changed files"
---
Execute: cortex update
`
    }
  ];

  const commandsDir = path.join(targetDir, ".claude", "commands");
  let changed = 0;
  for (const spec of commandSpecs) {
    const targetPath = path.join(commandsDir, spec.file);
    if (upsertTextFile(targetPath, spec.content)) {
      changed += 1;
    }
  }
  return { total: commandSpecs.length, changed };
}

function installCodexAgentsSection(targetDir) {
  const agentsPath = path.join(targetDir, "AGENTS.md");
  const startMarker = "<!-- cortex:auto:start -->";
  const endMarker = "<!-- cortex:auto:end -->";
  const section = `## Cortex Auto Workflow
- Use \`cortex todo "<task>"\` for every new implementation task.
- Use \`cortex note "<title>" "<details>"\` when an important decision is made.
- Run \`cortex update\` before completing substantial code changes.
- Use \`cortex plan\` to inspect current progress and next command.
- If background sync is enabled, check with \`cortex watch status\`.`;
  const changed = upsertSectionByMarkers(agentsPath, startMarker, endMarker, section);
  return { path: agentsPath, changed };
}

function installAssistantHelpers(targetDir) {
  const claude = installClaudeCommands(targetDir);
  const codex = installCodexAgentsSection(targetDir);
  return { claude, codex };
}

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: process.env
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
      }
    });
  });
}

function runCommandResult(command, args, cwd, stdio = "ignore") {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) {
        return;
      }
      done = true;
      resolve(result);
    };

    const child = spawn(command, args, {
      cwd,
      stdio,
      env: process.env
    });

    child.on("error", (error) => finish({ ok: false, code: null, error }));
    child.on("exit", (code) => finish({ ok: code === 0, code, error: null }));
  });
}

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function commandExists(command, cwd) {
  const result = await runCommandResult(command, ["--version"], cwd, "ignore");
  return result.ok;
}

function normalizeName(value) {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "repo";
}

async function connectCodex(targetDir, serverEntry) {
  if (!(await commandExists("codex", targetDir))) {
    console.log("[cortex] codex CLI not found, skipping Codex MCP registration");
    return false;
  }

  const repoName = normalizeName(path.basename(targetDir));
  const serverName = `cortex-${repoName}`;
  await runCommandResult("codex", ["mcp", "remove", serverName], targetDir, "ignore");
  await runCommand("codex", ["mcp", "add", serverName, "--", "node", serverEntry], targetDir);
  console.log(`[cortex] connected Codex MCP server: ${serverName}`);
  return true;
}

async function connectClaude(targetDir) {
  if (!(await commandExists("claude", targetDir))) {
    console.log("[cortex] claude CLI not found, skipping Claude Code MCP registration");
    return false;
  }

  const serverName = "cortex";
  const projectServerEntry = path.join("mcp", "dist", "server.js");
  await runCommandResult("claude", ["mcp", "remove", "-s", "project", serverName], targetDir, "ignore");
  await runCommand(
    "claude",
    ["mcp", "add", "-s", "project", serverName, "--", "node", projectServerEntry],
    targetDir
  );
  console.log("[cortex] connected Claude Code MCP server: cortex (project scope)");
  return true;
}

async function connectMcpClients(targetDir, options = {}) {
  const { skipBuild = false } = options;
  const mcpDir = path.join(targetDir, "mcp");
  const packageJson = path.join(mcpDir, "package.json");
  const nodeModules = path.join(mcpDir, "node_modules");
  const serverEntry = path.join(mcpDir, "dist", "server.js");

  if (!fs.existsSync(packageJson)) {
    throw new Error(`Missing ${packageJson}. Run 'cortex init' first.`);
  }

  if (!skipBuild && fs.existsSync(nodeModules)) {
    try {
      await runCommand("npm", ["--prefix", mcpDir, "run", "build", "--silent"], targetDir);
    } catch (error) {
      console.log(`[cortex] MCP build failed, continuing with existing dist output: ${toErrorMessage(error)}`);
    }
  } else if (!skipBuild) {
    console.log("[cortex] mcp/node_modules not found, skipping build (run cortex bootstrap first)");
  }

  if (!fs.existsSync(serverEntry)) {
    console.log(`[cortex] warning: ${serverEntry} not found yet; run cortex bootstrap before first MCP call`);
  }

  let connected = 0;

  try {
    if (await connectCodex(targetDir, serverEntry)) {
      connected += 1;
    }
  } catch (error) {
    console.log(`[cortex] failed to connect Codex MCP: ${toErrorMessage(error)}`);
  }

  try {
    if (await connectClaude(targetDir)) {
      connected += 1;
    }
  } catch (error) {
    console.log(`[cortex] failed to connect Claude MCP: ${toErrorMessage(error)}`);
  }

  if (connected === 0) {
    console.log("[cortex] no MCP clients connected");
  }

  return connected;
}

async function runContextCommand(cwd, contextArgs) {
  const contextScript = path.join(cwd, "scripts", "context.sh");
  if (!fs.existsSync(contextScript)) {
    throw new Error(`Missing ${contextScript}. Run 'cortex init' first.`);
  }
  await runCommand("bash", [contextScript, ...contextArgs], cwd);
}

async function markPlanEvent(targetDir, eventName) {
  const planScript = path.join(targetDir, "scripts", "plan-state.sh");
  if (!fs.existsSync(planScript)) {
    return;
  }

  const result = await runCommandResult("bash", [planScript, "event", eventName], targetDir, "ignore");
  if (!result.ok) {
    console.log(`[cortex] warning: failed to update automatic plan state for event '${eventName}'`);
  }
}

async function run() {
  const cliVersion = readCliVersion();
  process.env.CORTEX_CLI_VERSION = cliVersion;

  const [rawCommand, ...rest] = process.argv.slice(2);
  const command = rawCommand ?? "help";

  if (command === "version" || command === "--version" || command === "-V") {
    console.log(cliVersion);
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "init") {
    ensureScaffoldExists();
    const { target, force, bootstrap, connect, watch } = parseInitArgs(rest);
    printBanner("Cortex initializes repo-scoped context for AI coding agents.");
    fs.mkdirSync(target, { recursive: true });
    installScaffold(target, force);
    const helpers = installAssistantHelpers(target);
    await markPlanEvent(target, "init");

    console.log(`[cortex] initialized in ${target}`);
    console.log("[cortex] scaffold copied: .context/, scripts/, mcp/, docs/");
    console.log(`[cortex] Claude commands ready: /note /todo /plan /context-update (${helpers.claude.total} files)`);
    if (helpers.codex.changed) {
      console.log("[cortex] Codex workflow instructions added to AGENTS.md");
    } else {
      console.log("[cortex] Codex workflow instructions already up to date in AGENTS.md");
    }

    if (bootstrap) {
      console.log("[cortex] bootstrap: install deps -> ingest -> embeddings -> graph");
    } else {
      console.log("[cortex] next: cortex bootstrap");
    }

    if (connect) {
      console.log("[cortex] MCP connect: Codex + Claude Code (if CLIs are installed)");
    } else {
      console.log("[cortex] MCP connect skipped (--no-connect)");
    }

    if (watch) {
      if (bootstrap) {
        console.log("[cortex] background sync: cortex watch start");
      } else {
        console.log("[cortex] background sync pending: run cortex watch start after bootstrap");
      }
    } else {
      console.log("[cortex] background sync skipped (--no-watch)");
    }

    if (!bootstrap) {
      console.log("");
    }

    if (bootstrap) {
      await runContextCommand(target, ["bootstrap"]);
    }

    if (connect) {
      const connected = await connectMcpClients(target);
      if (connected > 0) {
        await markPlanEvent(target, "connect");
      }
    }

    if (watch && bootstrap) {
      await runContextCommand(target, ["watch", "start"]);
    }
    return;
  }

  if (command === "connect") {
    const { target, skipBuild } = parseConnectArgs(rest);
    const helpers = installAssistantHelpers(target);
    if (helpers.claude.changed > 0 || helpers.codex.changed) {
      console.log("[cortex] assistant helpers updated (.claude/commands + AGENTS.md)");
    }
    const connected = await connectMcpClients(target, { skipBuild });
    if (connected > 0) {
      await markPlanEvent(target, "connect");
    }
    return;
  }

  const passthrough = new Set([
    "bootstrap",
    "update",
    "status",
    "ingest",
    "embed",
    "graph-load",
    "watch",
    "note",
    "plan",
    "todo",
    "refresh"
  ]);

  if (!passthrough.has(command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  await runContextCommand(process.cwd(), [command, ...rest]);
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
