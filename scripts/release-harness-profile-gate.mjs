#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

function fail(message) {
  throw new Error(`Installed Harness profile gate failed: ${message}`);
}

function args(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || !value) fail(`invalid argument ${String(name)}`);
    values[name.slice(2)] = path.resolve(value);
  }
  return values;
}

function snapshot(values) {
  const entry = (name, sources) => {
    if (!sources.includes("process") || values[name] === undefined) return undefined;
    return { source: "process", value: values[name] };
  };
  return {
    get: (name) => entry(name, ["process"]),
    getFrom: entry,
  };
}

function text(result) {
  return (result.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join("\n");
}

async function waitFor(check, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  fail(`timed out waiting for ${label}`);
}

const options = args(process.argv.slice(2));
for (const name of ["harness-checkout", "profile-dir", "first-root", "second-root", "overlay", "report"]) {
  if (!options[name]) fail(`--${name} is required`);
}
if (process.env.PATH !== "/nonexistent") fail("PATH must be unable to supply Cortex");
if (process.env.CORTEX_RELEASE_NETWORK_DENIED !== "1") fail("network-denial wrapper did not attest its boundary");

const cliLib = path.join(options["harness-checkout"], "apps", "cli", "lib");
const profileBootName = fs.readdirSync(cliLib).find((name) => {
  if (!/^profile-boot-[A-Za-z0-9_-]+\.js$/.test(name)) return false;
  return /export \{ runProfile \}/.test(fs.readFileSync(path.join(cliLib, name), "utf8"));
});
if (!profileBootName) fail("built Harness profile-boot entry was not found");
const profileBoot = path.join(cliLib, profileBootName);
const { runProfile } = await import(pathToFileURL(profileBoot).href);
const boot = await runProfile({
  environment: snapshot({ ...process.env }),
  profile: "headless",
  patchFiles: [options.overlay],
  args: ["release final-artifact profile gate"],
});

const { ctx } = boot;
const handles = [];
let bundleDisposed = false;
try {
  const create = async (id, cwd) => {
    const handle = await ctx.agents.create({ sessionId: id, meta: { cwd } });
    handles.push(handle);
    await waitFor(
      () => ctx.tools.schemas(handle.agent).filter((tool) => tool.name.startsWith("cortex_")).length === 4,
      `${id} Cortex tools`,
    );
    return handle;
  };
  const nonce = crypto.randomBytes(6).toString("hex");
  const first = await create(`release-gate-first-${nonce}`, options["first-root"]);
  let call = 0;
  const execute = async (handle, name, arguments_, signal = new AbortController().signal) => {
    call += 1;
    return ctx.tools.execute({
      signal,
      callId: `release-gate-${call}`,
      name: `cortex_${name}`,
      arguments: arguments_,
      agent: handle.agent,
    });
  };

  const firstSearch = await execute(first, "search", { query: "FIRST_ROOT_RELEASE_TOKEN", top_k: 5 });
  if (firstSearch.isError) fail(`first real indexed search returned an error: ${text(firstSearch)}`);
  const firstPaths = firstSearch.value?.data?.results?.map((result) => result.path) ?? [];
  if (!firstPaths.includes("src/first-root.mjs") || firstPaths.includes("src/second-root.mjs")) {
    fail(`first root isolation failed: ${firstPaths.join(",")}`);
  }

  const entityId = firstSearch.value?.data?.results?.[0]?.id;
  if (typeof entityId !== "string") fail("real search did not return an entity id");
  const realCommands = {
    search: firstSearch,
    rules: await execute(first, "rules", {}),
    related: await execute(first, "related", { entity_id: entityId, depth: 1 }),
    impact: await execute(first, "impact", { query: "FIRST_ROOT_RELEASE_TOKEN", depth: 1 }),
  };
  for (const [name, result] of Object.entries(realCommands)) {
    if (result.isError || result.value?.command !== name) fail(`real ${name} provider command failed: ${text(result)}`);
  }

  const packageRoots = [...new Set(
    fs.readdirSync(options["profile-dir"], { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name === "package.json"
        && entry.parentPath.endsWith(path.join("@danielblomma", "cortex-mcp")))
      .map((entry) => fs.realpathSync(entry.parentPath)),
  )];
  if (packageRoots.length !== 1) fail(`expected one package-owned Cortex root, found ${packageRoots.length}`);
  const cli = path.join(packageRoots[0], "bin", "cortex.mjs");
  const original = fs.readFileSync(cli);
  const originalDigest = crypto.createHash("sha256").update(original).digest("hex");
  const fixture = `#!/usr/bin/env node
const input = process.argv.join(' ')
if (input.includes('release-gate-timeout') || input.includes('release-gate-cancellation')) {
  setInterval(() => {}, 1000)
} else if (input.includes('release-gate-malformed')) {
  process.stdout.write('{not-json')
} else if (input.includes('release-gate-oversized')) {
  process.stdout.write('x'.repeat(2 * 1024 * 1024 + 1))
} else {
  process.exitCode = 9
}
`;
  fs.writeFileSync(cli, fixture, { mode: 0o755 });
  const negative = {};
  try {
    const timeout = await execute(first, "search", { query: "release-gate-timeout" });
    if (!timeout.isError || !/deadline|timed out|exceeded/i.test(text(timeout))) fail("timeout behavior was not materialized");
    negative.timeout = true;

    const cancel = new AbortController();
    const pending = execute(first, "search", { query: "release-gate-cancellation" }, cancel.signal);
    setTimeout(() => cancel.abort(), 100);
    const canceled = await pending;
    if (!canceled.isError || !/cancel/i.test(text(canceled))) fail("cancellation behavior was not materialized");
    negative.cancellation = true;

    const malformed = await execute(first, "search", { query: "release-gate-malformed" });
    if (!malformed.isError || !/malformed/i.test(text(malformed))) fail("malformed-output behavior was not materialized");
    negative.malformed = true;

    const oversized = await execute(first, "search", { query: "release-gate-oversized" });
    if (!oversized.isError || !/bounded output|output limit|exceeded/i.test(text(oversized))) fail("oversized-output behavior was not materialized");
    negative.oversized = true;
  } finally {
    fs.writeFileSync(cli, original, { mode: 0o755 });
  }
  if (crypto.createHash("sha256").update(fs.readFileSync(cli)).digest("hex") !== originalDigest) {
    fail("package-owned CLI bytes were not restored after disposable fault injection");
  }
  const restored = await execute(first, "rules", {});
  if (restored.isError) fail("restored package-owned CLI did not execute");

  const toolNames = ctx.tools.schemas(first.agent).map((tool) => tool.name)
    .filter((name) => name.startsWith("cortex_")).sort();
  const skills = (await ctx.skills.snapshot({
    scope: first.agent,
    cwd: options["first-root"],
    signal: new AbortController().signal,
  })).skills.map((skill) => skill.name).sort();
  if (toolNames.length !== 4 || skills.length !== 5) fail("installed profile discovery counts drifted");

  await first.dispose();
  handles.splice(handles.indexOf(first), 1);
  if (ctx.agents.get(first.agent.id) !== undefined) fail("first agent remained registered after disposal");

  const second = await create(`release-gate-second-${nonce}`, options["second-root"]);
  const secondSearch = await execute(second, "search", { query: "SECOND_ROOT_RELEASE_TOKEN", top_k: 5 });
  if (secondSearch.isError) fail(`second real indexed search returned an error: ${text(secondSearch)}`);
  const secondPaths = secondSearch.value?.data?.results?.map((result) => result.path) ?? [];
  if (!secondPaths.includes("src/second-root.mjs") || secondPaths.includes("src/first-root.mjs")) {
    fail(`second root isolation failed: ${secondPaths.join(",")}`);
  }
  if (ctx.tools.get("cortex_search", second.agent) === undefined) fail("second agent did not receive isolated tools");
  await second.dispose();
  handles.splice(handles.indexOf(second), 1);
  if (ctx.agents.get(second.agent.id) !== undefined) fail("second agent remained registered after disposal");

  await ctx.fiber.dispose();
  bundleDisposed = true;
  const report = {
    profileBooted: true,
    pathUnableToSupplyCortex: true,
    outboundNetworkDenied: true,
    packageOwnedCli: cli,
    indexedRoots: { count: 2, isolated: true, firstPaths, secondPaths },
    commands: Object.fromEntries(Object.keys(realCommands).map((name) => [name, true])),
    negative,
    discovery: { tools: toolNames, skills },
    disposal: { firstAgent: true, secondAgent: true, bundle: true },
  };
  fs.writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`);
} finally {
  for (const handle of handles.reverse()) await handle.dispose().catch(() => {});
  if (!bundleDisposed) await ctx.fiber.dispose().catch(() => {});
}
