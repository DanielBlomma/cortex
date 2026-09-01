# WO-B Pre-Coding Guidance

## Objective

Implement deterministic, local-only pre-coding guidance on top of the accepted
WO-A repository convention profiles. Add `cortex guidance <path-or-entity>
--task <text> --json` and CLI-first agent instructions. Guidance must be a
bounded additive projection of existing retrieval and convention evidence; it
must never train or call a model, planner, provider, telemetry, or network
service. Do not implement WO-C diff review or WO-D evaluation.

## Durable Starting State

- Accepted base commit: `d326227` (`feat: add repository convention profiles`).
- Version: Cortex `2.5.2`; dependencies and release metadata remain unchanged.
- Target branch: `feature/wo-b-pre-coding-guidance-2.5.2`.
- Target worktree: `/Users/danielnilsson/GIT/cortex-wo-b-2.5.2`.
- WO-A is manager-accepted with all five roles PASS. Its exact evidence is in
  `docs/agent-control/wo-a-repo-local-conventions-2.5.2-results.md`.
- `/Users/danielnilsson/GIT/cortex-wo-a-2.5.2` is the accepted read-only base;
  `/Users/danielnilsson/GIT/cortex-wo-a` and
  `/Users/danielnilsson/GIT/cortex` are out of scope and read-only.
- Use only checkout-local `node bin/cortex.mjs`; the globally installed Cortex
  is stale and prohibited.
- No commit, merge, rebase, version/dependency/release change, publish, tag,
  deployment, WO-C, or WO-D.

## Required Context

Read completely before implementation:

- user-provided repository AGENTS instructions and `scaffold/AGENTS.md`;
- this packet;
- `/Users/danielnilsson/GIT/cortex/docs/agent-control/context-packets/036-repo-local-conventions-and-guidance.md`;
- `docs/agent-control/context-packets/010-repo-local-pattern-review.md`;
- `docs/agent-control/context-packets/011-pattern-evidence-engine.md`;
- `docs/agent-control/context-packets/012-context-review-pattern-integration.md`;
- `docs/agent-control/context-packets/036-two-pass-subsystem-retrieval.md`;
- packets 045–046, accepted WO-A results, and
  `docs/repository-conventions.md`;
- current convention engine/types/query/root shim/build/ownership/tests;
- current search, ranking, graph, context-entity, pattern-evidence, progressive
  lifecycle, containment, and agent-instruction generation code.

Use Cortex search/rules/impact before code conclusions. Preserve active rules:
source-of-truth priority, deprecated exclusion, explicit conflicts, repo-local
citations, and context budget.

## Work Profile

New contract/design. Guidance adds a public CLI schema and task-relevance
projection, touches Core MCP/runtime and root/scaffold integration, and changes
agent instructions. It requires independent Code Quality, Contract,
Security/Privacy, Integration, and Validation review after owner completion.

## Contract Requirements

### Input and public envelope

- Command: `cortex guidance <path-or-entity> --task <text> [--json]`.
- Exactly one target and one nonempty task are required. Reject unknown or
  repeated flags, missing values, positional surplus, unsafe visible text, and
  malformed targets before context access or persistence.
- Reuse WO-A target/entity/path grammar and root-shim missing/broken-runtime
  sanitization. Guidance-specific JSON and text errors are deterministic,
  bounded, versioned, and never expose raw task/input, absolute paths, loader
  details, secrets, source content, or link targets.
- Do not echo or persist raw task text. Return a SHA-256 `task_hash` and only
  allowlisted deterministic matched terms/reasons derived from validated task
  text.

### Versioned limits

Freeze exact version-1 limits in the public schema and documentation:

- task: at most 4,096 Unicode scalar values and 16,384 UTF-8 bytes;
- public response: at most 65,536 UTF-8 bytes including the trailing newline;
- active governing rules: at most 8;
- reusable symbols: at most 12;
- concrete examples: at most 6;
- additive normal-retrieval evidence: at most 8;
- conflicts: at most 10;
- retained citations/evidence per item: at most the accepted WO-A evidence cap.

Every cap must be applied after canonical ordering/ranking and expose exact
pre-cap observed/omitted counts. The builder must never produce output rejected
by its own serializer or validator. Oversize failure occurs before output or
any persistence.

### Guidance schema and evidence

- Freeze schema version `1` and generator version `repo-guidance-v1` with exact
  required/unknown-key rejection, canonical arrays, stable hashes, byte-exact
  JSON serialization, and a concise deterministic text projection.
- Resolve the target through the accepted WO-A target/profile machinery and
  choose the closest applicable language/subsystem profiles. Do not introduce
  repository-wide guidance when closer evidence exists unless explicitly
  labeled fallback evidence is needed.
- Include only:
  1. applicable active source-of-truth rules/ADRs and conflicts;
  2. task-relevant reusable symbols from the selected profile;
  3. a small set of concrete cited examples drawn from accepted profile facts,
     representative callers, representative tests, and exact indexed evidence;
  4. a bounded projection of the existing normal retrieval result for the
     task, preserving its entity IDs, paths, scores/order, and citations.
- Guidance is additive: do not alter search/two-pass retrieval ranking,
  defaults, budgets, response contracts, or persisted index data. Prefer reuse
  of existing search APIs over reimplementing retrieval.
- Every rule, recommendation, symbol, example, relevance reason, and conflict
  must cite a unique eligible indexed entity and safe live repository backing.
  Never invent usage rules or say a symbol “must” be used unless an applicable
  active source-of-truth rule/ADR states that requirement.
- Retain contradictory active claims explicitly. Governing evidence order is:
  active source-of-truth rule/ADR, same file, same directory/module, graph-
  connected subsystem, repository fallback.

### Deterministic task relevance

- Use a documented deterministic lexical projection; no embeddings are
  generated and no model is invoked by guidance.
- Normalize task terms with one explicit locale-independent grammar, remove a
  small versioned stop-word set, deduplicate, sort, and cap before scoring.
- Score only allowlisted indexed/profile fields. Serialize the exact matched
  terms and integer score components that justify selection.
- Define deterministic fallback behavior when no task term matches: retain
  governing applicable evidence, then canonical closest-profile items labeled
  `closest_profile_fallback`; never fabricate relevance.
- Stable tie-breakers end in exact entity/profile ID. Reversing equivalent input
  order must produce byte-identical output.

### Local-only and state boundaries

- Guidance is inspection-only. It may read the current local index and accepted
  convention state but must not rewrite profiles, manifest, index, config, task
  text, caches, logs, or guidance output.
- Production guidance must validate/recompute accepted canonical profiles from
  current `ContextData`; do not trust stale or substituted profile JSON alone.
- Reject stale/deleted/ineligible targets, citations, rules, symbols, callers,
  tests, relations, or retrieval entities. Reuse WO-A stable read/live-backing
  boundaries and sanitizers.
- No provider/model/planner/fetch/telemetry/network path. Add explicit tests that
  fail if guidance invokes those surfaces or mutates local state.

## CLI-First Agent Instructions

- Add `guidance` to root/runtime help, query routing, build inventory,
  ownership, package/runtime parity, and installed scaffold instructions.
- Agent instructions should say: before implementing a code task, run
  `cortex guidance <target> --task <task> --json`; treat it as cited additive
  context, not policy authority; use normal `search/related/impact` as needed;
  never skip explicit active rules or conflicts.
- Do not add MCP-only behavior, automatic prompt injection, shell execution of
  task text, or any invocation during bootstrap/update/watch.

## Required Negative and Boundary Coverage

- exact/near/over task scalar and byte limits; empty/repeated/unknown flags;
  C0/C1, newline/CR, ESC, `Zl`/`Zp`, bidi, invalid target/entity/path;
- all public JSON/text byte boundaries and root missing/broken runtime;
- zero/one/multiple matching profiles, closest-vs-repository fallback,
  multi-language target, deleted/stale/ineligible entities;
- active/inactive/non-source-of-truth rule/ADR authority, conflicts and cycles;
  contradictory claims cannot disappear;
- task-term normalization, stop words, Unicode, reversal/ties, no-match fallback;
- each cap independently and in combination, with exact observed/omitted
  accounting and reversed-input byte identity;
- symbols/examples/retrieval with missing, duplicate, symlink, special-file,
  hard-link, identity, and cross-subsystem backing cases;
- no raw task/secret/path/source/loader/warning leakage; no task/profile/index
  persistence; external sentinels unchanged;
- existing search/two-pass byte contracts unchanged and convention profiles not
  rewritten by guidance.

## Validation and Handoff

- Targeted pure guidance tests first, then combined guidance/conventions/query,
  full MCP, context regressions, full root, frontend build, current audits,
  version/shell/packed containment.
- Exercise clean 2.5.2 managed init/bootstrap/update/watch and runtime parity;
  prove guidance is not invoked by lifecycle commands.
- Repeated live JSON/text guidance must be byte-identical with recorded size and
  SHA-256; profile/manifest/index/config bytes and mtimes remain unchanged.
- Finalize all source/tests/docs/control first. Then run exact expanded pattern
  evidence, restore normal config byte-for-byte, run final normal update,
  reconcile every configured checksum and convention profile, doctor/watch/
  diff/status, and do not edit covered files afterward.
- Create a durable WO-B results record and update manager log/handoff without
  acceptance. Return exact files, hashes, totals, residuals, and any contract
  decision requiring manager input.
- Fresh five-role read-only review follows. Only manager acceptance may unblock
  WO-C.
