# WO-051E Legacy Parser-Error Transport Bridge

## Objective

Resolve the exact boundary conflict exposed by final WO-052 adversarial review:
preserve the existing Acorn `parseCode` error object byte/deep behavior while
allowing the strict experimental dialect constructor to return bounded
JSON-safe plain data when an existing parser error owns optional `line` or
`column` fields whose values are `undefined`.

The legacy parser result remains authoritative and unchanged. The strict
transport validator remains fail closed. The constructor receives one narrow,
explicit projection rule for the two already-observed optional error-location
fields; this is not a general JSON coercion policy.

## Starting State

- Start in a fresh session and worktree from accepted WO-051D branch head
  `05abbf4` or its direct planning successor.
- Use only this packet and its direct references.
- WO-052 remains uncommitted and paused in
  `/Users/danielnilsson/GIT/cortex-wo052-acorn-tree-sitter-dialect`.
  Do not copy or edit its adapter candidate in this work order.
- Run Cortex search/rules/impact before implementation. Do not bootstrap or
  migrate the older scaffold merely to manufacture feature-worktree evidence.

## Evidence Requiring The Amendment

Acorn can throw a location-less `RangeError` on valid, bounded, deeply nested
source. The accepted legacy parser catches it and returns:

```text
{
  chunks: [],
  errors: [{ message: "...", line: undefined, column: undefined }]
}
```

Those own `undefined` fields are existing in-memory parser behavior and Packet
057 freezes them. JavaScript serialization omits them, but deep object equality
does not. The accepted dialect transport intentionally rejects every non-JSON
value, so passing that exact object to `createDialectObservationTransport`
throws instead of returning the required `malformed` envelope.

Changing `undefined` to `null` repairs the transport only by changing legacy
parser behavior. Allowing arbitrary `undefined` weakens the frozen strict
transport. Both final Parser/Contract and Security/Containment reviewers
therefore returned NO-GO and required an explicit authority resolution.

## Exact Owned Scope

Change exactly these two files:

1. `scaffold/scripts/lib/dialect-observation-contract.mjs`
2. `tests/dialect-runtime-contract.test.mjs`

No parser, adapter, benchmark, capability manifest, evaluator, ownership,
package, dependency, version, registry, worker, pipeline, persistence, CLI,
MCP, or public product behavior change is authorized.

## Required Constructor Rule

Keep `validateDialectObservationTransport` fully strict: direct validation of
any `undefined`, including error locations, must still fail as non-JSON input.

Before strict validation, `createDialectObservationTransport` may project its
`parserResult` argument only as follows:

- require the existing exact top-level `{chunks, errors}` structure;
- inspect arrays and records through own-property descriptors without invoking
  getters or retaining caller identity;
- only within a direct plain-record entry of `parserResult.errors`, omit an
  own enumerable data property named exactly `line` or `column` when its value
  is exactly `undefined`;
- preserve numeric, `null`, and every other value/key unchanged for subsequent
  strict validation; and
- reject `undefined` everywhere else, including chunks, messages, nested error
  fields, arrays, symbols, functions, accessors, sparse arrays, and prototypes.

The returned transport remains detached canonical plain JSON. The caller's
parser result remains byte/deep unchanged, including ownership and values of
the omitted optional fields.

This projection matches the existing JSON representation of the legacy error;
it does not make the in-memory transport deep-equal to a non-JSON legacy
object. Packet 057 must compare strict transport equality for JSON-safe parser
results and exact canonical JSON equivalence for this one legacy exception.

## Frozen Authority

- Preserve all 14 families and 29 modes.
- Preserve the capability-manifest, limits, adapter-shape, and ownership-v1
  hashes exactly.
- Do not add an export or change the exact transport/envelope schemas.
- Do not loosen the generic canonicalizer or direct validator.
- Do not mutate, stringify, execute, or round-trip the caller result.
- Package inventory, ownership counts, and the WO-052 packed previous-release
  characterization must remain unchanged.

## Required Validation

At minimum run:

```text
node --test tests/dialect-contract.test.mjs tests/dialect-evaluation.test.mjs tests/dialect-runtime-contract.test.mjs
node --test tests/packed-filesystem-containment.test.mjs
npm pack --dry-run
node --check scaffold/scripts/lib/dialect-observation-contract.mjs
git diff --check
cortex update
cortex pattern-evidence <each changed file> --json
cortex doctor
cortex watch status
```

Tests must prove:

- constructor projection omits only direct `undefined` error `line`/`column`;
- the input result retains those own keys and exact values;
- numeric and explicit `null` locations remain unchanged;
- undefined messages, chunk fields, nested fields, and array entries fail;
- getters are never invoked and Proxy/hidden/symbol/prototype cases remain
  fail closed or bounded to the already accepted canonical visible view;
- direct transport validation still rejects the same `undefined` locations;
- every unrelated runtime export and frozen hash remains unchanged; and
- pack inventory, ownership, containment, and upgrade counts remain exact.

Use lock-matching dependency overlays without installation, bootstrap, or
scaffold migration, and remove every overlay before final scope inspection.

## Acceptance And WO-052 Resume

Independent Contract, Security/Containment, and Validation/Pack reviewers must
return GO with no blocker or major findings.

Only after WO-051E is accepted may WO-052 advance onto it in a fresh session.
The resumed Packet 057 candidate must:

- keep `parseAst` and legacy `parseCode` location-less errors exactly as the
  predecessor (`line`/`column` own values remain `undefined`);
- add the bounded deep-nesting regression that proves legacy deep equality,
  a `malformed`/zero-observation composite, omission of only the two optional
  transport fields, and canonical JSON equivalence;
- retain the completed TypeScript full-category/type-only, Go qualifier, and
  Ruby/Bash unsupported-capability fixes; and
- rerun the entire final WO-052 panel.

WO-053 must also start from the accepted WO-051E head so all adapters share the
same constructor authority.

## Stop Conditions

Stop and split rather than changing a parser result, permitting general
`undefined`, changing direct validator behavior, adding a transport field,
changing a frozen hash, or expanding beyond the two files.

## Direct References

- `docs/agent-control/context-packets/055-runtime-dialect-contract-promotion.md`
- `docs/agent-control/context-packets/057-acorn-tree-sitter-dialect-adapters.md`
- `docs/agent-control/context-packets/059-dynamic-language-test-shape-capability-truth.md`
- `scaffold/scripts/lib/dialect-observation-contract.mjs`
- `tests/dialect-runtime-contract.test.mjs`
- `tests/dialect-contract.test.mjs`
- `tests/dialect-evaluation.test.mjs`
- `tests/packed-filesystem-containment.test.mjs`
