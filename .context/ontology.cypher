// Core node labels for v1
CREATE NODE TABLE IF NOT EXISTS File(
  id STRING,
  path STRING,
  kind STRING,
  excerpt STRING,
  checksum STRING,
  updated_at STRING,
  source_of_truth BOOL,
  trust_level INT64,
  status STRING,
  PRIMARY KEY(id)
);

CREATE NODE TABLE IF NOT EXISTS Rule(
  id STRING,
  title STRING,
  body STRING,
  scope STRING,
  priority INT64,
  updated_at STRING,
  source_of_truth BOOL,
  trust_level INT64,
  status STRING,
  PRIMARY KEY(id)
);

CREATE NODE TABLE IF NOT EXISTS ADR(
  id STRING,
  path STRING,
  title STRING,
  body STRING,
  decision_date STRING,
  supersedes_id STRING,
  source_of_truth BOOL,
  trust_level INT64,
  status STRING,
  PRIMARY KEY(id)
);

CREATE NODE TABLE IF NOT EXISTS Chunk(
  id STRING,
  file_id STRING,
  name STRING,
  kind STRING,
  signature STRING,
  body STRING,
  description STRING,
  start_line INT64,
  end_line INT64,
  language STRING,
  exported BOOL,
  checksum STRING,
  updated_at STRING,
  source_of_truth BOOL,
  trust_level INT64,
  status STRING,
  PRIMARY KEY(id)
);

CREATE NODE TABLE IF NOT EXISTS Module(
  id STRING,
  path STRING,
  name STRING,
  summary STRING,
  file_count INT64,
  exported_symbols STRING,
  updated_at STRING,
  source_of_truth BOOL,
  trust_level INT64,
  status STRING,
  PRIMARY KEY(id)
);

CREATE NODE TABLE IF NOT EXISTS Project(
  id STRING,
  path STRING,
  name STRING,
  kind STRING,
  language STRING,
  target_framework STRING,
  summary STRING,
  file_count INT64,
  updated_at STRING,
  source_of_truth BOOL,
  trust_level INT64,
  status STRING,
  PRIMARY KEY(id)
);

// Core relation tables for v1
CREATE REL TABLE IF NOT EXISTS IMPLEMENTS(FROM File TO Rule, note STRING);
CREATE REL TABLE IF NOT EXISTS CONSTRAINS(FROM Rule TO File, note STRING);
CREATE REL TABLE IF NOT EXISTS SUPERSEDES(FROM ADR TO ADR, reason STRING);
CREATE REL TABLE IF NOT EXISTS DEFINES(FROM File TO Chunk);
CREATE REL TABLE IF NOT EXISTS CALLS(FROM Chunk TO Chunk, call_type STRING);
CREATE REL TABLE IF NOT EXISTS IMPORTS(FROM Chunk TO File, import_name STRING);
CREATE REL TABLE IF NOT EXISTS CALLS_SQL(FROM File TO Chunk, note STRING);
CREATE REL TABLE IF NOT EXISTS USES_CONFIG_KEY(FROM File TO Chunk, note STRING);
CREATE REL TABLE IF NOT EXISTS USES_RESOURCE_KEY(FROM File TO Chunk, note STRING);
CREATE REL TABLE IF NOT EXISTS USES_SETTING_KEY(FROM File TO Chunk, note STRING);
CREATE REL TABLE IF NOT EXISTS CONTAINS(FROM Module TO File);
CREATE REL TABLE IF NOT EXISTS CONTAINS_MODULE(FROM Module TO Module);
CREATE REL TABLE IF NOT EXISTS EXPORTS(FROM Module TO Chunk);
CREATE REL TABLE IF NOT EXISTS INCLUDES_FILE(FROM Project TO File);
CREATE REL TABLE IF NOT EXISTS REFERENCES_PROJECT(FROM Project TO Project, note STRING);
CREATE REL TABLE IF NOT EXISTS USES_RESOURCE(FROM File TO File, note STRING);
CREATE REL TABLE IF NOT EXISTS USES_SETTING(FROM File TO File, note STRING);
CREATE REL TABLE IF NOT EXISTS USES_CONFIG(FROM File TO File, note STRING);
CREATE REL TABLE IF NOT EXISTS TRANSFORMS_CONFIG(FROM File TO File, note STRING);
