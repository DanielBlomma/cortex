import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  CortexFilesystemPolicyError,
  createFilesystemBoundary,
  normalizeConfiguredSource,
  renderFilesystemPolicyError,
  workerPolicyErrorFromMessage
} from "../scaffold/scripts/lib/ingest/filesystem-boundary.mjs";
import {
  collectCandidateFiles,
  parseGitStatusPorcelain
} from "../scaffold/scripts/lib/ingest/files.mjs";
import { generateModuleSummary } from "../scaffold/scripts/lib/ingest/chunks.mjs";
import { parseFilesInWorkers } from "../scaffold/scripts/lib/ingest/workers.mjs";
import { scanBaseline } from "../scripts/dashboard.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INGEST = path.join(REPO_ROOT, "scaffold", "scripts", "ingest.mjs");
const PACKAGED_DASHBOARD = path.join(REPO_ROOT, "scaffold", "scripts", "dashboard.mjs");
const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const FIXED_MTIME = new Date("2026-01-01T00:00:00.000Z");

function makeParent(label) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), `cortex-${label}-`));
  const project = path.join(parent, "project");
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

test("control validation rejects symlinked, directory, and redirected .context layouts", () => {
  for (const variant of ["context-symlink", "context-file", "config-symlink", "rules-directory"]) {
    const { parent, project } = makeParent(`control-${variant}`);
    try {
      const sibling = path.join(parent, "sibling");
      fs.mkdirSync(sibling);
      fs.writeFileSync(path.join(sibling, "config.yaml"), "source_paths:\n  - src\n", "utf8");
      fs.writeFileSync(path.join(sibling, "rules.yaml"), "rules: []\n", "utf8");
      if (variant === "context-symlink") fs.symlinkSync(sibling, path.join(project, ".context"), "dir");
      if (variant === "context-file") fs.writeFileSync(path.join(project, ".context"), "file", "utf8");
      if (variant === "config-symlink" || variant === "rules-directory") {
        writeControls(project);
        if (variant === "config-symlink") {
          fs.rmSync(path.join(project, ".context", "config.yaml"));
          fs.symlinkSync(path.join(sibling, "config.yaml"), path.join(project, ".context", "config.yaml"));
        } else {
          fs.rmSync(path.join(project, ".context", "rules.yaml"));
          fs.mkdirSync(path.join(project, ".context", "rules.yaml"));
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
    "src\\nested"
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

test("hydrated file and ADR identities are validated before existence or reuse", () => {
  const { parent, project } = makeParent("hydration-denial");
  try {
    writeControls(project, ["src"]);
    fs.mkdirSync(path.join(project, "src"));
    const source = path.join(project, "src", "app.js");
    fs.writeFileSync(source, "export const value = 1;\n", "utf8");
    initializeGit(project);
    assert.equal(runIngest(project).status, 0);
    const sibling = path.join(parent, "canary.js");
    fs.writeFileSync(sibling, "SIBLING_CANARY", "utf8");
    fs.writeFileSync(
      path.join(project, ".context", "cache", "entities.file.jsonl"),
      `${JSON.stringify({ id: `file:${sibling}`, path: sibling, content: "cached" })}\n`,
      "utf8"
    );
    fs.appendFileSync(source, "// changed\n", "utf8");
    const result = runIngest(project, ["--changed"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CORTEX_FS_SOURCE.*discovery.*outside_project/);
    assert.doesNotMatch(result.stderr, new RegExp(sibling.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(fs.readFileSync(sibling, "utf8"), "SIBLING_CANARY");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
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
    createFilesystemBoundary(project).statRepositoryFile("src/app.js");
    fs.rmSync(source);
    fs.symlinkSync(canary, source);

    await assert.rejects(
      parseFilesInWorkers([{
        id: "file:src/app.js",
        ext: ".js",
        path: "src/app.js",
        projectRoot: project,
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
  assert.match(rendered, /configured_source="/);
  assert.doesNotMatch(rendered, /\nsecret/);
  assert.equal(rendered.split("\n").length, 1);
  assert.doesNotMatch(rendered, / at |Error:/);
});
