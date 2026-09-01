# WO-C Deterministic Diff Review

## Objective

Implement deterministic, local-only post-coding review on top of the accepted
WO-A convention profiles and WO-B guidance substrate. Add
`cortex review --diff --json` and a bounded text projection. Map the current
repository diff to the closest applicable profiles, compare changed code with
cited local evidence, and report deterministic violations separately from
heuristic warnings. Do not implement WO-D evaluation.

## Durable Starting State

- Worktree: `/Users/danielnilsson/GIT/cortex-wo-c-2.5.2`.
- Branch: `feature/wo-c-diff-review-2.5.2`.
- Accepted base: `482f196` (`feat: add repository pre-coding guidance`).
- Accepted WO-A base: `d326227`.
- Package/version remains `2.5.2`; dependencies and lockfiles are unchanged.
- WO-A and WO-B are manager-accepted. Their stable evidence is in
  `docs/agent-control/wo-a-repo-local-conventions-2.5.2-results.md` and
  `docs/agent-control/wo-b-pre-coding-guidance-2.5.2-results.md`.
- No commit, push, merge, rebase, release, publish, deploy, WO-D, or version /
  dependency action is authorized.

## Required Intake

Start in a fresh agent session. Read only this packet plus its direct
references before inspecting the exact base-to-candidate diff. Then run the
checkout-local Cortex `rules`, `search`, and `impact` commands. Never use the
global 2.4.1 binary.

## Contract

### Invocation and diff scope

- `cortex review --diff --json` and `cortex review --diff` are the only new v1
  forms. Reject positional targets, duplicate/mixed forms, unknown flags, and
  missing `--diff` before project-runtime import or repository reads.
- Review the current Git candidate against `HEAD`: staged and unstaged tracked
  changes plus non-ignored untracked regular files. A path appears once in the
  canonical lexical path set. Deletions remain reviewable from Git diff bytes.
- Do not add an arbitrary revision/ref option in v1. Do not inspect ignored
  files, `.git`, `.context`, external paths, submodule worktrees, symlink
  targets, special files, or hard-linked external aliases.
- Preserve Git's exact staged-plus-working-tree semantics without shell
  interpolation. Bind the repository root/real identity before reading and
  fail closed if the root, Git metadata, path identity, type, or bytes change
  during collection.
- The command is inspection-only: no profile persistence, index/config/cache/
  manifest/log mutation, Git mutation, hook installation, or watcher action.

### Versioned output

- Freeze a closed schema v1 and generator `repo-diff-review-v1` with recursive
  unknown-key rejection, stable lexical ordering, canonical hashes, exact
  observed/retained/omitted counts, and bounded JSON/text public envelopes.
- Include repository identity, a hash of the canonical diff input (never raw
  external paths), changed-file summaries, findings, conflicts, diagnostics,
  limits, and a review hash. Do not emit raw repository roots, loader errors,
  warnings, secrets, ignored content, or absolute paths.
- Each finding must contain a stable ID, changed path and bounded changed-line
  location, category, `enforcement` (`deterministic` or `heuristic`), bounded
  confidence, message/reason, applicable profile identity/hash, and capped
  concrete evidence records that already passed WO-A/WO-B identity/backing
  checks.
- Deterministic findings require an exact active source-of-truth Rule/ADR or an
  exact schema/contract invariant. Frequency, similarity, reusable-symbol
  proximity, and local pattern mismatch are heuristic only. Never turn a
  heuristic warning into command failure or unrelated policy enforcement.
- Conflicting active evidence is returned explicitly and suppresses any
  deterministic recommendation that would guess through the conflict.

### Required review signals

- Map every eligible changed code file to the closest canonical convention
  profile using the accepted scope order: active source-of-truth authority,
  same file, directory/module, feature/graph subsystem, repository fallback.
- Detect only evidence-backed candidates for:
  - an avoidable new duplicate helper when an accepted reusable abstraction is
    directly applicable;
  - bypassing an accepted shared abstraction;
  - local error, logging, or testing convention mismatch.
- Reuse the existing pattern-evidence engine for cited file/repository-local
  context. Do not change pattern ranking, Enterprise `context.review`, policy
  pass/fail, trust, validation, search/related/impact, two-pass retrieval,
  conventions, or guidance public bytes.
- Bootstrap/update/watch never invoke diff review. Review never calls a model,
  embedding generator, planner, provider, telemetry, network, fetch, or
  Enterprise service.

### Initial v1 limits

- changed paths: 200;
- total canonical diff input: 1,000,000 UTF-8 bytes;
- per-file diff input: 250,000 UTF-8 bytes;
- findings: 100;
- conflicts: 50;
- evidence per finding/conflict: 10;
- public JSON response: 1,000,000 UTF-8 bytes;
- public text response: 250,000 UTF-8 bytes.

Limits are exact versioned contract values. Reject before semantic/context
work whenever a pre-readable boundary is exceeded. Report cap omissions only
for an otherwise valid bounded response; never silently truncate input.

## Required Negative and Compatibility Matrix

- no diff, staged-only, unstaged-only, mixed staged/unstaged, deletion,
  rename, binary, untracked, ignored, duplicate path, and reversed discovery;
- symlink leaf/ancestor, special file, hard link/external sentinel, submodule,
  root/`.git` identity swap, stale file bytes, and concurrent mutation hooks;
- exact/near/over every path, byte, item, evidence, and response cap;
- recursive schema/hash tampering, unknown keys, count/omission incoherence,
  fabricated/stale/cross-type/cross-subsystem evidence, and profile change
  between collection and output;
- active/inactive/deprecated/non-source-of-truth authority, exact conflicts,
  deterministic-versus-heuristic classification, reversal/tie determinism,
  zero applicable profile, repository fallback, and multilingual files;
- explicit runtime sentinels proving no search embedding/model/planner/
  provider/telemetry/network/fetch/Enterprise call and no persistence/state
  change;
- root missing/broken/import-capable runtime JSON/text sanitization;
- byte-for-byte accepted-base comparisons for conventions, guidance, search,
  related, impact, two-pass sources/public outputs, and pattern evidence.

Use real `ContextData` and real temporary Git repositories for production
boundaries. Do not satisfy caps or provenance with fabricated schema-only
objects when the production builder/context validator is the contract under
test. Document physically impossible cases rather than inventing them.

## Integration

- Wire root/runtime help and strict routing, installed `scaffold/AGENTS.md`,
  build entry inventory, ownership metadata, forced upgrade behavior, and
  packed containment.
- Agent instructions position diff review after coding and before finalization;
  it is cited additive review evidence, not policy authority.
- Keep accepted WO-A/WO-B source, schemas, hashes, CLI output, lifecycle, and
  state byte-compatible unless this packet explicitly owns the new review
  surface.

## Validation and Evidence

- Build and focused pure/runtime/root tests first; then full MCP, context, root,
  frontend, five audits, version, syntax, packed containment, managed
  init/bootstrap/update/watch, runtime parity, and live deterministic/state
  neutrality gates.
- After the last covered edit, run exact expanded-index pattern evidence for
  every output path, restore normal config byte-for-byte, run the final normal
  update, validate configured checksums and all manifest/profile/context/live
  backing, run doctor, verify watcher stopped, and run all diff checks.
- Record literal fail-closed reproduction commands, exact counts/hashes, scope,
  residuals, and reviewer disposition in
  `docs/agent-control/wo-c-diff-review-2.5.2-results.md`, manager log, and
  handoff ledger. No placeholder instructions.
- Return owner-complete for exactly one fresh independent comprehensive
  read-only review. Only the manager may accept WO-C or unblock WO-D.

## Direct References

- `scaffold/AGENTS.md`
- `docs/agent-control/context-packets/010-repo-local-pattern-review.md`
- `docs/agent-control/context-packets/011-pattern-evidence-engine.md`
- `docs/agent-control/context-packets/012-context-review-pattern-integration.md`
- `docs/agent-control/context-packets/034-role-grounded-evidence-coverage.md`
- `docs/agent-control/context-packets/045-wo-a-port-to-2.5.2.md`
- `docs/agent-control/context-packets/046-wo-a-2.5.2-final-review-remediation.md`
- `docs/agent-control/context-packets/047-wo-b-pre-coding-guidance.md`
- `docs/agent-control/context-packets/048-wo-b-first-review-remediation.md`
- `docs/agent-control/context-packets/049-wo-b-final-review-remediation.md`
- `docs/agent-control/context-packets/050-wo-b-terminal-no-go-remediation.md`
- `docs/agent-control/wo-a-repo-local-conventions-2.5.2-results.md`
- `docs/agent-control/wo-b-pre-coding-guidance-2.5.2-results.md`
- `scaffold/mcp/src/patternEvidence.ts`
- `scaffold/mcp/src/conventions.ts`
- `scaffold/mcp/src/guidance.ts`
- `scaffold/mcp/src/contextEntities.ts`
- `scaffold/mcp/src/graph.ts`
- `scaffold/mcp/src/types.ts`
- `scaffold/mcp/src/enterprise/reviews/pattern-context.ts`
- `bin/cli/query-command.mjs`
- `bin/cli/context-passthrough.mjs`
- `scaffold/scripts/bootstrap.sh`
- `scaffold/scripts/ingest.sh`
