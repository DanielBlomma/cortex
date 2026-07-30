# CLI Modularization

## Objective

Implement WO-027 by splitting `bin/cortex.mjs` into cohesive CLI modules while
preserving every behavior characterized by WO-026.

## Durable Starting State

- Branch: `refactor/cli-ingest-modularization`.
- Release baseline: `v2.4.1`,
  `5ae3b00948bad26af2e5eaea60ce0b52567db352`.
- WO-026 added subprocess CLI contracts, query-envelope forwarding contracts,
  expanded Enterprise stream/preservation contracts, and the ingest baseline.
- The durable evidence and complete command inventory are in
  `docs/agent-control/wo-026-characterization-baseline.md`.
- The detailed program sequence remains
  `docs/superpowers/plans/2026-07-28-cli-ingest-modularization.md`.

## Work Profile

New contract/design — public behavior is frozen, but module ownership and the
trusted Enterprise import boundary are architectural contracts.

## Owned Scope

- `bin/cortex.mjs`
- New modules under `bin/cli/`
- CLI, query-shim, init, scaffold-migration, and Enterprise tests under
  `tests/`
- `package.json` only if package/test inclusion requires it
- Agent-control documents needed for WO-027 handoff and review

## Out Of Scope

- Root or packaged ingest modularization
- Managed-scaffold obsolete-file cleanup
- Removing or renaming `.context/mcp` or `cortex mcp`
- Query ranking, graph, parser, embedding, daemon protocol, hook protocol, or
  Enterprise feature changes
- Package version changes

## Required Contract Anchors

- `tests/cli-contract.test.mjs`
  - help/version aliases
  - command inventory
  - status and stdout/stderr ownership
  - malformed flags and missing-runtime diagnostics
  - raw context-command passthrough
  - successful connect, MCP, stage, run, hook/hooks, and telemetry dispatch
  - handler argument forwarding and child exit behavior
- `tests/query-cli-shim.test.mjs`
  - all six top-level query commands
  - semantic JSON success/error envelopes
  - JSON error exit status and stdout ownership
- `tests/enterprise-cli-security.test.mjs`
  - explicit stdin flag, non-TTY one-line bounded secrets, and no echo
  - package-owned trusted runtime success and missing-runtime fail-closed
  - identity-before-govern-before-permanent-privilege-drop ordering
  - config preservation, regular-file-only handling, symlink rejection, and
    `0600`
  - verified daemon control
- `tests/init-config.test.mjs`
  - `slugifyRepoId`
  - `detectInitialSourcePaths`
  - `buildInitialConfig`
- `tests/scaffold-migration.test.mjs`
  - `isScaffoldOutOfDate`
  - `.context/mcp` compatibility naming

## Implementation Sequence

1. Extract help rendering and argument parsing into pure modules.
2. Extract process execution and result helpers without changing inherited
   streams or error wrapping.
3. Extract scaffold path/config/copy helpers and re-export the compatibility
   helpers from `bin/cortex.mjs`.
4. Extract context query and passthrough handlers.
5. Extract init/connect/scaffold handling.
6. Extract daemon handling without changing PID/socket verification.
7. Extract hook and telemetry handling.
8. Extract Enterprise handling last, keeping trusted installed-package
   resolution physically separate from project-runtime resolution.
9. Compose handlers through a small router; keep executable setup,
   top-level error formatting, and compatibility re-exports in
   `bin/cortex.mjs`.

Run the focused characterization set after each independently meaningful
extraction. Do not batch all moves into one unreviewable rewrite.

## Constraints

- Preserve every command, hidden compatibility alias, option, default,
  passthrough argument, exit status, and output stream recorded by WO-026.
- Preserve semantic JSON envelopes; do not snapshot timestamps or local paths.
- `bin/cortex.mjs` remains the npm executable.
- Preserve exports:
  `slugifyRepoId`, `detectInitialSourcePaths`, `buildInitialConfig`,
  `hardenEnterpriseConfigPermissions`, `isScaffoldOutOfDate`, and
  `runEnterpriseInstall`.
- Query, stage, run, telemetry, hook, and daemon project-runtime resolution
  remains rooted in the selected project.
- Enterprise control and install imports must resolve only from the
  package-owned `scaffold/mcp/dist/cli` tree.
- Enterprise installation requires the explicit stdin flag, rejects TTY,
  empty, multiline, and oversized input, never echoes the key, and stores it
  with mode `0600`.
- Enterprise config hardening must use `lstat`, reject symlinks/non-regular
  paths without touching their targets, and repair both `.yml` and `.yaml`.
- Verified identity binding must complete before host-global govern writes;
  govern writes must complete before the permanent privilege drop.
- Do not introduce a command-framework dependency or convert functional code
  into classes.
- New `bin/cli/` modules must be present in `npm pack`.

## Known Failure Modes

- A moved error is caught at a different layer, changing status or stream.
- JSON validation errors move from stdout to stderr.
- A handler drops or reorders passthrough arguments.
- `refresh`, `hook`, or version/help aliases disappear because they are not all
  prominent in top-level help.
- Enterprise modules accidentally reuse project-runtime resolution.
- Direct-import compatibility exports disappear.
- New runtime modules are omitted from the npm artifact.

## Required Reviewers

- Code Quality Reviewer
- Contract Reviewer
- Security and Privacy Reviewer
- Integration Reviewer
- Validation Reviewer

Reviewers cannot be the implementer.

## Validation

- `node --check` for `bin/cortex.mjs` and every new `.mjs` module
- `node --test tests/cli-contract.test.mjs tests/query-cli-shim.test.mjs
  tests/init-config.test.mjs tests/init-agents.test.mjs
  tests/scaffold-migration.test.mjs tests/enterprise-cli-security.test.mjs`
- The focused CLI set must exercise successful runtime-backed handlers as well
  as missing-runtime errors, including stream and exit behavior.
- The Enterprise set must include trusted-runtime success/fail-closed,
  TTY/no-flag/invalid-input rejection, ordering, and config type/mode cases.
- Full root `npm test`
- Full `npm --prefix scaffold/mcp test`
- `npm pack --dry-run --json` and inspection for every `bin/cli/` module
- `cortex pattern-evidence <changed-file> --json`
- `cortex update`, `cortex doctor`, and `cortex watch status`
- Independent required-reviewer closure with no blocker/major findings

## Acceptance

- `bin/cortex.mjs` contains executable setup, top-level error formatting,
  routing composition, and compatibility re-exports only.
- Characterized CLI, query, init, daemon, hook, telemetry, and Enterprise
  behavior is unchanged.
- Enterprise control remains fail-closed and package-trusted.
- Every new CLI module ships in the npm artifact.
- Focused and full suites pass.
- Control documents provide a fresh WO-028 session with zero chat history.

## Fresh-Session Start

Start WO-027 in a new session with no chat history and this prompt:

> Implement WO-027 from
> `docs/agent-control/context-packets/017-cli-modularization.md`.
> Read that packet completely, then read only its direct references. Use Cortex
> search/rules/impact before code decisions. Stay on
> `refactor/cli-ingest-modularization`. Stop after CLI modularization,
> validation, independent review, and a fresh WO-028 packet.
