#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_PACKAGE = "@danielblomma/cortex-mcp";
const BUNDLE_PACKAGE = "@danielblomma/dsh-cortex";
const ROOT_LOCK_ENTRY = `node_modules/${ROOT_PACKAGE}`;
const BUNDLE_ROOT = path.join(REPO_ROOT, "plugins", "dsh-cortex");
const EXPECTED_BUNDLE_FILES = [
  "cordis.patch.yml",
  "package.json",
  "protocol.mjs",
  "provider.mjs",
  "skills-manifest.json",
  "skills.mjs",
  "skills/change-impact/SKILL.md",
  "skills/context-review/SKILL.md",
  "skills/pattern-review/SKILL.md",
  "skills/repo-research/SKILL.md",
  "skills/using-cortex/SKILL.md",
  "tools.mjs",
];

function fail(message) {
  throw new Error(`Release artifact validation failed: ${message}`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: "utf8",
    env: options.env ?? process.env,
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "no output").trim();
    fail(`${command} ${args.join(" ")} exited ${result.status}: ${detail}`);
  }
  return result.stdout;
}

export function npmIntegrityForFile(file) {
  return `sha512-${crypto.createHash("sha512").update(fs.readFileSync(file)).digest("base64")}`;
}

export function sha256ForFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function registryTarballUrl(packageName, version) {
  const leaf = packageName.slice(packageName.lastIndexOf("/") + 1);
  return `https://registry.npmjs.org/${packageName}/-/${leaf}-${version}.tgz`;
}

export function readPackedManifest(tarball) {
  const output = run("tar", ["-xOf", path.resolve(tarball), "package/package.json"]);
  try {
    return JSON.parse(output);
  } catch {
    fail(`packed package.json is not valid JSON: ${tarball}`);
  }
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const option = rest[index];
    if (!option.startsWith("--")) fail(`unknown argument ${option}`);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) fail(`${option} requires a value`);
    options[option.slice(2)] = value;
    index += 1;
  }
  return { command, options };
}

function required(options, name) {
  const value = options[name];
  if (!value) fail(`--${name} is required`);
  return value;
}

function requireSemver(version) {
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version)) {
    fail(`expected a stable X.Y.Z version, got ${version}`);
  }
}

function assertEmptyDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  if (fs.readdirSync(directory).length !== 0) {
    fail(`output directory must be empty: ${directory}`);
  }
}

function packOnce(cwd, destination) {
  fs.mkdirSync(destination, { recursive: true });
  const raw = run(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", destination],
    { cwd },
  );
  let result;
  try {
    [result] = JSON.parse(raw);
  } catch {
    fail(`npm pack did not return JSON in ${cwd}`);
  }
  if (!result?.filename || !Array.isArray(result.files)) {
    fail(`npm pack returned incomplete metadata in ${cwd}`);
  }
  const tarball = path.join(destination, result.filename);
  const integrity = npmIntegrityForFile(tarball);
  if (result.integrity !== integrity) {
    fail(`npm integrity disagrees with bytes for ${result.filename}`);
  }
  return {
    filename: result.filename,
    tarball,
    size: fs.statSync(tarball).size,
    sha256: sha256ForFile(tarball),
    integrity,
    files: result.files.map((entry) => entry.path).sort(),
  };
}

function assertTwins(label, first, second) {
  if (first.sha256 !== second.sha256 || first.integrity !== second.integrity) {
    fail(`${label} repeated packs are not byte-identical`);
  }
  if (JSON.stringify(first.files) !== JSON.stringify(second.files)) {
    fail(`${label} repeated pack inventories differ`);
  }
}

function assertPackedManifests(rootArtifact, bundleArtifact, version) {
  const root = readPackedManifest(rootArtifact.tarball);
  const bundle = readPackedManifest(bundleArtifact.tarball);
  if (root.name !== ROOT_PACKAGE || root.version !== version) {
    fail(`root manifest must be ${ROOT_PACKAGE}@${version}`);
  }
  if (root.engines?.node !== ">=20.9.0" || root.bin?.cortex !== "bin/cortex.mjs") {
    fail("root engine or executable contract drifted");
  }
  if (bundle.name !== BUNDLE_PACKAGE || bundle.version !== version) {
    fail(`bundle manifest must be ${BUNDLE_PACKAGE}@${version}`);
  }
  if (bundle.dependencies?.[ROOT_PACKAGE] !== version) {
    fail(`bundle must depend exactly on ${ROOT_PACKAGE}@${version}`);
  }
  if (bundle.engines?.node !== "^22.19.0 || >=24.0.0") {
    fail("bundle engine contract drifted");
  }
  if (bundle.dsh?.bundle?.patch !== "./cordis.patch.yml") {
    fail("bundle dsh.bundle.patch contract drifted");
  }
  const expectedExports = ["./package.json", "./protocol", "./provider", "./skills", "./tools"];
  const actualExports = Object.keys(bundle.exports ?? {}).sort();
  if (JSON.stringify(actualExports) !== JSON.stringify(expectedExports)) {
    fail(`bundle exports drifted: ${actualExports.join(", ")}`);
  }
}

function assertBundleInventory(artifact) {
  if (JSON.stringify(artifact.files) !== JSON.stringify(EXPECTED_BUNDLE_FILES)) {
    fail(`bundle inventory must contain exactly 12 runtime entries: ${artifact.files.join(", ")}`);
  }
  for (const file of artifact.files) {
    if (/(^|\/)(tests?|docs?|\.context|\.env|package-lock\.json)(\/|$)/i.test(file)) {
      fail(`bundle contains forbidden entry ${file}`);
    }
  }
}

function assertBundleLock(rootArtifact, version) {
  const lock = readJson(path.join(BUNDLE_ROOT, "package-lock.json"));
  const root = lock.packages?.[""];
  const installed = lock.packages?.[ROOT_LOCK_ENTRY];
  if (
    lock.name !== BUNDLE_PACKAGE ||
    lock.version !== version ||
    root?.name !== BUNDLE_PACKAGE ||
    root?.version !== version ||
    root?.dependencies?.[ROOT_PACKAGE] !== version
  ) {
    fail("bundle lock root identity/version/dependency drifted");
  }
  if (
    installed?.version !== version ||
    installed?.resolved !== registryTarballUrl(ROOT_PACKAGE, version) ||
    installed?.integrity !== rootArtifact.integrity
  ) {
    fail("bundle lock does not predict the exact reviewed root artifact");
  }
}

function packCommand(options) {
  const outputDirectory = path.resolve(required(options, "output-dir"));
  const version = required(options, "expected-version");
  requireSemver(version);
  assertEmptyDirectory(outputDirectory);

  const rootA = packOnce(REPO_ROOT, path.join(outputDirectory, "root-a"));
  const rootB = packOnce(REPO_ROOT, path.join(outputDirectory, "root-b"));
  const bundleA = packOnce(BUNDLE_ROOT, path.join(outputDirectory, "bundle-a"));
  const bundleB = packOnce(BUNDLE_ROOT, path.join(outputDirectory, "bundle-b"));
  assertTwins("root", rootA, rootB);
  assertTwins("bundle", bundleA, bundleB);
  assertBundleInventory(bundleA);
  assertPackedManifests(rootA, bundleA, version);
  assertBundleLock(rootA, version);

  const report = {
    version,
    packages: {
      root: { name: ROOT_PACKAGE, first: rootA, second: rootB },
      bundle: { name: BUNDLE_PACKAGE, first: bundleA, second: bundleB },
    },
  };
  const reportPath = options.report ? path.resolve(options.report) : path.join(outputDirectory, "report.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, report: reportPath, ...report }, null, 2)}\n`);
}

function verifyInstalledProject(project, version) {
  const installedRoot = readJson(path.join(project, "node_modules", ...ROOT_PACKAGE.split("/"), "package.json"));
  const installedBundle = readJson(path.join(project, "node_modules", ...BUNDLE_PACKAGE.split("/"), "package.json"));
  if (installedRoot.version !== version || installedBundle.version !== version) {
    fail("clean install package versions do not match the release version");
  }
  if (installedBundle.dependencies?.[ROOT_PACKAGE] !== version) {
    fail("clean install bundle dependency is not exact");
  }
  const cli = run(
    process.execPath,
    [path.join(project, "node_modules", ...ROOT_PACKAGE.split("/"), "bin", "cortex.mjs"), "--version"],
    { cwd: project },
  ).trim();
  if (!cli.includes(version)) fail(`installed cortex --version did not report ${version}: ${cli}`);
  run("npm", ["ls", "--all"], { cwd: project });
  return cli;
}

function installPackages(outputDirectory, version, specs) {
  assertEmptyDirectory(outputDirectory);
  const project = path.join(outputDirectory, "project");
  const cache = path.join(outputDirectory, "empty-npm-cache");
  fs.mkdirSync(project);
  fs.mkdirSync(cache);
  fs.writeFileSync(
    path.join(project, "package.json"),
    `${JSON.stringify({ name: "cortex-release-install-smoke", private: true }, null, 2)}\n`,
    "utf8",
  );
  run(
    "npm",
    ["install", "--no-audit", "--no-fund", "--ignore-scripts", "--cache", cache, ...specs],
    { cwd: project },
  );
  const cli = verifyInstalledProject(project, version);
  process.stdout.write(`${JSON.stringify({ ok: true, version, cli, project }, null, 2)}\n`);
}

function installCommand(options) {
  const rootTarball = path.resolve(required(options, "root-tarball"));
  const bundleTarball = path.resolve(required(options, "bundle-tarball"));
  const outputDirectory = path.resolve(required(options, "output-dir"));
  const version = required(options, "expected-version");
  requireSemver(version);
  installPackages(outputDirectory, version, [rootTarball, bundleTarball]);
}

function installRegistryCommand(options) {
  const outputDirectory = path.resolve(required(options, "output-dir"));
  const version = required(options, "expected-version");
  requireSemver(version);
  installPackages(outputDirectory, version, [
    `${ROOT_PACKAGE}@${version}`,
    `${BUNDLE_PACKAGE}@${version}`,
  ]);
}

function prepareTestContext(project, sourceRoot = path.join(REPO_ROOT, "scaffold")) {
  const context = path.join(project, ".context");
  const runtime = path.join(context, "mcp");
  const scripts = path.join(context, "scripts");
  fs.rmSync(runtime, { recursive: true, force: true });
  fs.rmSync(scripts, { recursive: true, force: true });
  fs.cpSync(path.join(sourceRoot, "mcp"), runtime, { recursive: true });
  fs.cpSync(path.join(sourceRoot, "scripts"), scripts, { recursive: true });
  run(path.join(scripts, "ingest.sh"), [], { cwd: project });
  run(path.join(scripts, "load-ryu.sh"), [], { cwd: project });
  process.stdout.write(`${JSON.stringify({ ok: true, project, context: "lexical+graph" })}\n`);
}

function prepareMcpTestContext() {
  prepareTestContext(path.join(REPO_ROOT, "scaffold"));
}

function prepareRootTestContext() {
  prepareTestContext(REPO_ROOT);
}

function harnessEnvironment(outputDirectory) {
  const runtime = path.join(outputDirectory, "runtime");
  return {
    ...process.env,
    HOME: path.join(outputDirectory, "home"),
    DSH_HOME: path.join(outputDirectory, "dsh-home"),
    COREPACK_HOME: path.join(outputDirectory, "corepack-home"),
    npm_config_cache: path.join(outputDirectory, "empty-npm-cache"),
    PATH: `${path.join(runtime, "corepack-shims")}${path.delimiter}${process.env.PATH ?? ""}`,
    DSH_TELEMETRY_DISABLED: "1",
  };
}

function assertCortexRows(config, expected) {
  const ids = [...config.matchAll(/^- id: (cortex-[a-z-]+)$/gm)].map((match) => match[1]);
  const names = [...config.matchAll(/^  name: '(@danielblomma\/dsh-cortex\/[a-z-]+)'$/gm)]
    .map((match) => match[1]);
  if (expected === 0) {
    if (ids.length !== 0 || names.length !== 0) fail("removed profile retained Cortex rows");
    return;
  }
  const expectedIds = ["cortex-context", "cortex-skills", "cortex-tools"];
  const expectedNames = [
    "@danielblomma/dsh-cortex/provider",
    "@danielblomma/dsh-cortex/skills",
    "@danielblomma/dsh-cortex/tools",
  ];
  if (
    JSON.stringify(ids.sort()) !== JSON.stringify(expectedIds) ||
    JSON.stringify(names.sort()) !== JSON.stringify(expectedNames)
  ) {
    fail(`profile Cortex rows drifted: ids=${ids.join(",")} names=${names.join(",")}`);
  }
}

function bindProfileToLocalRoot(outputDirectory, profileName, rootTarball) {
  const workspacePath = path.join(
    outputDirectory,
    "dsh-home",
    "profiles",
    profileName,
    "pnpm-workspace.yaml",
  );
  fs.appendFileSync(
    workspacePath,
    `\noverrides:\n  ${JSON.stringify(ROOT_PACKAGE)}: ${JSON.stringify(rootTarball)}\n`,
    "utf8",
  );
}

function prepareArtifactIndexedRoot(project, installedRoot, cache, token, filename) {
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  fs.mkdirSync(path.join(project, ".context"), { recursive: true });
  fs.writeFileSync(path.join(project, "README.md"), `# Release gate ${token}\n`, "utf8");
  fs.writeFileSync(
    path.join(project, "src", filename),
    `export const releaseGateToken = ${JSON.stringify(token)};\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(project, ".context", "config.yaml"),
    "repo_id: cortex-release-artifact-gate\nsource_paths:\n  - src\n  - README.md\nruntime:\n  top_k: 5\n",
    "utf8",
  );
  for (const name of ["ontology.cypher", "rules.yaml"]) {
    fs.copyFileSync(
      path.join(installedRoot, "scaffold", ".context", name),
      path.join(project, ".context", name),
    );
  }
  fs.cpSync(path.join(installedRoot, "scaffold", "mcp"), path.join(project, ".context", "mcp"), { recursive: true });
  fs.cpSync(path.join(installedRoot, "scaffold", "scripts"), path.join(project, ".context", "scripts"), { recursive: true });
  run("npm", ["ci", "--no-audit", "--no-fund", "--cache", cache], { cwd: path.join(project, ".context", "mcp") });
  run("npm", ["ci", "--no-audit", "--no-fund", "--cache", cache], { cwd: path.join(project, ".context", "scripts", "parsers") });
  run(path.join(project, ".context", "scripts", "ingest.sh"), [], { cwd: project });
  run(path.join(project, ".context", "scripts", "load-ryu.sh"), [], { cwd: project });
}

function runNetworkDenied(command, args, options) {
  const isolatedEnv = {
    ...options.env,
    PATH: "/nonexistent",
    CORTEX_RELEASE_NETWORK_DENIED: "1",
  };
  if (process.platform === "darwin") {
    return run(
      "/usr/bin/sandbox-exec",
      ["-p", "(version 1)(allow default)(deny network*)", command, ...args],
      { ...options, env: isolatedEnv },
    );
  }
  if (process.platform === "linux"
    && fs.existsSync("/usr/bin/sudo")
    && fs.existsSync("/usr/bin/unshare")
    && fs.existsSync("/usr/bin/env")) {
    const explicitEnvironment = [
      `HOME=${isolatedEnv.HOME}`,
      `DSH_HOME=${isolatedEnv.DSH_HOME}`,
      `DSH_TELEMETRY_DISABLED=${isolatedEnv.DSH_TELEMETRY_DISABLED}`,
      "CORTEX_RELEASE_NETWORK_DENIED=1",
      "PATH=/nonexistent",
    ];
    return run(
      "/usr/bin/sudo",
      ["-n", "/usr/bin/unshare", "--net", "--", "/usr/bin/env", ...explicitEnvironment, command, ...args],
      options,
    );
  }
  fail(`no fail-closed outbound-network isolation is implemented for ${process.platform}`);
}

export function assertFinalHarnessEvidence(evidence) {
  for (const [label, value] of [
    ["installed profile boot", evidence.profileBooted],
    ["PATH isolation", evidence.pathUnableToSupplyCortex],
    ["outbound network denial", evidence.outboundNetworkDenied],
    ["two indexed roots", evidence.indexedRoots?.count === 2],
    ["root isolation", evidence.indexedRoots?.isolated],
    ["real search", evidence.commands?.search],
    ["real rules", evidence.commands?.rules],
    ["real related", evidence.commands?.related],
    ["real impact", evidence.commands?.impact],
    ["timeout", evidence.negative?.timeout],
    ["cancellation", evidence.negative?.cancellation],
    ["malformed output", evidence.negative?.malformed],
    ["oversized output", evidence.negative?.oversized],
    ["first agent disposal", evidence.disposal?.firstAgent],
    ["second agent disposal", evidence.disposal?.secondAgent],
    ["bundle disposal", evidence.disposal?.bundle],
    ["Web shutdown", evidence.webShutdown],
    ["profile removal", evidence.profileRemoval],
  ]) {
    if (value !== true) fail(`final Harness evidence omits ${label}`);
  }
  if (evidence.discovery?.tools?.length !== 4 || evidence.discovery?.skills?.length !== 5) {
    fail("final Harness evidence omits exact installed discovery");
  }
  if (!path.isAbsolute(evidence.packageOwnedCli ?? "")) fail("final Harness evidence omits package-owned CLI");
}

function installedProfileRoot(outputDirectory, profileName) {
  return fs.realpathSync(path.join(
    outputDirectory,
    "dsh-home",
    "profiles",
    profileName,
    "node_modules",
    ...ROOT_PACKAGE.split("/"),
  ));
}

function runInstalledProfileGate(outputDirectory, harnessCheckout, env, cache) {
  const profileDir = path.join(outputDirectory, "dsh-home", "profiles", "headless");
  const installedRoot = installedProfileRoot(outputDirectory, "headless");
  const firstRoot = path.join(outputDirectory, "indexed-root-first");
  const secondRoot = path.join(outputDirectory, "indexed-root-second");
  prepareArtifactIndexedRoot(firstRoot, installedRoot, cache, "FIRST_ROOT_RELEASE_TOKEN", "first-root.mjs");
  prepareArtifactIndexedRoot(secondRoot, installedRoot, cache, "SECOND_ROOT_RELEASE_TOKEN", "second-root.mjs");
  const overlay = path.join(outputDirectory, "profile-gate.patch.yml");
  const report = path.join(outputDirectory, "profile-gate-report.json");
  fs.writeFileSync(
    overlay,
    "- id: headless-runner\n  disabled: true\n- id: cortex-context\n  config:\n    timeoutMs: 5000\n",
    "utf8",
  );
  runNetworkDenied(
    process.execPath,
    [
      path.join(REPO_ROOT, "scripts", "release-harness-profile-gate.mjs"),
      "--harness-checkout", harnessCheckout,
      "--profile-dir", profileDir,
      "--first-root", firstRoot,
      "--second-root", secondRoot,
      "--overlay", overlay,
      "--report", report,
    ],
    { cwd: harnessCheckout, env, timeout: 120_000 },
  );
  return readJson(report);
}

async function inspectPackedBundle(outputDirectory, profileName) {
  const bundle = path.join(
    outputDirectory,
    "dsh-home",
    "profiles",
    profileName,
    "node_modules",
    ...BUNDLE_PACKAGE.split("/"),
  );
  const toolsModule = await import(`${pathToFileURL(path.join(bundle, "tools.mjs")).href}?profile=${profileName}`);
  const skillsModule = await import(`${pathToFileURL(path.join(bundle, "skills.mjs")).href}?profile=${profileName}`);
  const operation = async () => ({ ok: true });
  const service = { search: operation, related: operation, impact: operation, rules: operation };
  const tools = toolsModule.createCortexTools({ id: profileName }, service)
    .map((tool) => tool.name)
    .sort();
  const expectedTools = ["cortex_impact", "cortex_related", "cortex_rules", "cortex_search"];
  if (JSON.stringify(tools) !== JSON.stringify(expectedTools)) {
    fail(`packed ${profileName} tools drifted: ${tools.join(", ")}`);
  }
  const skills = skillsModule.loadPackagedSkills().map((skill) => skill.name).sort();
  const manifest = readJson(path.join(bundle, "skills-manifest.json"));
  const expectedSkills = manifest.skills.map((skill) => skill.name).sort();
  if (skills.length !== 5 || JSON.stringify(skills) !== JSON.stringify(expectedSkills)) {
    fail(`packed ${profileName} skills drifted: ${skills.join(", ")}`);
  }
  for (const entry of manifest.skills) {
    const packed = fs.readFileSync(path.join(bundle, "skills", entry.name, "SKILL.md"));
    const canonical = fs.readFileSync(path.join(REPO_ROOT, "plugins", "cortex", "skills", entry.name, "SKILL.md"));
    if (!packed.equals(canonical)) fail(`packed ${entry.name} skill differs from its canonical source`);
    const digest = crypto.createHash("sha256").update(packed).digest("hex");
    if (digest !== entry.sha256) fail(`packed ${entry.name} skill hash differs from its manifest`);
  }
  return { tools, skills, byteIdenticalSkills: manifest.skills.length };
}

async function webSmoke(command, baseArgs, env, cwd) {
  const child = spawn(command, [...baseArgs, "--profile", "web", "--no-open", "--host", "127.0.0.1", "--port", "0"], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  let output = "";
  let settled = false;
  let timeout;
  const closed = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  const url = await new Promise((resolve, reject) => {
    const inspect = (chunk) => {
      output += chunk.toString("utf8");
      const match = output.match(/https?:\/\/127\.0\.0\.1:[0-9]+/);
      if (match && !settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(match[0]);
      }
    };
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (!settled) reject(new Error(`Web profile exited before binding (${code}/${signal}): ${output}`));
    });
    timeout = setTimeout(() => {
      if (!settled) reject(new Error(`Web profile did not bind within 30 seconds: ${output}`));
    }, 30_000);
  });
  const response = await fetch(url);
  const body = await response.text();
  if (response.status !== 200 || body.length === 0) {
    child.kill("SIGKILL");
    fail(`Web profile returned HTTP ${response.status} with ${body.length} bytes`);
  }
  child.kill("SIGINT");
  const outcome = await Promise.race([
    closed,
    new Promise((resolve) => setTimeout(() => resolve(null), 10_000)),
  ]);
  if (outcome === null) {
    child.kill("SIGKILL");
    fail("Web profile did not stop within 10 seconds after SIGINT");
  }
  try {
    await fetch(url, { signal: AbortSignal.timeout(1_000) });
    fail("Web profile port remained open after controlled shutdown");
  } catch (error) {
    if (String(error?.message ?? error).includes("port remained open")) throw error;
  }
  return { url, status: response.status, bytes: Buffer.byteLength(body), outcome };
}

async function harnessCommand(options, registryOnly = false) {
  const harnessCheckout = fs.realpathSync(required(options, "harness-checkout"));
  const outputDirectory = path.resolve(required(options, "output-dir"));
  const version = required(options, "expected-version");
  requireSemver(version);
  const packageSpecs = registryOnly
    ? [`${ROOT_PACKAGE}@${version}`, `${BUNDLE_PACKAGE}@${version}`]
    : [
        path.resolve(required(options, "root-tarball")),
        path.resolve(required(options, "bundle-tarball")),
      ];
  assertEmptyDirectory(outputDirectory);
  const runtime = path.join(outputDirectory, "runtime");
  const cache = path.join(outputDirectory, "empty-npm-cache");
  fs.mkdirSync(runtime);
  fs.mkdirSync(cache);
  fs.mkdirSync(path.join(outputDirectory, "home"));
  fs.mkdirSync(path.join(outputDirectory, "dsh-home"));
  fs.writeFileSync(
    path.join(runtime, "package.json"),
    `${JSON.stringify({ name: "cortex-harness-release-smoke", private: true }, null, 2)}\n`,
    "utf8",
  );
  run(
    "npm",
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--cache",
      cache,
      "corepack@0.34.0",
    ],
    { cwd: runtime },
  );
  const pinnedCommit = run("git", ["rev-parse", "HEAD"], { cwd: harnessCheckout }).trim();
  if (pinnedCommit !== "b150a551b8d465e31e418e1b2eaf5e79bbb7d28e") {
    fail(`Harness checkout is ${pinnedCommit}, expected the reviewed commit`);
  }
  const env = harnessEnvironment(outputDirectory);
  const corepack = path.join(runtime, "node_modules", ".bin", "corepack");
  const corepackShims = path.join(runtime, "corepack-shims");
  fs.mkdirSync(corepackShims);
  fs.mkdirSync(env.COREPACK_HOME);
  run(corepack, ["enable", "--install-directory", corepackShims], { cwd: runtime, env });
  run(corepack, ["prepare", "pnpm@11.7.0", "--activate"], { cwd: runtime, env });
  const pnpm = path.join(corepackShims, "pnpm");
  run(pnpm, ["install", "--frozen-lockfile"], { cwd: harnessCheckout, env });
  run(pnpm, ["run", "build"], { cwd: harnessCheckout, env });
  const profile = (...args) => run(pnpm, ["dsh", ...args], { cwd: harnessCheckout, env });
  let discovery;
  for (const name of ["headless", "web"]) {
    profile("plugin", "--profile", name, "add", packageSpecs[0]);
    if (!registryOnly) bindProfileToLocalRoot(outputDirectory, name, packageSpecs[0]);
    profile("plugin", "--profile", name, "add", packageSpecs[1]);
    const config = profile("--profile", name, "--dump-config");
    assertCortexRows(config, 3);
    discovery = discovery ?? await inspectPackedBundle(outputDirectory, name);
  }
  const profileGate = runInstalledProfileGate(outputDirectory, harnessCheckout, env, cache);
  profile("--profile", "headless", "--help");
  profile("--profile", "web", "--help");
  const web = await webSmoke(pnpm, ["dsh"], env, harnessCheckout);
  for (const name of ["headless", "web"]) {
    profile("plugin", "--profile", name, "remove", BUNDLE_PACKAGE, ROOT_PACKAGE);
    assertCortexRows(profile("--profile", name, "--dump-config"), 0);
  }
  const finalEvidence = { ...profileGate, webShutdown: true, profileRemoval: true };
  assertFinalHarnessEvidence(finalEvidence);
  process.stdout.write(`${JSON.stringify({ ok: true, version, profiles: 2, rowsPerProfile: 3, discovery, profileGate: finalEvidence, web }, null, 2)}\n`);
}

function npmView(spec, field) {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-release-registry-"));
  try {
    const args = ["view", spec];
    if (field) args.push(field);
    args.push("--json", "--cache", cache);
    const result = spawnSync("npm", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      shell: false,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status !== 0) {
      if (/E404|404 Not Found/i.test(`${result.stdout}\n${result.stderr}`)) return null;
      fail(`npm view ${spec} failed: ${(result.stderr || result.stdout).trim()}`);
    }
    return JSON.parse(result.stdout);
  } finally {
    fs.rmSync(cache, { recursive: true, force: true });
  }
}

function registryStateCommand(options) {
  const packageName = required(options, "package-name");
  const version = required(options, "version");
  const integrity = required(options, "integrity");
  requireSemver(version);
  const manifest = npmView(`${packageName}@${version}`);
  if (manifest === null) {
    process.stdout.write(`${JSON.stringify({ state: "missing", package: packageName, version })}\n`);
    return;
  }
  if (manifest.name !== packageName || manifest.version !== version || manifest.dist?.integrity !== integrity) {
    fail(`registry artifact differs for ${packageName}@${version}`);
  }
  if (options["root-dependency"] && manifest.dependencies?.[ROOT_PACKAGE] !== options["root-dependency"]) {
    fail(`registry bundle dependency differs for ${packageName}@${version}`);
  }
  const latest = npmView(packageName, "dist-tags.latest");
  if (latest !== version) fail(`${packageName} latest dist-tag is ${String(latest)}, expected ${version}`);
  process.stdout.write(`${JSON.stringify({ state: "exact", package: packageName, version, integrity })}\n`);
}

export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv);
  if (command === "pack") return packCommand(options);
  if (command === "install") return installCommand(options);
  if (command === "install-registry") return installRegistryCommand(options);
  if (command === "root-context") return prepareRootTestContext();
  if (command === "mcp-context") return prepareMcpTestContext();
  if (command === "harness") return harnessCommand(options);
  if (command === "harness-registry") return harnessCommand(options, true);
  if (command === "registry-state") return registryStateCommand(options);
  fail(`expected command pack, install, install-registry, root-context, mcp-context, harness, harness-registry, or registry-state; got ${String(command)}`);
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) await main();
