import crypto from "node:crypto";
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
import {
  expandLegacyFiles,
  installManagedScaffold,
  loadCurrentOwnershipManifest,
  loadPreStateOwnershipBaselines,
} from "./scaffold-ownership.mjs";

const GITIGNORE_LINES = [
  "",
  "# Cortex local storage",
  ".context/*",
  "!.context/config.yaml",
  "!.context/rules.yaml",
  "!.context/ontology.cypher",
  ".npm-cache/",
];

const DEFAULT_SOURCE_PATHS = ["."];

export function ensureScaffoldExists() {
  if (!fs.existsSync(SCAFFOLD_ROOT)) {
    throw new Error(`Scaffold not found at ${SCAFFOLD_ROOT}`);
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
    writeTextFile(targetDir, configPath, generatedConfig);
  }
}

export function hardenEnterpriseConfigPermissions(targetDir) {
  const contextDir = path.join(targetDir, ".context");
  let contextStat;
  try {
    contextStat = fs.lstatSync(contextDir);
  } catch (err) {
    if (err && typeof err === "object" && err.code === "ENOENT") return;
    throw err;
  }
  if (contextStat.isSymbolicLink()) {
    throw new Error(`Refusing symlinked Cortex context directory: ${contextDir}`);
  }
  if (!contextStat.isDirectory()) {
    throw new Error(`Cortex context path is not a directory: ${contextDir}`);
  }
  const configs = [];
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
    if (stat.nlink > 1) {
      throw new Error(
        `Refusing multiply linked Enterprise configuration: ${configPath}`,
      );
    }
    configs.push({ path: configPath, stat });
  }
  for (const config of configs) {
    const { path: configPath, stat } = config;
    const currentStat = fs.lstatSync(configPath);
    if (
      !currentStat.isFile() ||
      currentStat.isSymbolicLink() ||
      currentStat.nlink > 1 ||
      currentStat.dev !== stat.dev ||
      currentStat.ino !== stat.ino
    ) {
      throw new Error(
        `Enterprise configuration changed during permission hardening: ${configPath}`,
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
  const gitignorePath = resolveSafeTextTarget(
    targetDir,
    path.join(targetDir, ".gitignore"),
  );
  let gitignoreStat = null;
  try {
    gitignoreStat = fs.lstatSync(gitignorePath);
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") {
      throw error;
    }
  }
  if (gitignoreStat?.isSymbolicLink()) {
    throw new Error(`Refusing symlinked .gitignore: ${gitignorePath}`);
  }
  if (gitignoreStat !== null && !gitignoreStat.isFile()) {
    throw new Error(`.gitignore is not a regular file: ${gitignorePath}`);
  }
  const current =
    gitignoreStat === null ? "" : fs.readFileSync(gitignorePath, "utf8");
  const merged =
    current +
    GITIGNORE_LINES.filter((line) => !current.includes(line)).join("\n") +
    "\n";
  writeResolvedTextFile(gitignorePath, merged);
}

function migrateLegacyMcpLocation(targetDir) {
  const legacyMcp = path.join(targetDir, "mcp");
  const contextDir = path.join(targetDir, ".context");
  const newMcp = path.join(targetDir, MCP_PROJECT_REL);
  let legacyStat;
  try {
    legacyStat = fs.lstatSync(legacyMcp);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return;
    throw error;
  }
  if (legacyStat.isSymbolicLink() || !legacyStat.isDirectory()) {
    throw new Error(
      `Refusing unsafe legacy Cortex runtime path: ${legacyMcp}`,
    );
  }
  let contextStat = null;
  try {
    contextStat = fs.lstatSync(contextDir);
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") {
      throw error;
    }
  }
  if (contextStat?.isSymbolicLink() || (contextStat && !contextStat.isDirectory())) {
    throw new Error(`Refusing unsafe Cortex context path: ${contextDir}`);
  }
  let newMcpStat = null;
  try {
    newMcpStat = fs.lstatSync(newMcp);
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") {
      throw error;
    }
  }
  if (newMcpStat !== null) {
    if (newMcpStat.isSymbolicLink()) {
      throw new Error(`Refusing symlinked Cortex runtime path: ${newMcp}`);
    }
    return;
  }
  fs.mkdirSync(contextDir, { recursive: true });
  fs.renameSync(legacyMcp, newMcp);
  console.log(
    "[cortex] migrated legacy mcp/ → .context/mcp/ to keep project root clean. " +
      "Re-run 'cortex connect' if Claude/Codex MCP registrations need to be refreshed.",
  );
}

function lstatLegacyFile(scriptsDir, relativePath) {
  let currentPath = scriptsDir;
  const segments = relativePath.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    currentPath = path.join(currentPath, segments[index]);
    let stat;
    try {
      stat = fs.lstatSync(currentPath);
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) return null;
    if (index < segments.length - 1 && !stat.isDirectory()) return null;
    if (index === segments.length - 1) {
      return stat.isFile() ? { path: currentPath, stat } : null;
    }
  }
  return null;
}

function removeEmptyLegacyDirectories(scriptsDir, removedFiles) {
  const directories = new Set();
  for (const filePath of removedFiles) {
    let directory = path.dirname(filePath);
    while (
      directory === scriptsDir ||
      directory.startsWith(`${scriptsDir}${path.sep}`)
    ) {
      directories.add(directory);
      if (directory === scriptsDir) break;
      directory = path.dirname(directory);
    }
  }
  const deepestFirst = [...directories].sort(
    (left, right) => right.split(path.sep).length - left.split(path.sep).length,
  );
  for (const directory of deepestFirst) {
    try {
      const stat = fs.lstatSync(directory);
      if (
        !stat.isSymbolicLink() &&
        stat.isDirectory() &&
        fs.readdirSync(directory).length === 0
      ) {
        fs.rmdirSync(directory);
      }
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

function removeLegacyCortexScripts(
  targetDir,
  ownershipManifest,
  preStateOwnership,
) {
  if (path.resolve(targetDir) === PACKAGE_ROOT) return;

  const scriptsDir = path.join(targetDir, "scripts");
  const prepared = [];
  for (const entry of expandLegacyFiles(ownershipManifest).sort((left, right) =>
    left.target.localeCompare(right.target),
  )) {
    const sourcePath = path.join(
      SCAFFOLD_ROOT,
      ...entry.source.split("/"),
    );
    let sourceStat;
    try {
      sourceStat = fs.lstatSync(sourcePath);
    } catch (error) {
      if (
        entry.optional &&
        error &&
        typeof error === "object" &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
    if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
      throw new Error(`Unsafe legacy migration source: ${sourcePath}`);
    }
    const target = lstatLegacyFile(targetDir, entry.target);
    if (target === null) continue;
    const packageHash = sha256File(sourcePath);
    const targetHash = sha256File(target.path);
    const matchesBaseline =
      preStateOwnership.legacyHashes
        .get(entry.target)
        ?.has(targetHash) === true;
    if (targetHash !== packageHash && !matchesBaseline) continue;
    prepared.push({
      ...entry,
      path: target.path,
      ownershipHash: targetHash,
      dev: target.stat.dev,
      ino: target.stat.ino,
    });
  }
  const removedFiles = [];
  for (const entry of prepared) {
    const target = lstatLegacyFile(targetDir, entry.target);
    if (
      target === null ||
      target.stat.dev !== entry.dev ||
      target.stat.ino !== entry.ino ||
      sha256File(target.path) !== entry.ownershipHash
    ) {
      throw new Error(
        `Refusing to remove legacy scaffold file changed during cleanup: ${entry.target}`,
      );
    }
    fs.unlinkSync(target.path);
    removedFiles.push(target.path);
  }
  removeEmptyLegacyDirectories(scriptsDir, removedFiles);
}

function sha256File(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function installScaffold(targetDir, force) {
  const ownershipManifest = loadCurrentOwnershipManifest(PACKAGE_ROOT);
  const preStateOwnership = loadPreStateOwnershipBaselines(
    PACKAGE_ROOT,
    ownershipManifest,
  );
  migrateLegacyMcpLocation(targetDir);

  const copyTargets = [
    path.join(targetDir, ".context"),
    path.join(targetDir, CONTEXT_SCRIPTS_REL),
    path.join(targetDir, MCP_PROJECT_REL),
    path.join(targetDir, ".githooks"),
  ];

  for (const targetPath of copyTargets) {
    ensurePathWritable(targetPath, force);
  }

  installManagedScaffold(PACKAGE_ROOT, targetDir, { force });

  removeLegacyCortexScripts(
    targetDir,
    ownershipManifest,
    preStateOwnership,
  );
  mergeGitignore(targetDir);
}

function resolveSafeTextTarget(targetRoot, targetPath) {
  const resolvedRoot = path.resolve(targetRoot);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (
    relative.length === 0 ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Text-file target is outside the project: ${targetPath}`);
  }
  const rootReal = fs.realpathSync(resolvedRoot);
  const segments = relative.split(path.sep);
  let currentPath = rootReal;
  for (const segment of segments.slice(0, -1)) {
    currentPath = path.join(currentPath, segment);
    let stat = null;
    try {
      stat = fs.lstatSync(currentPath);
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "ENOENT") {
        throw error;
      }
    }
    if (stat === null) {
      fs.mkdirSync(currentPath);
      stat = fs.lstatSync(currentPath);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Refusing unsafe text-file ancestor: ${currentPath}`);
    }
  }
  return path.join(rootReal, ...segments);
}

function writeResolvedTextFile(targetPath, content) {
  const targetDirectory = path.dirname(targetPath);
  let targetStat = null;
  try {
    targetStat = fs.lstatSync(targetPath);
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") {
      throw error;
    }
  }
  if (
    targetStat?.isSymbolicLink() ||
    (targetStat !== null && !targetStat.isFile())
  ) {
    throw new Error(`Refusing unsafe text-file target: ${targetPath}`);
  }
  const temporaryPath = path.join(
    targetDirectory,
    `.${path.basename(targetPath)}.tmp-${process.pid}-${crypto.randomUUID()}`,
  );
  try {
    fs.writeFileSync(temporaryPath, content, {
      encoding: "utf8",
      flag: "wx",
      mode: targetStat?.mode ?? 0o644,
    });
    let currentStat = null;
    try {
      currentStat = fs.lstatSync(targetPath);
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "ENOENT") {
        throw error;
      }
    }
    if (
      (targetStat === null && currentStat !== null) ||
      (targetStat !== null &&
        (currentStat === null ||
          currentStat.isSymbolicLink() ||
          !currentStat.isFile() ||
          currentStat.dev !== targetStat.dev ||
          currentStat.ino !== targetStat.ino))
    ) {
      throw new Error(`Text-file target changed during update: ${targetPath}`);
    }
    fs.renameSync(temporaryPath, targetPath);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // Best effort cleanup for an incomplete atomic replacement.
    }
    throw error;
  }
}

function writeTextFile(targetRoot, targetPath, content) {
  writeResolvedTextFile(
    resolveSafeTextTarget(targetRoot, targetPath),
    content,
  );
}

function upsertTextFile(targetRoot, targetPath, content) {
  const resolvedTarget = resolveSafeTextTarget(targetRoot, targetPath);
  if (fs.existsSync(resolvedTarget)) {
    const existing = fs.readFileSync(resolvedTarget, "utf8");
    if (existing === content) return false;
  }
  writeResolvedTextFile(resolvedTarget, content);
  return true;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function upsertSectionByMarkers(
  targetRoot,
  targetPath,
  startMarker,
  endMarker,
  sectionContent,
) {
  const resolvedTarget = resolveSafeTextTarget(targetRoot, targetPath);
  const block = `${startMarker}\n${sectionContent.trimEnd()}\n${endMarker}`;
  const existing = fs.existsSync(resolvedTarget)
    ? fs.readFileSync(resolvedTarget, "utf8")
    : "";
  const hasMarkers =
    existing.includes(startMarker) && existing.includes(endMarker);

  if (hasMarkers) {
    const pattern = new RegExp(
      `${escapeRegex(startMarker)}[\\s\\S]*?${escapeRegex(endMarker)}`,
    );
    const replaced = existing.replace(pattern, block);
    if (replaced === existing) return false;
    writeResolvedTextFile(
      resolvedTarget,
      replaced.endsWith("\n") ? replaced : `${replaced}\n`,
    );
    return true;
  }

  let next = existing;
  if (next.length > 0 && !next.endsWith("\n")) next += "\n";
  if (next.trim().length > 0 && !next.endsWith("\n\n")) next += "\n";
  next += `${block}\n`;
  writeResolvedTextFile(resolvedTarget, next);
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
    if (upsertTextFile(targetDir, targetPath, spec.content)) changed += 1;
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
- Before implementing a code task, run \`cortex guidance <target> --task <task> --json\`. Treat it as cited additive context, not policy authority; use normal \`search\`, \`related\`, and \`impact\` as needed, and never skip explicit active rules or conflicts.
- Review changed files with \`cortex pattern-evidence <file> --json\` before finalizing.
- After coding and before finalization, run \`cortex review --diff --json\`. Treat deterministic findings and heuristic warnings as cited additive review evidence, not policy authority.
- Run \`cortex update\` before completing substantial code changes.
- If background sync is enabled, check with \`cortex watch status\`.`;
  const changed = upsertSectionByMarkers(
    targetDir,
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
  const indexingScript = path.join(
    targetDir,
    CONTEXT_SCRIPTS_REL,
    "indexing.mjs",
  );
  if (!fs.existsSync(indexingScript)) return true;
  if (fs.existsSync(path.join(targetDir, "mcp", "package.json"))) return true;
  const mcpPackage = path.join(targetDir, MCP_PROJECT_REL, "package.json");
  if (!fs.existsSync(mcpPackage)) return true;
  try {
    const contents = fs.readFileSync(contextScript, "utf8");
    if (!/\bdoctor\)\s*\n/.test(contents) || !/\bindexing\)\s*\n/.test(contents)) return true;
  } catch {
    return true;
  }
  return false;
}
