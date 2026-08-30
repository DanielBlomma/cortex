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

const supportedNpmVersion = "11.19.1";
const npmSetupStepName = "Install and verify supported npm CLI";
const bumpCredentialStepName = "Verify npm publication identity before mutation";
const bundlePublishStepName = "Publish exact DeepSeek Harness bundle second";

function stepBlock(source, name) {
  const marker = `      - name: ${name}`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing step ${name}`);
  const next = source.indexOf("\n      - name: ", start + marker.length);
  return source.slice(start, next < 0 ? source.length : next);
}

function swapStepNames(source, first, second) {
  const placeholder = "__CORTEX_RELEASE_STEP_SWAP__";
  return source
    .replace(`- name: ${first}`, `- name: ${placeholder}`)
    .replace(`- name: ${second}`, `- name: ${first}`)
    .replace(`- name: ${placeholder}`, `- name: ${second}`);
}

function validateSupportedNpmSetup(workflow, beforeStepName) {
  const setup = stepBlock(workflow, npmSetupStepName);
  assert.match(setup, new RegExp(`npm install --global npm@${supportedNpmVersion.replaceAll(".", "\\.")}`));
  assert.match(setup, new RegExp(`test "\\$\\(npm --version\\)" = "${supportedNpmVersion.replaceAll(".", "\\.")}"`));
  const [major, minor, patch] = supportedNpmVersion.split(".").map(Number);
  assert.ok(major === 11 && (minor > 5 || (minor === 5 && patch >= 1)));
  assertBefore(workflow, "- name: Setup Node", `- name: ${npmSetupStepName}`);
  assertBefore(workflow, `- name: ${npmSetupStepName}`, `- name: ${beforeStepName}`);
}

function validateStepScopedToken(workflow, allowedStepName) {
  const allowed = stepBlock(workflow, allowedStepName);
  const withoutAllowed = workflow.replace(allowed, "");
  assert.doesNotMatch(
    withoutAllowed,
    /secrets\.NPM_TOKEN|^\s+(?:NODE_AUTH_TOKEN|NPM_TOKEN):/m,
    "npm credential must not escape its single authorized step",
  );
  assert.match(
    allowed,
    /env:\n          NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/,
  );
  assert.doesNotMatch(allowed, /\b(?:echo|printf)\b[^\n]*(?:NODE_AUTH_TOKEN|NPM_TOKEN)/i);
  assert.doesNotMatch(allowed, /\bset\s+(?:-x|-o\s+xtrace)\b/);
  assert.doesNotMatch(allowed, /^\s*(?:env|printenv)\s*(?:$|[>|])/m);
  assert.doesNotMatch(allowed, /npm config (?:get|list|ls)/i);
  assert.doesNotMatch(allowed, /GITHUB_(?:OUTPUT|STEP_SUMMARY)|actions\/(?:cache|upload-artifact)/);
  assert.doesNotMatch(
    allowed,
    /^\s*(?:npm|node|gh|git|curl)\b[^\n]*(?:NODE_AUTH_TOKEN|NPM_TOKEN)/m,
    "npm credential must not be passed as a command argument",
  );
}

function validateBumpCredentialGate(workflow) {
  validateSupportedNpmSetup(workflow, bumpCredentialStepName);
  validateStepScopedToken(workflow, bumpCredentialStepName);
  const gate = stepBlock(workflow, bumpCredentialStepName);
  assert.match(gate, /if \[ -z "\$\{NODE_AUTH_TOKEN:-\}" \]; then/);
  assert.match(gate, /npm whoami --registry=https:\/\/registry\.npmjs\.org\//);
  assert.match(gate, /value !== "danielblomma\\n"/);
  assert.match(gate, /env -u NODE_AUTH_TOKEN node/);
  for (const mutationStep of [
    "Install all committed dependency trees",
    "Create exact 2.6.0 metadata and root artifact lock",
    "Stage only the complete release metadata set",
    "Commit and create immutable release tag",
  ]) {
    assertBefore(workflow, `- name: ${bumpCredentialStepName}`, `- name: ${mutationStep}`);
  }
  assertBefore(workflow, `- name: ${bumpCredentialStepName}`, "npm version minor");
  assertBefore(workflow, `- name: ${bumpCredentialStepName}`, "sync-release-version.mjs --root-tarball");
  assertBefore(workflow, `- name: ${bumpCredentialStepName}`, "git add ");
  assertBefore(workflow, `- name: ${bumpCredentialStepName}`, "git commit -m");
  assertBefore(workflow, `- name: ${bumpCredentialStepName}`, "git tag -a");
}

function validatePublishAuthentication(workflow) {
  assert.match(workflow, /permissions:\n  contents: read\n  id-token: write/);
  assert.match(workflow, /jobs:\n  publish:\n    runs-on: ubuntu-latest/);
  validateSupportedNpmSetup(workflow, "Verify annotated tag and all metadata versions");

  const rootPublish = stepBlock(workflow, "Publish exact root artifact first");
  assert.match(rootPublish, /if: steps\.registry\.outputs\.root_state == 'missing'/);
  assert.match(rootPublish, /--access public --provenance/);
  assert.doesNotMatch(rootPublish, /NPM_TOKEN|NODE_AUTH_TOKEN|secrets\./);

  const bundlePublish = stepBlock(workflow, bundlePublishStepName);
  validateStepScopedToken(workflow, bundlePublishStepName);
  assert.match(bundlePublish, /if: steps\.registry\.outputs\.bundle_state == 'missing'/);
  assert.match(bundlePublish, /if \[ -z "\$\{NODE_AUTH_TOKEN:-\}" \]; then/);
  assert.match(bundlePublish, /--access public --provenance/);
  assertBefore(workflow, "- name: Inspect registry for safe immutable resume", `- name: ${bundlePublishStepName}`);
  assertBefore(workflow, "- name: Verify exact root registry artifact before bundle publication", `- name: ${bundlePublishStepName}`);
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
  validateBumpCredentialGate(workflow);
}

function validatePublishWorkflow(workflow) {
  assertBefore(workflow, "- name: Reject branch dispatches and non-strict tags", "- name: Checkout immutable tag");
  assert.match(workflow, /test "\$\{GITHUB_REF_TYPE\}" = "tag"/);
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
  const registry = stepBlock(workflow, "Inspect registry for safe immutable resume");
  assert.match(registry, /--package-name @danielblomma\/cortex-mcp[\s\S]*?--integrity "\$\{ROOT_INTEGRITY\}"/);
  assert.match(registry, /--package-name @danielblomma\/dsh-cortex[\s\S]*?--integrity "\$\{BUNDLE_INTEGRITY\}"[\s\S]*?--root-dependency "\$\{RELEASE_VERSION\}"/);
  assert.match(registry, /"\$\{ROOT_STATE\}" = "missing"[\s\S]*?"\$\{BUNDLE_STATE\}" = "exact"/);
  assert.match(workflow, /Run full root and bundle tests[\s\S]*?CORTEX_EXPECTED_RELEASE_VERSION: \$\{\{ steps\.version\.outputs\.value \}\}[\s\S]*?run: npm test/);
  assertBefore(workflow, "- name: Prepare isolated repository test context", "- name: Run full root and bundle tests");
  assert.match(workflow, /release:prepare-root-test-context/);
  assert.match(workflow, /release:test-fresh-checkout/);
  assertBefore(workflow, "- name: Prepare isolated MCP test context", "- name: Run context runtime and MCP compatibility tests");
  assert.match(workflow, /release:prepare-mcp-test-context/);
  assert.match(workflow, /npm publish "\$\{\{ steps\.artifacts\.outputs\.root_tarball \}\}"/);
  assert.match(workflow, /npm publish "\$\{\{ steps\.artifacts\.outputs\.bundle_tarball \}\}"/);
  assert.doesNotMatch(workflow, /@latest/);
  validatePublishAuthentication(workflow);
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

test("release workflows reject absent, unsupported, or late npm setup", () => {
  const bump = readText(".github/workflows/release-bump.yml");
  const publish = readText(".github/workflows/release-publish.yml");
  const setupMarker = `- name: ${npmSetupStepName}`;
  for (const [candidate, validator] of [
    [bump.replace(setupMarker, "- name: omitted npm setup"), validateBumpWorkflow],
    [bump.replaceAll(supportedNpmVersion, "11.5.0"), validateBumpWorkflow],
    [swapStepNames(bump, npmSetupStepName, bumpCredentialStepName), validateBumpWorkflow],
    [publish.replace(setupMarker, "- name: omitted npm setup"), validatePublishWorkflow],
    [publish.replaceAll(supportedNpmVersion, "10.9.8"), validatePublishWorkflow],
  ]) {
    assert.throws(() => validator(candidate));
  }
});

test("release bump credential gate rejects auth and ordering mutations", () => {
  const workflow = readText(".github/workflows/release-bump.yml");
  const gateMarker = `- name: ${bumpCredentialStepName}`;
  const mutations = [
    workflow.replace(gateMarker, "- name: omitted credential gate"),
    workflow.replace('if [ -z "${NODE_AUTH_TOKEN:-}" ]; then', "if false; then"),
    workflow.replace('value !== "danielblomma\\n"', 'value !== "another-owner\\n"'),
    workflow.replace("npm whoami --registry=https://registry.npmjs.org/", "npm whoami"),
    swapStepNames(
      workflow,
      bumpCredentialStepName,
      "Create exact 2.6.0 metadata and root artifact lock",
    ),
  ];
  for (const invalid of mutations) {
    assert.throws(() => validateBumpWorkflow(invalid));
  }
});

test("release workflows reject broadened or observable npm credentials", () => {
  const bump = readText(".github/workflows/release-bump.yml");
  const publish = readText(".github/workflows/release-publish.yml");
  const invalid = [
    [bump.replace("    env:\n      BASE_VERSION", "    env:\n      NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}\n      BASE_VERSION"), validateBumpWorkflow],
    [bump.replace("- name: Run focused release contract tests", "- name: Run focused release contract tests\n        env:\n          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}"), validateBumpWorkflow],
    [bump.replace("          set -o pipefail", '          echo "${NODE_AUTH_TOKEN}"\n          set -o pipefail'), validateBumpWorkflow],
    [bump.replace("          set -o pipefail", '          printf "%s" "${NODE_AUTH_TOKEN}"\n          set -o pipefail'), validateBumpWorkflow],
    [bump.replace("          set -o pipefail", "          set -x\n          set -o pipefail"), validateBumpWorkflow],
    [bump.replace("          set -o pipefail", "          printenv\n          set -o pipefail"), validateBumpWorkflow],
    [bump.replace("          set -o pipefail", "          npm config list\n          set -o pipefail"), validateBumpWorkflow],
    [bump.replace("          set -o pipefail", '          npm whoami "${NODE_AUTH_TOKEN}"\n          set -o pipefail'), validateBumpWorkflow],
    [publish.replace("    env:\n      HARNESS_COMMIT", "    env:\n      NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}\n      HARNESS_COMMIT"), validatePublishWorkflow],
    [publish.replace("          npm publish \"${{ steps.artifacts.outputs.bundle_tarball }}\"", '          echo "${NODE_AUTH_TOKEN}" >> "${GITHUB_OUTPUT}"\n          npm publish "${{ steps.artifacts.outputs.bundle_tarball }}"'), validatePublishWorkflow],
    [publish.replace("          npm publish \"${{ steps.artifacts.outputs.bundle_tarball }}\"", '          echo "${NODE_AUTH_TOKEN}" >> "${GITHUB_STEP_SUMMARY}"\n          npm publish "${{ steps.artifacts.outputs.bundle_tarball }}"'), validatePublishWorkflow],
    [publish.replace("          npm publish \"${{ steps.artifacts.outputs.bundle_tarball }}\"", "          uses: actions/cache@v4\n          npm publish \"${{ steps.artifacts.outputs.bundle_tarball }}\""), validatePublishWorkflow],
    [publish.replace("          npm publish \"${{ steps.artifacts.outputs.bundle_tarball }}\"", "          uses: actions/upload-artifact@v4\n          npm publish \"${{ steps.artifacts.outputs.bundle_tarball }}\""), validatePublishWorkflow],
  ];
  for (const [candidate, validator] of invalid) {
    assert.throws(() => validator(candidate));
  }
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

test("release publish rejects OIDC, provenance, runner, fallback, and resume mutations", () => {
  const workflow = readText(".github/workflows/release-publish.yml");
  const mutations = [
    workflow.replace("id-token: write", "id-token: none"),
    workflow.replace("runs-on: ubuntu-latest", "runs-on: self-hosted"),
    workflow.replace('npm publish "${{ steps.artifacts.outputs.root_tarball }}" --access public --provenance', 'npm publish "${{ steps.artifacts.outputs.root_tarball }}" --access public'),
    workflow.replace('npm publish "${{ steps.artifacts.outputs.bundle_tarball }}" --access public --provenance', 'npm publish "${{ steps.artifacts.outputs.bundle_tarball }}" --access public'),
    workflow.replace("      - name: Publish exact root artifact first\n", "      - name: Publish exact root artifact first\n        env:\n          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}\n"),
    workflow.replace("          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}", "          BOOTSTRAP_DISABLED: true"),
    workflow.replace("if: steps.registry.outputs.bundle_state == 'missing'", "if: always()"),
    workflow.replace('--integrity "${ROOT_INTEGRITY}"', '--integrity "unchecked"'),
    workflow.replace('test "${GITHUB_REF_TYPE}" = "tag"', 'test "${GITHUB_REF_TYPE}" = "branch"'),
    workflow.replace("^v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$", "^v.*$"),
    workflow.replace('test "${TAG_VERSION}" = "${BUNDLE_DEPENDENCY}"', "true # mutable dependency accepted"),
    workflow.replace("@danielblomma/dsh-cortex", "@danielblomma/dsh-cortex@latest"),
  ];
  for (const invalid of mutations) {
    assert.throws(() => validatePublishWorkflow(invalid));
  }
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
