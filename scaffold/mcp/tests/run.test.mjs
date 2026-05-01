import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  isCortexShim,
  findRealBinary,
  buildDarwinSandboxProfile,
  buildLinuxBwrapArgs,
  SHIM_MARKER,
  RUN_CLIS,
  runAiCli,
} from "../dist/cli/run.js";

function makeBinDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cortex-run-"));
}

test("RUN_CLIS lists exactly claude, codex, copilot", () => {
  assert.deepEqual(RUN_CLIS.sort(), ["claude", "codex", "copilot"]);
});

test("isCortexShim: detects shim marker", () => {
  const dir = makeBinDir();
  try {
    const shim = path.join(dir, "fake-shim");
    fs.writeFileSync(shim, `#!/bin/sh\n${SHIM_MARKER}\nexec real "$@"\n`, { mode: 0o755 });
    assert.equal(isCortexShim(shim), true);

    const notShim = path.join(dir, "real-bin");
    fs.writeFileSync(notShim, "#!/bin/sh\necho hi\n");
    assert.equal(isCortexShim(notShim), false);

    assert.equal(isCortexShim(path.join(dir, "missing")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("findRealBinary: returns path to executable; skips cortex shims and exclusion list", () => {
  const dir1 = makeBinDir();
  const dir2 = makeBinDir();
  try {
    const shimPath = path.join(dir1, "copilot");
    fs.writeFileSync(shimPath, `#!/bin/sh\n${SHIM_MARKER}\nexec /opt/copilot "$@"\n`, { mode: 0o755 });
    const realPath = path.join(dir2, "copilot");
    fs.writeFileSync(realPath, "#!/bin/sh\necho real\n", { mode: 0o755 });

    const origPath = process.env.PATH;
    process.env.PATH = `${dir1}:${dir2}`;
    try {
      assert.equal(findRealBinary("copilot"), realPath);
      assert.equal(findRealBinary("copilot", [shimPath]), realPath);
      assert.equal(findRealBinary("copilot", [shimPath, realPath]), null);
      assert.equal(findRealBinary("nonexistent"), null);
    } finally {
      process.env.PATH = origPath;
    }
  } finally {
    fs.rmSync(dir1, { recursive: true, force: true });
    fs.rmSync(dir2, { recursive: true, force: true });
  }
});

test("buildDarwinSandboxProfile: denies writes to copilot config locations", () => {
  const profile = buildDarwinSandboxProfile("/Users/dan");
  assert.match(profile, /\(version 1\)/);
  assert.match(profile, /\(allow default\)/);
  assert.match(profile, /\(deny file-write\* \(subpath "\/Users\/dan\/\.copilot"\)\)/);
  assert.match(profile, /\(deny file-write\* \(subpath "\/Users\/dan\/\.copilot\.local"\)\)/);
  assert.match(profile, /\(deny file-write\* \(regex #"\^\/etc\/copilot"\)\)/);
});

test("buildLinuxBwrapArgs: tmpfs-mounts copilot config dirs and binds home", () => {
  const args = buildLinuxBwrapArgs("/home/dan", "/usr/local/bin/copilot", ["--prompt", "hi"]);
  assert.ok(args.includes("--die-with-parent"), "should die with parent");
  const tmpfsCount = args.filter((a) => a === "--tmpfs").length;
  assert.equal(tmpfsCount, 2, "should tmpfs both ~/.copilot and ~/.copilot.local");
  assert.ok(args.includes("/home/dan/.copilot"));
  assert.ok(args.includes("/home/dan/.copilot.local"));
  // Real binary + args after `--`
  const dashIdx = args.indexOf("--");
  assert.ok(dashIdx > 0);
  assert.equal(args[dashIdx + 1], "/usr/local/bin/copilot");
  assert.deepEqual(args.slice(dashIdx + 2), ["--prompt", "hi"]);
});

test("runAiCli: claude/codex passthrough exec with provided realBinary", async () => {
  // Use /bin/echo as a safe stand-in: it exists everywhere, prints args, exits 0.
  const exit = await runAiCli({
    cli: "claude",
    args: ["hello", "world"],
    realBinary: "/bin/echo",
  });
  assert.equal(exit, 0);
});

test("runAiCli: missing binary returns 127", async () => {
  const orig = process.env.PATH;
  process.env.PATH = "";
  try {
    const exit = await runAiCli({ cli: "claude", args: [] });
    assert.equal(exit, 127);
  } finally {
    process.env.PATH = orig;
  }
});
