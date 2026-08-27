# WO-053 Roslyn and Lightweight Dialect Adapters

## Objective

Emit bounded, canonical dialect observations from the existing one-pass Roslyn,
VB6, and SQL parser paths for C#, VB.NET, VB6, and SQL. Preserve every existing
parser selection, subprocess boundary, chunk, error, and public behavior.

This work order supplies syntax observations. It does not infer recurring
codebase dialect, persist observations, or change retrieval.

## Starting State

- Start in a fresh session and feature worktree from the accepted WO-052 branch
  head containing implementation `7d3adec`, WO-051C implementation `6f7af6b`, the Packet 059
  capability-truth amendment, the Packet 060 legacy parser-error transport
  bridge, and the accepted Acorn/Tree-sitter adapters.
- Use only this packet and its direct references.
- Run Cortex search/rules/impact before implementation. Do not migrate the
  accepted scaffold merely to make a separate-worktree index understand new
  files.
- Run C# and VB.NET acceptance with the repository's existing .NET toolchain;
  the locally verified baseline is .NET SDK 8.0.422.
- No ownership, package, dependency, or version change is authorized.

## Exact Owned Scope

Production changes are limited to these six existing managed files:

1. `scaffold/scripts/parsers/csharp.mjs`
2. `scaffold/scripts/parsers/vbnet.mjs`
3. `scaffold/scripts/parsers/dotnet/CSharpParser/Program.cs`
4. `scaffold/scripts/parsers/dotnet/VbNetParser/Program.cs`
5. `scaffold/scripts/parsers/vb6.mjs`
6. `scaffold/scripts/parsers/sql.mjs`

Tests may add exactly these two root files:

7. `tests/roslyn-dialect-adapter.test.mjs`
8. `tests/lightweight-dialect-adapter.test.mjs`

Do not edit root `scripts/**` mirrors. Do not add a production file under
`scaffold/scripts/**`: ownership v2 enumerates those paths and a new path would
require a separate ownership/package work order.

## Required API And One-Pass Boundary

Each affected JavaScript parser module keeps its existing
`parseCode(code, repositoryPath, language)` behavior and exact return shape
`{ chunks, errors }`.

Add an internal named export:

```text
parseCodeWithDialectObservations(code, repositoryPath, language)
  -> createDialectObservationTransport(parserResult, observationEnvelope)
```

The composite path invokes the native parser exactly once. C# and VB.NET extend
their existing Roslyn subprocess response with bounded observation data for the
composite caller, while normal `parseCode` still returns only the exact existing
parser result. VB6 and SQL extend their current lightweight parse traversal;
they must not invoke Roslyn, Tree-sitter, Acorn, or a second text parse.

Do not add observations to chunks, errors, the worker protocol, registry,
ingest pipeline, persistence, CLI, MCP, or a public export.

Use only the accepted helpers and values from
`scaffold/scripts/lib/dialect-observation-contract.mjs`, including the two
canonical shape helpers, canonical ordering, stable IDs, and composite
transport validation. No adapter-local vocabulary, delimiter, validator,
canonicalizer, or hash authority is allowed.

## Observation Contract

C# and VB.NET emit syntax directly proven by Roslyn across all five applicable
categories. VB6 and SQL emit directly proven syntax for:

- `declaration_structure`;
- `control_flow`;
- `error_flow`; and
- `data_representation`.

Their manifest-declared `test_shape` capability remains `unsupported`; they
must not emit a test observation or fabricate framework inference.

Use only the accepted closed normalized kinds. `normalized_shape` comes from
`canonicalDialectNormalizedShape`. `language_specific_shape` is `null` or
comes from `canonicalDialectLanguageSpecificShape` with an accepted form and a
native Roslyn/lightweight syntax kind. Never retain Roslyn nodes, syntax trees,
subprocess objects, source objects, regular-expression match objects, or
callbacks.

For ordered native series, use a zero-based `ordinal`; otherwise use `null`.
Set `containing_chunk_id` only when exact containment is proven against the
returned chunks and the adapter can reproduce:

```text
chunk:<repository_path>:<chunk_name>:<start_line>-<end_line>
```

Otherwise use `null`.

## Roslyn Transport Boundary

The .NET programs may serialize only bounded plain observation candidates plus
the existing parser payload. They must not serialize raw syntax text, trees,
nodes, tokens, trivia, semantic models, compiler objects, absolute paths, or
unbounded diagnostics.

JavaScript owns final canonical shape construction, span validation, stable IDs,
ordering, cap enforcement, and `createDialectObservationTransport`. The normal
parser path strips/ignores composite-only fields before returning its exact
legacy shape. Subprocess non-zero exits, invalid JSON, unexpected keys, timeout,
and unavailable `dotnet` preserve existing parser behavior and produce an
`unavailable` observation envelope rather than positive facts.

## Source Spans

- Repository paths are canonical repository-relative paths.
- Lines are one-based and inclusive.
- Columns are zero-based UTF-16 code units and inclusive.
- Convert a positive-width half-open native span by locating source offset
  `endOffset - 1`.
- Do not blindly decrement end columns across multiline or CRLF spans.
- Do not emit zero-width nodes.
- Add non-BMP Unicode, CRLF, multiline, and zero-width regressions for Roslyn,
  VB6, and SQL boundaries.

## Status And Cap Precedence

Use this exact precedence:

1. invalid arguments or non-canonical repository paths throw;
2. source over `max_source_bytes` returns `oversized`, zero observations;
3. required backend unavailable returns `unavailable`, zero observations;
4. native syntax errors return `malformed`, zero observations;
5. file or containing-chunk caps return `truncated`, zero positives, and exact
   `observed_count`/`omitted_count`; and
6. valid supported input returns `ok` with canonical observations.

An unsupported category is not a file-level failure. VB6/SQL valid inputs may
return `ok` for their four applicable categories while emitting no
`test_shape`; the frozen capability manifest remains the explicit explanation.
Existing parser errors stay in `parser_result.errors`.

## Required Validation

At minimum run:

```text
node --test tests/dialect-contract.test.mjs tests/dialect-evaluation.test.mjs tests/dialect-runtime-contract.test.mjs
node --test tests/csharp-parser.test.mjs tests/vbnet-parser.test.mjs tests/roslyn-dialect-adapter.test.mjs
node --test tests/vb6-parser.test.mjs tests/sql-parser.test.mjs tests/lightweight-dialect-adapter.test.mjs
node --test tests/packed-filesystem-containment.test.mjs
npm pack --dry-run
dotnet --info
git diff --check
cortex update
cortex pattern-evidence <each changed file> --json
cortex doctor
cortex watch status
```

Tests must additionally prove:

- existing `parseCode` byte/deep equality before and after adapter use;
- one native parse/subprocess per composite call;
- all four families and every registered mode in this scope;
- all five C#/VB.NET categories and exactly four applicable VB6/SQL categories;
- deterministic ordering and IDs across repeated runs;
- exact Unicode/CRLF/inclusive spans;
- exact cap accounting with no partial positives;
- malformed, oversized, subprocess-invalid, and unavailable behavior;
- no raw syntax retention, including hidden aliases, accessors, and Proxies;
- accepted manifest, limits, ownership-v1, and adapter-shape hashes unchanged;
  and
- the 432-entry package inventory and 396/96 ownership counts unchanged.

Missing .NET is preflight during iteration, but final acceptance cannot count a
skip as C#/VB.NET coverage and cannot authorize dependency or bootstrap changes.

## Review And Acceptance

Independent Parser/Contract, Security/Containment, and Validation/Pack reviewers
must return GO with no blocker or major findings. Any finding is fixed and
re-reviewed within this work order before manager acceptance.

## Stop Conditions

Stop and split rather than changing parser selection, fallback behavior,
dependencies, ownership/package state, the frozen runtime contract, registry,
workers, ingest, persistence, comparison/evaluation, public CLI/MCP behavior, or
any file outside the exact scope.

## Direct References

- `docs/agent-control/context-packets/054-all-language-parser-backed-codebase-dialect.md`
- `docs/agent-control/context-packets/055-runtime-dialect-contract-promotion.md`
- `docs/agent-control/context-packets/056-adapter-span-shape-baseline-closure.md`
- `scaffold/scripts/lib/dialect-observation-contract.mjs`
- every production and existing parser test file named above
- `tests/dialect-contract.test.mjs`
- `tests/dialect-runtime-contract.test.mjs`
- `tests/packed-filesystem-containment.test.mjs`
