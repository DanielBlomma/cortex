# Integrated Filesystem-Containment Acceptance

## Work Profile

Infra/deploy/security-sensitive — WO-035 changes dependency resolution and
release-workflow gates while accepting the security boundary of the published
npm artifact, so it requires Security, Ops/Release, and Validation review.

## Objective

Execute WO-035 only after the manager accepts
`docs/agent-control/wo-034-output-cache-dashboard-data-containment-baseline.md`.
Validate the combined WO-033/WO-034 boundary from the actual packed artifact,
close every independent review finding, classify the observable behavior
change, and decide R16 disposition before any release mutation.

## Entry Hard Blocker

The WO-034 review rerun on 2026-08-20 found a non-zero package-owned MCP
audit: 1 moderate and 4 high vulnerable packages (`hono`, `brace-expansion`,
`fast-uri`, `ip-address`, and `js-yaml`). This is not waived. Before WO-035
can declare release readiness, a separate authorized dependency/release
iteration must update the lockfile/dependencies, rerun the affected and full
suites, and return every committed audit to zero. Do not fold that dependency
mutation into the WO-034 containment codefix.

## Required Starting References

- `docs/agent-control/wo-033-source-control-file-containment-baseline.md`
- `docs/agent-control/wo-034-output-cache-dashboard-data-containment-baseline.md`
- `docs/agent-control/wo-032-ingest-filesystem-containment-baseline.md`
- `docs/agent-control/context-packets/024-output-cache-dashboard-data-containment.md`
- `scaffold/scripts/lib/ingest/filesystem-boundary.mjs`
- `scaffold/scripts/lib/ingest/main.mjs`
- `scaffold/scripts/lib/ingest/pipeline-stages.mjs`
- `scripts/dashboard.mjs` and `scaffold/scripts/dashboard.mjs`
- `tests/ingest-filesystem-boundary.test.mjs`

## Owned Scope

- Independent Code Quality/Integration, Contract/Security and Privacy,
  Validation, and Ops/Release review of the combined WO-033/WO-034 diff
- Full syntax, containment, compatibility, root, MCP, audit, version, diff,
  ownership, and Cortex gates
- Real `npm pack`, extraction, clean-prefix install, and packed normal/negative
  ingest and dashboard smokes
- Deterministic package inventory and an explicit packed-containment gate in
  both release workflows before tag or publication mutation
- Release classification for the fail-closed external-source/output behavior
  and the already documented changed-mode safe-alias correctness fix
- Final R16 evidence and manager disposition
- Release-readiness documentation only after every technical and review gate
  passes

## Explicit Exclusions

- Do not integrate WO-036 through WO-045 retrieval/benchmark experiments.
- Do not integrate WO-046 progressive indexing or its manifest generation
  fields until R16 is closed and the manager starts a separate work order.
- Do not change version, commit, push, open/merge a PR, tag, publish, or deploy
  merely because technical tests pass. Those actions require the separate
  authorized release sequence and manager acceptance.
- Do not weaken the closed filesystem policy, authorize external roots, add
  telemetry/source-data egress, or claim cross-file transactionality.

## Packed Acceptance Matrix

1. Build package-owned MCP runtime from the locked clean checkout.
2. Run syntax for both wrappers, both dashboards, worker, and all canonical
   ingest modules.
3. Run the complete filesystem boundary suite and the frozen
   characterization/parallel/worker/trace/dashboard group.
4. Run context regressions, full root `npm test`, and full
   `npm --prefix scaffold/mcp test`.
5. Resolve the recorded MCP audit hard blocker in its separately authorized
   dependency iteration, then run every committed dependency audit at the
   repository-required threshold and require zero findings before readiness.
6. Run version synchronization and `git diff --check`.
7. Create a real tarball, lock its full sorted path/mode inventory and exact
   counts from a clean checkout, prove ignored local build markers cannot alter
   that inventory, extract it under a test-owned temporary parent, and install
   it into a clean prefix.
8. From the installed artifact, initialize a benign project and prove full
   and changed ingest, 26/21 outputs, all four normalized hashes, 17 trace
   labels, dashboard rendering, and manifest-last successful completion.
9. From separate installed-artifact fixtures, prove source/control denial,
   redirected prior cache, redirected/special output ancestors and leaves,
   hard-linked JSONL/TSV/manifest replacement, stage/pre-commit cleanup, unsafe
   dashboard manifest/relation/embedding/npm-cache denial, zero fake-npm
   invocation, one bounded diagnostic, and no normal completion output.
10. Verify the installed ownership manifest exactly covers every packaged
    runtime file and a forced upgrade from the verified `v2.4.2` release tag
    installs and fingerprints every changed canonical module without altering
    protected or unknown project content.
11. Run Cortex update, pattern evidence for every changed indexed file,
    doctor, and watcher status.
12. Close every reviewer finding with a regression and re-review. Record the
    exact accepted commit before changing R16 or release state.

## Acceptance

- The tarball, not only the source worktree, enforces the combined source,
  cache, output, dashboard-data, cleanup, and diagnostic contracts.
- Every frozen valid output/hash/order/worker/trace/dashboard contract remains
  unchanged.
- Pre-commit failures preserve the prior set; commit failures expose only the
  documented possible prefix and never publish a new manifest early.
- No denial fixture reads or mutates its sibling canary and no dashboard
  denial invokes npm.
- Dependency, version, package, ownership, and review gates are green.
- The manager explicitly records the release classification and either closes
  R16 with evidence or leaves it open with a concrete blocking finding.

## Fresh-Session Prompt

> Execute WO-035 from
> `docs/agent-control/context-packets/025-integrated-filesystem-containment-acceptance.md`
> only after manager acceptance of the WO-034 baseline. Start from a fresh
> session, use Cortex search/rules/impact first, validate the actual packed
> artifact with benign temporary-root fixtures, obtain all required independent
> reviews, and stop before WO-046 integration or any release mutation unless a
> separate manager instruction authorizes that next phase.
