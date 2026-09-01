# WO-058 Maintained Analysis State — CLI Report

## Result

**GO for WO-058 acceptance. MCP exposure, dogfood writing, and WO-055 remain stopped.**

WO-058 adds exactly four opt-in, local read commands over the accepted Stage 1
store:

- `cortex workflow state <task-id> [--json]`
- `cortex workflow why <task-id> <fact-id> [--json]`
- `cortex workflow why-not <task-id> <predicate> [--json]`
- `cortex workflow changes <task-id> --since <epoch> [--json]`

The root shim and project runtime independently enforce the same closed grammar.
Success and failure envelopes use `schema_version: 1` and
`generator_version: "maintained-analysis-cli-v1"`; text mode is a bounded
serialization of the same envelope.

## Authority And Read Contract

Reads require `.agents/<task-id>/analysis-authority.json`, mode `0600`, outside
the accepted four-file `analysis/` store. The reader validates exact keys,
canonical identities, byte bounds, UTF-8, regular/single-link identity,
authority manifest, closed source registry, and the canonical bundle hash. It
then calls the unchanged Stage 1 replay reader with that independent authority.

The full project/task/store transaction is identity-bound and rechecked after
replay. Missing state, invalid authority, and tamper or containment drift map to
the closed public codes `STATE_NOT_FOUND`, `AUTHORITY_INVALID`, and
`STATE_UNTRUSTED`. No read path repairs, recovers, falls back, or writes.
`why-not` and current-state fact selection use the bundle's `primary_subject`,
not the lowercase storage task ID.

Packet 072 changed the code-owned plan bytes while leaving the Stage 0 source
hash at its previous value. The exact plan SHA-256 was therefore advanced to
`bcc4d4e1bbde3381be1c0f3cb955445f26e5d3ebfdbbc22dafdccb8c165cad31`
in the oracle and its conformance test; no rule, fixture, or persistence
behavior changed.

## Validation Evidence

- Focused authority/runtime tests: 8/8; root shim plus ownership: 20/20.
- Every operation is deterministic across fresh processes and an actual linked
  worktree; missing, malformed, oversized, traversal, link, mode, identity,
  registry, manifest, chain, snapshot, and concurrent-replacement cases fail
  closed.
- Stage 0 oracle/native parity: 19/19 in each engine.
- Full MCP suite: 615/615, zero skipped.
- Root gate: 81/81 context regressions and 400/400 Node tests.
- TypeScript build and `git diff --check`: pass.
- Package gate: 453 entries (432 mode `0644`, 21 mode `0755`), inventory
  SHA-256 `347bbc878e3f4d46d4daed0ad0d384f580aefff7ec7a91c824b06a82cbf8b912`.
- Ownership v4 contains 414 managed paths and adds exactly five CLI-reader
  files over immutable v3. The package adds seven entries over WO-057.
- Packed containment: 42/42; characterization: 3/3; development and packed
  dashboard: 4/4 each; forced upgrade verifies 99 changed managed files and 34
  additions from v2.4.2.
- Cortex update, rules/search, and local diff review pass with full semantic
  coverage. Pattern evidence is recorded proportionally for indexed paths.

## Combined CLI/Contract/Security/Validation Review

**GO with zero accepted findings.** One combined review verified the dual
parser, envelope and error contracts, independent authority, read neutrality,
transaction binding, package ownership, and explicit non-goals.

The local heuristic review emitted two suggestions in the new root shim: one
for direct error construction and one for direct `CORTEX_PROJECT_ROOT` access.
Both are non-applicable after repo-local adjudication because Packet 072 names
`query-command.mjs` as the fail-closed shim precedent, and that accepted shim
uses the same two patterns before `loadProjectCliModule`. No finding was
suppressed by changing review configuration.

The remaining operational risk is deliberate: no production authority-bundle
writer exists, so a valid private bundle must be provisioned independently
before the CLI can return state. The inherited Stage 1 evaluator's bounded
`@ts-nocheck` maintainability risk is unchanged. No MCP operation, observation
or authority writer, manager/handoff/Current State writer, network/model/
provider/database surface, dependency, release, or WO-055 behavior was added.
