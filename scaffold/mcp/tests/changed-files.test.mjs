import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { resolveChangedReviewFiles } from "../dist/enterprise/reviews/changed-files.js";

function git(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

test("lists staged and untracked files in a repo without commits", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-changed-files-"));
  try {
    git(projectRoot, ["init"]);
    fs.writeFileSync(path.join(projectRoot, ".gitignore"), "ignored.ts\n", "utf8");
    fs.writeFileSync(path.join(projectRoot, "staged.ts"), "export const a = 1;\n", "utf8");
    fs.writeFileSync(path.join(projectRoot, "untracked.ts"), "export const b = 2;\n", "utf8");
    fs.writeFileSync(path.join(projectRoot, "ignored.ts"), "ignored\n", "utf8");
    git(projectRoot, ["add", ".gitignore", "staged.ts"]);

    assert.deepEqual(resolveChangedReviewFiles(projectRoot), [
      ".gitignore",
      "staged.ts",
      "untracked.ts",
    ]);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("returns null outside a git work tree", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-changed-files-plain-"));
  try {
    fs.writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n", "utf8");
    assert.equal(resolveChangedReviewFiles(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
