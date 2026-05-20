import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  runSkillSyncForCli,
  runSkillSyncOnce,
} from "../dist/daemon/skill-sync-checker.js";

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
