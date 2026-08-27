import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  DIALECT_CAPABILITY_MANIFEST,
  DIALECT_CAPABILITY_MANIFEST_SHA256,
  DIALECT_GOLDEN_CASE_KINDS,
  DIALECT_GOLDEN_CASE_STATUS,
  DIALECT_LIMITS,
  DIALECT_LIMITS_SHA256,
  canonicalJson,
  canonicalize,
  sha256,
  stableDialectObservationId,
  validateDialectCapabilityManifest,
  validateDialectGoldenFixtureSet,
  validateDialectObservation,
  validateDialectObservationEnvelope,
  validateExistingParserResult
} from "../benchmark/bootstrapbench/dialect-contract.mjs";
const HASH = sha256("dialect-contract-fixture");
const PARSER_REGISTRY_SOURCE = fs.readFileSync(
  new URL("../scaffold/scripts/lib/ingest/parser-registry.mjs", import.meta.url),
  "utf8"
);

function observation({
  family = "javascript",
  mode = ".js",
  backend = "acorn",
  category = "declaration_structure",
  sourcePath = "fixtures/javascript/sample.js",
  line = 1,
  ordinal = null,
  languageShape = null
} = {}) {
  const value = {
    schema_version: 1,
    observation_id: "",
    family,
    syntax_mode: mode,
    parser_backend: backend,
    repository_path: sourcePath,
    containing_chunk_id: `chunk:${sourcePath}:sample:${line}-${line}`,
    start_line: line,
    start_column: 0,
    end_line: line,
    end_column: 1,
    category,
    normalized_shape: `${category}:sample`,
    language_specific_shape: languageShape,
    ordinal
  };
  value.observation_id = stableDialectObservationId(value);
  return value;
}

function envelope(status, observations = [], omittedCount = 0) {
  return {
    schema_version: 1,
    status,
    observations,
    diagnostics: {
      message: status === "ok" ? null : `${status} fixture`,
      observed_count: observations.length + omittedCount,
      omitted_count: omittedCount
    }
  };
}

test("capability manifest freezes all 14 parser families and 29 registered modes", () => {
  validateDialectCapabilityManifest();
  assert.equal(DIALECT_CAPABILITY_MANIFEST.families.length, 14);
  const modes = DIALECT_CAPABILITY_MANIFEST.families.flatMap((family) =>
    family.modes.map((mode) => ({ family: family.family, ...mode }))
  );
  assert.equal(modes.length, 29);
  assert.equal(
    DIALECT_CAPABILITY_MANIFEST_SHA256,
    "32ea6b9331a562ba06d87b5f9a01dc1a5487f0619e38040488de813505489f11"
  );
  assert.equal(
    DIALECT_LIMITS_SHA256,
    "aabe57c65a97253e4ae617b00c653ef5f14e2259a5006b354807468e47a1a602"
  );

  for (const mode of modes) {
    const registryStart = PARSER_REGISTRY_SOURCE.indexOf("const CHUNK_PARSERS");
    const extensionOffset = PARSER_REGISTRY_SOURCE.indexOf(`"${mode.extension}"`, registryStart);
    assert.ok(extensionOffset >= registryStart, `registered parser is missing for ${mode.extension}`);
    const registryEntry = PARSER_REGISTRY_SOURCE.slice(extensionOffset, extensionOffset + 320);
    assert.match(registryEntry, new RegExp(`language: "${mode.registry_language}"`), mode.extension);
  }

  assert.equal(DIALECT_CAPABILITY_MANIFEST.families.find((family) => family.family === "sql").capabilities.test_shape.status, "unsupported");
  assert.equal(DIALECT_CAPABILITY_MANIFEST.families.find((family) => family.family === "vb6").capabilities.test_shape.status, "unsupported");
  assert.deepEqual(DIALECT_CAPABILITY_MANIFEST.families.find((family) => family.family === "c").parser_backends, ["tree-sitter", "clang-bridge"]);
  assert.deepEqual(DIALECT_CAPABILITY_MANIFEST.families.find((family) => family.family === "cpp").parser_backends, ["tree-sitter", "clang-bridge"]);
  assert.deepEqual(DIALECT_CAPABILITY_MANIFEST.families.find((family) => family.family === "rust").parser_backends, ["tree-sitter", "regex"]);
});

test("capability manifest rejects valid-looking family, mode, backend, and capability mutations", () => {
  const mutations = [
    (manifest) => { manifest.families[0].family = "javascript2"; },
    (manifest) => { manifest.families[0].modes[0].registry_language = "jsx"; },
    (manifest) => { manifest.families.find((family) => family.family === "c").parser_backends[1] = "clang_bridge"; },
    (manifest) => {
      manifest.families.find((family) => family.family === "sql").capabilities.test_shape = {
        status: "applicable",
        reason: null
      };
    }
  ];
  for (const mutate of mutations) {
    const manifest = structuredClone(DIALECT_CAPABILITY_MANIFEST);
    mutate(manifest);
    assert.throws(() => validateDialectCapabilityManifest(manifest), /canonical family, mode, backend, or capability table/);
  }
});

test("DialectObservation validates closed fields, canonical paths, exact spans, and content-derived ids", () => {
  const value = observation();
  assert.equal(validateDialectObservation(value), value);
  assert.equal(stableDialectObservationId(value), value.observation_id);

  assert.throws(
    () => validateDialectObservation({ ...value, repository_path: "../outside.js" }),
    /non-canonical repository path/
  );
  assert.throws(
    () => validateDialectObservation({ ...value, start_line: 2, end_line: 1, observation_id: stableDialectObservationId({ ...value, start_line: 2, end_line: 1 }) }),
    /line span must be ordered/
  );
  assert.throws(
    () => validateDialectObservation({ ...value, chunks: [] }),
    /unexpected keys/
  );
  assert.throws(
    () => validateDialectObservation({ ...value, normalized_shape: "changed" }),
    /identity does not match/
  );
});

test("unsupported capabilities and fallback failures cannot become positive observations", () => {
  const sqlTest = observation({
    family: "sql",
    mode: ".sql",
    backend: "lightweight-sql",
    category: "test_shape",
    sourcePath: "fixtures/sql/sample.sql"
  });
  assert.throws(() => validateDialectObservation(sqlTest), /unsupported capability/);

  assert.deepEqual(validateDialectObservationEnvelope(envelope("unavailable")), envelope("unavailable"));
  assert.throws(
    () => validateDialectObservationEnvelope(envelope("unavailable", [observation()])),
    /non-ok observation envelopes cannot contain positive observations/
  );
});

test("observation caps and omission accounting fail closed", () => {
  const value = observation();
  assert.throws(
    () => validateDialectObservationEnvelope({
      schema_version: 1,
      status: "ok",
      observations: [value],
      diagnostics: { message: null, observed_count: 2, omitted_count: 0 }
    }),
    /omission accounting is inconsistent/
  );
  assert.throws(
    () => validateDialectObservation({
      ...value,
      normalized_shape: "x".repeat(DIALECT_LIMITS.max_shape_chars + 1),
      observation_id: stableDialectObservationId({
        ...value,
        normalized_shape: "x".repeat(DIALECT_LIMITS.max_shape_chars + 1)
      })
    }),
    /invalid normalized shape/
  );
});

test("existing parser and observation transports remain unambiguous", () => {
  assert.deepEqual(validateExistingParserResult({ chunks: [], errors: [] }), { chunks: [], errors: [] });
  assert.throws(
    () => validateExistingParserResult({ chunks: [], errors: [], observations: [] }),
    /unexpected keys/
  );
  assert.throws(
    () => validateDialectObservationEnvelope({ chunks: [], errors: [] }),
    /unexpected keys/
  );
});

test("golden fixture set requires every mode, negative condition, and applicable family capability", () => {
  const fixtures = [];
  for (const family of DIALECT_CAPABILITY_MANIFEST.families) {
    for (const mode of family.modes) {
      for (const caseKind of DIALECT_GOLDEN_CASE_KINDS) {
        if (mode !== family.modes[0] && !["positive", "malformed"].includes(caseKind)) continue;
        const sourcePath = `fixtures/${family.family}/${mode.extension.slice(1)}/${caseKind}${mode.extension}`;
        const observations = [];
        if (["positive", "nested", "language_specific"].includes(caseKind)) {
          const categories = mode === family.modes[0]
            && caseKind === "positive"
            ? Object.entries(family.capabilities).filter(([, capability]) => capability.status === "applicable").map(([category]) => category)
            : ["declaration_structure"];
          categories.forEach((category, index) => observations.push(observation({
            family: family.family,
            mode: mode.extension,
            backend: family.parser_backends[0],
            category,
            sourcePath,
            line: index + 1,
            ordinal: category === "control_flow" ? index : null,
            languageShape: caseKind === "language_specific" ? `${family.family}:specific` : null
          })));
        }
        fixtures.push({
          schema_version: 1,
          fixture_id: mode.golden_fixture_id,
          case_id: caseKind,
          case_kind: caseKind,
          family: family.family,
          syntax_mode: mode.extension,
          source_path: sourcePath,
          source_sha256: HASH,
          source_bytes: caseKind === "oversized" ? DIALECT_LIMITS.max_source_bytes + 1 : 128,
          parser_result_sha256: sha256(canonicalJson({ chunks: [], errors: [] })),
          expected: envelope(DIALECT_GOLDEN_CASE_STATUS[caseKind], observations, caseKind === "truncated" ? 1 : 0)
        });
      }
    }
  }
  fixtures.sort((left, right) => `${left.fixture_id}:${left.case_id}`.localeCompare(`${right.fixture_id}:${right.case_id}`));
  assert.equal(validateDialectGoldenFixtureSet(fixtures), fixtures);

  const missingModeCase = fixtures.filter((fixture) => !(fixture.syntax_mode === ".zsh" && fixture.case_kind === "malformed"));
  assert.throws(() => validateDialectGoldenFixtureSet(missingModeCase), /missing mode golden case/);

  const mutateCase = (kind, mutate) => {
    const changed = structuredClone(fixtures);
    const index = changed.findIndex((fixture) => fixture.case_kind === kind);
    mutate(changed[index]);
    return changed;
  };
  for (const kind of ["positive", "nested", "language_specific"]) {
    assert.throws(
      () => validateDialectGoldenFixtureSet(mutateCase(kind, (changed) => { changed.expected.observations = []; changed.expected.diagnostics.observed_count = 0; })),
      /positive-shape golden cases/,
      kind
    );
  }
  assert.throws(
    () => validateDialectGoldenFixtureSet(mutateCase("nested", (changed) => {
      changed.expected.observations[0].containing_chunk_id = null;
      changed.expected.observations[0].observation_id = stableDialectObservationId(changed.expected.observations[0]);
    })),
    /containing chunk evidence/
  );
  assert.throws(
    () => validateDialectGoldenFixtureSet(mutateCase("language_specific", (changed) => {
      changed.expected.observations[0].language_specific_shape = null;
      changed.expected.observations[0].observation_id = stableDialectObservationId(changed.expected.observations[0]);
    })),
    /retained language-specific shape/
  );
  assert.throws(
    () => validateDialectGoldenFixtureSet(mutateCase("negative", (changed) => {
      const family = DIALECT_CAPABILITY_MANIFEST.families.find((entry) => entry.family === changed.family);
      changed.expected.observations = [observation({
        family: changed.family,
        mode: changed.syntax_mode,
        backend: family.parser_backends[0],
        sourcePath: changed.source_path
      })];
      changed.expected.diagnostics.observed_count = 1;
    })),
    /must not fabricate observations/
  );
  assert.throws(
    () => validateDialectGoldenFixtureSet(mutateCase("ambiguous", (changed) => { changed.expected.status = "unsupported"; changed.expected.diagnostics.message = "unsupported fixture"; })),
    /wrong explicit status/
  );
  assert.throws(
    () => validateDialectGoldenFixtureSet(mutateCase("unsupported", (changed) => { changed.expected.status = "ok"; changed.expected.diagnostics.message = null; })),
    /wrong explicit status/
  );
  assert.throws(
    () => validateDialectGoldenFixtureSet(mutateCase("oversized", (changed) => { changed.source_bytes = 128; })),
    /exact source-cap boundary plus one byte/
  );
  assert.doesNotThrow(
    () => validateDialectGoldenFixtureSet(mutateCase("oversized", (changed) => { changed.source_bytes = DIALECT_LIMITS.max_source_bytes + 1; }))
  );
  assert.throws(
    () => validateDialectGoldenFixtureSet(mutateCase("positive", (changed) => { changed.source_bytes = DIALECT_LIMITS.max_source_bytes + 1; })),
    /non-oversized golden fixture source exceeds/
  );
  assert.throws(
    () => validateDialectGoldenFixtureSet(mutateCase("truncated", (changed) => {
      changed.expected.diagnostics.observed_count = 0;
      changed.expected.diagnostics.omitted_count = 0;
    })),
    /positive, consistent omission accounting/
  );
  assert.doesNotThrow(
    () => validateDialectGoldenFixtureSet(mutateCase("truncated", (changed) => {
      changed.expected.diagnostics.observed_count = 1;
      changed.expected.diagnostics.omitted_count = 1;
    }))
  );
  assert.throws(
    () => validateDialectGoldenFixtureSet(new Array(DIALECT_LIMITS.max_golden_fixtures + 1).fill(null)),
    /bounded inventory/
  );
});

test("canonicalization rejects deep, cyclic, and oversized attacker-controlled inputs", () => {
  let deep = "leaf";
  for (let index = 0; index <= DIALECT_LIMITS.max_canonical_depth; index += 1) deep = { child: deep };
  assert.throws(() => canonicalize(deep), /depth cap/);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalize(cyclic), /cycle/);
  assert.throws(
    () => canonicalize("x".repeat(DIALECT_LIMITS.max_canonical_string_bytes + 1)),
    /string exceeds the byte cap/
  );
  const repeatedMegabyte = "x".repeat(1_000_000);
  assert.throws(
    () => canonicalize(new Array(9).fill(repeatedMegabyte)),
    /aggregate key\/string byte cap/
  );
  assert.equal(Object.hasOwn(DIALECT_LIMITS, "max_task_chars"), false);
});
