import crypto from "node:crypto";

export const DIALECT_CONTRACT_VERSION = 1;
export const DIALECT_OBSERVATION_ID_PREFIX = "dialect-observation-v1:";

export const DIALECT_OBSERVATION_CATEGORIES = Object.freeze([
  "declaration_structure",
  "control_flow",
  "error_flow",
  "data_representation",
  "test_shape"
]);

export const DIALECT_LIMITS = deepFreeze({
  max_source_bytes: 1_000_000,
  max_source_catalog_files: 10_000,
  max_source_catalog_bytes: 100_000_000,
  max_task_bytes: 16_384,
  max_observations_per_file: 512,
  max_observations_per_chunk: 128,
  max_golden_fixtures: 290,
  max_observation_json_bytes: 16_384,
  max_repository_path_chars: 1_024,
  max_identifier_chars: 1_000,
  max_shape_chars: 4_096,
  max_diagnostic_chars: 1_000,
  max_omission_count: 1_000_000,
  max_tasks: 14,
  min_facets_per_family: 4,
  max_facets: 280,
  min_citations_per_positive_claim: 2,
  max_citations_per_claim: 10,
  max_claims_per_task: 100,
  max_diagnostics_per_task: 50,
  max_rendered_output_bytes: 65_536,
  max_phase_artifact_bytes: 4_000_000,
  max_evaluation_artifacts: 6,
  max_canonical_depth: 32,
  max_canonical_nodes: 100_000,
  max_canonical_string_bytes: 4_000_000,
  max_canonical_input_bytes: 4_000_000
});

const APPLICABLE = Object.freeze({ status: "applicable", reason: null });
const UNSUPPORTED_TEST_SHAPE = Object.freeze({
  status: "unsupported",
  reason: "the existing lightweight parser has no framework-independent test-shape syntax contract"
});

function capabilities({ testShape = true } = {}) {
  return {
    declaration_structure: APPLICABLE,
    control_flow: APPLICABLE,
    error_flow: APPLICABLE,
    data_representation: APPLICABLE,
    test_shape: testShape ? APPLICABLE : UNSUPPORTED_TEST_SHAPE
  };
}

function modes(entries) {
  return entries.map(([extension, registryLanguage]) => ({
    extension,
    registry_language: registryLanguage,
    golden_fixture_id: `dialect-${registryLanguage}-${extension.slice(1).replace(/[^a-z0-9]+/g, "-")}-v1`
  }));
}

export const DIALECT_CAPABILITY_MANIFEST = deepFreeze({
  schema_version: DIALECT_CONTRACT_VERSION,
  manifest_id: "cortex-dialect-capabilities-v1",
  observation_categories: DIALECT_OBSERVATION_CATEGORIES,
  parser_result_contract: {
    keys: ["chunks", "errors"],
    observation_transport: "separate_experimental_envelope"
  },
  source_span_contract: {
    line_numbering: "one_based",
    end_line: "inclusive"
  },
  fallback_contract: "explicit_unavailable_without_fabricated_observations",
  families: [
    {
      family: "javascript",
      parser_technology: "acorn",
      parser_backends: ["acorn"],
      modes: modes([[".js", "javascript"], [".jsx", "jsx"], [".mjs", "javascript"], [".cjs", "javascript"]]),
      capabilities: capabilities()
    },
    {
      family: "typescript",
      parser_technology: "acorn-typescript",
      parser_backends: ["acorn-typescript"],
      modes: modes([[".ts", "typescript"], [".tsx", "tsx"], [".mts", "typescript"], [".cts", "typescript"]]),
      capabilities: capabilities()
    },
    {
      family: "c",
      parser_technology: "c-cpp-tree-sitter-dispatcher",
      parser_backends: ["tree-sitter", "clang-bridge"],
      modes: modes([[".c", "c"], [".h", "c"]]),
      capabilities: capabilities()
    },
    {
      family: "cpp",
      parser_technology: "c-cpp-tree-sitter-dispatcher",
      parser_backends: ["tree-sitter", "clang-bridge"],
      modes: modes([[".cpp", "cpp"], [".cc", "cpp"], [".hpp", "cpp"], [".hh", "cpp"]]),
      capabilities: capabilities()
    },
    {
      family: "csharp",
      parser_technology: "roslyn-bridge",
      parser_backends: ["roslyn"],
      modes: modes([[".cs", "csharp"]]),
      capabilities: capabilities()
    },
    {
      family: "vbnet",
      parser_technology: "roslyn-bridge",
      parser_backends: ["roslyn"],
      modes: modes([[".vb", "vbnet"]]),
      capabilities: capabilities()
    },
    {
      family: "vb6",
      parser_technology: "lightweight-vb6",
      parser_backends: ["lightweight-vb6"],
      modes: modes([[".bas", "vb6"], [".cls", "vb6"], [".frm", "vb6"], [".ctl", "vb6"]]),
      capabilities: capabilities({ testShape: false })
    },
    {
      family: "sql",
      parser_technology: "lightweight-sql",
      parser_backends: ["lightweight-sql"],
      modes: modes([[".sql", "sql"]]),
      capabilities: capabilities({ testShape: false })
    },
    {
      family: "rust",
      parser_technology: "rust-tree-sitter-dispatcher",
      parser_backends: ["tree-sitter", "regex"],
      modes: modes([[".rs", "rust"]]),
      capabilities: capabilities()
    },
    {
      family: "python",
      parser_technology: "tree-sitter",
      parser_backends: ["tree-sitter"],
      modes: modes([[".py", "python"]]),
      capabilities: capabilities()
    },
    {
      family: "go",
      parser_technology: "tree-sitter",
      parser_backends: ["tree-sitter"],
      modes: modes([[".go", "go"]]),
      capabilities: capabilities()
    },
    {
      family: "java",
      parser_technology: "tree-sitter",
      parser_backends: ["tree-sitter"],
      modes: modes([[".java", "java"]]),
      capabilities: capabilities()
    },
    {
      family: "ruby",
      parser_technology: "tree-sitter",
      parser_backends: ["tree-sitter"],
      modes: modes([[".rb", "ruby"]]),
      capabilities: capabilities()
    },
    {
      family: "bash",
      parser_technology: "tree-sitter",
      parser_backends: ["tree-sitter"],
      modes: modes([[".sh", "bash"], [".bash", "bash"], [".zsh", "bash"]]),
      capabilities: capabilities()
    }
  ]
});

export const DIALECT_GOLDEN_CASE_KINDS = Object.freeze([
  "positive",
  "negative",
  "ambiguous",
  "malformed",
  "nested",
  "language_specific",
  "oversized",
  "parser_unavailable",
  "truncated",
  "unsupported"
]);

export const DIALECT_GOLDEN_CASE_STATUS = deepFreeze({
  positive: "ok",
  negative: "ok",
  ambiguous: "ok",
  malformed: "malformed",
  nested: "ok",
  language_specific: "ok",
  oversized: "oversized",
  parser_unavailable: "unavailable",
  truncated: "truncated",
  unsupported: "unsupported"
});

export const DIALECT_MODE_REQUIRED_GOLDEN_CASES = Object.freeze(["positive", "malformed"]);

export const DIALECT_CAPABILITY_MANIFEST_SHA256 = sha256(canonicalJson(DIALECT_CAPABILITY_MANIFEST));
export const DIALECT_LIMITS_SHA256 = sha256(canonicalJson(DIALECT_LIMITS));

const FAMILY_BY_ID = new Map(DIALECT_CAPABILITY_MANIFEST.families.map((entry) => [entry.family, entry]));
const MODE_BY_EXTENSION = new Map(
  DIALECT_CAPABILITY_MANIFEST.families.flatMap((family) =>
    family.modes.map((mode) => [mode.extension, { family, mode }])
  )
);

export function canonicalize(value) {
  return canonicalizeValue(value, 0, { nodes: 0, keyStringBytes: 0, ancestors: new WeakSet() });
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function stablePayloadHash(value, hashKey = "payload_sha256") {
  const copy = { ...value };
  delete copy[hashKey];
  return sha256(canonicalJson(copy));
}

export function validateDialectCapabilityManifest(manifest = DIALECT_CAPABILITY_MANIFEST) {
  canonicalize(manifest);
  exactKeys(manifest, ["families", "fallback_contract", "manifest_id", "observation_categories", "parser_result_contract", "schema_version", "source_span_contract"], "capability manifest");
  if (manifest.schema_version !== 1 || manifest.manifest_id !== "cortex-dialect-capabilities-v1") fail("invalid capability manifest identity");
  if (canonicalJson(manifest.observation_categories) !== canonicalJson(DIALECT_OBSERVATION_CATEGORIES)) fail("invalid observation category inventory");
  exactKeys(manifest.parser_result_contract, ["keys", "observation_transport"], "parser result contract");
  if (canonicalJson(manifest.parser_result_contract.keys) !== canonicalJson(["chunks", "errors"])) fail("parser result keys changed");
  if (manifest.parser_result_contract.observation_transport !== "separate_experimental_envelope") fail("observations must remain separate from parser results");
  exactKeys(manifest.source_span_contract, ["end_line", "line_numbering"], "source span contract");
  if (manifest.source_span_contract.line_numbering !== "one_based" || manifest.source_span_contract.end_line !== "inclusive") fail("invalid source span contract");
  if (manifest.fallback_contract !== "explicit_unavailable_without_fabricated_observations") fail("invalid fallback contract");
  if (!Array.isArray(manifest.families) || manifest.families.length !== 14) fail("capability manifest must contain exactly 14 families");
  const familyIds = new Set();
  const extensions = new Set();
  for (const family of manifest.families) {
    exactKeys(family, ["capabilities", "family", "modes", "parser_backends", "parser_technology"], "language family");
    visibleIdentifier(family.family, "family");
    if (familyIds.has(family.family)) fail(`duplicate family: ${family.family}`);
    familyIds.add(family.family);
    visibleIdentifier(family.parser_technology, "parser technology");
    if (!Array.isArray(family.parser_backends) || family.parser_backends.length === 0) fail(`missing parser backends: ${family.family}`);
    uniqueStrings(family.parser_backends, `parser backends for ${family.family}`);
    exactKeys(family.capabilities, DIALECT_OBSERVATION_CATEGORIES, `capabilities for ${family.family}`);
    for (const category of DIALECT_OBSERVATION_CATEGORIES) {
      const capability = family.capabilities[category];
      exactKeys(capability, ["reason", "status"], `capability ${family.family}/${category}`);
      if (!['applicable', 'unsupported'].includes(capability.status)) fail(`invalid capability status: ${family.family}/${category}`);
      if (capability.status === "applicable" && capability.reason !== null) fail(`applicable capability has a reason: ${family.family}/${category}`);
      if (capability.status === "unsupported") visibleBounded(capability.reason, DIALECT_LIMITS.max_diagnostic_chars, `unsupported reason ${family.family}/${category}`);
    }
    if (!Array.isArray(family.modes) || family.modes.length === 0) fail(`missing modes: ${family.family}`);
    for (const mode of family.modes) {
      exactKeys(mode, ["extension", "golden_fixture_id", "registry_language"], `mode for ${family.family}`);
      if (!/^\.[a-z0-9]+$/.test(mode.extension)) fail(`invalid mode extension: ${mode.extension}`);
      if (extensions.has(mode.extension)) fail(`duplicate mode extension: ${mode.extension}`);
      extensions.add(mode.extension);
      visibleIdentifier(mode.registry_language, "registry language");
      visibleIdentifier(mode.golden_fixture_id, "golden fixture id");
    }
  }
  if (canonicalJson(manifest) !== canonicalJson(DIALECT_CAPABILITY_MANIFEST)) fail("capability manifest differs from the canonical family, mode, backend, or capability table");
  return manifest;
}

export function dialectFamilyForMode(extension) {
  return MODE_BY_EXTENSION.get(extension)?.family ?? null;
}

export function stableDialectObservationId(observation) {
  const copy = { ...observation };
  delete copy.observation_id;
  return `${DIALECT_OBSERVATION_ID_PREFIX}${sha256(canonicalJson(copy))}`;
}

export function validateDialectObservation(observation) {
  exactKeys(observation, [
    "category", "containing_chunk_id", "end_line", "family",
    "language_specific_shape", "normalized_shape", "observation_id", "ordinal",
    "parser_backend", "repository_path", "schema_version", "start_line", "syntax_mode"
  ], "DialectObservation");
  if (observation.schema_version !== 1) fail("unsupported DialectObservation schema version");
  const family = FAMILY_BY_ID.get(observation.family);
  if (!family) fail(`unknown observation family: ${observation.family}`);
  const mode = family.modes.find((entry) => entry.extension === observation.syntax_mode);
  if (!mode) fail(`syntax mode does not belong to family: ${observation.family}/${observation.syntax_mode}`);
  if (!family.parser_backends.includes(observation.parser_backend)) fail(`parser backend does not belong to family: ${observation.parser_backend}`);
  if (!DIALECT_OBSERVATION_CATEGORIES.includes(observation.category)) fail(`unknown observation category: ${observation.category}`);
  if (family.capabilities[observation.category].status !== "applicable") fail(`unsupported capability cannot emit an observation: ${observation.family}/${observation.category}`);
  canonicalRepositoryPath(observation.repository_path);
  nullableIdentifier(observation.containing_chunk_id, "containing chunk id");
  visibleBounded(observation.normalized_shape, DIALECT_LIMITS.max_shape_chars, "normalized shape");
  if (observation.language_specific_shape !== null) visibleBounded(observation.language_specific_shape, DIALECT_LIMITS.max_shape_chars, "language-specific shape");
  positiveInteger(observation.start_line, "start line");
  positiveInteger(observation.end_line, "end line");
  if (observation.end_line < observation.start_line) fail("observation line span must be ordered and inclusive");
  if (observation.ordinal !== null) nonNegativeInteger(observation.ordinal, "ordinal");
  const expectedId = stableDialectObservationId(observation);
  if (observation.observation_id !== expectedId) fail("DialectObservation identity does not match its canonical content");
  const bytes = Buffer.byteLength(canonicalJson(observation));
  if (bytes > DIALECT_LIMITS.max_observation_json_bytes) fail("DialectObservation exceeds its byte cap");
  return observation;
}

export function validateDialectObservationEnvelope(envelope) {
  exactKeys(envelope, ["diagnostics", "observations", "schema_version", "status"], "observation envelope");
  if (envelope.schema_version !== 1) fail("unsupported observation envelope version");
  if (!["ok", "unsupported", "malformed", "oversized", "unavailable", "truncated"].includes(envelope.status)) fail("invalid observation envelope status");
  if (!Array.isArray(envelope.observations)) fail("observations must be an array");
  if (envelope.observations.length > DIALECT_LIMITS.max_observations_per_file) fail("observation file cap exceeded");
  exactKeys(envelope.diagnostics, ["message", "observed_count", "omitted_count"], "observation diagnostics");
  nonNegativeInteger(envelope.diagnostics.observed_count, "observed count");
  nonNegativeInteger(envelope.diagnostics.omitted_count, "omitted count");
  if (envelope.diagnostics.observed_count > DIALECT_LIMITS.max_omission_count || envelope.diagnostics.omitted_count > DIALECT_LIMITS.max_omission_count) fail("observation diagnostic count exceeds cap");
  if (envelope.diagnostics.observed_count !== envelope.observations.length + envelope.diagnostics.omitted_count) fail("observation omission accounting is inconsistent");
  if (envelope.status === "ok" && envelope.diagnostics.omitted_count !== 0) fail("truncated observations must fail explicitly");
  if (envelope.status !== "ok" && envelope.observations.length !== 0) fail("non-ok observation envelopes cannot contain positive observations");
  if (envelope.status === "ok" && envelope.diagnostics.message !== null) fail("ok observation envelope cannot contain a diagnostic message");
  if (envelope.status !== "ok") visibleBounded(envelope.diagnostics.message, DIALECT_LIMITS.max_diagnostic_chars, "observation diagnostic message");
  const ids = new Set();
  const chunkCounts = new Map();
  for (const observation of envelope.observations) {
    validateDialectObservation(observation);
    if (ids.has(observation.observation_id)) fail(`duplicate observation id: ${observation.observation_id}`);
    ids.add(observation.observation_id);
    if (observation.containing_chunk_id !== null) {
      const count = (chunkCounts.get(observation.containing_chunk_id) ?? 0) + 1;
      if (count > DIALECT_LIMITS.max_observations_per_chunk) fail("observation chunk cap exceeded");
      chunkCounts.set(observation.containing_chunk_id, count);
    }
  }
  return envelope;
}

export function validateExistingParserResult(result) {
  exactKeys(result, ["chunks", "errors"], "existing parser result");
  if (!Array.isArray(result.chunks) || !Array.isArray(result.errors)) fail("existing parser result arrays are invalid");
  return result;
}

export function validateDialectGoldenFixture(fixture) {
  exactKeys(fixture, ["case_id", "case_kind", "expected", "family", "fixture_id", "parser_result_sha256", "schema_version", "source_bytes", "source_path", "source_sha256", "syntax_mode"], "dialect golden fixture");
  if (fixture.schema_version !== 1) fail("unsupported golden fixture version");
  const family = FAMILY_BY_ID.get(fixture.family);
  const mode = family?.modes.find((entry) => entry.extension === fixture.syntax_mode);
  if (!mode || fixture.fixture_id !== mode.golden_fixture_id) fail("golden fixture family/mode identity mismatch");
  visibleIdentifier(fixture.case_id, "golden case id");
  if (!DIALECT_GOLDEN_CASE_KINDS.includes(fixture.case_kind)) fail("invalid golden case kind");
  canonicalRepositoryPath(fixture.source_path);
  hexSha256(fixture.source_sha256, "fixture source hash");
  nonNegativeInteger(fixture.source_bytes, "fixture source bytes");
  if (fixture.case_kind === "oversized") {
    if (fixture.source_bytes !== DIALECT_LIMITS.max_source_bytes + 1) fail("oversized golden fixtures must use the exact source-cap boundary plus one byte");
  } else if (fixture.source_bytes > DIALECT_LIMITS.max_source_bytes) {
    fail("non-oversized golden fixture source exceeds the source byte cap");
  }
  hexSha256(fixture.parser_result_sha256, "fixture parser result hash");
  validateDialectObservationEnvelope(fixture.expected);
  for (const observation of fixture.expected.observations) {
    if (observation.family !== fixture.family || observation.syntax_mode !== fixture.syntax_mode || observation.repository_path !== fixture.source_path) fail("fixture observation escaped its family, mode, or source path");
  }
  if (fixture.expected.status !== DIALECT_GOLDEN_CASE_STATUS[fixture.case_kind]) fail("golden case kind has the wrong explicit status");
  const positiveShapeKinds = new Set(["positive", "nested", "language_specific"]);
  const zeroObservationKinds = new Set(["negative", "ambiguous", "malformed", "oversized", "parser_unavailable", "truncated", "unsupported"]);
  if (positiveShapeKinds.has(fixture.case_kind) && fixture.expected.observations.length === 0) fail("positive-shape golden cases require at least one observation");
  if (zeroObservationKinds.has(fixture.case_kind) && fixture.expected.observations.length !== 0) fail("non-positive golden cases must not fabricate observations");
  if (fixture.case_kind === "nested" && !fixture.expected.observations.some((observation) => observation.containing_chunk_id !== null)) fail("nested golden cases require containing chunk evidence");
  if (fixture.case_kind === "language_specific" && !fixture.expected.observations.some((observation) => observation.language_specific_shape !== null)) fail("language-specific golden cases require retained language-specific shape");
  if (fixture.case_kind === "ambiguous" && (fixture.expected.status !== "ok" || fixture.expected.diagnostics.message !== null || fixture.expected.diagnostics.omitted_count !== 0)) fail("ambiguous golden cases mean successful parsing with no claimable observation");
  if (fixture.case_kind === "truncated" && (fixture.expected.diagnostics.omitted_count <= 0 || fixture.expected.diagnostics.observed_count !== fixture.expected.diagnostics.omitted_count)) fail("truncated golden cases require positive, consistent omission accounting");
  return fixture;
}

export function validateDialectGoldenFixtureSet(fixtures) {
  if (!Array.isArray(fixtures) || fixtures.length > DIALECT_LIMITS.max_golden_fixtures) fail("golden fixture set exceeds its bounded inventory");
  const orderedKeys = fixtures.map((fixture) => `${fixture.fixture_id}:${fixture.case_id}`);
  if (canonicalJson(orderedKeys) !== canonicalJson([...orderedKeys].sort())) fail("golden fixture set must be canonically ordered");
  const keys = new Set();
  const byFamily = new Map();
  for (const fixture of fixtures) {
    validateDialectGoldenFixture(fixture);
    const key = `${fixture.fixture_id}:${fixture.case_id}`;
    if (keys.has(key)) fail(`duplicate golden fixture case: ${key}`);
    keys.add(key);
    if (!byFamily.has(fixture.family)) byFamily.set(fixture.family, []);
    byFamily.get(fixture.family).push(fixture);
  }
  for (const family of DIALECT_CAPABILITY_MANIFEST.families) {
    const familyFixtures = byFamily.get(family.family) ?? [];
    const caseKinds = new Set(familyFixtures.map((fixture) => fixture.case_kind));
    for (const kind of DIALECT_GOLDEN_CASE_KINDS) {
      if (!caseKinds.has(kind)) fail(`missing family golden case: ${family.family}/${kind}`);
    }
    for (const mode of family.modes) {
      const modeKinds = new Set(familyFixtures.filter((fixture) => fixture.syntax_mode === mode.extension).map((fixture) => fixture.case_kind));
      for (const kind of DIALECT_MODE_REQUIRED_GOLDEN_CASES) {
        if (!modeKinds.has(kind)) fail(`missing mode golden case: ${mode.extension}/${kind}`);
      }
    }
    const observedCategories = new Set(
      familyFixtures.flatMap((fixture) => fixture.expected.observations.map((observation) => observation.category))
    );
    for (const category of DIALECT_OBSERVATION_CATEGORIES) {
      if (family.capabilities[category].status === "applicable" && !observedCategories.has(category)) fail(`missing applicable family capability fixture: ${family.family}/${category}`);
    }
  }
  return fixtures;
}

export function canonicalRepositoryPath(value) {
  visibleBounded(value, DIALECT_LIMITS.max_repository_path_chars, "repository path");
  if (value === "." || value.startsWith("/") || /^[A-Za-z]:/.test(value) || value.includes("\\") || value.endsWith("/") || value.includes("//")) fail(`non-canonical repository path: ${value}`);
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) fail(`non-canonical repository path: ${value}`);
  return value;
}

export function hexSha256(value, label = "sha256") {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail(`invalid ${label}`);
  return value;
}

export function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const actualKeys = Object.keys(value);
  if (actualKeys.length !== keys.length) fail(`${label} has unexpected keys`);
  const actual = actualKeys.sort();
  const expected = [...keys].sort();
  if (actual.join("\0") !== expected.join("\0")) fail(`${label} has unexpected keys`);
}

function visibleBounded(value, maxChars, label) {
  if (typeof value !== "string" || value.length === 0 || [...value].length > maxChars || /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value)) fail(`invalid ${label}`);
  return value;
}

function visibleIdentifier(value, label) {
  visibleBounded(value, DIALECT_LIMITS.max_identifier_chars, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) fail(`invalid ${label}`);
}

function nullableIdentifier(value, label) {
  if (value !== null) visibleBounded(value, DIALECT_LIMITS.max_identifier_chars, label);
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${label} must be a positive integer`);
}

export function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative integer`);
}

function uniqueStrings(values, label) {
  const seen = new Set();
  for (const value of values) {
    visibleIdentifier(value, label);
    if (seen.has(value)) fail(`duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function canonicalizeValue(value, depth, state) {
  state.nodes += 1;
  if (state.nodes > DIALECT_LIMITS.max_canonical_nodes) fail("canonical input exceeds the node cap");
  if (depth > DIALECT_LIMITS.max_canonical_depth) fail("canonical input exceeds the depth cap");
  if (typeof value === "string") {
    const bytes = Buffer.byteLength(value);
    if (bytes > DIALECT_LIMITS.max_canonical_string_bytes) fail("canonical input string exceeds the byte cap");
    addCanonicalBytes(state, bytes);
    return value;
  }
  if (value === null || typeof value !== "object") return value;
  if (state.ancestors.has(value)) fail("canonical input contains a cycle");
  state.ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((entry) => canonicalizeValue(entry, depth + 1, state));
  } else {
    const keys = Object.keys(value);
    if (keys.length > DIALECT_LIMITS.max_canonical_nodes - state.nodes) fail("canonical input exceeds the node cap");
    for (const key of keys) addCanonicalBytes(state, Buffer.byteLength(key));
    result = Object.fromEntries(keys.sort().map((key) => [key, canonicalizeValue(value[key], depth + 1, state)]));
  }
  state.ancestors.delete(value);
  return result;
}

function addCanonicalBytes(state, bytes) {
  state.keyStringBytes += bytes;
  if (!Number.isSafeInteger(state.keyStringBytes) || state.keyStringBytes > DIALECT_LIMITS.max_canonical_input_bytes) fail("canonical input exceeds the aggregate key/string byte cap");
}

function fail(message) {
  throw new TypeError(`Dialect contract: ${message}`);
}

validateDialectCapabilityManifest();
