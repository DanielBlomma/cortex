# WO-052 Acorn and Tree-sitter Dialect Adapters

## Resume State

WO-051D and WO-051E are accepted. The preserved candidate was advanced without
byte drift onto the shared transport bridge, then received the required deep
Acorn error regression. Legacy parser error bytes remain exact and no
adapter-local canonicalizer was introduced.

## Objective

Emit bounded, canonical dialect observations from the existing one-pass Acorn
and Tree-sitter parser paths for JavaScript, TypeScript, C, C++, Rust, Python,
Go, Java, Ruby, and Bash. Preserve every existing parser selection, fallback,
chunk, error, and public behavior.

This work order supplies syntax observations. It does not infer recurring
codebase dialect, persist observations, or change retrieval.

## Starting State

- Start from the accepted WO-051E head containing implementation `73117b5` and
  its durable acceptance records.
- Use only this packet and its direct references.
- Run Cortex search/rules/impact before implementation. Do not migrate the
  accepted scaffold merely to make a separate-worktree index understand new
  files.
- The accepted package contains 432 entries and ownership v2 contains 396
  unique managed targets, including 96 runtime targets. No ownership, package,
  dependency, or version change is authorized.

## Exact Owned Scope

Production changes are limited to these twelve existing managed files:

1. `scaffold/scripts/parsers/javascript.mjs`
2. `scaffold/scripts/parsers/javascript/ast.mjs`
3. `scaffold/scripts/parsers/tree-sitter/base.mjs`
4. `scaffold/scripts/parsers/cpp-dispatch.mjs`
5. `scaffold/scripts/parsers/cpp-treesitter.mjs`
6. `scaffold/scripts/parsers/rust-dispatch.mjs`
7. `scaffold/scripts/parsers/rust-treesitter.mjs`
8. `scaffold/scripts/parsers/python-treesitter.mjs`
9. `scaffold/scripts/parsers/go-treesitter.mjs`
10. `scaffold/scripts/parsers/java-treesitter.mjs`
11. `scaffold/scripts/parsers/ruby-treesitter.mjs`
12. `scaffold/scripts/parsers/bash-treesitter.mjs`

Tests may add exactly these four root files:

13. `tests/javascript-dialect-adapter.test.mjs`
14. `tests/cpp-rust-dialect-adapter.test.mjs`
15. `tests/tree-sitter-dialect-adapter.test.mjs`
16. `tests/dialect-adapter-fallbacks.test.mjs`

The packed-upgrade characterization test may change in exactly one place:

17. `tests/packed-filesystem-containment.test.mjs` — update only
    `EXPECTED_CHANGED_MANAGED_COUNT` from 57 to 69. The twelve authorized
    managed parser edits are the entire delta. Keep
    `EXPECTED_NEW_MANAGED_COUNT` at 16 and do not change package inventory,
    ownership, containment, upgrade behavior, or any other assertion.

Do not edit root `scripts/**` mirrors. Do not add a production file under
`scaffold/scripts/**`: ownership v2 enumerates those paths and a new path would
require a separate ownership/package work order.

## Required API And One-Pass Boundary

Each affected top-level parser module keeps its existing
`parseCode(code, repositoryPath, language)` behavior and exact return shape
`{ chunks, errors }`.

Add an internal named export:

```text
parseCodeWithDialectObservations(code, repositoryPath, language)
  -> createDialectObservationTransport(parserResult, observationEnvelope)
```

The composite path must invoke the language's native parser exactly once. The
existing `parseCode` and the new composite export must share that one internal
parse result; neither may parse source a second time or route through another
parser technology. Do not add observations to chunks, errors, the worker
protocol, registry, ingest pipeline, persistence, CLI, MCP, or a public export.

Use only the accepted helpers and values from
`scaffold/scripts/lib/dialect-observation-contract.mjs`, including:

- `canonicalDialectNormalizedShape(category, kind)`;
- `canonicalDialectLanguageSpecificShape(form, syntaxKind)`;
- `canonicalizeDialectObservations`;
- `stableDialectObservationId`; and
- `createDialectObservationTransport`.

No adapter-local delimiter format, vocabulary, validator, canonicalizer, or
hash authority is allowed.

## Observation Contract

Emit only syntax directly proven by the native parse. Cover all five applicable
categories with the accepted closed kinds:

- `declaration_structure`: constructor, field, function, method, module,
  namespace, parameter, property, type;
- `control_flow`: branch, delegation, early_return, fallback, loop,
  ordered_calls;
- `error_flow`: cleanup, handler, propagate, raise, result;
- `data_representation`: container, field, parameter, record, return, state,
  variant; and
- `test_shape`: assertion, fixture, parameterization, setup, suite, teardown,
  test_declaration.

Not every source must emit every kind. After WO-051D, tests must prove at least
one positive facet for each manifest-applicable category per family across
bounded fixtures, without
classifying identifiers or source text heuristically when a native syntax node
does not prove the fact.

`normalized_shape` must come from the canonical normalized helper.
`language_specific_shape` is either `null` or comes from the canonical
language-specific helper using one of annotation, attribute, block, clause,
declaration, expression, modifier, pattern, or statement and the native syntax
kind. It must never retain a node, tree, cursor, source object, callback, or
parser instance.

For ordered native series, use a zero-based `ordinal`; otherwise use `null`.
Set `containing_chunk_id` only when the adapter proves containment against the
returned chunks and can reproduce the exact existing identity:

```text
chunk:<repository_path>:<chunk_name>:<start_line>-<end_line>
```

Otherwise set it to `null`; do not guess from proximity or names.

## Source Spans

- Repository paths are canonical repository-relative paths.
- Lines are one-based and inclusive.
- Columns are zero-based UTF-16 code units and inclusive.
- Convert a positive-width half-open native span by locating source offset
  `endOffset - 1`.
- Do not blindly decrement a native end-position column across multiline or
  CRLF spans.
- Do not emit zero-width nodes.
- Add non-BMP Unicode, CRLF, multiline, and zero-width regression fixtures for
  both Acorn and shared Tree-sitter handling.

## Status And Cap Precedence

The observation envelope uses this exact precedence:

1. invalid arguments or non-canonical repository paths throw;
2. source over `max_source_bytes` returns `oversized` with zero observations;
3. selected native backend unavailable returns `unavailable` with zero
   observations;
4. native syntax errors return `malformed` with zero observations;
5. file or containing-chunk caps return `truncated` with zero positive
   observations and exact `observed_count`/`omitted_count`; and
6. supported valid input returns `ok` with canonically ordered observations.

For the forced C/C++ clang bridge and Rust regex fallbacks, preserve the current
parser result and return `unavailable` observations. Do not fabricate fallback
facts or silently relabel the backend. Existing parser errors stay in
`parser_result.errors`; the observation diagnostic remains bounded and
deterministic.

## Internal Implementation Sequence

Keep review increments small:

1. shared Tree-sitter span/walker support plus Acorn JavaScript/TypeScript;
2. C/C++ and Rust dispatch/fallback behavior; then
3. Python, Go, Java, Ruby, and Bash adapters.

This sequence does not authorize intermediate commits outside the exact scope.

## Required Validation

At minimum run:

```text
node --test tests/dialect-contract.test.mjs tests/dialect-evaluation.test.mjs tests/dialect-runtime-contract.test.mjs
node --test tests/javascript-parser.test.mjs tests/javascript-dialect-adapter.test.mjs
node --test tests/cpp-parser.test.mjs tests/cpp-treesitter-parser.test.mjs tests/rust-parser.test.mjs tests/rust-treesitter-parser.test.mjs tests/cpp-rust-dialect-adapter.test.mjs tests/dialect-adapter-fallbacks.test.mjs
node --test tests/python-treesitter-parser.test.mjs tests/go-treesitter-parser.test.mjs tests/java-treesitter-parser.test.mjs tests/ruby-treesitter-parser.test.mjs tests/bash-treesitter-parser.test.mjs tests/tree-sitter-dialect-adapter.test.mjs
node --test tests/packed-filesystem-containment.test.mjs
npm pack --dry-run
git diff --check
cortex update
cortex pattern-evidence <each changed file> --json
cortex doctor
cortex watch status
```

Use lock-matching installed parser dependencies without bootstrap or scaffold
migration. A missing optional dependency is preflight, not authorization to
change dependencies or skip final family coverage.

Tests must additionally prove:

- existing `parseCode` byte/deep equality before and after adapter use;
- JSON-safe parser results remain deep-equal inside the composite transport;
  the sole Packet 060 legacy exception keeps the original `parseCode` object
  byte/deep unchanged while the strict transport omits only direct undefined
  error `line`/`column` fields and remains canonical-JSON equivalent;
- one native parse per composite call;
- all 10 families and every registered mode in this scope;
- deterministic ordering and IDs across repeated runs;
- exact Unicode/CRLF/inclusive spans;
- exact cap accounting with no partial positives;
- malformed, oversized, unavailable, and fallback behavior;
- no raw syntax retention, including hidden aliases, accessors, and Proxies;
- accepted manifest, limits, ownership-v1, and adapter-shape hashes unchanged;
  and
- package inventory and ownership counts unchanged; and
- packed previous-release characterization reports exactly 69 changed managed
  files, of which exactly 16 remain new managed files.

## Review And Acceptance

Independent Parser/Contract, Security/Containment, and Validation/Pack reviewers
must return GO with no blocker or major findings. Any finding is fixed and
re-reviewed within this work order before manager acceptance.

## Acceptance State

Accepted locally on 2026-08-27. The exact 17-file implementation is commit
`7d3adec`: twelve existing managed parser files, four focused adapter tests,
and only the authorized packed-upgrade count change from 57 to 69.

The adapters cover JavaScript, TypeScript, C, C++, Rust, Python, Go, Java,
Ruby, and Bash across every registered mode in scope. Existing `parseCode`
results and parser selection remain exact; composite calls parse natively once
and return detached canonical observations. The Packet 060 deep Acorn case
retains legacy own `line`/`column: undefined`, returns `malformed` with zero
observations, omits only those transport fields, and remains JSON-equivalent.

Final Security review found and closed one Bash false positive: a command name
`builtin trap` cannot prove cleanup because `builtin` can be shadowed. The
accepted adapter instead derives `error_flow/handler` only from Tree-sitter's
direct native `||` token, and prevents Bash `list` from inheriting the
cross-language container fact. Direct, builtin, and shadowed-builtin trap
forms remain negative.

Final validation passed contract/evaluation/runtime 30/30, JavaScript 24/24,
C/C++/Rust 65/65, Tree-sitter families 73/73, focused adapters 34/34, and
packed containment 1/1. The package remains 432 entries at 411/21 modes with
inventory digest
`f7647e513e6ab40e6327e6bd14aa4db26fc248930780a3967de56ddf423ff661`,
ownership 396/96, and published-predecessor upgrade 69 changed/16 new with all
69 state hashes verified. Frozen contract, capability, limits, shape,
ownership, lock, dependency, version, registry, worker, and public surfaces
remain unchanged.

Parser/Contract, Security/Containment, and Validation/Pack final re-reviews
returned GO with zero blocker, major, or minor findings. Dependency overlays
and tarballs were absent at final inspection. The older feature scaffold could
not provide candidate changed-file evidence without forbidden migration;
canonical Cortex supplied search/rules/impact, baseline pattern evidence for
11 production files, doctor 8/8 at 100% freshness, and stopped watcher state.

## Stop Conditions

Stop and split rather than changing parser selection, fallbacks, dependencies,
ownership/package state, the frozen runtime contract, registry, workers, ingest,
persistence, comparison/evaluation, public CLI/MCP behavior, or any file outside
the exact scope.

## Direct References

- `docs/agent-control/context-packets/054-all-language-parser-backed-codebase-dialect.md`
- `docs/agent-control/context-packets/055-runtime-dialect-contract-promotion.md`
- `docs/agent-control/context-packets/056-adapter-span-shape-baseline-closure.md`
- `docs/agent-control/context-packets/059-dynamic-language-test-shape-capability-truth.md`
- `docs/agent-control/context-packets/060-legacy-parser-error-transport-bridge.md`
- `scaffold/scripts/lib/dialect-observation-contract.mjs`
- every production and existing parser test file named above
- `tests/dialect-contract.test.mjs`
- `tests/dialect-runtime-contract.test.mjs`
- `tests/packed-filesystem-containment.test.mjs`
