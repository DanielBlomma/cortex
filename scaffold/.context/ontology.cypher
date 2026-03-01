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

// Core relation tables for v1
CREATE REL TABLE IF NOT EXISTS IMPLEMENTS(FROM File TO Rule, note STRING);
CREATE REL TABLE IF NOT EXISTS CONSTRAINS(FROM Rule TO File, note STRING);
CREATE REL TABLE IF NOT EXISTS SUPERSEDES(FROM ADR TO ADR, reason STRING);
