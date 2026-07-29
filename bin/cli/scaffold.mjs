import fs from "node:fs";
import path from "node:path";
import {
  CONTEXT_RUNTIME_REL,
  CONTEXT_SCRIPTS_REL,
  MCP_PROJECT_REL,
  PACKAGE_ROOT,
  SCAFFOLD_ROOT,
} from "./paths.mjs";
import {
  runCommand,
  runCommandResult,
  toErrorMessage,
} from "./process.mjs";

const GITIGNORE_LINES = [
  "",
  "# Cortex local storage",
  ".context/*",
  "!.context/config.yaml",
  "!.context/rules.yaml",
  "!.context/ontology.cypher",
  ".npm-cache/",
];

const PRESERVE_FILES = new Set([
  "config.yaml",
  "rules.yaml",
  "enterprise.yml",
  "enterprise.yaml",
  "CLAUDE.md",
  "AGENTS.md",
]);
const DEFAULT_SOURCE_PATHS = ["."];

export function ensureScaffoldExists() {
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

    if (PRESERVE_FILES.has(entry.name) && fs.existsSync(targetPath)) {
      continue;
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    const sourceMode = fs.statSync(sourcePath).mode;
    fs.chmodSync(targetPath, sourceMode);
  }
}

function yamlScalar(value) {
  return /^[A-Za-z0-9._/-]+$/.test(value) ? value : JSON.stringify(value);
}

export function slugifyRepoId(value) {
  const dashed = String(value || "")
    .trim()
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return dashed || "cortex";
}

export function detectInitialSourcePaths(_targetDir) {
  return [...DEFAULT_SOURCE_PATHS];
}

export function buildInitialConfig(targetDir) {
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
    "# Tuned together with the midrank-percentile graph_score in searchResults.ts.",
    "ranking:",
    "  semantic: 0.40",
    "  graph: 0.25",
    "  trust: 0.20",
    "  recency: 0.15",
    "runtime:",
    "  top_k: 5",
    "  include_uncertainties: true",
    "",
  ].join("\n");
}

export function initializeScaffold(targetDir, force) {
  const configPath = path.join(targetDir, ".context", "config.yaml");
  const hasExistingConfig = fs.existsSync(configPath);
  const generatedConfig = hasExistingConfig ? null : buildInitialConfig(targetDir);
  installScaffold(targetDir, force);
  if (!hasExistingConfig && generatedConfig) {
    writeTextFile(configPath, generatedConfig);
  }
}

export function hardenEnterpriseConfigPermissions(targetDir) {
  const contextDir = path.join(targetDir, ".context");
  for (const filename of ["enterprise.yml", "enterprise.yaml"]) {
    const configPath = path.join(contextDir, filename);
    let stat;
    try {
      stat = fs.lstatSync(configPath);
    } catch (err) {
      if (err && typeof err === "object" && err.code === "ENOENT") continue;
      throw err;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(
        `Refusing symlinked Enterprise configuration: ${configPath}`,
      );
    }
    if (!stat.isFile()) {
      throw new Error(
        `Enterprise configuration is not a regular file: ${configPath}`,
      );
    }
    fs.chmodSync(configPath, 0o600);
  }
}

function ensurePathWritable(targetPath, force) {
  if (!fs.existsSync(targetPath)) return;
  if (!force) {
    throw new Error(
      `Refusing to overwrite existing path: ${targetPath}\nRun with --force to overwrite scaffold files.`,
    );
  }
}

function mergeGitignore(targetDir) {
  const gitignorePath = path.join(targetDir, ".gitignore");
  const current = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, "utf8")
    : "";
  const merged =
    current +
    GITIGNORE_LINES.filter((line) => !current.includes(line)).join("\n") +
    "\n";
  fs.writeFileSync(gitignorePath, merged, "utf8");
}

function migrateLegacyMcpLocation(targetDir) {
  const legacyMcp = path.join(targetDir, "mcp");
  const newMcp = path.join(targetDir, MCP_PROJECT_REL);
  if (!fs.existsSync(legacyMcp) || fs.existsSync(newMcp)) return;
  fs.mkdirSync(path.join(targetDir, ".context"), { recursive: true });
  fs.renameSync(legacyMcp, newMcp);
  console.log(
    "[cortex] migrated legacy mcp/ → .context/mcp/ to keep project root clean. " +
      "Re-run 'cortex connect' if Claude/Codex MCP registrations need to be refreshed.",
  );
}

const LEGACY_SCRIPT_ENTRIES = [
  "bootstrap.sh",
  "context.sh",
  "dashboard.mjs",
  "dashboard.sh",
  "doctor.sh",
  "embed.sh",
  "ingest.mjs",
  "ingest.sh",
  "install-git-hooks.sh",
  "load-kuzu.sh",
  "load-ryu.sh",
  "memory-compile.mjs",
  "memory-compile.sh",
  "memory-lint.mjs",
  "memory-lint.sh",
  "refresh.sh",
  "status.sh",
  "update-context.sh",
  "watch.sh",
  "lib",
  "parsers",
];

function looksLikeLegacyCortexScriptsDir(scriptsDir) {
  const contextScript = path.join(scriptsDir, "context.sh");
  if (!fs.existsSync(contextScript)) return false;
  try {
    const contents = fs.readFileSync(contextScript, "utf8");
    return (
      contents.includes("bootstrap)") &&
      contents.includes("graph-load)") &&
      contents.includes("memory-lint)")
    );
  } catch {
    return false;
  }
}

function removeLegacyCortexScripts(targetDir) {
  if (path.resolve(targetDir) === PACKAGE_ROOT) return;

  const scriptsDir = path.join(targetDir, "scripts");
  if (!looksLikeLegacyCortexScriptsDir(scriptsDir)) return;

  for (const entry of LEGACY_SCRIPT_ENTRIES) {
    fs.rmSync(path.join(scriptsDir, entry), { recursive: true, force: true });
  }

  try {
    if (fs.existsSync(scriptsDir) && fs.readdirSync(scriptsDir).length === 0) {
      fs.rmdirSync(scriptsDir);
    }
  } catch {
    // Best effort. A user's own files in scripts/ must remain untouched.
  }
}

function installScaffold(targetDir, force) {
  migrateLegacyMcpLocation(targetDir);
  removeLegacyCortexScripts(targetDir);

  const copyMap = [
    [path.join(SCAFFOLD_ROOT, ".context"), path.join(targetDir, ".context")],
    [path.join(SCAFFOLD_ROOT, "scripts"), path.join(targetDir, CONTEXT_SCRIPTS_REL)],
    [path.join(SCAFFOLD_ROOT, "mcp"), path.join(targetDir, MCP_PROJECT_REL)],
    [path.join(SCAFFOLD_ROOT, ".githooks"), path.join(targetDir, ".githooks")],
  ];

  for (const [sourcePath, targetPath] of copyMap) {
    ensurePathWritable(targetPath, force);
    copyDirectory(sourcePath, targetPath);
  }

  for (const fileName of ["CLAUDE.md", "AGENTS.md"]) {
    const sourcePath = path.join(SCAFFOLD_ROOT, fileName);
    const targetPath = path.join(targetDir, fileName);
    if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
      fs.copyFileSync(sourcePath, targetPath);
    }
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
    if (existing === content) return false;
  }
  writeTextFile(targetPath, content);
  return true;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function upsertSectionByMarkers(
  targetPath,
  startMarker,
  endMarker,
  sectionContent,
) {
  const block = `${startMarker}\n${sectionContent.trimEnd()}\n${endMarker}`;
  const existing = fs.existsSync(targetPath)
    ? fs.readFileSync(targetPath, "utf8")
    : "";
  const hasMarkers =
    existing.includes(startMarker) && existing.includes(endMarker);

  if (hasMarkers) {
    const pattern = new RegExp(
      `${escapeRegex(startMarker)}[\\s\\S]*?${escapeRegex(endMarker)}`,
    );
    const replaced = existing.replace(pattern, block);
    if (replaced === existing) return false;
    writeTextFile(
      targetPath,
      replaced.endsWith("\n") ? replaced : `${replaced}\n`,
    );
    return true;
  }

  let next = existing;
  if (next.length > 0 && !next.endsWith("\n")) next += "\n";
  if (next.trim().length > 0 && !next.endsWith("\n\n")) next += "\n";
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
`,
    },
  ];

  const commandsDir = path.join(targetDir, ".claude", "commands");
  let changed = 0;
  for (const spec of commandSpecs) {
    const targetPath = path.join(commandsDir, spec.file);
    if (upsertTextFile(targetPath, spec.content)) changed += 1;
  }
  return { total: commandSpecs.length, changed };
}

function installCodexAgentsSection(targetDir) {
  const agentsPath = path.join(targetDir, "AGENTS.md");
  const startMarker = "<!-- cortex:auto:start -->";
  const endMarker = "<!-- cortex:auto:end -->";
  const section = `## Cortex Auto Workflow
- Use the \`using-cortex\` skill if available; otherwise follow the commands below.
- Search before answering code questions: \`cortex search "<query>" --json\`; never answer from memory.
- Check \`cortex rules --json\` before suggesting changes and \`cortex impact "<query>" --json\` before refactors.
- Review changed files with \`cortex pattern-evidence <file> --json\` before finalizing.
- Run \`cortex update\` before completing substantial code changes.
- If background sync is enabled, check with \`cortex watch status\`.`;
  const changed = upsertSectionByMarkers(
    agentsPath,
    startMarker,
    endMarker,
    section,
  );
  return { path: agentsPath, changed };
}

export function installAssistantHelpers(targetDir) {
  const claude = installClaudeCommands(targetDir);
  const codex = installCodexAgentsSection(targetDir);
  return { claude, codex };
}

export async function maybeInstallGitHooks(targetDir) {
  const installScript = path.join(
    targetDir,
    CONTEXT_SCRIPTS_REL,
    "install-git-hooks.sh",
  );
  if (!fs.existsSync(installScript)) return false;

  const gitRepo = await runCommandResult(
    "git",
    ["rev-parse", "--show-toplevel"],
    targetDir,
    "ignore",
  );
  if (!gitRepo.ok) {
    console.log("[cortex] git hooks skipped (not a Git repository)");
    return false;
  }

  try {
    await runCommand("bash", [installScript], targetDir);
    return true;
  } catch (error) {
    console.log(
      `[cortex] failed to install git hooks: ${toErrorMessage(error)}`,
    );
    return false;
  }
}

export function ensureProjectInitialized(targetDir) {
  const runtimePackageJson = path.join(
    targetDir,
    CONTEXT_RUNTIME_REL,
    "package.json",
  );
  if (!fs.existsSync(runtimePackageJson)) {
    throw new Error(
      `Missing ${runtimePackageJson}. Run 'cortex init --bootstrap' first.`,
    );
  }
}

export function isTruthyEnv(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

export function canAutoInitialize(targetDir) {
  const scaffoldPaths = [".context", ".githooks"].map((entry) =>
    path.join(targetDir, entry),
  );
  return scaffoldPaths.every((entryPath) => !fs.existsSync(entryPath));
}

export function isScaffoldOutOfDate(targetDir) {
  const contextScript = path.join(
    targetDir,
    CONTEXT_SCRIPTS_REL,
    "context.sh",
  );
  const legacyContextScript = path.join(targetDir, "scripts", "context.sh");
  if (!fs.existsSync(contextScript)) {
    return fs.existsSync(legacyContextScript);
  }
  const doctorScript = path.join(
    targetDir,
    CONTEXT_SCRIPTS_REL,
    "doctor.sh",
  );
  if (!fs.existsSync(doctorScript)) return true;
  if (fs.existsSync(path.join(targetDir, "mcp", "package.json"))) return true;
  const mcpPackage = path.join(targetDir, MCP_PROJECT_REL, "package.json");
  if (!fs.existsSync(mcpPackage)) return true;
  try {
    const contents = fs.readFileSync(contextScript, "utf8");
    if (!/\bdoctor\)\s*\n/.test(contents)) return true;
  } catch {
    return true;
  }
  return false;
}
