# WO-055A-SQL Bridge Fail-Closed Closure

## Objective

Close the remaining Packet 066 re-review findings without changing SQL-002 or
any other task: repair the v3 full-freeze schema, make semantic owner identity
independent of spans/chunk bodies, bind execution/runtime evidence to trusted
generator constants and exact inventories, and prove retired/current identity
and live filesystem-race rejection adversarially.

## Starting State

- Worktree `/Users/danielnilsson/GIT/cortex-wo055a-dialect-fixture-lock`, branch
  `feature/wo055a-dialect-fixture-lock`, after Packet 067 control commit is
  fast-forwarded to HEAD.
- Fresh packet-only session. Read `AGENTS.md`, Packets 062-067, manager/handoff
  review rows, and direct authorities completely. Run Cortex
  search/rules/impact before conclusions.
- Current generator/test and `sql-reselection-v2` are uncommitted review
  candidates. Existing exact root is honest but rejected because its validator
  is fail-open. Preserve it under a unique rejected-review audit name before
  any new exact root.
- SQL-002, its private bytes, issue, repo/base/tree, sources, owners, and the
  other 13 tasks are immutable. Public fixture/attestation/report remain old
  and must not change in this work order.

## Exact Tracked Scope

Only the existing candidate files:

1. `benchmark/bootstrapbench/wo055a-freeze-dialect-fixtures.mjs`
2. `tests/bootstrapbench-wo055a-dialect-fixtures.test.mjs`

No production, dependency, package, ownership, lockfile, public API, or other
tracked edit. No commit before all three final re-reviews return GO.

## Findings To Close

### 1. V3 full-freeze schema blocker

`contamination()` emits `frozen_authority_commit`, while
`validateFrozenFixture()` currently excludes it from the closed contamination
audit. Add the exact key and cross-bind it to the accepted v3 selection/root
authority. Add a detached temporary full-freeze test using the v3 plan through
the actual public fixture/report/attestation generation path. The temporary
bytes must validate and be deterministic; tracked public artifacts remain
untouched.

### 2. Semantic owner blocker

Owner identity must not include span, chunk ID, chunk body, or other
location-dependent data. Define a closed semantic owner key from accepted
parser facts only: canonical source path, accepted declaration kind,
normalized declaration name, and a normalized declaration-header/signature
identity independent of body/span splitting. Location ID separately binds the
exact accepted chunk/span/body.

Require unique semantic owner keys before location selection. Two adjacent,
overlapping, nested, or duplicated chunks with the same semantic key are one
owner and must fail the two-owner gate even when their chunk/body/location
hashes differ. Keep exact accepted chunk matching and reject fallback to an
adjacent chunk/string/temp object.

### 3. Trusted receipt and runtime authority majors

The generator must carry trusted closed expectations for this frozen SQL-002
reselection rather than accepting canonically rehashed self-declarations:

- exact two request roles, URLs, canonical argv grammar/values, tool logical
  paths and frozen tool hashes, response/object hashes, and zero exits;
- exactly 11 named denial capabilities with exact canonical denial receipt
  shape, not `>=6` arbitrary labels;
- exact creation receipt input/output logical inventory and cross-hashes;
- one frozen retained creator source hash. The creator source must not embed a
  generator hash; it reads and records the final generator at execution time,
  avoiding circular hashes. The generator rejects any other creator hash;
- exact Node executable path/version/hash and complete accepted runtime tree
  inventory for each replay, including the executed `indexing.mjs`,
  `ingest.mjs`, imported modules/parser sources, and dependency files. Recompute
  these inventories during root validation and reject copied/runtime drift;
- no network or forbidden execution path in the generator itself.

Mutations that rehash forged argv, tool path/hash, response binding, denial
label/count, receipt input/output, creator source, Node executable, or runtime
file must fail.

### 4. Identity and race majors

Recompute every selected and retired SQL identity dimension from the frozen
bindings. Require the exact retired SQL-001 ID/hash/issue/alias/base tuple in
every prescribed exclusion array and exact absence of every SQL-002 dimension.
Reject canonically rehashed forged `retired_sql_exclusion` or
`selected_collision_check` values.

Replace overclaimed race tests with real or deterministically injected
validation-to-commit races against the same production helper:

- two concurrent exclusive creators where at most one can win and the loser
  fails closed without mutation;
- parent directory rename/rebind between validation and commit;
- symlink, hard-link, FIFO/special-file, wrong mode, existing destination, and
  post-creation runtime/receipt drift.

A narrow injected precommit callback is allowed only on an exported low-level
test helper and must not be reachable through the CLI/generator path.

## Exact Root Lifecycle

1. Verify current hashes/status and preserve the existing
   `sql-reselection-v2` root intact under a unique
   `rejected-fail-open-rereview-<timestamp>` name.
2. Finish generator/test fixes and syntax/adversarial tests before creating the
   final root.
3. Create a fresh exclusive `sql-reselection-v2` root with a retained creator
   whose source hash exactly matches the generator's frozen expectation and
   whose receipt binds the final generator, exact Packet 067 HEAD, runtime
   inventories, requests, denials, inputs, and outputs.
4. If any generator/test/creator change follows, preserve that root as rejected
   and recreate again. Never accept a stale receipt or overwrite/delete audit
   roots.

## Required Gates

- Focused bridge tests including all new full-freeze, owner, receipt, runtime,
  identity, special-file, concurrent-create, and live-rebind negatives.
- Proportional SQL/dialect/ingest/filesystem plus query/cleanup tests from the
  unchanged dependency-equipped authority worktree.
- Detached v3 full freeze twice with byte-identical temporary public bytes and
  no tracked public mutation.
- Exact root validation, moved-root rejection, runtime mutation rejection,
  receipt generator/creator/authority binding, two accepted replay parity,
  exact 13+1 and retired/selected contamination closure.
- Syntax, canonical JSON, `git diff --check`, exact scope/status, 432-entry pack
  exclusion, Cortex search/rules/impact/pattern evidence or exact legacy N/A.

## Prohibitions and Return

Never print task text. Do not run gold, treatment, recurrence, candidate,
score, reveal, solution, model/provider, planner, or telemetry paths. Do not
change a task or public artifact and do not commit.

Return exact final hashes/modes/inventories, authority commit/counts, owner and
index evidence, request/denial/runtime receipt evidence, adversarial and broad
test totals, package/status/N/A, then stop for three fresh final re-reviews. If
context compacts, stop at the next safe point and split again.
