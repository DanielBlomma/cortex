import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runStageCommand } from "../dist/cli/stage.js";

const TINY_WORKFLOW = {
  id: "tiny",
  description: "Two-stage tests workflow",
  version: 1,
  stages: [
    {
      name: "plan",
      artifact: "plan.md",
      reads: [],
      required_fields: [],
      validators: [],
      capability: "planner",
      description: "Produce a plan.",
    },
    {
      name: "review",
      artifact: "review.md",
      reads: ["plan"],
      required_fields: ["approved"],
      validators: [],
      capability: "reviewer",
      description: "Review the plan.",
    },
  ],
};

function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-stage-cli-"));
  process.env.CORTEX_PROJECT_ROOT = dir;
  // cortex stage is enterprise-only; satisfy the gate by writing a
  // minimal enterprise.yml. isEnterpriseProject only requires a
  // non-empty enterprise.api_key field.
  fs.mkdirSync(path.join(dir, ".context"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".context", "enterprise.yml"),
    "enterprise:\n  api_key: test-key-for-cli-tests\n",
    "utf8",
  );
  return dir;
}

function writeSyncedWorkflow(homeDir, workflowId, definition) {
  const cortexDir = path.join(homeDir, ".cortex");
  fs.mkdirSync(cortexDir, { recursive: true });
  fs.writeFileSync(
    path.join(cortexDir, "workflows.local.json"),
    JSON.stringify({
      workflows: {
        [workflowId]: {
          workflow_id: workflowId,
          version: definition.version,
          updated_at: "2026-05-17T10:00:00.000Z",
          definition,
        },
      },
    }),
    "utf8",
  );
}

function setEnforcedMode(projectRoot) {
  fs.writeFileSync(
    path.join(projectRoot, ".context", "govern.local.json"),
    JSON.stringify({
      installs: {
        codex: { mode: "enforced" },
      },
    }),
    "utf8",
  );
}

function captureStdout(run) {
  const original = process.stdout.write.bind(process.stdout);
  let captured = "";
  process.stdout.write = (chunk) => {
    captured += String(chunk);
    return true;
  };
  return run()
    .then((value) => ({ value, captured }))
    .finally(() => {
      process.stdout.write = original;
    });
}

test.afterEach(() => {
  delete process.env.CORTEX_PROJECT_ROOT;
  delete process.env.HOME;
});

test("stage start: creates run + returns first envelope as JSON on stdout", async () => {
  const cwd = makeWorkspace();
  const { captured } = await captureStdout(() =>
    runStageCommand([
      "start",
      "--task-id",
      "task-1",
      "--description",
      "Add login flow",
      "--workflow",
      "secure-build",
    ]),
  );
  const parsed = JSON.parse(captured);
  assert.equal(parsed.state.task_id, "task-1");
  assert.equal(parsed.state.current_stage, "plan");
  assert.equal(parsed.envelope.expectedArtifact, "plan.md");
  assert.equal(parsed.workflow_source, "bundled");
  assert.equal(parsed.warnings.length, 1);
  assert.ok(fs.existsSync(path.join(cwd, ".agents", "task-1", "state.json")));
});

test("stage start: rejects unknown workflow", async () => {
  makeWorkspace();
  await assert.rejects(
    runStageCommand([
      "start",
      "--task-id",
      "task-1",
      "--description",
      "x",
      "--workflow",
      "no-such",
    ]),
    /Available bundled: secure-build/,
  );
});

test("stage start: accepts synced workflow ids from the local cache", async () => {
  makeWorkspace();
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-stage-home-"));
  process.env.HOME = fakeHome;
  writeSyncedWorkflow(fakeHome, "tiny", TINY_WORKFLOW);

  const { captured } = await captureStdout(() =>
    runStageCommand([
      "start",
      "--task-id",
      "task-synced",
      "--description",
      "Use synced workflow",
      "--workflow",
      "tiny",
    ]),
  );
  const parsed = JSON.parse(captured);
  assert.equal(parsed.state.workflow_id, "tiny");
  assert.equal(parsed.workflow_source, "synced");
  assert.deepEqual(parsed.warnings, []);
});

test("stage start: blocks bundled workflow fallback in enforced mode", async () => {
  const cwd = makeWorkspace();
  setEnforcedMode(cwd);

  await assert.rejects(
    runStageCommand([
      "start",
      "--task-id",
      "task-enforced",
      "--description",
      "Use bundled fallback",
      "--workflow",
      "secure-build",
    ]),
    /requires a synced org workflow/,
  );
});

test("stage start: rejects missing required flags", async () => {
  makeWorkspace();
  await assert.rejects(
    runStageCommand(["start", "--task-id", "task-1"]),
    /Missing required flag: --description/,
  );
});

test("stage status: prints state when run exists", async () => {
  makeWorkspace();
  await runStageCommand([
    "start",
    "--task-id",
    "task-1",
    "--description",
    "x",
  ]);
  const { captured } = await captureStdout(() =>
    runStageCommand(["status", "--task-id", "task-1"]),
  );
  const parsed = JSON.parse(captured);
  assert.equal(parsed.state.task_id, "task-1");
  assert.equal(parsed.state.outcome, "in_progress");
});

test("stage status: returns null state when no run exists", async () => {
  makeWorkspace();
  const { captured } = await captureStdout(() =>
    runStageCommand(["status", "--task-id", "ghost"]),
  );
  const parsed = JSON.parse(captured);
  assert.equal(parsed.state, null);
});

test("stage envelope: returns current envelope without mutating state", async () => {
  makeWorkspace();
  await runStageCommand([
    "start",
    "--task-id",
    "task-1",
    "--description",
    "x",
  ]);
  const { captured } = await captureStdout(() =>
    runStageCommand(["envelope", "--task-id", "task-1"]),
  );
  const parsed = JSON.parse(captured);
  assert.equal(parsed.envelope.expectedArtifact, "plan.md");
});

test("stage advance: writes artifact + advances run via body file", async () => {
  const cwd = makeWorkspace();
  await runStageCommand([
    "start",
    "--task-id",
    "task-1",
    "--description",
    "x",
  ]);

  const bodyPath = path.join(cwd, "plan-body.md");
  fs.writeFileSync(bodyPath, "# Plan\n\n1. Step\n2. Step", "utf8");
  const fmPath = path.join(cwd, "plan-fm.json");
  fs.writeFileSync(
    fmPath,
    JSON.stringify({ files_targeted: ["src/login.ts"], constraints: [] }),
    "utf8",
  );

  const { captured } = await captureStdout(() =>
    runStageCommand([
      "advance",
      "--task-id",
      "task-1",
      "--stage",
      "plan",
      "--body-file",
      bodyPath,
      "--frontmatter-file",
      fmPath,
    ]),
  );
  const parsed = JSON.parse(captured);
  assert.equal(parsed.state.current_stage, "plan-review");
  assert.ok(parsed.next_envelope, "next_envelope present while run is in_progress");
  assert.equal(parsed.next_envelope.expectedArtifact, "plan-review.md");
  assert.ok(fs.existsSync(path.join(cwd, ".agents", "task-1", "plan.md")));
});

test("stage advance: blocked status halts the run and returns null next envelope", async () => {
  const cwd = makeWorkspace();
  await runStageCommand([
    "start",
    "--task-id",
    "task-1",
    "--description",
    "x",
  ]);

  const bodyPath = path.join(cwd, "blocked.md");
  fs.writeFileSync(bodyPath, "# Plan blocked\n\nMissing context.", "utf8");

  const { captured } = await captureStdout(() =>
    runStageCommand([
      "advance",
      "--task-id",
      "task-1",
      "--stage",
      "plan",
      "--body-file",
      bodyPath,
      "--status",
      "blocked",
    ]),
  );
  const parsed = JSON.parse(captured);
  assert.equal(parsed.state.outcome, "blocked");
  assert.equal(parsed.next_envelope, null);
});

test("stage advance: rejects malformed frontmatter file", async () => {
  const cwd = makeWorkspace();
  await runStageCommand([
    "start",
    "--task-id",
    "task-1",
    "--description",
    "x",
  ]);

  const bodyPath = path.join(cwd, "body.md");
  fs.writeFileSync(bodyPath, "# Body", "utf8");
  const badFm = path.join(cwd, "bad-fm.json");
  fs.writeFileSync(badFm, "[1, 2, 3]", "utf8");

  await assert.rejects(
    runStageCommand([
      "advance",
      "--task-id",
      "task-1",
      "--stage",
      "plan",
      "--body-file",
      bodyPath,
      "--frontmatter-file",
      badFm,
    ]),
    /Expected JSON object/,
  );
});

test("stage run: rejects when no command after --", async () => {
  makeWorkspace();
  await runStageCommand([
    "start",
    "--task-id",
    "task-1",
    "--description",
    "x",
  ]);
  await assert.rejects(
    runStageCommand(["run", "--task-id", "task-1"]),
    /requires a command after --/,
  );
});

test("stage run: rejects when run is not in progress", async () => {
  const cwd = makeWorkspace();
  await runStageCommand([
    "start",
    "--task-id",
    "task-1",
    "--description",
    "x",
  ]);
  // Corrupt state to simulate a finished run.
  const statePath = path.join(cwd, ".agents", "task-1", "state.json");
  const raw = JSON.parse(fs.readFileSync(statePath, "utf8"));
  raw.outcome = "complete";
  raw.current_stage = null;
  raw.completed_at = new Date().toISOString();
  fs.writeFileSync(statePath, JSON.stringify(raw, null, 2));

  await assert.rejects(
    runStageCommand(["run", "--task-id", "task-1", "--", "echo", "hello"]),
    /not in progress/,
  );
});

test("stage run: spawns subprocess with CORTEX_ACTIVE_TASK_ID set", async () => {
  const cwd = makeWorkspace();
  await runStageCommand([
    "start",
    "--task-id",
    "task-1",
    "--description",
    "x",
  ]);

  const outPath = path.join(cwd, "env-dump.txt");
  // Use node -e to write CORTEX_ACTIVE_TASK_ID into a file we can inspect.
  await runStageCommand([
    "run",
    "--task-id",
    "task-1",
    "--",
    "node",
    "-e",
    `require("fs").writeFileSync(${JSON.stringify(outPath)}, process.env.CORTEX_ACTIVE_TASK_ID || "<unset>")`,
  ]);

  const written = fs.readFileSync(outPath, "utf8");
  assert.equal(written, "task-1");
});

test("stage help: prints help text and returns without throwing", async () => {
  const { captured } = await captureStdout(() => runStageCommand(["help"]));
  assert.match(captured, /Usage:/);
  assert.match(captured, /cortex stage start/);
  assert.match(captured, /cortex stage run/);
});

test("stage <unknown>: throws with help text", async () => {
  makeWorkspace();
  await assert.rejects(runStageCommand(["frobnicate"]), /Unknown stage subcommand/);
});

test("stage start: blocked in community mode (no enterprise.yml)", async () => {
  // Bypass the helper that auto-writes enterprise.yml.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-stage-cli-community-"));
  process.env.CORTEX_PROJECT_ROOT = dir;
  try {
    await assert.rejects(
      runStageCommand([
        "start",
        "--task-id",
        "task-1",
        "--description",
        "x",
      ]),
      /Cortex Harness — an enterprise-only feature/,
    );
  } finally {
    delete process.env.CORTEX_PROJECT_ROOT;
  }
});

test("stage help: still prints in community mode (so users discover the feature)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-stage-cli-community-help-"));
  process.env.CORTEX_PROJECT_ROOT = dir;
  try {
    const { captured } = await captureStdout(() => runStageCommand(["help"]));
    assert.match(captured, /Usage:/);
  } finally {
    delete process.env.CORTEX_PROJECT_ROOT;
  }
});
