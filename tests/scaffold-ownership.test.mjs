import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { initializeScaffold } from "../bin/cli/scaffold.mjs";
import {
  expandLegacyFiles,
  expandManagedFiles,
  installManagedScaffold,
  loadCurrentOwnershipManifest,
  loadOwnershipManifest,
  scaffoldOwnershipConstants,
  validateOwnershipManifest,
} from "../bin/cli/scaffold-ownership.mjs";

const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURE_PACKAGE_ROOT = path.join(
  PROJECT_ROOT,
  "tests",
  "fixtures",
  "scaffold-ownership-package",
);
const FIXTURE_MANIFEST_PATH = path.join(
  FIXTURE_PACKAGE_ROOT,
  "scaffold",
  "ownership",
  "v2.json",
);
const V241_WORKER_FIXTURE = path.join(
  PROJECT_ROOT,
  "tests",
  "fixtures",
  "scaffold-baseline-v2.4.1",
  "ingest-worker.mjs",
);
const DIALECT_RUNTIME_TARGET =
  ".context/scripts/lib/dialect-observation-contract.mjs";
const DIALECT_RUNTIME_SOURCE = path.join(
  PROJECT_ROOT,
  "scaffold",
  "scripts",
  "lib",
  "dialect-observation-contract.mjs",
);
const OWNERSHIP_V1_SHA256 =
  "b3b97387f541e718ac3b27f677e00cf815cb9bd600b1305391891685f03423ff";

function makeTarget(prefix = "cortex-scaffold-ownership-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function targetPath(target, relativePath) {
  return path.join(target, ...relativePath.split("/"));
}

function readInstalledState(target) {
  return JSON.parse(
    fs.readFileSync(
      targetPath(
        target,
        scaffoldOwnershipConstants.installedStateRelativePath,
      ),
      "utf8",
    ),
  );
}

function writePreservedFixtureFiles(target) {
  const files = new Map([
    [".context/config.yaml", "repo_id: user-owned\n"],
    [".context/rules.yaml", "rules:\n  - id: user.rule\n"],
    [
      ".context/ontology.cypher",
      "CREATE (:UserOwned {secret: 'preserved'});\n",
    ],
    [
      ".context/enterprise.yml",
      "enterprise:\n  api_key: ent_preserved_12345678\n",
    ],
    [
      ".context/enterprise.yaml",
      "enterprise:\n  api_key: ent_preserved_87654321\n",
    ],
    ["AGENTS.md", "# User agent instructions\n"],
    ["CLAUDE.md", "# User Claude instructions\n"],
  ]);
  for (const [relativePath, contents] of files) {
    const filePath = targetPath(target, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents, "utf8");
  }
  return files;
}

function installFixtureV1(target) {
  return installManagedScaffold(FIXTURE_PACKAGE_ROOT, target, {
    force: true,
    manifestVersion: 1,
  });
}

test("package ownership manifest explicitly covers canonical scaffold sources", () => {
  const manifest = loadCurrentOwnershipManifest(PROJECT_ROOT);
  const previousManifest = loadOwnershipManifest(PROJECT_ROOT, 6);
  const v4Manifest = loadOwnershipManifest(PROJECT_ROOT, 4);
  const v3Manifest = loadOwnershipManifest(PROJECT_ROOT, 3);
  const v2Manifest = loadOwnershipManifest(PROJECT_ROOT, 2);
  const v1Manifest = loadOwnershipManifest(PROJECT_ROOT, 1);
  const targets = new Set(
    expandManagedFiles(manifest).map((entry) => entry.target),
  );
  const canonicalIngestFiles = [
    "arguments.mjs",
    "chunks.mjs",
    "config.mjs",
    "constants.mjs",
    "files.mjs",
    "incremental-state.mjs",
    "io.mjs",
    "main.mjs",
    "parser-composition.mjs",
    "parser-registry.mjs",
    "pipeline-stages.mjs",
    "projects.mjs",
    "relations.mjs",
    "runtime-paths.mjs",
    "workers.mjs",
  ];

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.manifestVersion, 7);
  assert.deepEqual(manifest.preStateBaselines, ["v2.4.1"]);
  assert.equal(targets.has(DIALECT_RUNTIME_TARGET), true);
  assert.equal(
    targets.size,
    expandManagedFiles(previousManifest).length + 3,
    "v7 must add exactly the maintained-analysis provisioning surface",
  );
  const currentScriptsRoot = manifest.managedRoots.find(
    (root) => root.source === "scripts" && root.target === ".context/scripts",
  );
  const previousScriptsRoot = previousManifest.managedRoots.find(
    (root) => root.source === "scripts" && root.target === ".context/scripts",
  );
  assert.deepEqual(
    currentScriptsRoot,
    previousScriptsRoot,
    "the legacy-mapped scripts root must remain identical to v1",
  );
  const rawV7 = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, "scaffold", "ownership", "v7.json"), "utf8"),
  );
  const v7Targets = new Set(expandManagedFiles(validateOwnershipManifest(rawV7, 7)).map((entry) => entry.target));
  const previousTargets = new Set(expandManagedFiles(previousManifest).map((entry) => entry.target));
  const v7NewTargets = [...v7Targets].filter((target) => !previousTargets.has(target)).sort();
  assert.deepEqual(v7NewTargets, [
    ".context/mcp/dist/core/analysis-state/provisioning.js",
    ".context/mcp/src/core/analysis-state/provisioning.ts",
    ".context/mcp/tests/analysis-state-provisioning.test.mjs",
  ]);
  const reconstructedV6 = structuredClone(rawV7);
  reconstructedV6.manifestVersion = 6;
  reconstructedV6.managedRoots[0].files = reconstructedV6.managedRoots[0].files.filter(
    (file) => !v7NewTargets.includes(`.context/mcp/${typeof file === "string" ? file : file.target}`),
  );
  const rawV6 = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, "scaffold", "ownership", "v6.json"), "utf8"),
  );
  assert.deepEqual(reconstructedV6, rawV6, "v7 may differ from v6 only by the three provisioning files");
  const v6Targets = new Set(expandManagedFiles(validateOwnershipManifest(rawV6, 6)).map((entry) => entry.target));
  const v5Manifest = loadOwnershipManifest(PROJECT_ROOT, 5);
  const v5TargetsForV6 = new Set(expandManagedFiles(v5Manifest).map((entry) => entry.target));
  const v6NewTargets = [...v6Targets].filter((target) => !v5TargetsForV6.has(target)).sort();
  assert.deepEqual(v6NewTargets, [
    ".context/mcp/dist/core/analysis-state/current-state.js",
    ".context/mcp/src/core/analysis-state/current-state.ts",
    ".context/mcp/tests/analysis-state-current-state.test.mjs",
  ]);
  const reconstructedV5 = structuredClone(rawV6);
  reconstructedV5.manifestVersion = 5;
  reconstructedV5.managedRoots[0].files = reconstructedV5.managedRoots[0].files.filter(
    (file) => !v6NewTargets.includes(`.context/mcp/${typeof file === "string" ? file : file.target}`),
  );
  const rawV5 = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, "scaffold", "ownership", "v5.json"), "utf8"),
  );
  assert.deepEqual(reconstructedV5, rawV5, "v6 may differ from v5 only by the three Current State files");
  const v5Targets = new Set(expandManagedFiles(validateOwnershipManifest(rawV5, 5)).map((entry) => entry.target));
  const v4TargetsForV5 = new Set(expandManagedFiles(v4Manifest).map((entry) => entry.target));
  const v5NewTargets = [...v5Targets].filter((target) => !v4TargetsForV5.has(target)).sort();
  assert.deepEqual(v5NewTargets, [
    ".context/mcp/dist/core/analysis-state/trusted-writer.js",
    ".context/mcp/src/core/analysis-state/trusted-writer.ts",
    ".context/mcp/tests/analysis-state-trusted-writer.test.mjs",
  ]);
  const reconstructedV4 = structuredClone(rawV5);
  reconstructedV4.manifestVersion = 4;
  reconstructedV4.managedRoots[0].files = reconstructedV4.managedRoots[0].files.filter(
    (file) => !v5NewTargets.includes(`.context/mcp/${typeof file === "string" ? file : file.target}`),
  );
  const rawV4 = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, "scaffold", "ownership", "v4.json"), "utf8"),
  );
  assert.deepEqual(reconstructedV4, rawV4, "v5 may differ from v4 only by the three writer files");
  const rawV3 = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, "scaffold", "ownership", "v3.json"), "utf8"),
  );
  const v4Targets = new Set(expandManagedFiles(validateOwnershipManifest(rawV4, 4)).map((entry) => entry.target));
  const v3Targets = new Set(expandManagedFiles(v3Manifest).map((entry) => entry.target));
  const newTargets = [...v4Targets].filter((target) => !v3Targets.has(target)).sort();
  assert.deepEqual(newTargets, [
    ".context/mcp/dist/cli/workflow-analysis.js",
    ".context/mcp/dist/core/analysis-state/query-reader.js",
    ".context/mcp/src/cli/workflow-analysis.ts",
    ".context/mcp/src/core/analysis-state/query-reader.ts",
    ".context/mcp/tests/analysis-state-cli.test.mjs",
  ]);
  const reconstructedV3 = structuredClone(rawV4);
  reconstructedV3.manifestVersion = 3;
  reconstructedV3.managedRoots[0].files = reconstructedV3.managedRoots[0].files.filter(
    (file) => !newTargets.includes(`.context/mcp/${typeof file === "string" ? file : file.target}`),
  );
  assert.deepEqual(reconstructedV3, rawV3, "v4 may differ from v3 only by the five CLI-reader files");

  const rawV2 = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, "scaffold", "ownership", "v2.json"), "utf8"),
  );
  const v2Targets = new Set(expandManagedFiles(v2Manifest).map((entry) => entry.target));
  const v3NewTargets = [...v3Targets].filter((target) => !v2Targets.has(target)).sort();
  assert.deepEqual(v3NewTargets, [
    ".context/mcp/dist/core/analysis-state/engine.js",
    ".context/mcp/dist/core/analysis-state/queries.js",
    ".context/mcp/dist/core/analysis-state/schemas.js",
    ".context/mcp/dist/core/analysis-state/store.js",
    ".context/mcp/dist/core/workflow/analysis-state-adapter.js",
    ".context/mcp/src/core/analysis-state/engine.ts",
    ".context/mcp/src/core/analysis-state/queries.ts",
    ".context/mcp/src/core/analysis-state/schemas.ts",
    ".context/mcp/src/core/analysis-state/store.ts",
    ".context/mcp/src/core/workflow/analysis-state-adapter.ts",
    ".context/mcp/tests/analysis-state-engine.test.mjs",
    ".context/mcp/tests/analysis-state-store.test.mjs",
    ".context/mcp/tests/analysis-state-workflow-adapter.test.mjs",
  ]);
  const reconstructedV2 = structuredClone(rawV3);
  reconstructedV2.manifestVersion = 2;
  reconstructedV2.managedRoots[0].files = reconstructedV2.managedRoots[0].files.filter(
    (file) => !v3NewTargets.includes(`.context/mcp/${typeof file === "string" ? file : file.target}`),
  );
  assert.deepEqual(reconstructedV2, rawV2, "v3 may differ from v2 only by the 13 owned files");
  assert.deepEqual(
    rawV2.managedRoots.find((root) => root.source === "scripts/lib"),
    {
      source: "scripts/lib",
      target: ".context/scripts/lib",
      files: ["dialect-observation-contract.mjs"],
    },
  );
  assert.equal(
    expandLegacyFiles(v2Manifest).some(
      (entry) => entry.target === "scripts/lib/dialect-observation-contract.mjs",
    ),
    false,
    "the new nested root must have no legacy cleanup authority",
  );
  assert.equal(
    crypto.createHash("sha256").update(
      fs.readFileSync(path.join(PROJECT_ROOT, "scaffold", "ownership", "v1.json")),
    ).digest("hex"),
    OWNERSHIP_V1_SHA256,
  );
  const reconstructedV1 = structuredClone(rawV2);
  reconstructedV1.manifestVersion = 1;
  const v2RootCount = reconstructedV1.managedRoots.length;
  reconstructedV1.managedRoots = reconstructedV1.managedRoots.filter(
    (root) => !(
      root.source === "scripts/lib" &&
      root.target === ".context/scripts/lib"
    ),
  );
  assert.equal(
    reconstructedV1.managedRoots.length,
    v2RootCount - 1,
    "v1 reconstruction must remove exactly the new nested runtime root",
  );
  assert.deepEqual(
    reconstructedV1,
    JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "scaffold", "ownership", "v1.json"), "utf8")),
    "v2 may differ from v1 only by its version and the runtime target",
  );
  assert.equal(expandManagedFiles(v1Manifest).length + 1, expandManagedFiles(v2Manifest).length);
  for (const file of canonicalIngestFiles) {
    assert.equal(
      targets.has(`.context/scripts/lib/ingest/${file}`),
      true,
      `${file} must remain package-owned`,
    );
  }
  for (const target of [
    ".context/mcp/src/progressiveIndexing.ts",
    ".context/mcp/dist/progressiveIndexing.js",
    ".context/mcp/tests/progressive-indexing.test.mjs",
    ".context/scripts/indexing.mjs",
  ]) {
    assert.equal(targets.has(target), true, `${target} must remain package-owned`);
  }
  for (const target of [
    ".context/config.yaml",
    ".context/rules.yaml",
    ".context/ontology.cypher",
    ".context/enterprise.yml",
    ".context/enterprise.yaml",
    "AGENTS.md",
    "CLAUDE.md",
  ]) {
    assert.equal(manifest.protectedFiles.includes(target), true);
    assert.equal(targets.has(target), false);
  }
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8"),
  );
  assert.equal(packageJson.files.includes("scaffold/ownership"), true);
});

test("clean install and historical force upgrade install the packaged runtime fingerprint", () => {
  const cleanTarget = makeTarget("cortex-scaffold-runtime-clean-");
  const upgradeTarget = makeTarget("cortex-scaffold-runtime-upgrade-");
  const expectedBytes = fs.readFileSync(DIALECT_RUNTIME_SOURCE);
  const expectedHash = crypto.createHash("sha256").update(expectedBytes).digest("hex");
  try {
    installManagedScaffold(PROJECT_ROOT, cleanTarget, { force: true });
    assert.deepEqual(
      fs.readFileSync(targetPath(cleanTarget, DIALECT_RUNTIME_TARGET)),
      expectedBytes,
    );
    assert.equal(readInstalledState(cleanTarget).manifestVersion, 7);
    assert.equal(
      readInstalledState(cleanTarget).fileHashes[DIALECT_RUNTIME_TARGET],
      expectedHash,
    );

    installManagedScaffold(PROJECT_ROOT, upgradeTarget, {
      force: true,
      manifestVersion: 1,
    });
    assert.equal(fs.existsSync(targetPath(upgradeTarget, DIALECT_RUNTIME_TARGET)), false);
    assert.equal(readInstalledState(upgradeTarget).manifestVersion, 1);

    installManagedScaffold(PROJECT_ROOT, upgradeTarget, { force: true });
    assert.deepEqual(
      fs.readFileSync(targetPath(upgradeTarget, DIALECT_RUNTIME_TARGET)),
      expectedBytes,
    );
    assert.equal(readInstalledState(upgradeTarget).manifestVersion, 7);
    assert.equal(
      readInstalledState(upgradeTarget).fileHashes[DIALECT_RUNTIME_TARGET],
      expectedHash,
    );
  } finally {
    fs.rmSync(cleanTarget, { recursive: true, force: true });
    fs.rmSync(upgradeTarget, { recursive: true, force: true });
  }
});

test(
  "clean-state byte-identical runtime collisions are never treated as owned",
  { skip: process.platform === "win32" },
  () => {
    const regularTarget = makeTarget("cortex-scaffold-runtime-clean-identical-");
    const hardLinkTarget = makeTarget("cortex-scaffold-runtime-clean-hardlink-");
    const external = makeTarget("cortex-scaffold-runtime-clean-external-");
    const runtimeBytes = fs.readFileSync(DIALECT_RUNTIME_SOURCE);
    const externalFile = path.join(external, "dialect-observation-contract.mjs");
    fs.writeFileSync(externalFile, runtimeBytes);
    try {
      const regularPath = targetPath(regularTarget, DIALECT_RUNTIME_TARGET);
      fs.mkdirSync(path.dirname(regularPath), { recursive: true });
      fs.writeFileSync(regularPath, runtimeBytes);
      const regularBefore = fs.statSync(regularPath);
      assert.throws(
        () => installManagedScaffold(PROJECT_ROOT, regularTarget, { force: true }),
        /unowned scaffold collision: \.context\/scripts\/lib\/dialect-observation-contract\.mjs/,
      );
      const regularAfter = fs.statSync(regularPath);
      assert.equal(regularAfter.ino, regularBefore.ino);
      assert.equal(regularAfter.nlink, regularBefore.nlink);
      assert.deepEqual(fs.readFileSync(regularPath), runtimeBytes);
      assert.equal(
        fs.existsSync(targetPath(regularTarget, scaffoldOwnershipConstants.installedStateRelativePath)),
        false,
      );

      const hardLinkedPath = targetPath(hardLinkTarget, DIALECT_RUNTIME_TARGET);
      fs.mkdirSync(path.dirname(hardLinkedPath), { recursive: true });
      fs.linkSync(externalFile, hardLinkedPath);
      const targetBefore = fs.statSync(hardLinkedPath);
      const externalBefore = fs.statSync(externalFile);
      assert.throws(
        () => installManagedScaffold(PROJECT_ROOT, hardLinkTarget, { force: true }),
        /unowned scaffold collision: \.context\/scripts\/lib\/dialect-observation-contract\.mjs/,
      );
      const targetAfter = fs.statSync(hardLinkedPath);
      const externalAfter = fs.statSync(externalFile);
      assert.equal(targetAfter.ino, targetBefore.ino);
      assert.equal(externalAfter.ino, externalBefore.ino);
      assert.equal(targetAfter.ino, externalAfter.ino);
      assert.equal(targetAfter.nlink, targetBefore.nlink);
      assert.equal(externalAfter.nlink, externalBefore.nlink);
      assert.deepEqual(fs.readFileSync(hardLinkedPath), runtimeBytes);
      assert.deepEqual(fs.readFileSync(externalFile), runtimeBytes);
      assert.equal(
        fs.existsSync(targetPath(hardLinkTarget, scaffoldOwnershipConstants.installedStateRelativePath)),
        false,
      );
    } finally {
      fs.rmSync(regularTarget, { recursive: true, force: true });
      fs.rmSync(hardLinkTarget, { recursive: true, force: true });
      fs.rmSync(external, { recursive: true, force: true });
    }
  },
);

test(
  "clean init preserves unknown legacy dialect files and hard links outside legacy authority",
  { skip: process.platform === "win32" },
  () => {
    const byteIdenticalTarget = makeTarget("cortex-scaffold-runtime-legacy-identical-");
    const hardLinkTarget = makeTarget("cortex-scaffold-runtime-legacy-hardlink-");
    const external = makeTarget("cortex-scaffold-runtime-legacy-external-");
    const runtimeBytes = fs.readFileSync(DIALECT_RUNTIME_SOURCE);
    const externalFile = path.join(external, "dialect-observation-contract.mjs");
    fs.writeFileSync(externalFile, runtimeBytes);
    try {
      const byteIdenticalLegacyPath = targetPath(
        byteIdenticalTarget,
        "scripts/lib/dialect-observation-contract.mjs",
      );
      fs.mkdirSync(path.dirname(byteIdenticalLegacyPath), { recursive: true });
      fs.writeFileSync(byteIdenticalLegacyPath, runtimeBytes);
      initializeScaffold(byteIdenticalTarget, false);
      assert.deepEqual(fs.readFileSync(byteIdenticalLegacyPath), runtimeBytes);
      assert.deepEqual(
        fs.readFileSync(targetPath(byteIdenticalTarget, DIALECT_RUNTIME_TARGET)),
        runtimeBytes,
      );

      const hardLinkedLegacyPath = targetPath(
        hardLinkTarget,
        "scripts/lib/dialect-observation-contract.mjs",
      );
      fs.mkdirSync(path.dirname(hardLinkedLegacyPath), { recursive: true });
      fs.linkSync(externalFile, hardLinkedLegacyPath);
      const externalInode = fs.statSync(externalFile).ino;
      initializeScaffold(hardLinkTarget, false);
      assert.equal(fs.statSync(hardLinkedLegacyPath).ino, externalInode);
      assert.equal(fs.statSync(externalFile).ino, externalInode);
      assert.deepEqual(fs.readFileSync(externalFile), runtimeBytes);
      assert.deepEqual(
        fs.readFileSync(targetPath(hardLinkTarget, DIALECT_RUNTIME_TARGET)),
        runtimeBytes,
      );
    } finally {
      fs.rmSync(byteIdenticalTarget, { recursive: true, force: true });
      fs.rmSync(hardLinkTarget, { recursive: true, force: true });
      fs.rmSync(external, { recursive: true, force: true });
    }
  },
);

test(
  "v2 runtime collisions, links, and redirected ancestors fail closed during upgrade",
  { skip: process.platform === "win32" },
  () => {
    const target = makeTarget("cortex-scaffold-runtime-collision-");
    const external = makeTarget("cortex-scaffold-runtime-external-");
    const runtimeTarget = targetPath(target, DIALECT_RUNTIME_TARGET);
    const externalFile = path.join(external, "outside.mjs");
    fs.writeFileSync(externalFile, "export const outside = true;\n", "utf8");
    try {
      installManagedScaffold(PROJECT_ROOT, target, {
        force: true,
        manifestVersion: 1,
      });

      fs.writeFileSync(runtimeTarget, "export const userOwned = true;\n", "utf8");
      assert.throws(
        () => installManagedScaffold(PROJECT_ROOT, target, { force: true }),
        /unowned scaffold collision: \.context\/scripts\/lib\/dialect-observation-contract\.mjs/,
      );
      assert.equal(fs.readFileSync(runtimeTarget, "utf8"), "export const userOwned = true;\n");
      assert.equal(readInstalledState(target).manifestVersion, 1);
      fs.unlinkSync(runtimeTarget);

      fs.symlinkSync(externalFile, runtimeTarget);
      assert.throws(
        () => installManagedScaffold(PROJECT_ROOT, target, { force: true }),
        /Refusing symlinked managed scaffold target/,
      );
      assert.equal(fs.readFileSync(externalFile, "utf8"), "export const outside = true;\n");
      fs.unlinkSync(runtimeTarget);

      fs.linkSync(externalFile, runtimeTarget);
      const externalInode = fs.statSync(externalFile).ino;
      assert.throws(
        () => installManagedScaffold(PROJECT_ROOT, target, { force: true }),
        /unowned scaffold collision: \.context\/scripts\/lib\/dialect-observation-contract\.mjs/,
      );
      assert.equal(fs.statSync(externalFile).ino, externalInode);
      assert.equal(fs.readFileSync(externalFile, "utf8"), "export const outside = true;\n");
      fs.unlinkSync(runtimeTarget);

      const libDirectory = targetPath(target, ".context/scripts/lib");
      fs.rmSync(libDirectory, { recursive: true, force: true });
      fs.symlinkSync(external, libDirectory);
      assert.throws(
        () => installManagedScaffold(PROJECT_ROOT, target, { force: true }),
        /Refusing symlinked managed scaffold target/,
      );
      assert.equal(fs.readFileSync(externalFile, "utf8"), "export const outside = true;\n");
      assert.equal(readInstalledState(target).manifestVersion, 1);
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
      fs.rmSync(external, { recursive: true, force: true });
    }
  },
);

test("forced upgrade removes only unmodified obsolete owned files", () => {
  const target = makeTarget();
  const external = makeTarget("cortex-scaffold-external-");
  const preserved = writePreservedFixtureFiles(target);
  const externalFile = path.join(external, "outside.txt");
  fs.writeFileSync(externalFile, "outside remains untouched\n", "utf8");

  try {
    installFixtureV1(target);
    const stalePath = targetPath(
      target,
      ".context/scripts/lib/removed-stage.mjs",
    );
    assert.notEqual(
      spawnSync(process.execPath, ["--check", stalePath]).status,
      0,
      "the prior stale source must be capable of breaking a syntax gate",
    );
    const unknownPath = targetPath(
      target,
      ".context/scripts/lib/user-notes.txt",
    );
    fs.writeFileSync(unknownPath, "user-owned neighbor\n", "utf8");
    const unknownLink = targetPath(
      target,
      ".context/scripts/user-outside-link",
    );
    fs.symlinkSync(externalFile, unknownLink);

    const result = installManagedScaffold(
      FIXTURE_PACKAGE_ROOT,
      target,
      { force: true },
    );

    assert.deepEqual(result.removed, [
      ".context/scripts/lib/removed-stage.mjs",
      ".context/scripts/obsolete.mjs",
      ".context/scripts/renamed-old.mjs",
    ]);
    assert.equal(fs.existsSync(stalePath), false);
    assert.equal(
      fs.existsSync(targetPath(target, ".context/scripts/obsolete.mjs")),
      false,
    );
    assert.equal(
      fs.existsSync(targetPath(target, ".context/scripts/renamed-old.mjs")),
      false,
    );
    assert.equal(
      fs.readFileSync(
        targetPath(target, ".context/scripts/renamed-new.mjs"),
        "utf8",
      ),
      "export const newName = true;\n",
    );
    assert.equal(fs.readFileSync(unknownPath, "utf8"), "user-owned neighbor\n");
    assert.equal(fs.lstatSync(unknownLink).isSymbolicLink(), true);
    assert.equal(
      fs.readFileSync(externalFile, "utf8"),
      "outside remains untouched\n",
    );
    for (const [relativePath, contents] of preserved) {
      assert.equal(fs.readFileSync(targetPath(target, relativePath), "utf8"), contents);
    }
    const bootstrap = spawnSync(
      process.execPath,
      [targetPath(target, ".context/scripts/bootstrap-check.mjs")],
      { encoding: "utf8" },
    );
    assert.equal(bootstrap.status, 0, `${bootstrap.stdout}${bootstrap.stderr}`);
    assert.equal(readInstalledState(target).manifestVersion, 2);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});

test("locally modified obsolete files fail the upgrade before mutation", () => {
  const target = makeTarget();
  try {
    installFixtureV1(target);
    const modifiedPath = targetPath(
      target,
      ".context/scripts/obsolete.mjs",
    );
    fs.writeFileSync(modifiedPath, "export const userModified = true;\n");

    assert.throws(
      () =>
        installManagedScaffold(FIXTURE_PACKAGE_ROOT, target, { force: true }),
      /locally modified obsolete scaffold file/,
    );
    assert.equal(
      fs.readFileSync(modifiedPath, "utf8"),
      "export const userModified = true;\n",
    );
    assert.equal(
      fs.existsSync(
        targetPath(target, ".context/scripts/lib/removed-stage.mjs"),
      ),
      true,
      "cleanup must be all-preflight-before-delete",
    );
    assert.equal(
      fs.existsSync(targetPath(target, ".context/scripts/renamed-new.mjs")),
      false,
      "new scaffold copying must not begin after cleanup preflight fails",
    );
    assert.equal(readInstalledState(target).manifestVersion, 1);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("new managed paths cannot overwrite an unknown collision", () => {
  const target = makeTarget();
  try {
    installFixtureV1(target);
    const collisionPath = targetPath(
      target,
      ".context/scripts/renamed-new.mjs",
    );
    fs.writeFileSync(collisionPath, "export const userOwned = true;\n");
    const statePath = targetPath(
      target,
      scaffoldOwnershipConstants.installedStateRelativePath,
    );
    const state = readInstalledState(target);
    state.fileHashes[".context/scripts/renamed-new.mjs"] = "a".repeat(64);
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

    assert.throws(
      () =>
        installManagedScaffold(FIXTURE_PACKAGE_ROOT, target, { force: true }),
      /unowned scaffold collision: \.context\/scripts\/renamed-new\.mjs/,
    );
    assert.equal(
      fs.readFileSync(collisionPath, "utf8"),
      "export const userOwned = true;\n",
    );
    assert.equal(
      fs.existsSync(targetPath(target, ".context/scripts/obsolete.mjs")),
      true,
      "collision preflight must run before obsolete cleanup",
    );
    assert.equal(readInstalledState(target).manifestVersion, 1);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("the hash-pinned 2.4.1 scaffold upgrades before installed state exists", () => {
  const target = makeTarget("cortex-scaffold-v241-upgrade-");
  const baselineContents = fs.readFileSync(V241_WORKER_FIXTURE);
  assert.equal(
    crypto.createHash("sha256").update(baselineContents).digest("hex"),
    "5240b2339b152908dba06d349c2190ecca1881b5be4808cf8021f63fb9557aba",
    "fixture must remain byte-identical to the 2.4.1 package",
  );

  try {
    const workerPath = targetPath(
      target,
      ".context/scripts/ingest-worker.mjs",
    );
    fs.mkdirSync(path.dirname(workerPath), { recursive: true });
    fs.writeFileSync(workerPath, baselineContents);

    initializeScaffold(target, true);

    assert.equal(
      fs.readFileSync(workerPath, "utf8"),
      fs.readFileSync(
        path.join(PROJECT_ROOT, "scaffold/scripts/ingest-worker.mjs"),
        "utf8",
      ),
    );
    assert.equal(readInstalledState(target).manifestVersion, 7);
    assert.deepEqual(
      fs.readFileSync(targetPath(target, DIALECT_RUNTIME_TARGET)),
      fs.readFileSync(DIALECT_RUNTIME_SOURCE),
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("the hash-pinned 2.4.1 legacy root script is migrated safely", () => {
  const target = makeTarget("cortex-scaffold-v241-legacy-");
  try {
    const legacyWorker = targetPath(target, "scripts/ingest-worker.mjs");
    fs.mkdirSync(path.dirname(legacyWorker), { recursive: true });
    fs.copyFileSync(V241_WORKER_FIXTURE, legacyWorker);

    initializeScaffold(target, false);

    assert.equal(fs.existsSync(legacyWorker), false);
    assert.equal(
      fs.readFileSync(
        targetPath(target, ".context/scripts/ingest-worker.mjs"),
        "utf8",
      ),
      fs.readFileSync(
        path.join(PROJECT_ROOT, "scaffold/scripts/ingest-worker.mjs"),
        "utf8",
      ),
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test(
  "managed upgrades replace hard links without mutating the external inode",
  { skip: process.platform === "win32" },
  () => {
    const target = makeTarget();
    const external = makeTarget("cortex-scaffold-hardlink-external-");
    try {
      installFixtureV1(target);
      const managedPath = targetPath(target, ".context/scripts/keep.mjs");
      const externalPath = path.join(external, "external-keep.mjs");
      fs.linkSync(managedPath, externalPath);
      const externalInode = fs.statSync(externalPath).ino;

      installManagedScaffold(FIXTURE_PACKAGE_ROOT, target, { force: true });

      assert.equal(
        fs.readFileSync(externalPath, "utf8"),
        "export const scaffoldVersion = 1;\n",
      );
      assert.equal(fs.statSync(externalPath).ino, externalInode);
      assert.equal(
        fs.readFileSync(managedPath, "utf8"),
        "export const scaffoldVersion = 2;\n",
      );
      assert.notEqual(fs.statSync(managedPath).ino, externalInode);
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
      fs.rmSync(external, { recursive: true, force: true });
    }
  },
);

test("ownership manifests reject traversal, absolute paths, and broad roots", () => {
  const base = JSON.parse(fs.readFileSync(FIXTURE_MANIFEST_PATH, "utf8"));
  const cases = [
    (manifest) => {
      manifest.managedRoots[0].target = ".";
    },
    (manifest) => {
      manifest.managedRoots[0].target = "../outside";
    },
    (manifest) => {
      manifest.managedRoots[0].target = "/tmp/outside";
    },
    (manifest) => {
      manifest.managedRoots[0].target = "C:/outside";
    },
    (manifest) => {
      manifest.managedRoots[0].files[0] = "../outside.mjs";
    },
    (manifest) => {
      manifest.managedRoots[0].files[0] = "nested\\outside.mjs";
    },
    (manifest) => {
      manifest.managedRoots[0].files[0] = "";
    },
  ];
  for (const mutate of cases) {
    const manifest = structuredClone(base);
    mutate(manifest);
    assert.throws(
      () => validateOwnershipManifest(manifest, 2),
      /relative path|escapes|broadens/,
    );
  }

  const missingProtection = structuredClone(base);
  missingProtection.protectedFiles =
    missingProtection.protectedFiles.filter(
      (file) => file !== ".context/config.yaml",
    );
  assert.throws(
    () => validateOwnershipManifest(missingProtection, 2),
    /must protect \.context\/config\.yaml/,
  );

  const managedState = structuredClone(base);
  managedState.managedRoots[0].target = ".context";
  managedState.managedRoots[0].files[0] = {
    source: "bootstrap-check.mjs",
    target: "scaffold-state.json",
  };
  assert.throws(
    () => validateOwnershipManifest(managedState, 2),
    /Installed scaffold state cannot be a managed source/,
  );

  const collidingLegacyRoot = structuredClone(base);
  collidingLegacyRoot.legacyRoots = [
    {
      sourceManagedRoot: ".context/scripts",
      target: ".context/scripts",
    },
  ];
  assert.throws(
    () => validateOwnershipManifest(collidingLegacyRoot, 2),
    /Legacy scaffold target collides with a live target/,
  );

  const invalidLegacyReference = structuredClone(base);
  invalidLegacyReference.legacyRoots = [
    {
      sourceManagedRoot: ".context/not-managed",
      target: "scripts",
    },
  ];
  assert.throws(
    () => validateOwnershipManifest(invalidLegacyReference, 2),
    /sourceManagedRoot must reference a managed root/,
  );
});

test(
  "symlinked obsolete files fail closed without touching external targets",
  { skip: process.platform === "win32" },
  () => {
    const target = makeTarget();
    const external = makeTarget("cortex-scaffold-symlink-external-");
    const externalFile = path.join(external, "outside.mjs");
    fs.writeFileSync(externalFile, "export const outside = true;\n", "utf8");
    try {
      installFixtureV1(target);
      const obsoletePath = targetPath(
        target,
        ".context/scripts/obsolete.mjs",
      );
      fs.unlinkSync(obsoletePath);
      fs.symlinkSync(externalFile, obsoletePath);

      assert.throws(
        () =>
          installManagedScaffold(FIXTURE_PACKAGE_ROOT, target, { force: true }),
        /Refusing symlinked obsolete scaffold file/,
      );
      assert.equal(
        fs.readFileSync(externalFile, "utf8"),
        "export const outside = true;\n",
      );
      assert.equal(fs.lstatSync(obsoletePath).isSymbolicLink(), true);
      assert.equal(readInstalledState(target).manifestVersion, 1);
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
      fs.rmSync(external, { recursive: true, force: true });
    }
  },
);

test("non-file obsolete targets fail closed without broad deletion", () => {
  const target = makeTarget();
  try {
    installFixtureV1(target);
    const obsoletePath = targetPath(
      target,
      ".context/scripts/obsolete.mjs",
    );
    fs.unlinkSync(obsoletePath);
    fs.mkdirSync(obsoletePath);
    fs.writeFileSync(path.join(obsoletePath, "unknown.txt"), "preserve\n");

    assert.throws(
      () =>
        installManagedScaffold(FIXTURE_PACKAGE_ROOT, target, { force: true }),
      /obsolete scaffold file .* is not a regular file/,
    );
    assert.equal(
      fs.readFileSync(path.join(obsoletePath, "unknown.txt"), "utf8"),
      "preserve\n",
    );
    assert.equal(readInstalledState(target).manifestVersion, 1);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("project-controlled state cannot add cleanup authority", () => {
  const target = makeTarget();
  try {
    installFixtureV1(target);
    const statePath = targetPath(
      target,
      scaffoldOwnershipConstants.installedStateRelativePath,
    );
    const state = readInstalledState(target);
    state.fileHashes["../outside.txt"] = "a".repeat(64);
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

    assert.throws(
      () =>
        installManagedScaffold(FIXTURE_PACKAGE_ROOT, target, { force: true }),
      /Installed scaffold hash path .*escapes or broadens/,
    );
    assert.equal(
      fs.existsSync(targetPath(target, ".context/scripts/obsolete.mjs")),
      true,
    );

    delete state.fileHashes["../outside.txt"];
    state.manifestVersion = 999;
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    assert.throws(
      () =>
        installManagedScaffold(FIXTURE_PACKAGE_ROOT, target, { force: true }),
      /Unable to read scaffold ownership manifest/,
    );
    assert.equal(
      fs.existsSync(targetPath(target, ".context/scripts/obsolete.mjs")),
      true,
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test(
  "symlinked managed ancestors fail before cleanup or copying",
  { skip: process.platform === "win32" },
  () => {
    const target = makeTarget();
    const external = makeTarget("cortex-scaffold-parent-external-");
    try {
      installFixtureV1(target);
      const scriptsDir = targetPath(target, ".context/scripts");
      fs.rmSync(scriptsDir, { recursive: true, force: true });
      fs.writeFileSync(path.join(external, "keep.mjs"), "external keep\n");
      fs.symlinkSync(external, scriptsDir);

      assert.throws(
        () =>
          installManagedScaffold(FIXTURE_PACKAGE_ROOT, target, { force: true }),
        /Refusing symlinked managed scaffold target/,
      );
      assert.equal(
        fs.readFileSync(path.join(external, "keep.mjs"), "utf8"),
        "external keep\n",
      );
      assert.equal(readInstalledState(target).manifestVersion, 1);
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
      fs.rmSync(external, { recursive: true, force: true });
    }
  },
);

test("project init persists ownership and force preserves unknown and protected files", () => {
  const target = makeTarget("cortex-scaffold-init-state-");
  try {
    initializeScaffold(target, false);
    const ontologyPath = targetPath(target, ".context/ontology.cypher");
    const unknownPath = targetPath(
      target,
      ".context/scripts/user-tool.mjs",
    );
    fs.writeFileSync(ontologyPath, "CREATE (:UserOwned);\n", "utf8");
    fs.writeFileSync(unknownPath, "export const userTool = true;\n", "utf8");

    initializeScaffold(target, true);

    assert.equal(
      fs.readFileSync(ontologyPath, "utf8"),
      "CREATE (:UserOwned);\n",
    );
    assert.equal(
      fs.readFileSync(unknownPath, "utf8"),
      "export const userTool = true;\n",
    );
    const state = readInstalledState(target);
    assert.equal(state.schemaVersion, 1);
    assert.equal(state.manifestVersion, 7);
    assert.equal(
      state.fileHashes[DIALECT_RUNTIME_TARGET],
      crypto.createHash("sha256").update(fs.readFileSync(DIALECT_RUNTIME_SOURCE)).digest("hex"),
    );
    assert.equal(
      typeof state.fileHashes[
        ".context/scripts/lib/ingest/main.mjs"
      ],
      "string",
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
