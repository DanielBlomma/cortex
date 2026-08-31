import crypto from "node:crypto";

import { LIMITS } from "./engine.js";
import { explainAnalysisFact, queryAnalysisState } from "./queries.js";
import {
  AnalysisQueryError,
  readTrustedAnalysisState,
} from "./query-reader.js";
import type { AnalysisFact, AnalysisStateReader, CanonicalValue } from "./schemas.js";

const GENERATOR = "maintained-analysis-current-state-v1" as const;
const DECISION_PREDICATES = Object.freeze([
  "accepted",
  "review_ready",
  "work_order_inputs_viable",
  "evidence_trusted",
  "required_reviews_go",
] as const);

const FACT_ID_RE = /^(?:base:obs|fact):[0-9a-f]{64}$/u;
const OBSERVATION_ID_RE = /^obs:[0-9a-f]{64}$/u;
const CONTRADICTION_ID_RE = /^contradiction:[0-9a-f]{64}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const ENTITY_RE = /^(?:WO|wo|review|task|fixture|test)[A-Za-z0-9:-]{1,119}$/u;
const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/u;

export type CurrentStateDecisionStatus =
  | "derivable"
  | "not derivable"
  | "contradicted";

export type CurrentStateObservationReference = {
  observation_id: string;
  source_sha256: string;
};

export type CurrentStateFactReference = {
  fact_id: string;
  observations: CurrentStateObservationReference[];
};

export type CurrentStateDecision = {
  predicate: (typeof DECISION_PREDICATES)[number];
  status: CurrentStateDecisionStatus;
  facts: CurrentStateFactReference[];
};

export type CurrentStateBlocker = {
  blocker: string;
  fact: CurrentStateFactReference;
};

export type CurrentStateContradiction = {
  contradiction_id: string;
  subject: string;
  predicate: string;
  payload_sha256: string;
};

export type TrustedAnalysisCurrentStateOptions = {
  enabled: true;
  cwd: string;
  taskId: string;
};

export type TrustedAnalysisCurrentState = {
  schema_version: 1;
  generator: typeof GENERATOR;
  repository: string;
  task_id: string;
  primary_subject: string;
  generation: number;
  snapshot_sha256: string;
  authority_bundle_sha256: string;
  decisions: CurrentStateDecision[];
  blockers: CurrentStateBlocker[];
  contradictions: CurrentStateContradiction[];
  markdown: string;
  markdown_sha256: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalid(message: string): never {
  throw new AnalysisQueryError("AUTHORITY_INVALID", message);
}

function untrusted(): never {
  throw new AnalysisQueryError(
    "STATE_UNTRUSTED",
    "maintained analysis Current State projection is invalid",
  );
}

function validateOptions(value: unknown): TrustedAnalysisCurrentStateOptions {
  if (!isPlainObject(value)) invalid("maintained analysis Current State options are invalid");
  const keys = Object.keys(value).sort();
  if (keys.join("\0") !== ["cwd", "enabled", "taskId"].sort().join("\0")) {
    invalid("maintained analysis Current State options are invalid");
  }
  if (value.enabled !== true) {
    invalid("maintained analysis Current State projection is disabled");
  }
  if (typeof value.cwd !== "string" || value.cwd.length === 0 || typeof value.taskId !== "string") {
    invalid("maintained analysis Current State options are invalid");
  }
  return value as TrustedAnalysisCurrentStateOptions;
}

function record(value: CanonicalValue): Record<string, CanonicalValue> {
  if (!isPlainObject(value)) untrusted();
  return value;
}

function stringArray(value: CanonicalValue | undefined, pattern: RegExp): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !pattern.test(item))) {
    untrusted();
  }
  return [...new Set(value as string[])].sort();
}

function factReference(state: AnalysisStateReader, fact: AnalysisFact): CurrentStateFactReference {
  if (!FACT_ID_RE.test(fact.id)) untrusted();
  const explanation = record(explainAnalysisFact(state, fact.id));
  if (!Array.isArray(explanation.paths) || explanation.paths.length === 0) untrusted();
  const byPair = new Map<string, CurrentStateObservationReference>();

  for (const rawPath of explanation.paths) {
    const proofPath = record(rawPath);
    const observationIds = new Set(stringArray(proofPath.observation_ids, OBSERVATION_ID_RE));
    if (!Array.isArray(proofPath.sources)) untrusted();
    const sourcedObservationIds = new Set<string>();
    for (const rawSource of proofPath.sources) {
      const source = record(rawSource);
      if (
        typeof source.observation_id !== "string" ||
        !OBSERVATION_ID_RE.test(source.observation_id) ||
        !observationIds.has(source.observation_id) ||
        typeof source.sha256 !== "string" ||
        !SHA256_RE.test(source.sha256)
      ) {
        untrusted();
      }
      const reference = {
        observation_id: source.observation_id,
        source_sha256: source.sha256,
      };
      sourcedObservationIds.add(reference.observation_id);
      byPair.set(`${reference.observation_id}\0${reference.source_sha256}`, reference);
    }
    if (
      sourcedObservationIds.size !== observationIds.size ||
      [...observationIds].some((observationId) => !sourcedObservationIds.has(observationId))
    ) {
      untrusted();
    }
  }

  const observations = [...byPair.values()].sort((left, right) =>
    left.observation_id.localeCompare(right.observation_id) ||
    left.source_sha256.localeCompare(right.source_sha256),
  );
  if (observations.length === 0) untrusted();
  return { fact_id: fact.id, observations };
}

function contradiction(value: CanonicalValue): CurrentStateContradiction {
  const item = record(value);
  if (
    typeof item.id !== "string" || !CONTRADICTION_ID_RE.test(item.id) ||
    typeof item.subject !== "string" || !ENTITY_RE.test(item.subject) ||
    typeof item.predicate !== "string" || !TOKEN_RE.test(item.predicate) ||
    typeof item.payload_sha256 !== "string" || !SHA256_RE.test(item.payload_sha256)
  ) {
    untrusted();
  }
  return {
    contradiction_id: item.id,
    subject: item.subject,
    predicate: item.predicate,
    payload_sha256: item.payload_sha256,
  };
}

function code(value: string | number): string {
  return `\`${String(value)}\``;
}

function renderFact(reference: CurrentStateFactReference): string {
  const observations = reference.observations
    .map((item) => `${code(item.observation_id)} @ ${code(item.source_sha256)}`)
    .join(", ");
  return `fact ${code(reference.fact_id)}; observations ${observations}`;
}

function renderMarkdown(input: Omit<TrustedAnalysisCurrentState, "markdown" | "markdown_sha256">): string {
  const lines = [
    `## Current State — ${code(input.primary_subject)}`,
    "",
    `- Repository: ${code(input.repository)}`,
    `- Task: ${code(input.task_id)}`,
    `- Primary subject: ${code(input.primary_subject)}`,
    `- Generation: ${code(input.generation)}`,
    `- Snapshot SHA-256: ${code(input.snapshot_sha256)}`,
    `- Authority bundle SHA-256: ${code(input.authority_bundle_sha256)}`,
    "",
    "### Decisions",
    "",
  ];

  for (const decision of input.decisions) {
    lines.push(`- ${code(decision.predicate)}: ${decision.status}`);
    for (const fact of decision.facts) lines.push(`  - ${renderFact(fact)}`);
  }

  lines.push("", `### Active blockers (${input.blockers.length})`, "");
  if (input.blockers.length === 0) {
    lines.push("- None.");
  } else {
    for (const blocker of input.blockers) {
      lines.push(`- ${code(blocker.blocker)}; ${renderFact(blocker.fact)}`);
    }
  }

  lines.push("", `### Contradictions (${input.contradictions.length})`, "");
  if (input.contradictions.length === 0) {
    lines.push("- None.");
  } else {
    for (const item of input.contradictions) {
      lines.push(
        `- ${code(item.subject)} / ${code(item.predicate)}; ` +
        `contradiction ${code(item.contradiction_id)}; payload SHA-256 ${code(item.payload_sha256)}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export function renderTrustedAnalysisCurrentState(
  rawOptions: TrustedAnalysisCurrentStateOptions,
): TrustedAnalysisCurrentState {
  const options = validateOptions(rawOptions);
  const trusted = readTrustedAnalysisState({ cwd: options.cwd, taskId: options.taskId });
  try {
    const state = trusted.persisted.state;
    const primarySubject = trusted.authority.primary_subject;
    const contradictions = state.snapshot.contradictions
      .map(contradiction)
      .sort((left, right) => left.contradiction_id.localeCompare(right.contradiction_id));

    const decisions = DECISION_PREDICATES.map((predicate): CurrentStateDecision => {
      const facts = queryAnalysisState(state, primarySubject, predicate)
        .map((fact) => factReference(state, fact))
        .sort((left, right) => left.fact_id.localeCompare(right.fact_id));
      const contradicted = contradictions.some(
        (item) => item.subject === primarySubject && item.predicate === predicate,
      );
      return {
        predicate,
        status: contradicted ? "contradicted" : facts.length > 0 ? "derivable" : "not derivable",
        facts,
      };
    });

    const blockers = queryAnalysisState(state, primarySubject, "blocked")
      .map((fact): CurrentStateBlocker => {
        if (typeof fact.object !== "string" || !TOKEN_RE.test(fact.object)) untrusted();
        return { blocker: fact.object, fact: factReference(state, fact) };
      })
      .sort((left, right) => left.fact.fact_id.localeCompare(right.fact.fact_id));

    const projection = {
      schema_version: 1 as const,
      generator: GENERATOR,
      repository: trusted.authority.repository,
      task_id: trusted.authority.task_id,
      primary_subject: primarySubject,
      generation: trusted.persisted.manifest.generation,
      snapshot_sha256: trusted.persisted.manifest.snapshot_sha256,
      authority_bundle_sha256: trusted.authority.bundle_sha256,
      decisions,
      blockers,
      contradictions,
    };
    const markdown = renderMarkdown(projection);
    if (Buffer.byteLength(markdown, "utf8") > LIMITS.rendered_bytes) {
      throw new AnalysisQueryError(
        "STATE_UNTRUSTED",
        "maintained analysis Current State projection exceeds its byte bound",
      );
    }
    return {
      ...projection,
      markdown,
      markdown_sha256: crypto.createHash("sha256").update(markdown, "utf8").digest("hex"),
    };
  } catch (error) {
    if (error instanceof AnalysisQueryError) throw error;
    untrusted();
  }
}

export const MAINTAINED_ANALYSIS_CURRENT_STATE_GENERATOR = GENERATOR;
export const MAINTAINED_ANALYSIS_CURRENT_STATE_DECISIONS = DECISION_PREDICATES;
