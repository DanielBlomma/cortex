import path from "node:path";

import {
  canonicalJson,
  LIMITS,
  REGISTERED_PREDICATES,
} from "../core/analysis-state/engine.js";
import {
  analysisChangesSince,
  explainAnalysisFact,
  explainMissingAnalysisFact,
  queryAnalysisState,
} from "../core/analysis-state/queries.js";
import {
  AnalysisQueryError,
  readTrustedAnalysisState,
  type TrustedAnalysisState,
} from "../core/analysis-state/query-reader.js";
import type { AnalysisFact, CanonicalValue } from "../core/analysis-state/schemas.js";

const SCHEMA_VERSION = 1 as const;
const GENERATOR_VERSION = "maintained-analysis-cli-v1";
const TASK_ID_RE = /^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$/;
const FACT_ID_RE = /^(?:base:obs|fact):[0-9a-f]{64}$/;
const UNSAFE_VISIBLE_TEXT_PATTERN = /[\p{Cc}\p{Zl}\p{Zp}\p{Bidi_Control}]/u;
const MAX_ARGUMENT_BYTES = 1_024;

export type WorkflowAnalysisOperation = "state" | "why" | "why-not" | "changes";

export type WorkflowAnalysisInput =
  | { operation: "state"; task_id: string }
  | { operation: "why"; task_id: string; fact_id: string }
  | { operation: "why-not"; task_id: string; predicate: string }
  | { operation: "changes"; task_id: string; since: number };

export type ParsedWorkflowAnalysisArgs = {
  input: WorkflowAnalysisInput;
  json: boolean;
};

export type WorkflowAnalysisErrorCode =
  | "INVALID_ARGS"
  | "STATE_NOT_FOUND"
  | "AUTHORITY_INVALID"
  | "STATE_UNTRUSTED";

type WorkflowEnvelope = {
  ok: boolean;
  command: "workflow";
  schema_version: 1;
  generator_version: string;
  input?: WorkflowAnalysisInput;
  data?: CanonicalValue;
  error?: { code: WorkflowAnalysisErrorCode; message: string };
};

class WorkflowAnalysisCliError extends Error {
  readonly code: WorkflowAnalysisErrorCode;

  constructor(code: WorkflowAnalysisErrorCode) {
    super(publicMessage(code));
    this.name = "WorkflowAnalysisCliError";
    this.code = code;
  }
}

function publicMessage(code: WorkflowAnalysisErrorCode): string {
  switch (code) {
    case "INVALID_ARGS": return "Workflow analysis arguments are invalid";
    case "STATE_NOT_FOUND": return "Maintained analysis state was not found";
    case "AUTHORITY_INVALID": return "Maintained analysis authority is invalid";
    case "STATE_UNTRUSTED": return "Maintained analysis state is untrusted";
  }
}

function invalid(): never {
  throw new WorkflowAnalysisCliError("INVALID_ARGS");
}

function assertSafeArguments(args: string[]): void {
  const rendered = args.join(" ");
  if (
    args.some((arg) => arg.length === 0 || arg !== arg.trim() || UNSAFE_VISIBLE_TEXT_PATTERN.test(arg)) ||
    Buffer.byteLength(rendered, "utf8") > MAX_ARGUMENT_BYTES
  ) invalid();
}

function parseJsonFlag(args: string[]): { json: boolean; rest: string[] } {
  const count = args.filter((arg) => arg === "--json").length;
  if (count > 1) invalid();
  return { json: count === 1, rest: args.filter((arg) => arg !== "--json") };
}

function assertTaskId(value: string | undefined): asserts value is string {
  if (typeof value !== "string" || !TASK_ID_RE.test(value)) invalid();
}

function parseEpoch(value: string | undefined): number {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/u.test(value)) invalid();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) invalid();
  return parsed;
}

export function parseWorkflowAnalysisArgs(args: string[]): ParsedWorkflowAnalysisArgs {
  assertSafeArguments(args);
  const { json, rest } = parseJsonFlag(args);
  const [operation, taskId, third, fourth] = rest;
  assertTaskId(taskId);
  if (operation === "state" && rest.length === 2) {
    return { input: { operation, task_id: taskId }, json };
  }
  if (operation === "why" && rest.length === 3 && typeof third === "string" && FACT_ID_RE.test(third)) {
    return { input: { operation, task_id: taskId, fact_id: third }, json };
  }
  if (
    operation === "why-not" && rest.length === 3 && typeof third === "string" &&
    REGISTERED_PREDICATES.includes(third)
  ) {
    return { input: { operation, task_id: taskId, predicate: third }, json };
  }
  if (operation === "changes" && rest.length === 4 && third === "--since") {
    return { input: { operation, task_id: taskId, since: parseEpoch(fourth) }, json };
  }
  invalid();
}

function binding(trusted: TrustedAnalysisState): CanonicalValue {
  return {
    schema_version: SCHEMA_VERSION,
    repository: trusted.authority.repository,
    task_id: trusted.authority.task_id,
    primary_subject: trusted.authority.primary_subject,
    authority_bundle_sha256: trusted.authority.bundle_sha256,
    authority_manifest_sha256: trusted.authority.authority_manifest.manifest_sha256,
    source_authority_registry_sha256: trusted.persisted.manifest.source_authority_registry_sha256,
    generation: trusted.persisted.manifest.generation,
    snapshot_sha256: trusted.persisted.manifest.snapshot_sha256,
    ruleset_sha256: trusted.persisted.manifest.ruleset_sha256,
  };
}

function currentFacts(trusted: TrustedAnalysisState): AnalysisFact[] {
  const facts = REGISTERED_PREDICATES.flatMap((predicate) =>
    queryAnalysisState(trusted.persisted.state, trusted.authority.primary_subject, predicate)
  );
  const unique = new Map(facts.map((fact) => [fact.id, fact]));
  return [...unique.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function stateData(trusted: TrustedAnalysisState): CanonicalValue {
  const snapshot = trusted.persisted.state.snapshot;
  return {
    operation: "state",
    binding: binding(trusted),
    state: {
      epoch: trusted.persisted.state.epoch,
      snapshot_epoch: snapshot.epoch,
      observation_head_sha256: snapshot.observation_head_sha256,
      active_observation_count: snapshot.active_observation_count,
      facts: currentFacts(trusted),
      contradictions: snapshot.contradictions,
      blockers: snapshot.blockers,
      statistics: trusted.persisted.state.statistics as unknown as CanonicalValue,
    },
  };
}

function execute(input: WorkflowAnalysisInput, trusted: TrustedAnalysisState): CanonicalValue {
  switch (input.operation) {
    case "state":
      return stateData(trusted);
    case "why":
      try {
        return {
          operation: input.operation,
          binding: binding(trusted),
          explanation: explainAnalysisFact(trusted.persisted.state, input.fact_id),
        };
      } catch {
        throw new WorkflowAnalysisCliError("STATE_NOT_FOUND");
      }
    case "why-not":
      return {
        operation: input.operation,
        binding: binding(trusted),
        explanation: explainMissingAnalysisFact(
          trusted.persisted.state,
          trusted.authority.primary_subject,
          input.predicate,
        ),
      };
    case "changes":
      if (input.since > trusted.persisted.state.epoch) invalid();
      return {
        operation: input.operation,
        binding: binding(trusted),
        changes: analysisChangesSince(trusted.persisted.state, input.since),
      };
  }
}

function successEnvelope(input: WorkflowAnalysisInput, data: CanonicalValue): WorkflowEnvelope {
  return {
    ok: true,
    command: "workflow",
    schema_version: SCHEMA_VERSION,
    generator_version: GENERATOR_VERSION,
    input,
    data,
  };
}

function errorEnvelope(code: WorkflowAnalysisErrorCode, input?: WorkflowAnalysisInput): WorkflowEnvelope {
  return {
    ok: false,
    command: "workflow",
    schema_version: SCHEMA_VERSION,
    generator_version: GENERATOR_VERSION,
    ...(input ? { input } : {}),
    error: { code, message: publicMessage(code) },
  };
}

function serializeBounded(envelope: WorkflowEnvelope, pretty: boolean): string {
  const serialized = `${JSON.stringify(envelope, null, pretty ? 2 : undefined)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > LIMITS.rendered_bytes) {
    throw new WorkflowAnalysisCliError("STATE_UNTRUSTED");
  }
  return serialized;
}

function mapError(error: unknown): WorkflowAnalysisCliError {
  if (error instanceof WorkflowAnalysisCliError) return error;
  if (error instanceof AnalysisQueryError) return new WorkflowAnalysisCliError(error.code);
  return new WorkflowAnalysisCliError("STATE_UNTRUSTED");
}

export async function runWorkflowAnalysisCommand(args: string[]): Promise<void> {
  let parsed: ParsedWorkflowAnalysisArgs;
  try {
    parsed = parseWorkflowAnalysisArgs(args);
  } catch {
    if (args.includes("--json")) {
      process.stdout.write(serializeBounded(errorEnvelope("INVALID_ARGS"), true));
      process.exitCode = 1;
      return;
    }
    throw new Error(publicMessage("INVALID_ARGS"));
  }

  try {
    const cwd = path.resolve(process.env.CORTEX_PROJECT_ROOT?.trim() || process.cwd());
    const trusted = readTrustedAnalysisState({ cwd, taskId: parsed.input.task_id });
    const envelope = successEnvelope(parsed.input, execute(parsed.input, trusted));
    process.stdout.write(serializeBounded(envelope, parsed.json));
  } catch (error) {
    const mapped = mapError(error);
    if (parsed.json) {
      process.stdout.write(serializeBounded(errorEnvelope(mapped.code, parsed.input), true));
      process.exitCode = 1;
      return;
    }
    throw new Error(mapped.message);
  }
}

export const WORKFLOW_ANALYSIS_SCHEMA_VERSION = SCHEMA_VERSION;
export const WORKFLOW_ANALYSIS_GENERATOR_VERSION = GENERATOR_VERSION;
