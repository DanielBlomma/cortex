# WO-B Terminal NO-GO Remediation

## Objective

Close the single final-review NO-GO by remediating exactly three majors, then
return a frozen owner handoff. This packet does not authorize acceptance,
commit, push, release, publish, WO-C, or WO-D, and no further multi-role review
will be started.

## Durable Starting State

- Worktree: `/Users/danielnilsson/GIT/cortex-wo-b-2.5.2`.
- Accepted base: `d326227`; package/version `2.5.2`; dependencies unchanged.
- Packets 047–049, accepted WO-A packets/results, the current full diff, WO-B
  results, manager log, and handoff ledger are required inputs.
- Checkout-local Cortex rules/search/impact were run before implementation.
- The current candidate has 26 paths: 23 prior covered outputs and packets
  047–049. This packet adds one governing input; final totals must be
  reconciled after all edits.

## Exact Final-Review Majors

### 1. Standalone public serializer recomputation

`serializeGuidancePublicResponse` must not trust internally coherent relevance
or task-projection values supplied by its caller. From the raw allowlisted
`input.task` and the allowlisted public item fields, deterministically recompute
task normalization, normalized-term observed/retained/omitted accounting,
matched terms, exact/prefix matches, matched-field counts, every score
component, total score, and relevance reason. Reject coherently rehashed upward
counts, fabricated terms, exact/prefix substitution, and altered matched-field
claims. State explicitly which validation belongs to standalone/public
serialization and which additional guarantees require current `ContextData`.

### 2. Restore accepted WO-A conventions bytes

Restore `scaffold/mcp/src/conventions.ts` and its public builder/schema bytes to
accepted base `d326227`. Convention representative caller/test evidence stays
citation-only and convention profile hashes/public bytes must not change.
Guidance alone must derive accepted `CALLS`/`IMPORTS` provenance plus the
associated reusable-symbol identity directly from canonical
`ContextData.relations` and live typed backing. Add an accepted-base
conventions byte comparison after the final normal update.

### 3. Truly final immutable reproduction

After the final normal update, compare current/base search, related, impact,
and conventions public bytes and record their final hashes. Assert the exact
configured document path set and reconciled count, every document checksum and
live byte, complete manifest limits/index/order/uniqueness, canonical profile
hash/context/backing validation, 12 profiles, and the exact 18-state replay.
Replace stale hashes/totals, freeze only after the last covered edit, and make
the literal procedure fail closed without hidden prerequisites.

## Validation and Freeze

Run focused serializer/relevance/provenance/conventions-byte tests first, then
proportional full MCP/root/frontend/audit/version/packed gates. Finalize all
source, test, documentation, result, and control edits before the expanded
pattern run. Restore the normal config byte-for-byte, refresh the current
managed runtime, perform the final normal update, then execute the complete
checksum/manifest/profile/context/backing/18-state and base-current public-byte
comparisons. No covered file may change afterward. Record the final exact
scope, counts, hashes, and residuals in the WO-B results and control records.
