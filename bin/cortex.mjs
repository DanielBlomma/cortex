#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { normalizeProjectRoot } from "./wsl.mjs";
import {
  bullet,
  printBullet,
  spinner,
  gradient,
  muted,
  accent,
  bold,
  headerBanner
} from "./style.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const SCAFFOLD_ROOT = path.join(PACKAGE_ROOT, "scaffold");
const PACKAGE_JSON_PATH = path.join(PACKAGE_ROOT, "package.json");

// v2.0.5: project layout moved mcp/ under .context/mcp/, and the
// gitignore policy flipped to "ignore everything in .context/, whitelist
// only the three editable config files". Generated artifacts (db,
// embeddings, cache, hooks, mcp/, govern.local.json) never land in git.
const MCP_PROJECT_REL = path.join(".context", "mcp");

const GITIGNORE_LINES = [
  "",
  "# Cortex local storage",
  ".context/",
  "!.context/config.yaml",
  "!.context/rules.yaml",
  "!.context/ontology.cypher",
  ".npm-cache/"
];

function printBanner(title) {
  process.stdout.write(headerBanner({ tagline: title }));
}

// Help-row formatter: "<command>" in accent cyan, gap, "<description>" in muted grey.
function helpRow(cmd, desc) {
  const target = 46;
  const pad = cmd.length >= target ? " " : " ".repeat(target - cmd.length);
  if (desc) {
    return `  ${accent(cmd)}${pad}${muted(desc)}`;
  }
  return `  ${accent(cmd)}`;
}

function helpSection(title) {
  return `\n${bold(muted(title))}`;
}

function printHelp() {
  console.log(gradient("CORTEX CLI") + muted("  ·  governance for AI coding agents"));
  console.log(muted("  Cortex is in control. Calm, intelligent, always monitoring."));
  console.log(helpSection("USAGE"));
  console.log(helpRow("cortex <command> [options]"));

  console.log(helpSection("CONTEXT"));
  console.log(helpRow("init [path]", "Scaffold a project with --force/--bootstrap/--connect/--watch"));
  console.log(helpRow("connect [path]", "Re-register MCP clients (Codex + Claude Code)"));
  console.log(helpRow("bootstrap", "Install deps, ingest, embed, load graph"));
  console.log(helpRow("update", "Refresh context for changed files"));
  console.log(helpRow("status", "Project context status"));
  console.log(helpRow("doctor", "Diagnose setup health"));
  console.log(helpRow("ingest [--changed] [--verbose]", "Re-index source files"));
  console.log(helpRow("embed [--changed]", "Recompute embeddings"));
  console.log(helpRow("graph-load [--no-reset]", "Reload the dependency graph"));
  console.log(helpRow("dashboard [--interval <sec>]", "Live local dashboard"));
  console.log(helpRow("memory-compile [--dry-run] [--verbose]", "Compile memory artifacts"));
  console.log(helpRow("memory-lint [--verbose] [--json]", "Lint compiled memory"));
  console.log(helpRow("watch [start|stop|status|run|once]", "Background sync (--interval, --debounce, --mode)"));

  console.log(helpSection("GOVERNANCE"));
  console.log(helpRow("enterprise <api-key>", "Install enforcement + hooks + daemon (sudo)"));
  console.log(helpRow("  ", "[--endpoint <url>] [--frameworks <csv>] [--no-hooks] [--no-daemon]"));
  console.log(helpRow("enterprise status", "Show local enforcement state"));
  console.log(helpRow("enterprise sync", "Force re-fetch + re-apply (sudo)"));
  console.log(helpRow("enterprise uninstall", "Remove enforcement (sudo, --break-glass --reason)"));
  console.log(helpRow("enterprise repair", "Verify managed paths, clear tamper-lock (sudo)"));
  console.log(helpRow("run <claude|codex|copilot> [args...]", "Wrap an AI CLI in cortex enforcement"));
  console.log(helpRow("daemon [start|stop|status]", "Local supervisor daemon"));
  console.log(helpRow("hooks [install|uninstall|status] [--project]", "Claude Code hooks"));
  console.log(helpRow("telemetry test", "Smoke-test the push pipeline"));

  console.log(helpSection("MISC"));
  console.log(helpRow("mcp", "Run the MCP stdio server for the current project"));
  console.log(helpRow("version", "Print CLI version"));
  console.log(helpRow("help", "This screen"));
  console.log("");
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

// Files that should never be overwritten if they already exist in the target.
// These contain user-specific configuration that would be lost on re-init.
const PRESERVE_FILES = new Set(["config.yaml", "enterprise.yml", "enterprise.yaml", "CLAUDE.md"]);
const DEFAULT_SOURCE_PATHS = [
  "src",
  "docs",
  "design",
  ".context/notes",
  ".context/decisions",
  "README.md"
];
const INIT_SKIP_DIRECTORIES = new Set([
  ".git",
  ".idea",
  ".vscode",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
  ".context",
  "scripts",
  ".githooks",
  "bin",
  "obj"
]);
const INIT_SOURCE_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".adoc",
  ".rst",
  ".yaml",
  ".yml",
  ".json",
  ".toml",
  ".csv",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".java",
  ".cs",
  ".vb",
  ".sln",
  ".vbproj",
  ".csproj",
  ".fsproj",
  ".props",
  ".targets",
  ".config",
  ".resx",
  ".settings",
  ".rb",
  ".rs",
  ".php",
  ".swift",
  ".kt",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cc",
  ".hh"
]);
const ROOT_DOC_PATHS = new Set(["docs", "design"]);

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

    // Skip user-config files that already exist to avoid overwriting custom settings
    if (PRESERVE_FILES.has(entry.name) && fs.existsSync(targetPath)) {
      continue;
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    const sourceMode = fs.statSync(sourcePath).mode;
    fs.chmodSync(targetPath, sourceMode);
  }
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function yamlScalar(value) {
  return /^[A-Za-z0-9._/-]+$/.test(value) ? value : JSON.stringify(value);
}

function slugifyRepoId(value) {
  const dashed = String(value || "")
    .trim()
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return dashed || "cortex";
}

function isInterestingSourceFile(fileName) {
  const base = fileName.toLowerCase();
  const ext = path.extname(fileName).toLowerCase();
  return INIT_SOURCE_EXTENSIONS.has(ext) || base === "readme" || base.startsWith("readme.");
}

function directoryContainsInterestingFiles(directoryPath) {
  const stack = [directoryPath];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (INIT_SKIP_DIRECTORIES.has(entry.name)) {
          continue;
        }
        stack.push(absolutePath);
        continue;
      }

      if (entry.isFile() && isInterestingSourceFile(entry.name)) {
        return true;
      }
    }
  }

  return false;
}

function detectInitialSourcePaths(targetDir) {
  if (!fs.existsSync(targetDir)) {
    return [...DEFAULT_SOURCE_PATHS];
  }

  let entries = [];
  try {
    entries = fs.readdirSync(targetDir, { withFileTypes: true });
  } catch {
    return [...DEFAULT_SOURCE_PATHS];
  }

  const codeDirs = [];
  const docDirs = [];
  const rootFiles = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolutePath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      if (INIT_SKIP_DIRECTORIES.has(entry.name)) {
        continue;
      }
      if (!directoryContainsInterestingFiles(absolutePath)) {
        continue;
      }

      const bucket = ROOT_DOC_PATHS.has(entry.name) ? docDirs : codeDirs;
      bucket.push(toPosixPath(entry.name));
      continue;
    }

    if (entry.isFile() && isInterestingSourceFile(entry.name)) {
      rootFiles.push(toPosixPath(entry.name));
    }
  }

  const readmeFiles = rootFiles.filter((filePath) => /^readme(\.|$)/i.test(path.basename(filePath)));
  const nonReadmeRootFiles = rootFiles.filter((filePath) => !readmeFiles.includes(filePath));
  const detected = [
    ...codeDirs,
    ...nonReadmeRootFiles,
    ...docDirs,
    ".context/notes",
    ".context/decisions",
    ...readmeFiles
  ];
  const uniqueDetected = [...new Set(detected)];
  const hasConcreteRepoContent = uniqueDetected.some((value) => !value.startsWith(".context/"));
  return hasConcreteRepoContent ? uniqueDetected : [...DEFAULT_SOURCE_PATHS];
}

function buildInitialConfig(targetDir) {
  const repoId = slugifyRepoId(path.basename(path.resolve(targetDir)));
  const sourcePaths = detectInitialSourcePaths(targetDir);
  return [
    `repo_id: ${yamlScalar(repoId)}`,
    "source_paths:",
    ...sourcePaths.map((sourcePath) => `  - ${yamlScalar(sourcePath)}`),
    "truth_order:",
    "  - ADR",
    "  - RULE",
    "  - CODE",
    "  - WIKI",
    "ranking:",
    "  semantic: 0.40",
    "  graph: 0.25",
    "  trust: 0.20",
    "  recency: 0.15",
    "runtime:",
    "  top_k: 5",
    "  include_uncertainties: true",
    ""
  ].join("\n");
}

function initializeScaffold(targetDir, force) {
  const configPath = path.join(targetDir, ".context", "config.yaml");
  const hasExistingConfig = fs.existsSync(configPath);
  const generatedConfig = hasExistingConfig ? null : buildInitialConfig(targetDir);
  installScaffold(targetDir, force);
  if (!hasExistingConfig && generatedConfig) {
    writeTextFile(configPath, generatedConfig);
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

function migrateLegacyMcpLocation(targetDir) {
  const legacyMcp = path.join(targetDir, "mcp");
  const newMcp = path.join(targetDir, MCP_PROJECT_REL);
  if (!fs.existsSync(legacyMcp)) return;
  if (fs.existsSync(newMcp)) return;
  fs.mkdirSync(path.join(targetDir, ".context"), { recursive: true });
  fs.renameSync(legacyMcp, newMcp);
  console.log(
    "[cortex] migrated legacy mcp/ → .context/mcp/ to keep project root clean. " +
      "Re-run 'cortex connect' if Claude/Codex MCP registrations need to be refreshed.",
  );
}

function installScaffold(targetDir, force) {
  migrateLegacyMcpLocation(targetDir);

  const copyMap = [
    [path.join(SCAFFOLD_ROOT, ".context"), path.join(targetDir, ".context")],
    [path.join(SCAFFOLD_ROOT, "scripts"), path.join(targetDir, "scripts")],
    [path.join(SCAFFOLD_ROOT, "mcp"), path.join(targetDir, MCP_PROJECT_REL)],
    [path.join(SCAFFOLD_ROOT, ".githooks"), path.join(targetDir, ".githooks")]
  ];

  for (const [sourcePath, targetPath] of copyMap) {
    ensurePathWritable(targetPath, force);
    copyDirectory(sourcePath, targetPath);
  }

  // Copy CLAUDE.md (skip if already exists to preserve user edits)
  const claudeMdSource = path.join(SCAFFOLD_ROOT, "CLAUDE.md");
  const claudeMdTarget = path.join(targetDir, "CLAUDE.md");
  if (fs.existsSync(claudeMdSource) && !fs.existsSync(claudeMdTarget)) {
    fs.copyFileSync(claudeMdSource, claudeMdTarget);
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
- Run \`cortex update\` before completing substantial code changes.
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
  const projectServerEntry = path.join(MCP_PROJECT_REL, "dist", "server.js");
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
  const mcpDir = path.join(targetDir, MCP_PROJECT_REL);
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
    console.log("[cortex] .context/mcp/node_modules not found, skipping build (run cortex bootstrap first)");
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

async function maybeInstallGitHooks(targetDir) {
  const installScript = path.join(targetDir, "scripts", "install-git-hooks.sh");
  if (!fs.existsSync(installScript)) {
    return false;
  }

  const gitRepo = await runCommandResult("git", ["rev-parse", "--show-toplevel"], targetDir, "ignore");
  if (!gitRepo.ok) {
    console.log("[cortex] git hooks skipped (not a Git repository)");
    return false;
  }

  try {
    await runCommand("bash", [installScript], targetDir);
    return true;
  } catch (error) {
    console.log(`[cortex] failed to install git hooks: ${toErrorMessage(error)}`);
    return false;
  }
}

function ensureProjectInitialized(targetDir) {
  const mcpPackageJson = path.join(targetDir, MCP_PROJECT_REL, "package.json");
  if (!fs.existsSync(mcpPackageJson)) {
    throw new Error(`Missing ${mcpPackageJson}. Run 'cortex init --bootstrap' first.`);
  }
}

function isTruthyEnv(value) {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function canAutoInitialize(targetDir) {
  // Legacy mcp/ at root no longer counted — pre-v2.0.5 projects are migrated
  // by installScaffold rather than blocking auto-init.
  const scaffoldPaths = [".context", "scripts", ".githooks"].map((entry) => path.join(targetDir, entry));
  return scaffoldPaths.every((entryPath) => !fs.existsSync(entryPath));
}

function isScaffoldOutOfDate(targetDir) {
  const contextScript = path.join(targetDir, "scripts", "context.sh");
  if (!fs.existsSync(contextScript)) {
    return false;
  }
  const doctorScript = path.join(targetDir, "scripts", "doctor.sh");
  if (!fs.existsSync(doctorScript)) {
    return true;
  }
  // Treat legacy mcp/ at project root as out-of-date so existing installs
  // get migrated into .context/mcp/ on the next bootstrap.
  if (fs.existsSync(path.join(targetDir, "mcp", "package.json"))) {
    return true;
  }
  const mcpPackage = path.join(targetDir, MCP_PROJECT_REL, "package.json");
  if (!fs.existsSync(mcpPackage)) {
    return true;
  }
  try {
    const contents = fs.readFileSync(contextScript, "utf8");
    if (!/\bdoctor\)\s*\n/.test(contents)) {
      return true;
    }
  } catch {
    return true;
  }
  return false;
}

async function confirmPrompt(message) {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(message)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function maybeMigrateScaffold(targetDir, command) {
  if (!isScaffoldOutOfDate(targetDir)) {
    return;
  }

  const autoYes = isTruthyEnv(process.env.CORTEX_AUTO_MIGRATE);
  const interactive = Boolean(process.stdin.isTTY && process.stderr.isTTY);

  console.error(
    `[cortex] scaffold in ${targetDir} is out of date ` +
      `(missing scripts/doctor.sh, .context/mcp/package.json, doctor subcommand in context.sh, ` +
      `or carries a legacy mcp/ directory at the project root).`
  );

  let proceed = autoYes;
  if (!autoYes) {
    if (!interactive) {
      throw new Error(
        `Cortex CLI ${process.env.CORTEX_CLI_VERSION ?? ""} needs an updated scaffold to run '${command}'. ` +
          `Run 'cortex init --bootstrap' to upgrade, or re-run with CORTEX_AUTO_MIGRATE=true.`
      );
    }
    proceed = await confirmPrompt("[cortex] Upgrade scaffold now (runs 'cortex init --bootstrap')? [y/N] ");
  }

  if (!proceed) {
    throw new Error("Scaffold upgrade declined. Run 'cortex init --bootstrap' manually to continue.");
  }

  console.error(`[cortex] migrating scaffold in ${targetDir}`);
  ensureScaffoldExists();
  initializeScaffold(targetDir, true);
  installAssistantHelpers(targetDir);
  await maybeInstallGitHooks(targetDir);
  await runContextCommand(targetDir, ["bootstrap"]);
  console.error(`[cortex] scaffold upgraded; continuing with '${command}'`);
}

async function ensureProjectInitializedForMcp(targetDir) {
  const mcpPackageJson = path.join(targetDir, MCP_PROJECT_REL, "package.json");
  const serverEntry = path.join(targetDir, MCP_PROJECT_REL, "dist", "server.js");

  if (fs.existsSync(mcpPackageJson) && fs.existsSync(serverEntry)) {
    return;
  }

  if (isScaffoldOutOfDate(targetDir)) {
    await maybeMigrateScaffold(targetDir, "mcp");
    if (fs.existsSync(mcpPackageJson) && fs.existsSync(serverEntry)) {
      return;
    }
  }

  if (!isTruthyEnv(process.env.CORTEX_AUTO_BOOTSTRAP_ON_MCP)) {
    ensureProjectInitialized(targetDir);
    return;
  }

  if (!fs.existsSync(mcpPackageJson)) {
    if (!canAutoInitialize(targetDir)) {
      throw new Error(
        `Cannot auto-initialize Cortex in ${targetDir}: scaffold paths already exist. Run 'cortex init --bootstrap' manually.`
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

async function runContextCommand(cwd, contextArgs) {
  const contextScript = path.join(cwd, "scripts", "context.sh");
  if (!fs.existsSync(contextScript)) {
    throw new Error(`Missing ${contextScript}. Run 'cortex init' first.`);
  }
  await runCommand("bash", [contextScript, ...contextArgs], cwd);
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
    initializeScaffold(target, force);
    const helpers = installAssistantHelpers(target);
    await maybeInstallGitHooks(target);

    console.log(`[cortex] initialized in ${target}`);
    console.log("[cortex] scaffold copied: .context/, scripts/, mcp/, .githooks/, docs/");
    console.log(`[cortex] Claude commands ready: /context-update (${helpers.claude.total} files)`);
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
      await connectMcpClients(target);
    }

    if (watch && bootstrap) {
      await runContextCommand(target, ["watch", "start"]);
    }
    return;
  }

  if (command === "connect") {
    const { target, skipBuild } = parseConnectArgs(rest);
    ensureProjectInitialized(target);
    const helpers = installAssistantHelpers(target);
    if (helpers.claude.changed > 0 || helpers.codex.changed) {
      console.log("[cortex] assistant helpers updated (.claude/commands + AGENTS.md)");
    }
    await connectMcpClients(target, { skipBuild });
    return;
  }

  if (command === "mcp") {
    const rawTarget = process.env.CORTEX_PROJECT_ROOT || process.cwd();
    const target = path.resolve(normalizeProjectRoot(rawTarget));
    process.env.CORTEX_PROJECT_ROOT = target;
    await ensureProjectInitializedForMcp(target);
    ensureProjectInitialized(target);
    const serverEntry = path.join(target, MCP_PROJECT_REL, "dist", "server.js");
    if (!fs.existsSync(serverEntry)) {
      throw new Error(`Missing ${serverEntry}. Run 'cortex bootstrap' in ${target} first.`);
    }
    process.stderr.write(`[cortex] starting MCP stdio server from ${serverEntry}\n`);
    await runCommand("node", [serverEntry], target);
    return;
  }

  if (command === "daemon") {
    return runDaemonCommand(rest);
  }

  if (command === "hook") {
    return runHookShim(rest);
  }

  if (command === "hooks") {
    return runHooksCommand(rest);
  }

  if (command === "telemetry") {
    return runTelemetryCommand(rest);
  }

  if (command === "enterprise") {
    return runEnterpriseCommand(rest);
  }

  if (command === "run") {
    return runRunCommand(rest);
  }

  const passthrough = new Set([
    "bootstrap",
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
    "doctor"
  ]);

  if (!passthrough.has(command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  await maybeMigrateScaffold(process.cwd(), command);
  await runContextCommand(process.cwd(), [command, ...rest]);
}

// ---------------------------------------------------------------------------
// v2.0.0: daemon + hooks commands
// ---------------------------------------------------------------------------

const DAEMON_DIR = path.join(process.env.HOME || "", ".cortex");
const PID_FILE = path.join(DAEMON_DIR, "daemon.pid");

function pidFileExists() {
  return fs.existsSync(PID_FILE);
}

function readPid() {
  try {
    const raw = fs.readFileSync(PID_FILE, "utf8").trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err && typeof err === "object" && err.code === "EPERM") {
      return true;
    }
    return false;
  }
}

function resolveProjectMcpDist() {
  // v2.0.5: project layout was moved from <cwd>/mcp/ to <cwd>/.context/mcp/.
  // PACKAGE_ROOT/scaffold/mcp/ is still the source tree the scaffold is
  // copied from; the actual built code lives in each project's
  // <cwd>/.context/mcp/dist/ after bootstrap.
  const target = process.env.CORTEX_PROJECT_ROOT?.trim() || process.cwd();
  return path.join(target, MCP_PROJECT_REL, "dist");
}

function resolveDaemonEntry() {
  return path.join(resolveProjectMcpDist(), "daemon", "main.js");
}

function resolveHookEntry(name) {
  return path.join(resolveProjectMcpDist(), "hooks", `${name}.js`);
}

function resolveCliEntry(name) {
  return path.join(resolveProjectMcpDist(), "cli", `${name}.js`);
}

async function runDaemonCommand(args) {
  const sub = args[0] || "status";
  if (sub === "start") {
    if (isPidAlive(readPid())) {
      console.log("Daemon already running.");
      return;
    }
    fs.mkdirSync(DAEMON_DIR, { recursive: true });
    const entry = resolveDaemonEntry();
    if (!fs.existsSync(entry)) {
      throw new Error(`Daemon entry not found: ${entry}. Build cortex first.`);
    }
    const logFd = fs.openSync(path.join(DAEMON_DIR, "daemon.log"), "a");
    const child = spawn(process.execPath, [entry], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    child.unref();
    console.log(`Daemon started (pid=${child.pid}). Log: ${path.join(DAEMON_DIR, "daemon.log")}`);
    return;
  }
  if (sub === "stop") {
    const pid = readPid();
    if (!isPidAlive(pid)) {
      console.log("Daemon not running.");
      return;
    }
    try {
      process.kill(pid, "SIGTERM");
      console.log(`Sent SIGTERM to pid ${pid}`);
    } catch (err) {
      throw new Error(`Failed to stop daemon: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }
  if (sub === "status") {
    const pid = readPid();
    if (isPidAlive(pid)) {
      console.log(`Daemon running (pid=${pid})`);
    } else {
      console.log("Daemon not running.");
      if (pidFileExists()) {
        console.log(`(stale pid file at ${PID_FILE})`);
      }
    }
    return;
  }
  throw new Error(`Unknown daemon subcommand: ${sub}. Try start|stop|status`);
}

async function runHookShim(args) {
  const name = args[0];
  if (!name) {
    throw new Error("Usage: cortex hook <name>");
  }
  const entry = resolveHookEntry(name);
  if (!fs.existsSync(entry)) {
    throw new Error(`Hook script not found: ${entry}`);
  }
  // Forward stdin → child, stdout/stderr → parent. Hook protocol = stdio.
  const child = spawn(process.execPath, [entry], { stdio: "inherit" });
  await new Promise((resolve) => {
    child.on("exit", (code) => {
      process.exit(code ?? 0);
      resolve(undefined);
    });
  });
}

const HOOK_DEFS = [
  { event: "PreToolUse", matcher: "Edit|Write|Bash|MultiEdit", name: "pre-tool-use" },
  { event: "Stop", matcher: undefined, name: "stop" },
  { event: "SessionStart", matcher: undefined, name: "session-start" },
  { event: "SessionEnd", matcher: undefined, name: "session-end" },
  { event: "UserPromptSubmit", matcher: undefined, name: "user-prompt-submit" },
  { event: "PreCompact", matcher: undefined, name: "pre-compact" },
];

function managedClaudeSettingsPath() {
  if (process.platform === "darwin") {
    return "/Library/Application Support/ClaudeCode/managed-settings.json";
  }
  if (process.platform === "linux") {
    return "/etc/claude-code/managed-settings.json";
  }
  return null;
}

function settingsPathFor(scope) {
  if (scope === "project") {
    return path.join(process.cwd(), ".claude", "settings.json");
  }
  let home = process.env.HOME || "";
  const isRoot = process.getuid && process.getuid() === 0;
  if (isRoot) {
    const sudoUidRaw = process.env.SUDO_UID;
    const sudoUid = sudoUidRaw ? parseInt(sudoUidRaw, 10) : NaN;
    if (Number.isFinite(sudoUid)) {
      try {
        home = os.userInfo({ uid: sudoUid }).homedir;
      } catch {
        // Fall back to HOME below.
      }
    }
  }
  return path.join(home, ".claude", "settings.json");
}

function readJsonSafe(file) {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function hookInstalledInSettings(settings, def) {
  const rows = settings.hooks?.[def.event] || [];
  return rows.some((row) => (row.hooks?.[0]?.command || "").startsWith(`cortex hook ${def.name}`));
}

function readManagedClaudeSettings() {
  const file = managedClaudeSettingsPath();
  if (!file) return { file: null, settings: {} };
  return { file, settings: readJsonSafe(file) };
}

function hasManagedClaudeHooks() {
  const { settings } = readManagedClaudeSettings();
  if (settings.allowManagedHooksOnly !== true) return false;
  return HOOK_DEFS.every((def) => hookInstalledInSettings(settings, def));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// Enterprise == govern. One command, sudo-elevated, hard-fail without it.
// `cortex enterprise <api-key>` does the full install. Subcommands status/sync/uninstall
// dispatch to scaffold/mcp/dist/cli/govern.js.

function requireSudoElevation() {
  const isRoot = process.getuid && process.getuid() === 0;
  if (!isRoot) {
    process.stderr.write(bullet("fail", "This command requires admin privileges to install non-bypassable enforcement.", process.stderr) + "\n");
    process.stderr.write(muted("  Re-run as: sudo " + process.argv.slice(1).join(" "), process.stderr) + "\n");
    process.exit(1);
  }
  const sudoUser = process.env.SUDO_USER;
  const sudoUidRaw = process.env.SUDO_UID;
  const sudoGidRaw = process.env.SUDO_GID;
  if (!sudoUser || !sudoUidRaw || !sudoGidRaw) {
    process.stderr.write(bullet("fail", "Use 'sudo' to elevate (not 'su' or a root login).", process.stderr) + "\n");
    process.stderr.write(muted("  Cortex needs SUDO_USER/SUDO_UID/SUDO_GID set so that enterprise.yml,", process.stderr) + "\n");
    process.stderr.write(muted("  Claude Code hooks and the daemon end up owned by your user.", process.stderr) + "\n");
    process.exit(1);
  }
  const uid = parseInt(sudoUidRaw, 10);
  const gid = parseInt(sudoGidRaw, 10);
  if (!Number.isFinite(uid) || !Number.isFinite(gid)) {
    process.stderr.write(bullet("fail", "SUDO_UID/SUDO_GID are not valid integers — refusing to drop privileges.", process.stderr) + "\n");
    process.exit(1);
  }
  return { user: sudoUser, uid, gid };
}

function dropPrivileges(sudo) {
  const sudoInfo = os.userInfo({ uid: sudo.uid });
  process.setgid(sudo.gid);
  process.setuid(sudo.uid);
  process.env.HOME = sudoInfo.homedir;
  process.env.USER = sudo.user;
  process.env.LOGNAME = sudo.user;
  return sudoInfo.homedir;
}

function loadGovernModule() {
  const entry = resolveCliEntry("govern");
  if (!fs.existsSync(entry)) {
    throw new Error(
      `Build the project's MCP first (missing ${entry}). Run 'cortex bootstrap' in the project root.`
    );
  }
  return import(pathToFileURL(entry).href);
}

const ENTERPRISE_SUBCOMMANDS = new Set(["status", "sync", "uninstall", "repair", "help", "--help", "-h"]);

async function runEnterpriseCommand(args) {
  if (args.length === 0 || ENTERPRISE_SUBCOMMANDS.has(args[0])) {
    return runEnterpriseSubcommand(args);
  }
  return runEnterpriseInstall(args);
}

async function runEnterpriseSubcommand(args) {
  const sub = args[0] ?? "help";

  if (sub === "help" || sub === "--help" || sub === "-h" || !sub) {
    console.log(gradient("cortex enterprise") + muted("  ·  governance, armed."));
    console.log(helpRow("enterprise <api-key>", "Install (sudo). Managed enforcement + hooks + daemon."));
    console.log(helpRow("  ", "[--endpoint <url>] [--frameworks <csv>] [--no-hooks] [--no-daemon]"));
    console.log(helpRow("enterprise status [--verbose|--json]", "Show local enforcement state"));
    console.log(helpRow("enterprise sync", "Force re-fetch + re-apply (sudo)"));
    console.log(helpRow("enterprise uninstall", "Remove. [--break-glass --reason \"<text>\"] in enforced mode (sudo)"));
    console.log(helpRow("enterprise repair", "Verify managed paths, clear .cortex-tamper.lock (sudo)"));
    console.log("");
    console.log(muted("Default endpoint: https://cortex-web-rho.vercel.app"));
    return;
  }

  if (sub === "status") {
    let verbose = false;
    let json = false;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--verbose" || args[i] === "-v") verbose = true;
      else if (args[i] === "--json") json = true;
      else if (args[i].startsWith("-")) {
        throw new Error(`Unknown enterprise status option: ${args[i]}`);
      }
    }
    const mod = await loadGovernModule();
    mod.runGovernStatus({ cwd: process.cwd(), verbose, json });
    return;
  }

  if (sub === "sync") {
    requireSudoElevation();
    const mod = await loadGovernModule();
    await mod.runGovernSync({ cwd: process.cwd() });
    return;
  }

  if (sub === "uninstall") {
    let breakGlass = false;
    let reason;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--break-glass") breakGlass = true;
      else if (args[i] === "--reason" && args[i + 1]) {
        reason = args[i + 1];
        i++;
      } else if (args[i].startsWith("-")) {
        throw new Error(`Unknown enterprise uninstall option: ${args[i]}`);
      }
    }
    requireSudoElevation();
    const mod = await loadGovernModule();
    const result = await mod.runGovernUninstall({
      cli: "all",
      breakGlass,
      reason,
      cwd: process.cwd(),
    });
    if (!result.ok) {
      printBullet("fail", result.message, process.stderr);
      process.exit(1);
    }
    printBullet("ok", result.message);
    return;
  }

  if (sub === "repair") {
    let reason;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--reason" && args[i + 1]) {
        reason = args[i + 1];
        i++;
      } else if (args[i].startsWith("-")) {
        throw new Error(`Unknown enterprise repair option: ${args[i]}`);
      }
    }
    requireSudoElevation();
    const mod = await loadGovernModule();
    const result = await mod.runGovernRepair({ cwd: process.cwd(), reason });
    if (!result.ok) {
      printBullet("fail", result.message, process.stderr);
      process.exit(1);
    }
    printBullet("ok", result.message);
    return;
  }

  throw new Error(`Unknown enterprise subcommand: ${sub}`);
}

async function runEnterpriseInstall(args) {
  const apiKey = args[0];
  let endpoint;
  let frameworks;
  let installHooks = true;
  let startDaemon = true;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--endpoint" && args[i + 1]) {
      endpoint = args[i + 1];
      i++;
    } else if (args[i] === "--frameworks" && args[i + 1]) {
      frameworks = args[i + 1].split(",").map((s) => s.trim()).filter(Boolean);
      i++;
    } else if (args[i] === "--no-hooks") {
      installHooks = false;
    } else if (args[i] === "--no-daemon") {
      startDaemon = false;
    } else if (args[i].startsWith("-")) {
      throw new Error(`Unknown enterprise install option: ${args[i]}`);
    }
  }

  const sudo = requireSudoElevation();

  process.stdout.write(headerBanner({ tagline: "  Cortex enterprise — activating governance" }));

  const enterpriseEntry = resolveCliEntry("enterprise-setup");
  if (!fs.existsSync(enterpriseEntry)) {
    printBullet("fail", `Build the project's MCP first (missing ${enterpriseEntry}). Run 'cortex bootstrap' in the project root.`);
    process.exit(1);
  }
  const enterpriseMod = await import(pathToFileURL(enterpriseEntry).href);

  // Step 1 — Initializing Cortex core (license validation + enterprise.yml).
  const step1 = spinner("Initializing Cortex core");
  const setupResult = await enterpriseMod.runEnterpriseSetup({ apiKey, endpoint, cwd: process.cwd() });
  if (!setupResult.ok) {
    step1.stop("fail", `Initializing Cortex core — ${setupResult.message}`);
    process.exit(1);
  }
  step1.stop("ok", `Initializing Cortex core — license ${setupResult.edition}, expires ${setupResult.expiresAt}`);
  printBullet("info", muted(`config: ${setupResult.configPath}`));

  // enterprise.yml was just written as root; transfer ownership before we drop privs.
  try {
    fs.chownSync(setupResult.configPath, sudo.uid, sudo.gid);
  } catch (err) {
    printBullet("warn", `Could not chown ${setupResult.configPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 2 — Loading policy engine (govern install: managed config + frameworks).
  const baseUrl = (endpoint ?? "https://cortex-web-rho.vercel.app").replace(/\/$/, "");
  const step2 = spinner("Loading policy engine");
  const governMod = await loadGovernModule();
  const governResult = await governMod.runGovernInstall({
    cli: "all",
    mode: "enforced",
    cwd: process.cwd(),
    apiKey,
    baseUrl,
    frameworks,
  });
  if (!governResult.ok) {
    step2.stop("fail", `Loading policy engine — ${governResult.message}`);
    process.exit(1);
  }
  step2.stop("ok", "Loading policy engine — policies armed");

  // govern.local.json was written as root in cwd/.context. chown it back.
  const governStatePath = path.join(process.cwd(), ".context", "govern.local.json");
  if (fs.existsSync(governStatePath)) {
    try {
      fs.chownSync(governStatePath, sudo.uid, sudo.gid);
    } catch (err) {
      printBullet("warn", `Could not chown ${governStatePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Step 3 — Connecting audit pipeline (telemetry endpoint already wired by govern install).
  const step3 = spinner("Connecting audit pipeline");
  step3.stop("ok", `Connecting audit pipeline — endpoint ${baseUrl}`);

  // Drop privileges before user-scope writes (Claude Code hooks in $HOME) and daemon spawn.
  dropPrivileges(sudo);

  // Step 4 — Preparing MCP gateway (Claude Code hooks bind the MCP surface).
  if (installHooks) {
    const step4 = spinner("Preparing MCP gateway");
    try {
      if (hasManagedClaudeHooks()) {
        step4.stop("ok", "Preparing MCP gateway — managed Claude hooks active");
      } else {
        await runHooksCommand(["install"]);
        step4.stop("ok", "Preparing MCP gateway — hooks installed");
      }
    } catch (err) {
      step4.stop("fail", `Preparing MCP gateway — ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    printBullet("warn", "Preparing MCP gateway — skipped (--no-hooks)");
  }

  // Step 5 — Installing guardrails (supervisor daemon).
  if (startDaemon) {
    const step5 = spinner("Installing guardrails");
    try {
      await runDaemonCommand(["start"]);
      step5.stop("ok", "Installing guardrails — daemon online");
    } catch (err) {
      step5.stop("fail", `Installing guardrails — ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    printBullet("warn", "Installing guardrails — skipped (--no-daemon)");
  }

  console.log("");
  console.log(bullet("ok", bold("Cortex is running.")));
  console.log(muted("  Monitoring AI activity. No violations detected."));
  console.log(muted("  Next: ") + accent("cortex enterprise status") + muted("  ·  ") + accent("cortex telemetry test"));
  console.log("");
}

const RUN_CLIS = new Set(["claude", "codex", "copilot"]);

async function runRunCommand(args) {
  const sub = args[0];
  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    console.log("Usage:");
    console.log("  cortex run <claude|codex|copilot> [args...]");
    console.log("");
    console.log("Wraps the named AI CLI in cortex enforcement:");
    console.log("  claude/codex: passthrough — their own managed-config + sandbox");
    console.log("                cover Tier 1 enforcement after 'cortex enterprise <key>'.");
    console.log("  copilot:      Tier 2 — OS-level sandbox (sandbox-exec on macOS,");
    console.log("                bwrap on Linux). Denies writes to ~/.copilot/,");
    console.log("                ~/.copilot.local/, /etc/copilot* so AI cannot");
    console.log("                reconfigure itself out of governance.");
    console.log("");
    console.log("Tip: alias copilot='cortex run copilot' so direct 'copilot' invocations");
    console.log("are also wrapped. Direct invocations are otherwise caught by Tier 3");
    console.log("ungoverned-session detection (Phase 5).");
    return;
  }
  if (!RUN_CLIS.has(sub)) {
    throw new Error(`Unknown AI CLI: ${sub}. Use claude, codex, or copilot.`);
  }
  const entry = resolveCliEntry("run");
  if (!fs.existsSync(entry)) {
    throw new Error(
      `Build the project's MCP first (missing ${entry}). Run 'cortex bootstrap' in the project root.`
    );
  }
  const mod = await import(pathToFileURL(entry).href);
  const exitCode = await mod.runAiCli({ cli: sub, args: args.slice(1) });
  process.exit(exitCode);
}

async function runTelemetryCommand(args) {
  const sub = args[0] || "help";
  if (sub === "test") {
    const entry = resolveCliEntry("telemetry-test");
    if (!fs.existsSync(entry)) {
      throw new Error(`Build the project's MCP first (missing ${entry}). Run 'cortex bootstrap' in the project root.`);
    }
    const mod = await import(pathToFileURL(entry).href);
    const code = await mod.runTelemetryTest();
    process.exit(code);
  }
  if (sub === "help" || sub === "--help" || sub === "-h") {
    console.log("Usage:");
    console.log("  cortex telemetry test    Smoke-test the push pipeline end-to-end");
    return;
  }
  throw new Error(`Unknown telemetry subcommand: ${sub}`);
}

async function runHooksCommand(args) {
  const sub = args[0] || "status";
  const scope = args.includes("--project") ? "project" : "user";
  const target = settingsPathFor(scope);

  if (sub === "install") {
    const settings = readJsonSafe(target);
    settings.hooks = settings.hooks || {};
    for (const def of HOOK_DEFS) {
      const entry = {
        ...(def.matcher ? { matcher: def.matcher } : {}),
        hooks: [{ type: "command", command: `cortex hook ${def.name}` }],
      };
      const existing = settings.hooks[def.event] || [];
      const filtered = existing.filter((row) => {
        const cmd = (row.hooks?.[0]?.command || "");
        return !cmd.startsWith("cortex hook ");
      });
      settings.hooks[def.event] = [...filtered, entry];
    }
    writeJson(target, settings);
    console.log(`Installed cortex hooks into ${target}`);
    console.log(`Hooks: ${HOOK_DEFS.map((d) => d.name).join(", ")}`);
    return;
  }
  if (sub === "uninstall") {
    const settings = readJsonSafe(target);
    if (settings.hooks) {
      for (const event of Object.keys(settings.hooks)) {
        settings.hooks[event] = (settings.hooks[event] || []).filter((row) => {
          const cmd = (row.hooks?.[0]?.command || "");
          return !cmd.startsWith("cortex hook ");
        });
        if (settings.hooks[event].length === 0) {
          delete settings.hooks[event];
        }
      }
      if (Object.keys(settings.hooks).length === 0) {
        delete settings.hooks;
      }
    }
    writeJson(target, settings);
    console.log(`Removed cortex hooks from ${target}`);
    return;
  }
  if (sub === "status") {
    const settings = readJsonSafe(target);
    const managed = scope === "user" ? readManagedClaudeSettings() : { file: null, settings: {} };
    const installed = [];
    for (const def of HOOK_DEFS) {
      const userFound = hookInstalledInSettings(settings, def);
      const managedFound = scope === "user" ? hookInstalledInSettings(managed.settings, def) : false;
      const found = userFound || managedFound;
      let source = "";
      if (userFound && managedFound) source = "user+managed";
      else if (userFound) source = "user";
      else if (managedFound) source = "managed";
      installed.push({ name: def.name, event: def.event, found, source });
    }
    console.log(`Settings file: ${target}`);
    if (scope === "user" && managed.file) {
      console.log(`Managed settings: ${managed.file}`);
    }
    for (const row of installed) {
      console.log(`  ${row.found ? "✓" : "✗"} ${row.event} → ${row.name}${row.source ? ` (${row.source})` : ""}`);
    }
    if (scope === "user" && managed.settings.allowManagedHooksOnly === true) {
      console.log("  note: managed Claude hooks are authoritative; user hooks may be intentionally absent");
    }
    return;
  }
  throw new Error(`Unknown hooks subcommand: ${sub}. Try install|uninstall|status`);
}

function resolveArgv1() {
  if (!process.argv[1]) return null;
  try {
    return fs.realpathSync(process.argv[1]);
  } catch {
    return process.argv[1];
  }
}

const invokedAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(resolveArgv1()).href;

if (invokedAsScript) {
  run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(bullet("fail", message, process.stderr) + "\n");
    process.exit(1);
  });
}

export { buildInitialConfig, detectInitialSourcePaths, isScaffoldOutOfDate, slugifyRepoId };
