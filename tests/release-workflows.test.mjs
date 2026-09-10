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
const rootPublishStepName = "Publish exact reviewed root artifact";
const rootRegistryStepName = "Inspect exact registry state for safe immutable resume";
const bundlePackageName = "@danielblomma/dsh-cortex";

function stepBlock(source, name) {
  const marker = `      - name: ${name}`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing step ${name}`);
  const next = source.indexOf("\n      - name: ", start + marker.length);
  return source.slice(start, next < 0 ? source.length : next);
}

function swapSteps(source, first, second) {
  const firstBlock = stepBlock(source, first);
  const secondBlock = stepBlock(source, second);
  const placeholder = "__CORTEX_RELEASE_STEP_SWAP__";
  return source.replace(firstBlock, placeholder).replace(secondBlock, firstBlock).replace(placeholder, secondBlock);
}

function replaceInStep(source, name, from, to) {
  const block = stepBlock(source, name);
  assert.ok(block.includes(from), `missing ${from} in step ${name}`);
  return source.replace(block, block.replace(from, to));
}

function insertWorkflowStep(source, beforeStepName, name, commands) {
  const marker = `      - name: ${beforeStepName}`;
  assert.ok(source.includes(marker), `missing insertion point ${beforeStepName}`);
  const commandBlock = commands.map((command) => `          ${command}`).join("\n");
  return source.replace(
    marker,
    `      - name: ${name}\n        run: |\n${commandBlock}\n\n${marker}`,
  );
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

function validateNoNpmCredentials(workflow) {
  assert.doesNotMatch(
    workflow,
    /NPM_TOKEN|NODE_AUTH_TOKEN|npm\s+whoami|_authToken|npm\s+(?:login|adduser)|token fallback/i,
    "release workflows must use root trusted publishing without token or login paths",
  );
}

function validatePublicationCommands(workflow) {
  // Publication is allowed only for the two artifacts already validated locally.
  const commands = workflow.split("\n").filter((line) => /\bnpm (?:publish|view)\b/.test(line));
  assert.deepEqual(commands.map((line) => line.trim()), [
    'run: npm publish "${{ steps.artifacts.outputs.root_tarball }}" --access public --provenance',
    'run: npm publish "${{ steps.artifacts.outputs.bundle_tarball }}" --access public --provenance',
  ]);
}

const requiredGateCommands = [
  ["Build trusted context runtime", "npm --prefix scaffold/mcp run build"],
  ["Run focused release contract tests", "npm run release:test"],
  ["Prepare isolated repository test context", "npm run release:prepare-root-test-context"],
  ["Run full root and bundle tests", "run: npm test"],
  ["Prepare isolated MCP test context", "npm run release:prepare-mcp-test-context"],
  ["Run context runtime and MCP compatibility tests", "npm --prefix scaffold/mcp run test:ci"],
  ["Audit all six committed dependency trees", "npm run audit:dependencies"],
  ["Audit all six committed dependency trees", "npm audit --package-lock-only --audit-level=low --prefix plugins/dsh-cortex"],
  ["Validate packed filesystem containment", "npm run release:packed-containment"],
  ["Build frontend", "npm --prefix frontend run build"],
  ["Verify pinned DeepSeek Harness contract", 'node scripts/check-deepseek-harness-compatibility.mjs --checkout "${HARNESS_CHECKOUT}"'],
  ["Run packed Harness headless and Web lifecycle", "node scripts/release-artifacts.mjs harness"],
];

function validateRequiredGateCommands(workflow) {
  for (const [name, command] of requiredGateCommands) {
    const gate = stepBlock(workflow, name);
    assert.ok(gate.includes(command), `missing executable gate command: ${command}`);
    assert.doesNotMatch(gate, /continue-on-error:|\|\|\s*true|set \+e|if:/, `gate ${name} must fail closed`);
  }
}

function validateArtifactGates(workflow, publish) {
  const packName = publish ? "Recreate and verify the reviewed local artifacts" : "Create and verify duplicate local root and bundle artifacts";
  const installName = publish ? "Install both reviewed local artifacts with an empty cache" : "Install both local artifacts with an empty cache";
  const pack = stepBlock(workflow, packName);
  assert.match(pack, /node scripts\/release-artifacts\.mjs pack/);
  assert.match(pack, /--expected-version "\$\{RELEASE_VERSION\}"/);
  assert.match(pack, /--report "\$\{ARTIFACT_DIR\}\/report\.json"/);
  for (const [name, command] of [[installName, "install"], ["Run packed Harness headless and Web lifecycle", "harness"]]) {
    const gate = stepBlock(workflow, name);
    assert.ok(gate.includes(`node scripts/release-artifacts.mjs ${command}`));
    for (const artifact of ["root", "bundle"]) {
      assert.ok(gate.includes(`${artifact.toUpperCase()}_TARBALL: \${{ steps.artifacts.outputs.${artifact}_tarball }}`));
      assert.ok(gate.includes(`--${artifact}-tarball "\${${artifact.toUpperCase()}_TARBALL}"`));
    }
    assert.match(gate, /--expected-version "\$\{RELEASE_VERSION\}"/);
    assert.doesNotMatch(gate, /continue-on-error:|\|\|\s*true|set \+e|if:/);
    assertBefore(workflow, `- name: ${packName}`, `- name: ${name}`);
  }
  assert.doesNotMatch(pack, /continue-on-error:|\|\|\s*true|set \+e|if:/);
  if (publish) {
    for (const artifact of ["root", "bundle"]) {
      assert.ok(pack.includes(`test "\${${artifact.toUpperCase()}_INTEGRITY}" = "\${{ steps.seed.outputs.${artifact}_integrity }}"`));
    }
  }
}

function validateFreshCheckoutGate(workflow, expectedVersionMapping) {
  const stepName = "Run executable fresh-checkout regression";
  const gate = stepBlock(workflow, stepName);
  const mapping = `          CORTEX_EXPECTED_RELEASE_VERSION: ${expectedVersionMapping}`;
  assert.equal(
    gate.split(mapping).length - 1,
    1,
    "fresh-checkout gate must contain one exact expected-version mapping",
  );
  assertBefore(gate, "        env:\n", mapping);
  assertBefore(gate, mapping, "        run: |");
  assert.match(gate, /git clean -fdx \.context scaffold\/\.context/);
  assert.match(gate, /git restore \.context scaffold\/\.context/);
  assert.match(gate, /^\s+npm run release:test-fresh-checkout\s*$/m);
  assert.doesNotMatch(
    gate,
    /^\s*(?:export\s+)?CORTEX_EXPECTED_RELEASE_VERSION=/m,
    "fresh-checkout expected version must not bypass the step env mapping",
  );
  assert.doesNotMatch(gate, /^\s+npm test\s*$/m, "fresh-checkout gate must not dump an unbounded direct root test");
  assert.doesNotMatch(gate, /continue-on-error:|\|\|\s*true|set \+e|if:\s*always\(\)/, "fresh-checkout gate must fail closed");
  assertBefore(workflow, "- name: Run context runtime and MCP compatibility tests", `- name: ${stepName}`);
  assertBefore(workflow, `- name: ${stepName}`, "- name: Audit all six committed dependency trees");
}

function validatePublishAuthentication(workflow) {
  assert.match(workflow, /permissions:\n  contents: read\n  id-token: write/);
  assert.match(workflow, /jobs:\n  publish:\n    runs-on: ubuntu-latest/);
  validateSupportedNpmSetup(workflow, "Verify annotated tag and all metadata versions");

  const rootPublish = stepBlock(workflow, rootPublishStepName);
  assert.match(rootPublish, /if: steps\.registry\.outputs\.root_state == 'missing'/);
  assert.match(rootPublish, /--access public --provenance/);
  assert.doesNotMatch(rootPublish, /env:|secrets\./);
  const bundlePublish = stepBlock(workflow, "Publish exact reviewed DeepSeek Harness bundle");
  assert.match(bundlePublish, /if: steps\.registry\.outputs\.bundle_state == 'missing'/);
  assert.match(bundlePublish, /--access public --provenance/);
  assert.doesNotMatch(bundlePublish, /env:|secrets\./);
  validatePublicationCommands(workflow);
  validateNoNpmCredentials(workflow);
}

const synchronizedFiles = [
  "package.json",
  "package-lock.json",
  "server.json",
  "plugins/cortex/.claude-plugin/plugin.json",
  "plugins/cortex/.codex-plugin/plugin.json",
  "plugins/dsh-cortex/package.json",
  "plugins/dsh-cortex/package-lock.json",
  ".claude-plugin/marketplace.json",
];

function validateBumpWorkflow(workflow) {
  validateRequiredGateCommands(workflow);
  validateArtifactGates(workflow, false);
  validateFreshCheckoutGate(workflow, "${{ env.RELEASE_VERSION }}");
  assertBefore(workflow, "- name: Reject non-main dispatch", "- name: Checkout current main");
  assert.match(workflow, /BASE_VERSION: "2\.7\.0"/);
  assert.match(workflow, /RELEASE_VERSION: "2\.8\.0"/);
  assert.match(workflow, /test "\$\{RELEASE_TYPE\}" = "minor"/);
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$\(git rev-parse origin\/main\)"/);
  assert.match(workflow, /sync-release-version\.mjs --root-tarball/);
  const mutationSet = stepBlock(workflow, "Verify complete metadata mutation set");
  const stagedSet = stepBlock(workflow, "Stage only the complete release metadata set");
  for (const file of synchronizedFiles) {
    assert.ok(mutationSet.includes(file), `release bump omits mutated metadata file ${file}`);
    assert.ok(stagedSet.includes(file), `release bump omits staged metadata file ${file}`);
  }
  assert.doesNotMatch(mutationSet, /mcp-registry-submission\.json/);
  assert.doesNotMatch(stagedSet, /mcp-registry-submission\.json/);
  for (const gate of [
    "Run focused release contract tests",
    "Prepare isolated repository test context",
    "Run full root and bundle tests",
    "Prepare isolated MCP test context",
    "Run context runtime and MCP compatibility tests",
    "Audit all six committed dependency trees",
    "Validate packed filesystem containment",
    "Build frontend",
    "Verify pinned DeepSeek Harness contract",
    "Create and verify duplicate local root and bundle artifacts",
    "Install both local artifacts with an empty cache",
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
  validateSupportedNpmSetup(workflow, "Create exact release metadata and root artifact lock");
  validateNoNpmCredentials(workflow);
  assert.doesNotMatch(workflow, /\bnpm publish\b/i, "release bump must not publish any artifact");
  assert.doesNotMatch(workflow, /release-artifacts\.mjs registry-state/);
}

function validatePublishWorkflow(workflow) {
  validateRequiredGateCommands(workflow);
  validateArtifactGates(workflow, true);
  validateFreshCheckoutGate(workflow, "${{ steps.version.outputs.value }}");
  assertBefore(workflow, "- name: Reject branch dispatches and non-strict tags", "- name: Checkout immutable tag");
  assert.match(workflow, /test "\$\{GITHUB_REF_TYPE\}" = "tag"/);
  assert.match(workflow, /\^v\(0\|\[1-9\]\[0-9\]\*\)\\\.\(0\|\[1-9\]\[0-9\]\*\)\\\.\(0\|\[1-9\]\[0-9\]\*\)\$/);
  assert.match(workflow, /test "\$\(git cat-file -t "\$\{TAG_NAME\}"\)" = "tag"/);
  assert.match(workflow, /test "\$\(git rev-list -n 1 "\$\{TAG_NAME\}"\)" = "\$\(git rev-parse HEAD\)"/);
  assert.match(workflow, /test -z "\$\(git status --porcelain\)"/);
  assert.match(workflow, /test "\$\{TAG_VERSION\}" = "\$\{ROOT_VERSION\}"/);
  assertBefore(workflow, 'test "${TAG_VERSION}" = "${BUNDLE_DEPENDENCY}"', "- name: Install five committed dependency trees");
  for (const gate of [
    "Run focused release contract tests",
    "Prepare isolated repository test context",
    "Run full root and bundle tests",
    "Prepare isolated MCP test context",
    "Run context runtime and MCP compatibility tests",
    "Audit all six committed dependency trees",
    "Validate packed filesystem containment",
    "Build frontend",
    "Verify pinned DeepSeek Harness contract",
    "Recreate and verify the reviewed local artifacts",
    "Install both reviewed local artifacts with an empty cache",
    "Run packed Harness headless and Web lifecycle",
    "Run executable fresh-checkout regression",
  ]) {
    assertBefore(workflow, `- name: ${gate}`, `- name: ${rootPublishStepName}`);
  }
  assertBefore(workflow, `- name: ${rootRegistryStepName}`, `- name: ${rootPublishStepName}`);
  assertBefore(workflow, `- name: ${rootPublishStepName}`, "- name: Verify exact root registry artifact");
  assertBefore(workflow, "- name: Verify exact root registry artifact", "- name: Run fresh empty-cache root-only registry smoke");
  assert.match(workflow, /if: steps\.registry\.outputs\.root_state == 'missing'/);
  assert.match(workflow, /release-artifacts\.mjs registry-state/);
  const registry = stepBlock(workflow, rootRegistryStepName);
  assert.match(registry, /--package-name @danielblomma\/cortex-mcp[\s\S]*?--integrity "\$\{ROOT_INTEGRITY\}"/);
  assert.match(registry, /root_state=\$\{ROOT_STATE\}/);
  assert.match(registry, /--package-name @danielblomma\/dsh-cortex[\s\S]*?--integrity "\$\{BUNDLE_INTEGRITY\}"[\s\S]*?--root-dependency "\$\{RELEASE_VERSION\}"/);
  assert.match(registry, /bundle_state=\$\{BUNDLE_STATE\}/);
  assertBefore(workflow, "- name: Verify exact root registry artifact", "- name: Publish exact reviewed DeepSeek Harness bundle");
  assertBefore(workflow, "- name: Publish exact reviewed DeepSeek Harness bundle", "- name: Verify exact DeepSeek Harness bundle registry artifact");
  const bundleVerification = stepBlock(workflow, "Verify exact DeepSeek Harness bundle registry artifact");
  assert.match(bundleVerification, /--integrity "\$\{BUNDLE_INTEGRITY\}"/);
  assert.match(bundleVerification, /--root-dependency "\$\{RELEASE_VERSION\}"/);
  assert.match(bundleVerification, /for attempt in \$\(seq 1 12\)/);
  assert.match(bundleVerification, /\)" = "exact"/);
  assert.match(workflow, /Run full root and bundle tests[\s\S]*?CORTEX_EXPECTED_RELEASE_VERSION: \$\{\{ steps\.version\.outputs\.value \}\}[\s\S]*?run: npm test/);
  assertBefore(workflow, "- name: Prepare isolated repository test context", "- name: Run full root and bundle tests");
  assert.match(workflow, /release:prepare-root-test-context/);
  assert.match(workflow, /release:test-fresh-checkout/);
  assertBefore(workflow, "- name: Prepare isolated MCP test context", "- name: Run context runtime and MCP compatibility tests");
  assert.match(workflow, /release:prepare-mcp-test-context/);
  assert.match(workflow, /npm publish "\$\{\{ steps\.artifacts\.outputs\.root_tarball \}\}"/);
  const verification = stepBlock(workflow, "Verify exact root registry artifact");
  assert.match(verification, /for attempt in \$\(seq 1 12\)/);
  assert.match(verification, /--package-name @danielblomma\/cortex-mcp/);
  assert.match(verification, /--integrity "\$\{ROOT_INTEGRITY\}"/);
  assert.match(verification, /\)" = "exact"/);
  const registrySmoke = stepBlock(workflow, "Run fresh empty-cache root-only registry smoke");
  assert.match(registrySmoke, /--cache "\$\{GLOBAL_CACHE\}"/);
  assert.match(registrySmoke, /@danielblomma\/cortex-mcp@\$\{RELEASE_VERSION\}/);
  assert.match(registrySmoke, /\/bin\/cortex" --version/);
  assert.doesNotMatch(registrySmoke, /dsh-cortex|install-registry|harness-registry/);
  assertBefore(workflow, "- name: Verify exact DeepSeek Harness bundle registry artifact", "- name: Record immutable release evidence");
  for (const [name, command] of [
    ["Install both registry artifacts with an empty cache", "install-registry"],
    ["Run registry Harness headless and Web lifecycle", "harness-registry"],
  ]) {
    const gate = stepBlock(workflow, name);
    assert.ok(gate.includes(`node scripts/release-artifacts.mjs ${command}`));
    assert.match(gate, /RELEASE_VERSION: \$\{\{ steps\.version\.outputs\.value \}\}/);
    assert.match(gate, /--expected-version "\$\{RELEASE_VERSION\}"/);
    assert.doesNotMatch(gate, /continue-on-error:|\|\|\s*true|set \+e|if:/);
    assertBefore(workflow, "- name: Verify exact DeepSeek Harness bundle registry artifact", `- name: ${name}`);
    assertBefore(workflow, `- name: ${name}`, "- name: Record immutable release evidence");
  }
  const summary = stepBlock(workflow, "Record immutable release evidence");
  assert.match(summary, /published npm artifact: @danielblomma\/dsh-cortex@\$\{RELEASE_VERSION\}/);
  assert.doesNotMatch(workflow, /@latest/);
  validatePublishAuthentication(workflow);
}

function validateReleaseDocumentation(readme, changelog) {
  const combined = `${readme}\n${changelog}`;
  assert.match(readme, /Cortex 2\.6\.0 contains and validates the integration source/);
  assert.match(readme, /Separate npm bundle distribution is\s+deferred and currently unavailable/);
  assert.match(changelog, /Separate npm bundle\s+distribution[^.]*deferred and currently\s+unavailable/);
  assert.match(readme, /V2 proactive\/assistive retrieval remains planned and experimental/);
  assert.match(readme, /not\s+included in Cortex 2\.6\.0/);
  assert.match(changelog, /Proactive V2 retrieval is\s+not included in 2\.6\.0/);
  assert.doesNotMatch(combined, /dsh plugin[^\n]*@danielblomma\/dsh-cortex/i);
  assert.doesNotMatch(combined, /npm (?:install|i|uninstall|remove)[^\n]*@danielblomma\/dsh-cortex/i);
  assert.doesNotMatch(combined, /(?:publicly|registry)[ -]available[^\n]*dsh-cortex|dsh-cortex[^\n]*(?:publicly|registry)[ -]available/i);
  assert.doesNotMatch(
    combined,
    /@danielblomma\/dsh-cortex[^\n.!?]*(?:available\s+(?:from|on|via|through)\s+(?:the\s+)?npm|published\s+(?:to|on|via|through)\s+(?:the\s+)?npm)|(?:available\s+(?:from|on|via|through)\s+(?:the\s+)?npm|published\s+(?:to|on|via|through)\s+(?:the\s+)?npm)[^\n.!?]*@danielblomma\/dsh-cortex/i,
    "release documentation must not claim that the bundle is available or published on npm",
  );
}

test("committed candidate keeps every root and bundle version synchronized", () => {
  const expectedVersion = process.env.CORTEX_EXPECTED_RELEASE_VERSION ?? readJson("package.json").version;
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
  const bump = readText(".github/workflows/release-bump.yml");
  validateBumpWorkflow(bump);
  for (const [workflow, validator, mapping] of [
    [bump, validateBumpWorkflow, "${{ env.RELEASE_VERSION }}"],
    [readText(".github/workflows/release-publish.yml"), validatePublishWorkflow, "${{ steps.version.outputs.value }}"],
  ]) {
    validator(workflow);
    for (const [name, command] of requiredGateCommands) {
      const missing = replaceInStep(workflow, name, command, "echo gate omitted");
      assert.throws(() => validator(missing), /missing executable gate command/);
      const bypass = replaceInStep(workflow, name, command, `${command} || true`);
      assert.throws(() => validator(bypass), /must fail closed/);
    }
    const artifactNames = validator === validateBumpWorkflow
      ? ["Create and verify duplicate local root and bundle artifacts", "Install both local artifacts with an empty cache"]
      : ["Recreate and verify the reviewed local artifacts", "Install both reviewed local artifacts with an empty cache"];
    for (const name of [...artifactNames, "Run packed Harness headless and Web lifecycle"]) {
      const gate = stepBlock(workflow, name);
      const omitted = workflow.replace(gate, `      - name: ${name}\n        run: echo gate omitted\n`);
      assert.throws(() => validator(omitted));
    }
    for (const name of [artifactNames[1], "Run packed Harness headless and Web lifecycle"]) {
      for (const artifact of ["root", "bundle"]) {
        const invalid = replaceInStep(workflow, name, `\${{ steps.artifacts.outputs.${artifact}_tarball }}`, "unreviewed.tgz");
        assert.throws(() => validator(invalid));
      }
    }
    if (validator === validatePublishWorkflow) {
      for (const artifact of ["root", "bundle"]) {
        const invalid = replaceInStep(workflow, artifactNames[0], `\${{ steps.seed.outputs.${artifact}_integrity }}`, "unchecked");
        assert.throws(() => validator(invalid));
      }
    }
    const mappingBlock = `        env:\n          CORTEX_EXPECTED_RELEASE_VERSION: ${mapping}\n`;
    const freshCheckoutStep = "Run executable fresh-checkout regression";
    const mutations = [
      ["removed helper", workflow.replace("- name: Run executable fresh-checkout regression", "- name: Removed fresh-checkout regression")],
      ["unbounded replacement", workflow.replace("npm run release:test-fresh-checkout", "npm test")],
      ["fail-open bypass", workflow.replace("npm run release:test-fresh-checkout", "npm run release:test-fresh-checkout || true")],
      ["late helper", swapSteps(workflow, "Run executable fresh-checkout regression", "Audit all six committed dependency trees")],
      ["missing mapping", replaceInStep(workflow, freshCheckoutStep, mappingBlock, "")],
      ["drifted mapping", replaceInStep(workflow, freshCheckoutStep, mapping, "${{ env.BASE_VERSION }}")],
      ["inline mapping bypass", replaceInStep(
        replaceInStep(workflow, freshCheckoutStep, mappingBlock, ""),
        freshCheckoutStep,
        "          npm run release:test-fresh-checkout",
        `          CORTEX_EXPECTED_RELEASE_VERSION=${mapping} npm run release:test-fresh-checkout`,
      )],
      ["mapping after helper", replaceInStep(workflow, freshCheckoutStep,
        "          npm run release:test-fresh-checkout",
        `          npm run release:test-fresh-checkout\n          CORTEX_EXPECTED_RELEASE_VERSION: ${mapping}`,
      )],
    ];
    for (const [name, invalid] of mutations) {
      assert.throws(() => validator(invalid), undefined, `${name} mutation must fail closed`);
    }
  }
});

test("release bump regression validator rejects omitted bundle lock staging", () => {
  const workflow = readText(".github/workflows/release-bump.yml").replaceAll(
    "plugins/dsh-cortex/package-lock.json",
    "plugins/dsh-cortex/omitted-lock.json",
  );
  assert.throws(() => validateBumpWorkflow(workflow), /omits (?:mutated|staged) metadata file/);
});

test("release workflows reject absent, unsupported, or late npm setup", () => {
  const bump = readText(".github/workflows/release-bump.yml");
  const publish = readText(".github/workflows/release-publish.yml");
  const setupMarker = `- name: ${npmSetupStepName}`;
  for (const [candidate, validator] of [
    [bump.replace(setupMarker, "- name: omitted npm setup"), validateBumpWorkflow],
    [bump.replaceAll(supportedNpmVersion, "11.5.0"), validateBumpWorkflow],
    [swapSteps(bump, npmSetupStepName, "Create exact release metadata and root artifact lock"), validateBumpWorkflow],
    [publish.replace(setupMarker, "- name: omitted npm setup"), validatePublishWorkflow],
    [publish.replaceAll(supportedNpmVersion, "10.9.8"), validatePublishWorkflow],
    [swapSteps(publish, npmSetupStepName, "Verify annotated tag and all metadata versions"), validatePublishWorkflow],
  ]) {
    assert.throws(() => validator(candidate));
  }
});

test("release workflows reject every npm credential and login path", () => {
  const bump = readText(".github/workflows/release-bump.yml");
  const publish = readText(".github/workflows/release-publish.yml");
  const marker = "      HARNESS_COMMIT:";
  const mutations = [
    [bump, "      NPM_TOKEN: ${{ secrets.NPM_TOKEN }}\n"],
    [publish, "      NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}\n"],
    [bump, "      AUTH_CHECK: npm whoami\n"],
    [publish, "      AUTH_CONFIG: //registry.npmjs.org/:_authToken=placeholder\n"],
    [bump, "      LOGIN_COMMAND: npm login\n"],
    [publish, "      LOGIN_COMMAND: npm adduser\n"],
    [publish, "      AUTH_MODE: token fallback\n"],
  ];
  for (const [workflow, insertion] of mutations) {
    const candidate = workflow.includes(marker)
      ? workflow.replace(marker, `${insertion}${marker}`)
      : workflow.replace("      BASE_VERSION:", `${insertion}      BASE_VERSION:`);
    const validator = workflow === bump ? validateBumpWorkflow : validatePublishWorkflow;
    assert.throws(() => validator(candidate), /trusted publishing without token or login paths/);
  }
});

test("release publish is tag-only, root-first, exact-artifact, and resumable", () => {
  validatePublishWorkflow(readText(".github/workflows/release-publish.yml"));
});

test("release publish rejects publication before local artifact and Harness gates", () => {
  const workflow = readText(".github/workflows/release-publish.yml");
  const invalid = swapSteps(
    workflow,
    rootPublishStepName,
    "Run packed Harness headless and Web lifecycle",
  );
  assert.throws(() => validatePublishWorkflow(invalid), /must precede/);
});

test("release publish rejects OIDC, provenance, runner, tag, version, and resume mutations", () => {
  const workflow = readText(".github/workflows/release-publish.yml");
  const mutations = [
    workflow.replace("id-token: write", "id-token: none"),
    workflow.replace("runs-on: ubuntu-latest", "runs-on: self-hosted"),
    workflow.replace('npm publish "${{ steps.artifacts.outputs.root_tarball }}" --access public --provenance', 'npm publish "${{ steps.artifacts.outputs.root_tarball }}" --access public'),
    workflow.replace("if: steps.registry.outputs.root_state == 'missing'", "if: always()"),
    workflow.replace('--integrity "${ROOT_INTEGRITY}"', '--integrity "unchecked"'),
    workflow.replace('test "${GITHUB_REF_TYPE}" = "tag"', 'test "${GITHUB_REF_TYPE}" = "branch"'),
    workflow.replace("^v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$", "^v.*$"),
    workflow.replace('test "$(git cat-file -t "${TAG_NAME}")" = "tag"', "true # lightweight tag accepted"),
    workflow.replace('test "${TAG_VERSION}" = "${ROOT_VERSION}"', "true # tag/root drift accepted"),
    workflow.replace('test "${TAG_VERSION}" = "${BUNDLE_DEPENDENCY}"', "true # mutable dependency accepted"),
  ];
  for (const invalid of mutations) {
    assert.throws(() => validatePublishWorkflow(invalid));
  }
});

test("release workflows reject unreviewed bundle publication and unsafe resume mutations", () => {
  const bump = readText(".github/workflows/release-bump.yml");
  const workflow = readText(".github/workflows/release-publish.yml");
  validateBumpWorkflow(bump);
  validatePublishWorkflow(workflow);
  for (const [source, validator] of [[bump, validateBumpWorkflow], [workflow, validatePublishWorkflow]]) {
    const invalid = insertWorkflowStep(source, "Setup .NET", "Unreviewed bundle mutation", [
      `npm publish ${bundlePackageName} --access public --provenance`,
    ]);
    assert.throws(() => validator(invalid));
  }
  for (const name of ["Install both registry artifacts with an empty cache", "Run registry Harness headless and Web lifecycle"]) {
    const gate = stepBlock(workflow, name);
    const omitted = workflow.replace(gate, `      - name: ${name}\n        run: echo gate omitted\n`);
    assert.throws(() => validatePublishWorkflow(omitted));
    const premature = swapSteps(workflow, name, "Verify exact DeepSeek Harness bundle registry artifact");
    assert.throws(() => validatePublishWorkflow(premature));
  }
  const mutations = [
    workflow.replace("if: steps.registry.outputs.bundle_state == 'missing'", "if: always()"),
    replaceInStep(workflow, "Publish exact reviewed DeepSeek Harness bundle", " --provenance", ""),
    replaceInStep(workflow, rootRegistryStepName, '--integrity "${BUNDLE_INTEGRITY}"', '--integrity "unchecked"'),
    replaceInStep(workflow, rootRegistryStepName, '--root-dependency "${RELEASE_VERSION}"', '--root-dependency "latest"'),
    replaceInStep(workflow, "Verify exact DeepSeek Harness bundle registry artifact", '--integrity "${BUNDLE_INTEGRITY}"', '--integrity "unchecked"'),
    swapSteps(workflow, "Publish exact reviewed DeepSeek Harness bundle", "Verify exact root registry artifact"),
    workflow.replace('published npm artifact: @danielblomma/dsh-cortex@${RELEASE_VERSION}', 'bundle publication omitted'),
  ];
  for (const invalid of mutations) {
    assert.notEqual(invalid, workflow, "mutation must change the valid workflow");
    assert.throws(() => validatePublishWorkflow(invalid));
  }
});

test("artifact helper fixes the bundle inventory and exact root registry checks", () => {
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
  assert.match(helper, /manifest\.name !== packageName \|\| manifest\.version !== version \|\| manifest\.dist\?\.integrity !== integrity/);
  assert.match(helper, /latest !== version/);
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
  assert.match(changelog, /## 2\.6\.0 — 2026-08-30/);
  validateReleaseDocumentation(readme, changelog);
});

test("release documentation rejects bundle commands and availability drift", () => {
  const readme = readText("README.md");
  const changelog = readText("CHANGELOG.md");
  const mutations = [
    [readme.replace("Separate npm bundle distribution", "dsh plugin --profile web add @danielblomma/dsh-cortex\n\nSeparate npm bundle distribution"), changelog],
    [readme, changelog.replace("Separate npm bundle", "npm install @danielblomma/dsh-cortex\n\nSeparate npm bundle")],
    [readme.replace("deferred and currently unavailable", "publicly available"), changelog],
    [readme, changelog.replace("deferred and currently\n  unavailable", "available from the registry")],
    [`${readme}\n\nThe \`${bundlePackageName}\` package is available from npm.`, changelog],
    [readme, `${changelog}\n\nThe \`${bundlePackageName}\` package is published on npm.`],
    [readme.replace("not\nincluded in Cortex 2.6.0", "included in Cortex 2.6.0"), changelog],
  ];
  for (const [candidateReadme, candidateChangelog] of mutations) {
    assert.throws(() => validateReleaseDocumentation(candidateReadme, candidateChangelog));
  }
});
