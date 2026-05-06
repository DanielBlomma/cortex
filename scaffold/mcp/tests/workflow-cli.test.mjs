import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runStageCommand } from "../dist/cli/stage.js";

function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-stage-cli-"));
  process.env.CORTEX_PROJECT_ROOT = dir;
  return dir;
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
    /Unknown workflow_id/,
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
  await assert.rejects(runStageCommand(["frobnicate"]), /Unknown stage subcommand/);
});
