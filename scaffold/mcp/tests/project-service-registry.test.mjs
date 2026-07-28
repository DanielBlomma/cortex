import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  normalizeProjectCwd,
  ProjectServiceRegistry,
} from "../dist/daemon/project-service-registry.js";

function makeProject() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-daemon-project-"));
  fs.mkdirSync(path.join(cwd, ".context"));
  return cwd;
}

test("ProjectServiceRegistry: registers each normalized project exactly once", async () => {
  const first = makeProject();
  const second = makeProject();
  const created = [];
  const stopped = [];
  const registry = new ProjectServiceRegistry((cwd) => {
    created.push(cwd);
    return [{
      stop() {
        stopped.push(cwd);
      },
    }];
  });

  try {
    assert.equal(registry.register(first), true);
    assert.equal(registry.register(path.join(first, ".")), false);
    assert.equal(registry.register(second), true);
    assert.equal(registry.size(), 2);
    assert.deepEqual(
      registry.projectCwds().sort(),
      [fs.realpathSync(first), fs.realpathSync(second)].sort(),
    );
    assert.deepEqual(created.sort(), registry.projectCwds().sort());

    await registry.stopAll();
    assert.equal(registry.size(), 0);
    assert.deepEqual(stopped.sort(), created.sort());
  } finally {
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  }
});

test("ProjectServiceRegistry: ignores roots without a Cortex context directory", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-daemon-project-"));
  let factoryCalls = 0;
  const registry = new ProjectServiceRegistry(() => {
    factoryCalls += 1;
    return [];
  });

  try {
    assert.equal(registry.register(cwd), false);
    assert.equal(registry.register(path.join(cwd, "missing")), false);
    assert.equal(registry.register(""), false);
    assert.equal(registry.size(), 0);
    assert.equal(factoryCalls, 0);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("normalizeProjectCwd: returns a physical Cortex project root", () => {
  const cwd = makeProject();
  try {
    assert.equal(
      normalizeProjectCwd(path.join(cwd, ".")),
      fs.realpathSync(cwd),
    );
    assert.equal(normalizeProjectCwd(path.join(cwd, "missing")), null);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("ProjectServiceRegistry: resolves project symlinks to one service identity", {
  skip: process.platform === "win32",
}, () => {
  const cwd = makeProject();
  const linkRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-daemon-link-"));
  const linked = path.join(linkRoot, "project");
  fs.symlinkSync(cwd, linked, "dir");
  const registry = new ProjectServiceRegistry(() => []);

  try {
    assert.equal(registry.register(linked), true);
    assert.equal(registry.register(cwd), false);
    assert.equal(registry.size(), 1);
    assert.equal(registry.has(cwd), true);
  } finally {
    fs.rmSync(linkRoot, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("ProjectServiceRegistry: starts host-wide services once for projects sharing one Enterprise identity", async () => {
  const first = makeProject();
  const second = makeProject();
  const hostStarts = [];
  const projectStarts = [];
  const registry = new ProjectServiceRegistry(
    (cwd) => {
      projectStarts.push(cwd);
      return [];
    },
    {
      credentialIdForCwd: () => "same-identity",
      hostFactory: (cwd, credentialId) => {
        hostStarts.push({ cwd, credentialId });
        return [];
      },
    },
  );

  try {
    assert.equal(registry.register(first), true);
    assert.equal(registry.register(second), true);
    assert.equal(hostStarts.length, 1);
    assert.equal(hostStarts[0].cwd, fs.realpathSync(first));
    assert.equal(hostStarts[0].credentialId, "same-identity");
    assert.deepEqual(
      projectStarts.sort(),
      [fs.realpathSync(first), fs.realpathSync(second)].sort(),
    );
  } finally {
    await registry.stopAll();
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  }
});

test("ProjectServiceRegistry: rejects a second Enterprise identity before starting project or host services", async () => {
  const first = makeProject();
  const second = makeProject();
  let hostStarts = 0;
  let projectStarts = 0;
  const registry = new ProjectServiceRegistry(
    () => {
      projectStarts += 1;
      return [];
    },
    {
      credentialIdForCwd: (cwd) =>
        cwd === fs.realpathSync(first) ? "identity-a" : "identity-b",
      hostFactory: () => {
        hostStarts += 1;
        return [];
      },
    },
  );

  try {
    assert.equal(registry.register(first), true);
    assert.equal(registry.register(second), false);
    assert.equal(registry.size(), 1);
    assert.equal(hostStarts, 1);
    assert.equal(projectStarts, 1);
    assert.equal(registry.activeCredentialId(), "identity-a");
  } finally {
    await registry.stopAll();
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  }
});
