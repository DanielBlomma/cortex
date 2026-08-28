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
const PREVIOUS_RELEASE_VERSION = "2.4.2";
const PREVIOUS_RELEASE_COMMIT = "736becf34d929ea0bef88adbe476a584a1f081e9";
const PREVIOUS_RELEASE_SHA1 = "995ddb990eedf26f833be5f511a2cf45b9671d6a";
const PREVIOUS_RELEASE_INTEGRITY =
  "sha512-lRt7yCLMp+yGNOnya60rlZog6qEDjScbz6TTk4k6l6JoWQzm+gV6umTfHaYs5SjoBqYia9EERHcxVLUeYANdlQ==";
const EXPECTED_ENTRY_COUNT = 432;
const EXPECTED_MODE_COUNTS = new Map([[0o644, 411], [0o755, 21]]);
const EXPECTED_INVENTORY_SHA256 = "f7647e513e6ab40e6327e6bd14aa4db26fc248930780a3967de56ddf423ff661";
const EXPECTED_RUNTIME_OWNERSHIP_COUNT = 96;
const EXPECTED_MANAGED_OWNERSHIP_COUNT = 396;
const EXPECTED_CHANGED_MANAGED_COUNT = 79;
const EXPECTED_NEW_MANAGED_COUNT = 16;
const OWNERSHIP_V1_SHA256 = "b3b97387f541e718ac3b27f677e00cf815cb9bd600b1305391891685f03423ff";
const BUILD_MARKER = path.join(REPO_ROOT, "scaffold", "mcp", "dist", ".cortex-build-hash");
const REQUIRED_CONTAINMENT_UPGRADE_PATHS = [
  "scaffold/scripts/dashboard.mjs",
  "scaffold/scripts/ingest-worker.mjs",
  "scaffold/scripts/ingest.mjs",
  "scaffold/scripts/lib/dialect-observation-contract.mjs",
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
const REQUIRED_PROGRESSIVE_UPGRADE_TARGETS = [
  ".context/mcp/src/embed.ts",
  ".context/mcp/src/embeddings.ts",
  ".context/mcp/src/graph.ts",
  ".context/mcp/src/loadGraph.ts",
  ".context/mcp/src/paths.ts",
  ".context/mcp/src/progressiveIndexing.ts",
  ".context/mcp/dist/embed.js",
  ".context/mcp/dist/embeddings.js",
  ".context/mcp/dist/graph.js",
  ".context/mcp/dist/loadGraph.js",
  ".context/mcp/dist/paths.js",
  ".context/mcp/dist/progressiveIndexing.js",
  ".context/mcp/tests/graph-bulk-load.test.mjs",
  ".context/mcp/tests/progressive-indexing.test.mjs",
  ".context/scripts/bootstrap.sh",
  ".context/scripts/context.sh",
  ".context/scripts/embed.sh",
  ".context/scripts/ingest.sh",
  ".context/scripts/indexing.mjs",
  ".context/scripts/lib/ingest/pipeline-stages.mjs",
  ".context/scripts/load-ryu.sh",
  ".context/scripts/status.sh",
  ".context/scripts/watch.sh",
];

const candidateMetadata = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
);

function run(command, args, { cwd = REPO_ROOT, env = process.env } = {}) {
  const childEnv = { ...env };
  delete childEnv.NODE_TEST_CONTEXT;
  const result = spawnSync(command, args, {
    cwd,
    env: childEnv,
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

function assertNodeTestSummary(output, passed) {
  assert.match(output, new RegExp(`^(?:#|ℹ) pass ${passed}\\b`, "mu"));
  assert.match(output, /^(?:#|ℹ) fail 0\b/mu);
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
  const pointer = JSON.parse(
    fs.readFileSync(path.join(packageRoot, "scaffold", "ownership", "current.json"), "utf8"),
  );
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(packageRoot, "scaffold", "ownership", `v${pointer.manifestVersion}.json`),
      "utf8",
    ),
  );
  assert.equal(pointer.manifestVersion, 2);
  assert.equal(manifest.manifestVersion, 2);
  const paths = manifest.managedRoots.flatMap((root) =>
    root.files.map((file) => path.posix.join(
      root.target,
      typeof file === "string" ? file : file.target,
    ))
  ).sort();
  return { manifest, paths };
}

function installedOwnershipEntries(packageRoot) {
  const pointer = JSON.parse(
    fs.readFileSync(path.join(packageRoot, "scaffold", "ownership", "current.json"), "utf8"),
  );
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(packageRoot, "scaffold", "ownership", `v${pointer.manifestVersion}.json`),
      "utf8",
    ),
  );
  return manifest.managedRoots.flatMap((root) =>
    root.files.map((file) => {
      const source = typeof file === "string" ? file : file.source;
      const target = typeof file === "string" ? file : file.target;
      return {
        sourcePath: path.posix.join("scaffold", root.source, source),
        targetIdentity: path.posix.join(root.target, target),
      };
    })
  ).sort((left, right) => left.targetIdentity.localeCompare(right.targetIdentity));
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
  for (const requiredPath of [
    "scaffold/ownership/current.json",
    "scaffold/ownership/v1.json",
    "scaffold/ownership/v2.json",
    "scaffold/scripts/lib/dialect-observation-contract.mjs",
  ]) {
    assert.equal(
      pack.files.some((entry) => entry.path === requiredPath),
      true,
      `missing packed runtime contract path: ${requiredPath}`,
    );
  }
  assert.equal(
    pack.files.some((entry) => entry.path.startsWith("benchmark/")),
    false,
    "the packaged runtime must not depend on benchmark files",
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

function reportedModeCounts() {
  return Object.fromEntries(
    [...EXPECTED_MODE_COUNTS].map(([mode, count]) => [
      Number(mode).toString(8).padStart(4, "0"),
      count,
    ]),
  );
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

function extractPublishedPreviousRelease(sandbox, npmCache) {
  const destination = path.join(sandbox, "previous-release-pack");
  fs.mkdirSync(destination);
  const packed = run("npm", [
    "pack",
    `${PACKAGE_NAME}@${PREVIOUS_RELEASE_VERSION}`,
    "--json",
    "--pack-destination",
    destination,
    "--cache",
    npmCache,
  ]);
  const parsed = JSON.parse(packed.stdout);
  assert.equal(parsed.length, 1);
  const release = parsed[0];
  assert.equal(release.name, PACKAGE_NAME);
  assert.equal(release.version, PREVIOUS_RELEASE_VERSION);
  assert.equal(release.shasum, PREVIOUS_RELEASE_SHA1);
  assert.equal(release.integrity, PREVIOUS_RELEASE_INTEGRITY);

  const extracted = path.join(sandbox, "previous-release-extracted");
  fs.mkdirSync(extracted);
  run("tar", ["-xzf", path.join(destination, release.filename), "-C", extracted]);
  const packageRoot = path.join(extracted, "package");
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")).version,
    PREVIOUS_RELEASE_VERSION,
  );
  return { packageRoot, release };
}

function changedManagedFiles(packageRoot, previousSource) {
  return installedOwnershipEntries(packageRoot).flatMap((entry) => {
    const candidatePath = path.join(packageRoot, ...entry.sourcePath.split("/"));
    if (!fs.existsSync(candidatePath)) return [];
    const previousPath = path.join(previousSource, ...entry.sourcePath.split("/"));
    if (!fs.existsSync(previousPath)) return [{ ...entry, status: "A" }];
    if (sha256File(previousPath) === sha256File(candidatePath)) return [];
    return [{ ...entry, status: "M" }];
  });
}

function verifyForcedUpgrade(packageRoot, sandbox, npmCache) {
  const resolvedPreviousCommit = run(
    "git",
    ["rev-parse", `${PREVIOUS_RELEASE_TAG}^{commit}`],
  ).stdout.trim();
  assert.equal(resolvedPreviousCommit, PREVIOUS_RELEASE_COMMIT);

  const { packageRoot: previousSource, release: previousRelease } =
    extractPublishedPreviousRelease(sandbox, npmCache);

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

  const changedFiles = changedManagedFiles(packageRoot, previousSource);
  const changedTargets = new Set(changedFiles.map((entry) => entry.targetIdentity));
  assert.equal(changedFiles.length, EXPECTED_CHANGED_MANAGED_COUNT);
  assert.equal(
    changedFiles.filter((entry) => entry.status === "A").length,
    EXPECTED_NEW_MANAGED_COUNT,
  );
  for (const requiredPath of REQUIRED_CONTAINMENT_UPGRADE_PATHS) {
    const targetIdentity = `.context/${requiredPath.slice("scaffold/".length)}`;
    assert.equal(changedTargets.has(targetIdentity), true, `missing containment upgrade path: ${requiredPath}`);
  }
  for (const targetIdentity of REQUIRED_PROGRESSIVE_UPGRADE_TARGETS) {
    assert.equal(changedTargets.has(targetIdentity), true, `missing progressive upgrade path: ${targetIdentity}`);
  }

  const { paths: ownedPaths } = installedOwnership(packageRoot);
  const owned = new Set(ownedPaths);
  for (const entry of changedFiles) {
    const targetPath = path.join(project, ...entry.targetIdentity.split("/"));
    const candidatePath = path.join(packageRoot, ...entry.sourcePath.split("/"));
    assert.equal(owned.has(entry.targetIdentity), true, `changed file is not owned: ${entry.targetIdentity}`);
    assert.equal(fs.existsSync(candidatePath), true, `candidate file is missing: ${entry.sourcePath}`);
    if (entry.status === "A") {
      assert.equal(fs.existsSync(targetPath), false, `new script already existed in ${PREVIOUS_RELEASE_TAG}`);
    } else {
      assert.equal(fs.existsSync(targetPath), true, `released file is missing: ${entry.sourcePath}`);
      assert.notEqual(sha256File(targetPath), sha256File(candidatePath), `changed file bytes did not change: ${entry.sourcePath}`);
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
  assert.equal(state.manifestVersion, 2);
  for (const entry of changedFiles) {
    const targetPath = path.join(project, ...entry.targetIdentity.split("/"));
    const candidatePath = path.join(packageRoot, ...entry.sourcePath.split("/"));
    assert.deepEqual(fs.readFileSync(targetPath), fs.readFileSync(candidatePath));
    assert.equal(state.fileHashes[entry.targetIdentity], sha256File(candidatePath));
  }
  return {
    previous_source: "published-npm-artifact",
    previous_tag: PREVIOUS_RELEASE_TAG,
    previous_commit: resolvedPreviousCommit,
    previous_package: `${PACKAGE_NAME}@${PREVIOUS_RELEASE_VERSION}`,
    previous_tarball_sha1: previousRelease.shasum,
    previous_tarball_integrity: previousRelease.integrity,
    changed_managed_files: changedFiles.length,
    new_managed_files: changedFiles.filter((entry) => entry.status === "A").length,
    state_hashes_verified: changedFiles.length,
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
  assert.equal(
    sha256File(path.join(packageRoot, "scaffold", "ownership", "v1.json")),
    OWNERSHIP_V1_SHA256,
  );
  const packedRuntimeSource = fs.readFileSync(
    path.join(packageRoot, "scaffold", "scripts", "lib", "dialect-observation-contract.mjs"),
    "utf8",
  );
  assert.doesNotMatch(packedRuntimeSource, /benchmark/);
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
  assertNodeTestSummary(boundary.stdout, 42);

  const characterization = run(process.execPath, [
    "--test",
    path.join(packageRoot, "tests", "ingest-characterization.test.mjs"),
  ]);
  assertNodeTestSummary(characterization.stdout, 3);

  const developmentDashboard = run(process.execPath, [
    "--test",
    path.join(packageRoot, "tests", "dashboard.test.mjs"),
  ]);
  assertNodeTestSummary(developmentDashboard.stdout, 4);

  const packagedDashboard = run(process.execPath, [
    "--test",
    path.join(packageRoot, "tests", "dashboard.test.mjs"),
  ], {
    env: { ...process.env, CORTEX_DASHBOARD_ENTRY: "packaged" },
  });
  assertNodeTestSummary(packagedDashboard.stdout, 4);

  const upgrade = verifyForcedUpgrade(packageRoot, sandbox, npmCache);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    package: PACKAGE_NAME,
    version: cleanPack.version,
    entries: cleanPack.files.length,
    mode_counts: reportedModeCounts(),
    inventory_sha256: EXPECTED_INVENTORY_SHA256,
    tarball_sha1: cleanPack.shasum,
    tarball_sha256: sha256File(tarball),
    clean_and_prebuilt_inventory_equal: true,
    installed_prefix: true,
    packed_boundary_cases: 42,
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
