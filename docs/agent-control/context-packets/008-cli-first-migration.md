# CLI-First Migration Context Packet

## Objective

Move Cortex from an MCP-first product shape to a CLI-first local graph+RAG
tool for coding agents. The first implementation milestone must make CLI
retrieval useful and testable before MCP defaults are removed.

## Background

- Current Cortex public positioning and scaffold are MCP-first:
  - README describes Cortex as serving context over MCP.
  - `cortex init` defaults to MCP client registration.
  - `cortex connect` and `cortex mcp` are visible commands.
  - Scaffolded `AGENTS.md` and `CLAUDE.md` require MCP tools.
- The new product direction is CLI-first because local station agents can call
  shell commands directly and need stable JSON output more than MCP client
  registration.
- Existing retrieval behavior must not regress: source-of-truth, deprecated
  filtering, conflict surfacing, ranking, and impact traversal still apply.
- The current runtime lives under `scaffold/mcp/`; do not rename or remove it
  until CLI parity is proven.

## Work Profile

Feature migration, staged as planning plus implementation PRs. This touches
contracts, CLI/scaffold behavior, runtime packaging, docs, and release gates.

## Owned Scope

- CLI command surface in `bin/cortex.mjs`.
- Runtime query helpers currently under `scaffold/mcp/src`.
- Tests under root `tests/` and `scaffold/mcp/tests/` as needed.
- Scaffolded guidance in `scaffold/AGENTS.md`, `scaffold/CLAUDE.md`, and
  generated docs.
- Public docs and release/package metadata when the migration reaches default
  behavior or naming changes.

## Out Of Scope

- Parser quality work for Angular WO-002 through WO-005.
- Deep memory work beyond what is required to avoid CLI query regressions.
- Removing MCP code before CLI parity is implemented and validated.
- Introducing remote services, source upload, or new telemetry.

## Constraints

- Preserve local-first behavior.
- CLI commands must support `--json` for agent-readable output.
- Human-readable output must remain concise and deterministic enough for
  terminal use.
- Do not break `cortex bootstrap`, `cortex update`, `cortex graph-load`,
  `cortex embed`, or existing generated projects during the first milestone.
- Keep MCP compatibility temporarily unless the manager explicitly approves a
  breaking release.

## Target CLI Contract

- `cortex search "<query>" [--top-k N] [--include-content] [--json]`
- `cortex related <entity_id> [--depth N] [--include-edges] [--json]`
- `cortex impact "<query-or-entity>" [--depth N] [--profile <name>] [--json]`
- `cortex rules [--scope <scope>] [--json]`
- `cortex explain <path-or-entity-id> [--json]`

## Required Output

- Updated work orders and traceability for the migration.
- CLI parity implementation plan with tests.
- Documentation and scaffold migration plan.
- Explicit deprecation/removal decision for MCP defaults before code removal.

## Acceptance

- Planning PR: control docs and public/internal plan are coherent, with no code
  behavior changes required.
- CLI parity PR: new commands pass focused integration tests and match existing
  retrieval semantics.
- Default migration PR: `cortex init --bootstrap` works without MCP client
  registration, scaffolded instructions point agents at CLI commands, and
  release/version-sync gates pass.
