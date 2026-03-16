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

export type RelationType =
  | "CONSTRAINS"
  | "IMPLEMENTS"
  | "SUPERSEDES"
  | "DEFINES"
  | "CALLS"
  | "IMPORTS"
  | "CALLS_SQL"
  | "USES_CONFIG_KEY"
  | "USES_RESOURCE_KEY"
  | "USES_SETTING_KEY"
  | "PART_OF"
  | "CONTAINS"
  | "CONTAINS_MODULE"
  | "EXPORTS"
  | "INCLUDES_FILE"
  | "REFERENCES_PROJECT"
  | "USES_RESOURCE"
  | "USES_SETTING"
  | "USES_CONFIG"
  | "TRANSFORMS_CONFIG";

export type RelationRecord = {
  from: string;
  to: string;
  relation: RelationType;
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

export type ProjectRecord = {
  id: string;
  path: string;
  name: string;
  kind: string;
  language: string;
  target_framework: string;
  summary: string;
  file_count: number;
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
  projects: ProjectRecord[];
  relations: RelationRecord[];
  ranking: RankingWeights;
  source: "cache" | "ryu";
  warning?: string;
};

export type SearchEntity = {
  id: string;
  entity_type: "File" | "Rule" | "ADR" | "Chunk" | "Module" | "Project";
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
  response_preset?: "full" | "compact" | "minimal";
  include_scores?: boolean;
  include_matched_rules?: boolean;
  include_content?: boolean;
};

export type RelatedParams = {
  entity_id: string;
  depth: number;
  include_edges?: boolean;
  response_preset?: "full" | "compact" | "minimal";
  include_entity_metadata?: boolean;
};

export type ImpactParams = {
  entity_id?: string;
  query?: string;
  depth: number;
  top_k: number;
  include_edges: boolean;
  response_preset?: "full" | "compact" | "minimal";
  include_scores?: boolean;
  include_reasons?: boolean;
  verbose_paths?: boolean;
  max_path_hops_shown?: number;
  profile?: "all" | "config_only" | "config_to_sql" | "code_only" | "sql_only";
  sort_by?: "impact_score" | "shortest_path" | "semantic_score" | "graph_score" | "trust_score";
  relation_types?: RelationType[];
  path_must_include?: RelationType[];
  path_must_exclude?: RelationType[];
  result_domains?: ("code" | "config" | "resource" | "settings" | "sql" | "project")[];
  result_entity_types?: ("File" | "Chunk" | "Module" | "Project" | "ADR" | "Rule")[];
};

export type RulesParams = {
  scope?: string;
  include_inactive: boolean;
};

export type ReloadParams = {
  force: boolean;
};

export type ToolPayload = Record<string, unknown>;
