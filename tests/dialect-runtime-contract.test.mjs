import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import * as benchmarkContract from "../benchmark/bootstrapbench/dialect-contract.mjs";
import * as runtimeContract from "../scaffold/scripts/lib/dialect-observation-contract.mjs";

const RUNTIME_SOURCE_URL = new URL(
  "../scaffold/scripts/lib/dialect-observation-contract.mjs",
  import.meta.url
);
const BENCHMARK_SOURCE_URL = new URL(
  "../benchmark/bootstrapbench/dialect-contract.mjs",
  import.meta.url
);

function observation(overrides = {}) {
  const value = {
    schema_version: 1,
    observation_id: "",
    family: "javascript",
    syntax_mode: ".js",
    parser_backend: "acorn",
    repository_path: "src/sample.js",
    containing_chunk_id: "chunk:src/sample.js:sample:1-1",
    start_line: 1,
    start_column: 0,
    end_line: 1,
    end_column: 1,
    category: "declaration_structure",
    normalized_shape: "declaration:sample",
    language_specific_shape: null,
    ordinal: null,
    ...overrides
  };
  value.observation_id = runtimeContract.stableDialectObservationId(value);
  return value;
}

function envelope(observations = []) {
  return {
    schema_version: 1,
    status: "ok",
    observations,
    diagnostics: {
      message: null,
      observed_count: observations.length,
      omitted_count: 0
    }
  };
}

function transportCandidate({ chunks = [{ id: "chunk:1" }], observations = [observation()] } = {}) {
  return {
    schema_version: 1,
    parser_result: { chunks, errors: [] },
    observation_envelope: envelope(observations)
  };
}

function targetAtLevel(candidate, level) {
  if (level === "outer") return candidate;
  if (level === "chunk") return candidate.parser_result.chunks[0];
  return candidate.observation_envelope.observations[0];
}

function replaceAtLevel(candidate, level, replacement) {
  if (level === "outer") return replacement;
  if (level === "chunk") candidate.parser_result.chunks[0] = replacement;
  else candidate.observation_envelope.observations[0] = replacement;
  return candidate;
}

test("the packaged runtime is the sole shared authority exported by the benchmark", () => {
  for (const [name, value] of Object.entries(runtimeContract)) {
    assert.equal(
      benchmarkContract[name],
      value,
      `benchmark export ${name} must be the runtime authority`
    );
  }
  assert.equal(
    runtimeContract.DIALECT_CAPABILITY_MANIFEST_SHA256,
    "32ea6b9331a562ba06d87b5f9a01dc1a5487f0619e38040488de813505489f11"
  );
  assert.equal(
    runtimeContract.DIALECT_LIMITS_SHA256,
    "aabe57c65a97253e4ae617b00c653ef5f14e2259a5006b354807468e47a1a602"
  );
  assert.deepEqual(runtimeContract.DIALECT_OBSERVATION_COLUMN_CONTRACT, {
    column_numbering: "zero_based",
    end_column: "inclusive"
  });
  assert.equal(Object.isFrozen(runtimeContract.DIALECT_OBSERVATION_COLUMN_CONTRACT), true);

  const runtimeSource = fs.readFileSync(RUNTIME_SOURCE_URL, "utf8");
  const imports = [...runtimeSource.matchAll(/^import\s+.+?from\s+["']([^"']+)["'];?$/gm)]
    .map((match) => match[1]);
  assert.deepEqual(imports, ["node:crypto"]);
  assert.doesNotMatch(
    runtimeSource,
    /benchmark|node:(?:fs|path|child_process|worker_threads|http|https|net)|(?:parser|ingest|worker|pipeline|persistence|provider|planner|telemetry|policy)\.mjs/
  );

  const benchmarkSource = fs.readFileSync(BENCHMARK_SOURCE_URL, "utf8");
  assert.match(
    benchmarkSource,
    /export \* from "\.\.\/\.\.\/scaffold\/scripts\/lib\/dialect-observation-contract\.mjs"/
  );
  assert.equal((benchmarkSource.match(/DIALECT_CAPABILITY_MANIFEST\s*=/g) ?? []).length, 0);
  assert.equal((benchmarkSource.match(/function validateDialectObservation\b/g) ?? []).length, 0);
});

test("canonical observation ordering follows every frozen precedence without mutating input", () => {
  const ordered = [
    observation({ repository_path: "a.js", normalized_shape: "same" }),
    observation({ repository_path: "b.js", start_line: 1, start_column: 0, end_line: 1, end_column: 1, normalized_shape: "same" }),
    observation({ repository_path: "b.js", start_line: 2, start_column: 0, end_line: 2, end_column: 1, normalized_shape: "same" }),
    observation({ repository_path: "b.js", start_line: 2, start_column: 1, end_line: 2, end_column: 2, normalized_shape: "same" }),
    observation({ repository_path: "b.js", start_line: 2, start_column: 1, end_line: 3, end_column: 0, normalized_shape: "same" }),
    observation({ repository_path: "b.js", start_line: 2, start_column: 1, end_line: 3, end_column: 1, normalized_shape: "same" }),
    observation({ repository_path: "b.js", start_line: 2, start_column: 1, end_line: 3, end_column: 1, category: "control_flow", normalized_shape: "same" }),
    observation({ repository_path: "b.js", start_line: 2, start_column: 1, end_line: 3, end_column: 1, category: "control_flow", normalized_shape: "z-shape" }),
    observation({ repository_path: "b.js", start_line: 2, start_column: 1, end_line: 3, end_column: 1, category: "control_flow", normalized_shape: "z-shape", language_specific_shape: "language" }),
    observation({ repository_path: "b.js", start_line: 2, start_column: 1, end_line: 3, end_column: 1, category: "control_flow", normalized_shape: "z-shape", language_specific_shape: "language", ordinal: 0 }),
    observation({ repository_path: "b.js", start_line: 2, start_column: 1, end_line: 3, end_column: 1, category: "control_flow", normalized_shape: "z-shape", language_specific_shape: "language", ordinal: 1 })
  ];
  const shuffled = [ordered[8], ordered[4], ordered[10], ordered[1], ordered[6], ordered[0], ordered[9], ordered[3], ordered[7], ordered[2], ordered[5]];
  const snapshot = [...shuffled];

  const canonical = runtimeContract.canonicalizeDialectObservations(shuffled);
  assert.deepEqual(canonical, ordered);
  assert.deepEqual(shuffled, snapshot);
  assert.notEqual(canonical, shuffled);
  assert.equal(
    runtimeContract.canonicalJson(canonical),
    runtimeContract.canonicalJson(runtimeContract.canonicalizeDialectObservations([...shuffled].reverse()))
  );

  const alreadyCanonical = runtimeContract.canonicalizeDialectObservations(ordered);
  assert.deepEqual(alreadyCanonical, ordered);
  assert.notEqual(alreadyCanonical, ordered);

  const tieLeft = observation({ containing_chunk_id: "chunk:left" });
  const tieRight = observation({ containing_chunk_id: "chunk:right" });
  assert.equal(
    Math.sign(runtimeContract.compareDialectObservations(tieLeft, tieRight)),
    tieLeft.observation_id < tieRight.observation_id ? -1 : 1,
    "observation ID must provide the final total-order tie-breaker",
  );
});

test("canonicalization and positive envelopes reject duplicates, invalid values, and unsorted order", () => {
  const first = observation({ repository_path: "a.js" });
  const second = observation({ repository_path: "b.js" });
  assert.throws(
    () => runtimeContract.canonicalizeDialectObservations([first, first]),
    /duplicate observation id/
  );
  assert.throws(
    () => runtimeContract.canonicalizeDialectObservations([{ ...first, start_column: -1 }]),
    /start column must be a non-negative integer/
  );
  assert.throws(
    () => runtimeContract.validateDialectObservationEnvelope(envelope([second, first])),
    /must be canonically ordered/
  );
  assert.equal(
    runtimeContract.validateDialectObservationEnvelope(envelope([first, second])).observations[0],
    first
  );

  const overFileCap = Array.from(
    { length: runtimeContract.DIALECT_LIMITS.max_observations_per_file + 1 },
    (_, index) => observation({
      containing_chunk_id: `chunk:${index}`,
      start_line: index + 1,
      end_line: index + 1
    })
  );
  assert.throws(
    () => runtimeContract.canonicalizeDialectObservations(overFileCap),
    /observation file cap exceeded/
  );

  const overChunkCap = Array.from(
    { length: runtimeContract.DIALECT_LIMITS.max_observations_per_chunk + 1 },
    (_, index) => observation({ start_line: index + 1, end_line: index + 1 })
  );
  assert.throws(
    () => runtimeContract.canonicalizeDialectObservations(overChunkCap),
    /observation chunk cap exceeded/
  );
});

test("the in-memory composite transport is exact and preserves transport separation", () => {
  const parserResult = {
    chunks: [{ id: "chunk:1", imports: [{ source: "node:crypto" }] }],
    errors: []
  };
  const observations = [observation()];
  const observationEnvelope = envelope(observations);
  const transport = runtimeContract.createDialectObservationTransport(
    parserResult,
    observationEnvelope
  );

  assert.deepEqual(transport, {
    schema_version: 1,
    parser_result: parserResult,
    observation_envelope: observationEnvelope
  });
  assert.notEqual(transport.parser_result, parserResult);
  assert.notEqual(transport.parser_result.chunks, parserResult.chunks);
  assert.notEqual(transport.parser_result.chunks[0], parserResult.chunks[0]);
  assert.notEqual(transport.observation_envelope, observationEnvelope);
  assert.notEqual(transport.observation_envelope.observations, observations);
  assert.equal(Object.hasOwn(parserResult, "observations"), false);
  assert.equal(Object.hasOwn(observationEnvelope.diagnostics, "chunks"), false);
  const validated = runtimeContract.validateDialectObservationTransport(transport);
  assert.deepEqual(validated, transport);
  assert.notEqual(validated, transport);
  assert.notEqual(validated.parser_result, transport.parser_result);

  const proxyTarget = {
    id: "chunk:proxy",
    rootNode: { type: "program", sourceText: "hidden raw source" }
  };
  const proxyChunk = new Proxy(proxyTarget, {
    ownKeys() {
      return ["id"];
    },
    getOwnPropertyDescriptor(target, key) {
      return key === "id" ? Reflect.getOwnPropertyDescriptor(target, key) : undefined;
    }
  });
  const fromProxy = runtimeContract.createDialectObservationTransport(
    { chunks: [proxyChunk], errors: [] },
    envelope([])
  );
  assert.equal(proxyChunk.rootNode.type, "program");
  assert.deepEqual(fromProxy.parser_result.chunks, [{ id: "chunk:proxy" }]);
  assert.equal(Object.hasOwn(fromProxy.parser_result.chunks[0], "rootNode"), false);
  assert.notEqual(fromProxy.parser_result.chunks[0], proxyChunk);
});

test("the composite transport rejects mixed keys, raw syntax objects, and non-canonical envelopes", () => {
  const valid = runtimeContract.createDialectObservationTransport(
    { chunks: [], errors: [] },
    envelope([])
  );
  const cases = [
    [{ ...valid, extra: true }, /unexpected keys/],
    [{ ...valid, parser_result: { chunks: [], errors: [], observations: [] } }, /unexpected keys/],
    [{ ...valid, parser_result: { chunks: [{ observations: [] }], errors: [] } }, /cannot retain observation field/],
    [{ ...valid, parser_result: { chunks: [observation()], errors: [] } }, /cannot retain observation field: observation_id/],
    [{ ...valid, observation_envelope: { ...envelope([]), chunks: [] } }, /unexpected keys/],
    [{ ...valid, parser_result: { chunks: [{ ast: {} }], errors: [] } }, /raw syntax field: ast/],
    [{ ...valid, parser_result: { chunks: [{ tree: {} }], errors: [] } }, /raw syntax field: tree/],
    [{ ...valid, parser_result: { chunks: [{ source: { bytes: "raw" } }], errors: [] } }, /raw syntax field: source/]
  ];
  for (const [candidate, expected] of cases) {
    assert.throws(
      () => runtimeContract.validateDialectObservationTransport(candidate),
      expected
    );
  }

  for (const rawField of [
    "syntaxTree",
    "syntax_tree",
    "parseTree",
    "sourceText",
    "source_text",
    "rawAST",
    "raw_tree",
    "rawSource",
    "rawCode",
    "sourceCode",
    "code",
    "rootNode",
    "root_node",
    "namedRootNode",
    "syntaxNode",
    "syntax_node",
    "parseNode",
    "astNode",
    "concreteSyntaxTree",
    "cst",
    "treeSitterNode",
    "tree_sitter_root_node",
    "treeCursor"
  ]) {
    assert.throws(
      () => runtimeContract.validateDialectObservationTransport(
        transportCandidate({ chunks: [{ [rawField]: "raw syntax bytes" }] })
      ),
      new RegExp(`raw syntax field: ${rawField}`),
      rawField
    );
  }

  for (const level of ["outer", "chunk", "observation"]) {
    let candidate = transportCandidate();
    let target = targetAtLevel(candidate, level);
    const inherited = Object.assign(Object.create({ inherited_state: true }), target);
    candidate = replaceAtLevel(candidate, level, inherited);
    assert.throws(
      () => runtimeContract.validateDialectObservationTransport(candidate),
      /plain record prototype/,
      `${level} inherited state`
    );

    candidate = transportCandidate();
    target = targetAtLevel(candidate, level);
    Object.defineProperty(target, "hidden_state", {
      value: true,
      enumerable: false
    });
    assert.throws(
      () => runtimeContract.validateDialectObservationTransport(candidate),
      /non-enumerable/,
      `${level} non-enumerable state`
    );

    candidate = transportCandidate();
    target = targetAtLevel(candidate, level);
    target[Symbol("hidden_state")] = true;
    assert.throws(
      () => runtimeContract.validateDialectObservationTransport(candidate),
      /symbol keys/,
      `${level} symbol state`
    );

    candidate = transportCandidate();
    target = targetAtLevel(candidate, level);
    let getterCalls = 0;
    Object.defineProperty(target, "syntaxTree", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return {};
      }
    });
    assert.throws(
      () => runtimeContract.validateDialectObservationTransport(candidate),
      /accessors/,
      `${level} getter state`
    );
    assert.equal(getterCalls, 0, `${level} getter must never execute`);
  }

  for (const invalidValue of [undefined, () => {}, 1n, Symbol("value")]) {
    assert.throws(
      () => runtimeContract.validateDialectObservationTransport(
        transportCandidate({ chunks: [{ invalid: invalidValue }] })
      ),
      /non-JSON/,
      typeof invalidValue
    );
  }
  assert.throws(
    () => runtimeContract.validateDialectObservationTransport(
      transportCandidate({ chunks: [new Date(0)] })
    ),
    /plain record prototype/
  );

  assert.throws(
    () => runtimeContract.validateDialectObservationTransport(
      transportCandidate({
        chunks: [{
          first: "x".repeat(2_000_000),
          second: "x".repeat(2_000_001)
        }]
      })
    ),
    /aggregate key\/string byte cap/
  );
  assert.throws(
    () => runtimeContract.validateDialectObservationTransport(
      transportCandidate({
        chunks: new Array(runtimeContract.DIALECT_LIMITS.max_canonical_nodes).fill(null)
      })
    ),
    /node cap/
  );
  assert.throws(
    () => runtimeContract.validateDialectObservationTransport(
      transportCandidate({
        chunks: [{ payload: "x".repeat(runtimeContract.DIALECT_LIMITS.max_canonical_input_bytes + 1) }]
      })
    ),
    /string exceeds the byte cap|aggregate key\/string byte cap/
  );

  let deepChunk = { leaf: true };
  for (let index = 0; index <= runtimeContract.DIALECT_LIMITS.max_canonical_depth; index += 1) {
    deepChunk = { child: deepChunk };
  }
  assert.throws(
    () => runtimeContract.validateDialectObservationTransport(
      transportCandidate({ chunks: [deepChunk] })
    ),
    /depth cap/
  );

  const first = observation({ repository_path: "a.js" });
  const second = observation({ repository_path: "b.js" });
  assert.throws(
    () => runtimeContract.createDialectObservationTransport(
      { chunks: [], errors: [] },
      envelope([second, first])
    ),
    /must be canonically ordered/
  );
});

test("non-ok envelopes keep zero positive observations and exact omission accounting", () => {
  for (const status of ["unsupported", "malformed", "oversized", "unavailable", "truncated"]) {
    const candidate = {
      schema_version: 1,
      status,
      observations: [],
      diagnostics: {
        message: `${status} observation result`,
        observed_count: status === "truncated" ? 3 : 0,
        omitted_count: status === "truncated" ? 3 : 0
      }
    };
    assert.equal(runtimeContract.validateDialectObservationEnvelope(candidate), candidate);
  }

  const positive = observation();
  assert.throws(
    () => runtimeContract.validateDialectObservationEnvelope({
      schema_version: 1,
      status: "truncated",
      observations: [positive],
      diagnostics: { message: "truncated", observed_count: 2, omitted_count: 1 }
    }),
    /non-ok observation envelopes cannot contain positive observations/
  );
  assert.throws(
    () => runtimeContract.validateDialectObservationEnvelope({
      schema_version: 1,
      status: "truncated",
      observations: [],
      diagnostics: { message: "truncated", observed_count: 2, omitted_count: 1 }
    }),
    /omission accounting is inconsistent/
  );
});
