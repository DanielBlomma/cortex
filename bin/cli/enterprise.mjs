import fs from "node:fs";
import os from "node:os";
import { pathToFileURL } from "node:url";
import {
  accent,
  bold,
  bullet,
  gradient,
  headerBanner,
  muted,
  printBullet,
  spinner,
} from "../style.mjs";
import { runDaemonCommand } from "./daemon.mjs";
import { helpRow } from "./help.mjs";
import { hasManagedClaudeHooks, runHooksCommand } from "./hooks.mjs";
import {
  loadGovernModule,
  resolveTrustedCliEntry,
} from "./trusted-runtime.mjs";

function requireSudoElevation() {
  const isRoot = process.getuid && process.getuid() === 0;
  if (!isRoot) {
    process.stderr.write(
      bullet(
        "fail",
        "This command requires admin privileges to install non-bypassable enforcement.",
        process.stderr,
      ) + "\n",
    );
    process.stderr.write(
      muted(
        "  Re-run as: sudo " + process.argv.slice(1).join(" "),
        process.stderr,
      ) + "\n",
    );
    process.exit(1);
  }
  const sudoUser = process.env.SUDO_USER;
  const sudoUidRaw = process.env.SUDO_UID;
  const sudoGidRaw = process.env.SUDO_GID;
  if (!sudoUser || !sudoUidRaw || !sudoGidRaw) {
    process.stderr.write(
      bullet(
        "fail",
        "Use 'sudo' to elevate (not 'su' or a root login).",
        process.stderr,
      ) + "\n",
    );
    process.stderr.write(
      muted(
        "  Cortex needs SUDO_USER/SUDO_UID/SUDO_GID set so that enterprise.yml,",
        process.stderr,
      ) + "\n",
    );
    process.stderr.write(
      muted(
        "  Claude Code hooks and the daemon end up owned by your user.",
        process.stderr,
      ) + "\n",
    );
    process.exit(1);
  }
  const uid = parseInt(sudoUidRaw, 10);
  const gid = parseInt(sudoGidRaw, 10);
  if (!Number.isFinite(uid) || !Number.isFinite(gid)) {
    process.stderr.write(
      bullet(
        "fail",
        "SUDO_UID/SUDO_GID are not valid integers — refusing to drop privileges.",
        process.stderr,
      ) + "\n",
    );
    process.exit(1);
  }
  return { user: sudoUser, uid, gid };
}

function dropPrivileges(sudo) {
  const sudoInfo = os.userInfo({ uid: sudo.uid });
  process.setgid(sudo.gid);
  process.setuid(sudo.uid);
  process.env.HOME = sudoInfo.homedir;
  process.env.USER = sudo.user;
  process.env.LOGNAME = sudo.user;
  return sudoInfo.homedir;
}

async function runAsSudoUser(sudo, operation) {
  const required = [
    "geteuid",
    "getegid",
    "seteuid",
    "setegid",
    "getgroups",
    "setgroups",
  ];
  for (const name of required) {
    if (typeof process[name] !== "function") {
      throw new Error(
        `Secure Enterprise installation requires process.${name} support.`,
      );
    }
  }

  const previous = {
    euid: process.geteuid(),
    egid: process.getegid(),
    groups: process.getgroups(),
    home: process.env.HOME,
    user: process.env.USER,
    logname: process.env.LOGNAME,
  };
  const sudoInfo = os.userInfo({ uid: sudo.uid });
  try {
    process.setgroups([sudo.gid]);
    process.setegid(sudo.gid);
    process.seteuid(sudo.uid);
    process.env.HOME = sudoInfo.homedir;
    process.env.USER = sudo.user;
    process.env.LOGNAME = sudo.user;
    return await operation();
  } finally {
    process.seteuid(previous.euid);
    process.setegid(previous.egid);
    process.setgroups(previous.groups);
    if (previous.home === undefined) delete process.env.HOME;
    else process.env.HOME = previous.home;
    if (previous.user === undefined) delete process.env.USER;
    else process.env.USER = previous.user;
    if (previous.logname === undefined) delete process.env.LOGNAME;
    else process.env.LOGNAME = previous.logname;
  }
}

const ENTERPRISE_SUBCOMMANDS = new Set([
  "status",
  "sync",
  "uninstall",
  "repair",
  "help",
  "--help",
  "-h",
]);

export async function runEnterpriseCommand(args) {
  if (args[0] === "install") {
    return runEnterpriseInstall(args.slice(1));
  }
  if (args.length === 0 || ENTERPRISE_SUBCOMMANDS.has(args[0])) {
    return runEnterpriseSubcommand(args);
  }
  throw new Error(
    "Positional enterprise API keys are not accepted. Use 'cortex enterprise install --api-key-stdin'.",
  );
}

async function runEnterpriseSubcommand(args) {
  const sub = args[0] ?? "help";

  if (sub === "help" || sub === "--help" || sub === "-h" || !sub) {
    console.log(
      gradient("cortex enterprise") + muted("  ·  governance, armed."),
    );
    console.log(
      helpRow(
        "enterprise install --api-key-stdin",
        "Install (sudo). Managed enforcement + hooks + daemon.",
      ),
    );
    console.log(
      helpRow(
        "  ",
        "[--endpoint <url>] [--frameworks <csv>] [--no-hooks] [--no-daemon]",
      ),
    );
    console.log(
      helpRow(
        "enterprise status [--verbose|--json]",
        "Show local enforcement state",
      ),
    );
    console.log(
      helpRow("enterprise sync", "Force re-fetch + re-apply (sudo)"),
    );
    console.log(
      helpRow(
        "enterprise uninstall",
        'Remove. [--break-glass --reason "<text>"] in enforced mode (sudo)',
      ),
    );
    console.log(
      helpRow(
        "enterprise repair",
        "Verify managed paths, clear .cortex-tamper.lock (sudo)",
      ),
    );
    console.log("");
    console.log(
      muted(
        "Example: printf '%s\\n' \"$CORTEX_API_KEY\" | sudo cortex enterprise install --api-key-stdin",
      ),
    );
    console.log(
      muted("Default endpoint: https://cortex-web-rho.vercel.app"),
    );
    return;
  }

  if (sub === "status") {
    let verbose = false;
    let json = false;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--verbose" || args[i] === "-v") verbose = true;
      else if (args[i] === "--json") json = true;
      else if (args[i].startsWith("-")) {
        throw new Error(`Unknown enterprise status option: ${args[i]}`);
      }
    }
    const mod = await loadGovernModule();
    mod.runGovernStatus({ cwd: process.cwd(), verbose, json });
    return;
  }

  if (sub === "sync") {
    const sudo = requireSudoElevation();
    const mod = await loadGovernModule();
    const projectOperation = (operation) =>
      runAsSudoUser(sudo, operation);
    await mod.runGovernSync({
      cwd: process.cwd(),
      projectOperation,
    });
    dropPrivileges(sudo);
    return;
  }

  if (sub === "uninstall") {
    let breakGlass = false;
    let reason;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--break-glass") breakGlass = true;
      else if (args[i] === "--reason" && args[i + 1]) {
        reason = args[i + 1];
        i++;
      } else if (args[i].startsWith("-")) {
        throw new Error(`Unknown enterprise uninstall option: ${args[i]}`);
      }
    }
    const sudo = requireSudoElevation();
    const mod = await loadGovernModule();
    const projectOperation = (operation) =>
      runAsSudoUser(sudo, operation);
    const result = await mod.runGovernUninstall({
      cli: "all",
      breakGlass,
      reason,
      cwd: process.cwd(),
      projectOperation,
    });
    dropPrivileges(sudo);
    if (!result.ok) {
      printBullet("fail", result.message, process.stderr);
      process.exit(1);
    }
    printBullet("ok", result.message);
    return;
  }

  if (sub === "repair") {
    let reason;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--reason" && args[i + 1]) {
        reason = args[i + 1];
        i++;
      } else if (args[i].startsWith("-")) {
        throw new Error(`Unknown enterprise repair option: ${args[i]}`);
      }
    }
    const sudo = requireSudoElevation();
    const mod = await loadGovernModule();
    const projectOperation = (operation) =>
      runAsSudoUser(sudo, operation);
    const result = await mod.runGovernRepair({
      cwd: process.cwd(),
      reason,
      projectOperation,
    });
    dropPrivileges(sudo);
    if (!result.ok) {
      printBullet("fail", result.message, process.stderr);
      process.exit(1);
    }
    printBullet("ok", result.message);
    return;
  }

  throw new Error(`Unknown enterprise subcommand: ${sub}`);
}

export async function runEnterpriseInstall(args, injected = {}) {
  if (args.includes("--help") || args.includes("-h")) {
    return runEnterpriseSubcommand(["help"]);
  }
  let readKeyFromStdin = false;
  let endpoint;
  let frameworks;
  let installHooks = true;
  let startDaemon = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--api-key-stdin") {
      readKeyFromStdin = true;
    } else if (args[i] === "--endpoint" && args[i + 1]) {
      endpoint = args[i + 1];
      i++;
    } else if (args[i] === "--frameworks" && args[i + 1]) {
      frameworks = args[i + 1]
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      i++;
    } else if (args[i] === "--no-hooks") {
      installHooks = false;
    } else if (args[i] === "--no-daemon") {
      startDaemon = false;
    } else if (args[i].startsWith("-")) {
      throw new Error(`Unknown enterprise install option: ${args[i]}`);
    } else {
      throw new Error(
        "Positional enterprise API keys are not accepted. Use --api-key-stdin.",
      );
    }
  }

  if (!readKeyFromStdin) {
    throw new Error(
      "Enterprise installation requires --api-key-stdin so the key is not exposed in process arguments.",
    );
  }
  const secretInput = injected.stdin ?? process.stdin;
  if (secretInput.isTTY) {
    throw new Error(
      "Read the enterprise API key from a pipe or redirected stdin; interactive echo is disabled for secrets.",
    );
  }
  let apiKey = "";
  for await (const chunk of secretInput) {
    apiKey += chunk.toString();
    if (apiKey.length > 4096) {
      throw new Error("Enterprise API key input is too large.");
    }
  }
  const singleLineInput = apiKey.endsWith("\r\n")
    ? apiKey.slice(0, -2)
    : apiKey.endsWith("\n")
      ? apiKey.slice(0, -1)
      : apiKey;
  if (
    !singleLineInput ||
    singleLineInput.includes("\n") ||
    singleLineInput.includes("\r")
  ) {
    throw new Error("Expected exactly one enterprise API key on stdin.");
  }
  apiKey = singleLineInput.trim();
  if (!apiKey) {
    throw new Error("Expected exactly one enterprise API key on stdin.");
  }

  const sudo =
    (injected.requireSudoElevation ?? requireSudoElevation)();
  const projectOperation = (operation) =>
    (injected.runAsSudoUser ?? runAsSudoUser)(sudo, operation);

  process.stdout.write(
    headerBanner({
      tagline: "  Cortex enterprise — activating governance",
    }),
  );

  let enterpriseMod = injected.enterpriseMod;
  if (!enterpriseMod) {
    const enterpriseEntry = resolveTrustedCliEntry("enterprise-setup");
    if (!fs.existsSync(enterpriseEntry)) {
      printBullet(
        "fail",
        `The installed Cortex package is missing its trusted Enterprise runtime (${enterpriseEntry}). Reinstall Cortex.`,
      );
      process.exit(1);
    }
    enterpriseMod = await import(pathToFileURL(enterpriseEntry).href);
  }

  const step1 = spinner("Initializing Cortex core");
  const setupResult = await projectOperation(() =>
    enterpriseMod.runEnterpriseSetup({
      apiKey,
      endpoint,
      cwd: process.cwd(),
    }),
  );
  if (!setupResult.ok) {
    step1.stop(
      "fail",
      `Initializing Cortex core — ${setupResult.message}`,
    );
    process.exit(1);
  }
  step1.stop(
    "ok",
    `Initializing Cortex core — license ${setupResult.edition}, expires ${setupResult.expiresAt}`,
  );
  printBullet("info", muted(`config: ${setupResult.configPath}`));

  const sudoHome =
    injected.sudoHome ?? os.userInfo({ uid: sudo.uid }).homedir;
  const bindEnterpriseIdentity =
    injected.bindEnterpriseIdentity ?? enterpriseMod.bindEnterpriseIdentity;
  if (
    typeof bindEnterpriseIdentity !== "function" ||
    !(await projectOperation(() =>
      bindEnterpriseIdentity({
        apiKey,
        endpoint,
        homeDir: sudoHome,
      }),
    ))
  ) {
    throw new Error(
      "Could not bind this user profile to the verified Enterprise identity. " +
        "A different endpoint is already enrolled; use a separate OS user boundary.",
    );
  }

  const baseUrl = (
    endpoint ?? "https://cortex-web-rho.vercel.app"
  ).replace(/\/$/, "");
  const step2 = spinner("Loading policy engine");
  const governMod = injected.governMod ?? (await loadGovernModule());
  const governResult = await governMod.runGovernInstall({
    cli: "all",
    mode: "enforced",
    cwd: process.cwd(),
    apiKey,
    baseUrl,
    frameworks: frameworks ?? ["iso27001", "iso42001", "soc2"],
    projectOperation,
  });
  if (!governResult.ok) {
    step2.stop(
      "fail",
      `Loading policy engine — ${governResult.message}`,
    );
    process.exit(1);
  }
  step2.stop("ok", "Loading policy engine — policies armed");

  const step3 = spinner("Connecting audit pipeline");
  step3.stop("ok", `Connecting audit pipeline — endpoint ${baseUrl}`);

  (injected.dropPrivileges ?? dropPrivileges)(sudo);

  if (installHooks) {
    const step4 = spinner("Preparing MCP gateway");
    try {
      if ((injected.hasManagedClaudeHooks ?? hasManagedClaudeHooks)()) {
        step4.stop(
          "ok",
          "Preparing MCP gateway — managed Claude hooks active",
        );
      } else {
        await (injected.runHooksCommand ?? runHooksCommand)(["install"]);
        step4.stop("ok", "Preparing MCP gateway — hooks installed");
      }
    } catch (err) {
      step4.stop(
        "fail",
        `Preparing MCP gateway — ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  } else {
    printBullet("warn", "Preparing MCP gateway — skipped (--no-hooks)");
  }

  if (startDaemon) {
    const step5 = spinner("Installing guardrails");
    try {
      await (injected.runDaemonCommand ?? runDaemonCommand)(["restart"]);
      step5.stop("ok", "Installing guardrails — daemon online");
    } catch (err) {
      step5.stop(
        "fail",
        `Installing guardrails — ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
  } else {
    printBullet("warn", "Installing guardrails — skipped (--no-daemon)");
  }

  console.log("");
  console.log(bullet("ok", bold("Cortex is running.")));
  console.log(muted("  Monitoring AI activity. No violations detected."));
  console.log(
    muted("  Next: ") +
      accent("cortex enterprise status") +
      muted("  ·  ") +
      accent("cortex telemetry test"),
  );
  console.log("");
}
