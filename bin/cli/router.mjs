import {
  PASSTHROUGH_COMMANDS,
  runPassthroughCommand,
} from "./context-passthrough.mjs";
import { runDaemonCommand } from "./daemon.mjs";
import { runEnterpriseCommand } from "./enterprise.mjs";
import { printHelp, readCliVersion } from "./help.mjs";
import { runHookShim, runHooksCommand } from "./hooks.mjs";
import { runMcpCommand } from "./mcp-command.mjs";
import {
  runConnectCommand,
  runInitCommand,
} from "./project-commands.mjs";
import {
  QUERY_COMMANDS,
  runQueryCommandShim,
} from "./query-command.mjs";
import { runRunCommand } from "./run-command.mjs";
import { runStageCommandShim } from "./stage-command.mjs";
import { runTelemetryCommand } from "./telemetry-command.mjs";
import { runWorkflowCommandShim } from "./workflow-command.mjs";

const COMMAND_HANDLERS = new Map([
  ["init", runInitCommand],
  ["connect", runConnectCommand],
  ["mcp", runMcpCommand],
  ["daemon", runDaemonCommand],
  ["hook", runHookShim],
  ["hooks", runHooksCommand],
  ["telemetry", runTelemetryCommand],
  ["enterprise", runEnterpriseCommand],
  ["run", runRunCommand],
  ["stage", runStageCommandShim],
  ["workflow", runWorkflowCommandShim],
]);

export async function runCli(argv = process.argv.slice(2)) {
  const cliVersion = readCliVersion();
  process.env.CORTEX_CLI_VERSION = cliVersion;

  const [rawCommand, ...rest] = argv;
  const command = rawCommand ?? "help";

  if (command === "version" || command === "--version" || command === "-V") {
    console.log(cliVersion);
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const handler = COMMAND_HANDLERS.get(command);
  if (handler) {
    return handler(rest);
  }

  if (QUERY_COMMANDS.has(command)) {
    return runQueryCommandShim(command, rest);
  }

  if (PASSTHROUGH_COMMANDS.has(command)) {
    return runPassthroughCommand(command, rest);
  }

  throw new Error(`Unknown command: ${command}`);
}
