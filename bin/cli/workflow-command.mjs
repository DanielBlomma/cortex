import path from "node:path";

import { loadProjectCliModule } from "./project-runtime.mjs";

const GENERATOR_VERSION = "maintained-analysis-cli-v1";
const TASK_ID_RE = /^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$/;
const FACT_ID_RE = /^(?:base:obs|fact):[0-9a-f]{64}$/;
const UNSAFE_VISIBLE_TEXT_PATTERN = /[\p{Cc}\p{Zl}\p{Zp}\p{Bidi_Control}]/u;
const MAX_ARGUMENT_BYTES = 1_024;
const REGISTERED_PREDICATES = new Set([
  "accepted",
  "binding_exact",
  "blocked",
  "blocker_active",
  "contamination_clear",
  "control_replay_digest_shape_valid",
  "distinct_semantic_owners",
  "evidence_trusted",
  "every_required_binding_viable",
  "every_required_review_go",
  "generator_compatible",
  "human_approval",
  "negative_probes_observed",
  "receipt_externally_anchored",
  "receipt_schema_closed",
  "replay_deterministic",
  "required_binding_set_exact",
  "required_review_set_exact",
  "required_reviews_go",
  "review_go",
  "review_ready",
  "task_binding_viable",
  "work_order_inputs_viable",
]);
const SAFE_RUNTIME_MESSAGES = new Set([
  "Workflow analysis arguments are invalid",
  "Maintained analysis state was not found",
  "Maintained analysis authority is invalid",
  "Maintained analysis state is untrusted",
]);

function invalid() {
  throw new Error("invalid");
}

function parseEpoch(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/u.test(value)) invalid();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) invalid();
  return parsed;
}

export function parseWorkflowAnalysisArgs(args) {
  const rendered = args.join(" ");
  if (
    args.some((arg) => typeof arg !== "string" || arg.length === 0 || arg !== arg.trim() || UNSAFE_VISIBLE_TEXT_PATTERN.test(arg)) ||
    Buffer.byteLength(rendered, "utf8") > MAX_ARGUMENT_BYTES
  ) invalid();
  const jsonCount = args.filter((arg) => arg === "--json").length;
  if (jsonCount > 1) invalid();
  const json = jsonCount === 1;
  const rest = args.filter((arg) => arg !== "--json");
  const [operation, taskId, third, fourth] = rest;
  if (typeof taskId !== "string" || !TASK_ID_RE.test(taskId)) invalid();
  if (operation === "state" && rest.length === 2) {
    return { input: { operation, task_id: taskId }, json };
  }
  if (operation === "why" && rest.length === 3 && FACT_ID_RE.test(third ?? "")) {
    return { input: { operation, task_id: taskId, fact_id: third }, json };
  }
  if (operation === "why-not" && rest.length === 3 && REGISTERED_PREDICATES.has(third)) {
    return { input: { operation, task_id: taskId, predicate: third }, json };
  }
  if (operation === "changes" && rest.length === 4 && third === "--since") {
    return { input: { operation, task_id: taskId, since: parseEpoch(fourth) }, json };
  }
  invalid();
}

function serializeError(code, message) {
  return `${JSON.stringify({
    ok: false,
    command: "workflow",
    schema_version: 1,
    generator_version: GENERATOR_VERSION,
    error: { code, message },
  }, null, 2)}\n`;
}

function failPublic(args, code, message) {
  if (args.includes("--json")) {
    process.stdout.write(serializeError(code, message));
    process.exitCode = 1;
    return;
  }
  throw new Error(message);
}

export async function runWorkflowCommandShim(args) {
  try {
    parseWorkflowAnalysisArgs(args);
  } catch {
    return failPublic(args, "INVALID_ARGS", "Workflow analysis arguments are invalid");
  }

  const target = process.env.CORTEX_PROJECT_ROOT?.trim() || process.cwd();
  process.env.CORTEX_PROJECT_ROOT = path.resolve(target);
  let runtime;
  try {
    runtime = await loadProjectCliModule("workflow-analysis");
    if (typeof runtime.runWorkflowAnalysisCommand !== "function") throw new Error("invalid runtime");
    await runtime.runWorkflowAnalysisCommand(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!args.includes("--json") && SAFE_RUNTIME_MESSAGES.has(message)) throw new Error(message);
    return failPublic(args, "RUNTIME_UNAVAILABLE", "Workflow analysis runtime is unavailable");
  }
}

export const WORKFLOW_ANALYSIS_GENERATOR_VERSION = GENERATOR_VERSION;
