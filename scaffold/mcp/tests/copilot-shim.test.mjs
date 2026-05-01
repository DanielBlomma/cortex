import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  installCopilotShim,
  uninstallCopilotShim,
  buildCopilotShim,
  isCortexShim,
  SHIM_MARKER,
} from "../dist/cli/run.js";

function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-shim-"));
  const realDir = path.join(dir, "real-bin");
  const shimDir = path.join(dir, "shim-bin");
  fs.mkdirSync(realDir, { recursive: true });
  fs.mkdirSync(shimDir, { recursive: true });
  const realCopilot = path.join(realDir, "copilot");
  fs.writeFileSync(realCopilot, "#!/bin/sh\necho real copilot\n", { mode: 0o755 });
  return {
    dir,
    realDir,
    shimDir,
    realCopilot,
    shimPath: path.join(shimDir, "copilot"),
    searchPath: `${realDir}:${shimDir}`,
  };
}

test("buildCopilotShim: contains SHIM_MARKER and exec line", () => {
  const shim = buildCopilotShim("/usr/bin/copilot");
  assert.ok(shim.startsWith("#!/bin/sh"));
  assert.match(shim, new RegExp(SHIM_MARKER));
  assert.match(shim, /Real binary captured at install time: \/usr\/bin\/copilot/);
  assert.match(shim, /exec "\$CORTEX" run copilot "\$@"/);
});

test("installCopilotShim: writes shim, finds real binary, makes shim executable", () => {
  const ws = makeWorkspace();
  try {
    const result = installCopilotShim({
      shimPath: ws.shimPath,
      searchPath: ws.searchPath,
    });
    assert.equal(result.ok, true, result.message);
    assert.equal(result.realBinary, ws.realCopilot);
    assert.equal(result.shimPath, ws.shimPath);
    assert.equal(isCortexShim(ws.shimPath), true);
    const stat = fs.statSync(ws.shimPath);
    assert.equal(stat.mode & 0o111, 0o111, "shim should be executable");
  } finally {
    fs.rmSync(ws.dir, { recursive: true, force: true });
  }
});

test("installCopilotShim: errors when real binary missing", () => {
  const ws = makeWorkspace();
  try {
    fs.unlinkSync(ws.realCopilot);
    const result = installCopilotShim({
      shimPath: ws.shimPath,
      searchPath: ws.searchPath,
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /not found in PATH/);
  } finally {
    fs.rmSync(ws.dir, { recursive: true, force: true });
  }
});

test("installCopilotShim: refuses to overwrite a non-shim file at shim path", () => {
  const ws = makeWorkspace();
  try {
    fs.writeFileSync(ws.shimPath, "#!/bin/sh\necho not a cortex shim\n", { mode: 0o755 });
    const result = installCopilotShim({
      shimPath: ws.shimPath,
      searchPath: ws.searchPath,
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /not a cortex shim/);
  } finally {
    fs.rmSync(ws.dir, { recursive: true, force: true });
  }
});

test("installCopilotShim: skips a previously-installed shim during PATH search and replaces it cleanly", () => {
  const ws = makeWorkspace();
  try {
    // First install — shim goes to shimDir.
    const first = installCopilotShim({
      shimPath: ws.shimPath,
      searchPath: ws.searchPath,
    });
    assert.equal(first.ok, true);
    // Second install — searchPath now lists shimDir before realDir; install must
    // still find the real binary by skipping its own shim.
    const second = installCopilotShim({
      shimPath: ws.shimPath,
      searchPath: `${ws.shimDir}:${ws.realDir}`,
    });
    assert.equal(second.ok, true, second.message);
    assert.equal(second.realBinary, ws.realCopilot);
  } finally {
    fs.rmSync(ws.dir, { recursive: true, force: true });
  }
});

test("uninstallCopilotShim: removes a cortex shim", () => {
  const ws = makeWorkspace();
  try {
    installCopilotShim({ shimPath: ws.shimPath, searchPath: ws.searchPath });
    assert.equal(fs.existsSync(ws.shimPath), true);
    const result = uninstallCopilotShim(ws.shimPath);
    assert.equal(result.ok, true, result.message);
    assert.equal(fs.existsSync(ws.shimPath), false);
  } finally {
    fs.rmSync(ws.dir, { recursive: true, force: true });
  }
});

test("uninstallCopilotShim: refuses to delete a file that is no longer a cortex shim", () => {
  const ws = makeWorkspace();
  try {
    fs.writeFileSync(ws.shimPath, "#!/bin/sh\necho not a shim anymore\n", { mode: 0o755 });
    const result = uninstallCopilotShim(ws.shimPath);
    assert.equal(result.ok, false);
    assert.match(result.message, /no longer a cortex shim/);
    assert.equal(fs.existsSync(ws.shimPath), true, "should not delete user file");
  } finally {
    fs.rmSync(ws.dir, { recursive: true, force: true });
  }
});

test("uninstallCopilotShim: missing file is a no-op success", () => {
  const ws = makeWorkspace();
  try {
    const result = uninstallCopilotShim(ws.shimPath);
    assert.equal(result.ok, true);
    assert.match(result.message, /already absent/);
  } finally {
    fs.rmSync(ws.dir, { recursive: true, force: true });
  }
});
