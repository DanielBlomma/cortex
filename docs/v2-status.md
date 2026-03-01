# Cortex V2 Status (Locked)

Date locked: 2026-03-01

## Completed Scope

- MCP server uses proper MCP protocol (JSON-RPC over stdio via official SDK).
- Incremental ingest handles changed directory paths and deleted path prefixes correctly.
- Kuzu runtime supports reconnect/reload without server restart.
- Local semantic embeddings are generated with `Xenova/all-MiniLM-L6-v2`.
- `context.search` is unified across `File`, `Rule`, and `ADR`.
- Baseline MCP integration tests are in place and passing.

## Security Status (Updated 2026-03-01)

Remediation completed in V2:

- Added dependency overrides in `mcp/package.json` and `scaffold/mcp/package.json`:
  - `cmake-js`: `^8.0.0`
  - `tar`: `^7.5.9`
- Regenerated lockfiles for both runtime and scaffold.

Validation after remediation:

- `npm audit` in `mcp/`: `0` vulnerabilities.
- `npm audit` in `scaffold/mcp/`: `0` vulnerabilities.
- MCP build and tests still pass.

Notes:

- npm may still print deprecation warnings from upstream packages (`kuzu`, `prebuild-install`), but current audit is clean.
- Continue running `npm audit` before release tags and re-check upstream dependency health periodically.
