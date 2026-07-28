import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  runSkillSyncForCli as runSkillSyncForCliImpl,
  runSkillSyncOnce as runSkillSyncOnceImpl,
} from "../dist/daemon/skill-sync-checker.js";
import { enterpriseCredentialId } from "../dist/core/license.js";
import { claimEnterpriseHostIdentity } from "../dist/core/enterprise-host-identity.js";

const TEST_ENDPOINT = "https://example.com";
const TEST_API_KEY = "ent_test_12345678";

function enrollTestIdentity() {
  assert.equal(
    claimEnterpriseHostIdentity(
      enterpriseCredentialId(TEST_ENDPOINT, TEST_API_KEY),
      TEST_ENDPOINT,
    ),
    true,
  );
}

async function runSkillSyncForCli(cwd, cli) {
  enrollTestIdentity();
  return runSkillSyncForCliImpl(cwd, cli);
}

async function runSkillSyncOnce(cwd, clis) {
  enrollTestIdentity();
  return runSkillSyncOnceImpl(cwd, clis);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillFixture = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "./fixtures/org-skillz-contract.json"),
    "utf8",
  ),
);

function makeWorkspace() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-skill-sync-"));
  const contextDir = path.join(cwd, ".context");
  fs.mkdirSync(contextDir, { recursive: true });
  fs.writeFileSync(
    path.join(contextDir, "enterprise.yml"),
    [
      "enterprise:",
      "  api_key: ent_test_12345678",
      "  endpoint: https://example.com",
      "",
    ].join("\n"),
    "utf8",
  );
  return { cwd, contextDir };
}

function skillPath(homeDir, cli, name) {
  const root = cli === "codex"
    ? path.join(homeDir, ".codex", "skills")
    : path.join(homeDir, ".claude", "skills");
  return path.join(root, name, "SKILL.md");
}

function daemonStatePath(homeDir) {
  return path.join(homeDir, ".cortex", "skills.local.json");
}

function daemonNotificationPath(homeDir) {
  return path.join(homeDir, ".cortex", ".skills-update-applied.json");
}

function latestHostAuditFile(cwd) {
  const auditDir = path.join(cwd, ".context", "audit");
  const files = fs.existsSync(auditDir)
    ? fs.readdirSync(auditDir).filter((file) => file.startsWith("host-events-"))
    : [];
  assert.ok(files.length > 0, "expected at least one host audit file");
  files.sort();
  return path.join(auditDir, files[files.length - 1]);
}

function createFetchStub(state) {
  return async (input) => {
    const url = input instanceof URL
      ? input
      : new URL(typeof input === "string" ? input : input.url);
    if (url.pathname === "/api/v1/govern/skills/manifest") {
      const cli = url.searchParams.get("cli");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ skills: state.manifests[cli] ?? [] }),
      };
    }

    if (url.pathname.startsWith("/api/v1/govern/skills/")) {
      if (typeof state.bodyFetches === "number") state.bodyFetches += 1;
      const name = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      if (!(name in state.bodies)) {
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          text: async () => "",
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => state.bodies[name],
      };
    }

    throw new Error(`Unexpected fetch URL: ${url.toString()}`);
  };
}

test.afterEach(() => {
  delete process.env.HOME;
  globalThis.fetch = undefined;
});

test("runSkillSyncOnce: syncs global and CLI-scoped skills into the correct local roots", async () => {
  const { cwd } = makeWorkspace();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-skill-home-"));
  process.env.HOME = homeDir;

  const state = {
    manifests: {
      claude: [
        {
          name: "global-skill",
          scope: "global",
          updated_at: "2026-05-19T08:00:00.000Z",
        },
      ],
      codex: [
        {
          name: "global-skill",
          scope: "global",
          updated_at: "2026-05-19T08:00:00.000Z",
        },
        {
          name: "codex-only",
          scope: "cli:codex",
          updated_at: "2026-05-19T08:00:00.000Z",
        },
      ],
    },
    bodies: {
      "global-skill": "---\nname: global-skill\ndescription: \"Global\"\n---\n\n# Global\n",
      "codex-only": "---\nname: codex-only\ndescription: \"Codex\"\n---\n\n# Codex\n",
    },
  };

  globalThis.fetch = createFetchStub(state);

  const outcomes = await runSkillSyncOnce(cwd, ["claude", "codex"]);
  assert.equal(outcomes[0].kind, "synced");
  assert.equal(outcomes[1].kind, "synced");

  assert.ok(fs.existsSync(skillPath(homeDir, "claude", "global-skill")));
  assert.ok(!fs.existsSync(skillPath(homeDir, "claude", "codex-only")));
  assert.ok(fs.existsSync(skillPath(homeDir, "codex", "global-skill")));
  assert.ok(fs.existsSync(skillPath(homeDir, "codex", "codex-only")));

  const parsedState = JSON.parse(fs.readFileSync(daemonStatePath(homeDir), "utf8"));
  assert.deepEqual(Object.keys(parsedState.skills).sort(), [
    "claude:global-skill",
    "codex:codex-only",
    "codex:global-skill",
  ]);

  const notification = JSON.parse(
    fs.readFileSync(daemonNotificationPath(homeDir), "utf8"),
  );
  assert.equal(notification.cli, "codex");

  const auditLines = fs
    .readFileSync(latestHostAuditFile(cwd), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    auditLines.map((event) => event.event_type),
    ["skills_synced", "skills_synced"],
  );
});

test("runSkillSyncForCli: rewrites a changed skill and reports an unchanged rerun", async () => {
  const { cwd } = makeWorkspace();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-skill-home-"));
  process.env.HOME = homeDir;

  const state = {
    manifests: {
      codex: [
        {
          name: "global-skill",
          scope: "global",
          updated_at: "2026-05-19T08:00:00.000Z",
        },
      ],
    },
    bodies: {
      "global-skill": "---\nname: global-skill\ndescription: \"V1\"\n---\n\n# One\n",
    },
  };
  globalThis.fetch = createFetchStub(state);

  const first = await runSkillSyncForCli(cwd, "codex");
  assert.equal(first.kind, "synced");
  assert.deepEqual(first.added, ["global-skill"]);

  state.manifests.codex[0].updated_at = "2026-05-19T09:00:00.000Z";
  state.bodies["global-skill"] =
    "---\nname: global-skill\ndescription: \"V2\"\n---\n\n# Two\n";

  const second = await runSkillSyncForCli(cwd, "codex");
  assert.equal(second.kind, "synced");
  assert.deepEqual(second.changed, ["global-skill"]);
  assert.match(
    fs.readFileSync(skillPath(homeDir, "codex", "global-skill"), "utf8"),
    /# Two/,
  );

  const third = await runSkillSyncForCli(cwd, "codex");
  assert.deepEqual(third, {
    kind: "unchanged",
    cli: "codex",
    count: 1,
  });
});

test("runSkillSyncForCli: removes skills that disappear from the manifest", async () => {
  const { cwd } = makeWorkspace();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-skill-home-"));
  process.env.HOME = homeDir;

  const state = {
    manifests: {
      claude: [
        {
          name: "global-skill",
          scope: "global",
          updated_at: "2026-05-19T08:00:00.000Z",
        },
      ],
    },
    bodies: {
      "global-skill": "---\nname: global-skill\ndescription: \"Global\"\n---\n\n# Global\n",
    },
  };
  globalThis.fetch = createFetchStub(state);

  const first = await runSkillSyncForCli(cwd, "claude");
  assert.equal(first.kind, "synced");
  assert.ok(fs.existsSync(skillPath(homeDir, "claude", "global-skill")));

  state.manifests.claude = [];

  const second = await runSkillSyncForCli(cwd, "claude");
  assert.equal(second.kind, "synced");
  assert.deepEqual(second.removed, ["global-skill"]);
  assert.ok(!fs.existsSync(skillPath(homeDir, "claude", "global-skill")));
});

test("runSkillSyncOnce: consumes the shared org-skillz contract fixture end-to-end", async () => {
  const { cwd } = makeWorkspace();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-skill-home-"));
  process.env.HOME = homeDir;

  globalThis.fetch = createFetchStub({
    manifests: skillFixture.manifest,
    bodies: skillFixture.markdown,
  });

  const outcomes = await runSkillSyncOnce(cwd, ["claude", "codex"]);
  assert.equal(outcomes[0].kind, "synced");
  assert.equal(outcomes[1].kind, "synced");

  assert.equal(
    fs.readFileSync(skillPath(homeDir, "codex", "alpha-codex"), "utf8"),
    skillFixture.markdown["alpha-codex"],
  );
  assert.equal(
    fs.readFileSync(skillPath(homeDir, "codex", "global-guard"), "utf8"),
    skillFixture.markdown["global-guard"],
  );
  assert.equal(
    fs.readFileSync(skillPath(homeDir, "claude", "claude-playbook"), "utf8"),
    skillFixture.markdown["claude-playbook"],
  );
  assert.ok(!fs.existsSync(skillPath(homeDir, "claude", "alpha-codex")));
});

test("runSkillSyncForCli: rejects unsafe remote names before fetching or writing skill bodies", async () => {
  const { cwd } = makeWorkspace();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-skill-home-"));
  process.env.HOME = homeDir;
  const victimDir = path.join(homeDir, "Documents");
  fs.mkdirSync(victimDir);
  fs.writeFileSync(path.join(victimDir, "sentinel.txt"), "keep", "utf8");
  let bodyFetches = 0;

  globalThis.fetch = async (input) => {
    const url = input instanceof URL ? input : new URL(input);
    if (url.pathname.endsWith("/manifest")) {
      return {
        ok: true,
        json: async () => ({
          skills: [{
            name: "../../Documents",
            scope: "global",
            updated_at: "2026-07-28T00:00:00.000Z",
          }],
        }),
      };
    }
    bodyFetches += 1;
    throw new Error("body fetch must not occur");
  };

  const outcome = await runSkillSyncForCli(cwd, "codex");
  assert.equal(outcome.kind, "failed");
  assert.match(outcome.error, /invalid skill name/);
  assert.equal(bodyFetches, 0);
  assert.equal(
    fs.readFileSync(path.join(victimDir, "sentinel.txt"), "utf8"),
    "keep",
  );
});

test("runSkillSyncForCli: ignores persisted absolute paths when removing legacy state", async () => {
  const { cwd } = makeWorkspace();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-skill-home-"));
  process.env.HOME = homeDir;
  const victimDir = path.join(homeDir, "Documents");
  fs.mkdirSync(victimDir);
  fs.writeFileSync(path.join(victimDir, "SKILL.md"), "not managed", "utf8");
  fs.writeFileSync(path.join(victimDir, "sentinel.txt"), "keep", "utf8");
  fs.mkdirSync(path.dirname(daemonStatePath(homeDir)), { recursive: true });
  fs.writeFileSync(
    daemonStatePath(homeDir),
    JSON.stringify({
      skills: {
        "codex:safe-skill": {
          cli: "codex",
          scope: "global",
          updated_at: "2026-07-27T00:00:00.000Z",
          path: path.join(victimDir, "SKILL.md"),
        },
      },
    }),
    "utf8",
  );
  globalThis.fetch = createFetchStub({
    manifests: { codex: [] },
    bodies: {},
  });

  const outcome = await runSkillSyncForCli(cwd, "codex");
  assert.equal(outcome.kind, "synced");
  assert.deepEqual(outcome.removed, ["safe-skill"]);
  assert.equal(
    fs.readFileSync(path.join(victimDir, "sentinel.txt"), "utf8"),
    "keep",
  );
  assert.equal(fs.existsSync(path.join(victimDir, "SKILL.md")), true);
});

test("runSkillSyncForCli: refuses to write through a managed skill directory symlink", {
  skip: process.platform === "win32",
}, async () => {
  const { cwd } = makeWorkspace();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-skill-home-"));
  process.env.HOME = homeDir;
  const victimDir = path.join(homeDir, "victim");
  const skillsRoot = path.join(homeDir, ".codex", "skills");
  fs.mkdirSync(victimDir);
  fs.mkdirSync(skillsRoot, { recursive: true });
  fs.writeFileSync(path.join(victimDir, "SKILL.md"), "keep", "utf8");
  fs.symlinkSync(victimDir, path.join(skillsRoot, "global-skill"), "dir");
  const remote = {
    bodyFetches: 0,
    manifests: {
      codex: [{
        name: "global-skill",
        scope: "global",
        updated_at: "2026-07-28T00:00:00.000Z",
      }],
    },
    bodies: {
      "global-skill": "remote replacement",
    },
  };
  globalThis.fetch = createFetchStub(remote);

  const outcome = await runSkillSyncForCli(cwd, "codex");
  assert.equal(outcome.kind, "failed");
  assert.match(outcome.error, /symbolic link/);
  assert.equal(remote.bodyFetches, 0);
  assert.equal(
    fs.readFileSync(path.join(victimDir, "SKILL.md"), "utf8"),
    "keep",
  );
});

test("runSkillSyncForCli: refuses to overwrite an unmanaged personal skill collision", async () => {
  const { cwd } = makeWorkspace();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-skill-home-"));
  process.env.HOME = homeDir;
  const personalDir = path.dirname(
    skillPath(homeDir, "codex", "global-skill"),
  );
  fs.mkdirSync(personalDir, { recursive: true });
  fs.writeFileSync(
    path.join(personalDir, "SKILL.md"),
    "personal content",
    "utf8",
  );
  fs.writeFileSync(path.join(personalDir, "notes.txt"), "keep", "utf8");
  const remote = {
    bodyFetches: 0,
    manifests: {
      codex: [{
        name: "global-skill",
        scope: "global",
        updated_at: "2026-07-28T00:00:00.000Z",
      }],
    },
    bodies: { "global-skill": "remote replacement" },
  };
  globalThis.fetch = createFetchStub(remote);

  const outcome = await runSkillSyncForCli(cwd, "codex");
  assert.equal(outcome.kind, "failed");
  assert.match(outcome.error, /not owned by Cortex/);
  assert.equal(remote.bodyFetches, 0);
  assert.equal(
    fs.readFileSync(path.join(personalDir, "SKILL.md"), "utf8"),
    "personal content",
  );
  assert.equal(
    fs.readFileSync(path.join(personalDir, "notes.txt"), "utf8"),
    "keep",
  );
});

test("runSkillSyncForCli: refuses a symlinked CLI skills root", {
  skip: process.platform === "win32",
}, async () => {
  const { cwd } = makeWorkspace();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-skill-home-"));
  process.env.HOME = homeDir;
  const victimDir = path.join(homeDir, "outside");
  const cliDir = path.join(homeDir, ".codex");
  fs.mkdirSync(victimDir);
  fs.mkdirSync(cliDir);
  fs.symlinkSync(victimDir, path.join(cliDir, "skills"), "dir");
  const remote = {
    bodyFetches: 0,
    manifests: {
      codex: [{
        name: "global-skill",
        scope: "global",
        updated_at: "2026-07-28T00:00:00.000Z",
      }],
    },
    bodies: { "global-skill": "remote replacement" },
  };
  globalThis.fetch = createFetchStub(remote);

  const outcome = await runSkillSyncForCli(cwd, "codex");
  assert.equal(outcome.kind, "failed");
  assert.match(outcome.error, /skills root must not be a symbolic link/);
  assert.equal(remote.bodyFetches, 0);
  assert.deepEqual(fs.readdirSync(victimDir), []);
});

test("runSkillSyncForCli: a second credential cannot mutate the first credential's managed skills", async () => {
  const { cwd, contextDir } = makeWorkspace();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-skill-home-"));
  process.env.HOME = homeDir;
  const remote = {
    manifests: {
      codex: [{
        name: "global-skill",
        scope: "global",
        updated_at: "2026-07-28T00:00:00.000Z",
      }],
    },
    bodies: { "global-skill": "identity A" },
  };
  globalThis.fetch = createFetchStub(remote);

  const first = await runSkillSyncForCli(cwd, "codex");
  assert.equal(first.kind, "synced");
  const installed = skillPath(homeDir, "codex", "global-skill");
  assert.equal(fs.readFileSync(installed, "utf8"), "identity A");
  assert.ok(
    fs.existsSync(path.join(path.dirname(installed), ".cortex-managed.json")),
  );

  fs.writeFileSync(
    path.join(contextDir, "enterprise.yml"),
    [
      "enterprise:",
      "  api_key: ent_other_12345678",
      "  endpoint: https://other.example.com",
      "",
    ].join("\n"),
    "utf8",
  );
  remote.manifests.codex = [];

  const second = await runSkillSyncForCli(cwd, "codex");
  assert.equal(second.kind, "failed");
  assert.match(second.error, /identity conflict/);
  assert.equal(fs.readFileSync(installed, "utf8"), "identity A");
});

test("runSkillSyncForCli: removal refuses unowned files added to a managed directory", async () => {
  const { cwd } = makeWorkspace();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-skill-home-"));
  process.env.HOME = homeDir;
  const remote = {
    manifests: {
      codex: [{
        name: "global-skill",
        scope: "global",
        updated_at: "2026-07-28T00:00:00.000Z",
      }],
    },
    bodies: { "global-skill": "managed" },
  };
  globalThis.fetch = createFetchStub(remote);
  assert.equal((await runSkillSyncForCli(cwd, "codex")).kind, "synced");

  const installedDir = path.dirname(
    skillPath(homeDir, "codex", "global-skill"),
  );
  fs.writeFileSync(path.join(installedDir, "personal-note.txt"), "keep", "utf8");
  remote.manifests.codex = [];

  const outcome = await runSkillSyncForCli(cwd, "codex");
  assert.equal(outcome.kind, "failed");
  assert.match(outcome.error, /contains unowned files/);
  assert.equal(
    fs.readFileSync(path.join(installedDir, "personal-note.txt"), "utf8"),
    "keep",
  );
});

test("runSkillSyncForCli: refuses a managed SKILL.md symlink before fetching replacement content", {
  skip: process.platform === "win32",
}, async () => {
  const { cwd } = makeWorkspace();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-skill-home-"));
  process.env.HOME = homeDir;
  const remote = {
    bodyFetches: 0,
    manifests: {
      codex: [{
        name: "global-skill",
        scope: "global",
        updated_at: "2026-07-28T00:00:00.000Z",
      }],
    },
    bodies: { "global-skill": "managed v1" },
  };
  globalThis.fetch = createFetchStub(remote);
  assert.equal((await runSkillSyncForCli(cwd, "codex")).kind, "synced");
  assert.equal(remote.bodyFetches, 1);

  const installed = skillPath(homeDir, "codex", "global-skill");
  const victim = path.join(homeDir, "victim.txt");
  fs.writeFileSync(victim, "keep", "utf8");
  fs.unlinkSync(installed);
  fs.symlinkSync(victim, installed);
  remote.manifests.codex[0].updated_at = "2026-07-28T01:00:00.000Z";
  remote.bodies["global-skill"] = "managed v2";

  const outcome = await runSkillSyncForCli(cwd, "codex");
  assert.equal(outcome.kind, "failed");
  assert.match(outcome.error, /skill file must not be a symbolic link/);
  assert.equal(remote.bodyFetches, 1);
  assert.equal(fs.readFileSync(victim, "utf8"), "keep");
});

test("runSkillSyncForCli: rejects malformed manifest variants before any body fetch", async () => {
  const variants = [
    {
      label: "absolute name",
      manifest: [{
        name: "/tmp/owned",
        scope: "global",
        updated_at: "2026-07-28T00:00:00.000Z",
      }],
    },
    {
      label: "separator-only name",
      manifest: [{
        name: "../",
        scope: "global",
        updated_at: "2026-07-28T00:00:00.000Z",
      }],
    },
    {
      label: "dot name",
      manifest: [{
        name: ".",
        scope: "global",
        updated_at: "2026-07-28T00:00:00.000Z",
      }],
    },
    {
      label: "malformed entry",
      manifest: [null],
    },
    {
      label: "invalid scope",
      manifest: [{
        name: "safe-name",
        scope: "project",
        updated_at: "2026-07-28T00:00:00.000Z",
      }],
    },
    {
      label: "missing timestamp",
      manifest: [{
        name: "safe-name",
        scope: "global",
        updated_at: "",
      }],
    },
    {
      label: "duplicate name",
      manifest: [
        {
          name: "safe-name",
          scope: "global",
          updated_at: "2026-07-28T00:00:00.000Z",
        },
        {
          name: "safe-name",
          scope: "global",
          updated_at: "2026-07-28T00:00:00.000Z",
        },
      ],
    },
  ];

  for (const variant of variants) {
    const { cwd } = makeWorkspace();
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-skill-home-"));
    process.env.HOME = homeDir;
    let bodyFetches = 0;
    globalThis.fetch = async (input) => {
      const url = input instanceof URL ? input : new URL(input);
      if (url.pathname.endsWith("/manifest")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ skills: variant.manifest }),
        };
      }
      bodyFetches += 1;
      throw new Error("body fetch must not occur");
    };
    const outcome = await runSkillSyncForCli(cwd, "codex");
    assert.equal(outcome.kind, "failed", variant.label);
    assert.equal(bodyFetches, 0, variant.label);
  }
});

test("runSkillSyncForCli: sanitizes an unsafe legacy state key without filesystem mutation", async () => {
  const { cwd } = makeWorkspace();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-skill-home-"));
  process.env.HOME = homeDir;
  const victimDir = path.join(homeDir, "Documents");
  fs.mkdirSync(victimDir);
  fs.writeFileSync(path.join(victimDir, "sentinel.txt"), "keep", "utf8");
  fs.mkdirSync(path.dirname(daemonStatePath(homeDir)), { recursive: true });
  fs.writeFileSync(
    daemonStatePath(homeDir),
    JSON.stringify({
      skills: {
        "codex:../../Documents": {
          cli: "codex",
          scope: "global",
          updated_at: "2026-07-27T00:00:00.000Z",
          path: victimDir,
        },
      },
    }),
    "utf8",
  );
  globalThis.fetch = createFetchStub({
    manifests: { codex: [] },
    bodies: {},
  });

  const outcome = await runSkillSyncForCli(cwd, "codex");
  assert.equal(outcome.kind, "unchanged");
  assert.equal(
    fs.readFileSync(path.join(victimDir, "sentinel.txt"), "utf8"),
    "keep",
  );
  const state = JSON.parse(fs.readFileSync(daemonStatePath(homeDir), "utf8"));
  assert.deepEqual(state.skills, {});
});
