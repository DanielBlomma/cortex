#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const SCAFFOLD_ROOT = path.join(PACKAGE_ROOT, "scaffold");

const GITIGNORE_LINES = [
  "",
  "# Cortex local storage",
  ".context/db/",
  ".context/embeddings/",
  ".context/cache/",
  "mcp/.npm-cache/",
  "mcp/dist/",
  "mcp/node_modules/"
];

function printHelp() {
  console.log("Cortex CLI");
  console.log("");
  console.log("Usage:");
  console.log("  cortex init [path] [--force] [--bootstrap]");
  console.log("  cortex bootstrap");
  console.log("  cortex update");
  console.log("  cortex status");
  console.log("  cortex ingest [--changed] [--verbose]");
  console.log("  cortex embed [--changed]");
  console.log("  cortex graph-load [--no-reset]");
  console.log("  cortex note <title> [text]");
  console.log("  cortex help");
}

function parseInitArgs(args) {
  let target = process.cwd();
  let force = false;
  let bootstrap = false;

  for (const arg of args) {
    if (arg === "--force") {
      force = true;
      continue;
    }

    if (arg === "--bootstrap") {
      bootstrap = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown init option: ${arg}`);
    }

    target = path.resolve(arg);
  }

  return { target, force, bootstrap };
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

async function runContextCommand(cwd, contextArgs) {
  const contextScript = path.join(cwd, "scripts", "context.sh");
  if (!fs.existsSync(contextScript)) {
    throw new Error(`Missing ${contextScript}. Run 'cortex init' first.`);
  }
  await runCommand("bash", [contextScript, ...contextArgs], cwd);
}

async function run() {
  const [rawCommand, ...rest] = process.argv.slice(2);
  const command = rawCommand ?? "help";

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "init") {
    ensureScaffoldExists();
    const { target, force, bootstrap } = parseInitArgs(rest);
    fs.mkdirSync(target, { recursive: true });
    installScaffold(target, force);

    console.log(`[cortex] initialized in ${target}`);
    console.log("[cortex] next: cortex bootstrap");

    if (bootstrap) {
      await runContextCommand(target, ["bootstrap"]);
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
    "note",
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
