import test from "node:test";
import assert from "node:assert/strict";

import {
  detectUngoverned,
  enforceFinding,
  isCortexAncestor,
  parseProcessLine,
  DEFAULT_AI_BINARIES,
} from "../dist/cli/ungoverned-detector.js";

function p(pid, ppid, user, comm, args = "") {
  return { pid, ppid, user, comm, args: args || comm };
}

test("DEFAULT_AI_BINARIES covers known agentic CLIs", () => {
  for (const cli of ["claude", "codex", "copilot", "gemini-cli", "aider", "cursor"]) {
    assert.ok(DEFAULT_AI_BINARIES.includes(cli), `expected ${cli} in defaults`);
  }
});

test("isCortexAncestor recognises common cortex invocations", () => {
  assert.equal(isCortexAncestor("cortex run copilot --prompt hi"), true);
  assert.equal(isCortexAncestor("cortex enterprise ent_xxx"), true);
  assert.equal(isCortexAncestor("cortex daemon"), true);
  assert.equal(isCortexAncestor("cortex hook pre-tool-use"), true);
  assert.equal(isCortexAncestor("/usr/bin/cortex run claude"), true);
  assert.equal(isCortexAncestor("node /Users/dan/.npm-global/lib/node_modules/@x/bin/cortex.mjs"), true);
  assert.equal(isCortexAncestor("/usr/bin/zsh"), false);
  assert.equal(isCortexAncestor("npm run dev"), false);
  assert.equal(isCortexAncestor(""), false);
});

test("parseProcessLine handles ps -axo output with multi-word args", () => {
  const line = "  1234   100  alice    claude       claude --prompt hello world";
  const proc = parseProcessLine(line);
  assert.deepEqual(proc, {
    pid: 1234,
    ppid: 100,
    user: "alice",
    comm: "claude",
    args: "claude --prompt hello world",
  });
});

test("parseProcessLine returns null for malformed lines", () => {
  assert.equal(parseProcessLine(""), null);
  assert.equal(parseProcessLine("garbage"), null);
});

test("detectUngoverned: AI CLI with shell parent is flagged", () => {
  const procs = [
    p(1, 0, "root", "/sbin/launchd", "/sbin/launchd"),
    p(100, 1, "alice", "zsh", "-zsh"),
    p(200, 100, "alice", "claude", "claude --prompt hi"),
  ];
  const findings = detectUngoverned({ processes: procs, hostId: "test-host" });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].cli, "claude");
  assert.equal(findings[0].pid, 200);
  assert.equal(findings[0].host_id, "test-host");
});

test("detectUngoverned: AI CLI spawned via 'cortex run' is NOT flagged", () => {
  const procs = [
    p(1, 0, "root", "/sbin/launchd", "/sbin/launchd"),
    p(100, 1, "alice", "zsh", "-zsh"),
    p(150, 100, "alice", "node", "node /usr/local/bin/cortex run copilot --prompt hi"),
    p(160, 150, "alice", "sandbox-exec", "sandbox-exec -f /tmp/copilot.sb /usr/local/bin/copilot --prompt hi"),
    p(170, 160, "alice", "copilot", "copilot --prompt hi"),
  ];
  const findings = detectUngoverned({ processes: procs });
  assert.equal(findings.length, 0, "copilot should be governed via cortex run ancestor");
});

test("detectUngoverned: AI CLI with shim invocation in own args is recognised", () => {
  // The shim execs cortex run; after exec the process args show 'cortex run copilot ...'
  const procs = [
    p(100, 1, "alice", "cortex", "/usr/bin/cortex run copilot --prompt hi"),
    p(110, 100, "alice", "copilot", "/path/to/copilot --prompt hi"),
  ];
  const findings = detectUngoverned({ processes: procs });
  assert.equal(findings.length, 0);
});

test("detectUngoverned: ignores non-AI binaries", () => {
  const procs = [
    p(100, 1, "alice", "zsh", "-zsh"),
    p(200, 100, "alice", "node", "node app.js"),
    p(300, 100, "alice", "python", "python script.py"),
  ];
  const findings = detectUngoverned({ processes: procs });
  assert.equal(findings.length, 0);
});

test("detectUngoverned: handles deep parent chain without exploding", () => {
  // 50-deep chain ending in shell. Should be flagged once.
  const procs = [];
  for (let i = 1; i <= 50; i++) {
    procs.push(p(i, i - 1, "alice", `intermediate${i}`, `intermediate${i}`));
  }
  procs.push(p(999, 50, "alice", "claude", "claude --prompt hi"));
  const findings = detectUngoverned({ processes: procs });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].pid, 999);
});

test("detectUngoverned: custom knownBinaries list", () => {
  const procs = [
    p(100, 1, "alice", "claude", "claude --prompt hi"),
    p(200, 1, "alice", "myllm", "myllm --prompt hi"),
  ];
  const findings = detectUngoverned({
    processes: procs,
    knownBinaries: ["myllm"],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].cli, "myllm");
});

test("enforceFinding: advisory mode never sends signal", () => {
  let signalled = null;
  const action = enforceFinding(
    {
      pid: 100,
      ppid: 1,
      user: "alice",
      cli: "claude",
      binary: "claude",
      args: "claude",
      parent_chain: [100],
      detected_at: new Date().toISOString(),
      host_id: "h",
    },
    {
      mode: "advisory",
      sendSignal: (pid, sig) => {
        signalled = [pid, sig];
      },
      currentUser: "alice",
    },
  );
  assert.equal(action, "logged");
  assert.equal(signalled, null);
});

test("enforceFinding: enforced mode SIGTERMs same-user processes only", () => {
  let signalled = null;
  const send = (pid, sig) => {
    signalled = [pid, sig];
  };
  const action = enforceFinding(
    {
      pid: 100,
      ppid: 1,
      user: "alice",
      cli: "claude",
      binary: "claude",
      args: "claude",
      parent_chain: [100],
      detected_at: new Date().toISOString(),
      host_id: "h",
    },
    { mode: "enforced", sendSignal: send, currentUser: "alice" },
  );
  assert.equal(action, "sigterm");
  assert.deepEqual(signalled, [100, "SIGTERM"]);
});

test("enforceFinding: cross-user finding is skipped (would require root)", () => {
  let signalled = null;
  const send = (pid, sig) => {
    signalled = [pid, sig];
  };
  const action = enforceFinding(
    {
      pid: 100,
      ppid: 1,
      user: "bob",
      cli: "claude",
      binary: "claude",
      args: "claude",
      parent_chain: [100],
      detected_at: new Date().toISOString(),
      host_id: "h",
    },
    { mode: "enforced", sendSignal: send, currentUser: "alice" },
  );
  assert.equal(action, "skipped_cross_user");
  assert.equal(signalled, null);
});
