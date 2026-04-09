import test from "node:test";
import assert from "node:assert/strict";
import { windowsToWslPath, normalizeProjectRoot, isWSL } from "../bin/wsl.mjs";

test("windowsToWslPath converts backslash Windows path", () => {
  assert.equal(windowsToWslPath("C:\\Users\\foo\\bar"), "/mnt/c/Users/foo/bar");
});

test("windowsToWslPath converts forward-slash Windows path", () => {
  assert.equal(windowsToWslPath("D:/projects/cortex"), "/mnt/d/projects/cortex");
});

test("windowsToWslPath handles mixed separators", () => {
  assert.equal(windowsToWslPath("E:\\repos/my-project\\src"), "/mnt/e/repos/my-project/src");
});

test("windowsToWslPath lowercases drive letter", () => {
  assert.equal(windowsToWslPath("F:\\Data"), "/mnt/f/Data");
});

test("windowsToWslPath strips trailing slashes", () => {
  assert.equal(windowsToWslPath("C:\\Users\\foo\\"), "/mnt/c/Users/foo");
  assert.equal(windowsToWslPath("C:\\Users\\foo\\\\"), "/mnt/c/Users/foo");
});

test("windowsToWslPath returns POSIX path unchanged", () => {
  assert.equal(windowsToWslPath("/home/user/project"), "/home/user/project");
});

test("windowsToWslPath returns WSL /mnt/ path unchanged", () => {
  assert.equal(windowsToWslPath("/mnt/c/Users/foo"), "/mnt/c/Users/foo");
});

test("windowsToWslPath returns relative path unchanged", () => {
  assert.equal(windowsToWslPath("src/main.rs"), "src/main.rs");
});

test("windowsToWslPath handles drive root", () => {
  assert.equal(windowsToWslPath("C:\\"), "/mnt/c/");
});

test("isWSL returns false on macOS/non-WSL Linux", () => {
  // On macOS, /proc/version does not exist so isWSL returns false.
  // On native Linux, /proc/version exists but doesn't contain "microsoft".
  // This test verifies the function runs without error on the test platform.
  const result = isWSL();
  assert.equal(typeof result, "boolean");
});

test("normalizeProjectRoot returns POSIX path unchanged regardless of WSL", () => {
  assert.equal(normalizeProjectRoot("/home/user/project"), "/home/user/project");
  assert.equal(normalizeProjectRoot("/mnt/c/Users/foo"), "/mnt/c/Users/foo");
});

test("normalizeProjectRoot handles relative paths", () => {
  assert.equal(normalizeProjectRoot("./my-project"), "./my-project");
});
