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
  expandManagedFiles,
  installManagedScaffold,
  loadCurrentOwnershipManifest,
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
  assert.equal(manifest.manifestVersion, 1);
  assert.deepEqual(manifest.preStateBaselines, ["v2.4.1"]);
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
    assert.equal(readInstalledState(target).manifestVersion, 1);
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
    assert.equal(state.manifestVersion, 1);
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
