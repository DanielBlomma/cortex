import {
  createObservation,
  canonicalJson,
} from "../analysis-state/engine.js";
import type {
  AnalysisFact,
  AnalysisStateReader,
  CanonicalValue,
  Observation,
  ObservationInput,
} from "../analysis-state/schemas.js";
import type { RunState } from "./schemas.js";

export type WorkflowAnalysisGate = {
  enabled: true;
  state: AnalysisStateReader;
  subject: string;
  completionPredicate?: "accepted";
  blockerPredicate?: "blocked";
};

export type WorkflowAnalysisAgreement = {
  subject: string;
  run_outcome: RunState["outcome"];
  completion_predicate: string;
  blocker_predicate: string;
  completion_fact_ids: string[];
  blocker_fact_ids: string[];
  proof: CanonicalValue[];
};

function fail(message: string, evidence: CanonicalValue): never {
  const rendered = canonicalJson(evidence);
  if (Buffer.byteLength(rendered, "utf8") > 65_536) {
    throw new Error(`workflow analysis-state disagreement: ${message}; evidence exceeded bound`);
  }
  throw new Error(`workflow analysis-state disagreement: ${message}; evidence=${rendered}`);
}

function proofs(state: AnalysisStateReader, facts: AnalysisFact[]): CanonicalValue[] {
  return facts.map((fact) => state.why(fact.id) as CanonicalValue);
}

export function assertWorkflowAnalysisAgreement(
  outcome: RunState["outcome"],
  gate?: WorkflowAnalysisGate,
): WorkflowAnalysisAgreement | null {
  if (!gate) return null;
  if (gate.enabled !== true) throw new Error("workflow analysis-state gate must be explicitly enabled");
  const completionPredicate = gate.completionPredicate ?? "accepted";
  const blockerPredicate = gate.blockerPredicate ?? "blocked";
  const completionFacts = gate.state.query(gate.subject, completionPredicate);
  const blockerFacts = gate.state.query(gate.subject, blockerPredicate);
  const evidence = {
    subject: gate.subject,
    run_outcome: outcome,
    completion_fact_ids: completionFacts.map((fact) => fact.id),
    blocker_fact_ids: blockerFacts.map((fact) => fact.id),
    completion_proof: proofs(gate.state, completionFacts),
    blocker_proof: proofs(gate.state, blockerFacts),
    completion_why_not: completionFacts.length === 0
      ? gate.state.whyNot(gate.subject, completionPredicate)
      : null,
  } as unknown as CanonicalValue;

  if (outcome === "complete" && (completionFacts.length === 0 || blockerFacts.length > 0)) {
    fail("complete outcome lacks acceptance or has an active blocker", evidence);
  }
  if ((outcome === "blocked" || outcome === "failed") && blockerFacts.length === 0) {
    fail(`${outcome} outcome lacks a derived blocker`, evidence);
  }
  if ((outcome === "blocked" || outcome === "failed") && completionFacts.length > 0) {
    fail(`${outcome} outcome contradicts derived acceptance`, evidence);
  }

  return {
    subject: gate.subject,
    run_outcome: outcome,
    completion_predicate: completionPredicate,
    blocker_predicate: blockerPredicate,
    completion_fact_ids: completionFacts.map((fact) => fact.id),
    blocker_fact_ids: blockerFacts.map((fact) => fact.id),
    proof: [...proofs(gate.state, completionFacts), ...proofs(gate.state, blockerFacts)],
  };
}

export function createWorkflowAnalysisObservation(
  enabled: true,
  input: ObservationInput,
): Observation {
  if (enabled !== true) {
    throw new Error("workflow analysis-state observation adapter must be explicitly enabled");
  }
  return createObservation(input) as Observation;
}
