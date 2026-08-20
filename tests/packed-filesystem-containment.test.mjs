import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_NAME = "@danielblomma/cortex-mcp";
const PREVIOUS_RELEASE_TAG = "v2.4.2";
const PREVIOUS_RELEASE_COMMIT = "736becf34d929ea0bef88adbe476a584a1f081e9";
const EXPECTED_ENTRY_COUNT = 416;
const EXPECTED_MODE_COUNTS = new Map([[0o644, 395], [0o755, 21]]);
const EXPECTED_INVENTORY_SHA256 = "c278da28d82a55abb60706b8fb2ad2bf0f77dc35709f4c9fa94056a4226ed5d2";
const EXPECTED_RUNTIME_OWNERSHIP_COUNT = 93;
const EXPECTED_MANAGED_OWNERSHIP_COUNT = 381;
const BUILD_MARKER = path.join(REPO_ROOT, "scaffold", "mcp", "dist", ".cortex-build-hash");
const REQUIRED_CONTAINMENT_UPGRADE_PATHS = [
  "scaffold/scripts/dashboard.mjs",
  "scaffold/scripts/ingest-worker.mjs",
  "scaffold/scripts/ingest.mjs",
  "scaffold/scripts/lib/ingest/chunks.mjs",
  "scaffold/scripts/lib/ingest/config.mjs",
  "scaffold/scripts/lib/ingest/files.mjs",
  "scaffold/scripts/lib/ingest/filesystem-boundary.mjs",
  "scaffold/scripts/lib/ingest/incremental-state.mjs",
  "scaffold/scripts/lib/ingest/io.mjs",
  "scaffold/scripts/lib/ingest/main.mjs",
  "scaffold/scripts/lib/ingest/parser-composition.mjs",
  "scaffold/scripts/lib/ingest/pipeline-stages.mjs",
  "scaffold/scripts/lib/ingest/runtime-paths.mjs",
  "scaffold/scripts/lib/ingest/workers.mjs",
];

const candidateMetadata = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
);

function run(command, args, { cwd = REPO_ROOT, env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function copyTest(packageRoot, name) {
  const destination = path.join(packageRoot, "tests", name);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, "tests", name), destination);
}

function installedOwnership(packageRoot) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(packageRoot, "scaffold", "ownership", "v1.json"), "utf8"),
  );
  const paths = manifest.managedRoots.flatMap((root) =>
    root.files.map((file) => path.posix.join(
      root.target,
      typeof file === "string" ? file : file.target,
    ))
  ).sort();
  return { manifest, paths };
}

function verifyPackedRuntimeOwnership(pack, packageRoot) {
  const { paths } = installedOwnership(packageRoot);
  assert.equal(paths.length, EXPECTED_MANAGED_OWNERSHIP_COUNT);
  assert.equal(new Set(paths).size, EXPECTED_MANAGED_OWNERSHIP_COUNT);
  const ownedRuntimeEntries = paths.filter((entry) => entry.startsWith(".context/scripts/"));
  const packedRuntimeEntries = pack.files
    .map((entry) => entry.path)
    .filter((entry) => entry.startsWith("scaffold/scripts/"))
    .map((entry) => `.context/${entry.slice("scaffold/".length)}`)
    .sort();
  assert.equal(ownedRuntimeEntries.length, EXPECTED_RUNTIME_OWNERSHIP_COUNT);
  assert.deepEqual(packedRuntimeEntries, ownedRuntimeEntries);
  return {
    managed: paths.length,
    runtime: ownedRuntimeEntries.length,
  };
}

function installPackedTestSurface(packageRoot) {
  const scripts = path.join(packageRoot, "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  // The development wrappers are not package entries. Copy only these test
  // adapters; every canonical module and the packaged dashboard remain the
  // files installed from the candidate tarball.
  fs.copyFileSync(path.join(REPO_ROOT, "scripts", "ingest.mjs"), path.join(scripts, "ingest.mjs"));
  fs.copyFileSync(path.join(REPO_ROOT, "scripts", "dashboard.mjs"), path.join(scripts, "dashboard.mjs"));
  for (const name of [
    "ingest-filesystem-boundary.test.mjs",
    "ingest-characterization.test.mjs",
    "dashboard.test.mjs",
  ]) {
    copyTest(packageRoot, name);
  }
  const fixtureSource = path.join(REPO_ROOT, "tests", "fixtures", "ingest-characterization");
  const fixtureTarget = path.join(packageRoot, "tests", "fixtures", "ingest-characterization");
  fs.mkdirSync(path.dirname(fixtureTarget), { recursive: true });
  fs.cpSync(fixtureSource, fixtureTarget, { recursive: true });
}

function inventoryRows(pack) {
  return pack.files
    .map((entry) => `${entry.path}\t${Number(entry.mode).toString(8).padStart(4, "0")}`)
    .sort();
}

function verifyPackInventory(pack) {
  assert.equal(pack.name, PACKAGE_NAME);
  assert.equal(pack.version, candidateMetadata.version);
  assert.equal(pack.files.length, EXPECTED_ENTRY_COUNT);
  assert.equal(
    pack.files.some((entry) => entry.path === "scaffold/mcp/dist/.cortex-build-hash"),
    false,
  );
  const modeCounts = new Map();
  for (const entry of pack.files) {
    modeCounts.set(entry.mode, (modeCounts.get(entry.mode) ?? 0) + 1);
  }
  assert.deepEqual(modeCounts, EXPECTED_MODE_COUNTS);
  const inventory = `${inventoryRows(pack).join("\n")}\n`;
  assert.equal(sha256Buffer(inventory), EXPECTED_INVENTORY_SHA256);
  return inventory;
}

function packCandidate(destination, npmCache) {
  fs.mkdirSync(destination);
  const packed = run("npm", [
    "pack",
    "--json",
    "--pack-destination",
    destination,
    "--cache",
    npmCache,
  ]);
  const parsed = JSON.parse(packed.stdout);
  assert.equal(parsed.length, 1);
  return parsed[0];
}

function changedManagedScripts() {
  const result = run("git", [
    "diff",
    "--name-status",
    "--find-renames",
    `${PREVIOUS_RELEASE_TAG}..HEAD`,
    "--",
    "scaffold/scripts",
  ]);
  return result.stdout.trim().split("\n").filter(Boolean).map((line) => {
    const fields = line.split("\t");
    const status = fields[0];
    assert.match(status, /^[AM]$/, `unsupported managed upgrade status: ${line}`);
    return { status, path: fields[1] };
  });
}

function verifyForcedUpgrade(packageRoot, sandbox) {
  const resolvedPreviousCommit = run(
    "git",
    ["rev-parse", `${PREVIOUS_RELEASE_TAG}^{commit}`],
  ).stdout.trim();
  assert.equal(resolvedPreviousCommit, PREVIOUS_RELEASE_COMMIT);

  const previousSource = path.join(sandbox, "previous-release-source");
  const previousArchive = path.join(sandbox, "previous-release.tar");
  fs.mkdirSync(previousSource);
  run("git", [
    "archive",
    "--format=tar",
    `--output=${previousArchive}`,
    PREVIOUS_RELEASE_TAG,
  ]);
  run("tar", ["-xf", previousArchive, "-C", previousSource]);

  const project = path.join(sandbox, "force-project");
  const home = path.join(sandbox, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    CORTEX_DISABLE_UPDATE_CHECK: "1",
  };
  run(process.execPath, [path.join(previousSource, "bin", "cortex.mjs"), "init"], {
    cwd: project,
    env,
  });

  const changedScripts = changedManagedScripts();
  const changedPaths = new Set(changedScripts.map((entry) => entry.path));
  assert.equal(changedScripts.length >= REQUIRED_CONTAINMENT_UPGRADE_PATHS.length, true);
  for (const requiredPath of REQUIRED_CONTAINMENT_UPGRADE_PATHS) {
    assert.equal(changedPaths.has(requiredPath), true, `missing containment upgrade path: ${requiredPath}`);
  }

  const { paths: ownedPaths } = installedOwnership(packageRoot);
  const owned = new Set(ownedPaths);
  for (const entry of changedScripts) {
    const targetIdentity = `.context/${entry.path.slice("scaffold/".length)}`;
    const targetPath = path.join(project, ...targetIdentity.split("/"));
    const candidatePath = path.join(packageRoot, ...entry.path.split("/"));
    assert.equal(owned.has(targetIdentity), true, `changed script is not owned: ${targetIdentity}`);
    assert.equal(fs.existsSync(candidatePath), true, `candidate script is missing: ${entry.path}`);
    if (entry.status === "A") {
      assert.equal(fs.existsSync(targetPath), false, `new script already existed in ${PREVIOUS_RELEASE_TAG}`);
    } else {
      assert.equal(fs.existsSync(targetPath), true, `released script is missing: ${entry.path}`);
      assert.notEqual(sha256File(targetPath), sha256File(candidatePath), `changed script bytes did not change: ${entry.path}`);
    }
  }

  const protectedOntology = path.join(project, ".context", "ontology.cypher");
  const protectedConfig = path.join(project, ".context", "config.yaml");
  const unknown = path.join(project, ".context", "scripts", "user-owned.mjs");
  fs.writeFileSync(protectedOntology, "CREATE (:UserOwned);\n", "utf8");
  fs.writeFileSync(protectedConfig, "repo_id: user-owned\nsource_paths:\n  - src\n", "utf8");
  fs.writeFileSync(unknown, "export const userOwned = true;\n", "utf8");

  run(process.execPath, [path.join(packageRoot, "bin", "cortex.mjs"), "init", "--force"], {
    cwd: project,
    env,
  });
  assert.equal(fs.readFileSync(protectedOntology, "utf8"), "CREATE (:UserOwned);\n");
  assert.equal(
    fs.readFileSync(protectedConfig, "utf8"),
    "repo_id: user-owned\nsource_paths:\n  - src\n",
  );
  assert.equal(fs.readFileSync(unknown, "utf8"), "export const userOwned = true;\n");

  const state = JSON.parse(
    fs.readFileSync(path.join(project, ".context", "scaffold-state.json"), "utf8"),
  );
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.manifestVersion, 1);
  for (const entry of changedScripts) {
    const targetIdentity = `.context/${entry.path.slice("scaffold/".length)}`;
    const targetPath = path.join(project, ...targetIdentity.split("/"));
    const candidatePath = path.join(packageRoot, ...entry.path.split("/"));
    assert.deepEqual(fs.readFileSync(targetPath), fs.readFileSync(candidatePath));
    assert.equal(state.fileHashes[targetIdentity], sha256File(candidatePath));
  }
  return {
    previous_tag: PREVIOUS_RELEASE_TAG,
    previous_commit: resolvedPreviousCommit,
    changed_managed_scripts: changedScripts.length,
    new_managed_scripts: changedScripts.filter((entry) => entry.status === "A").length,
    state_hashes_verified: changedScripts.length,
    preserved: ["config", "ontology", "unknown"],
  };
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-packed-containment-"));
const markerBackup = path.join(sandbox, "original-cortex-build-hash");
let hadBuildMarker = false;
try {
  const npmCache = path.join(sandbox, "npm-cache");
  if (fs.existsSync(BUILD_MARKER)) {
    const markerStat = fs.lstatSync(BUILD_MARKER);
    assert.equal(markerStat.isFile() && !markerStat.isSymbolicLink(), true);
    fs.renameSync(BUILD_MARKER, markerBackup);
    hadBuildMarker = true;
  }

  const cleanPack = packCandidate(path.join(sandbox, "pack-clean"), npmCache);
  const cleanInventory = verifyPackInventory(cleanPack);
  // A future prepack implementation may legitimately create this local
  // incremental-build marker. Inventory exclusion, not post-build absence,
  // is the package contract.
  if (fs.existsSync(BUILD_MARKER)) {
    fs.unlinkSync(BUILD_MARKER);
  }

  fs.writeFileSync(BUILD_MARKER, "local build marker must never affect npm inventory\n", "utf8");
  const markedPack = packCandidate(path.join(sandbox, "pack-with-marker"), npmCache);
  const markedInventory = verifyPackInventory(markedPack);
  assert.equal(markedInventory, cleanInventory);
  fs.unlinkSync(BUILD_MARKER);

  const tarball = path.join(sandbox, "pack-clean", cleanPack.filename);
  const extracted = path.join(sandbox, "extracted");
  fs.mkdirSync(extracted);
  run("tar", ["-xzf", tarball, "-C", extracted]);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(extracted, "package", "package.json"), "utf8")).version,
    candidateMetadata.version,
  );

  const prefix = path.join(sandbox, "prefix");
  fs.mkdirSync(prefix);
  run("npm", [
    "install",
    "--prefix",
    prefix,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--cache",
    npmCache,
    tarball,
  ]);
  const packageRoot = path.join(prefix, "node_modules", ...PACKAGE_NAME.split("/"));
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")).version,
    candidateMetadata.version,
  );
  const ownership = verifyPackedRuntimeOwnership(cleanPack, packageRoot);

  run("npm", [
    "ci",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--cache",
    npmCache,
  ], { cwd: path.join(packageRoot, "scaffold", "scripts", "parsers") });
  installPackedTestSurface(packageRoot);

  const boundary = run(process.execPath, [
    "--test",
    path.join(packageRoot, "tests", "ingest-filesystem-boundary.test.mjs"),
  ]);
  assert.match(boundary.stdout, /# pass 41\b/);
  assert.match(boundary.stdout, /# fail 0\b/);

  const characterization = run(process.execPath, [
    "--test",
    path.join(packageRoot, "tests", "ingest-characterization.test.mjs"),
  ]);
  assert.match(characterization.stdout, /# pass 3\b/);
  assert.match(characterization.stdout, /# fail 0\b/);

  const developmentDashboard = run(process.execPath, [
    "--test",
    path.join(packageRoot, "tests", "dashboard.test.mjs"),
  ]);
  assert.match(developmentDashboard.stdout, /# pass 4\b/);
  assert.match(developmentDashboard.stdout, /# fail 0\b/);

  const packagedDashboard = run(process.execPath, [
    "--test",
    path.join(packageRoot, "tests", "dashboard.test.mjs"),
  ], {
    env: { ...process.env, CORTEX_DASHBOARD_ENTRY: "packaged" },
  });
  assert.match(packagedDashboard.stdout, /# pass 4\b/);
  assert.match(packagedDashboard.stdout, /# fail 0\b/);

  const upgrade = verifyForcedUpgrade(packageRoot, sandbox);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    package: PACKAGE_NAME,
    version: cleanPack.version,
    entries: cleanPack.files.length,
    mode_counts: { "0644": 395, "0755": 21 },
    inventory_sha256: EXPECTED_INVENTORY_SHA256,
    tarball_sha1: cleanPack.shasum,
    tarball_sha256: sha256File(tarball),
    clean_and_prebuilt_inventory_equal: true,
    installed_prefix: true,
    packed_boundary_cases: 41,
    packed_characterization_cases: 3,
    development_dashboard_cases: 4,
    packed_dashboard_cases: 4,
    ownership,
    force_upgrade: upgrade,
  }, null, 2)}\n`);
} finally {
  if (fs.existsSync(BUILD_MARKER)) {
    fs.unlinkSync(BUILD_MARKER);
  }
  if (hadBuildMarker && fs.existsSync(markerBackup)) {
    fs.renameSync(markerBackup, BUILD_MARKER);
  }
  fs.rmSync(sandbox, { recursive: true, force: true });
}
