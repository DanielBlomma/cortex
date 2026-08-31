import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { runNetworkDenied } from "../scripts/release-artifacts.mjs";

function readText(relative) {
  return fs.readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8");
}

test("Linux Harness network isolation drops back to the invoking identity", {
  skip: process.platform !== "linux",
}, () => {
  for (const executable of ["/usr/bin/sudo", "/usr/bin/unshare", "/usr/bin/setpriv"]) {
    assert.equal(fs.existsSync(executable), true, `missing fail-closed Linux prerequisite ${executable}`);
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-release-identity-"));
  const home = path.join(root, "home");
  const dshHome = path.join(root, "dsh-home");
  fs.mkdirSync(home);
  fs.mkdirSync(dshHome);
  try {
    const program = `
      import fs from "node:fs";
      const sessions = process.env.DSH_HOME + "/sessions";
      fs.mkdirSync(sessions, { recursive: true, mode: 0o700 });
      fs.readdirSync(sessions);
      const status = fs.readFileSync("/proc/self/status", "utf8");
      let networkDenied = false;
      try {
        await fetch("https://registry.npmjs.org", { signal: AbortSignal.timeout(2000) });
      } catch {
        networkDenied = true;
      }
      process.stdout.write(JSON.stringify({
        uid: process.getuid(),
        gid: process.getgid(),
        home: process.env.HOME,
        dshHome: process.env.DSH_HOME,
        path: process.env.PATH,
        telemetryDisabled: process.env.DSH_TELEMETRY_DISABLED,
        boundaryAttested: process.env.CORTEX_RELEASE_NETWORK_DENIED,
        leakedNodeAuth: process.env.NODE_AUTH_TOKEN,
        leakedNpmToken: process.env.NPM_TOKEN,
        networkDenied,
        capEff: status.match(/^CapEff:\\s+([0-9a-f]+)$/mi)?.[1],
        noNewPrivs: status.match(/^NoNewPrivs:\\s+(\\d+)$/mi)?.[1],
      }));
    `;
    const output = runNetworkDenied(
      process.execPath,
      ["--input-type=module", "--eval", program],
      {
        cwd: root,
        env: {
          ...process.env,
          HOME: home,
          DSH_HOME: dshHome,
          DSH_TELEMETRY_DISABLED: "1",
          NODE_AUTH_TOKEN: "must-not-reach-child",
          NPM_TOKEN: "must-not-reach-child",
        },
        timeout: 10_000,
      },
    );
    const evidence = JSON.parse(output);
    assert.equal(evidence.uid, process.getuid());
    assert.equal(evidence.gid, process.getgid());
    assert.equal(evidence.home, home);
    assert.equal(evidence.dshHome, dshHome);
    assert.equal(evidence.path, "/nonexistent");
    assert.equal(evidence.telemetryDisabled, "1");
    assert.equal(evidence.boundaryAttested, "1");
    assert.equal(evidence.leakedNodeAuth, undefined);
    assert.equal(evidence.leakedNpmToken, undefined);
    assert.equal(evidence.networkDenied, true);
    assert.match(evidence.capEff, /^0+$/);
    assert.equal(evidence.noNewPrivs, "1");
    const sessions = path.join(dshHome, "sessions");
    assert.equal(fs.statSync(sessions).uid, process.getuid());
    assert.equal(fs.statSync(sessions).gid, process.getgid());
    assert.deepEqual(fs.readdirSync(sessions), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Linux Harness isolation uses a numeric fail-closed privilege drop without permission repair", () => {
  const source = readText("scripts/release-artifacts.mjs");
  assert.match(source, /fs\.existsSync\("\/usr\/bin\/setpriv"\)/);
  assert.match(source, /`--reuid=\$\{uid\}`/);
  assert.match(source, /`--regid=\$\{gid\}`/);
  assert.match(source, /"--clear-groups"/);
  assert.match(source, /"--no-new-privs"/);
  assert.match(source, /"--bounding-set=-all"/);
  assert.match(source, /uid <= 0 \|\| gid <= 0/);
  assert.doesNotMatch(source, /chmodSync|chownSync|\bchmod\b|\bchown\b/);
});
