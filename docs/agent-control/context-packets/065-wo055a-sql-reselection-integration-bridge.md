# WO-055A-SQL Reselection Integration Bridge

## Objective

Close the independent Packet 064 NO-GO without selecting another task: make
the frozen WO-055A generator consume the SQL-002 issue-based v3 plan, replace
overlap-based owner selection with exact semantic chunk binding, and regenerate
the reselection artifacts with current contamination, canonical fetch order,
exclusive-creation evidence, and replayable bounded GitHub execution evidence.

This bridge integrates the already selected SQL-002 binding only. It must not
change any task bytes, issue, repository, base, source scope, selected owner,
or the other 13 tasks, and it must not begin the public v2 fixture freeze.

## Starting State

- Work in `/Users/danielnilsson/GIT/cortex-wo055a-dialect-fixture-lock` on
  `feature/wo055a-dialect-fixture-lock` after the Packet 065 control commit is
  fast-forwarded to HEAD.
- Use a fresh packet-only session. Read `AGENTS.md`, Packets 062 through 065,
  the three Packet 064 review returns recorded in manager control docs, and
  their direct authorities. Run Cortex search/rules/impact before conclusions.
- The five-file WO-055A candidate remains uncommitted. This bridge may change
  only its generator and focused test; public fixture, attestation, and report
  retain their old bytes until Packet 063 resumes after SQL selection acceptance.
- Existing Packet 064 artifacts under `sql-reselection-v1` are rejected audit
  evidence. Do not overwrite or delete them.
- Never print or expose private task text. No gold, treatment, recurrence,
  candidate output, score, reveal, solution patch, model/provider, planner,
  telemetry, or solution-agent path is authorized.

## Exact Tracked Scope

Only:

1. `benchmark/bootstrapbench/wo055a-freeze-dialect-fixtures.mjs`
2. `tests/bootstrapbench-wo055a-dialect-fixtures.test.mjs`

These already belong to Packet 062's five-file candidate. Any production,
dependency, package, ownership, lockfile, public API, or additional tracked
change is a stop condition. Do not commit before three independent re-reviews
return GO and the manager requests it.

## Frozen SQL-002 Binding

Preserve exactly:

- task `wo055a-sql-002`, 1,146 bytes, SHA-256
  `40732b420c0015f3fbb443011faa6b29437f0c1497e439ae291821ff7f1ad336`;
- issue identity SHA-256
  `f23b1a73d09054ad8e4dd9031c268d4c8284e484bcc735f8d3c6af723694fa32`;
- repository `BrentOzarULTD/SQL-Server-First-Responder-Kit`, base
  `5c00293a2de843a571b35fbad5808f84d1f1ac74`, root tree
  `4363f0e401e612bda286bd89042f5614d3143d60`;
- sources `sp_Blitz.sql` and `sp_BlitzWho.sql` at the Packet 064 hashes;
- owners `dbo.sp_blitz` at lines 31-267 and `dbo.sp_blitzwho` at lines 33-204;
- accepted normalized index counts 2 documents, 62 chunks, 64 relations, and
  21 graph inputs, index SHA-256 `26b8c094…397a`, payload
  `aaa7ece1…0fa9` unless a correctly closed full-index schema adds deterministic
  binding fields. Any derived hash change must be explained and reproduced.

## Review Findings To Close

1. **V3 generator blocker.** The generator currently hard-locks plan v2, v1
   bundle/registry/fetch paths, root-level repositories, and solution-commit
   selection secrets. Add a closed issue-based v3 path that validates the
   Packet 064 nested containment and consumes bundle v2, current registry, and
   canonical fetch/execution evidence. It may retain v2 validation for audit
   compatibility but Packet 063 must run from the accepted v3 artifacts.
2. **Owner major.** Remove inclusive-overlap/next-unused-chunk matching. Bind
   each selector to exact accepted parser `kind`, normalized declaration name,
   exact start/end lines, source hash, chunk/body hash, and stable accepted
   chunk identity. Recompute the owner formula in both generator and frozen
   validator. A single owner split into internal or adjacent spans must fail;
   it cannot fall through to `#alertinfo`, quoted text, or another chunk.
3. **Canonical fetch major.** Sort every closed array with the accepted bytewise
   comparator. The uppercase `BrentOzar…` key must occupy its canonical
   position. Reject reordered records.
4. **Current authority major.** Recompute `docs/agent-control/**` and every
   contamination authority against the exact Packet 065 HEAD. Record the
   frozen authority commit explicitly so later manager-only acceptance docs do
   not ambiguously redefine the selection-time authority.
5. **Exclusive creation major.** Generate a new immutable
   `sql-reselection-v2` root with a retained, hash-bound creator/validator
   source and execution receipt. Use exclusive descriptor writes, fsync,
   verified parent directory identity, no replacement, link/type/mode checks,
   and adversarial concurrent-destination/symlink/hard-link tests.
6. **Execution evidence major.** Replace aggregate self-declarations with a
   closed per-request/per-command receipt for the exact GitHub issue and Git
   repository/base-object accesses, including canonical argv/URL, response or
   object hashes, exit status, tool/source hash, allowlist decision, and
   capability-denial probes. The generator validates this receipt and has no
   network/model/provider/planner/telemetry/solution execution path itself.

## Outside-Git V2 Reselection Root

Create, never overwrite:

`/Users/danielnilsson/.cache/cortex/wo055a-dialect-v1/sql-reselection-v2/`

Root mode `0700`. Private records and retained creator/validator source are
regular single-link `0600`. At minimum bind:

- selection record v2;
- exact private bundle v2 content copied through stable descriptor reads;
- freeze plan v3 accepted by the repaired generator;
- canonically sorted fetch/execution record v3 with per-command receipt;
- contamination registry v3 at exact Packet 065 authority commit;
- retained creator/validator source plus source hash and execution receipt;
- clean detached repository and two independent accepted-index replay roots.

The 13 non-SQL plan/private/fetch entries must remain byte-exact. SQL-001 stays
retired in every exclusion dimension. V1/v2 prior audit artifacts remain
unchanged.

## Required Tests

- Syntax and focused WO-055A tests, including plan-v3 acceptance and v2/v3
  wrong-schema/path rejection.
- Exact semantic owner positive tests plus split-owner, adjacent-span,
  overlap, wrong-kind/name/hash, duplicate-owner, and reordered-selector
  negatives.
- Closed fetch ordering and forged/missing/reordered request receipt negatives.
- Exact-head contamination recomputation plus placeholder/stale-authority
  negatives.
- Exclusive creation, existing destination, concurrent destination,
  symlink/hard-link/special-file, parent-rebind, mode, and hash drift negatives.
- Safe detached generator validation against the v2 reselection root; it must
  pass through the v3 plan path and must not write public fixture bytes in this
  bridge.
- Accepted SQL/dialect/ingest/filesystem tests from a dependency-equipped
  unchanged authority worktree; exact environment N/A where applicable.
- `git diff --check`, clean exact tracked scope, package neutrality, Cortex
  search/rules/impact/pattern evidence, and legacy-scaffold N/A truth.

## Acceptance

Freeze the repaired generator/test diff and new outside-Git v2 reselection
root for three fresh read-only re-reviews: Selection/Contract,
Security/Containment, and Validation/Blindness. All must return GO with no
blocker or major. Then the manager may accept SQL-002 and start a new fresh
Packet 063 resume session; no public fixture freeze begins in this bridge.
