import { isAbsolute, relative } from "node:path";
import { minimatch } from "minimatch";
import { readRunState } from "./artifact-io.js";
import { DEFAULT_CAPABILITIES, type CapabilityDefinition } from "./capabilities.js";
import { workflowDefinitionSchema, type WorkflowDefinition } from "./schemas.js";
import { DEFAULT_WORKFLOWS } from "./default-workflows.js";
import { loadSyncedCapabilities } from "./synced-capability-registry.js";

/**
 * Pre-tool-use enforcement for the harness. Pure function: takes the tool
 * call shape Claude Code emits, looks up the active workflow stage's
 * capability, returns allow/deny + reason. The hook wires this into the
 * stdin/exit-code dance.
 *
 * "Active task" is identified by env var CORTEX_ACTIVE_TASK_ID. The
 * harness sets this when invoking an agent for a stage; outside the
 * harness, the env var is unset and this evaluator is a no-op (returns
 * { allowed: true }).
 */

export type ToolCall = {
  toolName: string;
  toolInput: Record<string, unknown>;
};

export type EnforcementResult =
  | { allowed: true; reason?: string }
  | { allowed: false; reason: string };

export type EvaluateOptions = {
  cwd: string;
  taskId: string;
  call: ToolCall;
  workflows?: Record<string, WorkflowDefinition>;
  capabilities?: Record<string, CapabilityDefinition>;
};

/**
 * Tool names that are pure mutations of the file system. Edits and writes
 * gate against `write_globs`. Bash is treated as a mutation by default
 * because we cannot reliably extract paths from arbitrary shell — agents
 * running in restricted-write capabilities lose Bash unless the
 * capability explicitly allow-lists it.
 */
const MUTATING_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/**
 * Tool names that read but do not mutate. Gate against `read_globs`.
 */
const READING_TOOLS = new Set(["Read", "Grep", "Glob", "NotebookRead"]);

export function evaluateToolCall(options: EvaluateOptions): EnforcementResult {
  const state = readRunState(options.cwd, options.taskId);
  if (!state) {
    return { allowed: true, reason: "no run state — harness not active" };
  }
  if (state.outcome !== "in_progress" || !state.current_stage) {
    return {
      allowed: true,
      reason: `run not in progress (outcome=${state.outcome}) — no capability gate to apply`,
    };
  }

  const workflows = options.workflows ?? DEFAULT_WORKFLOWS;
  const workflow = workflows[state.workflow_id];
  if (!workflow) {
    return {
      allowed: false,
      reason: `unknown workflow_id ${state.workflow_id}; cannot resolve capability for current stage`,
    };
  }
  // Validate so corrupt input doesn't slip through.
  workflowDefinitionSchema.parse(workflow);

  const stage = workflow.stages.find((s) => s.name === state.current_stage);
  if (!stage) {
    return {
      allowed: false,
      reason: `current stage ${state.current_stage} is not defined in workflow ${workflow.id}`,
    };
  }

  if (!stage.capability) {
    return { allowed: true, reason: "stage has no capability declared" };
  }

  // When the caller passes an explicit registry, use it as-is (tests).
  // Otherwise merge bundled defaults with the daemon-synced org-authored
  // capabilities, with synced ones taking precedence on name collisions
  // so org overrides actually override.
  const capabilities =
    options.capabilities ?? { ...DEFAULT_CAPABILITIES, ...loadSyncedCapabilities() };
  const capability = capabilities[stage.capability];
  if (!capability) {
    return {
      allowed: false,
      reason: `capability ${stage.capability} (referenced by stage ${stage.name}) is not in the registry`,
    };
  }

  return evaluateAgainstCapability(capability, options.call, options.cwd);
}

function evaluateAgainstCapability(
  capability: CapabilityDefinition,
  call: ToolCall,
  cwd: string,
): EnforcementResult {
  // 1. tools_allowed: empty = no restriction; otherwise tool must be in the list.
  if (
    capability.tools_allowed.length > 0 &&
    !capability.tools_allowed.includes(call.toolName)
  ) {
    return {
      allowed: false,
      reason: `capability ${capability.name} does not allow tool ${call.toolName}`,
    };
  }

  const isMutation = MUTATING_TOOLS.has(call.toolName);
  const isRead = READING_TOOLS.has(call.toolName);

  // Bash is special: with restricted write_globs we have to assume the
  // worst (since the shell can write anywhere). Block unless capability
  // explicitly allow-lists Bash via tools_allowed.
  if (call.toolName === "Bash") {
    const isAllowedViaToolList = capability.tools_allowed.includes("Bash");
    const writesUnrestricted = capability.write_globs.length === 0;
    if (writesUnrestricted && !isAllowedViaToolList) {
      return {
        allowed: false,
        reason: `capability ${capability.name} is read-only; Bash can mutate the filesystem and is not allow-listed`,
      };
    }
    return { allowed: true };
  }

  if (isMutation) {
    if (capability.write_globs.length === 0) {
      return {
        allowed: false,
        reason: `capability ${capability.name} is read-only; ${call.toolName} cannot run`,
      };
    }
    const targetPath = extractFilePath(call.toolInput);
    if (!targetPath) {
      return {
        allowed: false,
        reason: `${call.toolName} did not include a file_path; cannot verify against capability ${capability.name}`,
      };
    }
    const relPath = toRepoRelative(cwd, targetPath);
    if (!matchesAnyGlob(relPath, capability.write_globs)) {
      return {
        allowed: false,
        reason: `path ${relPath} is outside capability ${capability.name}'s write_globs (${capability.write_globs.join(", ")})`,
      };
    }
    return { allowed: true };
  }

  if (isRead) {
    if (capability.read_globs.length === 0) {
      // No reads allowed at all — only the human capability lands here.
      return {
        allowed: false,
        reason: `capability ${capability.name} does not permit any read operations`,
      };
    }
    const targetPath = extractFilePath(call.toolInput);
    if (!targetPath) {
      // Some read tools (Grep, Glob) operate on the whole repo; allow
      // through if the capability has any read access at all.
      return { allowed: true };
    }
    const relPath = toRepoRelative(cwd, targetPath);
    if (!matchesAnyGlob(relPath, capability.read_globs)) {
      return {
        allowed: false,
        reason: `path ${relPath} is outside capability ${capability.name}'s read_globs (${capability.read_globs.join(", ")})`,
      };
    }
    return { allowed: true };
  }

  // Unknown tool — fall through to allow if not explicitly restricted.
  return { allowed: true };
}

function extractFilePath(toolInput: Record<string, unknown>): string | null {
  const candidates = ["file_path", "path", "notebook_path"];
  for (const key of candidates) {
    const value = toolInput[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function toRepoRelative(cwd: string, targetPath: string): string {
  if (!isAbsolute(targetPath)) return targetPath;
  const rel = relative(cwd, targetPath);
  // If the path is outside the repo, return the absolute form so glob
  // matches (which expect repo-relative) reliably miss.
  if (rel.startsWith("..")) return targetPath;
  return rel;
}

function matchesAnyGlob(path: string, globs: string[]): boolean {
  return globs.some((pattern) =>
    minimatch(path, pattern, { dot: true, nocase: false }),
  );
}
