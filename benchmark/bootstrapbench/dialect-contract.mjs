import {
  DIALECT_CAPABILITY_MANIFEST,
  DIALECT_LIMITS,
  DIALECT_OBSERVATION_CATEGORIES,
  canonicalJson,
  canonicalRepositoryPath,
  exactKeys,
  hexSha256,
  nonNegativeInteger,
  validateDialectObservationEnvelope,
  visibleIdentifier
} from "../../scaffold/scripts/lib/dialect-observation-contract.mjs";

export * from "../../scaffold/scripts/lib/dialect-observation-contract.mjs";

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

const FAMILY_BY_ID = new Map(DIALECT_CAPABILITY_MANIFEST.families.map((entry) => [entry.family, entry]));

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

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function fail(message) {
  throw new TypeError(`Dialect contract: ${message}`);
}
