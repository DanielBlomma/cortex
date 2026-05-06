import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  composeStageEnvelope,
  createRun,
  advanceStage,
  getRunState,
  type StageStatus,
  type WorkflowDefinition,
} from "../core/workflow/index.js";
import { DEFAULT_WORKFLOWS } from "../core/workflow/default-workflows.js";
import { runDrive } from "./stage-drive.js";

/**
 * `cortex stage` CLI surface. Each subcommand is a thin shell wrapper
 * around the workflow primitives, mirroring the cortex.workflow.* MCP
 * tools so shell scripts and CI can drive the harness without an MCP
 * client.
 *
 * Subcommands:
 *   start --task-id <id> --description "..." [--workflow <id>]
 *   status --task-id <id>
 *   envelope --task-id <id> [--stage <name>]
 *   advance --task-id <id> --stage <name> --body-file <path>
 *           [--frontmatter-file <path>] [--status <complete|blocked|failed>]
 *   run --task-id <id> -- <command> [args...]
 *     Sets CORTEX_ACTIVE_TASK_ID and execs the command. Use this to
 *     spawn an agent that runs under the harness's pre-tool-use gate.
 *
 * All commands resolve cwd from CORTEX_PROJECT_ROOT (preferred) or
 * process.cwd() so they work both inside an MCP server context and as
 * standalone shell calls.
 */

export async function runStageCommand(args: string[]): Promise<void> {
  const sub = args[0] ?? "help";
  const rest = args.slice(1);

  switch (sub) {
    case "start":
      return runStart(rest);
    case "status":
      return runStatus(rest);
    case "envelope":
      return runEnvelope(rest);
    case "advance":
      return runAdvance(rest);
    case "run":
      return runRun(rest);
    case "drive":
      return runDriveSub(rest);
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    default:
      printHelp();
      throw new Error(`Unknown stage subcommand: ${sub}`);
  }
}

function printHelp(): void {
  const lines = [
    "Usage:",
    "  cortex stage start    --task-id <id> --description \"...\" [--workflow <id>]",
    "  cortex stage status   --task-id <id>",
    "  cortex stage envelope --task-id <id> [--stage <name>]",
    "  cortex stage advance  --task-id <id> --stage <name> --body-file <path>",
    "                        [--frontmatter-file <path>] [--status <s>] [--outcome-file <path>]",
    "  cortex stage run      --task-id <id> -- <command> [args...]",
    "  cortex stage drive    --task-id <id> [--description \"...\"] [--workflow <id>]",
    "                        [--max-stages <N>] -- <agent-command> [args...]",
    "",
    "Status values: complete (default) | blocked | failed",
    "drive auto-loops envelope → spawn agent (envelope on stdin) → poll state until run finishes.",
    "All commands operate on .agents/<task-id>/ in the current project root.",
  ];
  process.stdout.write(lines.join("\n") + "\n");
}

function projectRoot(): string {
  return process.env.CORTEX_PROJECT_ROOT?.trim() || process.cwd();
}

function resolveWorkflow(workflowId: string): WorkflowDefinition {
  const wf = DEFAULT_WORKFLOWS[workflowId];
  if (!wf) {
    throw new Error(
      `Unknown workflow_id: ${workflowId}. Available: ${
        Object.keys(DEFAULT_WORKFLOWS).join(", ") || "<none>"
      }`,
    );
  }
  return wf;
}

type Flags = Record<string, string | boolean>;

function parseFlags(args: string[]): { flags: Flags; rest: string[] } {
  const flags: Flags = {};
  const rest: string[] = [];
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--") {
      rest.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[arg.slice(2)] = true;
        i += 1;
      } else {
        flags[arg.slice(2)] = next;
        i += 2;
      }
      continue;
    }
    rest.push(arg);
    i += 1;
  }
  return { flags, rest };
}

function requireFlag(flags: Flags, name: string): string {
  const value = flags[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required flag: --${name}`);
  }
  return value;
}

function emitJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

async function runStart(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const taskId = requireFlag(flags, "task-id");
  const description = requireFlag(flags, "description");
  const workflowId =
    typeof flags.workflow === "string" ? flags.workflow : "secure-build";

  const workflow = resolveWorkflow(workflowId);
  const state = createRun({
    cwd: projectRoot(),
    taskId,
    workflow,
    taskDescription: description,
  });
  const envelope = composeStageEnvelope({
    cwd: projectRoot(),
    taskId,
    workflow,
  });
  emitJson({ state, envelope });
}

async function runStatus(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const taskId = requireFlag(flags, "task-id");
  const state = getRunState(projectRoot(), taskId);
  emitJson({ state });
}

async function runEnvelope(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const taskId = requireFlag(flags, "task-id");
  const stageName = typeof flags.stage === "string" ? flags.stage : undefined;

  const state = getRunState(projectRoot(), taskId);
  if (!state) {
    throw new Error(
      `No run state for task ${taskId}. Start one with 'cortex stage start'.`,
    );
  }
  const workflow = resolveWorkflow(state.workflow_id);
  const envelope = composeStageEnvelope({
    cwd: projectRoot(),
    taskId,
    workflow,
    stageName,
  });
  emitJson({ envelope });
}

async function runAdvance(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const taskId = requireFlag(flags, "task-id");
  const stageName = requireFlag(flags, "stage");
  const bodyPath = requireFlag(flags, "body-file");
  const frontmatterPath =
    typeof flags["frontmatter-file"] === "string"
      ? flags["frontmatter-file"]
      : null;
  const outcomePath =
    typeof flags["outcome-file"] === "string" ? flags["outcome-file"] : null;
  const statusFlag =
    typeof flags.status === "string" ? (flags.status as StageStatus) : undefined;

  const body = readFileSync(bodyPath, "utf8");
  const frontmatter: Record<string, unknown> = frontmatterPath
    ? parseJsonObject(frontmatterPath)
    : {};
  const outcome = outcomePath ? parseJsonObject(outcomePath) : undefined;

  const state = getRunState(projectRoot(), taskId);
  if (!state) {
    throw new Error(
      `No run state for task ${taskId}. Start one with 'cortex stage start'.`,
    );
  }
  const workflow = resolveWorkflow(state.workflow_id);
  const stage = workflow.stages.find((s) => s.name === stageName);
  if (!stage) {
    throw new Error(
      `Stage ${stageName} is not defined in workflow ${workflow.id}`,
    );
  }

  const finalStatus: StageStatus = statusFlag ?? "complete";
  const next = advanceStage({
    cwd: projectRoot(),
    taskId,
    workflow,
    stageName,
    artifactName: stage.artifact,
    frontmatter: {
      ...frontmatter,
      stage: stageName,
      status: finalStatus,
      references:
        (Array.isArray((frontmatter as Record<string, unknown>).references)
          ? ((frontmatter as Record<string, unknown>).references as unknown[])
              .filter((v): v is string => typeof v === "string")
          : null) ?? deriveReferencesFromReads(stage.reads, workflow),
    },
    body,
    status: finalStatus,
    outcome,
  });

  let nextEnvelope = null;
  if (next.outcome === "in_progress" && next.current_stage) {
    nextEnvelope = composeStageEnvelope({
      cwd: projectRoot(),
      taskId,
      workflow,
    });
  }
  emitJson({ state: next, next_envelope: nextEnvelope });
}

function parseJsonObject(filePath: string): Record<string, unknown> {
  const raw = readFileSync(filePath, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse JSON in ${filePath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected JSON object in ${filePath}, got ${typeof value}`);
  }
  return value as Record<string, unknown>;
}

function deriveReferencesFromReads(
  reads: string[],
  workflow: WorkflowDefinition,
): string[] {
  const refs: string[] = [];
  for (const readName of reads) {
    const stage = workflow.stages.find((s) => s.name === readName);
    if (stage) refs.push(stage.artifact);
  }
  return refs;
}

async function runRun(args: string[]): Promise<void> {
  const { flags, rest } = parseFlags(args);
  const taskId = requireFlag(flags, "task-id");
  if (rest.length === 0) {
    throw new Error(
      "cortex stage run requires a command after --, e.g. 'cortex stage run --task-id task-1 -- claude'",
    );
  }

  const state = getRunState(projectRoot(), taskId);
  if (!state) {
    throw new Error(
      `No run state for task ${taskId}. Start one with 'cortex stage start'.`,
    );
  }
  if (state.outcome !== "in_progress" || !state.current_stage) {
    throw new Error(
      `Run ${taskId} is not in progress (outcome=${state.outcome}). Cannot spawn agent.`,
    );
  }

  const [command, ...commandArgs] = rest;

  const child = spawn(command, commandArgs, {
    stdio: "inherit",
    env: {
      ...process.env,
      CORTEX_ACTIVE_TASK_ID: taskId,
    },
  });

  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`spawned process terminated by signal ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`spawned process exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

async function runDriveSub(args: string[]): Promise<void> {
  const { flags, rest } = parseFlags(args);
  const taskId = requireFlag(flags, "task-id");
  const description =
    typeof flags.description === "string" ? flags.description : undefined;
  const workflowId =
    typeof flags.workflow === "string" ? flags.workflow : undefined;
  const maxStagesRaw = flags["max-stages"];
  const maxStages =
    typeof maxStagesRaw === "string" && Number.isFinite(Number(maxStagesRaw))
      ? Math.max(1, Math.floor(Number(maxStagesRaw)))
      : 50;

  if (rest.length === 0) {
    throw new Error(
      "cortex stage drive requires an agent command after --, " +
        "e.g. 'cortex stage drive --task-id task-1 --description \"...\" -- claude --print'",
    );
  }
  const [agentCommand, ...agentArgs] = rest;

  const result = await runDrive({
    cwd: projectRoot(),
    taskId,
    description,
    workflowId,
    maxStages,
    agentCommand,
    agentArgs,
    onStageStart: (stage) => {
      process.stderr.write(`[harness] stage: ${stage}\n`);
    },
    onStageEnd: (stage, nextState) => {
      const summary = nextState.current_stage
        ? `→ ${nextState.current_stage}`
        : `(${nextState.outcome})`;
      process.stderr.write(`[harness] stage ${stage} done ${summary}\n`);
    },
  });

  emitJson({ state: result.state, stages_driven: result.stagesDriven });
}
