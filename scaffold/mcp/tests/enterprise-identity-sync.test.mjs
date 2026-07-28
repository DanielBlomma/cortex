import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runWorkflowSyncOnce } from "../dist/daemon/workflow-sync-checker.js";
import { runCapabilitySyncOnce } from "../dist/daemon/capability-sync-checker.js";
import {
  runSkillSyncForCli,
  runSkillSyncOnce,
} from "../dist/daemon/skill-sync-checker.js";
import { enterpriseCredentialId } from "../dist/core/license.js";
import { claimEnterpriseHostIdentity } from "../dist/core/enterprise-host-identity.js";
import { bindEnterpriseIdentity } from "../dist/cli/enterprise-setup.js";

function makeProject(endpoint, apiKey) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-identity-sync-"));
  fs.mkdirSync(path.join(cwd, ".context"));
  fs.writeFileSync(
    path.join(cwd, ".context", "enterprise.yml"),
    [
      "enterprise:",
      `  api_key: ${apiKey}`,
      `  endpoint: ${endpoint}`,
      "",
    ].join("\n"),
    "utf8",
  );
  return cwd;
}

test("a merely opened repository cannot claim the user-global Enterprise identity", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-identity-home-"));
  const project = makeProject(
    "https://untrusted-repo.example.com",
    "ent_untrusted_repo_12345678",
  );
  process.env.HOME = homeDir;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error("fetch must not occur");
  };
  try {
    const outcome = await runSkillSyncForCli(project, "codex");
    assert.equal(outcome.kind, "failed");
    assert.match(outcome.error, /identity conflict/);
    assert.equal(fetches, 0);
    assert.equal(
      fs.existsSync(
        path.join(homeDir, ".cortex", "enterprise-host-identity.json"),
      ),
      false,
    );
  } finally {
    delete process.env.HOME;
    globalThis.fetch = undefined;
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test("organization workflow and capability caches reject a second Enterprise credential before fetch", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-identity-home-"));
  const first = makeProject(
    "https://identity-a.example.com",
    "ent_identity_a_12345678",
  );
  const second = makeProject(
    "https://identity-b.example.com",
    "ent_identity_b_12345678",
  );
  process.env.HOME = homeDir;
  assert.equal(
    claimEnterpriseHostIdentity(
      enterpriseCredentialId(
        "https://identity-a.example.com",
        "ent_identity_a_12345678",
      ),
      "https://identity-a.example.com",
    ),
    true,
  );
  let fetches = 0;
  globalThis.fetch = async (input) => {
    fetches += 1;
    const url = input instanceof URL ? input : new URL(input);
    if (url.pathname.endsWith("/workflows/manifest")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ workflows: [] }),
      };
    }
    if (url.pathname.endsWith("/capabilities/manifest")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ capabilities: [] }),
      };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    assert.equal((await runWorkflowSyncOnce(first)).kind, "unchanged");
    assert.equal((await runCapabilitySyncOnce(first)).kind, "unchanged");
    assert.equal(fetches, 2);

    const workflowStatePath = path.join(
      homeDir,
      ".cortex",
      "workflows.local.json",
    );
    const capabilityStatePath = path.join(
      homeDir,
      ".cortex",
      "capabilities.local.json",
    );
    const workflowStateBefore = fs.readFileSync(workflowStatePath, "utf8");
    const capabilityStateBefore = fs.readFileSync(capabilityStatePath, "utf8");

    const workflowConflict = await runWorkflowSyncOnce(second);
    const capabilityConflict = await runCapabilitySyncOnce(second);
    const skillConflict = await runSkillSyncForCli(second, "codex");
    assert.equal(workflowConflict.kind, "failed");
    assert.match(workflowConflict.error, /identity conflict/);
    assert.equal(capabilityConflict.kind, "failed");
    assert.match(capabilityConflict.error, /identity conflict/);
    assert.equal(skillConflict.kind, "failed");
    assert.match(skillConflict.error, /identity conflict/);
    assert.equal(fetches, 2);
    assert.equal(fs.readFileSync(workflowStatePath, "utf8"), workflowStateBefore);
    assert.equal(
      fs.readFileSync(capabilityStatePath, "utf8"),
      capabilityStateBefore,
    );
  } finally {
    delete process.env.HOME;
    globalThis.fetch = undefined;
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  }
});

test("an explicit same-endpoint credential rotation rebinds organization caches", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-identity-home-"));
  const endpoint = "https://identity-rotation.example.com";
  const firstKey = "ent_identity_first_12345678";
  const secondKey = "ent_identity_second_12345678";
  const first = makeProject(endpoint, firstKey);
  const second = makeProject(endpoint, secondKey);
  process.env.HOME = homeDir;
  const seenAuthorization = [];
  const updatedAt = "2026-07-28T10:00:00.000Z";
  globalThis.fetch = async (input, init = {}) => {
    const authorization = init.headers?.Authorization;
    seenAuthorization.push(authorization);
    const organization =
      authorization === `Bearer ${secondKey}` ? "Organization B" : "Organization A";
    const url = input instanceof URL ? input : new URL(input);
    if (url.pathname.endsWith("/skills/manifest")) {
      const cli = url.searchParams.get("cli");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          skills: [{
            name: `rotation-${cli}`,
            scope: `cli:${cli}`,
            updated_at: updatedAt,
          }],
        }),
      };
    }
    if (
      url.pathname.endsWith("/skills/rotation-claude") ||
      url.pathname.endsWith("/skills/rotation-codex")
    ) {
      const cli = url.pathname.endsWith("rotation-claude")
        ? "claude"
        : "codex";
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => `# ${organization} ${cli} skill\n`,
      };
    }
    if (url.pathname.endsWith("/workflows/manifest")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          workflows: [{
            workflow_id: "rotation-flow",
            version: 1,
            updated_at: updatedAt,
          }],
        }),
      };
    }
    if (url.pathname.endsWith("/workflows/rotation-flow")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          workflow: {
            workflow_id: "rotation-flow",
            description: organization,
            version: 1,
            updated_at: updatedAt,
            definition: {
              id: "rotation-flow",
              description: organization,
              version: 1,
              stages: [{
                name: "review",
                artifact: "review.md",
                reads: [],
                required_fields: [],
                capability: "reviewer",
                description: organization,
              }],
            },
          },
        }),
      };
    }
    if (url.pathname.endsWith("/capabilities/manifest")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          capabilities: [{
            capability_name: "rotation-capability",
            updated_at: updatedAt,
          }],
        }),
      };
    }
    if (url.pathname.endsWith("/capabilities/rotation-capability")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          capability: {
            capability_name: "rotation-capability",
            description: organization,
            updated_at: updatedAt,
            definition: {
              name: "rotation-capability",
              description: organization,
              read_globs: ["**"],
              write_globs: [],
              tools_allowed: [],
            },
          },
        }),
      };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    assert.equal(
      claimEnterpriseHostIdentity(
        enterpriseCredentialId(endpoint, firstKey),
        endpoint,
      ),
      true,
    );
    assert.deepEqual(
      (await runSkillSyncOnce(first, ["claude", "codex"])).map(
        (outcome) => outcome.kind,
      ),
      ["synced", "synced"],
    );
    assert.equal((await runWorkflowSyncOnce(first)).kind, "synced");
    assert.equal((await runCapabilitySyncOnce(first)).kind, "synced");

    assert.equal(
      bindEnterpriseIdentity({ apiKey: secondKey, endpoint }),
      true,
    );
    for (const cli of ["claude", "codex"]) {
      assert.equal(
        fs.existsSync(
          path.join(
            homeDir,
            cli === "codex" ? ".codex" : ".claude",
            "skills",
            `rotation-${cli}`,
          ),
        ),
        false,
        `old ${cli} skill must be purged before identity replacement`,
      );
    }
    for (const file of [
      "skills.local.json",
      "workflows.local.json",
      "capabilities.local.json",
    ]) {
      assert.equal(
        fs.existsSync(path.join(homeDir, ".cortex", file)),
        false,
        `${file} must be invalidated before identity replacement`,
      );
    }
    const skillRotation = await runSkillSyncOnce(
      second,
      ["claude", "codex"],
    );
    const workflowRotation = await runWorkflowSyncOnce(second);
    const capabilityRotation = await runCapabilitySyncOnce(second);
    assert.deepEqual(
      skillRotation.map((outcome) => ({
        kind: outcome.kind,
        changed: outcome.kind === "synced" ? outcome.changed : [],
      })),
      [
        { kind: "synced", changed: [] },
        { kind: "synced", changed: [] },
      ],
    );
    assert.deepEqual(skillRotation[0].added, ["rotation-claude"]);
    assert.deepEqual(skillRotation[1].added, ["rotation-codex"]);
    assert.equal(workflowRotation.kind, "synced");
    assert.deepEqual(workflowRotation.added, ["rotation-flow"]);
    assert.equal(capabilityRotation.kind, "synced");
    assert.deepEqual(capabilityRotation.added, ["rotation-capability"]);
    assert.deepEqual(
      seenAuthorization.slice(-8),
      Array(8).fill(`Bearer ${secondKey}`),
    );

    for (const file of [
      "skills.local.json",
      "workflows.local.json",
      "capabilities.local.json",
    ]) {
      const state = JSON.parse(
        fs.readFileSync(path.join(homeDir, ".cortex", file), "utf8"),
      );
      assert.equal(
        state.credential_id,
        enterpriseCredentialId(endpoint, secondKey),
      );
    }
    const workflowState = JSON.parse(
      fs.readFileSync(
        path.join(homeDir, ".cortex", "workflows.local.json"),
        "utf8",
      ),
    );
    assert.equal(
      workflowState.workflows["rotation-flow"].definition.description,
      "Organization B",
    );
    const capabilityState = JSON.parse(
      fs.readFileSync(
        path.join(homeDir, ".cortex", "capabilities.local.json"),
        "utf8",
      ),
    );
    assert.equal(
      capabilityState.capabilities["rotation-capability"].definition.description,
      "Organization B",
    );
    for (const cli of ["claude", "codex"]) {
      const skillBody = fs.readFileSync(
        path.join(
          homeDir,
          cli === "codex" ? ".codex" : ".claude",
          "skills",
          `rotation-${cli}`,
          "SKILL.md",
        ),
        "utf8",
      );
      assert.match(skillBody, /Organization B/);
      assert.doesNotMatch(skillBody, /Organization A/);
    }
  } finally {
    delete process.env.HOME;
    globalThis.fetch = undefined;
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  }
});
