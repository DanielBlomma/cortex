# Integrated Validation and Release Readiness

## Objective

Implement WO-031 by running the complete modularization acceptance matrix,
fixing only release-blocking regressions, proving the packed artifact works
from a clean installation, and preparing patch release `2.4.2` only after all
technical and independent-review gates pass.

## Durable Starting State

- Branch: `refactor/cli-ingest-modularization`.
- Release baseline: `v2.4.1`,
  `5ae3b00948bad26af2e5eaea60ce0b52567db352`.
- WO-026 through WO-030 are accepted locally.
- Observable CLI/Enterprise/ingest/package/memory baselines are in
  `docs/agent-control/wo-026-characterization-baseline.md`.
- Final ingest architecture and repeated-memory evidence are in
  `docs/agent-control/wo-029-ingest-orchestration-baseline.md`.
- Managed ownership, `2.4.1` pre-state migration, cleanup policy, filesystem
  safety, package evidence, and accepted residual concurrency assumption are
  in `docs/agent-control/wo-030-managed-scaffold-baseline.md`.
- The program sequence remains
  `docs/superpowers/plans/2026-07-28-cli-ingest-modularization.md`.
- R14 and R15 are mitigated locally through WO-030. R16 remains a separate,
  accepted pre-existing ingest filesystem-containment risk.

## Work Profile

Integration, validation, and release readiness. No planned feature or
architecture implementation.

## Owned Scope

- Integrated syntax, focused, full-suite, audit, package, install, CLI,
  bootstrap, doctor, update, search, and memory evidence
- Narrow fixes required by a failed acceptance gate or independent review
- Release/version metadata, changelog, and package/plugin synchronization only
  after every pre-release gate passes
- Final agent-control acceptance, risk, handoff, and release traceability

## Out Of Scope

- New CLI, ingest, parser, query, ranking, graph, embedding, daemon, hook,
  Enterprise, scaffold, website, or benchmark features
- Package/MCP compatibility removal or rename
- Ingest filesystem-containment changes owned by R16
- Publishing, tagging, merging, or deploying without an explicit subsequent
  user/manager instruction
- A version bump before complete acceptance

## Required Contract Anchors

- `docs/agent-control/wo-026-characterization-baseline.md`
  - CLI/Enterprise streams, exit status, JSON envelopes, ingest digests,
    package behavior, and three-run memory baseline
- `docs/agent-control/wo-029-ingest-orchestration-baseline.md`
  - canonical modules, hashes, sequential/parallel/worker equivalence, trace,
    result-retention, and comparable memory results
- `docs/agent-control/wo-030-managed-scaffold-baseline.md`
  - ownership/state, pre-state bridge, cleanup/preservation policy, package
    inventory, and filesystem-negative contracts
- `docs/agent-control/context-packets/015-dependabot-remediation.md`
  - committed lockfile audit policy and Node floor
- `scripts/sync-release-version.mjs`
  - all release metadata that must move together

## Implementation Sequence

1. Start from a clean view of the WO-026 through WO-030 accepted diff. Run
   Cortex search/rules/impact and inspect only the baseline files above plus
   directly affected validation/release surfaces.
2. Run syntax checks for every executable entrypoint and extracted CLI/ingest
   module.
3. Run focused CLI, init, migration, ownership, Enterprise, ingest, worker,
   trace, memory, and context-regression tests.
4. Run complete root and MCP suites, every committed dependency audit, version
   synchronization, and clean-diff checks.
5. Build and inspect the real npm tarball. Confirm every CLI module, ownership
   manifest/baseline, and canonical ingest module ships with expected modes.
6. Install the tarball into a clean temporary prefix. In clean repositories run
   `init --bootstrap`, `doctor`, `update`, `search --json`, and a forced
   upgrade that exercises preservation and stale-file cleanup.
7. Compare final deterministic hashes, sequential/parallel/worker-failure
   bytes, trace counts, and repeated Cortex/Angular memory evidence with the
   accepted baselines. Investigate any median peak-RSS movement above five
   percent.
8. Confirm the final diff adds no source upload, secret egress, unexpected
   network path, compatibility removal, or out-of-scope behavior.
9. Resolve all independent review findings. Only after every gate is green,
   synchronize release metadata to `2.4.2` and rerun affected gates.
10. Record final release-readiness evidence. Stop before publish, tag, merge,
    or deployment.

## Constraints

- Treat every WO-026 observable and every WO-029 deterministic/memory contract
  as frozen.
- Preserve WO-030 ownership, cleanup, migration, and protected-file policy.
- Keep `.context/mcp`, MCP support, package name, and compatibility commands.
- Do not weaken audit thresholds, security boundaries, Enterprise trust, test
  coverage, or package inspection to make a gate pass.
- Use the same pinned repos, SHAs, model, bootstrapbench configuration, and
  cache policy for memory comparison.
- Do not bump the version until technical acceptance and all reviewer roles
  are clean.
- Do not publish, tag, merge, or deploy.

## Known Failure Modes

- Testing the worktree instead of the extracted tarball hides package omissions.
- `npm pack --dry-run` passes while a clean global-prefix install or bootstrap
  fails.
- A release bump occurs before review, audit, memory, or package acceptance.
- A version is changed in only some package/plugin/marketplace surfaces.
- Generated/stale dist files enter a project despite being absent from the
  ownership manifest.
- Environment or cache drift makes memory results incomparable.
- Network/model activity is mistaken for a code regression or hides an
  unexpected egress path.
- A release fix broadens into new behavior without a fresh work order.

## Required Reviewers

- Code Quality Reviewer
- Contract Reviewer
- Security and Privacy Reviewer
- Integration Reviewer
- Validation Reviewer
- Ops/Release Reviewer

Reviewers cannot be the implementer.

## Validation

- `node --check` for all entrypoints and extracted `.mjs` modules
- Focused CLI/init/migration/ownership/Enterprise/ingest/worker/trace suites
- `node tests/context-regressions.test.mjs`
- Full root `npm test`
- Full `npm --prefix scaffold/mcp test`
- `npm run audit:dependencies` and inspection of every committed lockfile
- `npm run release:check-version-sync`
- Real `npm pack --json`, tarball extraction, file/mode inspection, and clean
  temporary-prefix install
- Packed `init --bootstrap`, `doctor`, `update`, `search --json`, and
  `init --force` smokes
- Frozen digest/equivalence/trace comparison
- Three comparable Cortex and Angular memory runs
- `git diff --check`
- `cortex pattern-evidence <changed-file> --json`, `cortex update`,
  `cortex doctor`, and `cortex watch status`
- Independent six-role closure with no blocker or major findings

## Acceptance

- All WO-026 public, security, deterministic, package, and memory contracts
  remain satisfied.
- The extracted package works end to end from a clean installation.
- WO-030 safe upgrade behavior works from the packed artifact.
- All dependency audits and version surfaces are clean and synchronized.
- Repeated memory evidence stays within the accepted band or has an explicitly
  reviewed resolution.
- No unexpected source upload, secret egress, network path, or compatibility
  removal exists.
- All six reviewer roles close without blocker or major findings.
- `2.4.2` metadata is prepared only after every preceding gate passes.
- No publish, tag, merge, or deploy action is taken.

## Fresh-Session Start

Start WO-031 in a new session with no chat history and this prompt:

> Implement WO-031 from
> `docs/agent-control/context-packets/021-integrated-validation-release.md`.
> Read that packet completely, then read only its direct references. Use Cortex
> search/rules/impact before code decisions. Stay on
> `refactor/cli-ingest-modularization`. Run the integrated release-readiness
> matrix, fix only gate-blocking regressions, complete six-role review, and
> prepare `2.4.2` only after all gates pass. Do not publish, tag, merge, or
> deploy.
