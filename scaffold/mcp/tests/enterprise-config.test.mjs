import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadEnterpriseConfig } from "../dist/core/config.js";

function makeContextDir(content) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-enterprise-config-"));
  const contextDir = path.join(tempRoot, ".context");
  fs.mkdirSync(contextDir, { recursive: true });
  if (content !== undefined) {
    fs.writeFileSync(path.join(contextDir, "enterprise.yml"), content);
  }
  return { tempRoot, contextDir };
}

test("loader: missing file returns defaults with empty api_key", () => {
  const { tempRoot, contextDir } = makeContextDir(undefined);
  try {
    const cfg = loadEnterpriseConfig(contextDir);
    assert.equal(cfg.enterprise.api_key, "");
    assert.equal(cfg.govern.mode, "off");
    assert.equal(cfg.compliance.frameworks.length, 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("loader: new schema — single api_key flows to telemetry+policy, base_url derives endpoints", () => {
  const yaml = [
    "enterprise:",
    "  api_key: ent_test_key_1234",
    "  base_url: https://example.com",
    "",
    "compliance:",
    "  frameworks: [iso27001, soc2]",
    "  eu_addons: false",
    "",
    "govern:",
    "  mode: advisory",
    "  tier_claude: prevent",
    "  tier_codex: prevent",
    "  tier_copilot: wrap",
    "",
  ].join("\n");
  const { tempRoot, contextDir } = makeContextDir(yaml);
  try {
    const cfg = loadEnterpriseConfig(contextDir);
    assert.equal(cfg.enterprise.api_key, "ent_test_key_1234");
    assert.equal(cfg.enterprise.base_url, "https://example.com");
    assert.equal(cfg.telemetry.api_key, "ent_test_key_1234");
    assert.equal(cfg.telemetry.endpoint, "https://example.com/api/v1/telemetry/push");
    assert.equal(cfg.policy.api_key, "ent_test_key_1234");
    assert.equal(cfg.policy.endpoint, "https://example.com/api/v1/policies/sync");
    assert.equal(cfg.govern.govern_endpoint, "https://example.com/api/v1/govern");
    assert.deepEqual(cfg.compliance.frameworks, ["iso27001", "soc2"]);
    assert.equal(cfg.compliance.eu_addons, false);
    assert.equal(cfg.govern.mode, "advisory");
    assert.equal(cfg.govern.tier_copilot, "wrap");
    assert.equal(cfg.govern.detect_ungoverned, true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("loader: eu_addons=true merges gdpr/ai_act/nis2 with default frameworks", () => {
  const yaml = [
    "enterprise:",
    "  api_key: ent_test_key_1234",
    "  base_url: https://example.com",
    "compliance:",
    "  eu_addons: true",
    "",
  ].join("\n");
  const { tempRoot, contextDir } = makeContextDir(yaml);
  try {
    const cfg = loadEnterpriseConfig(contextDir);
    assert.deepEqual(
      cfg.compliance.frameworks.sort(),
      ["ai_act", "gdpr", "iso27001", "iso42001", "nis2", "soc2"],
    );
    assert.equal(cfg.compliance.eu_addons, true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("loader: legacy schema — telemetry/policy own keys still work", () => {
  const yaml = [
    "enterprise:",
    "  endpoint: https://legacy.example.com",
    "  api_key: ent_legacy_key_1234",
    "",
    "telemetry:",
    "  enabled: true",
    "  endpoint: https://legacy.example.com/api/v1/telemetry/push",
    "  api_key: ent_legacy_key_1234",
    "",
    "policy:",
    "  endpoint: https://legacy.example.com/api/v1/policies/sync",
    "  api_key: ent_legacy_key_1234",
    "",
  ].join("\n");
  const { tempRoot, contextDir } = makeContextDir(yaml);
  try {
    const cfg = loadEnterpriseConfig(contextDir);
    assert.equal(cfg.enterprise.api_key, "ent_legacy_key_1234");
    assert.equal(cfg.telemetry.endpoint, "https://legacy.example.com/api/v1/telemetry/push");
    assert.equal(cfg.policy.endpoint, "https://legacy.example.com/api/v1/policies/sync");
    assert.equal(cfg.govern.mode, "off");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("loader: invalid frameworks are dropped silently", () => {
  const yaml = [
    "enterprise:",
    "  api_key: ent_test_key_1234",
    "  base_url: https://example.com",
    "compliance:",
    "  frameworks: [iso27001, made_up_framework, soc2]",
    "",
  ].join("\n");
  const { tempRoot, contextDir } = makeContextDir(yaml);
  try {
    const cfg = loadEnterpriseConfig(contextDir);
    assert.deepEqual(cfg.compliance.frameworks, ["iso27001", "soc2"]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("loader: invalid govern mode falls back to default", () => {
  const yaml = [
    "enterprise:",
    "  api_key: ent_test_key_1234",
    "  base_url: https://example.com",
    "govern:",
    "  mode: bogus_mode",
    "  tier_claude: not_a_tier",
    "",
  ].join("\n");
  const { tempRoot, contextDir } = makeContextDir(yaml);
  try {
    const cfg = loadEnterpriseConfig(contextDir);
    assert.equal(cfg.govern.mode, "off");
    assert.equal(cfg.govern.tier_claude, "prevent");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
