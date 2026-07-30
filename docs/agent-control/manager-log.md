# Manager Log

Durable chronological log for scope, decisions, approvals, blockers, and
staging status. Do not rely on chat memory for acceptance or merge decisions.

Rotation rule: at each day rollover (or at ~150 lines), move the previous
day's entries to `archive/manager-log-YYYY-MM-DD.md` and refresh Current State.

## Current State (2026-07-30)

- Released npm baseline remains `v2.4.1` at
  `5ae3b00948bad26af2e5eaea60ce0b52567db352`. PR #109 merged the synchronized
  `2.4.2` tree to `origin/main` at
  `bd968d404dcde5381955341d69e27460e2b665ce`.
- WO-026 through WO-031 are accepted locally on
  `refactor/cli-ingest-modularization`. The final integrated record is
  `docs/agent-control/wo-031-integrated-validation-baseline.md`.
- WO-031 preserved the frozen CLI, Enterprise, ingest, deterministic, package,
  upgrade, and memory contracts. Syntax, focused tests, context regressions,
  full root/MCP suites, five dependency audits, extracted-package smokes, and
  all six reviewer roles are green.
- Final memory medians are 631.46 MB for Cortex (+2.79% versus WO-026) and
  1,016.16 MB for Angular (-1.75%), inside the five-percent acceptance band.
- The accepted worktree `2.4.2` tarball contains 417 entries, all 19 CLI
  modules, all 15 canonical ingest modules, and all three ownership files. A
  clean-prefix install reports `2.4.2`. The clean release checkout correctly
  produces 416 entries because the intentionally unowned stale
  `scaffold/mcp/dist/embeddingModel.js` is absent.
- Release review fixed MCP registry Node-floor drift and added the registry
  submission to release-version synchronization and Release Bump staging. All
  six reviewers then closed with no blocker, major, or minor findings.
- `2.4.2` metadata is synchronized and PR #109 is merged. Tag `v2.4.2` was
  pushed, but Release Publish run `30521392683` stopped before audit, package,
  or npm publish because the clean checkout ran root Enterprise tests before
  building the package-owned MCP runtime. npm remains at `2.4.1`.
- PR #110 fixes both release workflows: install/build `scaffold/mcp` before
  root tests, reuse those dependencies for MCP `test:ci`, and lock the ordering
  with regressions. Recovery is validated locally and awaits merge/tag recovery.
- R14 and R15 are mitigated locally. R16 remains the accepted pre-existing
  ingest filesystem-containment risk for a separate behavior-changing security
  work order. WO-030's narrow same-user ancestor-swap assumption remains
  accepted.
- The modularization program has no remaining implementation work order.
  Release recovery is limited to merging PR #110, moving the failed unpublished
  `v2.4.2` tag to the corrected `main`, and monitoring the publish workflow.

## Open Decisions

- Whether `cortex mcp` is deprecated for one release or removed directly in a
  future breaking release.
- Whether `@danielblomma/cortex-mcp` is retained as the npm package name during
  the CLI-first migration or followed by a new package with a migration
  window.
- Scope and sequencing for a separate R16 ingest filesystem-containment work
  order.

## Closed Decisions

- The behavior-preserving CLI/ingest modularization program is accepted locally
  through WO-031.
- Patch release metadata may move to `2.4.2`; technical acceptance and six-role
  review completed before the bump.
- Release automation remains a subsequent explicit action because it commits,
  tags, pushes, and can trigger publication.

## 2026-07-30

- Ran WO-031 from context packet 021. Syntax passed for 42 JavaScript
  entrypoints/modules plus executable shell files; the focused matrix passed
  139/139; context regressions passed 81/81; root passed 321/321 after the
  release sync; MCP passed 413/413; every committed npm tree audits at zero.
- Built and exercised the real package from an empty prefix and repository.
  Bootstrap, doctor, update, JSON search, forced upgrade, user-content
  preservation, stale legacy cleanup, 380 ownership fingerprints, and
  Enterprise mode repair passed. A sandbox DNS failure was isolated and the
  same initialized repository completed under approved network access.
- Reproduced every frozen digest/equivalence/trace contract and six comparable
  memory samples. Both median RSS deltas remain within five percent.
- Independent Code Quality, Contract, Security and Privacy, Integration,
  Validation, and Ops/Release reviews closed. Registry Node-floor drift and
  Release Bump staging were fixed and re-reviewed.
- Synchronized package, lockfile, server, plugin, marketplace, registry,
  changelog, and README metadata for `2.4.2`; rebuilt a 417-entry tarball and
  verified a fresh-prefix install reports `2.4.2`.
- Final Cortex refresh completed with zero embedding failures. Pattern evidence
  passed for all 10 changed indexed files; 10 package/workflow/plugin/registry/
  test paths outside configured sources returned the expected not-indexed
  result. Doctor passed 8/8 and the optional watcher is stopped.
- Under explicit user instruction, pushed
  `refactor/cli-ingest-modularization` and opened PR #109 with WO-026 through
  WO-031 and REQ-15 traceability. The local `.mcp.json` deletion appeared after
  acceptance and remains intentionally unstaged and outside the PR.
- PR #109 merged to `main` at `bd968d4`. The first `v2.4.2` tag run
  `30521392683` passed metadata/parser setup and stopped at root test 320/321:
  the clean checkout lacked ignored `scaffold/mcp/dist/cli/govern.js`. Audit,
  package, and publish steps did not run; npm remained `2.4.1`.
- Created PR #110 to install/build the context runtime before root tests in
  both release workflows and added ordering regressions. Clean-checkout
  validation passes targeted
  Enterprise 24/24, context 81/81, root 323/323, MCP 413/413, plugin/release
  8/8, all committed dependency audits at zero, synchronized metadata, valid
  YAML, and a 416-entry clean package that omits the unowned stale
  `dist/embeddingModel.js`.

## Archive

- `archive/manager-log-2026-07-29.md` — foundation through WO-030 acceptance.
