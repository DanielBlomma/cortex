export type CanonicalScalar = null | boolean | number | string;
export type CanonicalValue = CanonicalScalar | CanonicalValue[] | { [key: string]: CanonicalValue };

export type AnalysisAuthority = "artifact" | "manager" | "reviewer" | "test" | "tool";
export type AnalysisOperation = "assert" | "retract";

export type ObservationSource = {
  path: string;
  sha256: string;
  selector?: string;
};

export type ObservationScope = {
  repository: string;
  work_order: string;
  phase: string;
};

export type ObservationInput = {
  schema_version: 1;
  subject: string;
  predicate: string;
  object: CanonicalValue;
  operation: AnalysisOperation;
  target_observation_id?: string;
  observed_at: string;
  authority: AnalysisAuthority;
  source: ObservationSource;
  scope: ObservationScope;
  supersedes: string[];
};

export type Observation = ObservationInput & {
  id: string;
  payload_sha256: string;
};

export type AuthorityClaim = {
  observation_id: string;
  claim_sha256: string;
};

export type AuthorityManifest = {
  schema_version: 1;
  claims: AuthorityClaim[];
  manifest_sha256: string;
};

export type SourceAuthorityRegistry = Readonly<Record<string, Readonly<{
  sha256: string;
  authorities: readonly AnalysisAuthority[];
}>>>;

export type AnalysisInput = {
  schema_version: 1;
  rule_ids: string[];
  observations: Observation[];
};

export type AnalysisFact = {
  id: string;
  kind?: "base" | "derived";
  subject: string;
  predicate: string;
  object: CanonicalValue;
  epoch: number;
  rule_id?: string;
  supports: string[];
  payload_sha256: string;
};

export type AnalysisSnapshot = {
  schema_version: 1;
  epoch: number;
  ruleset_sha256: string;
  observation_head_sha256: string;
  active_observation_count: number;
  derived_facts: AnalysisFact[];
  contradictions: CanonicalValue[];
  blockers: CanonicalValue[];
  snapshot_sha256: string;
};

export type AnalysisStatistics = {
  epoch: number;
  snapshot_epoch: number;
  authority_manifest_sha256: string;
  observation_count: number;
  active_observation_count: number;
  base_fact_count: number;
  derived_fact_count: number;
  active_fact_count: number;
  proof_count: number;
  contradiction_count: number;
  blocker_count: number;
  rule_count: number;
};

export interface AnalysisStateReader {
  readonly epoch: number;
  readonly snapshot: AnalysisSnapshot;
  readonly snapshotBytes: string;
  readonly statistics: AnalysisStatistics;
  query(subject: string, predicate: string): AnalysisFact[];
  why(factId: string): CanonicalValue;
  whyNot(subject: string, predicate: string): CanonicalValue;
  changesSince(epoch: number): CanonicalValue[];
  observationHistory(): Array<Observation & { active: boolean }>;
}

export const ANALYSIS_STORE_SCHEMA_VERSION = 1 as const;
export const ANALYSIS_DIRECTORY_NAME = "analysis" as const;
export const ANALYSIS_STORE_FILES = Object.freeze([
  "changes.jsonl",
  "manifest.json",
  "observations.jsonl",
  "snapshot.json",
] as const);

export type AnalysisStoreFile = (typeof ANALYSIS_STORE_FILES)[number];
