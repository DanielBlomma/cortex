# Release 2.5.0 Integration

## Work Profile

Infra/deploy/security-sensitive — WO-047 combines accepted runtime,
filesystem-boundary, dependency, package, and release-gate changes into the
candidate that will be reviewed before the authorized PR and release sequence.

## Objective

Integrate accepted WO-046 progressive background indexing on top of accepted
WO-033 through WO-035, preserve every containment and packed-artifact
guarantee, write the 2.5.0 release summary, and return one review-ready
candidate without changing version metadata or performing GitHub/npm
mutations.

## Starting Point

- Branch: `release/2.5.0-final`
- Base: `e86ce654aeb01d2c822550262ba88f5f5cf6cd3d`
- Filesystem acceptance:
  `docs/agent-control/wo-035-integrated-filesystem-containment-acceptance-baseline.md`
- Progressive contract:
  `docs/agent-control/context-packets/035-progressive-background-indexing.md`
- Progressive evidence:
  `docs/agent-control/wo046-progressive-background-indexing-results.md`
- Superseded WO-046 evidence:
  `benchmark/bootstrapbench/results/wo046-progressive-angular-20260820-frozen-final/evidence/`
- WO-047 frozen evidence target (ignored raw artifacts):
  `benchmark/bootstrapbench/results/wo047-progressive-angular-20260820-frozen-final/evidence/`

## Included Scope

- CLI routing, help, migration, scaffold ownership, and root/scaffold mirrors
  for `bootstrap --background --profile interactive` and
  `indexing status|pause|resume`.
- Progressive embedding state/snapshots, generation locking, generation-linked
  ingest/graph/embedding manifests, versioned atomic graph publication and
  retention, and fail-closed loading/status behavior.
- Project-root-anchored cache/DB/import/staging/publication validation before
  graph or semantic I/O, progressive graph-generation readiness validation,
  and atomically published token-bound indexing lock ownership.
- Focused CLI, MCP, graph publication/crash, migration, ownership, session, and
  Angular harness tests.
- Package inventory/ownership and real `v2.4.2` force-upgrade acceptance for
  every changed managed candidate file.
- `CHANGELOG.md` release notes and durable WO-047 control records.

## Explicit Exclusions

- No WO-036 through WO-045 adaptive retrieval, ranking, search-aspect,
  role-grounded, or benchmark experiment is integrated.
- No `search.ts`, `searchResults.ts`, `searchAspects.ts`,
  search-aspects/ranking tests, semantic-quality README, or
  `docs/search-ranking*` change is integrated.
- No local `.context/config.yaml` change or ignored Angular raw evidence is
  committed.
- No version bump, stage, commit, push, PR, merge, tag, publication, or deploy
  occurs in this work order.

## Evidence Rules

- Run Cortex search/rules/impact before edits and update/pattern/doctor/watch
  before handoff.
- Compare all 14 frozen Angular source bindings and the harness hash to the
  exact integrated source. The first review changed six bound files, so the
  accepted WO-046 report is superseded and a complete new run is mandatory.
- Round 2 supersedes the first WO-047 report because the lock fix changes
  `embed.ts`, `progressiveIndexing.ts`, and `indexing.mjs`. Regenerate the
  complete six-scope Angular chain after delayed/multi-contender,
  crash-before-publication, handshake-load, and full-root gates pass.
- Pin the new run to Angular commit
  `71bb19d772aa77a30922fb896f775b58a0862c36` in a fresh checkout. Preserve the
  accepted six-path source scope (`packages/compiler-cli`, `packages/core`,
  `packages/compiler`, `packages/router`, `packages/platform-browser`, and
  `README.md`) and bind the exact generated context-config and harness hashes.
- Require syntax, focused lifecycle/graph tests, full root/MCP suites,
  frontend build, all dependency audits, version/diff checks, and the real
  packed containment/upgrade harness.
- Require independent Security, Ops/Release, and Validation review before
  manager acceptance; escalation to additional reviewers is allowed.

## Acceptance

- Foreground remains the default and native Windows background mode rejects
  explicitly; macOS, Linux, and WSL remain supported.
- The final source is bound to valid frozen Angular evidence, including real
  SIGTERM/resume and progressive/foreground byte and query parity.
- WO-034 containment remains intact: 48 outputs, whole-set precommit,
  hard-link-safe replacement, manifest-last publication, dashboard policy, and
  safe-alias behavior.
- The packed candidate has a locked full path/mode inventory, exact ownership,
  installed behavior, and verified force-upgrade state from released
  `v2.4.2`.
- All six dependency remediations and zero-audit release gates remain intact.
- Release Publish rejects every non-tag ref and requires strict `vX.Y.Z`
  equality with package metadata before checkout, install, or publication.
- Lock ownership is fully initialized and fsynced in a private same-parent
  stage before canonical publication. Mutation/release require the exact
  token; malformed/ownerless canonical locks fail closed, and only verified
  dead published owners or safe dead private artifacts are reclaimed.
- The branch is review-ready but uncommitted and carries no version metadata
  mutation.
