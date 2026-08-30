import type { AnalysisStateReader, CanonicalValue } from "./schemas.js";

export function queryAnalysisState(
  state: AnalysisStateReader,
  subject: string,
  predicate: string,
) {
  return state.query(subject, predicate);
}

export function explainAnalysisFact(state: AnalysisStateReader, factId: string): CanonicalValue {
  return state.why(factId) as CanonicalValue;
}

export function explainMissingAnalysisFact(
  state: AnalysisStateReader,
  subject: string,
  predicate: string,
): CanonicalValue {
  return state.whyNot(subject, predicate) as CanonicalValue;
}

export function analysisChangesSince(state: AnalysisStateReader, epoch: number): CanonicalValue[] {
  return state.changesSince(epoch) as CanonicalValue[];
}
