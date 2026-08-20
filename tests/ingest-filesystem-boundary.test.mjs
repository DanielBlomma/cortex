import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

import {
  CortexFilesystemPolicyError,
  DASHBOARD_DATA_IDENTITIES,
  INGEST_JSONL_OUTPUT_IDENTITIES,
  INGEST_MANIFEST_OUTPUT_IDENTITY,
  INGEST_OUTPUT_IDENTITIES,
  INGEST_TSV_OUTPUT_IDENTITIES,
  PRIOR_CACHE_IDENTITIES,
  createFilesystemBoundary,
  createFilesystemBoundaryFromAnchor,
  normalizeConfiguredSource,
  renderFilesystemPolicyError,
  workerPolicyErrorFromMessage
} from "../scaffold/scripts/lib/ingest/filesystem-boundary.mjs";
import { parseSourcePaths as canonicalParseSourcePaths } from "../scaffold/scripts/lib/ingest/config.mjs";
import {
  collectCandidateFiles,
  parseGitStatusPorcelain
} from "../scaffold/scripts/lib/ingest/files.mjs";
import { generateModuleSummary } from "../scaffold/scripts/lib/ingest/chunks.mjs";
import { parseFilesInWorkers } from "../scaffold/scripts/lib/ingest/workers.mjs";
import {
  gatherData as rootGatherData,
  parseSourcePaths as rootDashboardParseSourcePaths,
  scanBaseline
} from "../scripts/dashboard.mjs";
import {
  gatherData as packagedGatherData,
  parseSourcePaths as packagedDashboardParseSourcePaths,
  scanBaseline as packagedScanBaseline
} from "../scaffold/scripts/dashboard.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INGEST = path.join(REPO_ROOT, "scaffold", "scripts", "ingest.mjs");
const ROOT_DASHBOARD = path.join(REPO_ROOT, "scripts", "dashboard.mjs");
const PACKAGED_DASHBOARD = path.join(REPO_ROOT, "scaffold", "scripts", "dashboard.mjs");
const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const FIXED_MTIME = new Date("2026-01-01T00:00:00.000Z");

function makeParent(label) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), `cortex-${label}-`));
  const project = path.join(parent, "project");
  fs.mkdirSync(project);
  return { parent, project };
}

function makeShortParent() {
  const parent = fs.mkdtempSync(path.join("/tmp", "cx-"));
  const project = path.join(parent, "p");
  fs.mkdirSync(project);
  return { parent, project };
}

function writeControls(project, sourcePaths = ["src"]) {
  fs.mkdirSync(path.join(project, ".context"), { recursive: true });
  fs.writeFileSync(
    path.join(project, ".context", "config.yaml"),
    `repo_id: boundary-test\nsource_paths:\n${sourcePaths.map((value) => `  - ${value}`).join("\n")}\n`,
    "utf8"
  );
  fs.writeFileSync(path.join(project, ".context", "rules.yaml"), "rules: []\n", "utf8");
}

function writeConfigText(project, configText) {
  fs.mkdirSync(path.join(project, ".context"), { recursive: true });
  fs.writeFileSync(path.join(project, ".context", "config.yaml"), configText, "utf8");
  if (!fs.existsSync(path.join(project, ".context", "rules.yaml"))) {
    fs.writeFileSync(path.join(project, ".context", "rules.yaml"), "rules: []\n", "utf8");
  }
}

function replaceProjectRoot(project, kind = "directory") {
  const original = `${project}-original`;
  fs.renameSync(project, original);
  if (kind === "symlink") {
    const replacement = `${project}-replacement`;
    fs.mkdirSync(replacement);
    fs.symlinkSync(replacement, project, "dir");
    return { original, replacement };
  }
  fs.mkdirSync(project);
  return { original, replacement: project };
}

function installRootDashboard(project) {
  const scriptsDirectory = path.join(project, "scripts");
  const ingestLibrary = path.join(project, "scaffold", "scripts", "lib", "ingest");
  fs.mkdirSync(scriptsDirectory, { recursive: true });
  fs.mkdirSync(path.dirname(ingestLibrary), { recursive: true });
  fs.copyFileSync(ROOT_DASHBOARD, path.join(scriptsDirectory, "dashboard.mjs"));
  fs.cpSync(path.join(REPO_ROOT, "scaffold", "scripts", "lib", "ingest"), ingestLibrary, { recursive: true });
  return path.join(scriptsDirectory, "dashboard.mjs");
}

function installPackagedDashboard(project) {
  const packagedDirectory = path.join(project, "scaffold", "scripts");
  const ingestLibrary = path.join(packagedDirectory, "lib", "ingest");
  fs.mkdirSync(packagedDirectory, { recursive: true });
  fs.copyFileSync(PACKAGED_DASHBOARD, path.join(packagedDirectory, "dashboard.mjs"));
  fs.cpSync(path.join(REPO_ROOT, "scaffold", "scripts", "lib", "ingest"), ingestLibrary, { recursive: true });
  return path.join(packagedDirectory, "dashboard.mjs");
}

function injectNpmCachePolicyFailure(project) {
  const boundaryPath = path.join(
    project,
    "scaffold",
    "scripts",
    "lib",
    "ingest",
    "filesystem-boundary.mjs"
  );
  const source = fs.readFileSync(boundaryPath, "utf8");
  const needle = [
    "      npmCachePath() {",
    "        assertCompleteSnapshot();",
    "        return path.join(root, \".context\", \"cache\", \"npm-cache\");",
    "      },"
  ].join("\n");
  const replacement = [
    "      npmCachePath() {",
    "        assertCompleteSnapshot();",
    "        throw new CortexFilesystemPolicyError({",
    "          code: \"CORTEX_FS_DASHBOARD\",",
    "          phase: \"dashboard_data\",",
    "          subject_kind: \"dashboard_path\",",
    "          subject: \".context/cache/npm-cache\",",
    "          reason: \"path_replaced\"",
    "        });",
    "      },"
  ].join("\n");
  assert.ok(source.includes(needle));
  fs.writeFileSync(boundaryPath, source.replace(needle, replacement), "utf8");
}

function installFakeNpm(parent) {
  const marker = path.join(parent, "npm-invoked");
  const fakeBin = path.join(parent, "bin");
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(
    path.join(fakeBin, "npm"),
    `#!/bin/sh\nprintf invoked > ${JSON.stringify(marker)}\nprintf '\"2.4.2\"\\n'\n`,
    { mode: 0o755 }
  );
  return { marker, path: `${fakeBin}:/usr/bin:/bin` };
}

function runPseudoTtyDashboard({ parent, project, dashboardPath, trigger, cliVersion = "", extraEnv = {} }) {
  const runner = path.join(parent, `tty-${trigger}-${path.basename(path.dirname(dashboardPath))}.mjs`);
  const rawState = path.join(parent, `raw-${trigger}-${path.basename(path.dirname(dashboardPath))}.log`);
  fs.writeFileSync(runner, [
    `import fs from "node:fs";`,
    `import { pathToFileURL } from "node:url";`,
    `const project = ${JSON.stringify(project)};`,
    `const trigger = ${JSON.stringify(trigger)};`,
    `const rawState = ${JSON.stringify(rawState)};`,
    `Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });`,
    `Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });`,
    `process.stdin.setRawMode = (enabled) => fs.appendFileSync(rawState, \`\${enabled}\\n\`);`,
    `process.argv = [process.execPath, ${JSON.stringify(runner)}, "--interval", "0.03"];`,
    `const { main } = await import(pathToFileURL(${JSON.stringify(dashboardPath)}).href);`,
    `main();`,
    `if (trigger !== "startup" && trigger !== "data") {`,
    `  setTimeout(() => {`,
    `    if (trigger === "reload") {`,
    `      const config = project + "/.context/config.yaml";`,
    `      fs.renameSync(config, config + ".safe");`,
    `      const canary = project + "-config-canary";`,
    `      fs.writeFileSync(canary, "source_paths:\\n  - .\\n# SIBLING_CANARY\\n");`,
    `      fs.symlinkSync(canary, config);`,
    `      process.stdin.emit("data", "r");`,
    `      return;`,
    `    }`,
    `    const parked = project + "-parked-" + trigger;`,
    `    const replacement = project + "-replacement-" + trigger;`,
    `    fs.renameSync(project, parked);`,
    `    fs.mkdirSync(replacement);`,
    `    fs.symlinkSync(replacement, project, "dir");`,
    `    if (trigger === "resize") process.stdout.emit("resize");`,
    `  }, 60);`,
    `}`,
    `setTimeout(() => { if (process.exitCode !== 1) process.exit(97); }, 500);`,
    ``
  ].join("\n"), "utf8");
  const result = spawnSync(process.execPath, [runner], {
    cwd: project,
    encoding: "utf8",
    timeout: 5000,
    env: {
      ...process.env,
      CORTEX_PROJECT_ROOT: project,
      CORTEX_CLI_VERSION: cliVersion,
      PATH: "/usr/bin:/bin",
      ...extraEnv
    }
  });
  return {
    ...result,
    rawModes: fs.existsSync(rawState)
      ? fs.readFileSync(rawState, "utf8").trim().split(/\r?\n/).filter(Boolean)
      : []
  };
}

function runIngest(project, args = [], extraEnv = {}) {
  return spawnSync(process.execPath, [INGEST, ...args], {
    cwd: project,
    encoding: "utf8",
    env: {
      ...process.env,
      CORTEX_PROJECT_ROOT: project,
      CORTEX_DOTNET_CMD: path.join(project, "missing-dotnet"),
      CORTEX_INGEST_WORKERS: "0",
      ...extraEnv
    }
  });
}

function runGit(project, args) {
  const hooks = path.join(path.dirname(project), "git-hooks");
  fs.mkdirSync(hooks, { recursive: true });
  const result = spawnSync("git", ["-c", `core.hooksPath=${hooks}`, ...args], {
    cwd: project,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: path.join(path.dirname(project), "git-home"),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: path.join(path.dirname(project), "git-config")
    }
  });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function initializeGit(project) {
  fs.writeFileSync(path.join(project, ".gitignore"), ".context/cache/\n.context/db/\n", "utf8");
  runGit(project, ["init"]);
  runGit(project, ["checkout", "-b", "main"]);
  runGit(project, ["config", "user.email", "tests@example.com"]);
  runGit(project, ["config", "user.name", "Cortex Tests"]);
  runGit(project, ["add", "."]);
  runGit(project, ["commit", "-m", "boundary fixture"]);
}

function readJsonl(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  return text ? text.split("\n").map((line) => JSON.parse(line)) : [];
}

function normalizedOutputs(project) {
  const output = {};
  for (const relativeDirectory of [".context/cache", ".context/db/import"]) {
    const directory = path.join(project, relativeDirectory);
    for (const name of fs.readdirSync(directory).sort()) {
      if (!name.endsWith(".jsonl") && !name.endsWith(".tsv")) continue;
      const relative = path.posix.join(relativeDirectory, name);
      output[relative] = fs.readFileSync(path.join(directory, name), "utf8")
        .replace(ISO_TIMESTAMP, "<timestamp>");
    }
  }
  return output;
}

function assertPolicy(error, { code, phase, kind, reason }) {
  assert.ok(error instanceof CortexFilesystemPolicyError);
  assert.equal(error.code, code);
  assert.equal(error.phase, phase);
  assert.equal(error.subject_kind, kind);
  if (reason) assert.equal(error.reason, reason);
  return true;
}

function projectPath(project, identity) {
  return path.join(project, ...identity.split("/"));
}

function seedOutputSet(project, prefix = "old") {
  for (const identity of INGEST_OUTPUT_IDENTITIES) {
    const target = projectPath(project, identity);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${prefix}:${identity}\n`, "utf8");
  }
}

function stageCompleteOutputSet(outputSet, prefix = "new") {
  for (const identity of INGEST_OUTPUT_IDENTITIES) {
    outputSet.stage(identity, (descriptor) => {
      fs.writeSync(descriptor, `${prefix}:${identity}\n`, undefined, "utf8");
    });
  }
}

function temporaryOutputNames(project) {
  const names = [];
  for (const relativeDirectory of [".context/cache", ".context/db/import"]) {
    const directory = path.join(project, relativeDirectory);
    if (!fs.existsSync(directory)) continue;
    const stats = fs.lstatSync(directory);
    if (stats.isSymbolicLink() || !stats.isDirectory()) continue;
    for (const name of fs.readdirSync(directory)) {
      if (name.startsWith(".") && name.endsWith(".tmp")) names.push(name);
    }
  }
  return names.sort();
}

function temporaryOutputPathsBelow(project) {
  const paths = [];
  const pending = [path.join(project, ".context")];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) pending.push(candidate);
      if (entry.isFile() && entry.name.startsWith(".") && entry.name.endsWith(".tmp")) {
        paths.push(candidate);
      }
    }
  }
  return paths.sort();
}

async function createFilesystemKind(target, kind, parent) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (kind === "symlink") {
    const canary = path.join(parent, `canary-${path.basename(target)}-${Date.now()}-${Math.random()}`);
    fs.writeFileSync(canary, "canary\n", "utf8");
    fs.symlinkSync(canary, target);
    return async () => {};
  }
  if (kind === "directory") {
    fs.mkdirSync(target);
    return async () => {};
  }
  if (kind === "file") {
    fs.writeFileSync(target, "wrong type\n", "utf8");
    return async () => {};
  }
  if (kind === "fifo") {
    const made = spawnSync("mkfifo", [target], { encoding: "utf8" });
    if (made.status !== 0) return null;
    return async () => {};
  }
  if (kind === "socket") {
    if (Buffer.byteLength(target) > 100) return null;
    const server = net.createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(target, resolve);
    });
    return async () => new Promise((resolve) => server.close(resolve));
  }
  throw new Error(`unsupported fixture kind: ${kind}`);
}

test("project anchoring rejects missing and non-directory selections while accepting a symlink spelling", () => {
  const { parent, project } = makeParent("project-anchor");
  try {
    assert.throws(
      () => createFilesystemBoundary(path.join(parent, "missing")),
      (error) => assertPolicy(error, {
        code: "CORTEX_FS_PROJECT", phase: "project", kind: "project", reason: "missing"
      })
    );
    const fileRoot = path.join(parent, "file-root");
    fs.writeFileSync(fileRoot, "not a directory", "utf8");
    assert.throws(
      () => createFilesystemBoundary(fileRoot),
      (error) => assertPolicy(error, {
        code: "CORTEX_FS_PROJECT", phase: "project", kind: "project", reason: "not_directory"
      })
    );
    const link = path.join(parent, "project-link");
    fs.symlinkSync(project, link, "dir");
    assert.equal(createFilesystemBoundary(link).root, fs.realpathSync.native(project));
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("established root identity denies real-directory and symlink replacements across every source consumer", async () => {
  const kinds = ["directory", ...(process.platform === "win32" ? [] : ["symlink"])];
  for (const kind of kinds) {
    const { parent, project } = makeParent(`root-replacement-${kind}`);
    try {
      writeControls(project, ["src"]);
      fs.mkdirSync(path.join(project, "src"));
      fs.writeFileSync(path.join(project, "src", "app.js"), "export const safe = true;\n", "utf8");
      fs.writeFileSync(path.join(project, "src", "README.md"), "# Safe\n\nSafe module text long enough.\n", "utf8");
      const boundary = createFilesystemBoundary(project);
      assert.equal(createFilesystemBoundaryFromAnchor(boundary.anchor).root, boundary.root);
      const { original, replacement } = replaceProjectRoot(project, kind);
      fs.mkdirSync(path.join(replacement, "src"), { recursive: true });
      const canary = path.join(replacement, "src", "app.js");
      fs.writeFileSync(canary, "SIBLING_CANARY", "utf8");
      const expectedReason = kind === "symlink" ? "symlink_component" : "path_replaced";

      assert.throws(
        () => boundary.readRepositoryFile("src/app.js"),
        (error) => assertPolicy(error, {
          code: "CORTEX_FS_SOURCE", phase: "direct_read", kind: "repository_path", reason: expectedReason
        })
      );
      await assert.rejects(
        parseFilesInWorkers([{
          id: "file:src/app.js",
          ext: ".js",
          path: "src/app.js",
          projectAnchor: boundary.anchor,
          contentLimit: 1000
        }], { workerCount: 1 }),
        (error) => assertPolicy(error, {
          code: "CORTEX_FS_SOURCE", phase: "worker_read", kind: "repository_path", reason: expectedReason
        })
      );
      assert.throws(
        () => generateModuleSummary(
          "src",
          [{ kind: "CODE", path: "src/app.js" }, { kind: "DOC", path: "src/info.md" }],
          [],
          project,
          boundary
        ),
        (error) => assertPolicy(error, {
          code: "CORTEX_FS_SOURCE", phase: "secondary_read", kind: "repository_path", reason: expectedReason
        })
      );
      for (const dashboardScan of [scanBaseline, packagedScanBaseline]) {
        assert.throws(
          () => dashboardScan(project, undefined, boundary),
          (error) => assertPolicy(error, {
            code: "CORTEX_FS_CONTROL", phase: "control", kind: "control", reason: expectedReason
          })
        );
      }
      assert.equal(fs.readFileSync(canary, "utf8"), "SIBLING_CANARY");
      assert.equal(fs.existsSync(path.join(replacement, ".context", "cache")), false);
      assert.equal(fs.existsSync(path.join(original, ".context", "cache")), false);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  }
});

test("control validation rejects symlinked, directory, and redirected .context layouts", () => {
  const variants = [
    "context-symlink",
    "context-file",
    "config-symlink",
    "config-directory",
    "rules-symlink",
    "rules-directory",
    ...(process.platform === "win32" ? [] : ["config-fifo", "rules-fifo"])
  ];
  for (const variant of variants) {
    const { parent, project } = makeParent(`control-${variant}`);
    try {
      const sibling = path.join(parent, "sibling");
      fs.mkdirSync(sibling);
      fs.writeFileSync(path.join(sibling, "config.yaml"), "source_paths:\n  - src\n", "utf8");
      fs.writeFileSync(path.join(sibling, "rules.yaml"), "rules: []\n", "utf8");
      if (variant === "context-symlink") fs.symlinkSync(sibling, path.join(project, ".context"), "dir");
      if (variant === "context-file") fs.writeFileSync(path.join(project, ".context"), "file", "utf8");
      if (!["context-symlink", "context-file"].includes(variant)) {
        writeControls(project);
        const isConfig = variant.startsWith("config-");
        const controlName = isConfig ? "config.yaml" : "rules.yaml";
        const controlPath = path.join(project, ".context", controlName);
        fs.rmSync(controlPath);
        if (variant.endsWith("symlink")) {
          fs.symlinkSync(path.join(sibling, controlName), controlPath);
        } else if (variant.endsWith("directory")) {
          fs.mkdirSync(controlPath);
        } else if (variant.endsWith("fifo")) {
          const made = spawnSync("mkfifo", [controlPath], { encoding: "utf8" });
          assert.equal(made.status, 0, made.stderr);
        }
      }
      const result = runIngest(project);
      assert.notEqual(result.status, 0, variant);
      assert.match(result.stderr, /^cortex: filesystem policy denied \[CORTEX_FS_CONTROL\]/);
      assert.doesNotMatch(result.stderr, /\n\s+at /);
      assert.equal(fs.existsSync(path.join(project, ".context", "cache")), false);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  }
});

test("portable configured-source syntax accepts aliases and rejects non-portable spellings on every host", () => {
  assert.equal(normalizeConfiguredSource("."), "");
  assert.equal(normalizeConfiguredSource("./src/"), "src");
  assert.equal(normalizeConfiguredSource("src//nested"), "src/nested");
  assert.equal(normalizeConfiguredSource("src/./nested"), "src/nested");

  for (const value of [
    "", "   ", "\0", "/tmp/source", "../source", "src/../source",
    "C:\\source", "C:source", "\\source", "\\\\server\\share", "\\\\?\\device",
    "src\\nested", "./C:source", "./C:/source", "././C:source", ".//./C:/source"
  ]) {
    assert.throws(
      () => normalizeConfiguredSource(value),
      (error) => assertPolicy(error, {
        code: "CORTEX_FS_SOURCE", phase: "discovery", kind: "configured_source", reason: "invalid_syntax"
      }),
      JSON.stringify(value)
    );
  }
});

test("one shared quote-aware parser preserves empty list entries for canonical rejection", () => {
  const configText = [
    "repo_id: parser-test",
    "source_paths: # shared parser header comment",
    "  -",
    "  - # comment-only entry",
    "  - \"\" # quoted empty",
    "  - '' # single-quoted empty",
    "  - src # trailing comment",
    "  - \"quoted # directory\" # comment",
    "  - 'single # directory' # comment",
    "  - src#literal",
    "rules_file: .context/rules.yaml",
    ""
  ].join("\n");
  const expected = ["", "", "", "", "src", "quoted # directory", "single # directory", "src#literal"];
  assert.deepEqual(canonicalParseSourcePaths(configText), expected);
  assert.deepEqual(rootDashboardParseSourcePaths(configText), expected);
  assert.deepEqual(packagedDashboardParseSourcePaths(configText), expected);

  const { parent, project } = makeParent("empty-source-entry");
  try {
    writeConfigText(project, configText);
    const ingest = runIngest(project);
    assert.notEqual(ingest.status, 0);
    assert.match(ingest.stderr, /CORTEX_FS_SOURCE.*configured_source="".*invalid_syntax/);
    assert.equal(fs.existsSync(path.join(project, ".context", "cache")), false);
    assert.throws(() => scanBaseline(project), CortexFilesystemPolicyError);
    assert.throws(() => packagedScanBaseline(project), CortexFilesystemPolicyError);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("invalid configured source syntax denies before output directories are created", () => {
  const { parent, project } = makeParent("source-syntax-cli");
  try {
    writeControls(project, ["../sibling"]);
    fs.writeFileSync(path.join(parent, "sibling"), "SIBLING_CANARY", "utf8");
    const result = runIngest(project);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /^cortex: filesystem policy denied \[CORTEX_FS_SOURCE\] discovery configured_source="\.\.\/sibling" reason=invalid_syntax$/m);
    assert.equal(fs.existsSync(path.join(project, ".context", "cache")), false);
    assert.equal(fs.existsSync(path.join(project, ".context", "db")), false);
    assert.equal(fs.readFileSync(path.join(parent, "sibling"), "utf8"), "SIBLING_CANARY");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("explicit source links deny, missing contained sources skip, and walked links are ignored", () => {
  const { parent, project } = makeParent("source-resolution");
  try {
    writeControls(project, ["missing"]);
    let boundary = createFilesystemBoundary(project);
    let sources = boundary.validateConfiguredSources(["missing"]);
    assert.equal(sources[0].exists, false);
    assert.equal(collectCandidateFiles(boundary, ["missing"], sources, "full").candidates.size, 0);
    const missingRun = runIngest(project);
    assert.equal(missingRun.status, 0, missingRun.stderr);

    const src = path.join(project, "src");
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, "safe.js"), "export const safe = true;\n", "utf8");
    const sibling = path.join(parent, "sibling.js");
    fs.writeFileSync(sibling, "external canary", "utf8");
    fs.symlinkSync(sibling, path.join(src, "walked.js"));
    boundary = createFilesystemBoundary(project);
    sources = boundary.validateConfiguredSources(["src"]);
    assert.deepEqual([...collectCandidateFiles(boundary, ["src"], sources, "full").candidates], ["src/safe.js"]);
    assert.deepEqual(
      [...collectCandidateFiles(boundary, ["src"], sources, "changed").candidates],
      ["src/safe.js"],
      "Git failure or an empty diff falls back to the full source set"
    );

    assert.throws(
      () => boundary.validateConfiguredSources(["src/walked.js"]),
      (error) => assertPolicy(error, {
        code: "CORTEX_FS_SOURCE", phase: "discovery", kind: "configured_source", reason: "symlink_component"
      })
    );
    const linkedDirectory = path.join(project, "linked-dir");
    fs.symlinkSync(src, linkedDirectory, "dir");
    assert.throws(() => boundary.validateConfiguredSources(["linked-dir/safe.js"]), CortexFilesystemPolicyError);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("candidate reopen rejects symlink, directory, and special-file replacement without reading a sibling canary", { skip: process.platform === "win32" }, () => {
  const { parent, project } = makeParent("candidate-reopen");
  try {
    fs.mkdirSync(path.join(project, "src"));
    const candidate = path.join(project, "src", "app.js");
    const canary = path.join(parent, "canary.js");
    fs.writeFileSync(candidate, "export const safe = true;\n", "utf8");
    fs.writeFileSync(canary, "SIBLING_CANARY", "utf8");
    const boundary = createFilesystemBoundary(project);
    boundary.statRepositoryFile("src/app.js");
    fs.rmSync(candidate);
    fs.symlinkSync(canary, candidate);
    assert.throws(() => boundary.readRepositoryFile("src/app.js"), CortexFilesystemPolicyError);

    fs.rmSync(candidate);
    fs.mkdirSync(candidate);
    assert.throws(() => boundary.statRepositoryFile("src/app.js"), CortexFilesystemPolicyError);
    fs.rmSync(candidate, { recursive: true });

    const fifo = path.join(project, "src", "pipe.js");
    const made = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
    assert.equal(made.status, 0, made.stderr);
    assert.throws(
      () => boundary.statRepositoryFile("src/pipe.js"),
      (error) => assertPolicy(error, {
        code: "CORTEX_FS_SOURCE", phase: "direct_read", kind: "repository_path", reason: "special_file"
      })
    );
    assert.equal(fs.readFileSync(canary, "utf8"), "SIBLING_CANARY");
    assert.equal(fs.existsSync(path.join(project, ".context", "cache")), false);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("NUL-delimited Git parsing preserves quoted-looking, newline, arrow, rename, and deletion identities", () => {
  const { parent, project } = makeParent("git-porcelain");
  try {
    for (const name of ['"quoted".js', "line\nbreak.js", "new -> name.js"]) {
      fs.writeFileSync(path.join(project, name), "export const value = true;\n", "utf8");
    }
    const boundary = createFilesystemBoundary(project);
    const output = [
      ' M "quoted".js',
      " M line\nbreak.js",
      "R  new -> name.js",
      "old -> name.js",
      " D deleted.js",
      ""
    ].join("\0");
    const parsed = parseGitStatusPorcelain(output, boundary);
    assert.deepEqual(parsed.changed, ['"quoted".js', "line\nbreak.js", "new -> name.js"]);
    assert.deepEqual(parsed.deleted, ["old -> name.js", "deleted.js"]);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("invalid Git identities fail closed with the ratified repository-path projection", () => {
  const { parent, project } = makeParent("git-invalid-identity");
  try {
    const canary = path.join(parent, "canary.js");
    fs.writeFileSync(canary, "SIBLING_CANARY", "utf8");
    const boundary = createFilesystemBoundary(project);
    for (const output of [
      ` M ../canary.js\0`,
      ` M ${canary}\0`,
      `M malformed\0`
    ]) {
      assert.throws(
        () => parseGitStatusPorcelain(output, boundary),
        (error) => {
          assertPolicy(error, {
            code: "CORTEX_FS_SOURCE", phase: "discovery", kind: "repository_path"
          });
          assert.equal(error.subject, "<repository-path>");
          return true;
        }
      );
    }
    assert.equal(fs.readFileSync(canary, "utf8"), "SIBLING_CANARY");
    assert.equal(fs.existsSync(path.join(project, ".context", "cache")), false);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("redundant safe aliases preserve full and changed outputs while manifests retain originals", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-source-aliases-"));
  try {
    const values = ["src/nested", "src//nested", "src/./nested"];
    const outputs = [];
    for (let index = 0; index < values.length; index += 1) {
      const project = path.join(parent, `project-${index}`);
      fs.mkdirSync(path.join(project, "src", "nested"), { recursive: true });
      writeControls(project, [values[index]]);
      const file = path.join(project, "src", "nested", "app.js");
      fs.writeFileSync(file, "export const value = 1;\n", "utf8");
      fs.utimesSync(file, FIXED_MTIME, FIXED_MTIME);
      initializeGit(project);

      const full = runIngest(project);
      assert.equal(full.status, 0, full.stderr);
      const fullOutput = normalizedOutputs(project);
      fs.writeFileSync(file, "export const value = 2;\n", "utf8");
      fs.utimesSync(file, new Date("2026-01-02T00:00:00.000Z"), new Date("2026-01-02T00:00:00.000Z"));
      const changed = runIngest(project, ["--changed"]);
      assert.equal(changed.status, 0, changed.stderr);
      const manifest = JSON.parse(fs.readFileSync(path.join(project, ".context", "cache", "manifest.json"), "utf8"));
      assert.deepEqual(manifest.source_paths, [values[index]]);
      outputs.push({ full: fullOutput, changed: normalizedOutputs(project) });
    }
    assert.deepEqual(outputs[1].full, outputs[0].full);
    assert.deepEqual(outputs[2].full, outputs[0].full);
    assert.deepEqual(outputs[1].changed, outputs[0].changed);
    assert.deepEqual(outputs[2].changed, outputs[0].changed);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("POSIX host-valid colon and backslash names survive full, changed, walk, and hydration", { skip: process.platform === "win32" }, () => {
  const { parent, project } = makeParent("host-identities");
  try {
    writeControls(project, ["."]);
    const names = ["C:foo.js", "a\\b.js"];
    for (const name of names) {
      fs.writeFileSync(path.join(project, name), `export const name = ${JSON.stringify(name)};\n`, "utf8");
      fs.utimesSync(path.join(project, name), FIXED_MTIME, FIXED_MTIME);
    }
    initializeGit(project);
    let result = runIngest(project);
    assert.equal(result.status, 0, result.stderr);
    let paths = readJsonl(path.join(project, ".context", "cache", "entities.file.jsonl")).map((record) => record.path);
    for (const name of names) assert.ok(paths.includes(name));

    for (const name of names) fs.appendFileSync(path.join(project, name), "// changed\n", "utf8");
    result = runIngest(project, ["--changed"]);
    assert.equal(result.status, 0, result.stderr);
    paths = readJsonl(path.join(project, ".context", "cache", "entities.file.jsonl")).map((record) => record.path);
    for (const name of names) assert.ok(paths.includes(name));
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("changed ingest handles spaces, quotes, newlines, literal arrows, renames, and deletions", { skip: process.platform === "win32" }, () => {
  const { parent, project } = makeParent("changed-names");
  try {
    writeControls(project, ["src"]);
    fs.mkdirSync(path.join(project, "src"));
    const initial = ["space name.js", '"quote".js', "line\nbreak.js", "old -> name.js", "delete.js"];
    for (const name of initial) fs.writeFileSync(path.join(project, "src", name), "export const value = 1;\n", "utf8");
    initializeGit(project);
    assert.equal(runIngest(project).status, 0);

    fs.appendFileSync(path.join(project, "src", "space name.js"), "// changed\n", "utf8");
    fs.appendFileSync(path.join(project, "src", '"quote".js'), "// changed\n", "utf8");
    fs.appendFileSync(path.join(project, "src", "line\nbreak.js"), "// changed\n", "utf8");
    runGit(project, ["mv", "src/old -> name.js", "src/new\nname.js"]);
    fs.rmSync(path.join(project, "src", "delete.js"));

    const changed = runIngest(project, ["--changed"]);
    assert.equal(changed.status, 0, changed.stderr);
    const paths = readJsonl(path.join(project, ".context", "cache", "entities.file.jsonl")).map((record) => record.path);
    for (const name of ["space name.js", '"quote".js', "line\nbreak.js", "new\nname.js"]) {
      assert.ok(paths.includes(`src/${name}`), JSON.stringify(name));
    }
    assert.equal(paths.includes("src/old -> name.js"), false);
    assert.equal(paths.includes("src/delete.js"), false);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("hydrated file and ADR identities reject absolute, parent, and symlink paths before reuse", { skip: process.platform === "win32" }, () => {
  const cases = [
    { cache: "entities.file.jsonl", kind: "absolute" },
    { cache: "entities.file.jsonl", kind: "parent" },
    { cache: "entities.file.jsonl", kind: "symlink" },
    { cache: "entities.adr.jsonl", kind: "absolute" },
    { cache: "entities.adr.jsonl", kind: "parent" },
    { cache: "entities.adr.jsonl", kind: "symlink" }
  ];
  for (const testCase of cases) {
    const { parent, project } = makeParent(`hydration-${testCase.cache}-${testCase.kind}`);
    try {
      writeControls(project, ["src"]);
      fs.mkdirSync(path.join(project, "src"));
      const source = path.join(project, "src", "app.js");
      fs.writeFileSync(source, "export const value = 1;\n", "utf8");
      initializeGit(project);
      assert.equal(runIngest(project).status, 0);
      const sibling = path.join(parent, testCase.cache.includes("adr") ? "canary.md" : "canary.js");
      fs.writeFileSync(sibling, "SIBLING_CANARY", "utf8");
      let hostilePath = sibling;
      if (testCase.kind === "parent") hostilePath = `../${path.basename(sibling)}`;
      if (testCase.kind === "symlink") {
        hostilePath = `src/linked${path.extname(sibling)}`;
        fs.symlinkSync(sibling, path.join(project, hostilePath));
      }
      const record = testCase.cache.includes("adr")
        ? { id: "adr:hostile", path: hostilePath, body: "cached" }
        : { id: `file:${hostilePath}`, path: hostilePath, content: "cached" };
      fs.writeFileSync(
        path.join(project, ".context", "cache", testCase.cache),
        `${JSON.stringify(record)}\n`,
        "utf8"
      );
      fs.appendFileSync(source, "// changed\n", "utf8");
      const result = runIngest(project, ["--changed"]);
      assert.notEqual(result.status, 0, `${testCase.cache}/${testCase.kind}`);
      assert.match(
        result.stderr,
        testCase.kind === "symlink"
          ? /CORTEX_FS_SOURCE.*discovery.*symlink_component/
          : /CORTEX_FS_SOURCE.*discovery.*outside_project/
      );
      assert.doesNotMatch(result.stderr, new RegExp(sibling.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.doesNotMatch(result.stdout, /\[ingest\] complete/);
      assert.equal(fs.readFileSync(sibling, "utf8"), "SIBLING_CANARY");
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  }
});

test("worker independently denies a pre-dispatch source swap and malformed policy envelopes are fatal", { skip: process.platform === "win32" }, async () => {
  const { parent, project } = makeParent("worker-policy");
  try {
    fs.mkdirSync(path.join(project, "src"));
    const source = path.join(project, "src", "app.js");
    const canary = path.join(parent, "canary.js");
    fs.writeFileSync(source, "export const safe = true;\n", "utf8");
    fs.writeFileSync(canary, "SIBLING_CANARY", "utf8");
    const boundary = createFilesystemBoundary(project);
    boundary.statRepositoryFile("src/app.js");
    fs.rmSync(source);
    fs.symlinkSync(canary, source);

    await assert.rejects(
      parseFilesInWorkers([{
        id: "file:src/app.js",
        ext: ".js",
        path: "src/app.js",
        projectAnchor: boundary.anchor,
        contentLimit: 1000
      }], { workerCount: 1 }),
      (error) => assertPolicy(error, {
        code: "CORTEX_FS_SOURCE", phase: "worker_read", kind: "repository_path", reason: "symlink_component"
      })
    );

    const malformed = workerPolicyErrorFromMessage({
      type: "policy_error",
      error: { code: "CORTEX_FS_SOURCE" }
    }, "src/app.js");
    assertPolicy(malformed, {
      code: "CORTEX_FS_SOURCE", phase: "worker_read", kind: "repository_path", reason: "worker_protocol"
    });
    assert.equal(fs.readFileSync(canary, "utf8"), "SIBLING_CANARY");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("production workers reject injected content and parent streams reject malformed result envelopes", async () => {
  const { parent, project } = makeParent("worker-envelope-policy");
  try {
    fs.mkdirSync(path.join(project, "src"));
    fs.writeFileSync(path.join(project, "src", "app.js"), "export const disk = true;\n", "utf8");
    const boundary = createFilesystemBoundary(project);
    const productionWorker = new Worker(new URL("../scaffold/scripts/ingest-worker.mjs", import.meta.url));
    try {
      const response = new Promise((resolve, reject) => {
        productionWorker.once("message", resolve);
        productionWorker.once("error", reject);
      });
      productionWorker.postMessage({
        taskId: "file:src/app.js",
        ext: ".js",
        filePath: "src/app.js",
        contentLimit: 1000,
        projectAnchor: boundary.anchor,
        content: "export const injected = true;"
      });
      const message = await response;
      assert.equal(message.type, "policy_error");
      assert.equal(message.error.reason, "worker_protocol");
    } finally {
      await productionWorker.terminate();
    }

    const payloads = [
      `{ taskId: message.taskId, ok: true, result: { chunks: [], errors: [] }, content: "injected" }`,
      `{ taskId: message.taskId, ok: true, result: {} }`,
      `{ taskId: message.taskId, ok: true, result: [] }`,
      `{ taskId: message.taskId, ok: true, result: { chunks: {}, errors: [] } }`,
      `{ taskId: message.taskId, ok: true, result: { chunks: [], errors: "invalid" } }`,
      `{ taskId: message.taskId, ok: true, result: { chunks: [], errors: [], extra: true } }`,
      `{ type: "policy_error", error: { code: "CORTEX_FS_SOURCE" } }`
    ];
    for (let index = 0; index < payloads.length; index += 1) {
      const workerPath = path.join(parent, `malformed-${index}.mjs`);
      fs.writeFileSync(workerPath, [
        `import { parentPort } from "node:worker_threads";`,
        `parentPort.on("message", (message) => {`,
        `  if (message?.type === "shutdown") process.exit(0);`,
        `  parentPort.postMessage(${payloads[index]});`,
        `});`,
        ``
      ].join("\n"), "utf8");
      await assert.rejects(
        parseFilesInWorkers([{
          id: "file:src/app.js",
          ext: ".js",
          path: "src/app.js",
          projectAnchor: boundary.anchor,
          contentLimit: 1000
        }], { workerCount: 1, workerUrl: pathToFileURL(workerPath) }),
        (error) => assertPolicy(error, {
          code: "CORTEX_FS_SOURCE", phase: "worker_read", kind: "repository_path", reason: "worker_protocol"
        })
      );
    }

    const validWorkerPath = path.join(parent, "valid-result.mjs");
    fs.writeFileSync(validWorkerPath, [
      `import { parentPort } from "node:worker_threads";`,
      `parentPort.on("message", (message) => {`,
      `  if (message?.type === "shutdown") process.exit(0);`,
      `  parentPort.postMessage({ taskId: message.taskId, ok: true, result: { chunks: [], errors: [] } });`,
      `});`,
      ``
    ].join("\n"), "utf8");
    const validResults = await parseFilesInWorkers([{
      id: "file:src/app.js",
      ext: ".js",
      path: "src/app.js",
      projectAnchor: boundary.anchor,
      contentLimit: 1000
    }], { workerCount: 1, workerUrl: pathToFileURL(validWorkerPath) });
    assert.deepEqual(validResults.get("file:src/app.js"), { chunks: [], errors: [] });
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("secondary README preserves safe fallback but propagates symlink denial", { skip: process.platform === "win32" }, () => {
  const { parent, project } = makeParent("readme-policy");
  try {
    fs.mkdirSync(path.join(project, "src"));
    const files = [{ kind: "CODE", path: "src/app.js" }, { kind: "DOC", path: "src/info.md" }];
    const fallback = generateModuleSummary("src", files, [], project);
    assert.match(fallback, /^Module src\./);
    fs.writeFileSync(path.join(project, "src", "README.md"), "# Source\n\nA safe module description long enough to use.\n", "utf8");
    assert.match(generateModuleSummary("src", files, [], project), /safe module description/);
    fs.rmSync(path.join(project, "src", "README.md"));
    const canary = path.join(parent, "README.md");
    fs.writeFileSync(canary, "# Canary\n\nSIBLING_CANARY", "utf8");
    fs.symlinkSync(canary, path.join(project, "src", "README.md"));
    assert.throws(
      () => generateModuleSummary("src", files, [], project),
      (error) => assertPolicy(error, {
        code: "CORTEX_FS_SOURCE", phase: "secondary_read", kind: "repository_path", reason: "symlink_component"
      })
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("secondary README distinguishes ordinary unreadable files from directory and special-file policy violations", { skip: process.platform === "win32" }, () => {
  const variants = ["unreadable", "directory", "fifo"];
  for (const variant of variants) {
    const { parent, project } = makeParent(`readme-${variant}`);
    const readme = path.join(project, "src", "README.md");
    try {
      fs.mkdirSync(path.dirname(readme));
      const files = [{ kind: "CODE", path: "src/app.js" }, { kind: "DOC", path: "src/info.md" }];
      if (variant === "unreadable") {
        fs.writeFileSync(readme, "# Hidden\n\nThis text must not be used.\n", "utf8");
        fs.chmodSync(readme, 0o000);
        const summary = generateModuleSummary("src", files, [], project);
        assert.match(summary, /^Module src\./);
        fs.chmodSync(readme, 0o600);
      } else if (variant === "directory") {
        fs.mkdirSync(readme);
        assert.throws(
          () => generateModuleSummary("src", files, [], project),
          (error) => assertPolicy(error, {
            code: "CORTEX_FS_SOURCE", phase: "secondary_read", kind: "repository_path", reason: "not_regular_file"
          })
        );
      } else {
        const made = spawnSync("mkfifo", [readme], { encoding: "utf8" });
        assert.equal(made.status, 0, made.stderr);
        assert.throws(
          () => generateModuleSummary("src", files, [], project),
          (error) => assertPolicy(error, {
            code: "CORTEX_FS_SOURCE", phase: "secondary_read", kind: "repository_path", reason: "special_file"
          })
        );
      }
      assert.equal(fs.existsSync(path.join(project, ".context", "cache")), false);
    } finally {
      try { fs.chmodSync(readme, 0o600); } catch {}
      fs.rmSync(parent, { recursive: true, force: true });
    }
  }
});

test("root and packaged dashboard scans share source policy and deny before data gathering or npm", { skip: process.platform === "win32" }, () => {
  const { parent, project } = makeParent("dashboard-policy");
  try {
    writeControls(project, ["linked"]);
    const sibling = path.join(parent, "sibling");
    fs.mkdirSync(sibling);
    fs.writeFileSync(path.join(sibling, "canary.js"), "SIBLING_CANARY", "utf8");
    fs.symlinkSync(sibling, path.join(project, "linked"), "dir");
    assert.throws(() => scanBaseline(project), CortexFilesystemPolicyError);

    const fakeBin = path.join(parent, "bin");
    const marker = path.join(parent, "npm-called");
    fs.mkdirSync(fakeBin);
    const fakeNpm = path.join(fakeBin, "npm");
    fs.writeFileSync(fakeNpm, `#!/bin/sh\nprintf called > ${JSON.stringify(marker)}\n`, { mode: 0o755 });
    const result = spawnSync(process.execPath, [PACKAGED_DASHBOARD], {
      cwd: project,
      encoding: "utf8",
      env: {
        ...process.env,
        CORTEX_PROJECT_ROOT: project,
        CORTEX_CLI_VERSION: "2.4.2",
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`
      }
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /^cortex: filesystem policy denied \[CORTEX_FS_SOURCE\]/);
    assert.equal(result.stdout, "");
    assert.equal(fs.existsSync(marker), false);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("dashboard validates only config.yaml because rules.yaml is not a dashboard input", () => {
  const { parent, project } = makeParent("dashboard-control-scope");
  try {
    fs.mkdirSync(path.join(project, ".context"), { recursive: true });
    fs.mkdirSync(path.join(project, "src"));
    fs.writeFileSync(path.join(project, ".context", "config.yaml"), "source_paths:\n  - src\n", "utf8");
    fs.writeFileSync(path.join(project, "src", "app.js"), "export const value = true;\n", "utf8");
    assert.equal(scanBaseline(project).files, 1);
    const ingest = runIngest(project);
    assert.notEqual(ingest.status, 0);
    assert.match(ingest.stderr, /CORTEX_FS_CONTROL.*rules\.yaml.*missing/);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("dashboard rejects a symlinked config control without reading its target", { skip: process.platform === "win32" }, () => {
  const { parent, project } = makeParent("dashboard-config-link");
  try {
    fs.mkdirSync(path.join(project, ".context"));
    const canary = path.join(parent, "config.yaml");
    fs.writeFileSync(canary, "source_paths:\n  - .\n# SIBLING_CANARY\n", "utf8");
    fs.symlinkSync(canary, path.join(project, ".context", "config.yaml"));
    assert.throws(
      () => scanBaseline(project),
      (error) => assertPolicy(error, {
        code: "CORTEX_FS_CONTROL", phase: "control", kind: "control", reason: "symlink_component"
      })
    );
    assert.equal(fs.readFileSync(canary, "utf8"), "source_paths:\n  - .\n# SIBLING_CANARY\n");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("both dashboard scanners deny empty and alias-prefixed drive syntax plus every hostile config shape", { skip: process.platform === "win32" }, () => {
  const scanners = [scanBaseline, packagedScanBaseline];
  const syntaxValues = ["", "# empty", "././C:outside", ".//C:/outside", "../outside"];
  for (const [scannerIndex, scanner] of scanners.entries()) {
    for (const value of syntaxValues) {
      const { parent, project } = makeParent(`dashboard-syntax-${scannerIndex}`);
      try {
        writeConfigText(project, `source_paths:\n  - ${value}\n`);
        assert.throws(
          () => scanner(project),
          (error) => assertPolicy(error, {
            code: "CORTEX_FS_SOURCE", phase: "discovery", kind: "configured_source", reason: "invalid_syntax"
          })
        );
      } finally {
        fs.rmSync(parent, { recursive: true, force: true });
      }
    }

    for (const variant of ["symlink", "directory", "fifo"]) {
      const { parent, project } = makeParent(`dashboard-control-${scannerIndex}-${variant}`);
      try {
        const context = path.join(project, ".context");
        fs.mkdirSync(context);
        const config = path.join(context, "config.yaml");
        if (variant === "symlink") {
          const canary = path.join(parent, "config.yaml");
          fs.writeFileSync(canary, "source_paths:\n  - .\n# SIBLING_CANARY\n", "utf8");
          fs.symlinkSync(canary, config);
        } else if (variant === "directory") {
          fs.mkdirSync(config);
        } else {
          const made = spawnSync("mkfifo", [config], { encoding: "utf8" });
          assert.equal(made.status, 0, made.stderr);
        }
        assert.throws(
          () => scanner(project),
          (error) => assertPolicy(error, {
            code: "CORTEX_FS_CONTROL", phase: "control", kind: "control"
          })
        );
      } finally {
        fs.rmSync(parent, { recursive: true, force: true });
      }
    }
  }
});

test("both dashboard pseudo-TTY entrypoints handle startup, reload, timer, and resize policy failures once", { skip: process.platform === "win32" }, () => {
  for (const dashboardKind of ["root", "packaged"]) {
    for (const trigger of ["startup", "reload", "timer", "resize"]) {
      const { parent, project } = makeParent(`dashboard-tty-${dashboardKind}-${trigger}`);
      try {
        writeControls(project, trigger === "startup" ? [""] : ["src"]);
        fs.mkdirSync(path.join(project, "src"));
        fs.writeFileSync(path.join(project, "src", "app.js"), "export const value = true;\n", "utf8");
        const dashboardPath = dashboardKind === "root"
          ? installRootDashboard(project)
          : PACKAGED_DASHBOARD;
        const result = runPseudoTtyDashboard({ parent, project, dashboardPath, trigger });
        assert.equal(result.status, 1, `${dashboardKind}/${trigger}: ${result.stderr}`);
        const diagnostics = result.stderr.trim().split(/\r?\n/).filter(Boolean);
        assert.equal(diagnostics.length, 1, `${dashboardKind}/${trigger}: ${result.stderr}`);
        assert.ok([...diagnostics[0]].length <= 256);
        assert.match(diagnostics[0], /^cortex: filesystem policy denied \[/);
        assert.doesNotMatch(diagnostics[0], new RegExp(parent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        if (trigger === "startup") {
          assert.deepEqual(result.rawModes, []);
        } else {
          assert.deepEqual(result.rawModes, ["true", "false"]);
          assert.match(result.stdout, /\x1b\[\?25l/);
          assert.match(result.stdout, /\x1b\[\?25h/);
        }
      } finally {
        fs.rmSync(parent, { recursive: true, force: true });
      }
    }
  }
});

test("policy rendering is bounded, JSON-escaped, and does not disclose symlink targets", () => {
  const longSubject = `${"x".repeat(300)}\\bad\nsecret`;
  let error;
  try {
    normalizeConfiguredSource(longSubject);
  } catch (caught) {
    error = caught;
  }
  const rendered = renderFilesystemPolicyError(error);
  assert.equal([...error.subject].length, 256);
  assert.ok([...rendered].length <= 256);
  assert.match(rendered, /configured_source="/);
  assert.match(rendered, / reason=invalid_syntax$/);
  assert.doesNotMatch(rendered, /\nsecret/);
  assert.equal(rendered.split("\n").length, 1);
  assert.doesNotMatch(rendered, / at |Error:/);
});

test("ingest and both dashboard entrypoints sanitize hostile filesystem errors and cap the complete line", () => {
  const { parent, project } = makeParent("entrypoint-diagnostics");
  try {
    const hostileSource = "a".repeat(5000);
    writeControls(project, [hostileSource]);
    const rootDashboard = installRootDashboard(project);
    const commands = [
      {
        script: INGEST,
        env: {
          CORTEX_PROJECT_ROOT: project,
          CORTEX_DOTNET_CMD: path.join(project, "missing-dotnet"),
          CORTEX_INGEST_WORKERS: "0"
        }
      },
      { script: rootDashboard, env: {} },
      { script: PACKAGED_DASHBOARD, env: { CORTEX_PROJECT_ROOT: project } }
    ];
    for (const { script, env } of commands) {
      const result = spawnSync(process.execPath, [script], {
        cwd: project,
        encoding: "utf8",
        env: { ...process.env, CORTEX_CLI_VERSION: "", PATH: "/usr/bin:/bin", ...env }
      });
      assert.notEqual(result.status, 0, `${script}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
      const lines = result.stderr.trim().split(/\r?\n/).filter(Boolean);
      assert.equal(lines.length, 1, result.stderr);
      assert.ok([...lines[0]].length <= 256, `${[...lines[0]].length} scalars`);
      assert.match(lines[0], /^cortex: filesystem policy denied \[/);
      assert.match(lines[0], / reason=invalid_syntax$/);
      assert.doesNotMatch(lines[0], new RegExp(parent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.doesNotMatch(lines[0], /ENAMETOOLONG| at |Error:/);
    }
    assert.equal(fs.existsSync(path.join(project, ".context", "cache")), false);

    const impossibleRoot = path.join(parent, "r".repeat(5000));
    const rootResult = spawnSync(process.execPath, [INGEST], {
      cwd: project,
      encoding: "utf8",
      env: { ...process.env, CORTEX_PROJECT_ROOT: impossibleRoot }
    });
    assert.notEqual(rootResult.status, 0);
    const rootLine = rootResult.stderr.trim();
    assert.ok([...rootLine].length <= 256);
    assert.match(rootLine, /CORTEX_FS_PROJECT.*project="<project-root>".*invalid_syntax/);
    assert.doesNotMatch(rootLine, /ENAMETOOLONG| at |Error:/);

    if (process.platform !== "win32") {
      writeControls(project, ["src"]);
      const unreadable = path.join(project, "src");
      fs.mkdirSync(unreadable);
      fs.chmodSync(unreadable, 0o000);
      const unreadableResult = runIngest(project);
      fs.chmodSync(unreadable, 0o700);
      assert.notEqual(unreadableResult.status, 0);
      const unreadableLines = unreadableResult.stderr.trim().split(/\r?\n/).filter(Boolean);
      assert.equal(unreadableLines.length, 1);
      assert.ok([...unreadableLines[0]].length <= 256);
      assert.match(unreadableLines[0], /CORTEX_FS_SOURCE.*reason=path_replaced/);
      assert.doesNotMatch(unreadableLines[0], /EACCES|EPERM| at |Error:/);
    }
  } finally {
    try { fs.chmodSync(path.join(project, "src"), 0o700); } catch {}
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("WO-034 inventories exactly seven prior caches and 48 manifest-last outputs", () => {
  assert.equal(PRIOR_CACHE_IDENTITIES.length, 7);
  assert.equal(INGEST_JSONL_OUTPUT_IDENTITIES.length, 26);
  assert.equal(INGEST_TSV_OUTPUT_IDENTITIES.length, 21);
  assert.equal(INGEST_OUTPUT_IDENTITIES.length, 48);
  assert.equal(INGEST_OUTPUT_IDENTITIES.at(-1), INGEST_MANIFEST_OUTPUT_IDENTITY);
  assert.equal(new Set(INGEST_OUTPUT_IDENTITIES).size, 48);
  assert.equal(DASHBOARD_DATA_IDENTITIES.length, 12);
});

test("prior-cache matrix covers every leaf as regular, missing, symlink, directory, and guarded special before reads", async () => {
  for (const [identityIndex, identity] of PRIOR_CACHE_IDENTITIES.entries()) {
    for (const safeKind of ["regular", "missing"]) {
      const { parent, project } = makeParent(`prior-cache-${safeKind}`);
      try {
        writeControls(project);
        if (safeKind === "regular") {
          fs.mkdirSync(path.join(project, ".context", "cache"));
          fs.writeFileSync(projectPath(project, identity), '{"id":"safe"}\n', "utf8");
        }
        const priorCache = createFilesystemBoundary(project).preflightPriorCache();
        assert.deepEqual(
          priorCache.read(identity),
          safeKind === "regular" ? [{ id: "safe" }] : []
        );
      } finally {
        fs.rmSync(parent, { recursive: true, force: true });
      }
    }

    const unsafeKinds = [
      "symlink",
      "directory",
      ...(process.platform === "win32" ? [] : ["fifo"])
    ];
    for (const unsafeKind of unsafeKinds) {
      const { parent, project } = makeParent(`prior-cache-${unsafeKind}`);
      let cleanup = async () => {};
      try {
        writeControls(project);
        fs.mkdirSync(path.join(project, ".context", "cache"));
        for (const candidate of PRIOR_CACHE_IDENTITIES) {
          if (candidate !== identity) {
            fs.writeFileSync(projectPath(project, candidate), '{"id":"safe"}\n', "utf8");
          }
        }
        cleanup = await createFilesystemKind(projectPath(project, identity), unsafeKind, parent);
        if (!cleanup) continue;
        let readCount = 0;
        const originalRead = fs.readFileSync;
        fs.readFileSync = (...args) => {
          readCount += 1;
          return originalRead(...args);
        };
        try {
          assert.throws(
            () => createFilesystemBoundary(project).preflightPriorCache(),
            (error) => {
              assert.equal(error.subject, identity);
              return assertPolicy(error, {
                code: "CORTEX_FS_CACHE",
                phase: "discovery",
                kind: "cache_path"
              });
            }
          );
          assert.equal(readCount, 0, `${identity}/${unsafeKind}`);
        } finally {
          fs.readFileSync = originalRead;
        }
      } finally {
        await cleanup();
        fs.rmSync(parent, { recursive: true, force: true });
      }
    }
  }

  const { parent, project } = makeParent("prior-cache-compatible");
  try {
    writeControls(project);
    fs.mkdirSync(path.join(project, ".context", "cache"));
    const accepted = PRIOR_CACHE_IDENTITIES[0];
    fs.writeFileSync(
      projectPath(project, accepted),
      '\n{"id":"first"}\nnot-json\n{"id":"second"}\n',
      "utf8"
    );
    const priorCache = createFilesystemBoundary(project).preflightPriorCache();
    assert.deepEqual(priorCache.read(accepted).map((record) => record.id), ["first", "second"]);
    assert.deepEqual(priorCache.read(PRIOR_CACHE_IDENTITIES[1]), []);

    fs.writeFileSync(projectPath(project, PRIOR_CACHE_IDENTITIES.at(-1)), "{}\n", "utf8");
    assert.throws(
      () => priorCache.read(accepted),
      (error) => assertPolicy(error, {
        code: "CORTEX_FS_CACHE",
        phase: "discovery",
        kind: "cache_path",
        reason: "path_replaced"
      })
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("output preflight rejects a late invalid leaf before directory creation, staging, or prior output mutation", () => {
  const { parent, project } = makeParent("output-late-preflight");
  try {
    writeControls(project);
    const sentinelIdentity = INGEST_OUTPUT_IDENTITIES[0];
    fs.mkdirSync(path.join(project, ".context", "cache"));
    fs.writeFileSync(projectPath(project, sentinelIdentity), "sentinel\n", "utf8");
    fs.mkdirSync(projectPath(project, INGEST_MANIFEST_OUTPUT_IDENTITY));

    const boundary = createFilesystemBoundary(project);
    assert.throws(
      () => boundary.prepareIngestOutputSet(),
      (error) => {
        assert.equal(error.subject, INGEST_MANIFEST_OUTPUT_IDENTITY);
        return assertPolicy(error, {
          code: "CORTEX_FS_OUTPUT",
          phase: "output_preflight",
          kind: "output_path",
          reason: "not_regular_file"
        });
      }
    );
    assert.equal(fs.readFileSync(projectPath(project, sentinelIdentity), "utf8"), "sentinel\n");
    assert.equal(fs.existsSync(path.join(project, ".context", "db")), false);
    assert.deepEqual(temporaryOutputNames(project), []);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("output preflight matrix covers every leaf as regular, missing, symlink, directory, and guarded special before staging", async () => {
  for (const [identityIndex, identity] of INGEST_OUTPUT_IDENTITIES.entries()) {
    for (const safeKind of ["regular", "missing"]) {
      const { parent, project } = makeParent(`output-${safeKind}`);
      try {
        writeControls(project);
        if (safeKind === "regular") {
          const target = projectPath(project, identity);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, "safe-final\n", "utf8");
        }
        let stageCount = 0;
        const outputSet = createFilesystemBoundary(project).prepareIngestOutputSet({
          testHooks: { beforeStageCreate() { stageCount += 1; } }
        });
        assert.equal(stageCount, 0);
        outputSet.discard();
        if (safeKind === "regular") {
          assert.equal(fs.readFileSync(projectPath(project, identity), "utf8"), "safe-final\n");
        }
      } finally {
        fs.rmSync(parent, { recursive: true, force: true });
      }
    }

    const unsafeKinds = [
      "symlink",
      "directory",
      ...(process.platform === "win32" ? [] : ["fifo"])
    ];
    for (const unsafeKind of unsafeKinds) {
      const { parent, project } = makeParent(`output-${unsafeKind}`);
      let cleanup = async () => {};
      try {
        writeControls(project);
        cleanup = await createFilesystemKind(projectPath(project, identity), unsafeKind, parent);
        if (!cleanup) continue;
        let stageCount = 0;
        assert.throws(
          () => createFilesystemBoundary(project).prepareIngestOutputSet({
            testHooks: { beforeStageCreate() { stageCount += 1; } }
          }),
          (error) => {
            assert.equal(error.subject, identity);
            return assertPolicy(error, {
              code: "CORTEX_FS_OUTPUT",
              phase: "output_preflight",
              kind: "output_path"
            });
          },
          `${identity}/${unsafeKind}`
        );
        assert.equal(stageCount, 0, `${identity}/${unsafeKind}`);
        assert.deepEqual(temporaryOutputNames(project), []);
      } finally {
        await cleanup();
        fs.rmSync(parent, { recursive: true, force: true });
      }
    }
  }
});

test("complete output staging replaces hard-linked JSONL, TSV, and manifest destinations with manifest last", () => {
  const { parent, project } = makeParent("output-hardlinks");
  try {
    writeControls(project);
    seedOutputSet(project);
    const linkedIdentities = [
      INGEST_JSONL_OUTPUT_IDENTITIES[0],
      INGEST_TSV_OUTPUT_IDENTITIES[0],
      INGEST_MANIFEST_OUTPUT_IDENTITY
    ];
    const canaries = new Map();
    for (const [index, identity] of linkedIdentities.entries()) {
      const canary = path.join(parent, `canary-${index}`);
      fs.writeFileSync(canary, `canary-${index}\n`, "utf8");
      fs.rmSync(projectPath(project, identity));
      fs.linkSync(canary, projectPath(project, identity));
      canaries.set(identity, canary);
    }

    const commitOrder = [];
    const outputSet = createFilesystemBoundary(project).prepareIngestOutputSet({
      testHooks: {
        beforeCommit(identity) {
          commitOrder.push(identity);
        }
      }
    });
    stageCompleteOutputSet(outputSet);
    outputSet.commit();

    assert.deepEqual(commitOrder, INGEST_OUTPUT_IDENTITIES);
    assert.equal(commitOrder.at(-1), INGEST_MANIFEST_OUTPUT_IDENTITY);
    for (const [index, identity] of linkedIdentities.entries()) {
      assert.equal(fs.readFileSync(canaries.get(identity), "utf8"), `canary-${index}\n`);
      assert.equal(fs.readFileSync(projectPath(project, identity), "utf8"), `new:${identity}\n`);
      assert.notEqual(
        fs.statSync(canaries.get(identity), { bigint: true }).ino,
        fs.statSync(projectPath(project, identity), { bigint: true }).ino
      );
    }
    assert.deepEqual(temporaryOutputNames(project), []);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("staging collision and write failure clean every run-owned stage without changing final files", () => {
  const { parent, project } = makeParent("output-stage-failures");
  try {
    writeControls(project);
    seedOutputSet(project);
    const collisionIdentity = INGEST_OUTPUT_IDENTITIES[1];
    const collisionPath = path.join(
      path.dirname(projectPath(project, collisionIdentity)),
      `.${path.basename(collisionIdentity)}.collision.tmp`
    );
    fs.writeFileSync(collisionPath, "not-owned\n", "utf8");
    const outputSet = createFilesystemBoundary(project).prepareIngestOutputSet({
      testHooks: {
        stageToken() {
          return "collision";
        }
      }
    });
    outputSet.stage(INGEST_OUTPUT_IDENTITIES[0], (descriptor) => {
      fs.writeSync(descriptor, "staged\n", undefined, "utf8");
    });
    assert.throws(
      () => outputSet.stage(collisionIdentity, () => {}),
      (error) => assertPolicy(error, {
        code: "CORTEX_FS_OUTPUT",
        phase: "output_commit",
        kind: "output_path",
        reason: "path_replaced"
      })
    );
    assert.equal(fs.existsSync(collisionPath), true);
    assert.equal(fs.readFileSync(projectPath(project, INGEST_OUTPUT_IDENTITIES[0]), "utf8"), `old:${INGEST_OUTPUT_IDENTITIES[0]}\n`);
    assert.deepEqual(temporaryOutputNames(project), [path.basename(collisionPath)]);
    fs.rmSync(collisionPath);

    const replacementSet = createFilesystemBoundary(project).prepareIngestOutputSet();
    replacementSet.stage(INGEST_OUTPUT_IDENTITIES[0], () => {});
    const replacementPath = path.join(parent, "replacement-output");
    fs.writeFileSync(replacementPath, "replacement\n", "utf8");
    fs.renameSync(replacementPath, projectPath(project, INGEST_OUTPUT_IDENTITIES[1]));
    assert.throws(
      () => replacementSet.stage(INGEST_OUTPUT_IDENTITIES[1], () => {}),
      (error) => assertPolicy(error, {
        code: "CORTEX_FS_OUTPUT",
        phase: "output_commit",
        kind: "output_path",
        reason: "path_replaced"
      })
    );
    assert.deepEqual(temporaryOutputNames(project), []);

    const writeFailureSet = createFilesystemBoundary(project).prepareIngestOutputSet({
      testHooks: {
        beforeStageWrite(identity) {
          if (identity === INGEST_OUTPUT_IDENTITIES[1]) throw new Error("injected write failure");
        }
      }
    });
    writeFailureSet.stage(INGEST_OUTPUT_IDENTITIES[0], () => {});
    assert.throws(() => writeFailureSet.stage(INGEST_OUTPUT_IDENTITIES[1], () => {}));
    assert.deepEqual(temporaryOutputNames(project), []);
    assert.equal(fs.readFileSync(projectPath(project, INGEST_OUTPUT_IDENTITIES[0]), "utf8"), `old:${INGEST_OUTPUT_IDENTITIES[0]}\n`);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("pre-commit failure preserves the whole prior set while commit failure records an honest replaced prefix", () => {
  const { parent, project } = makeParent("output-commit-failures");
  try {
    writeControls(project);
    seedOutputSet(project);
    const preCommitSet = createFilesystemBoundary(project).prepareIngestOutputSet({
      testHooks: {
        beforePreCommit() {
          throw new Error("injected pre-commit failure");
        }
      }
    });
    stageCompleteOutputSet(preCommitSet, "precommit");
    assert.throws(
      () => preCommitSet.commit(),
      (error) => assertPolicy(error, {
        code: "CORTEX_FS_OUTPUT",
        phase: "output_commit",
        kind: "output_path",
        reason: "path_replaced"
      })
    );
    for (const identity of INGEST_OUTPUT_IDENTITIES) {
      assert.equal(fs.readFileSync(projectPath(project, identity), "utf8"), `old:${identity}\n`);
    }
    assert.deepEqual(temporaryOutputNames(project), []);

    const commitFailureSet = createFilesystemBoundary(project).prepareIngestOutputSet({
      testHooks: {
        beforeCommit(_identity, index) {
          if (index === 2) throw new Error("injected commit failure");
        }
      }
    });
    stageCompleteOutputSet(commitFailureSet, "commit");
    assert.throws(() => commitFailureSet.commit());
    assert.equal(fs.readFileSync(projectPath(project, INGEST_OUTPUT_IDENTITIES[0]), "utf8"), `commit:${INGEST_OUTPUT_IDENTITIES[0]}\n`);
    assert.equal(fs.readFileSync(projectPath(project, INGEST_OUTPUT_IDENTITIES[1]), "utf8"), `commit:${INGEST_OUTPUT_IDENTITIES[1]}\n`);
    assert.equal(fs.readFileSync(projectPath(project, INGEST_OUTPUT_IDENTITIES[2]), "utf8"), `old:${INGEST_OUTPUT_IDENTITIES[2]}\n`);
    assert.equal(fs.readFileSync(projectPath(project, INGEST_MANIFEST_OUTPUT_IDENTITY), "utf8"), `old:${INGEST_MANIFEST_OUTPUT_IDENTITY}\n`);
    assert.deepEqual(temporaryOutputNames(project), []);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("whole-set precommit rejects late final, manifest, parent, and stage replacement before the first rename", () => {
  const cases = [
    {
      label: "late-final",
      mutate(project) {
        const identity = INGEST_OUTPUT_IDENTITIES.at(-2);
        const replacement = `${projectPath(project, identity)}.replacement`;
        fs.writeFileSync(replacement, "late-final-replacement\n", "utf8");
        fs.renameSync(replacement, projectPath(project, identity));
      }
    },
    {
      label: "manifest",
      mutate(project) {
        const replacement = `${projectPath(project, INGEST_MANIFEST_OUTPUT_IDENTITY)}.replacement`;
        fs.writeFileSync(replacement, "manifest-replacement\n", "utf8");
        fs.renameSync(replacement, projectPath(project, INGEST_MANIFEST_OUTPUT_IDENTITY));
      }
    },
    {
      label: "parent",
      mutate(project) {
        const outputParent = path.join(project, ".context", "db", "import");
        fs.renameSync(outputParent, `${outputParent}-parked`);
        fs.mkdirSync(outputParent);
      }
    },
    {
      label: "stage",
      mutate(_project, stagePaths) {
        const stagePath = stagePaths.get(INGEST_MANIFEST_OUTPUT_IDENTITY);
        fs.rmSync(stagePath);
        fs.writeFileSync(stagePath, "unowned-stage-replacement\n", "utf8");
      },
      keepsUnownedStage: true
    }
  ];

  for (const fixture of cases) {
    const { parent, project } = makeParent(`whole-precommit-${fixture.label}`);
    try {
      writeControls(project);
      seedOutputSet(project);
      const stagePaths = new Map();
      const outputSet = createFilesystemBoundary(project).prepareIngestOutputSet({
        testHooks: {
          beforeStageCreate(identity, _attempt, stagePath) {
            stagePaths.set(identity, stagePath);
          },
          beforePreCommit() {
            fixture.mutate(project, stagePaths);
          }
        }
      });
      stageCompleteOutputSet(outputSet, fixture.label);

      assert.throws(
        () => outputSet.commit(),
        (error) => assertPolicy(error, {
          code: "CORTEX_FS_OUTPUT",
          phase: "output_commit",
          kind: "output_path",
          reason: "path_replaced"
        })
      );

      if (fixture.label === "parent") {
        const outputParent = path.join(project, ".context", "db", "import");
        fs.rmSync(outputParent, { recursive: true });
        fs.renameSync(`${outputParent}-parked`, outputParent);
      }

      for (const identity of INGEST_OUTPUT_IDENTITIES) {
        const content = fs.readFileSync(projectPath(project, identity), "utf8");
        if (fixture.label === "late-final" && identity === INGEST_OUTPUT_IDENTITIES.at(-2)) {
          assert.equal(content, "late-final-replacement\n");
        } else if (fixture.label === "manifest" && identity === INGEST_MANIFEST_OUTPUT_IDENTITY) {
          assert.equal(content, "manifest-replacement\n");
        } else {
          assert.equal(content, `old:${identity}\n`, `${fixture.label}: ${identity}`);
        }
      }

      const remainingStages = temporaryOutputPathsBelow(project);
      if (fixture.keepsUnownedStage) {
        assert.deepEqual(
          remainingStages.map((candidate) => fs.realpathSync.native(candidate)),
          [fs.realpathSync.native(stagePaths.get(INGEST_MANIFEST_OUTPUT_IDENTITY))]
        );
        assert.equal(fs.readFileSync(remainingStages[0], "utf8"), "unowned-stage-replacement\n");
      } else {
        assert.deepEqual(remainingStages, [], fixture.label);
      }
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  }
});

test("dashboard data matrix covers every leaf and ancestor as regular, missing, symlink, wrong type, and guarded special before reads", async () => {
  const directoryIdentities = new Set([
    ".context/cache",
    ".context/embeddings",
    ".context/cache/npm-cache"
  ]);
  for (const [identityIndex, identity] of DASHBOARD_DATA_IDENTITIES.entries()) {
    const expectsDirectory = directoryIdentities.has(identity);
    for (const safeKind of ["regular", "missing"]) {
      const { parent, project } = makeParent(`dashboard-data-${safeKind}`);
      try {
        writeControls(project);
        if (safeKind === "regular") {
          const target = projectPath(project, identity);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          if (expectsDirectory) fs.mkdirSync(target);
          else fs.writeFileSync(target, identity.endsWith(".jsonl") ? '{"from":"a","to":"b"}\n' : '{}\n', "utf8");
        }
        const dashboardData = createFilesystemBoundary(project).preflightDashboardData();
        if (expectsDirectory) {
          assert.equal(dashboardData.npmCachePath().endsWith("/.context/cache/npm-cache"), true);
        } else if (identity.endsWith(".jsonl")) {
          assert.deepEqual(dashboardData.readJsonl(identity), safeKind === "regular" ? [{ from: "a", to: "b" }] : []);
        } else {
          assert.deepEqual(dashboardData.readJson(identity), safeKind === "regular" ? {} : null);
        }
      } finally {
        fs.rmSync(parent, { recursive: true, force: true });
      }
    }

    const unsafeKinds = [
      "symlink",
      expectsDirectory ? "file" : "directory",
      ...(process.platform === "win32" ? [] : ["fifo"])
    ];
    for (const unsafeKind of unsafeKinds) {
      const { parent, project } = makeParent(`dashboard-data-${unsafeKind}`);
      let cleanup = async () => {};
      try {
        writeControls(project);
        cleanup = await createFilesystemKind(projectPath(project, identity), unsafeKind, parent);
        if (!cleanup) continue;
        let readCount = 0;
        const originalRead = fs.readFileSync;
        fs.readFileSync = (...args) => {
          readCount += 1;
          return originalRead(...args);
        };
        try {
          assert.throws(
            () => createFilesystemBoundary(project).preflightDashboardData(),
            (error) => {
              assert.equal(error.subject, identity);
              return assertPolicy(error, {
                code: "CORTEX_FS_DASHBOARD",
                phase: "dashboard_data",
                kind: "dashboard_path"
              });
            },
            `${identity}/${unsafeKind}`
          );
          assert.equal(readCount, 0, `${identity}/${unsafeKind}`);
        } finally {
          fs.readFileSync = originalRead;
        }
      } finally {
        await cleanup();
        fs.rmSync(parent, { recursive: true, force: true });
      }
    }
  }
});

test("dashboard data handle preserves safe missing fallbacks and revalidates the complete layout before each access", () => {
  const { parent, project } = makeParent("dashboard-data-snapshots");
  try {
    writeControls(project);
    const boundary = createFilesystemBoundary(project);
    const dashboardData = boundary.preflightDashboardData();
    assert.equal(dashboardData.readJson(".context/cache/manifest.json"), null);
    assert.deepEqual(dashboardData.readJsonl(".context/cache/relations.calls.jsonl"), []);
    assert.equal(dashboardData.npmCachePath(), path.join(boundary.root, ".context", "cache", "npm-cache"));
    assert.equal(fs.existsSync(path.join(project, ".context", "cache")), false);

    fs.mkdirSync(path.join(project, ".context", "embeddings"));
    assert.throws(
      () => dashboardData.readJson(".context/cache/manifest.json"),
      (error) => assertPolicy(error, {
        code: "CORTEX_FS_DASHBOARD",
        phase: "dashboard_data",
        kind: "dashboard_path",
        reason: "path_replaced"
      })
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("both dashboard gatherers rethrow npm-cache filesystem policy errors before ordinary version fallback", () => {
  const baseline = { files: 0, lines: 0, chars: 0, tokens: 0 };
  for (const gatherData of [rootGatherData, packagedGatherData]) {
    let npmCacheCalls = 0;
    const dashboardData = {
      readJson() { return null; },
      readJsonl() { return []; },
      npmCachePath() {
        npmCacheCalls += 1;
        throw new CortexFilesystemPolicyError({
          code: "CORTEX_FS_DASHBOARD",
          phase: "dashboard_data",
          subject_kind: "dashboard_path",
          subject: ".context/cache/npm-cache",
          reason: "path_replaced"
        });
      }
    };
    assert.throws(
      () => gatherData(baseline, dashboardData),
      (error) => assertPolicy(error, {
        code: "CORTEX_FS_DASHBOARD",
        phase: "dashboard_data",
        kind: "dashboard_path",
        reason: "path_replaced"
      })
    );
    assert.equal(npmCacheCalls, 1);
  }
});

test("root and packaged dashboards fail non-TTY and live npm-cache policy lifecycle before npm or a normal frame", { skip: process.platform === "win32" }, () => {
  for (const dashboardKind of ["root", "packaged"]) {
    for (const mode of ["non-tty", "live"]) {
      const { parent, project } = makeParent(`dashboard-npm-policy-${dashboardKind}-${mode}`);
      try {
        writeControls(project);
        fs.mkdirSync(path.join(project, "src"));
        fs.writeFileSync(path.join(project, "src", "app.js"), "export const value = true;\n", "utf8");
        const dashboardPath = dashboardKind === "root"
          ? installRootDashboard(project)
          : installPackagedDashboard(project);
        injectNpmCachePolicyFailure(project);
        const fakeNpm = installFakeNpm(parent);
        const result = mode === "non-tty"
          ? spawnSync(process.execPath, [dashboardPath], {
              cwd: project,
              encoding: "utf8",
              env: {
                ...process.env,
                CORTEX_PROJECT_ROOT: project,
                CORTEX_CLI_VERSION: "2.4.2",
                PATH: fakeNpm.path
              }
            })
          : runPseudoTtyDashboard({
              parent,
              project,
              dashboardPath,
              trigger: "data",
              cliVersion: "2.4.2",
              extraEnv: { PATH: fakeNpm.path }
            });

        assert.equal(result.status, 1, `${dashboardKind}/${mode}: ${result.stderr}`);
        const diagnostics = result.stderr.trim().split(/\r?\n/).filter(Boolean);
        assert.equal(diagnostics.length, 1, `${dashboardKind}/${mode}: ${result.stderr}`);
        assert.ok([...diagnostics[0]].length <= 256);
        assert.match(diagnostics[0], /CORTEX_FS_DASHBOARD.*dashboard_data.*npm-cache.*path_replaced/);
        assert.equal(fs.existsSync(fakeNpm.marker), false, `${dashboardKind}/${mode}`);
        if (mode === "non-tty") {
          assert.equal(result.stdout, "");
        } else {
          assert.match(result.stdout, /\x1b\[\?25l/);
          assert.match(result.stdout, /\x1b\[\?25h/);
          assert.doesNotMatch(result.stdout, /\x1b\[H/);
          assert.deepEqual(result.rawModes, ["true", "false"]);
        }
      } finally {
        fs.rmSync(parent, { recursive: true, force: true });
      }
    }
  }
});

test("cache, DB, and dashboard ancestors reject redirected or special layouts before mutation", { skip: process.platform === "win32" }, () => {
  const cases = [
    {
      label: "output-cache-link",
      setup(project, parent) {
        const outside = path.join(parent, "outside-cache");
        fs.mkdirSync(outside);
        fs.symlinkSync(outside, path.join(project, ".context", "cache"), "dir");
      },
      operation(boundary) {
        boundary.prepareIngestOutputSet();
      },
      code: "CORTEX_FS_OUTPUT"
    },
    {
      label: "output-db-file",
      setup(project) {
        fs.writeFileSync(path.join(project, ".context", "db"), "not a directory\n", "utf8");
      },
      operation(boundary) {
        boundary.prepareIngestOutputSet();
      },
      code: "CORTEX_FS_OUTPUT"
    },
    {
      label: "prior-cache-link",
      setup(project, parent) {
        const outside = path.join(parent, "outside-prior-cache");
        fs.mkdirSync(outside);
        fs.symlinkSync(outside, path.join(project, ".context", "cache"), "dir");
      },
      operation(boundary) {
        boundary.preflightPriorCache();
      },
      code: "CORTEX_FS_CACHE"
    },
    {
      label: "dashboard-embeddings-link",
      setup(project, parent) {
        const outside = path.join(parent, "outside-embeddings");
        fs.mkdirSync(outside);
        fs.symlinkSync(outside, path.join(project, ".context", "embeddings"), "dir");
      },
      operation(boundary) {
        boundary.preflightDashboardData();
      },
      code: "CORTEX_FS_DASHBOARD"
    }
  ];

  for (const fixture of cases) {
    const { parent, project } = makeParent(fixture.label);
    try {
      writeControls(project);
      fixture.setup(project, parent);
      const boundary = createFilesystemBoundary(project);
      assert.throws(
        () => fixture.operation(boundary),
        (error) => {
          assert.equal(error.code, fixture.code);
          assert.ok(["symlink_component", "not_directory"].includes(error.reason));
          return true;
        }
      );
      assert.equal(fs.existsSync(path.join(project, ".context", "db", "import")), false);
      assert.deepEqual(temporaryOutputNames(project), []);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  }

  const { parent, project } = makeParent("output-cache-fifo");
  try {
    writeControls(project);
    const fifo = path.join(project, ".context", "cache");
    const mkfifo = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
    if (mkfifo.status !== 0) return;
    assert.throws(
      () => createFilesystemBoundary(project).prepareIngestOutputSet(),
      (error) => assertPolicy(error, {
        code: "CORTEX_FS_OUTPUT",
        phase: "output_preflight",
        kind: "output_path",
        reason: "special_file"
      })
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("factorized cache, DB/import, and embeddings ancestors preserve missing behavior and deny links, files, and FIFOs before I/O", { skip: process.platform === "win32" }, async () => {
  const fixtures = [
    { label: "output-cache", identity: ".context/cache", area: "output" },
    { label: "output-db", identity: ".context/db", area: "output" },
    { label: "output-import", identity: ".context/db/import", area: "output" },
    { label: "prior-cache", identity: ".context/cache", area: "prior" },
    { label: "dashboard-cache", identity: ".context/cache", area: "dashboard" },
    { label: "dashboard-embeddings", identity: ".context/embeddings", area: "dashboard" }
  ];

  function invoke(boundary, area, counters) {
    if (area === "output") {
      const outputSet = boundary.prepareIngestOutputSet({
        testHooks: { beforeStageCreate() { counters.stage += 1; } }
      });
      outputSet.discard();
    } else if (area === "prior") {
      boundary.preflightPriorCache();
    } else {
      boundary.preflightDashboardData();
    }
  }

  for (const fixture of fixtures) {
    const missing = makeParent(`ancestor-${fixture.label}-missing`);
    try {
      writeControls(missing.project);
      const counters = { stage: 0 };
      invoke(createFilesystemBoundary(missing.project), fixture.area, counters);
      assert.equal(counters.stage, 0);
      if (fixture.area === "output") {
        assert.equal(fs.statSync(path.join(missing.project, ".context", "cache")).isDirectory(), true);
        assert.equal(fs.statSync(path.join(missing.project, ".context", "db", "import")).isDirectory(), true);
      } else {
        assert.equal(fs.existsSync(projectPath(missing.project, fixture.identity)), false);
      }
    } finally {
      fs.rmSync(missing.parent, { recursive: true, force: true });
    }

    for (const unsafeKind of ["symlink", "file", "fifo"]) {
      const { parent, project } = makeParent(`ancestor-${fixture.label}-${unsafeKind}`);
      let cleanup = async () => {};
      try {
        writeControls(project);
        cleanup = await createFilesystemKind(projectPath(project, fixture.identity), unsafeKind, parent);
        if (!cleanup) continue;
        const counters = { stage: 0, read: 0 };
        const originalRead = fs.readFileSync;
        fs.readFileSync = (...args) => {
          counters.read += 1;
          return originalRead(...args);
        };
        try {
          assert.throws(
            () => invoke(createFilesystemBoundary(project), fixture.area, counters),
            CortexFilesystemPolicyError,
            `${fixture.label}/${unsafeKind}`
          );
        } finally {
          fs.readFileSync = originalRead;
        }
        assert.deepEqual(counters, { stage: 0, read: 0 });
        assert.deepEqual(temporaryOutputNames(project), []);
      } finally {
        await cleanup();
        fs.rmSync(parent, { recursive: true, force: true });
      }
    }
  }
});

test("guarded Unix-socket ancestors deny output, prior-cache, and dashboard access before I/O", { skip: process.platform === "win32" }, async () => {
  const fixtures = [
    { identity: ".context/db", area: "output" },
    { identity: ".context/cache", area: "prior" },
    { identity: ".context/embeddings", area: "dashboard" }
  ];
  for (const fixture of fixtures) {
    const { parent, project } = makeShortParent();
    let cleanup = async () => {};
    try {
      writeControls(project);
      cleanup = await createFilesystemKind(projectPath(project, fixture.identity), "socket", parent);
      if (!cleanup) continue;
      let stageCount = 0;
      assert.throws(() => {
        const boundary = createFilesystemBoundary(project);
        if (fixture.area === "output") {
          boundary.prepareIngestOutputSet({
            testHooks: { beforeStageCreate() { stageCount += 1; } }
          });
        } else if (fixture.area === "prior") {
          boundary.preflightPriorCache();
        } else {
          boundary.preflightDashboardData();
        }
      }, CortexFilesystemPolicyError);
      assert.equal(stageCount, 0);
      assert.deepEqual(temporaryOutputNames(project), []);
    } finally {
      await cleanup();
      fs.rmSync(parent, { recursive: true, force: true });
    }
  }
});

test("both dashboard entrypoints deny every unsafe data identity before reads, npm, or normal output", { skip: process.platform === "win32" }, () => {
  const directoryIdentities = new Set([
    ".context/cache",
    ".context/embeddings",
    ".context/cache/npm-cache"
  ]);
  for (const dashboardKind of ["root", "packaged"]) {
    for (const unsafeIdentity of DASHBOARD_DATA_IDENTITIES) {
      const { parent, project } = makeParent(`dashboard-data-entry-${dashboardKind}`);
      try {
        writeControls(project);
        fs.mkdirSync(path.join(project, "src"));
        fs.writeFileSync(path.join(project, "src", "app.js"), "export const app = true;\n", "utf8");
        const target = projectPath(project, unsafeIdentity);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (directoryIdentities.has(unsafeIdentity)) fs.writeFileSync(target, "wrong type\n", "utf8");
        else fs.mkdirSync(target);

        const dashboardPath = dashboardKind === "root"
          ? installRootDashboard(project)
          : PACKAGED_DASHBOARD;
        const fakeNpm = installFakeNpm(parent);
        const result = spawnSync(process.execPath, [dashboardPath], {
          cwd: project,
          encoding: "utf8",
          env: {
            ...process.env,
            CORTEX_PROJECT_ROOT: project,
            CORTEX_CLI_VERSION: "2.4.2",
            PATH: fakeNpm.path
          }
        });
        assert.equal(result.status, 1, `${dashboardKind}/${unsafeIdentity}: ${result.stderr}`);
        assert.equal(fs.existsSync(fakeNpm.marker), false, `${dashboardKind}/${unsafeIdentity}`);
        const diagnostics = result.stderr.trim().split(/\r?\n/).filter(Boolean);
        assert.equal(diagnostics.length, 1, `${dashboardKind}/${unsafeIdentity}`);
        assert.ok([...diagnostics[0]].length <= 256);
        assert.match(diagnostics[0], /CORTEX_FS_DASHBOARD.*dashboard_data/);
        assert.match(diagnostics[0], new RegExp(unsafeIdentity.split("/").at(-1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.equal(result.stdout, "");
      } finally {
        fs.rmSync(parent, { recursive: true, force: true });
      }
    }
  }
});
