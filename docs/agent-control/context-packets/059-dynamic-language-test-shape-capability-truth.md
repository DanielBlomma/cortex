# WO-051D Dynamic-Language Test-Shape Capability Truth

## Objective

Correct the frozen capability manifest before WO-052 can be accepted: mark
`test_shape` unsupported for the existing syntax-only Ruby and Bash parser
families. Their Tree-sitter trees cannot prove framework identity under valid
dynamic rebinding, constant construction, shell functions, and aliases without
executing code or introducing a second semantic parser.

Explicit unsupported evidence is better than a plausible positive observation
that an ordinary repository can manufacture.

## Starting State

- Start in a fresh session and worktree from
  `feature/wo051c-adapter-contract` at planning head `966bfe0` or its direct
  accepted successor.
- Use only this packet and its direct references.
- WO-052 remains uncommitted and paused in
  `/Users/danielnilsson/GIT/cortex-wo052-acorn-tree-sitter-dialect`.
  Do not copy or edit its adapter candidate in this work order.
- Run Cortex search/rules/impact before implementation. Do not bootstrap or
  migrate an older scaffold merely to obtain feature-worktree evidence.

## Evidence Requiring The Amendment

Three WO-052 review rounds established that positive Ruby/Bash test facts
cannot be made fail-closed with syntax-only name/context rules:

- Ruby can replace `require`, dynamically construct local `Minitest` and
  `Test` constants, and still present the same parsed subclass/method shape.
- Bash can replace `source`, dot, and assertion commands through functions and
  quoted or expanded aliases while presenting the same parsed loader/call
  shape.
- Both adversarial programs parse successfully and execute without loading the
  claimed framework, yet heuristic adapters emitted `test_shape` positives.

Adding more spelling checks would not prove binding identity. Executing source,
adding a second parser, or claiming framework semantics from unresolved text is
outside the program contract.

## Exact Owned Scope

Change exactly these four files:

1. `scaffold/scripts/lib/dialect-observation-contract.mjs`
2. `tests/dialect-contract.test.mjs`
3. `tests/dialect-runtime-contract.test.mjs`
4. `tests/dialect-evaluation.test.mjs` — change only the frozen applicable-facet
   count from 68 to 66. The two newly unsupported capabilities are the entire
   delta; do not change evaluator logic or another assertion.

No parser, adapter, benchmark, evaluator, ownership, package, dependency,
version, registry, worker, pipeline, persistence, CLI, MCP, or public behavior
change is authorized.

## Required Contract Change

- Preserve all 14 families and 29 registered modes.
- Preserve every current capability except `ruby/test_shape` and
  `bash/test_shape`.
- Set those two entries to:

```json
{
  "status": "unsupported",
  "reason": "the existing syntax-only parser cannot prove framework-bound test shape under language-level dynamic rebinding"
}
```

- Keep the existing VB6/SQL unsupported reason unchanged.
- Recompute and freeze the capability-manifest SHA-256 in both authoritative
  tests. Record the exact new hash in the acceptance report.
- Preserve the accepted limits, adapter-shape, ownership-v1, span, transport,
  ordering, and observation-schema hashes/contracts exactly.
- Manifest validation must reject attempts to restore Ruby/Bash `test_shape`
  to applicable or to change the exact unsupported reason.

This amendment does not claim Ruby or Bash lack tests. It states only that the
current parser boundary cannot emit a positive framework-bound test observation
with the required precision. Their declaration, control-flow, error-flow, and
data-representation categories remain applicable.

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

- exactly four families now report unsupported `test_shape`: VB6, SQL, Ruby,
  and Bash;
- the other ten families and every other capability remain byte-for-byte
  equivalent to the accepted predecessor;
- valid-looking manifest mutations fail closed;
- runtime/benchmark authority parity remains green;
- all unrelated accepted hashes remain exact; and
- the blind fixture contains exactly 66 applicable facets after the two
  explicit unsupported entries; and
- package inventory, ownership counts, and upgrade characterization remain
  unchanged.

Use lock-matching dependency overlays without installing, bootstrapping, or
migrating the worktree. Record any changed-file Cortex indexing limitation
instead of weakening scope.

## Acceptance And Resume Rule

Independent Contract, Security/Truthfulness, and Validation/Pack reviewers must
return GO with no blocker or major findings.

Only after WO-051D is accepted may WO-052 rebase onto it. The resumed Packet
057 candidate must:

- emit no Ruby or Bash `test_shape` observations;
- require positive category fixtures only for categories marked applicable by
  the amended manifest;
- reject TypeScript type-only test/assert imports;
- reject conflicting Go import qualifiers without suppressing unrelated valid
  scopes; and
- rerun all focused, adversarial, packed, ownership, and independent review
  gates.

WO-053 must also start from the accepted WO-051D head so both adapter branches
share the same manifest hash.

## Stop Conditions

Stop and split rather than changing any capability other than the two exact
entries, weakening the unsupported reason, editing adapter/parser behavior,
changing another accepted hash, or expanding beyond the four files.

## Direct References

- `docs/agent-control/context-packets/054-all-language-parser-backed-codebase-dialect.md`
- `docs/agent-control/context-packets/055-runtime-dialect-contract-promotion.md`
- `docs/agent-control/context-packets/056-adapter-span-shape-baseline-closure.md`
- `docs/agent-control/context-packets/057-acorn-tree-sitter-dialect-adapters.md`
- `scaffold/scripts/lib/dialect-observation-contract.mjs`
- `tests/dialect-contract.test.mjs`
- `tests/dialect-evaluation.test.mjs`
- `tests/dialect-runtime-contract.test.mjs`
- `tests/packed-filesystem-containment.test.mjs`
