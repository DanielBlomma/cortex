import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { assertFinalHarnessEvidence, registryTarballUrl } from "../scripts/release-artifacts.mjs";
import { syncDshCortexLock } from "../scripts/sync-release-version.mjs";

function readText(relative) {
  return fs.readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8");
}

function readJson(relative) {
  return JSON.parse(readText(relative));
}

function assertBefore(source, earlier, later, message) {
  const earlierIndex = source.indexOf(earlier);
  const laterIndex = source.indexOf(later);
  assert.ok(earlierIndex >= 0, `missing ${earlier}`);
  assert.ok(laterIndex >= 0, `missing ${later}`);
  assert.ok(earlierIndex < laterIndex, message ?? `${earlier} must precede ${later}`);
}

const synchronizedFiles = [
  "package.json",
  "package-lock.json",
  "server.json",
  "mcp-registry-submission.json",
  "plugins/cortex/.claude-plugin/plugin.json",
  "plugins/cortex/.codex-plugin/plugin.json",
  "plugins/dsh-cortex/package.json",
  "plugins/dsh-cortex/package-lock.json",
  ".claude-plugin/marketplace.json",
];

function validateBumpWorkflow(workflow) {
  assertBefore(workflow, "- name: Reject non-main dispatch", "- name: Checkout current main");
  assert.match(workflow, /BASE_VERSION: "2\.5\.2"/);
  assert.match(workflow, /RELEASE_VERSION: "2\.6\.0"/);
  assert.match(workflow, /test "\$\{RELEASE_TYPE\}" = "minor"/);
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$\(git rev-parse origin\/main\)"/);
  assert.match(workflow, /sync-release-version\.mjs --root-tarball/);
  for (const file of synchronizedFiles) {
    assert.ok(workflow.includes(file), `release bump omits synchronized file ${file}`);
  }
  for (const gate of [
    "Run focused release contract tests",
    "Prepare isolated repository test context",
    "Run full root and bundle tests",
    "Prepare isolated MCP test context",
    "Run context runtime and MCP compatibility tests",
    "Audit all six committed dependency trees",
    "Verify pinned DeepSeek Harness contract",
    "Create and verify duplicate dual-package artifacts",
    "Install both unpublished artifacts with an empty cache",
    "Run packed Harness headless and Web lifecycle",
    "Run executable fresh-checkout regression",
  ]) {
    assertBefore(workflow, `- name: ${gate}`, "- name: Commit and create immutable release tag");
  }
  assertBefore(workflow, "- name: Commit and create immutable release tag", "- name: Trigger publish from the immutable tag");
  assert.match(workflow, /Run full root and bundle tests[\s\S]*?CORTEX_EXPECTED_RELEASE_VERSION: \$\{\{ env\.RELEASE_VERSION \}\}[\s\S]*?run: npm test/);
  assertBefore(workflow, "- name: Prepare isolated repository test context", "- name: Run full root and bundle tests");
  assert.match(workflow, /release:prepare-root-test-context/);
  assert.match(workflow, /release:test-fresh-checkout/);
  assertBefore(workflow, "- name: Prepare isolated MCP test context", "- name: Run context runtime and MCP compatibility tests");
  assert.match(workflow, /release:prepare-mcp-test-context/);
  assert.match(workflow, /git push --atomic origin "HEAD:main" "refs\/tags\/\$\{RELEASE_TAG\}"/);
}

function validatePublishWorkflow(workflow) {
  assertBefore(workflow, "- name: Reject branch dispatches and non-strict tags", "- name: Checkout immutable tag");
  assert.match(workflow, /\^v\(0\|\[1-9\]\[0-9\]\*\)\\\.\(0\|\[1-9\]\[0-9\]\*\)\\\.\(0\|\[1-9\]\[0-9\]\*\)\$/);
  assertBefore(workflow, 'test "${TAG_VERSION}" = "${BUNDLE_DEPENDENCY}"', "- name: Install five independently published dependency trees");
  for (const gate of [
    "Run focused release contract tests",
    "Prepare isolated repository test context",
    "Run full root and bundle tests",
    "Prepare isolated MCP test context",
    "Run context runtime and MCP compatibility tests",
    "Audit all six committed dependency trees",
    "Verify pinned DeepSeek Harness contract",
    "Recreate and verify the reviewed dual artifacts",
    "Install both reviewed artifacts with an empty cache",
    "Run packed Harness headless and Web lifecycle",
    "Run executable fresh-checkout regression",
  ]) {
    assertBefore(workflow, `- name: ${gate}`, "- name: Publish exact root artifact first");
  }
  assertBefore(workflow, "- name: Publish exact root artifact first", "- name: Verify exact root registry artifact before bundle publication");
  assertBefore(workflow, "- name: Verify exact root registry artifact before bundle publication", "- name: Publish exact DeepSeek Harness bundle second");
  assertBefore(workflow, "- name: Publish exact DeepSeek Harness bundle second", "- name: Verify exact bundle registry artifact");
  assert.match(workflow, /if: steps\.registry\.outputs\.root_state == 'missing'/);
  assert.match(workflow, /if: steps\.registry\.outputs\.bundle_state == 'missing'/);
  assert.match(workflow, /release-artifacts\.mjs registry-state/);
  assert.match(workflow, /Run full root and bundle tests[\s\S]*?CORTEX_EXPECTED_RELEASE_VERSION: \$\{\{ steps\.version\.outputs\.value \}\}[\s\S]*?run: npm test/);
  assertBefore(workflow, "- name: Prepare isolated repository test context", "- name: Run full root and bundle tests");
  assert.match(workflow, /release:prepare-root-test-context/);
  assert.match(workflow, /release:test-fresh-checkout/);
  assertBefore(workflow, "- name: Prepare isolated MCP test context", "- name: Run context runtime and MCP compatibility tests");
  assert.match(workflow, /release:prepare-mcp-test-context/);
  assert.match(workflow, /npm publish "\$\{\{ steps\.artifacts\.outputs\.root_tarball \}\}"/);
  assert.match(workflow, /npm publish "\$\{\{ steps\.artifacts\.outputs\.bundle_tarball \}\}"/);
  assert.doesNotMatch(workflow, /@latest/);
}

test("committed candidate keeps every root and bundle version at 2.5.2", () => {
  const expectedVersion = process.env.CORTEX_EXPECTED_RELEASE_VERSION ?? "2.5.2";
  const rootPackage = readJson("package.json");
  const rootLock = readJson("package-lock.json");
  const bundlePackage = readJson("plugins/dsh-cortex/package.json");
  const bundleLock = readJson("plugins/dsh-cortex/package-lock.json");
  assert.equal(rootPackage.version, expectedVersion);
  assert.equal(rootLock.version, expectedVersion);
  assert.equal(rootLock.packages[""].version, expectedVersion);
  assert.equal(bundlePackage.version, expectedVersion);
  assert.equal(bundlePackage.dependencies[rootPackage.name], expectedVersion);
  assert.equal(bundleLock.version, expectedVersion);
  assert.equal(bundleLock.packages[""].version, expectedVersion);
  assert.equal(bundleLock.packages[""].dependencies[rootPackage.name], expectedVersion);
  assert.equal(bundleLock.packages[`node_modules/${rootPackage.name}`].version, expectedVersion);
});

test("bundle lock synchronization requires and records the exact new root artifact", () => {
  const rootPackage = readJson("package.json");
  const bundlePackage = readJson("plugins/dsh-cortex/package.json");
  const bundleLock = readJson("plugins/dsh-cortex/package-lock.json");
  const staleBundleLock = structuredClone(bundleLock);
  staleBundleLock.packages[`node_modules/${rootPackage.name}`].version = "2.5.2";
  assert.throws(
    () => syncDshCortexLock(staleBundleLock, "2.6.0", bundlePackage.name, rootPackage, null),
    /--root-tarball.*required/,
  );
  const integrity = `sha512-${Buffer.from("reviewed-root-artifact").toString("base64")}`;
  const next = syncDshCortexLock(
    bundleLock,
    "2.6.0",
    bundlePackage.name,
    { ...rootPackage, version: "2.6.0" },
    { integrity },
  );
  assert.equal(next.version, "2.6.0");
  assert.equal(next.packages[""].version, "2.6.0");
  assert.equal(next.packages[""].dependencies[rootPackage.name], "2.6.0");
  const installed = next.packages[`node_modules/${rootPackage.name}`];
  assert.equal(installed.version, "2.6.0");
  assert.equal(installed.resolved, registryTarballUrl(rootPackage.name, "2.6.0"));
  assert.equal(installed.integrity, integrity);
  assert.doesNotMatch(installed.resolved, /file:|workspace:|latest/);
});

test("release bump encodes exact synchronized staging and all pre-tag gates", () => {
  validateBumpWorkflow(readText(".github/workflows/release-bump.yml"));
});

test("release bump regression validator rejects omitted bundle lock staging", () => {
  const workflow = readText(".github/workflows/release-bump.yml").replaceAll(
    "plugins/dsh-cortex/package-lock.json",
    "plugins/dsh-cortex/omitted-lock.json",
  );
  assert.throws(() => validateBumpWorkflow(workflow), /omits synchronized file/);
});

test("release publish is tag-only, root-first, exact-artifact, and resumable", () => {
  validatePublishWorkflow(readText(".github/workflows/release-publish.yml"));
});

test("release publish regression validator rejects bundle-before-root verification", () => {
  const workflow = readText(".github/workflows/release-publish.yml");
  const rootVerify = "- name: Verify exact root registry artifact before bundle publication";
  const bundlePublish = "- name: Publish exact DeepSeek Harness bundle second";
  const invalid = workflow.replace(rootVerify, "- name: deferred root verification")
    .replace(bundlePublish, rootVerify)
    .replace("- name: deferred root verification", bundlePublish);
  assert.throws(() => validatePublishWorkflow(invalid), /must precede/);
});

test("artifact helper fixes the bundle inventory and verifies local plus registry installs", () => {
  const helper = readText("scripts/release-artifacts.mjs");
  for (const entry of [
    "cordis.patch.yml",
    "provider.mjs",
    "protocol.mjs",
    "tools.mjs",
    "skills.mjs",
    "skills-manifest.json",
    "skills/change-impact/SKILL.md",
    "skills/context-review/SKILL.md",
    "skills/pattern-review/SKILL.md",
    "skills/repo-research/SKILL.md",
    "skills/using-cortex/SKILL.md",
  ]) {
    assert.ok(helper.includes(`"${entry}"`), `missing bundle entry ${entry}`);
  }
  assert.match(helper, /assertTwins\("root"/);
  assert.match(helper, /assertTwins\("bundle"/);
  assert.match(helper, /empty-npm-cache/);
  assert.match(helper, /install-registry/);
  assert.match(helper, /harness-registry/);
  assert.match(helper, /mcp-context/);
  assert.match(helper, /root-context/);
  assert.match(helper, /load-ryu\.sh/);
  assert.match(helper, /runInstalledProfileGate/);
  assert.match(helper, /runNetworkDenied/);
  assert.match(helper, /corepack@0\.34\.0/);
  assert.match(helper, /prepare", "pnpm@11\.7\.0/);

  // The validator is on the workflow's real helper path. Removing any one
  // behavioral invocation from the driver's report must therefore fail the
  // pre-publication gate, not merely a source-string check.
  const complete = {
    profileBooted: true,
    pathUnableToSupplyCortex: true,
    outboundNetworkDenied: true,
    packageOwnedCli: "/isolated/profile/node_modules/@danielblomma/cortex-mcp/bin/cortex.mjs",
    indexedRoots: { count: 2, isolated: true },
    commands: { search: true, rules: true, related: true, impact: true },
    negative: { timeout: true, cancellation: true, malformed: true, oversized: true },
    discovery: { tools: [1, 2, 3, 4], skills: [1, 2, 3, 4, 5] },
    disposal: { firstAgent: true, secondAgent: true, bundle: true },
    webShutdown: true,
    profileRemoval: true,
  };
  assert.doesNotThrow(() => assertFinalHarnessEvidence(complete));
  const omissions = [
    ["profileBooted"],
    ["pathUnableToSupplyCortex"],
    ["outboundNetworkDenied"],
    ["indexedRoots", "count"],
    ["indexedRoots", "isolated"],
    ...["search", "rules", "related", "impact"].map((name) => ["commands", name]),
    ...["timeout", "cancellation", "malformed", "oversized"].map((name) => ["negative", name]),
    ...["firstAgent", "secondAgent", "bundle"].map((name) => ["disposal", name]),
    ["webShutdown"],
    ["profileRemoval"],
  ];
  for (const pathParts of omissions) {
    const missing = structuredClone(complete);
    let owner = missing;
    for (const part of pathParts.slice(0, -1)) owner = owner[part];
    delete owner[pathParts.at(-1)];
    assert.throws(
      () => assertFinalHarnessEvidence(missing),
      /final Harness evidence omits/,
      `removing ${pathParts.join(".")} must fail closed`,
    );
  }
  for (const collection of ["tools", "skills"]) {
    const missing = structuredClone(complete);
    missing.discovery[collection].pop();
    assert.throws(() => assertFinalHarnessEvidence(missing), /exact installed discovery/);
  }
});

test("release documentation distinguishes shipped explicit V1 from unavailable V2", () => {
  const readme = readText("README.md");
  const changelog = readText("CHANGELOG.md");
  assert.match(readme, /supports DeepSeek Harness through the V1 explicit tools and skills/);
  assert.match(readme, /dsh plugin --profile web add @danielblomma\/dsh-cortex/);
  assert.match(readme, /V2 proactive\/assistive retrieval remains planned and experimental/);
  assert.match(readme, /not\s+available in Cortex 2\.6\.0/);
  assert.match(changelog, /## 2\.6\.0 — 2026-08-30/);
  assert.match(changelog, /Proactive V2 retrieval is\n  not included in 2\.6\.0/);
});
