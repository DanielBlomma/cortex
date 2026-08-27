# WO-051C Adapter Span, Shape, and Baseline Closure

## Objective

Close the last shared adapter ambiguity before WO-052 and WO-053 start in
parallel: freeze the column unit and one closed cross-language shape vocabulary,
and repair the single stale Tree-sitter baseline assertion discovered by the
pre-assignment audit.

This is a prerequisite contract clarification, not parser implementation.

## Durable Starting State

- Accepted WO-051B branch: `feature/wo051b-runtime-dialect-contract`.
- Accepted WO-051B HEAD: `65c6fd56ca4f3640e04a169c5c93a7ee4a24605d`.
- Runtime implementation commit: `503880b`.
- Package version remains `2.5.2`.
- Capability-manifest SHA-256 remains
  `32ea6b9331a562ba06d87b5f9a01dc1a5487f0619e38040488de813505489f11`.
- Limits SHA-256 remains
  `aabe57c65a97253e4ae617b00c653ef5f14e2259a5006b354807468e47a1a602`.
- Ownership-v1 SHA-256 remains
  `b3b97387f541e718ac3b27f677e00cf815cb9bd600b1305391891685f03423ff`.
- WO-051B final reviews are unanimously GO.

Start in a fresh worktree and agent session using only this packet and its
direct references.

## Why This Prerequisite Exists

The accepted span contract freezes one-based inclusive lines and zero-based
inclusive columns, but not the column unit. Local probes show Acorn, Roslyn,
and the installed `web-tree-sitter` all expose UTF-16 code-unit columns,
including a non-BMP character before the observed node. Leaving the unit
implicit would allow parallel adapters to produce incompatible Unicode spans.

The schema also intentionally permits bounded shape strings, but WO-052 and
WO-053 need one packet-authoritative normalized vocabulary. Branch-local prose
or delimiter formats would silently create incompatible recurrence keys.

The accepted parser baseline has one stale assertion:
`tests/rust-treesitter-parser.test.mjs` expects no error for non-Rust input,
while the current locked Tree-sitter parser correctly returns zero chunks plus
one bounded syntax error. The complete focused matrix is therefore 194/195.

## Exact Owned Scope

Implementation may change only:

- `scaffold/scripts/lib/dialect-observation-contract.mjs`;
- `tests/dialect-runtime-contract.test.mjs`; and
- `tests/rust-treesitter-parser.test.mjs`.

No other tracked file may change. In particular, do not change parser code,
benchmark code, ownership, package metadata, dependencies, registry, worker,
pipeline, persistence, public CLI/MCP/types, version, or release files.

## Column Contract

Extend `DIALECT_OBSERVATION_COLUMN_CONTRACT` with exactly:

```json
{
  "column_numbering": "zero_based",
  "column_unit": "utf16_code_units",
  "end_column": "inclusive"
}
```

The accepted capability-manifest and limits hashes must remain unchanged.

Adapters will convert half-open native spans by locating source offset
`endOffset - 1`; they must not blindly decrement an end-position column across
multiline or CRLF spans. Zero-width nodes are not positive observations.

## Closed Adapter Shape Vocabulary

Export and deep-freeze one category-keyed vocabulary with these exact sorted
values:

```json
{
  "control_flow": [
    "branch", "delegation", "early_return", "fallback", "loop", "ordered_calls"
  ],
  "data_representation": [
    "container", "field", "parameter", "record", "return", "state", "variant"
  ],
  "declaration_structure": [
    "constructor", "field", "function", "method", "module", "namespace",
    "parameter", "property", "type"
  ],
  "error_flow": [
    "cleanup", "handler", "propagate", "raise", "result"
  ],
  "test_shape": [
    "assertion", "fixture", "parameterization", "setup", "suite", "teardown",
    "test_declaration"
  ]
}
```

Also export and deep-freeze these exact language-specific forms:

```json
[
  "annotation", "attribute", "block", "clause", "declaration",
  "expression", "modifier", "pattern", "statement"
]
```

Add two public helpers used by both adapter branches:

- a normalized-shape helper accepting exactly `(category, kind)` and returning
  `canonicalJson({ kind })` after closed vocabulary validation; and
- a language-specific-shape helper accepting exactly `(form, syntaxKind)` and
  returning `canonicalJson({ form, syntax_kind: syntaxKind })` after closed
  form and bounded identifier validation.

Names may follow the runtime module's existing naming style, but both helpers
and both frozen inventories must be the sole adapter shape authority. Export a
SHA-256 over one canonical object containing both inventories and hard-code its
accepted value in the focused test after implementation.

No helper may accept extra keys, source identifiers, callee names, node text,
bodies, excerpts, arbitrary detail objects, raw syntax, or prose. Real ordered
series use the observation `ordinal`; otherwise `ordinal` remains `null`.

Do not tighten the general WO-051 `normalized_shape` validator: existing frozen
benchmark artifacts remain valid. The new helpers are the mandatory path for
WO-052/053 adapter output.

## Rust Baseline Repair

Change only the stale expectation for the non-Rust-content fixture. Preserve
the current parser behavior exactly:

- `chunks` is empty; and
- `errors` contains exactly one `{ message: "Syntax error", line: 1, column: 1 }`.

Do not change parser code or any other Rust assertion.

## Required Tests

- Column contract is exact and deeply frozen.
- Both shape inventories are exact, sorted, unique, deeply frozen, and their
  accepted hash is hard-coded.
- Every allowed category/kind and language form returns byte-stable canonical
  JSON independent of caller mutation.
- Unknown category, kind, form, empty/oversized/hidden-control syntax kind,
  extra arguments where detectable, objects, arrays, symbols, and accessors
  fail closed.
- Runtime/benchmark authority parity remains green through the existing tests.
- Accepted manifest, limits, and ownership-v1 hashes remain exact.
- Rust focused parser matrix becomes fully green with unchanged parser output.
- Package inventory remains 432 entries with runtime included and benchmark
  excluded; no ownership count changes.

Run at minimum:

```text
node --test tests/dialect-contract.test.mjs tests/dialect-evaluation.test.mjs tests/dialect-runtime-contract.test.mjs
node --test tests/rust-treesitter-parser.test.mjs
node --test tests/packed-filesystem-containment.test.mjs
node --check scaffold/scripts/lib/dialect-observation-contract.mjs
npm pack --dry-run
git diff --check
cortex update
cortex pattern-evidence <each changed file> --json
cortex doctor
cortex watch status
```

Dependency preflight: the fresh worktree must use lock-matching installed parser
dependencies. Do not interpret missing `web-tree-sitter` as a code regression,
and do not mutate the accepted worktree through bootstrap or auto-migration.

## Acceptance Gates

WO-051C passes only if:

1. exactly three owned files change;
2. accepted manifest/limits/v1 hashes remain exact;
3. the separate adapter-shape hash is frozen and exact;
4. column unit is unambiguous and Unicode/CRLF conversion requirements are
   recorded without implementing adapters;
5. the Rust baseline is green through a test-only correction;
6. package/ownership/parser/public behavior is unchanged; and
7. independent Code/Contract, Security/Containment, and Validation reviewers
   return GO with no blocker or major findings.

After acceptance, create Packet 057 for WO-052 and Packet 058 for WO-053 from
the accepted WO-051C head. Both packets must require the new helpers.

## Stop Conditions

Stop and split rather than changing:

- any parser implementation or parser selection;
- the capability manifest, limits, observation schema, or their accepted hashes;
- ownership/package/dependency/version state;
- registry, worker, pipeline, persistence, benchmark evaluation, or public API;
- the general shape validator or frozen WO-051 artifacts.

## Direct References

- `docs/agent-control/context-packets/054-all-language-parser-backed-codebase-dialect.md`
- `docs/agent-control/context-packets/055-runtime-dialect-contract-promotion.md`
- `scaffold/scripts/lib/dialect-observation-contract.mjs`
- `tests/dialect-runtime-contract.test.mjs`
- `tests/dialect-contract.test.mjs`
- `tests/dialect-evaluation.test.mjs`
- `tests/rust-treesitter-parser.test.mjs`
- `tests/packed-filesystem-containment.test.mjs`
