export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };
export type UnknownRow = Record<string, unknown>;

export type DocumentRecord = {
  id: string;
  path: string;
  kind: "DOC" | "CODE" | "ADR";
  updated_at: string;
  source_of_truth: boolean;
  trust_level: number;
  status: string;
  excerpt: string;
  content: string;
};

export type RuleRecord = {
  id: string;
  title: string;
  body: string;
  scope: string;
  updated_at: string;
  source_of_truth: boolean;
  trust_level: number;
  status: string;
  priority: number;
};

export type AdrRecord = {
  id: string;
  path: string;
  title: string;
  body: string;
  decision_date: string;
  supersedes_id: string;
  source_of_truth: boolean;
  trust_level: number;
  status: string;
};

export type RelationRecord = {
  from: string;
  to: string;
  relation: "CONSTRAINS" | "IMPLEMENTS" | "SUPERSEDES" | "DEFINES" | "CALLS" | "IMPORTS" | "PART_OF" | "CONTAINS" | "CONTAINS_MODULE" | "EXPORTS";
  note: string;
};

export type ChunkRecord = {
  id: string;
  file_id: string;
  name: string;
  kind: string;
  signature: string;
  body: string;
  description: string;
  start_line: number;
  end_line: number;
  language: string;
  exported: boolean;
  updated_at: string;
  source_of_truth: boolean;
  trust_level: number;
  status: string;
};

export type ModuleRecord = {
  id: string;
  path: string;
  name: string;
  summary: string;
  file_count: number;
  exported_symbols: string;
  updated_at: string;
  source_of_truth: boolean;
  trust_level: number;
  status: string;
};

export type RankingWeights = {
  semantic: number;
  graph: number;
  trust: number;
  recency: number;
};

export type ContextData = {
  documents: DocumentRecord[];
  adrs: AdrRecord[];
  rules: RuleRecord[];
  chunks: ChunkRecord[];
  modules: ModuleRecord[];
  relations: RelationRecord[];
  ranking: RankingWeights;
  source: "cache" | "ryu";
  warning?: string;
};

export type SearchEntity = {
  id: string;
  entity_type: "File" | "Rule" | "ADR" | "Chunk" | "Module";
  kind: string;
  label: string;
  path: string;
  text: string;
  status: string;
  source_of_truth: boolean;
  trust_level: number;
  updated_at: string;
  snippet: string;
  matched_rules: string[];
  content?: string;
};

export type EmbeddingIndex = {
  model: string | null;
  vectors: Map<string, number[]>;
  warning?: string;
};

export type SearchParams = {
  query: string;
  top_k: number;
  include_deprecated: boolean;
  include_content: boolean;
};

export type RelatedParams = {
  entity_id: string;
  depth: number;
  include_edges: boolean;
};

export type RulesParams = {
  scope?: string;
  include_inactive: boolean;
};

export type ReloadParams = {
  force: boolean;
};

export type ToolPayload = Record<string, unknown>;
