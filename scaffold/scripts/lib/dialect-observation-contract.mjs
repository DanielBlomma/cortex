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

export const DIALECT_OBSERVATION_COLUMN_CONTRACT = deepFreeze({
  column_numbering: "zero_based",
  column_unit: "utf16_code_units",
  end_column: "inclusive"
});

// Adapters convert positive-width half-open native spans by locating source
// offset endOffset - 1. They must not decrement a native end-position column
// across multiline or CRLF spans. Zero-width nodes are not observations.

export const DIALECT_NORMALIZED_SHAPE_VOCABULARY = deepFreeze({
  control_flow: [
    "branch", "delegation", "early_return", "fallback", "loop", "ordered_calls"
  ],
  data_representation: [
    "container", "field", "parameter", "record", "return", "state", "variant"
  ],
  declaration_structure: [
    "constructor", "field", "function", "method", "module", "namespace",
    "parameter", "property", "type"
  ],
  error_flow: [
    "cleanup", "handler", "propagate", "raise", "result"
  ],
  test_shape: [
    "assertion", "fixture", "parameterization", "setup", "suite", "teardown",
    "test_declaration"
  ]
});

export const DIALECT_LANGUAGE_SPECIFIC_SHAPE_FORMS = deepFreeze([
  "annotation", "attribute", "block", "clause", "declaration",
  "expression", "modifier", "pattern", "statement"
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

export const DIALECT_CAPABILITY_MANIFEST_SHA256 = sha256(canonicalJson(DIALECT_CAPABILITY_MANIFEST));
export const DIALECT_LIMITS_SHA256 = sha256(canonicalJson(DIALECT_LIMITS));
export const DIALECT_ADAPTER_SHAPE_INVENTORY_SHA256 = sha256(canonicalJson({
  language_specific_shape_forms: DIALECT_LANGUAGE_SPECIFIC_SHAPE_FORMS,
  normalized_shape_vocabulary: DIALECT_NORMALIZED_SHAPE_VOCABULARY
}));

const FAMILY_BY_ID = new Map(DIALECT_CAPABILITY_MANIFEST.families.map((entry) => [entry.family, entry]));
const MODE_BY_EXTENSION = new Map(
  DIALECT_CAPABILITY_MANIFEST.families.flatMap((family) =>
    family.modes.map((mode) => [mode.extension, { family, mode }])
  )
);
const CATEGORY_ORDER = new Map(DIALECT_OBSERVATION_CATEGORIES.map((category, index) => [category, index]));
const RAW_SYNTAX_FIELD_NAMES = new Set([
  "abstractsyntaxtree",
  "ast",
  "astnode",
  "code",
  "concretesyntaxtree",
  "cst",
  "namedrootnode",
  "parsenode",
  "parsetree",
  "rawast",
  "rawcode",
  "rawsource",
  "rawsourcecode",
  "rawsourcetext",
  "rawtext",
  "rawtree",
  "sourcecode",
  "sourcetext",
  "sourcetree",
  "syntaxast",
  "syntaxnode",
  "syntaxtree",
  "tree",
  "treecursor",
  "treesitternode",
  "treesitterrootnode",
  "treesittertree",
  "rootnode"
]);

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
  const copy = { ...canonicalize(value) };
  delete copy[hashKey];
  return sha256(canonicalJson(copy));
}

export function canonicalDialectNormalizedShape(category, kind) {
  if (arguments.length !== 2) fail("normalized shape requires exactly category and kind");
  if (typeof category !== "string" ||
      !Object.hasOwn(DIALECT_NORMALIZED_SHAPE_VOCABULARY, category)) {
    fail("unknown normalized shape category");
  }
  if (typeof kind !== "string" ||
      !DIALECT_NORMALIZED_SHAPE_VOCABULARY[category].includes(kind)) {
    fail("unknown normalized shape kind");
  }
  return canonicalJson({ kind });
}

export function canonicalDialectLanguageSpecificShape(form, syntaxKind) {
  if (arguments.length !== 2) fail("language-specific shape requires exactly form and syntax kind");
  if (typeof form !== "string" ||
      !DIALECT_LANGUAGE_SPECIFIC_SHAPE_FORMS.includes(form)) {
    fail("unknown language-specific shape form");
  }
  visibleIdentifier(syntaxKind, "language-specific syntax kind");
  return canonicalJson({ form, syntax_kind: syntaxKind });
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
      if (!["applicable", "unsupported"].includes(capability.status)) fail(`invalid capability status: ${family.family}/${category}`);
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
  const copy = canonicalize(observation);
  delete copy.observation_id;
  return `${DIALECT_OBSERVATION_ID_PREFIX}${sha256(canonicalJson(copy))}`;
}

export function validateDialectObservation(observation) {
  canonicalize(observation);
  exactKeys(observation, [
    "category", "containing_chunk_id", "end_column", "end_line", "family",
    "language_specific_shape", "normalized_shape", "observation_id", "ordinal",
    "parser_backend", "repository_path", "schema_version", "start_column",
    "start_line", "syntax_mode"
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
  nonNegativeInteger(observation.start_column, "start column");
  nonNegativeInteger(observation.end_column, "end column");
  if (observation.end_line < observation.start_line ||
      (observation.end_line === observation.start_line && observation.end_column < observation.start_column)) {
    fail("observation line span must be ordered and inclusive");
  }
  if (observation.ordinal !== null) nonNegativeInteger(observation.ordinal, "ordinal");
  const expectedId = stableDialectObservationId(observation);
  if (observation.observation_id !== expectedId) fail("DialectObservation identity does not match its canonical content");
  const bytes = Buffer.byteLength(canonicalJson(observation));
  if (bytes > DIALECT_LIMITS.max_observation_json_bytes) fail("DialectObservation exceeds its byte cap");
  return observation;
}

export function compareDialectObservations(left, right) {
  return compareStrings(left.repository_path, right.repository_path) ||
    compareNumbers(left.start_line, right.start_line) ||
    compareNumbers(left.start_column, right.start_column) ||
    compareNumbers(left.end_line, right.end_line) ||
    compareNumbers(left.end_column, right.end_column) ||
    compareNumbers(CATEGORY_ORDER.get(left.category), CATEGORY_ORDER.get(right.category)) ||
    compareStrings(left.normalized_shape, right.normalized_shape) ||
    compareNullableStrings(left.language_specific_shape, right.language_specific_shape) ||
    compareNullableNumbers(left.ordinal, right.ordinal) ||
    compareStrings(left.observation_id, right.observation_id);
}

export function canonicalizeDialectObservations(observations) {
  if (!Array.isArray(observations)) fail("observations must be an array");
  assertCanonicalArrayStructure(observations, "observations");
  if (observations.length > DIALECT_LIMITS.max_observations_per_file) fail("observation file cap exceeded");
  const ids = new Set();
  const chunkCounts = new Map();
  for (const observation of observations) {
    validateDialectObservation(observation);
    if (ids.has(observation.observation_id)) fail(`duplicate observation id: ${observation.observation_id}`);
    ids.add(observation.observation_id);
    if (observation.containing_chunk_id !== null) {
      const count = (chunkCounts.get(observation.containing_chunk_id) ?? 0) + 1;
      if (count > DIALECT_LIMITS.max_observations_per_chunk) fail("observation chunk cap exceeded");
      chunkCounts.set(observation.containing_chunk_id, count);
    }
  }
  return [...observations].sort(compareDialectObservations);
}

export function validateDialectObservationEnvelope(envelope) {
  canonicalize(envelope);
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
  const canonical = canonicalizeDialectObservations(envelope.observations);
  for (let index = 0; index < canonical.length; index += 1) {
    if (canonical[index] !== envelope.observations[index]) fail("positive observations must be canonically ordered");
  }
  return envelope;
}

export function validateExistingParserResult(result) {
  exactKeys(result, ["chunks", "errors"], "existing parser result");
  if (!Array.isArray(result.chunks) || !Array.isArray(result.errors)) fail("existing parser result arrays are invalid");
  return result;
}

export function createDialectObservationTransport(parserResult, observationEnvelope) {
  const transport = {
    schema_version: 1,
    parser_result: parserResult,
    observation_envelope: observationEnvelope
  };
  return validateDialectObservationTransport(transport);
}

export function validateDialectObservationTransport(transport) {
  const canonicalTransport = canonicalize(transport);
  exactKeys(canonicalTransport, ["observation_envelope", "parser_result", "schema_version"], "dialect observation transport");
  if (canonicalTransport.schema_version !== 1) fail("unsupported dialect observation transport version");
  validateExistingParserResult(canonicalTransport.parser_result);
  validateDialectObservationEnvelope(canonicalTransport.observation_envelope);
  rejectObservationFields(canonicalTransport.parser_result, 0, new WeakSet());
  rejectRawSyntaxFields(canonicalTransport, 0, new WeakSet());
  return canonicalTransport;
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
  const actualKeys = ownRecordEntries(value, label).map(([key]) => key);
  if (actualKeys.length !== keys.length) fail(`${label} has unexpected keys`);
  const actual = actualKeys.sort();
  const expected = [...keys].sort();
  if (actual.join("\0") !== expected.join("\0")) fail(`${label} has unexpected keys`);
}

export function visibleBounded(value, maxChars, label) {
  if (typeof value !== "string" || value.length === 0 || [...value].length > maxChars || /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value)) fail(`invalid ${label}`);
  return value;
}

export function visibleIdentifier(value, label) {
  visibleBounded(value, DIALECT_LIMITS.max_identifier_chars, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) fail(`invalid ${label}`);
}

export function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative integer`);
}

function nullableIdentifier(value, label) {
  if (value !== null) visibleBounded(value, DIALECT_LIMITS.max_identifier_chars, label);
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${label} must be a positive integer`);
}

function uniqueStrings(values, label) {
  const seen = new Set();
  for (const value of values) {
    visibleIdentifier(value, label);
    if (seen.has(value)) fail(`duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function compareNumbers(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareStrings(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareNullableStrings(left, right) {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return compareStrings(left, right);
}

function compareNullableNumbers(left, right) {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return compareNumbers(left, right);
}

function rejectRawSyntaxFields(value, depth, ancestors) {
  if (value === null || typeof value !== "object") return;
  if (depth > DIALECT_LIMITS.max_canonical_depth) fail("dialect observation transport exceeds the depth cap");
  if (ancestors.has(value)) fail("dialect observation transport contains a cycle");
  ancestors.add(value);
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.replace(/[^a-z]/gi, "").toLowerCase();
    if (RAW_SYNTAX_FIELD_NAMES.has(normalizedKey) ||
        (normalizedKey === "source" && child !== null && typeof child === "object")) {
      fail(`dialect observation transport cannot retain raw syntax field: ${key}`);
    }
    rejectRawSyntaxFields(child, depth + 1, ancestors);
  }
  ancestors.delete(value);
}

function rejectObservationFields(value, depth, ancestors) {
  if (value === null || typeof value !== "object") return;
  if (depth > DIALECT_LIMITS.max_canonical_depth) fail("existing parser result exceeds the depth cap");
  if (ancestors.has(value)) fail("existing parser result contains a cycle");
  ancestors.add(value);
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.replace(/[^a-z]/gi, "").toLowerCase();
    if (["observation", "observationid", "observations", "observationenvelope"].includes(normalizedKey)) {
      fail(`existing parser result cannot retain observation field: ${key}`);
    }
    rejectObservationFields(child, depth + 1, ancestors);
  }
  ancestors.delete(value);
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
  const valueType = typeof value;
  if (valueType === "string") {
    const bytes = Buffer.byteLength(value);
    if (bytes > DIALECT_LIMITS.max_canonical_string_bytes) fail("canonical input string exceeds the byte cap");
    addCanonicalBytes(state, bytes);
    return value;
  }
  if (value === null || valueType === "boolean") return value;
  if (valueType === "number") {
    if (!Number.isFinite(value)) fail("canonical input contains a non-finite number");
    return value;
  }
  if (valueType !== "object") fail(`canonical input contains a non-JSON ${valueType} value`);
  if (state.ancestors.has(value)) fail("canonical input contains a cycle");
  state.ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    const entries = ownArrayEntries(value, "canonical input array");
    if (entries.length > DIALECT_LIMITS.max_canonical_nodes - state.nodes) fail("canonical input exceeds the node cap");
    result = entries.map(([, entry]) => canonicalizeValue(entry, depth + 1, state));
  } else {
    const entries = ownRecordEntries(value, "canonical input object");
    if (entries.length > DIALECT_LIMITS.max_canonical_nodes - state.nodes) fail("canonical input exceeds the node cap");
    for (const [key] of entries) addCanonicalBytes(state, Buffer.byteLength(key));
    result = Object.fromEntries(
      entries.sort(([left], [right]) => compareStrings(left, right))
        .map(([key, entry]) => [key, canonicalizeValue(entry, depth + 1, state)])
    );
  }
  state.ancestors.delete(value);
  return result;
}

function assertCanonicalArrayStructure(value, label) {
  ownArrayEntries(value, label);
}

function ownArrayEntries(value, label) {
  if (Object.getPrototypeOf(value) !== Array.prototype) fail(`${label} must use the plain array prototype`);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === "symbol")) fail(`${label} cannot contain symbol keys`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const dataKeys = keys.filter((key) => key !== "length");
  if (dataKeys.length !== value.length) fail(`${label} must be a dense JSON array`);
  const entries = [];
  for (const key of dataKeys) {
    if (!isCanonicalArrayIndex(key, value.length)) fail(`${label} has a non-index property`);
    const descriptor = descriptors[key];
    if (!descriptor.enumerable) fail(`${label} has a non-enumerable array entry`);
    if (!("value" in descriptor)) fail(`${label} cannot contain accessors`);
    entries.push([key, descriptor.value]);
  }
  entries.sort(([left], [right]) => Number(left) - Number(right));
  return entries;
}

function ownRecordEntries(value, label) {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} must use a plain record prototype`);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === "symbol")) fail(`${label} cannot contain symbol keys`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const entries = [];
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor.enumerable) fail(`${label} cannot contain non-enumerable fields`);
    if (!("value" in descriptor)) fail(`${label} cannot contain accessors`);
    entries.push([key, descriptor.value]);
  }
  return entries;
}

function isCanonicalArrayIndex(key, length) {
  if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key;
}

function addCanonicalBytes(state, bytes) {
  state.keyStringBytes += bytes;
  if (!Number.isSafeInteger(state.keyStringBytes) || state.keyStringBytes > DIALECT_LIMITS.max_canonical_input_bytes) fail("canonical input exceeds the aggregate key/string byte cap");
}

function fail(message) {
  throw new TypeError(`Dialect contract: ${message}`);
}

validateDialectCapabilityManifest();
