import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runValidators } from "../dist/core/validators/engine.js";
import "../dist/core/validators/builtins.js";

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-review-validator-"));
  const contextDir = path.join(root, ".context");
  fs.mkdirSync(contextDir, { recursive: true });
  return { root, contextDir };
}

test("require-code-review reports source none when no evidence exists", async () => {
  const { root, contextDir } = makeProject();
  const result = await runValidators(
    new Set(["require-code-review"]),
    { projectRoot: root, contextDir, changedFiles: [] },
    {},
  );

  assert.equal(result.results[0].pass, false);
  assert.match(result.results[0].detail ?? "", /Source: none/);
});

test("require-code-review reports workflow state as the evidence source", async () => {
  const { root, contextDir } = makeProject();
  fs.mkdirSync(path.join(contextDir, "workflow"), { recursive: true });
  fs.writeFileSync(
    path.join(contextDir, "workflow", "state.json"),
    JSON.stringify({
      last_review: {
        status: "passed",
        reviewed_at: "2026-05-17T10:00:00.000Z",
        reviewed_files: [],
      },
    }),
    "utf8",
  );

  const result = await runValidators(
    new Set(["require-code-review"]),
    { projectRoot: root, contextDir, changedFiles: [] },
    {},
  );

  assert.equal(result.results[0].pass, true);
  assert.match(result.results[0].detail ?? "", /Source: workflow state/);
});
