# WO-055A-SQL Bridge Final Refreeze

## Objective

Complete Packet 065 from its compaction safe point: preserve the stale
reselection root as rejected audit evidence, recreate one exclusive final root
against the current generator and exact Packet 066 HEAD, then rerun the focused
and proportional gates without changing public artifacts or task bindings.

## Starting State

- Worktree `/Users/danielnilsson/GIT/cortex-wo055a-dialect-fixture-lock`,
  branch `feature/wo055a-dialect-fixture-lock`, after this packet's control
  commit is fast-forwarded to HEAD.
- Fresh packet-only session. Read `AGENTS.md`, Packets 062-066, and their direct
  references. Run Cortex search/rules/impact before conclusions.
- Packet 065 implementation is uncommitted. Only generator and focused test
  differ from the prior candidate; public fixture, attestation, and report are
  unchanged.
- Current generator SHA-256:
  `4bc67dfb4c02703a1cd9d6f11ec852b548bef7ad49d517acb3ff6ee1ef813460`.
- Current focused test SHA-256:
  `7071ddb814caa39f440f9b7df92579094fe6eaf9a13f9fc29943834966bcc64c`.
- The present `sql-reselection-v2` root is intentionally stale: its receipt
  binds older generator SHA-256
  `e23c83c62211e921aa6ac3f5349236f9a3c34f1a8ffd801e7e6cee3fdbc340d2`.
  Retained creator SHA-256 is
  `cb121e272002f72707821f5b8fbc901015b547da3ed6742f10fb7ff7b443fbb8`.

## Exact Work

1. Verify tracked status and all stated hashes before acting.
2. Move the stale `sql-reselection-v2` directory intact to a unique explicit
   `sql-reselection-v2.rejected-final-generator-drift-<timestamp>` audit name.
   Do not delete, overwrite, or mutate it.
3. Use the retained creator source through stable descriptor reads. Run it
   exclusively to create a new `sql-reselection-v2` root at mode `0700`, with
   `0600` regular single-link records, current generator hash, exact Packet 066
   authority commit, live five-authority contamination, SQL-002 unchanged,
   exact 13+1 preservation, two accepted-index replays, canonical fetch order,
   per-request receipts, and all denial probes.
4. Run the repaired generator's detached reselection validator. Require the
   receipt generator hash to equal the current file hash and creator hash to
   equal the retained source. Verify every output hash/mode/type/link/root
   identity and reject the moved stale root.
5. Run focused bridge tests, proportional SQL/dialect/ingest/filesystem tests,
   query/cleanup, pack dry-run, syntax, JSON/canonicalization, diff/status, and
   Cortex/pattern-evidence or exact legacy N/A.
6. If any code/test edit is needed, keep scope to the existing generator and
   focused test, rerun creator again from a new exclusive root, and repeat all
   gates. Never leave a receipt stale.

## Scope and Prohibitions

Tracked scope remains only:

- `benchmark/bootstrapbench/wo055a-freeze-dialect-fixtures.mjs`
- `tests/bootstrapbench-wo055a-dialect-fixtures.test.mjs`

Do not change SQL-002, any private bytes, another task, public fixture,
attestation, report, production, dependency, package, ownership, lockfile, or
public API. Never expose task text. No gold, treatment, recurrence, candidate,
score, reveal, solution, model/provider, planner, or telemetry path. No commit.

## Return

Return exact final generator/test/root/creator/receipt/plan/bundle/fetch/
contamination/selection hashes and modes, authority commit/counts, accepted
index counts/hashes, receipt/denial counts, all test totals, package inventory,
tracked scope/status, and exact N/A. Stop review-ready for three fresh Packet
065 re-reviews. If context compacts, stop immediately at the next safe point.
