# Managed Scaffold Upgrade Hygiene

## Objective

Implement WO-030 by defining versioned Cortex scaffold ownership and removing
only obsolete Cortex-managed files during forced upgrades, while preserving
user-owned files, configuration, secrets, agent instructions, containment, and
the accepted CLI/ingest contracts.

## Durable Starting State

- Branch: `refactor/cli-ingest-modularization`.
- Release baseline: `v2.4.1`,
  `5ae3b00948bad26af2e5eaea60ce0b52567db352`.
- WO-026 through WO-029 are accepted locally.
- WO-029's canonical ingest architecture, output hashes, worker/trace
  equivalence, validation, package evidence, and repeated-memory comparison are
  recorded in `docs/agent-control/wo-029-ingest-orchestration-baseline.md`.
- The program sequence remains
  `docs/superpowers/plans/2026-07-28-cli-ingest-modularization.md`.
- The current scaffold/update implementation is `bin/cli/scaffold.mjs`.
- Existing preservation and migration contracts are exercised by
  `tests/init-config.test.mjs`, `tests/init-agents.test.mjs`, and
  `tests/scaffold-migration.test.mjs`.
- R15 in `docs/agent-control/risk-register.md` is the owned risk. R16 remains a
  separate ingest filesystem-containment risk and must not be folded into this
  work order.

## Work Profile

New contract/design — managed-file ownership, safe obsolete-file deletion, and
upgrade preservation become explicit architectural contracts.

## Owned Scope

- `bin/cli/scaffold.mjs` and a focused sibling module if ownership/cleanup
  policy benefits from separation
- Versioned scaffold ownership metadata under a package-controlled path
- Scaffold copying and forced-upgrade tests/fixtures under `tests/`
- `package.json` only if package inclusion requires an explicit path
- Agent-control evidence and the fresh WO-031 packet

## Out Of Scope

- CLI routing or public flag changes
- Parser, ingest, query, ranking, graph, embedding, daemon, hook, or Enterprise
  runtime redesign
- Removing `.context/mcp` compatibility naming or MCP support
- Broad cleanup of unknown project files
- Ingest source/output containment from R16
- Package version changes; WO-031 owns release metadata after acceptance

## Required Contract Anchors

- `tests/init-config.test.mjs`
  - `init --force` preserves user configuration and repairs Enterprise YAML
    permissions to `0600`
- `tests/init-agents.test.mjs`
  - existing AGENTS.md content survives while the managed Cortex block is
    installed or refreshed
- `tests/scaffold-migration.test.mjs`
  - current legacy-file cleanup, package-scaffold copying, and
    `isScaffoldOutOfDate` compatibility behavior
- `tests/enterprise-cli-security.test.mjs`
  - package-owned trusted-runtime resolution and secret/config preservation
- `docs/agent-control/wo-029-ingest-orchestration-baseline.md`
  - all current nested ingest modules are package-owned scaffold files and must
    continue shipping after cleanup policy is introduced

## Implementation Sequence

1. Inventory the files currently copied by `copyScaffold` and distinguish
   package-owned generated paths from preserved configuration and user-owned
   paths.
2. Define a versioned ownership manifest in the package scaffold. Keep the
   schema small, deterministic, and explicit about the managed root.
3. Persist enough prior-manifest state in initialized projects to identify
   files that were owned by the previously installed scaffold but are absent
   from the new manifest.
4. Resolve every cleanup candidate beneath the expected project-managed root.
   Reject absolute paths, `..` traversal, empty/broad roots, symlink escapes,
   and non-file targets before deletion.
5. During `init --force`, remove only paths proved to be owned by the prior
   manifest and obsolete in the new manifest. Preserve unknown files even when
   they sit beside generated files.
6. Preserve `config.yaml`, `rules.yaml`, `ontology.cypher`, both Enterprise
   YAML spellings, CLAUDE.md, and user AGENTS.md text according to the accepted
   contracts.
7. Add fixtures for removed, renamed, locally modified, unknown, symlinked,
   traversal, secret-bearing, and stale generated files.
8. Prove a stale generated source cannot survive an upgrade and break
   bootstrap, without broadening cleanup beyond manifest ownership.
9. Verify package inclusion and a clean temporary forced-upgrade smoke.

Do not combine ownership cleanup with WO-031 release/version work.

## Constraints

- Cleanup authority comes only from package-controlled versioned manifests and
  prior manifest state, never from arbitrary project input.
- Never recursively delete a broad managed root.
- Never follow symlinks for cleanup or preservation decisions.
- Unknown or user-created files survive.
- Locally modified generated files need an explicit reviewed policy; do not
  silently infer user intent from location alone.
- Enterprise configuration and secrets remain package-trusted, preserved, and
  mode-hardened.
- Existing CLI output/exit behavior remains stable unless a new diagnostic is
  required to fail closed on unsafe cleanup metadata.
- Every new scaffold ownership file ships in the npm artifact.
- Do not bump the package version.

## Known Failure Modes

- Treating the new manifest as proof of prior ownership deletes an unrelated
  file that happens to share a path.
- Normalization accepts `..`, absolute paths, or separator variants that escape
  the managed root.
- A symlinked directory or destination redirects deletion outside the project.
- Broad directory removal deletes unknown files nested beside obsolete managed
  files.
- Forced upgrade overwrites config, rules, ontology, Enterprise secrets, or
  user agent instructions.
- A locally modified obsolete generated file is deleted without an explicit
  policy or migration record.
- A new manifest is omitted from `npm pack`, so installed upgrades cannot
  determine ownership.
- Cleanup runs before preservation snapshots or after new files are copied in
  an order that destroys the evidence needed for a safe decision.

## Required Reviewers

- Code Quality Reviewer
- Contract Reviewer
- Security and Privacy Reviewer
- Integration Reviewer
- Validation Reviewer

Reviewers cannot be the implementer.

## Validation

- `node --check` for every changed CLI/scaffold module
- Focused init, agent, migration, and Enterprise security tests
- Negative traversal, absolute-path, symlink, unknown-file, and broad-root
  deletion tests
- Forced-upgrade fixture proving obsolete managed files are removed and
  unknown/preserved files survive
- Stale-generated-source bootstrap regression
- Full root `npm test`
- Full `npm --prefix scaffold/mcp test`
- `npm pack --dry-run --json` and manifest/package inspection
- Clean temporary package install plus `init --force` upgrade smoke
- `cortex impact` before the cleanup refactor
- `cortex pattern-evidence <changed-file> --json`
- `cortex update`, `cortex doctor`, and `cortex watch status`
- Independent required-reviewer closure with no blocker/major findings

## Acceptance

- Versioned ownership distinguishes Cortex-managed paths from unknown
  user-owned paths.
- Forced upgrades delete only safely resolved paths proved to be obsolete and
  previously managed.
- Traversal and symlink escape attempts fail closed without touching external
  targets.
- Config, rules, ontology, Enterprise secrets, and agent instructions retain
  their accepted preservation behavior.
- Stale generated sources cannot survive and break bootstrap.
- The package contains the manifest and every current canonical ingest module.
- Focused and full suites pass.
- Control documents provide a fresh WO-031 session with zero chat history.

## Fresh-Session Start

Start WO-030 in a new session with no chat history and this prompt:

> Implement WO-030 from
> `docs/agent-control/context-packets/020-managed-scaffold-upgrade-hygiene.md`.
> Read that packet completely, then read only its direct references. Use Cortex
> search/rules/impact before code decisions. Stay on
> `refactor/cli-ingest-modularization`. Stop after versioned managed-file
> ownership, contained obsolete-file cleanup, preservation and negative
> validation, independent review, and a fresh WO-031 packet.
