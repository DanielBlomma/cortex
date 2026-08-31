# WO-061 Maintained Analysis State — Canonical Current-State Projection

## Objective

Implement the smallest read-only bridge from an already trusted maintained-
analysis state to a short, deterministic Current State section suitable for a
later manager/handoff view. The bridge must read through the accepted trusted
reader, preserve the distinction between “not derivable” and false, attach
bounded provenance identifiers, and return canonical Markdown plus its exact
binding. It must not write a control document or create initial authority.

The user's “go on” after WO-060 acceptance authorizes this projection-contract
gate only. It does not authorize bootstrap authority, manager/handoff file
mutation, dogfood, workflow auto-emission, a public writer, or any WO-055 phase.

## Starting State

- Accepted WO-060 feature: `bf02c7e`.
- Accepted control integration: `7b97b9d`.
- Authorization/control base: `4d3f273`.
- Branch: `feature/wo061-maintained-analysis-current-state`.
- Worktree:
  `/Users/danielnilsson/GIT/cortex-wo061-maintained-analysis-current-state`.
- Start in a fresh session using only this packet and the direct references
  below. Do not reuse the WO-060 implementation or compacted manager session.

## Product Decision And Ordering

Stage 2 orders a generated Current State view before dogfood. WO-061 freezes
the projection semantics without yet giving production code permission to
rewrite narrative control files.

1. The state and `analysis-authority.json` must already exist and pass
   `readTrustedAnalysisState` before projection begins.
2. Current truth comes only from the replayed state and its independent
   authority bundle. Narrative packets/logs are not inputs.
3. The projection is an internal, explicitly enabled read operation. It does
   not add or alter CLI grammar, MCP tools, defaults, or workflow behavior.
4. A later work order must separately decide trusted initial provisioning,
   actual manager/handoff replacement, and non-blind dogfood.

## Required Internal Contract

Expose one narrow operation, with exact naming chosen by the implementation
but this semantic input:

```text
renderTrustedAnalysisCurrentState({
  enabled: true,
  cwd,
  taskId
})
```

- `enabled` must be the literal `true`; omission or any other value fails
  before filesystem access beyond argument validation.
- The operation itself calls `readTrustedAnalysisState`. It accepts no
  snapshot, observation list, authority manifest, source registry, primary
  subject, template, heading, output path, prose, or trust policy from the
  caller.
- It returns a closed schema-version-1 object with generator
  `maintained-analysis-current-state-v1`, repository, task ID, primary subject,
  store generation, snapshot SHA-256, authority-bundle SHA-256, exact Markdown
  bytes, and SHA-256 of those exact bytes.
- The Markdown is UTF-8, LF-only, ends with exactly one LF, is deterministic
  across processes, and is no larger than the accepted
  `LIMITS.rendered_bytes` bound.
- Errors use the accepted closed analysis-query error classes/messages. No
  absolute path, raw runtime error, source content, or caller text is returned.

## Canonical Projection Semantics

Render exactly one level-two `Current State` section for the trusted primary
subject. The implementation may choose punctuation after freezing one
byte-exact fixture, but the information and order are fixed:

1. repository, task ID, primary subject, generation, snapshot SHA-256, and
   authority-bundle SHA-256;
2. decision predicates in this code-owned order:
   `accepted`, `review_ready`, `work_order_inputs_viable`,
   `evidence_trusted`, and `required_reviews_go`;
3. active `blocked` facts for the primary subject, sorted by fact ID; and
4. all snapshot contradictions, sorted by contradiction ID.

For each decision predicate, output exactly one of:

- `derivable` with sorted active fact IDs;
- `not derivable` when no active fact exists; or
- `contradicted` when the trusted snapshot contains that exact
  subject/predicate contradiction.

Never render absence as `false`, accepted, ready, complete, or GO. A
contradiction wins over a simultaneously present fact for display status.

Every displayed active fact includes only bounded proof references obtained
through its accepted `why` result: sorted fact IDs, observation IDs, and source
SHA-256 values. Displayed contradictions include their ID, subject, predicate,
and the already canonical value payload SHA-256; do not interpolate raw object
values. Dynamic strings must either already satisfy an accepted token/hash/ID
grammar or be encoded so they cannot create Markdown headings, links, HTML, or
code-fence structure.

The returned structured projection and Markdown must describe the same ordered
items. Do not copy evaluator logic, infer status from prose, add natural-
language summaries, choose a “most important” blocker, or silently truncate.
If the complete canonical projection cannot fit the existing bound, fail
closed.

## Single Read Authority And Neutrality

- Reuse `readTrustedAnalysisState`, `queryAnalysisState`, and
  `explainAnalysisFact`; do not parse store or authority files again.
- Read the trusted state once and project that exact returned generation.
- Missing, malformed, tampered, transaction-incomplete, linked, redirected, or
  identity-drifted state fails exactly as the trusted reader already requires.
- Projection performs no repair and changes no byte, directory entry, mode,
  link, inode, size, ctime, or mtime beneath the project root.
- Repeated and concurrent projections of one unchanged state return byte-exact
  results and cannot contend with or recover a writer transaction.

## Owned Production Surface

- Prefer one new module under
  `scaffold/mcp/src/core/analysis-state/` for the projection.
- Small additive type/export changes in existing analysis-state modules are
  allowed only to reuse the accepted trusted read/query/proof path.
- Add one focused test file under `scaffold/mcp/tests/`.
- Add ownership `current.json` plus one immutable version only if the packed
  managed inventory gains files.
- Change package/containment expectations only by the measured inventory
  delta.
- Add one short WO-061 result report under `docs/agent-control/`.

The CLI root shim/runtime, MCP registrations, writer transaction, store,
evaluator/rules, workflow adapter, enterprise Harness, Stage 0 oracle/fixture,
manager log, handoff ledger, and WO-055 artifacts are read-only.

## Direct References

1. `docs/agent-control/maintained-analysis-state-writer-report.md` — accepted
   WO-060 boundary and remaining bootstrap risk.
2. `scaffold/mcp/src/core/analysis-state/query-reader.ts` — sole trusted state
   and authority reader plus `TrustedAnalysisState`.
3. `scaffold/mcp/src/core/analysis-state/queries.ts` — accepted query/proof
   wrappers.
4. `scaffold/mcp/src/core/analysis-state/schemas.ts` and `engine.ts` — snapshot,
   fact, contradiction, query, proof, and size contracts.
5. `scaffold/mcp/tests/analysis-state-cli.test.mjs` — trusted fixture,
   containment, fail-closed, and read-neutrality precedent.
6. `scaffold/mcp/tests/analysis-state-writer.test.mjs` — accepted generation and
   authority transition plus incomplete-transaction precedent.
7. `docs/superpowers/plans/2026-08-30-maintained-analysis-state.md`, Stage 2 —
   ordering only. Do not edit its code-owned bytes merely to update status.

## Required Validation

- Freeze one byte-exact projection fixture and its Markdown SHA-256. Repeated
  in-process and fresh-process reads are identical.
- Cover a fully derivable decision chain, a not-derivable chain, multiple
  blockers, a relevant decision contradiction, a contradiction on a related
  subject, multiple proof paths, and maximum allowed identifiers/items.
- Prove `not derivable` is never rendered as false/NO-GO and a contradiction is
  never rendered as a positive decision.
- Prove Markdown/meta-character payloads cannot create structure or expose raw
  values, source paths, absolute paths, or runtime messages.
- Disabled, missing, malformed, tampered, partial-transaction, symlink,
  hard-link, special-file, wrong-mode, ancestor-redirection, and identity-race
  cases fail closed with complete byte/identity neutrality.
- Default CLI help/grammar and community MCP inventory remain byte/structure
  identical. No Current State command/tool is listed under any existing flag.
- Stage 0 oracle/native parity, Stage 1 store/workflow, WO-058 CLI, WO-059 MCP,
  WO-060 writer, enterprise workflow, instrumentation, and disabled behavior
  do not regress.
- TypeScript, focused projection/read tests, full MCP, full root, package,
  ownership, packed filesystem containment, `git diff --check`, Cortex update,
  pattern evidence, and one combined Core/Contract/Security/Validation review
  pass. Full package gates run at acceptance.

## Explicit Non-Goals

- No authority bootstrap/provisioner and no caller-supplied authority, source
  registry, primary subject, snapshot, observation, or template.
- No manager-log, handoff-ledger, packet, AGENTS.md, or other document write or
  replacement from production code.
- No CLI/MCP writer or Current State operation, default enablement, config/
  client mutation, workflow auto-emission, or enterprise Harness change.
- No dogfood state mutation and no WO-055 task, private evidence, gold,
  treatment, score, blind phase, acceptance inference, or resumption.
- No network, model, provider, planner, telemetry product surface, database,
  dependency, release, publish, or deployment change.
- No rule/predicate/authority expansion, arbitrary rule language, `what_if`,
  Lemmalog integration, or Rust engine.

## Stop Conditions

Stop NO-GO if projection requires trusting a snapshot independently, parsing a
second semantic path, accepting caller prose/policy, reading narrative logs as
truth, treating absence as false, omitting a present blocker/contradiction,
silently truncating, mutating any file, exposing a public operation, creating
bootstrap authority, weakening the accepted reader/writer boundary, adding a
dependency/network/model call, or advancing dogfood/WO-055.

## Return

Return the exact feature commit, internal API, byte-exact example and hash,
displayed decision/blocker/contradiction/provenance counts, read-neutrality and
fresh-process evidence, focused and full gate totals, package/ownership delta,
combined review result, and explicit confirmation that bootstrap, production
document mutation, public writing/rendering, dogfood, and WO-055 remain
stopped.
