import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { runNetworkDenied, webSmoke } from "../scripts/release-artifacts.mjs";

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


async function webProcessFixture(t, mode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-release-web-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = path.join(root, "web.mjs");
  fs.writeFileSync(fixture, `
    import fs from "node:fs";
    import http from "node:http";
    import { spawn } from "node:child_process";
    const root = process.env.WEB_FIXTURE_ROOT;
    const mode = process.env.WEB_FIXTURE_MODE;
    if (process.argv[2] !== "worker") {
      fs.writeFileSync(root + "/parent", String(process.pid));
      const worker = spawn(process.execPath, [import.meta.filename, "worker"], {
        stdio: "inherit", env: process.env,
      });
      process.on("SIGINT", () => {});
      worker.on("exit", (code) => process.exit(code ?? 1));
    } else {
      fs.writeFileSync(root + "/worker", String(process.pid));
      if (mode === "before-bind") process.exit(17);
      const server = http.createServer((request, response) => {
        if (mode === "broken-http") { request.socket.destroy(); return; }
        response.statusCode = mode === "bad-http" ? 503 : 200;
        response.end("fixture Web profile");
      });
      server.listen(0, "127.0.0.1", () => {
        console.log("http://127.0.0.1:" + server.address().port);
      });
      process.on("SIGINT", () => {
        fs.writeFileSync(root + "/interrupted", "SIGINT");
        if (mode === "stubborn") return;
        server.close(() => {
          fs.writeFileSync(root + "/disposed", "server closed");
          process.exit(130);
        });
        server.closeAllConnections();
      });
    }
  `);
  const run = () => webSmoke(process.execPath, [fixture], {
    ...process.env, WEB_FIXTURE_ROOT: root, WEB_FIXTURE_MODE: mode,
  }, root);
  const assertStopped = async () => {
    for (const name of ["parent", "worker"]) {
      const pid = Number(fs.readFileSync(path.join(root, name), "utf8"));
      let present = true;
      for (let attempt = 0; attempt < 100 && present; attempt += 1) {
        try { process.kill(pid, 0); } catch (error) {
          assert.equal(error.code, "ESRCH");
          present = false;
        }
        if (present) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(present, false, `${name} process ${pid} survived Web smoke`);
    }
  };
  return { root, run, assertStopped };
}

test("Web lifecycle signals the owned wrapper and server and observes graceful disposal", {
  skip: process.platform === "win32",
}, async (t) => {
  const fixture = await webProcessFixture(t, "graceful");
  const result = await fixture.run();
  assert.equal(result.status, 200);
  assert.deepEqual(result.outcome, { code: 130, signal: null });
  assert.equal(fs.readFileSync(path.join(fixture.root, "interrupted"), "utf8"), "SIGINT");
  assert.equal(fs.readFileSync(path.join(fixture.root, "disposed"), "utf8"), "server closed");
  await assert.rejects(fetch(result.url, { signal: AbortSignal.timeout(1_000) }));
  await fixture.assertStopped();
});

for (const [mode, diagnostic] of [
  ["before-bind", /exited before binding/],
  ["bad-http", /returned HTTP 503/],
  ["broken-http", /fetch failed/],
  ["stubborn", /did not stop within 10 seconds after SIGINT/],
]) {
  test(`Web lifecycle rejects ${mode} and cleans up its process tree`, {
    skip: process.platform === "win32",
  }, async (t) => {
    const fixture = await webProcessFixture(t, mode);
    await assert.rejects(fixture.run(), diagnostic);
    await fixture.assertStopped();
    if (mode === "stubborn") {
      assert.equal(fs.readFileSync(path.join(fixture.root, "interrupted"), "utf8"), "SIGINT");
      assert.equal(fs.existsSync(path.join(fixture.root, "disposed")), false);
    }
  });
}
