# Manager Log

Durable chronological log for scope, decisions, approvals, blockers, and
staging status. Do not rely on chat memory for acceptance or merge decisions.

Rotation rule: at each day rollover (or at ~150 lines), move the previous
day's entries to `archive/manager-log-YYYY-MM-DD.md` and refresh Current State.

## Current State (2026-08-03)

- Released npm baseline is `v2.4.2`. The annotated tag peels to corrected
  `origin/main` at `736becf34d929ea0bef88adbe476a584a1f081e9`,
  and Release Publish run `30523845440` completed successfully.
- WO-026 through WO-031 are accepted, merged, and released. The final
  integrated record is
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
- Initial Release Publish run `30521392683` stopped safely before npm. PR #110
  fixed both release workflows to install/build `scaffold/mcp` before root
  tests and added ordering regressions. After reviewer acceptance and merge,
  the unpublished tag was deliberately moved from `bd968d4` to corrected
  `736becf`; run `30523845440` passed every gate and published npm `2.4.2`.
- R14 and R15 are mitigated locally. R16 remains the accepted pre-existing
  ingest filesystem-containment risk. Its behavior-changing remediation is now
  planned as WO-032 through WO-035 in context packet 022; the risk remains open
  until packed-artifact acceptance. WO-030's narrow same-user ancestor-swap
  assumption remains accepted.
- The modularization program and release recovery are complete. WO-032's
  characterization/contract first pass and focused packet 023 are complete;
  independent Contract and Security/Privacy review is pending. WO-033 remains
  blocked until the manager records both approvals.

## Open Decisions

- Whether `cortex mcp` is deprecated for one release or removed directly in a
  future breaking release.
- Whether `@danielblomma/cortex-mcp` is retained as the npm package name during
  the CLI-first migration or followed by a new package with a migration
  window.
- Release classification/version for the R16 behavior change after WO-033 and
  WO-034 compatibility evidence is available.

## Closed Decisions

- The behavior-preserving CLI/ingest modularization program is accepted locally
  through WO-031.
- Patch release metadata may move to `2.4.2`; technical acceptance and six-role
  review completed before the bump.
- Under explicit user instruction, PRs #109 and #110 were merged, the failed
  unpublished tag was replaced with corrected `main`, and npm `2.4.2` was
  published only after the fixed release gates passed.
- R16 remediation is sequenced as WO-032 characterization/contract, WO-033
  source/control containment, WO-034 output containment/cleanup, and WO-035
  integrated package acceptance. External source roots are not authorized;
  portable relative roots only, with explicit symlink denial.

## 2026-08-03

- Created `plan/r16-ingest-filesystem-containment` from `main` at `6052686`.
- Used Cortex rules, search, and impact plus direct inspection of canonical
  ingest discovery, pipeline, I/O, and worker paths to scope R16.
- Added program packet 022, the detailed containment plan, WO-032 through
  WO-035, and REQ-16 traceability. The plan separates policy/characterization,
  source reads, output mutation, and packed-artifact acceptance so each work
  order can run in a fresh bounded session.
- R16 stays open. No runtime, release metadata, publish, tag, merge, or deploy
  action was taken.
- WO-032 characterized only synthetic temporary-root layouts. It confirmed
  current absolute/parent/explicit-symlink reads, symlinked control consumption,
  cache-parent redirection, direct symlink/hard-link truncation, and partial
  output replacement before a special-leaf failure.
- Added `wo-032-ingest-filesystem-containment-baseline.md` with the complete
  read/write inventory, frozen valid contracts, fail-closed ordering, bounded
  error ownership, migration rules, and honest concurrent-mutator residual.
  Added focused packet 023 for WO-033. Focused compatibility tests pass 19/19.
- WO-032 is a first-pass handoff only. Contract and Security/Privacy review is
  pending; runtime behavior, tests, version, package, R16 status, and release
  state are unchanged.

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
- Validation/Ops and Security/Integration re-reviews closed with no blocker,
  major, or minor findings. PR #110 merged at `736becf`.
- Reconfirmed the failed run skipped audit, package, and publish; npm still
  served `2.4.1`; and no GitHub release existed. With explicit approval,
  deliberately replaced the unpublished `v2.4.2` tag so it peeled to
  `736becf`.
- Release Publish run `30523845440` passed metadata verification, both clean
  installs, trusted runtime build, root and MCP suites, dependency audits,
  package inspection, and npm trusted publishing. Independent registry
  verification reports version/latest `2.4.2`; the remote annotated tag peels
  to `736becf`.

## Archive

- `archive/manager-log-2026-07-29.md` — foundation through WO-030 acceptance.
